"""顾客档案、会员与积分（UC-14）、熟客赊账（UC-13）。"""
from datetime import datetime, timedelta

from server import db
from server.core import (ALL_ROLES, OWNER, SALESPERSON, STAFF, api, bad, doc_no, integer, money, now,
                         num, ok, require, text, today, write_audit)


# --------------------------------------------------------------------------
# 顾客
# --------------------------------------------------------------------------
@api.get('/api/customers', roles=(OWNER, SALESPERSON))
def list_customers(req):
    page, size = req.page_args(20)
    q = (req.q('q') or '').strip()
    where = ['c.RecordStatus="A"']
    params = []
    if q:
        where.append('(c.Name LIKE ? OR c.Phone LIKE ?)')
        params += ['%' + q + '%', '%' + q + '%']
    if req.q('member') == '1':
        where.append('c.IsMember="Y"')
    if req.q('credit') == '1':
        where.append('c.CreditLimit > 0')
    cond = ' AND '.join(where)
    total = db.scalar('SELECT COUNT(*) FROM Customer c WHERE ' + cond, params)
    rows = db.query(
        'SELECT c.*, m.MemberID, m.MemberNo, m.Level, m.Points, m.LastVisitDate, m.JoinDate, '
        'a.AccountID, a.UsedAmount, a.OverdueDays, a.AccountStatus, '
        'ROUND(COALESCE((SELECT SUM(e.Amount - e.SettledAmount) FROM CreditEntry e '
        ' WHERE e.AccountID=a.AccountID AND e.EntryType="charge" AND e.RecordStatus="A"),0),2) AS Outstanding, '
        '(SELECT COUNT(*) FROM SaleOrder o WHERE o.CustomerID=c.CustomerID) AS OrderCount, '
        '(SELECT ROUND(COALESCE(SUM(o.TotalAmount),0),2) FROM SaleOrder o WHERE o.CustomerID=c.CustomerID) AS TotalSpent, '
        '(SELECT MAX(o.OccurredAt) FROM SaleOrder o WHERE o.CustomerID=c.CustomerID) AS LastOrderAt '
        'FROM Customer c LEFT JOIN Member m ON m.CustomerID=c.CustomerID AND m.RecordStatus="A" '
        'LEFT JOIN CreditAccount a ON a.CustomerID=c.CustomerID '
        'WHERE ' + cond + ' ORDER BY c.CustomerID LIMIT ? OFFSET ?',
        params + [size, (page - 1) * size])
    return ok({'items': db.rows_to_dict(rows), 'total': total, 'page': page, 'size': size})


@api.post('/api/customers', roles=(OWNER, SALESPERSON))
def create_customer(req):
    data = req.body
    name = text(data.get('name'), '顾客称呼', maxlen=32)
    phone = text(data.get('phone'), '手机号', required=False, maxlen=20)
    limit = num(data.get('creditLimit') or 0, '赊账额度', minimum=0)
    term = integer(data.get('creditTermDays') or 30, '账期天数', minimum=0)
    is_member = 'Y' if data.get('isMember') in ('Y', True, 'true', 1) else 'N'
    cid = db.insert('INSERT INTO Customer (Name, Phone, Address, CreditLimit, CreditTermDays, IsMember, Note) '
                    'VALUES (?,?,?,?,?,?,?)',
                    (name, phone, text(data.get('address'), '地址', required=False, maxlen=128),
                     limit, term, is_member, data.get('note')))
    if is_member == 'Y':
        seq = db.scalar('SELECT COUNT(*) FROM Member') + 1
        db.insert('INSERT INTO Member (MemberNo, CustomerID, JoinDate, Level, Points) VALUES (?,?,?,?,0)',
                  ('M%05d' % (20260 + seq), cid, today(), data.get('level') or '普通'))
    if limit > 0:
        db.insert('INSERT INTO CreditAccount (AccountNo, CustomerID, UsedAmount) VALUES (?,?,0)',
                  ('CA%05d' % cid, cid))
    write_audit(req, '建档顾客', 'Customer', cid, name)
    return ok({'customerId': cid, 'message': '顾客已建档'})


