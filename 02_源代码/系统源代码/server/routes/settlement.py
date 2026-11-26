"""供应商对账（UC-02）、应付账款、付款登记（UC-07）。"""
from datetime import datetime, timedelta

from server import db
from server.core import (ALL_ROLES, OWNER, SUPPLIER, api, bad, doc_no, integer, money, now, num, ok,
                         require, text, today, write_audit)

SOURCE_LABEL = {'Receipt': '收货', 'Return': '退货', 'Expense': '费用'}


def our_side_rows(supplier_id, start, end):
    """本方口径：收货、退货、费用三类凭证。"""
    rows = []
    receipts = db.query(
        'SELECT n.ReceiptID AS id, n.ReceiptNo AS no, date(n.ReceivedAt) AS d, '
        'ROUND(SUM(r.ReceivedQty * r.PurchasePrice),2) AS amt '
        'FROM ReceiptNote n JOIN ReceiptLine r ON r.ReceiptID=n.ReceiptID '
        'WHERE n.SupplierID=? AND date(n.ReceivedAt) BETWEEN ? AND ? GROUP BY n.ReceiptID',
        (supplier_id, start, end))
    for r in receipts:
        rows.append({'sourceType': 'Receipt', 'sourceDocId': r['id'], 'sourceDocNo': r['no'],
                     'occurredDate': r['d'], 'ourAmount': round(r['amt'] or 0, 2)})
    returns = db.query(
        'SELECT ReturnID AS id, ReturnNo AS no, date(ReturnedAt) AS d, Amount AS amt FROM ReturnNote '
        'WHERE SupplierID=? AND Status="Confirmed" AND date(ReturnedAt) BETWEEN ? AND ?',
        (supplier_id, start, end))
    for r in returns:
        rows.append({'sourceType': 'Return', 'sourceDocId': r['id'], 'sourceDocNo': r['no'],
                     'occurredDate': r['d'], 'ourAmount': -round(r['amt'] or 0, 2)})
    expenses = db.query(
        'SELECT ExpenseID AS id, ExpenseNo AS no, date(OccurredAt) AS d, Amount AS amt '
        'FROM ExpenseNote WHERE SupplierID=? AND Status="Confirmed" AND date(OccurredAt) BETWEEN ? AND ?',
        (supplier_id, start, end))
    for r in expenses:
        rows.append({'sourceType': 'Expense', 'sourceDocId': r['id'], 'sourceDocNo': r['no'],
                     'occurredDate': r['d'], 'ourAmount': -round(r['amt'] or 0, 2)})
    return rows


@api.get('/api/statements', roles=(OWNER, SUPPLIER))
def list_statements(req):
    page, size = req.page_args(15)
    where = ['1=1']
    params = []
    status = req.q('status')
    if status in ('Submitted', 'Disputed', 'Confirmed', 'Cancelled'):
        where.append('s.StatementStatus=?')
        params.append(status)
    if req.qint('supplierId'):
        where.append('s.SupplierID=?')
        params.append(req.qint('supplierId'))
    if req.role() == SUPPLIER and req.employee['SupplierID']:
        where.append('s.SupplierID=?')
        params.append(req.employee['SupplierID'])
    cond = ' AND '.join(where)
    total = db.scalar('SELECT COUNT(*) FROM Statement s WHERE ' + cond, params)
    rows = db.query(
        'SELECT s.*, sp.Name AS SupplierName, e.Name AS ConfirmerName, '
        '(SELECT COUNT(*) FROM StatementLine l WHERE l.StatementID=s.StatementID) AS LineCount, '
        '(SELECT COUNT(*) FROM StatementLine l WHERE l.StatementID=s.StatementID '
        ' AND ABS(l.DiffAmount) > 0.001) AS DiffLines '
        'FROM Statement s JOIN Supplier sp ON sp.SupplierID=s.SupplierID '
        'LEFT JOIN Employee e ON e.EmployeeID=s.ConfirmedBy '
        'WHERE ' + cond + ' ORDER BY s.PeriodEnd DESC, s.StatementID DESC LIMIT ? OFFSET ?',
        params + [size, (page - 1) * size])
    if req.role() == SUPPLIER:
        own = req.employee['SupplierID']
        summary = {
            'pending': db.scalar("SELECT COUNT(*) FROM Statement WHERE SupplierID=? "
                                 "AND StatementStatus IN ('Submitted','Disputed')", (own,)),
            'diffTotal': db.scalar("SELECT ROUND(COALESCE(SUM(ABS(DiffAmount)),0),2) FROM Statement "
                                   "WHERE SupplierID=? AND StatementStatus IN ('Submitted','Disputed')", (own,)),
        }
    else:
        summary = {
            'pending': db.scalar("SELECT COUNT(*) FROM Statement WHERE StatementStatus IN ('Submitted','Disputed')"),
            'payable': db.scalar("SELECT ROUND(COALESCE(SUM(PayableAmount - PaidAmount),0),2) "
                                 "FROM AccountPayable WHERE PayableStatus IN ('Open','Partial')"),
            'diffTotal': db.scalar("SELECT ROUND(COALESCE(SUM(ABS(DiffAmount)),0),2) FROM Statement "
                                   "WHERE StatementStatus IN ('Submitted','Disputed')"),
        }
    return ok({'items': db.rows_to_dict(rows), 'total': total, 'page': page, 'size': size,
               'summary': summary})


