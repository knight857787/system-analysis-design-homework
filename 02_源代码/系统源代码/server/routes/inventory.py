"""库存台账、库存流水、盘点与调账（UC-17）。"""
from datetime import datetime

from server import db
from server.core import (ALL_ROLES, OWNER, SALESPERSON, STOCKER, api, bad, doc_no, integer, money, now, num, ok,
                         require, text, today, write_audit)


@api.get('/api/inventory', roles=(OWNER, STOCKER, SALESPERSON))
def inventory_list(req):
    page, size = req.page_args(20)
    q = (req.q('q') or '').strip()
    category_id = req.qint('categoryId')
    days = req.qint('expiringDays')
    only_stock = req.q('inStock') != '0'
    where = ['1=1']
    params = []
    if q:
        where.append('(p.ProductName LIKE ? OR p.Barcode LIKE ? OR b.BatchNo LIKE ?)')
        params += ['%' + q + '%', '%' + q + '%', '%' + q + '%']
    if category_id:
        where.append('p.CategoryID=?')
        params.append(category_id)
    if days:
        where.append('julianday(b.ExpiryDate) - julianday(date("now","localtime")) <= ?')
        params.append(days)
    if only_stock:
        where.append('l.Quantity > 0.0001')
    cond = ' AND '.join(where)
    base = ('FROM StockLedger l JOIN Product p ON p.ProductID=l.ProductID '
            'JOIN ProductCategory c ON c.CategoryID=p.CategoryID '
            'JOIN PurchaseBatch b ON b.BatchID=l.BatchID '
            'LEFT JOIN Supplier s ON s.SupplierID=b.SupplierID WHERE ' + cond)
    total = db.scalar('SELECT COUNT(*) ' + base, params)
    rows = db.query(
        'SELECT l.LedgerID, l.ProductID, l.BatchID, l.Quantity, l.ReservedQty, l.Location, l.UpdatedAt, '
        'p.ProductName, p.Barcode, p.Specification, p.Unit, p.ListPrice, p.CategoryID, c.CategoryName, '
        'b.BatchNo, b.ProductionDate, b.ExpiryDate, b.ShelfLifeDays, b.PurchasePrice, b.ArrivalDate, '
        's.Name AS SupplierName, '
        'CAST(julianday(b.ExpiryDate)-julianday(date("now","localtime")) AS INTEGER) AS RemainDays, '
        'ROUND(l.Quantity * b.PurchasePrice,2) AS StockValue '
        + base + ' ORDER BY b.ExpiryDate ASC, p.ProductName LIMIT ? OFFSET ?',
        params + [size, (page - 1) * size])
    summary = db.query_one(
        'SELECT COUNT(*) AS Batches, ROUND(COALESCE(SUM(l.Quantity),3),3) AS Qty, '
        'ROUND(COALESCE(SUM(l.Quantity*b.PurchasePrice),2),2) AS Value, '
        'SUM(CASE WHEN l.Quantity < 0 THEN 1 ELSE 0 END) AS Negative '
        'FROM StockLedger l JOIN PurchaseBatch b ON b.BatchID=l.BatchID WHERE l.Quantity <> 0')
    expiring = db.scalar('SELECT COUNT(*) FROM StockLedger l JOIN PurchaseBatch b ON b.BatchID=l.BatchID '
                         'WHERE l.Quantity > 0 AND julianday(b.ExpiryDate)-julianday(date("now","localtime")) '
                         'BETWEEN 0 AND 30')
    return ok({'items': db.rows_to_dict(rows), 'total': total, 'page': page, 'size': size,
               'summary': {'batches': summary['Batches'], 'qty': round(summary['Qty'] or 0, 3),
                           'value': round(summary['Value'] or 0, 2),
                           'negative': summary['Negative'] or 0, 'expiring30': expiring}})


