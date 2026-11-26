"""临期处理（UC-01）、报损（UC-06）、退货（UC-07）。"""
from datetime import datetime, timedelta

from server import db
from server.core import (ALL_ROLES, OWNER, STOCKER, api, bad, doc_no, integer, money, now, num, ok,
                         require, text, today, write_audit)
from server.routes.dashboard import expiry_rows


@api.get('/api/expiry/warnings', roles=(OWNER, STOCKER))
def warnings(req):
    level = req.q('level')
    items = expiry_rows(level=level if level in ('expired', 'urgent', 'warn') else None)
    summary = {
        'total': len(items),
        'expired': len([i for i in items if i['level'] == 'expired']),
        'urgent': len([i for i in items if i['level'] == 'urgent']),
        'warn': len([i for i in items if i['level'] == 'warn']),
        'value': round(sum(i['stockValue'] for i in items), 2),
    }
    # 今日已生成的处理单
    handling = db.scalar("SELECT COUNT(*) FROM ExpiryHandling WHERE date(HandledAt)=date('now','localtime')")
    return ok({'items': items, 'summary': summary, 'todayHandling': handling})


@api.get('/api/expiry/handling', roles=(OWNER, STOCKER))
def list_handling(req):
    page, size = req.page_args(15)
    total = db.scalar('SELECT COUNT(*) FROM ExpiryHandling')
    rows = db.query(
        'SELECT h.*, e.Name AS HandlerName, '
        '(SELECT COUNT(*) FROM HandlingLine l WHERE l.HandlingID=h.HandlingID) AS LineCount, '
        '(SELECT ROUND(COALESCE(SUM(p.MarkdownPrice * 1),0),2) FROM MarkdownPlan p '
        ' WHERE p.HandlingID=h.HandlingID) AS MarkdownPlanCount, '
        '(SELECT COUNT(*) FROM MarkdownPlan p WHERE p.HandlingID=h.HandlingID AND p.PlanStatus="Pending") '
        'AS PendingPlans '
        'FROM ExpiryHandling h LEFT JOIN Employee e ON e.EmployeeID=h.HandledBy '
        'ORDER BY h.HandledAt DESC LIMIT ? OFFSET ?', (size, (page - 1) * size))
    return ok({'items': db.rows_to_dict(rows), 'total': total, 'page': page, 'size': size})


@api.get('/api/expiry/handling/<int:hid>', roles=(OWNER, STOCKER))
def handling_detail(req):
    hid = integer(req.params['hid'], '处理单编号')
    head = db.query_one('SELECT h.*, e.Name AS HandlerName FROM ExpiryHandling h '
                        'LEFT JOIN Employee e ON e.EmployeeID=h.HandledBy WHERE h.HandlingID=?', (hid,))
    require(head is not None, '处理单不存在', 404)
    lines = db.rows_to_dict(db.query(
        'SELECT l.*, p.ProductName, p.Specification, p.Unit, p.ListPrice, b.BatchNo, b.ExpiryDate, '
        'b.PurchasePrice, CAST(julianday(b.ExpiryDate)-julianday(date("now","localtime")) AS INTEGER) AS RemainDays, '
        'c.CategoryName FROM HandlingLine l JOIN Product p ON p.ProductID=l.ProductID '
        'JOIN PurchaseBatch b ON b.BatchID=l.BatchID JOIN ProductCategory c ON c.CategoryID=p.CategoryID '
        'WHERE l.HandlingID=? ORDER BY l.LineNo', (hid,)))
    plans = db.rows_to_dict(db.query(
        'SELECT p.*, e.Name AS ConfirmerName FROM MarkdownPlan p '
        'LEFT JOIN Employee e ON e.EmployeeID=p.ConfirmedBy WHERE p.HandlingID=? ORDER BY p.LineNo', (hid,)))
    return ok({'handling': db.row_to_dict(head), 'lines': lines, 'plans': plans})