@api.get('/api/statements/<int:sid>', roles=(OWNER, SUPPLIER))
def statement_detail(req):
    sid = integer(req.params['sid'], '对账单编号')
    head = db.query_one(
        'SELECT s.*, sp.Name AS SupplierName, sp.Contact, sp.Phone, e.Name AS ConfirmerName, '
        'sub.Name AS SubmitterName FROM Statement s JOIN Supplier sp ON sp.SupplierID=s.SupplierID '
        'LEFT JOIN Employee e ON e.EmployeeID=s.ConfirmedBy '
        'LEFT JOIN Employee sub ON sub.EmployeeID=s.SubmittedBy WHERE s.StatementID=?', (sid,))
    require(head is not None, '对账单不存在', 404)
    if req.role() == SUPPLIER:
        require(head['SupplierID'] == req.employee['SupplierID'], '只能查看本公司的对账单', 403)
    lines = db.rows_to_dict(db.query(
        'SELECT * FROM StatementLine WHERE StatementID=? ORDER BY LineNo', (sid,)))
    for line in lines:
        line['sourceLabel'] = SOURCE_LABEL.get(line['SourceType'], line['SourceType'])
    payable = db.query_one('SELECT * FROM AccountPayable WHERE StatementID=?', (sid,))
    payments = db.rows_to_dict(db.query(
        'SELECT p.*, a.PayableNo FROM PaymentRecord p JOIN AccountPayable a ON a.PayableID=p.PayableID '
        'WHERE a.StatementID=? ORDER BY p.PaidAt', (sid,)))
    return ok({'statement': db.row_to_dict(head), 'lines': lines,
               'payable': db.row_to_dict(payable), 'payments': payments})


@api.get('/api/statements/preview', roles=(OWNER, SUPPLIER))
def statement_preview(req):
    """生成本方口径的对账明细，供新建对账单时预填。"""
    supplier_id = req.qint('supplierId')
    if req.role() == SUPPLIER:
        supplier_id = req.employee['SupplierID']  # 供货商只能预览本公司口径
    require(supplier_id, '请先选择供应商')
    end = req.q('periodEnd') or (datetime.now().replace(day=1) - timedelta(days=1)).strftime('%Y-%m-%d')
    start = req.q('periodStart') or end[:8] + '01'
    rows = our_side_rows(supplier_id, start, end)
    for row in rows:
        row['counterpartyAmount'] = row['ourAmount']
        row['label'] = SOURCE_LABEL.get(row['sourceType'], row['sourceType'])
    total = round(sum(r['ourAmount'] for r in rows), 2)
    return ok({'items': rows, 'periodStart': start, 'periodEnd': end,
               'ourAmount': total, 'count': len(rows)})