@api.get('/api/inventory/movements', roles=(OWNER, STOCKER, SALESPERSON))
def movements(req):
    page, size = req.page_args(30)
    where = ['1=1']
    params = []
    if req.qint('productId'):
        where.append('m.ProductID=?')
        params.append(req.qint('productId'))
    if req.q('type'):
        where.append('m.MoveType=?')
        params.append(req.q('type'))
    if req.q('from'):
        where.append('date(m.OccurredAt) >= ?')
        params.append(req.q('from'))
    if req.q('to'):
        where.append('date(m.OccurredAt) <= ?')
        params.append(req.q('to'))
    cond = ' AND '.join(where)
    total = db.scalar('SELECT COUNT(*) FROM StockMovement m WHERE ' + cond, params)
    rows = db.query(
        'SELECT m.*, p.ProductName, p.Unit, b.BatchNo, e.Name AS OperatorName '
        'FROM StockMovement m JOIN Product p ON p.ProductID=m.ProductID '
        'LEFT JOIN PurchaseBatch b ON b.BatchID=m.BatchID '
        'LEFT JOIN Employee e ON e.EmployeeID=m.OperatorID '
        'WHERE ' + cond + ' ORDER BY m.OccurredAt DESC LIMIT ? OFFSET ?',
        params + [size, (page - 1) * size])
    items = db.rows_to_dict(rows)
    type_label = {'Receipt': '收货入库', 'Sale': '销售出库', 'Loss': '报损出库',
                  'Return': '退货出库', 'Adjust': '盘点调账'}
    for it in items:
        it['typeLabel'] = type_label.get(it['MoveType'], it['MoveType'])
    return ok({'items': items, 'total': total, 'page': page, 'size': size})


@api.get('/api/inventory/overview', roles=(OWNER, STOCKER, SALESPERSON))
def overview(req):
    rows = db.rows_to_dict(db.query(
        'SELECT c.CategoryName AS name, COUNT(DISTINCT p.ProductID) AS skus, '
        'ROUND(COALESCE(SUM(l.Quantity),3),3) AS qty, '
        'ROUND(COALESCE(SUM(l.Quantity*b.PurchasePrice),2),2) AS value '
        'FROM ProductCategory c LEFT JOIN Product p ON p.CategoryID=c.CategoryID AND p.RecordStatus="A" '
        'LEFT JOIN StockLedger l ON l.ProductID=p.ProductID AND l.Quantity > 0 '
        'LEFT JOIN PurchaseBatch b ON b.BatchID=l.BatchID GROUP BY c.CategoryID ORDER BY value DESC'))
    return ok({'items': rows})


# --------------------------------------------------------------------------
# 盘点
# --------------------------------------------------------------------------
@api.get('/api/stocktakes', roles=(OWNER, STOCKER))
def list_plans(req):
    page, size = req.page_args(15)
    total = db.scalar('SELECT COUNT(*) FROM StocktakePlan')
    rows = db.query(
        'SELECT s.*, e.Name AS ConfirmerName, '
        '(SELECT COUNT(*) FROM StocktakeLine l WHERE l.PlanID=s.PlanID) AS LineCount, '
        '(SELECT COUNT(*) FROM StocktakeLine l WHERE l.PlanID=s.PlanID AND l.CountedQty IS NULL) AS Uncounted, '
        '(SELECT COUNT(*) FROM StocktakeLine l WHERE l.PlanID=s.PlanID AND ABS(COALESCE(l.DiffQty,0))>0.0001) AS DiffLines '
        'FROM StocktakePlan s LEFT JOIN Employee e ON e.EmployeeID=s.ConfirmedBy '
        'ORDER BY s.PlannedAt DESC LIMIT ? OFFSET ?', (size, (page - 1) * size))
    return ok({'items': db.rows_to_dict(rows), 'total': total, 'page': page, 'size': size})


@api.get('/api/stocktakes/<int:pid>', roles=(OWNER, STOCKER))
def plan_detail(req):
    pid = integer(req.params['pid'], '盘点单编号')
    plan = db.query_one('SELECT s.*, e.Name AS ConfirmerName FROM StocktakePlan s '
                        'LEFT JOIN Employee e ON e.EmployeeID=s.ConfirmedBy WHERE s.PlanID=?', (pid,))
    require(plan is not None, '盘点单不存在', 404)
    lines = db.rows_to_dict(db.query(
        'SELECT l.*, p.ProductName, p.Specification, p.Unit, b.BatchNo, b.ExpiryDate, b.PurchasePrice, '
        'sl.Quantity AS NowQty FROM StocktakeLine l JOIN Product p ON p.ProductID=l.ProductID '
        'LEFT JOIN PurchaseBatch b ON b.BatchID=l.BatchID '
        'LEFT JOIN StockLedger sl ON sl.ProductID=l.ProductID AND sl.BatchID=l.BatchID '
        'WHERE l.PlanID=? ORDER BY l.LineNo', (pid,)))
    return ok({'plan': db.row_to_dict(plan), 'lines': lines})