@api.put('/api/customers/<int:cid>', roles=(OWNER, SALESPERSON))
def update_customer(req):
    cid = integer(req.params['cid'], '顾客编号')
    row = db.query_one('SELECT * FROM Customer WHERE CustomerID=?', (cid,))
    require(row is not None, '顾客不存在', 404)
    data = req.body
    if req.employee['Role'] != OWNER:
        # 销售人员只能补联系方式与地址
        db.execute('UPDATE Customer SET Phone=?, Address=? WHERE CustomerID=?',
                   (text(data.get('phone', row['Phone']), '手机号', required=False, maxlen=20),
                    text(data.get('address', row['Address']), '地址', required=False, maxlen=128), cid))
    else:
        db.execute('UPDATE Customer SET Name=?, Phone=?, Address=?, CreditLimit=?, CreditTermDays=?, '
                   'Note=? WHERE CustomerID=?',
                   (text(data.get('name', row['Name']), '顾客称呼', maxlen=32),
                    text(data.get('phone', row['Phone']), '手机号', required=False, maxlen=20),
                    text(data.get('address', row['Address']), '地址', required=False, maxlen=128),
                    num(data.get('creditLimit', row['CreditLimit']), '赊账额度', minimum=0),
                    integer(data.get('creditTermDays', row['CreditTermDays']), '账期天数', minimum=0),
                    data.get('note', row['Note']), cid))
    return ok({'message': '顾客资料已更新'})


# --------------------------------------------------------------------------
# 赊账
# --------------------------------------------------------------------------
def refresh_account(account_id):
    used = db.scalar('SELECT COALESCE(SUM(Amount - SettledAmount),0) FROM CreditEntry '
                     'WHERE AccountID=? AND EntryType="charge" AND RecordStatus="A"', (account_id,))
    overdue = db.scalar(
        'SELECT CAST(MAX(0, julianday(date("now","localtime")) - julianday(MIN(DueDate))) AS INTEGER) '
        'FROM CreditEntry WHERE AccountID=? AND EntryType="charge" AND RecordStatus="A" '
        'AND Amount - SettledAmount > 0.001 AND DueDate < date("now","localtime")', (account_id,))
    status = 'Overdue' if (overdue or 0) > 0 else ('Normal' if used > 0 else 'Idle')
    db.execute('UPDATE CreditAccount SET UsedAmount=?, OverdueDays=?, AccountStatus=? WHERE AccountID=?',
               (money(used), int(overdue or 0), status, account_id))


@api.get('/api/credit/accounts', roles=(OWNER, SALESPERSON))
def credit_accounts(req):
    rows = db.query(
        'SELECT a.*, c.Name, c.Phone, c.CreditLimit, c.CreditTermDays, '
        'ROUND(COALESCE((SELECT SUM(e.Amount - e.SettledAmount) FROM CreditEntry e '
        ' WHERE e.AccountID=a.AccountID AND e.EntryType="charge" AND e.RecordStatus="A"),0),2) AS Outstanding, '
        '(SELECT MIN(e.DueDate) FROM CreditEntry e WHERE e.AccountID=a.AccountID AND e.EntryType="charge" '
        ' AND e.RecordStatus="A" AND e.Amount - e.SettledAmount > 0.001) AS EarliestDue, '
        '(SELECT COUNT(*) FROM CreditEntry e WHERE e.AccountID=a.AccountID AND e.EntryType="charge" '
        ' AND e.RecordStatus="A" AND e.Amount - e.SettledAmount > 0.001) AS OpenEntries, '
        '(SELECT MAX(e.SettledAt) FROM CreditEntry e WHERE e.AccountID=a.AccountID AND e.EntryType="settle") AS LastSettleAt '
        'FROM CreditAccount a JOIN Customer c ON c.CustomerID=a.CustomerID WHERE a.RecordStatus="A" '
        'ORDER BY a.OverdueDays DESC, Outstanding DESC')
    items = db.rows_to_dict(rows)
    for it in items:
        limit = it['CreditLimit'] or 0
        it['AvailableAmount'] = round(max(0, limit - (it['Outstanding'] or 0)), 2) if limit else None
        it['LimitUsedPct'] = round((it['Outstanding'] or 0) / limit * 100, 1) if limit else None
    summary = {
        'outstanding': round(sum(i['Outstanding'] or 0 for i in items), 2),
        'accounts': len([i for i in items if (i['Outstanding'] or 0) > 0]),
        'overdue': len([i for i in items if (i['OverdueDays'] or 0) > 0]),
        'limit': round(sum(i['CreditLimit'] or 0 for i in items), 2),
    }
    return ok({'items': items, 'summary': summary})