@api.post('/api/statements', roles=(OWNER, SUPPLIER))
def create_statement(req):
    data = req.body
    supplier_id = integer(data.get('supplierId'), '供应商', minimum=1)
    if req.role() == SUPPLIER:
        require(req.employee['SupplierID'] == supplier_id, '只能提交本公司的对账单', 403)
    sup = db.query_one('SELECT * FROM Supplier WHERE SupplierID=?', (supplier_id,))
    require(sup is not None, '供应商不存在', 404)
    start = text(data.get('periodStart'), '对账期间起', maxlen=20)
    end = text(data.get('periodEnd'), '对账期间止', maxlen=20)
    require(start <= end, '对账期间起止顺序不正确')
    dup = db.query_one('SELECT 1 FROM Statement WHERE SupplierID=? AND PeriodStart=? AND PeriodEnd=? '
                       'AND StatementStatus<>"Cancelled"', (supplier_id, start, end))
    require(dup is None, '该供应商本期已有对账单，请勿重复提交（如需更正应追加调整记录）')
    ours = our_side_rows(supplier_id, start, end)
    counterparty = data.get('lines')
    if counterparty is None:
        cp_map = {r['sourceDocNo']: r['ourAmount'] for r in ours}
        extra = []
    else:
        cp_map = {}
        extra = []
        for line in counterparty:
            doc = (line.get('sourceDocNo') or '').strip()
            amt = num(line.get('amount') or 0, '对方金额')
            if doc:
                cp_map[doc] = round(amt, 2)
            else:
                extra.append({'sourceType': line.get('sourceType') or 'Receipt', 'sourceDocNo': '—',
                              'occurredDate': line.get('occurredDate') or end,
                              'amount': round(amt, 2)})
    our_amount_total = round(sum(r['ourAmount'] for r in ours), 2)
    cp_total = round(sum(cp_map.values()) + sum(e['amount'] for e in extra), 2)
    diff = round(cp_total - our_amount_total, 2)
    pay_days = db.scalar('SELECT PaymentTermDays FROM SettlementTerm WHERE SupplierID=? AND RecordStatus="A"',
                         (supplier_id,), 30)
    statement_no = doc_no('DZ')
    sid = db.insert(
        'INSERT INTO Statement (StatementNo, SupplierID, PeriodStart, PeriodEnd, SubmittedBy, '
        'SubmittedAt, StatementStatus, PurchaseAmount, ReturnAmount, ExpenseAmount, CounterpartyAmount, '
        'OurAmount, DiffAmount, PayableAmount, Note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (statement_no, supplier_id, start, end, req.employee['EmployeeID'], now(), 'Submitted',
         round(sum(r['ourAmount'] for r in ours if r['sourceType'] == 'Receipt'), 2),
         round(sum(-r['ourAmount'] for r in ours if r['sourceType'] == 'Return'), 2),
         round(sum(-r['ourAmount'] for r in ours if r['sourceType'] == 'Expense'), 2),
         cp_total, our_amount_total, diff, round(our_amount_total, 2), data.get('note')))
    line_no = 0
    for row in ours:
        line_no += 1
        cp_amt = cp_map.get(row['sourceDocNo'], 0.0)
        line_diff = round(cp_amt - row['ourAmount'], 2)
        reason = None
        if abs(line_diff) > 0.001:
            reason = ('对方提交的金额与本方记录不一致' if row['sourceDocNo'] in cp_map
                      else '对方对账单未列此笔，可能漏记')
        db.execute('INSERT INTO StatementLine (StatementID, LineNo, SourceType, SourceDocID, SourceDocNo, '
                   'OccurredDate, CounterpartyAmount, OurAmount, DiffAmount, DiffReason, DisputedFlag) '
                   'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                   (sid, line_no, row['sourceType'], row['sourceDocId'], row['sourceDocNo'],
                    row['occurredDate'], cp_amt, row['ourAmount'], line_diff, reason,
                    'Y' if abs(line_diff) > 0.001 else 'N'))
    for e in extra:
        line_no += 1
        db.execute('INSERT INTO StatementLine (StatementID, LineNo, SourceType, SourceDocID, SourceDocNo, '
                   'OccurredDate, CounterpartyAmount, OurAmount, DiffAmount, DiffReason, DisputedFlag) '
                   'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                   (sid, line_no, e['sourceType'], None, e['sourceDocNo'], e['occurredDate'],
                    e['amount'], 0, round(e['amount'], 2), '本方无此笔进货记录（历史未入账或对方多计）', 'Y'))
    write_audit(req, '提交对账单', 'Statement', sid,
                '%s 期间 %s~%s，对方 %.2f，本方 %.2f，差异 %.2f' %
                (statement_no, start, end, cp_total, our_amount_total, diff))
    return ok({'statementId': sid, 'statementNo': statement_no, 'counterpartyAmount': cp_total,
               'ourAmount': our_amount_total, 'diffAmount': diff, 'lines': line_no,
               'payable': round(our_amount_total, 2),
               'message': '对账单已提交，系统已逐项比对本方进货、退货与费用记录'})