@api.post('/api/stocktakes', roles=(OWNER, STOCKER))
def create_plan(req):
    scope = text(req.f('scope'), '盘点范围', maxlen=32) or '全店'
    cond = 'l.Quantity > 0'
    params = []
    if scope not in ('全店', '全部'):
        cat = db.query_one('SELECT CategoryID FROM ProductCategory WHERE CategoryName=?', (scope,))
        if cat:
            cond += ' AND p.CategoryID=?'
            params.append(cat['CategoryID'])
    ledger = db.query(
        'SELECT l.*, b.PurchasePrice, p.ProductName FROM StockLedger l '
        'JOIN PurchaseBatch b ON b.BatchID=l.BatchID JOIN Product p ON p.ProductID=l.ProductID '
        'WHERE ' + cond + ' ORDER BY l.Location, p.ProductName', params)
    require(ledger, '该范围内没有可盘点的库存记录')
    plan_no = doc_no('PD')
    pid = db.insert('INSERT INTO StocktakePlan (PlanNo, PlannedAt, Scope, FrozenAt, Status, Note) '
                    'VALUES (?,?,?,?,?,?)', (plan_no, now(), scope, now(), 'Counting', req.f('note')))
    for line_no, row in enumerate(ledger, start=1):
        db.execute('INSERT INTO StocktakeLine (PlanID, LineNo, ProductID, BatchID, BookQty, '
                   'UnitCost) VALUES (?,?,?,?,?,?)',
                   (pid, line_no, row['ProductID'], row['BatchID'], row['Quantity'],
                    row['PurchasePrice']))
    write_audit(req, '发起盘点', 'StocktakePlan', pid, '%s 共 %d 行' % (plan_no, len(ledger)))
    return ok({'planId': pid, 'planNo': plan_no, 'lines': len(ledger),
               'message': '盘点单已生成，按库位顺序逐项实盘'})


@api.post('/api/stocktakes/<int:pid>/count', roles=(OWNER, STOCKER))
def count_lines(req):
    pid = integer(req.params['pid'], '盘点单编号')
    plan = db.query_one('SELECT * FROM StocktakePlan WHERE PlanID=?', (pid,))
    require(plan is not None, '盘点单不存在', 404)
    require(plan['Status'] in ('Counting',), '盘点单已提交，不能继续录入')
    lines = req.body.get('lines') or []
    require(isinstance(lines, list) and lines, '没有要提交的实盘数据')
    updated = 0
    for line in lines:
        line_no = integer(line.get('lineNo'), '行号', minimum=1)
        counted = num(line.get('countedQty'), '实盘数量', minimum=0)
        row = db.query_one('SELECT * FROM StocktakeLine WHERE PlanID=? AND LineNo=?', (pid, line_no))
        if row is None:
            continue
        diff = round(counted - row['BookQty'], 3)
        tol = 1.0 if (row['UnitCost'] or 0) >= 1 else 1.0
        reason = line.get('diffReason')
        if abs(diff * (row['UnitCost'] or 0)) <= tol and abs(diff) <= 1:
            reason = reason or '正常（容差内）'
        db.execute('UPDATE StocktakeLine SET CountedQty=?, DiffQty=?, DiffReason=?, '
                   'DiffAmount=? WHERE PlanID=? AND LineNo=?',
                   (counted, diff, reason, money(diff * (row['UnitCost'] or 0)), pid, line_no))
        updated += 1
    write_audit(req, '录入实盘', 'StocktakePlan', pid, '提交 %d 行' % updated)
    return ok({'updated': updated, 'message': '实盘数据已保存（%d 行）' % updated})