@api.get('/api/credit/accounts/<int:aid>/entries', roles=(OWNER, SALESPERSON))
def credit_entries(req):
    aid = integer(req.params['aid'], '赊账账户编号')
    acc = db.query_one('SELECT a.*, c.Name, c.Phone, c.CreditLimit, c.CreditTermDays FROM CreditAccount a '
                       'JOIN Customer c ON c.CustomerID=a.CustomerID WHERE a.AccountID=?', (aid,))
    require(acc is not None, '赊账账户不存在', 404)
    rows = db.rows_to_dict(db.query(
        'SELECT e.*, emp.Name AS RegisterName, '
        'CAST(julianday(date("now","localtime")) - julianday(e.DueDate) AS INTEGER) AS OverdueDays, '
        'ROUND(e.Amount - e.SettledAmount,2) AS Remain '
        'FROM CreditEntry e LEFT JOIN Employee emp ON emp.EmployeeID=e.RegisteredBy '
        'WHERE e.AccountID=? ORDER BY e.CreatedAt DESC, e.EntryID DESC', (aid,)))
    return ok({'account': db.row_to_dict(acc), 'items': rows})


@api.get('/api/credit/dunning', roles=(OWNER, SALESPERSON))
def dunning(req):
    """催收清单：到期未还的挂账按到期日排列。"""
    rows = db.rows_to_dict(db.query(
        'SELECT e.*, a.AccountNo, c.Name, c.Phone, cu.Address, '
        'CAST(julianday(date("now","localtime")) - julianday(e.DueDate) AS INTEGER) AS OverdueDays, '
        'ROUND(e.Amount - e.SettledAmount,2) AS Remain '
        'FROM CreditEntry e JOIN CreditAccount a ON a.AccountID=e.AccountID '
        'JOIN Customer c ON c.CustomerID=a.CustomerID JOIN Customer cu ON cu.CustomerID=c.CustomerID '
        'WHERE e.EntryType="charge" AND e.RecordStatus="A" AND e.Amount - e.SettledAmount > 0.001 '
        'ORDER BY e.DueDate ASC'))
    items = []
    for row in rows:
        if row['OverdueDays'] >= 0:
            row['stage'] = '逾期 %d 天' % row['OverdueDays'] if row['OverdueDays'] > 0 else '今日到期'
            row['level'] = 'danger' if row['OverdueDays'] > 7 else 'warn'
        elif row['OverdueDays'] >= -7:
            row['stage'] = '%d 天后到期' % (-row['OverdueDays'])
            row['level'] = 'info'
        else:
            row['stage'] = '%d 天后到期' % (-row['OverdueDays'])
            row['level'] = 'muted'
        items.append(row)
    return ok({'items': items,
               'summary': {'overdueAmount': round(sum(i['Remain'] for i in items if i['OverdueDays'] > 0), 2),
                           'overdueCount': len([i for i in items if i['OverdueDays'] > 0]),
                           'totalOutstanding': round(sum(i['Remain'] for i in items), 2)}})