@api.post('/api/expiry/handling', roles=(OWNER, STOCKER))
def create_handling(req):
    data = req.body
    lines = data.get('lines') or []
    require(isinstance(lines, list) and lines, '请先勾选要挑出的临期商品')
    handling_no = doc_no('LX')
    hid = db.insert('INSERT INTO ExpiryHandling (HandlingNo, HandledBy, HandledAt, Status, Note) '
                    'VALUES (?,?,?,?,?)', (handling_no, req.employee['EmployeeID'], now(), 'Draft',
                                           data.get('note')))
    line_no = 0
    plan_count = 0
    for line in lines:
        pid = integer(line.get('productId'), '商品编号', minimum=1)
        bid = integer(line.get('batchId'), '批次编号', minimum=1)
        picked = num(line.get('pickedQty'), '挑出数量', minimum=0.001)
        batch = db.query_one('SELECT b.*, p.ProductName, p.ListPrice, p.CategoryID, p.Unit '
                             'FROM PurchaseBatch b JOIN Product p ON p.ProductID=b.ProductID '
                             'WHERE b.BatchID=?', (bid,))
        require(batch is not None, '批次不存在')
        ledger = db.query_one('SELECT * FROM StockLedger WHERE ProductID=? AND BatchID=?', (pid, bid))
        require(ledger is not None and ledger['Quantity'] >= picked - 0.001,
                '「%s」挑出数量超过现存数量' % batch['ProductName'])
        htype = line.get('handlingType') or 'Markdown'
        require(htype in ('Markdown', 'Return', 'Loss'), '处理方式只能是折价/退货/报损')
        line_no += 1
        db.execute('INSERT INTO HandlingLine (HandlingID, LineNo, ProductID, BatchID, PickedQty, '
                   'HandlingType) VALUES (?,?,?,?,?,?)', (hid, line_no, pid, bid, picked, htype))
        if htype == 'Markdown':
            rule = db.query_one(
                'SELECT * FROM MarkdownRule WHERE RecordStatus="A" AND CategoryID=? '
                'ORDER BY RemainDaysTo ASC LIMIT 1', (batch['CategoryID'],))
            rate = rule['DiscountRate'] if rule else 0.8
            trigger = rule['TriggerTime'] if rule else '18:00'
            plan_count += 1
            db.execute('INSERT INTO MarkdownPlan (HandlingID, LineNo, RuleID, MarkdownTime, '
                       'DiscountRate, MarkdownPrice, PlanStatus) VALUES (?,?,?,?,?,?,?)',
                       (hid, line_no, rule['RuleID'] if rule else None,
                        today() + ' ' + trigger, rate, money((batch['ListPrice'] or 0) * rate),
                        'Pending'))
    db.execute('UPDATE ExpiryHandling SET Status="WaitingApproval" WHERE HandlingID=?', (hid,))
    write_audit(req, '处理临期商品', 'ExpiryHandling', hid,
                '%s 挑出 %d 行，折价方案 %d 条待确认' % (handling_no, line_no, plan_count))
    return ok({'handlingId': hid, 'handlingNo': handling_no, 'lines': line_no,
               'plans': plan_count,
               'message': '处理单已生成，折价方案已提请老板确认'})