@api.post('/api/statements/<int:sid>/lines/<int:line_id>', roles=(OWNER, SUPPLIER))
def resolve_line(req):
    sid = integer(req.params['sid'], '对账单编号')
    line_id = integer(req.params['line_id'], '对账明细编号')
    head = db.query_one('SELECT * FROM Statement WHERE StatementID=?', (sid,))
    require(head is not None, '对账单不存在', 404)
    require(head['StatementStatus'] in ('Submitted', 'Disputed'), '对账已确认，不能再改（更正须追加调整记录）')
    if req.role() == SUPPLIER:
        require(head['SupplierID'] == req.employee['SupplierID'], '只能答复本公司的对账单', 403)
    line = db.query_one('SELECT * FROM StatementLine WHERE StatementLineID=? AND StatementID=?', (line_id, sid))
    require(line is not None, '对账明细不存在', 404)
    data = req.body
    cp = data.get('counterpartyAmount')
    resolution = text(data.get('resolution'), '答复/处理意见', required=False, maxlen=200)
    disputed = data.get('disputedFlag')
    voucher = data.get('voucher')
    if cp is not None and req.employee['Role'] == OWNER:
        cp = num(cp, '对方金额', minimum=-999999)
        db.execute('UPDATE StatementLine SET CounterpartyAmount=?, DiffAmount=?, Resolution=?, Voucher=? '
                   'WHERE StatementLineID=?',
                   (round(cp, 2), round(cp - line['OurAmount'], 2), resolution or line['Resolution'],
                    voucher or line['Voucher'], line_id))
    else:
        db.execute('UPDATE StatementLine SET Resolution=?, Voucher=?, DisputedFlag=? WHERE StatementLineID=?',
                   (resolution or line['Resolution'], voucher or line['Voucher'],
                    disputed or line['DisputedFlag'], line_id))
    # 重算头表
    agg = db.query_one('SELECT ROUND(COALESCE(SUM(CounterpartyAmount),0),2) AS cp, '
                       'ROUND(COALESCE(SUM(OurAmount),0),2) AS our, '
                       'ROUND(COALESCE(SUM(DiffAmount),0),2) AS diff, '
                       'SUM(CASE WHEN ABS(DiffAmount) > 0.001 THEN 1 ELSE 0 END) AS diffs '
                       'FROM StatementLine WHERE StatementID=? ', (sid,))
    db.execute('UPDATE Statement SET CounterpartyAmount=?, OurAmount=?, DiffAmount=?, PayableAmount=? '
               'WHERE StatementID=?', (agg['cp'], agg['our'], agg['diff'],
                                       round(agg['our'], 2), sid))
    write_audit(req, '处理对账差异', 'StatementLine', line_id, resolution or '')
    return ok({'message': '差异处理意见已保存', 'diffAmount': agg['diff'], 'diffLines': agg['diffs']})