@api.post('/api/credit/entries', roles=(OWNER, SALESPERSON))
def create_credit_entry(req):
    customer_id = integer(req.f('customerId'), '顾客', minimum=1)
    amount = num(req.f('amount'), '挂账金额', minimum=0.01)
    cust = db.query_one('SELECT * FROM Customer WHERE CustomerID=?', (customer_id,))
    require(cust is not None, '顾客不存在', 404)
    require(cust['CreditLimit'] and cust['CreditLimit'] > 0, '该顾客未约定赊账额度，请老板先维护额度')
    acc = db.query_one('SELECT * FROM CreditAccount WHERE CustomerID=?', (customer_id,))
    if acc is None:
        db.insert('INSERT INTO CreditAccount (AccountNo, CustomerID, UsedAmount) VALUES (?,?,0)',
                  ('CA%05d' % customer_id, customer_id))
        acc = db.query_one('SELECT * FROM CreditAccount WHERE CustomerID=?', (customer_id,))
    outstanding = db.scalar('SELECT COALESCE(SUM(Amount - SettledAmount),0) FROM CreditEntry '
                            'WHERE AccountID=? AND EntryType="charge" AND RecordStatus="A"',
                            (acc['AccountID'],))
    limit = cust['CreditLimit']
    over_limit = outstanding + amount > limit + 0.001
    if over_limit and req.employee['Role'] != OWNER and req.f('ownerConfirm') not in (True, 'true', 1):
        bad('超出约定额度：已用 %.2f，额度 %.2f，本次 %.2f。需老板确认后才能挂账'
            % (outstanding, limit, amount))
    due = req.f('dueDate') or (datetime.now() + timedelta(days=cust['CreditTermDays'] or 30)).strftime('%Y-%m-%d')
    entry_no = doc_no('CG')
    eid = db.insert('INSERT INTO CreditEntry (EntryNo, AccountID, RegisteredBy, EntryType, Amount, '
                    'SettledAmount, DueDate, Remark, ChargeRef) VALUES (?,?,?,?,?,0,?,?,?)',
                    (entry_no, acc['AccountID'], req.employee['EmployeeID'], 'charge', amount, due,
                     req.f('remark') or '熟客赊账', req.f('orderRef')))
    refresh_account(acc['AccountID'])
    write_audit(req, '登记挂账', 'CreditEntry', eid,
                '%s %s 挂账 %.2f，约定还款 %s%s' % (entry_no, cust['Name'], amount, due,
                                                '（超额度，老板确认）' if over_limit else ''))
    return ok({'entryId': eid, 'entryNo': entry_no, 'overLimit': over_limit,
               'message': '挂账凭证已生成，已推送还款日期给顾客'})


@api.post('/api/credit/entries/<int:eid>/settle', roles=(OWNER,))
def settle_entry(req):
    eid = integer(req.params['eid'], '挂账编号')
    entry = db.query_one('SELECT * FROM CreditEntry WHERE EntryID=?', (eid,))
    require(entry is not None, '挂账记录不存在', 404)
    require(entry['EntryType'] == 'charge', '只能核销挂账记录')
    remain = round(entry['Amount'] - entry['SettledAmount'], 2)
    require(remain > 0.001, '该笔挂账已结清')
    amount = num(req.f('amount') or remain, '收款金额', minimum=0.01)
    require(amount <= remain + 0.001, '收款金额不能大于未核销余额 %.2f' % remain)
    db.execute('UPDATE CreditEntry SET SettledAmount=SettledAmount+?, '
               'SettledAt=CASE WHEN SettledAmount+? >= Amount - 0.001 THEN ? ELSE SettledAt END '
               'WHERE EntryID=?', (amount, amount, now(), eid))
    db.insert('INSERT INTO CreditEntry (EntryNo, AccountID, RegisteredBy, EntryType, Amount, '
              'SettledAmount, DueDate, SettledAt, Remark) VALUES (?,?,?,?,?,0,?,?,?)',
              (doc_no('HX'), entry['AccountID'], req.employee['EmployeeID'], 'settle', amount,
               entry['DueDate'], now(), '收款核销 %s（%s）' % (entry['EntryNo'], req.f('payMethod') or '现金')))
    refresh_account(entry['AccountID'])
    refreshed = db.query_one('SELECT * FROM CreditEntry WHERE EntryID=?', (eid,))
    settled = round(refreshed['SettledAmount'], 2)
    write_audit(req, '核销赊账', 'CreditEntry', eid, '收款 %.2f，累计核销 %.2f' % (amount, settled))
    return ok({'message': '收款 %.2f 已登记，%s' % (amount, '该笔已结清' if settled >= entry['Amount'] - 0.001
                                                  else '剩余 %.2f 未核销' % (entry['Amount'] - settled)),
               'settledAmount': settled})