@api.post('/api/stocktakes/<int:pid>/submit', roles=(OWNER, STOCKER))
def submit_plan(req):
    pid = integer(req.params['pid'], '盘点单编号')
    plan = db.query_one('SELECT * FROM StocktakePlan WHERE PlanID=?', (pid,))
    require(plan is not None, '盘点单不存在', 404)
    uncounted = db.scalar('SELECT COUNT(*) FROM StocktakeLine WHERE PlanID=? AND CountedQty IS NULL', (pid,))
    require(uncounted == 0, '还有 %d 行未录入实盘数量' % uncounted)
    no_reason = db.scalar('SELECT COUNT(*) FROM StocktakeLine WHERE PlanID=? AND ABS(DiffQty) > 0.0001 '
                          'AND (DiffReason IS NULL OR DiffReason="")', (pid,))
    require(no_reason == 0, '有 %d 行差异未登记原因，按业务规则必须留原因' % no_reason)
    total_cost = db.scalar('SELECT COALESCE(SUM(BookQty * UnitCost),0) FROM StocktakeLine WHERE PlanID=?', (pid,))
    diff_abs = db.scalar('SELECT COALESCE(SUM(ABS(DiffAmount)),0) FROM StocktakeLine WHERE PlanID=?', (pid,))
    rate = (diff_abs / total_cost) if total_cost else 0
    db.execute('UPDATE StocktakePlan SET Status="Submitted", DiffAmount=?, DiffRate=? WHERE PlanID=?',
               (money(diff_abs), round(rate, 5), pid))
    write_audit(req, '提交盘点', 'StocktakePlan', pid, '差异率 %.3f%%' % (rate * 100))
    return ok({'message': '盘点已提交，等待老板确认后调账', 'diffAmount': money(diff_abs),
               'diffRate': round(rate * 100, 3)})


@api.post('/api/stocktakes/<int:pid>/approve', roles=(OWNER,))
def approve_plan(req):
    pid = integer(req.params['pid'], '盘点单编号')
    plan = db.query_one('SELECT * FROM StocktakePlan WHERE PlanID=?', (pid,))
    require(plan is not None, '盘点单不存在', 404)
    require(plan['Status'] == 'Submitted', '盘点单当前状态不允许批准（%s）' % plan['Status'])
    if (req.f('decision') or 'approve') != 'approve':
        db.execute('UPDATE StocktakePlan SET Status="Rejected", Note=COALESCE(Note,"") || " / 老板驳回调账" '
                   'WHERE PlanID=?', (pid,))
        write_audit(req, '驳回盘点', 'StocktakePlan', pid, '老板不批准调账，库存不改')
        return ok({'message': '已驳回，库存维持原值（差异留在盘点单上）'})
    lines = db.query('SELECT * FROM StocktakeLine WHERE PlanID=? AND ABS(COALESCE(DiffQty,0)) > 0.0001', (pid,))
    adjust = 0
    for line in lines:
        db.execute('INSERT INTO StockAdjust (PlanID, LineNo, ApprovedBy, AdjustQty, AdjustReason, '
                   'OccurredAt) VALUES (?,?,?,?,?,?)',
                   (pid, line['LineNo'], req.employee['EmployeeID'], line['DiffQty'],
                    line['DiffReason'], now()))
        db.execute('UPDATE StockLedger SET Quantity=MAX(0, Quantity + ?), UpdatedAt=? '
                   'WHERE ProductID=? AND BatchID=?',
                   (line['DiffQty'], now(), line['ProductID'], line['BatchID']))
        db.execute('INSERT INTO StockMovement (ProductID, BatchID, MoveType, Quantity, RefType, RefID, '
                   'RefNo, OccurredAt, OperatorID, Note) VALUES (?,?,?,?,?,?,?,?,?,?)',
                   (line['ProductID'], line['BatchID'], 'Adjust', line['DiffQty'], 'StocktakePlan', pid,
                    plan['PlanNo'], now(), req.employee['EmployeeID'], line['DiffReason']))
        adjust += 1
    db.execute('UPDATE StocktakePlan SET Status="Approved", ConfirmedBy=?, ConfirmedAt=? WHERE PlanID=?',
               (req.employee['EmployeeID'], now(), pid))
    write_audit(req, '批准盘点调账', 'StocktakePlan', pid, '调账 %d 行' % adjust)
    return ok({'message': '已批准调账，%d 行库存已按实盘修正' % adjust})