@api.post('/api/statements/<int:sid>/confirm', roles=(OWNER,))
def confirm_statement(req):
    sid = integer(req.params['sid'], '对账单编号')
    head = db.query_one('SELECT * FROM Statement WHERE StatementID=?', (sid,))
    require(head is not None, '对账单不存在', 404)
    require(head['StatementStatus'] in ('Submitted', 'Disputed'), '对账单已确认')
    unresolved = db.scalar('SELECT COUNT(*) FROM StatementLine WHERE StatementID=? AND ABS(DiffAmount) > 0.001 '
                           'AND (DisputedFlag="Y" OR Resolution IS NULL OR Resolution="")', (sid,))
    hold_dispute = (req.f('holdDispute') in (True, 'true', 1))
    if unresolved and not hold_dispute:
        bad('还有 %d 处差异未答复（可勾选“争议项挂起，按无争议部分生成应付”）' % unresolved)
    # 无争议部分：本方金额 - 争议项的本方金额
    disputed_our = db.scalar('SELECT ROUND(COALESCE(SUM(OurAmount),0),2) FROM StatementLine '
                             'WHERE StatementID=? AND DisputedFlag="Y"', (sid,))
    payable = round((head['OurAmount'] or 0) - (disputed_our or 0), 2) if hold_dispute else \
        round(head['OurAmount'] or 0, 2)
    term = db.scalar('SELECT PaymentTermDays FROM SettlementTerm WHERE SupplierID=? AND RecordStatus="A"',
                     (head['SupplierID'],), 30)
    planned = (datetime.strptime(head['PeriodEnd'][:10], '%Y-%m-%d') + timedelta(days=term)).strftime('%Y-%m-%d')
    db.execute('UPDATE Statement SET StatementStatus="Confirmed", ConfirmedBy=?, ConfirmedAt=?, '
               'PayableAmount=? WHERE StatementID=?',
               (req.employee['EmployeeID'], now(), payable, sid))
    pid = db.insert('INSERT INTO AccountPayable (PayableNo, SupplierID, StatementID, PaymentTermDays, '
                    'PlannedPayDate, PayableAmount, PaidAmount, PayableStatus) VALUES (?,?,?,?,?,?,0,"Open")',
                    (doc_no('YF'), head['SupplierID'], sid, term, planned, payable))
    write_audit(req, '确认对账', 'Statement', sid, '应付 %.2f，计划付款 %s' % (payable, planned))
    return ok({'message': '对账已确认，应付账款 %.2f 元，计划 %s 结算' % (payable, planned),
               'payableId': pid, 'payable': payable, 'plannedPayDate': planned,
               'heldDispute': round(disputed_our or 0, 2) if hold_dispute else 0})


@api.post('/api/statements/<int:sid>/cancel', roles=(OWNER,))
def cancel_statement(req):
    sid = integer(req.params['sid'], '对账单编号')
    head = db.query_one('SELECT * FROM Statement WHERE StatementID=?', (sid,))
    require(head is not None, '对账单不存在', 404)
    require(head['StatementStatus'] in ('Submitted', 'Disputed'), '已确认的对账单不能作废')
    db.execute('UPDATE Statement SET StatementStatus="Cancelled", Note=COALESCE(Note,"") || ? WHERE StatementID=?',
               (' / 作废：' + (req.f('reason') or ''), sid))
    write_audit(req, '作废对账单', 'Statement', sid, req.f('reason') or '')
    return ok({'message': '对账单已作废（不物理删除）'})


# --------------------------------------------------------------------------
# 应付与付款
# --------------------------------------------------------------------------
@api.get('/api/payables', roles=(OWNER,))
def list_payables(req):
    where = ['1=1']
    params = []
    if req.q('status') in ('Open', 'Partial', 'Closed'):
        where.append('a.PayableStatus=?')
        params.append(req.q('status'))
    if req.q('overdue') == '1':
        where.append('a.PlannedPayDate < date("now","localtime") AND a.PayableStatus IN ("Open","Partial")')
    if req.role() == SUPPLIER and req.employee['SupplierID']:
        where.append('a.SupplierID=?')
        params.append(req.employee['SupplierID'])
    rows = db.query(
        'SELECT a.*, s.Name AS SupplierName, st.StatementNo, st.PeriodStart, st.PeriodEnd, '
        'ROUND(a.PayableAmount - a.PaidAmount,2) AS Remain, '
        'CAST(julianday(date("now","localtime")) - julianday(a.PlannedPayDate) AS INTEGER) AS OverdueDays '
        'FROM AccountPayable a JOIN Supplier s ON s.SupplierID=a.SupplierID '
        'LEFT JOIN Statement st ON st.StatementID=a.StatementID WHERE ' + ' AND '.join(where) +
        ' ORDER BY a.PlannedPayDate ASC', params)
    items = db.rows_to_dict(rows)
    return ok({'items': items, 'summary': {
        'open': round(sum(i['Remain'] or 0 for i in items if i['PayableStatus'] in ('Open', 'Partial')), 2),
        'overdue': round(sum(i['Remain'] or 0 for i in items if (i['OverdueDays'] or 0) > 0
                             and i['PayableStatus'] in ('Open', 'Partial')), 2),
        'count': len([i for i in items if i['PayableStatus'] in ('Open', 'Partial')]),
    }})