@api.post('/api/expiry/handling/<int:hid>/execute', roles=(OWNER, STOCKER))
def execute_line(req):
    """执行处理结果：折价执行 / 退回供货商 / 转报损（报损须老板确认后入账）。"""
    hid = integer(req.params['hid'], '处理单编号')
    line_no = integer(req.f('lineNo'), '行号', minimum=1)
    line = db.query_one('SELECT l.*, p.ProductName, p.Unit, p.ListPrice, b.PurchasePrice '
                        'FROM HandlingLine l JOIN Product p ON p.ProductID=l.ProductID '
                        'JOIN PurchaseBatch b ON b.BatchID=l.BatchID '
                        'WHERE l.HandlingID=? AND l.LineNo=?', (hid, line_no))
    require(line is not None, '处理明细不存在', 404)
    htype = line['HandlingType']
    picked = line['PickedQty']
    ledger = db.query_one('SELECT * FROM StockLedger WHERE ProductID=? AND BatchID=?',
                          (line['ProductID'], line['BatchID']))
    if htype == 'Markdown':
        db.execute('UPDATE MarkdownPlan SET PriceTagStatus="Applied" WHERE HandlingID=? AND LineNo=?',
                   (hid, line_no))
        db.execute('UPDATE HandlingLine SET Result=? WHERE HandlingID=? AND LineNo=?',
                   ('已折价执行（新价签已上架）', hid, line_no))
        msg = '折价已执行，价签已更新'
    elif htype == 'Return':
        sup = db.query_one('SELECT SupplierID FROM PurchaseBatch WHERE BatchID=?', (line['BatchID'],))
        rno = doc_no('TH')
        db.insert('INSERT INTO ReturnNote (ReturnNo, SupplierID, ProductID, BatchID, Quantity, UnitPrice, '
                  'Amount, Reason, ReturnedAt, Status) VALUES (?,?,?,?,?,?,?,?,?,?)',
                  (rno, sup['SupplierID'], line['ProductID'], line['BatchID'], picked,
                   line['PurchasePrice'], money(picked * line['PurchasePrice']),
                   '临期按合同比例退回', now(), 'Confirmed'))
        db.execute('UPDATE StockLedger SET Quantity=MAX(0, Quantity-?), UpdatedAt=? '
                   'WHERE ProductID=? AND BatchID=?', (picked, now(), line['ProductID'], line['BatchID']))
        db.execute('INSERT INTO StockMovement (ProductID, BatchID, MoveType, Quantity, RefType, RefNo, '
                   'OccurredAt, OperatorID, Note) VALUES (?,?,?,?,?,?,?,?,?)',
                   (line['ProductID'], line['BatchID'], 'Return', -picked, 'ReturnNote', rno, now(),
                    req.employee['EmployeeID'], '临期退回供货商'))
        db.execute('UPDATE HandlingLine SET Result=? WHERE HandlingID=? AND LineNo=?',
                   ('已退回供货商 %s' % rno, hid, line_no))
        msg = '退货单 %s 已生成，库存已扣减' % rno
    else:
        lno = doc_no('BS')
        db.insert('INSERT INTO LossReport (LossNo, ProductID, BatchID, Quantity, Reason, Amount, '
                  'RegisteredBy, RegisteredAt, Status) VALUES (?,?,?,?,?,?,?,?,?)',
                  (lno, line['ProductID'], line['BatchID'], picked, '临期下架报损',
                   money(picked * line['PurchasePrice']), req.employee['EmployeeID'], now(), 'Pending'))
        db.execute('UPDATE HandlingLine SET Result=? WHERE HandlingID=? AND LineNo=?',
                   ('已登记报损 %s（待老板确认）' % lno, hid, line_no))
        msg = '报损单 %s 已登记，待老板确认后入账' % lno
    # 全部行都处理完则关闭处理单
    remain = db.scalar('SELECT COUNT(*) FROM HandlingLine WHERE HandlingID=? AND Result IS NULL', (hid,))
    if remain == 0:
        db.execute('UPDATE ExpiryHandling SET Status="Completed" WHERE HandlingID=?', (hid,))
    write_audit(req, '执行临期处理', 'HandlingLine', '%s-%s' % (hid, line_no), msg)
    return ok({'message': msg})


@api.get('/api/expiry/markdown-plans', roles=(OWNER, STOCKER))
def list_plans(req):
    status = req.q('status')
    where = ['1=1']
    params = []
    if status in ('Pending', 'Confirmed', 'Rejected'):
        where.append('p.PlanStatus=?')
        params.append(status)
    rows = db.query(
        'SELECT p.*, h.HandlingNo, h.HandledAt, l.ProductID, l.PickedQty, l.HandlingType, '
        'pr.ProductName, pr.Specification, pr.Unit, pr.ListPrice, pr.CategoryID, c.CategoryName, '
        'b.BatchNo, b.ExpiryDate, CAST(julianday(b.ExpiryDate)-julianday(date("now","localtime")) AS INTEGER) AS RemainDays, '
        'e.Name AS ConfirmerName '
        'FROM MarkdownPlan p JOIN ExpiryHandling h ON h.HandlingID=p.HandlingID '
        'JOIN HandlingLine l ON l.HandlingID=p.HandlingID AND l.LineNo=p.LineNo '
        'JOIN Product pr ON pr.ProductID=l.ProductID JOIN ProductCategory c ON c.CategoryID=pr.CategoryID '
        'JOIN PurchaseBatch b ON b.BatchID=l.BatchID LEFT JOIN Employee e ON e.EmployeeID=p.ConfirmedBy '
        'WHERE ' + ' AND '.join(where) + ' ORDER BY p.PlanStatus="Pending" DESC, p.MarkdownTime DESC LIMIT 100',
        params)
    return ok({'items': db.rows_to_dict(rows), 'pending': db.scalar(
        "SELECT COUNT(*) FROM MarkdownPlan WHERE PlanStatus='Pending'")})