# --------------------------------------------------------------------------
# 会员与积分
# --------------------------------------------------------------------------
@api.get('/api/members', roles=(OWNER, SALESPERSON))
def list_members(req):
    days = req.qint('days', 30) or 30
    rows = db.rows_to_dict(db.query(
        'SELECT m.*, c.Name, c.Phone, '
        '(SELECT COUNT(*) FROM SaleOrder o WHERE o.CustomerID=c.CustomerID '
        ' AND o.OccurredAt >= date("now","localtime",?)) AS OrdersRecent, '
        '(SELECT ROUND(COALESCE(SUM(o.TotalAmount),0),2) FROM SaleOrder o WHERE o.CustomerID=c.CustomerID '
        ' AND o.OccurredAt >= date("now","localtime",?)) AS AmountRecent, '
        '(SELECT COUNT(*) FROM SaleOrder o WHERE o.CustomerID=c.CustomerID) AS OrdersTotal, '
        '(SELECT ROUND(COALESCE(SUM(o.TotalAmount),0),2) FROM SaleOrder o WHERE o.CustomerID=c.CustomerID) AS AmountTotal, '
        '(SELECT MAX(o.OccurredAt) FROM SaleOrder o WHERE o.CustomerID=c.CustomerID) AS LastOrderAt '
        'FROM Member m JOIN Customer c ON c.CustomerID=m.CustomerID WHERE m.RecordStatus="A" '
        'ORDER BY AmountRecent DESC, m.MemberID',
        ('-%d days' % days, '-%d days' % days)))
    total = len(rows)
    repurchase = len([r for r in rows if (r['OrdersRecent'] or 0) >= 2])
    active = len([r for r in rows if (r['OrdersRecent'] or 0) >= 1])
    return ok({'items': rows, 'summary': {
        'total': total, 'active': active, 'repurchase': repurchase,
        'repurchaseRate': round(repurchase / total * 100, 1) if total else 0,
        'activeRate': round(active / total * 100, 1) if total else 0,
        'points': round(sum(r['Points'] or 0 for r in rows), 0),
        'noVisit': len([r for r in rows if not r['OrdersRecent']]),
    }})


@api.post('/api/members', roles=(OWNER,))
def create_member(req):
    customer_id = integer(req.f('customerId'), '顾客', minimum=1)
    cust = db.query_one('SELECT * FROM Customer WHERE CustomerID=?', (customer_id,))
    require(cust is not None, '顾客不存在', 404)
    require(db.query_one('SELECT 1 FROM Member WHERE CustomerID=?', (customer_id,)) is None, '该顾客已经是会员')
    seq = db.scalar('SELECT COUNT(*) FROM Member') + 1
    mid = db.insert('INSERT INTO Member (MemberNo, CustomerID, JoinDate, Level, Points) VALUES (?,?,?,?,0)',
                    ('M%05d' % (20260 + seq), customer_id, today(), req.f('level') or '普通'))
    db.execute('UPDATE Customer SET IsMember="Y" WHERE CustomerID=?', (customer_id,))
    write_audit(req, '维护会员', 'Member', mid, cust['Name'])
    return ok({'memberId': mid, 'message': '会员已建档'})


@api.post('/api/members/<int:mid>/points', roles=(OWNER,))
def add_points(req):
    mid = integer(req.params['mid'], '会员编号')
    member = db.query_one('SELECT * FROM Member WHERE MemberID=?', (mid,))
    require(member is not None, '会员不存在', 404)
    entry_type = req.f('entryType') or 'earn'
    require(entry_type in ('earn', 'redeem'), '积分类型只能是 earn 或 redeem')
    points = num(req.f('points'), '积分', minimum=0.01)
    if entry_type == 'redeem':
        require(member['Points'] >= points, '会员可用积分不足（当前 %.0f）' % member['Points'])
        delta = -points
    else:
        delta = points
    db.insert('INSERT INTO PointEntry (MemberID, EntryType, Points, OccurredAt, Note) '
              'VALUES (?,?,?,?,?)', (mid, entry_type, points, now(), req.f('note')))
    db.execute('UPDATE Member SET Points=Points+? WHERE MemberID=?', (delta, mid))
    write_audit(req, '积分变动', 'Member', mid, '%s %s' % (entry_type, points))
    return ok({'message': '积分已%s %.0f' % ('兑换' if entry_type == 'redeem' else '累计', points)})


@api.get('/api/members/<int:mid>/points', roles=(OWNER, SALESPERSON))
def points_history(req):
    mid = integer(req.params['mid'], '会员编号')
    rows = db.rows_to_dict(db.query(
        'SELECT p.*, m.MemberNo, c.Name FROM PointEntry p JOIN Member m ON m.MemberID=p.MemberID '
        'JOIN Customer c ON c.CustomerID=m.CustomerID WHERE p.MemberID=? ORDER BY p.OccurredAt DESC', (mid,)))
    return ok({'items': rows})