@api.post('/api/payments', roles=(OWNER,))
def create_payment(req):
    payable_id = integer(req.f('payableId'), '应付账款', minimum=1)
    pay = db.query_one('SELECT a.*, s.Name AS SupplierName FROM AccountPayable a '
                       'JOIN Supplier s ON s.SupplierID=a.SupplierID WHERE a.PayableID=?', (payable_id,))
    require(pay is not None, '应付账款不存在', 404)
    require(pay['PayableStatus'] in ('Open', 'Partial'), '该笔应付已结清')
    remain = round(pay['PayableAmount'] - pay['PaidAmount'], 2)
    amount = num(req.f('amount'), '付款金额', minimum=0.01)
    require(amount <= remain + 0.001, '付款金额不能大于应付余额 %.2f' % remain)
    method = text(req.f('method'), '付款方式', maxlen=20)
    paid_at = req.f('paidAt') or now()
    pay_no = doc_no('FK')
    db.insert('INSERT INTO PaymentRecord (PayNo, PayableID, Amount, Method, PaidAt, RegisteredBy, Note) '
              'VALUES (?,?,?,?,?,?,?)',
              (pay_no, payable_id, amount, method, paid_at, req.employee['EmployeeID'], req.f('note')))
    paid_total = round(pay['PaidAmount'] + amount, 2)
    status = 'Closed' if paid_total >= pay['PayableAmount'] - 0.001 else 'Partial'
    db.execute('UPDATE AccountPayable SET PaidAmount=?, PayableStatus=? WHERE PayableID=?',
               (paid_total, status, payable_id))
    write_audit(req, '登记货款结算', 'AccountPayable', payable_id,
                '%s 付款 %.2f（%s），%s' % (pay_no, amount, method, '已结清' if status == 'Closed' else '部分付款'))
    return ok({'paymentNo': pay_no, 'paidTotal': paid_total, 'status': status,
               'message': '付款已登记，%s' % ('应付账款已结清' if status == 'Closed'
                                          else '剩余应付 %.2f 元' % (pay['PayableAmount'] - paid_total))})


@api.get('/api/payments', roles=(OWNER,))
def list_payments(req):
    rows = db.query(
        'SELECT p.*, a.PayableNo, a.SupplierID, s.Name AS SupplierName, e.Name AS RegisterName '
        'FROM PaymentRecord p JOIN AccountPayable a ON a.PayableID=p.PayableID '
        'JOIN Supplier s ON s.SupplierID=a.SupplierID '
        'LEFT JOIN Employee e ON e.EmployeeID=p.RegisteredBy ORDER BY p.PaidAt DESC LIMIT 100')
    return ok({'items': db.rows_to_dict(rows)})


@api.get('/api/expenses', roles=(OWNER,))
def list_expenses(req):
    rows = db.query(
        'SELECT x.*, s.Name AS SupplierName, e.Name AS RegisterName FROM ExpenseNote x '
        'JOIN Supplier s ON s.SupplierID=x.SupplierID '
        'LEFT JOIN Employee e ON e.EmployeeID=x.RegisteredBy ORDER BY x.OccurredAt DESC LIMIT 100')
    return ok({'items': db.rows_to_dict(rows)})


@api.post('/api/expenses', roles=(OWNER,))
def create_expense(req):
    supplier_id = integer(req.f('supplierId'), '供应商', minimum=1)
    etype = text(req.f('expenseType'), '费用项目', maxlen=32)
    amount = num(req.f('amount'), '费用金额', minimum=0.01)
    period = text(req.f('period'), '费用期间', maxlen=10)
    eid = db.insert('INSERT INTO ExpenseNote (ExpenseNo, SupplierID, ExpenseType, Amount, Period, '
                    'Voucher, RegisteredBy, OccurredAt, Status) VALUES (?,?,?,?,?,?,?,?,?)',
                    (doc_no('FY'), supplier_id, etype, amount, period, req.f('voucher'),
                     req.employee['EmployeeID'], now(), 'Confirmed'))
    write_audit(req, '登记费用', 'ExpenseNote', eid, '%s %.2f' % (etype, amount))
    return ok({'expenseId': eid, 'message': '费用已登记，将参与对账扣减'})