@api.post('/api/expiry/markdown-plans/<int:pid>/decision', roles=(OWNER,))
def decide_plan(req):
    pid = integer(req.params['pid'], '折价方案编号')
    plan = db.query_one('SELECT * FROM MarkdownPlan WHERE PlanID=?', (pid,))
    require(plan is not None, '折价方案不存在', 404)
    require(plan['PlanStatus'] == 'Pending', '方案已处理，不能重复确认')
    decision = (req.f('decision') or 'confirm').strip()
    if decision == 'confirm':
        rate = req.f('discountRate')
        price = plan['MarkdownPrice']
        if rate is not None and rate != '':
            r = num(rate, '折扣率', minimum=0.01)
            require(r <= 1, '折扣率不能大于 1')
            line = db.query_one('SELECT p.ListPrice FROM HandlingLine l JOIN Product p '
                                'ON p.ProductID=l.ProductID WHERE l.HandlingID=? AND l.LineNo=?',
                                (plan['HandlingID'], plan['LineNo']))
            price = money((line['ListPrice'] if line else 0) * r)
            db.execute('UPDATE MarkdownPlan SET DiscountRate=?, MarkdownPrice=? WHERE PlanID=?',
                       (r, price, pid))
        db.execute('UPDATE MarkdownPlan SET PlanStatus="Confirmed", ConfirmedBy=?, ConfirmedAt=?, '
                   'PriceTagStatus="Pending" WHERE PlanID=?',
                   (req.employee['EmployeeID'], now(), pid))
        msg = '折价方案已确认，可执行新价签'
    else:
        db.execute('UPDATE MarkdownPlan SET PlanStatus="Rejected", ConfirmedBy=?, ConfirmedAt=? '
                   'WHERE PlanID=?', (req.employee['EmployeeID'], now(), pid))
        msg = '折价方案已驳回'
    write_audit(req, '确认折价方案', 'MarkdownPlan', pid, msg)
    return ok({'message': msg})


@api.get('/api/expiry/loss-reports', roles=(OWNER, STOCKER))
def list_loss(req):
    status = req.q('status')
    where = ['1=1']
    params = []
    if status in ('Pending', 'Confirmed'):
        where.append('l.Status=?')
        params.append(status)
    rows = db.query(
        'SELECT l.*, p.ProductName, p.Specification, p.Unit, b.BatchNo, b.ExpiryDate, b.PurchasePrice, '
        'c.CategoryName, e.Name AS RegisterName, e2.Name AS ConfirmerName '
        'FROM LossReport l JOIN Product p ON p.ProductID=l.ProductID '
        'JOIN ProductCategory c ON c.CategoryID=p.CategoryID '
        'JOIN PurchaseBatch b ON b.BatchID=l.BatchID '
        'LEFT JOIN Employee e ON e.EmployeeID=l.RegisteredBy '
        'LEFT JOIN Employee e2 ON e2.EmployeeID=l.ConfirmedBy '
        'WHERE ' + ' AND '.join(where) + ' ORDER BY l.RegisteredAt DESC LIMIT 100', params)
    items = db.rows_to_dict(rows)
    return ok({'items': items,
               'summary': {
                   'pending': db.scalar("SELECT COUNT(*) FROM LossReport WHERE Status='Pending'"),
                   'confirmed30': db.scalar("SELECT COUNT(*) FROM LossReport WHERE Status='Confirmed' "
                                            "AND RegisteredAt >= date('now','localtime','-30 days')"),
                   'amount30': db.scalar("SELECT ROUND(COALESCE(SUM(Amount),0),2) FROM LossReport "
                                         "WHERE Status='Confirmed' AND RegisteredAt >= date('now','localtime','-30 days')"),
               }})


@api.post('/api/expiry/loss-reports', roles=(OWNER, STOCKER))
def create_loss(req):
    pid = integer(req.f('productId'), '商品编号', minimum=1)
    bid = integer(req.f('batchId'), '批次编号', minimum=1)
    quantity = num(req.f('quantity'), '报损数量', minimum=0.001)
    batch = db.query_one('SELECT b.*, p.ProductName, p.Unit FROM PurchaseBatch b '
                         'JOIN Product p ON p.ProductID=b.ProductID WHERE b.BatchID=?', (bid,))
    require(batch is not None, '批次不存在', 404)
    ledger = db.query_one('SELECT * FROM StockLedger WHERE ProductID=? AND BatchID=?', (pid, bid))
    require(ledger is not None, '该批次无库存记录')
    lno = doc_no('BS')
    lid = db.insert('INSERT INTO LossReport (LossNo, ProductID, BatchID, Quantity, Reason, Amount, '
                    'RegisteredBy, RegisteredAt, Status) VALUES (?,?,?,?,?,?,?,?,?)',
                    (lno, pid, bid, quantity, text(req.f('reason'), '报损原因', maxlen=100),
                     money(quantity * (batch['PurchasePrice'] or 0)), req.employee['EmployeeID'],
                     now(), 'Pending'))
    write_audit(req, '登记报损', 'LossReport', lid, '%s %s %s' % (lno, batch['ProductName'], quantity))
    return ok({'lossId': lid, 'lossNo': lno, 'message': '报损单已登记，待老板确认入账'})


@api.post('/api/expiry/loss-reports/<int:lid>/confirm', roles=(OWNER,))
def confirm_loss(req):
    lid = integer(req.params['lid'], '报损单编号')
    row = db.query_one('SELECT * FROM LossReport WHERE LossID=?', (lid,))
    require(row is not None, '报损单不存在', 404)
    require(row['Status'] == 'Pending', '该报损单已处理')
    if (req.f('decision') or 'confirm') != 'confirm':
        db.execute('UPDATE LossReport SET Status="Rejected", ConfirmedBy=?, ConfirmedAt=? WHERE LossID=?',
                   (req.employee['EmployeeID'], now(), lid))
        return ok({'message': '报损单已驳回'})
    ledger = db.query_one('SELECT * FROM StockLedger WHERE ProductID=? AND BatchID=?',
                          (row['ProductID'], row['BatchID']))
    require(ledger is not None and ledger['Quantity'] >= row['Quantity'] - 0.001,
            '现存数量不足，无法报损入账（现存量 %.3f）' % (ledger['Quantity'] if ledger else 0))
    db.execute('UPDATE LossReport SET Status="Confirmed", ConfirmedBy=?, ConfirmedAt=? WHERE LossID=?',
               (req.employee['EmployeeID'], now(), lid))
    db.execute('UPDATE StockLedger SET Quantity=MAX(0, Quantity-?), UpdatedAt=? WHERE ProductID=? AND BatchID=?',
               (row['Quantity'], now(), row['ProductID'], row['BatchID']))
    db.execute('INSERT INTO StockMovement (ProductID, BatchID, MoveType, Quantity, RefType, RefID, '
               'RefNo, OccurredAt, OperatorID, Note) VALUES (?,?,?,?,?,?,?,?,?,?)',
               (row['ProductID'], row['BatchID'], 'Loss', -row['Quantity'], 'LossReport', lid,
                row['LossNo'], now(), req.employee['EmployeeID'], '报损入账'))
    write_audit(req, '确认报损', 'LossReport', lid, '报损入账 %s' % row['LossNo'])
    return ok({'message': '报损已确认入账，库存台账已更新'})


@api.get('/api/expiry/returns', roles=(OWNER, STOCKER))
def list_returns(req):
    rows = db.query(
        'SELECT r.*, s.Name AS SupplierName, p.ProductName, p.Specification, p.Unit, b.BatchNo '
        'FROM ReturnNote r JOIN Supplier s ON s.SupplierID=r.SupplierID '
        'JOIN Product p ON p.ProductID=r.ProductID LEFT JOIN PurchaseBatch b ON b.BatchID=r.BatchID '
        'ORDER BY r.ReturnedAt DESC LIMIT 60')
    return ok({'items': db.rows_to_dict(rows)})
