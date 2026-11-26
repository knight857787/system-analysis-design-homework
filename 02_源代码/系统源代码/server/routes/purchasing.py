"""订货（UC-04）与收货验收（UC-03）、进货查验（UC-15）。"""
import math
from datetime import date, datetime, timedelta

from server import db
from server.core import (ALL_ROLES, OWNER, STAFF, STOCKER, SUPPLIER, api, bad, doc_no, integer, now,
                         num, ok, require, text, today, write_audit)


# --------------------------------------------------------------------------
# 订货
# --------------------------------------------------------------------------
@api.get('/api/purchase/suggestions', roles=(OWNER, STOCKER))
def suggestions(req):
    supplier_id = req.qint('supplierId')
    q = (req.q('q') or '').strip()
    rows = db.query(
        'SELECT p.ProductID, p.ProductName, p.Specification, p.Unit, p.ListPrice, p.ShelfLifeDays, '
        'p.CategoryID, c.CategoryName, p.SupplierID, s.Name AS SupplierName, '
        'ROUND(COALESCE(v.StockQty,0),3) AS StockQty, '
        'ROUND(COALESCE((SELECT SUM(sl.Quantity) FROM SaleLine sl JOIN SaleOrder so ON so.SaleID=sl.SaleID '
        '  WHERE sl.ProductID=p.ProductID AND so.OccurredAt >= date("now","localtime","-30 days")),0),3) AS Sold30, '
        'ROUND(COALESCE((SELECT SUM(ol.Quantity - ol.ReceivedQty) FROM PurchaseOrderLine ol '
        '  JOIN PurchaseOrder o ON o.OrderID=ol.OrderID '
        '  WHERE ol.ProductID=p.ProductID AND o.OrderStatus IN ("Submitted","Confirmed")),0),3) AS InTransit, '
        'ROUND(COALESCE((SELECT AVG(b.PurchasePrice) FROM PurchaseBatch b WHERE b.ProductID=p.ProductID),'
        '  p.ListPrice * 0.84),2) AS LastCost '
        'FROM Product p JOIN ProductCategory c ON c.CategoryID=p.CategoryID '
        'LEFT JOIN Supplier s ON s.SupplierID=p.SupplierID '
        'LEFT JOIN vProductStock v ON v.ProductID=p.ProductID '
        'WHERE p.RecordStatus="A" AND p.OnShelfFlag="Y"')
    items = []
    for r in rows:
        if supplier_id and r['SupplierID'] != supplier_id:
            continue
        if q and q not in (r['ProductName'] or ''):
            continue
        daily = (r['Sold30'] or 0) / 30.0
        shelf = r['ShelfLifeDays'] or 30
        cover = 4 if shelf <= 7 else (10 if shelf <= 30 else 18)
        target = daily * cover
        suggested = max(0, math.ceil(target - (r['StockQty'] or 0) - (r['InTransit'] or 0)))
        if daily <= 0.02 and (r['StockQty'] or 0) > 2:
            suggested = 0
        days_cover = round((r['StockQty'] or 0) / daily, 1) if daily > 0.02 else None
        items.append({
            'productId': r['ProductID'], 'productName': r['ProductName'],
            'specification': r['Specification'], 'unit': r['Unit'],
            'categoryName': r['CategoryName'], 'supplierId': r['SupplierID'],
            'supplierName': r['SupplierName'], 'listPrice': r['ListPrice'],
            'lastCost': round(r['LastCost'] or 0, 2),
            'stockQty': round(r['StockQty'] or 0, 3), 'sold30': round(r['Sold30'] or 0, 3),
            'daily': round(daily, 3), 'inTransit': round(r['InTransit'] or 0, 3),
            'coverDays': days_cover, 'targetCover': cover,
            'suggestedQty': suggested,
            'urgent': suggested > 0 and (days_cover is not None and days_cover < cover),
        })
    items.sort(key=lambda x: (-(x['suggestedQty'] or 0), x['coverDays'] if x['coverDays'] is not None else 999))
    return ok({'items': items[:120], 'total': len(items)})


@api.get('/api/purchase-orders', roles=(OWNER, STOCKER, SUPPLIER))
def list_orders(req):
    page, size = req.page_args(15)
    status = req.q('status')
    supplier_id = req.qint('supplierId')
    where = ['1=1']
    params = []
    if status in ('Submitted', 'Confirmed', 'Received', 'Partial', 'Cancelled'):
        where.append('o.OrderStatus=?')
        params.append(status)
    if supplier_id:
        where.append('o.SupplierID=?')
        params.append(supplier_id)
    if req.role() == SUPPLIER and req.employee['SupplierID']:
        where.append('o.SupplierID=?')
        params.append(req.employee['SupplierID'])
    if req.q('supplierOnly') == '1' and req.qint('supplierId'):
        pass
    cond = ' AND '.join(where)
    total = db.scalar('SELECT COUNT(*) FROM PurchaseOrder o WHERE ' + cond, params)
    rows = db.query(
        'SELECT o.*, s.Name AS SupplierName, e.Name AS SubmittedByName, '
        '(SELECT COUNT(*) FROM PurchaseOrderLine l WHERE l.OrderID=o.OrderID) AS LineCount '
        'FROM PurchaseOrder o JOIN Supplier s ON s.SupplierID=o.SupplierID '
        'LEFT JOIN Employee e ON e.EmployeeID=o.SubmittedBy '
        'WHERE ' + cond + ' ORDER BY o.SubmittedAt DESC LIMIT ? OFFSET ?',
        params + [size, (page - 1) * size])
    return ok({'items': db.rows_to_dict(rows), 'total': total, 'page': page, 'size': size})


@api.get('/api/purchase-orders/<int:oid>', roles=(OWNER, STOCKER, SUPPLIER))
def order_detail(req):
    oid = integer(req.params['oid'], '订货单编号')
    order = db.query_one(
        'SELECT o.*, s.Name AS SupplierName, s.Contact, s.Phone, e.Name AS SubmittedByName '
        'FROM PurchaseOrder o JOIN Supplier s ON s.SupplierID=o.SupplierID '
        'LEFT JOIN Employee e ON e.EmployeeID=o.SubmittedBy WHERE o.OrderID=?', (oid,))
    require(order is not None, '订货单不存在', 404)
    if req.role() == SUPPLIER:
        require(order['SupplierID'] == req.employee['SupplierID'], '只能查看本公司的订货单', 403)
    lines = db.rows_to_dict(db.query(
        'SELECT l.*, p.ProductName, p.Specification, p.Unit, '
        'ROUND(l.Quantity * l.AgreedPrice,2) AS Amount FROM PurchaseOrderLine l '
        'JOIN Product p ON p.ProductID=l.ProductID WHERE l.OrderID=? ORDER BY l.LineNo', (oid,)))
    receipts = db.rows_to_dict(db.query(
        'SELECT * FROM ReceiptNote WHERE OrderID=?', (oid,)))
    return ok({'order': db.row_to_dict(order), 'lines': lines, 'receipts': receipts})


@api.post('/api/purchase-orders', roles=(OWNER,))
def create_order(req):
    data = req.body
    lines = data.get('lines') or []
    require(isinstance(lines, list) and lines, '请至少填写一行订货明细')
    supplier_id = integer(data.get('supplierId'), '供应商', minimum=1)
    sup = db.query_one('SELECT * FROM Supplier WHERE SupplierID=?', (supplier_id,))
    require(sup is not None, '供应商不存在')
    expected = text(data.get('expectedArrivalDate'), '预计到货日期', maxlen=20)
    total = 0.0
    order_no = doc_no('DH')
    order_id = db.insert(
        'INSERT INTO PurchaseOrder (OrderNo, SupplierID, SubmittedBy, SubmittedAt, '
        'ExpectedArrivalDate, OrderStatus, TotalAmount, ClientNo, Note) VALUES (?,?,?,?,?,?,?,?,?)',
        (order_no, supplier_id, req.employee['EmployeeID'], now(), expected, 'Submitted', 0,
         'DEV01-' + now().replace('-', '').replace(':', '').replace(' ', ''), data.get('note')))
    line_no = 0
    for line in lines:
        qty = num(line.get('quantity'), '订货数量', minimum=0.01)
        price = num(line.get('agreedPrice'), '约定单价', minimum=0)
        pid = integer(line.get('productId'), '商品编号', minimum=1)
        product = db.query_one('SELECT * FROM Product WHERE ProductID=?', (pid,))
        require(product is not None, '商品不存在')
        if product['SupplierID'] and product['SupplierID'] != supplier_id:
            continue  # 不在该供货商供货范围
        line_no += 1
        db.execute('INSERT INTO PurchaseOrderLine (OrderID, LineNo, ProductID, Quantity, AgreedPrice, '
                   'ReceivedQty) VALUES (?,?,?,?,?,0)', (order_id, line_no, pid, qty, price))
        total += qty * price
    require(line_no > 0, '所选商品均不在该供货商的供货范围内，请重新选择供应商')
    db.execute('UPDATE PurchaseOrder SET TotalAmount=? WHERE OrderID=?', (round(total, 2), order_id))
    write_audit(req, '提交订货单', 'PurchaseOrder', order_id, '%s 共 %d 行' % (order_no, line_no))
    return ok({'orderId': order_id, 'orderNo': order_no, 'message': '订货单已提交并推送给供货商'})


@api.post('/api/purchase-orders/<int:oid>/confirm', roles=(OWNER, SUPPLIER))
def confirm_order(req):
    oid = integer(req.params['oid'], '订货单编号')
    order = db.query_one('SELECT * FROM PurchaseOrder WHERE OrderID=?', (oid,))
    require(order is not None, '订货单不存在', 404)
    if req.role() == SUPPLIER and order['SupplierID'] != req.employee['SupplierID']:
        bad('本单不属于贵司，无法确认', 403)
    action = (req.f('action') or 'accept').strip()
    require(order['OrderStatus'] in ('Submitted', 'Confirmed'), '当前状态不允许确认（%s）' % order['OrderStatus'])
    if action == 'accept':
        expect = req.f('expectedArrivalDate') or order['ExpectedArrivalDate']
        db.execute('UPDATE PurchaseOrder SET OrderStatus="Confirmed", ExpectedArrivalDate=? WHERE OrderID=?',
                   (expect, oid))
        msg = '供货商已接单，到货日期 %s' % expect
    else:
        db.execute('UPDATE PurchaseOrder SET OrderStatus="Cancelled" WHERE OrderID=?', (oid,))
        msg = '订货单已拒绝/取消'
    write_audit(req, '确认订货单', 'PurchaseOrder', oid, msg)
    return ok({'message': msg})


@api.post('/api/purchase-orders/<int:oid>/cancel', roles=(OWNER,))
def cancel_order(req):
    oid = integer(req.params['oid'], '订货单编号')
    order = db.query_one('SELECT * FROM PurchaseOrder WHERE OrderID=?', (oid,))
    require(order is not None, '订货单不存在', 404)
    require(order['OrderStatus'] in ('Submitted', 'Confirmed'), '只能作废未收货的订货单')
    db.execute('UPDATE PurchaseOrder SET OrderStatus="Cancelled" WHERE OrderID=?', (oid,))
    write_audit(req, '作废订货单', 'PurchaseOrder', oid, req.f('reason') or '老板作废')
    return ok({'message': '订货单已作废（不物理删除，留痕可查）'})


# --------------------------------------------------------------------------
# 收货与验收
# --------------------------------------------------------------------------
@api.get('/api/receipts', roles=(OWNER, STOCKER))
def list_receipts(req):
    page, size = req.page_args(15)
    supplier_id = req.qint('supplierId')
    where = ['1=1']
    params = []
    if supplier_id:
        where.append('n.SupplierID=?')
        params.append(supplier_id)
    if req.role() == SUPPLIER and req.employee['SupplierID']:
        where.append('n.SupplierID=?')
        params.append(req.employee['SupplierID'])
    if req.q('missingInspection') == '1':
        where.append('i.InspectionID IS NULL OR i.Status="Missing"')
    cond = ' AND '.join(where)
    total = db.scalar('SELECT COUNT(*) FROM ReceiptNote n LEFT JOIN IncomingInspection i '
                      'ON i.ReceiptID=n.ReceiptID WHERE ' + cond, params)
    rows = db.query(
        'SELECT n.*, s.Name AS SupplierName, e.Name AS InspectorName, o.OrderNo, '
        'ROUND((SELECT COALESCE(SUM(r.ReceivedQty * r.PurchasePrice),0) FROM ReceiptLine r '
        ' WHERE r.ReceiptID=n.ReceiptID),2) AS Amount, '
        '(SELECT COUNT(*) FROM ReceiptLine r WHERE r.ReceiptID=n.ReceiptID) AS LineCount, '
        'i.Status AS InspectionStatus, i.ValidUntil, i.CertificateNo '
        'FROM ReceiptNote n JOIN Supplier s ON s.SupplierID=n.SupplierID '
        'LEFT JOIN Employee e ON e.EmployeeID=n.InspectedBy '
        'LEFT JOIN PurchaseOrder o ON o.OrderID=n.OrderID '
        'LEFT JOIN IncomingInspection i ON i.ReceiptID=n.ReceiptID '
        'WHERE ' + cond + ' ORDER BY n.ReceivedAt DESC LIMIT ? OFFSET ?',
        params + [size, (page - 1) * size])
    return ok({'items': db.rows_to_dict(rows), 'total': total, 'page': page, 'size': size})


@api.get('/api/receipts/pending-orders', roles=(OWNER, STOCKER))
def pending_orders(req):
    """待收货的订货单及其明细，用于收货单页面按单验收。"""
    supplier_id = req.qint('supplierId')
    params = []
    cond = 'o.OrderStatus IN ("Submitted","Confirmed")'
    if supplier_id:
        cond += ' AND o.SupplierID=?'
        params.append(supplier_id)
    orders = db.rows_to_dict(db.query(
        'SELECT o.*, s.Name AS SupplierName FROM PurchaseOrder o '
        'JOIN Supplier s ON s.SupplierID=o.SupplierID WHERE ' + cond + ' ORDER BY o.ExpectedArrivalDate', params))
    for order in orders:
        order['lines'] = db.rows_to_dict(db.query(
            'SELECT l.*, p.ProductName, p.Specification, p.Unit, p.ShelfLifeDays, p.CategoryID '
            'FROM PurchaseOrderLine l JOIN Product p ON p.ProductID=l.ProductID '
            'WHERE l.OrderID=? ORDER BY l.LineNo', (order['OrderID'],)))
    return ok({'items': orders})


@api.get('/api/receipts/<int:rid>', roles=(OWNER, STOCKER))
def receipt_detail(req):
    rid = integer(req.params['rid'], '收货单编号')
    note = db.query_one(
        'SELECT n.*, s.Name AS SupplierName, e.Name AS InspectorName, o.OrderNo, o.OrderID '
        'FROM ReceiptNote n JOIN Supplier s ON s.SupplierID=n.SupplierID '
        'LEFT JOIN Employee e ON e.EmployeeID=n.InspectedBy '
        'LEFT JOIN PurchaseOrder o ON o.OrderID=n.OrderID WHERE n.ReceiptID=?', (rid,))
    require(note is not None, '收货单不存在', 404)
    lines = db.rows_to_dict(db.query(
        'SELECT r.*, p.ProductName, p.Specification, p.Unit, b.BatchNo, b.ProductionDate, '
        'b.ExpiryDate, b.ShelfLifeDays, ROUND(r.ReceivedQty * r.PurchasePrice,2) AS Amount '
        'FROM ReceiptLine r JOIN Product p ON p.ProductID=r.ProductID '
        'LEFT JOIN PurchaseBatch b ON b.BatchID=r.BatchID WHERE r.ReceiptID=? ORDER BY r.LineNo', (rid,)))
    inspection = db.query_one('SELECT * FROM IncomingInspection WHERE ReceiptID=?', (rid,))
    return ok({'receipt': db.row_to_dict(note), 'lines': lines,
               'inspection': db.row_to_dict(inspection)})


@api.post('/api/receipts', roles=(OWNER, STOCKER))
def create_receipt(req):
    data = req.body
    lines = data.get('lines') or []
    require(isinstance(lines, list) and lines, '请至少登记一行收货明细')
    order_id = data.get('orderId') or None
    supplier_id = integer(data.get('supplierId'), '供应商', minimum=1)
    require(db.query_one('SELECT 1 FROM Supplier WHERE SupplierID=?', (supplier_id,)), '供应商不存在')
    received_at = data.get('receivedAt') or now()
    receipt_no = doc_no('RC')
    result = text(data.get('inspectionResult'), '验收结论', required=False, maxlen=32) or '合格'
    rid = db.insert(
        'INSERT INTO ReceiptNote (ReceiptNo, OrderID, SupplierID, InspectedBy, ReceivedAt, '
        'InspectionResult, DiffNote) VALUES (?,?,?,?,?,?,?)',
        (receipt_no, order_id, supplier_id, req.employee['EmployeeID'], received_at, result,
         data.get('diffNote')))
    line_no = 0
    diff_count = 0
    for line in lines:
        pid = integer(line.get('productId'), '商品编号', minimum=1)
        product = db.query_one('SELECT * FROM Product WHERE ProductID=?', (pid,))
        require(product is not None, '商品不存在：%s' % pid)
        received_qty = num(line.get('receivedQty'), '实收数量', minimum=0)
        rejected_qty = num(line.get('rejectedQty') or 0, '拒收数量', minimum=0)
        if received_qty <= 0 and rejected_qty <= 0:
            continue
        prod_date = text(line.get('productionDate'), '生产日期', required=False, maxlen=20)
        shelf = integer(line.get('shelfLifeDays') or product['ShelfLifeDays'], '保质期天数', minimum=1)
        price = num(line.get('purchasePrice'), '进货单价', minimum=0)
        batch_id = None
        expiry = None
        if received_qty > 0:
            require(bool(prod_date), '商品「%s」缺少生产日期，按业务规则不得入库（可登记为拒收）'
                    % product['ProductName'])
            try:
                prod_d = datetime.strptime(prod_date[:10], '%Y-%m-%d').date()
            except ValueError:
                bad('生产日期格式应为 YYYY-MM-DD')
            expiry_d = prod_d + timedelta(days=shelf)
            require(expiry_d >= date.today(), '商品「%s」生产日期+保质期已过期（到期日 %s），须拒收'
                    % (product['ProductName'], expiry_d.isoformat()))
            batch_no = 'B' + datetime.now().strftime('%y%m%d') + '%04d' % (line_no + 1) + \
                       db.scalar('SELECT COALESCE(MAX(BatchID),0) FROM PurchaseBatch').__str__()
            batch_id = db.insert(
                'INSERT INTO PurchaseBatch (BatchNo, ProductID, SupplierID, ProductionDate, '
                'ShelfLifeDays, ExpiryDate, PurchasePrice, ArrivalDate) VALUES (?,?,?,?,?,?,?,?)',
                (batch_no, pid, supplier_id, prod_d.isoformat(), shelf, expiry_d.isoformat(),
                 price, today()))
            ledger = db.query_one('SELECT * FROM StockLedger WHERE ProductID=? AND BatchID=?',
                                  (pid, batch_id))
            if ledger:
                db.execute('UPDATE StockLedger SET Quantity=Quantity+?, UpdatedAt=datetime("now","localtime") '
                           'WHERE LedgerID=?', (received_qty, ledger['LedgerID']))
            else:
                db.insert('INSERT INTO StockLedger (ProductID, BatchID, Quantity, ReservedQty, Location, '
                          'UpdatedAt) VALUES (?,?,?,0,?,datetime("now","localtime"))',
                          (pid, batch_id, received_qty, data.get('location') or '待定'))
            db.execute('INSERT INTO StockMovement (ProductID, BatchID, MoveType, Quantity, RefType, RefID, '
                       'RefNo, OccurredAt, OperatorID, Note) VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (pid, batch_id, 'Receipt', received_qty, 'ReceiptNote', rid, receipt_no,
                        received_at, req.employee['EmployeeID'], '收货入库'))
        line_no += 1
        ordered = num(line.get('orderedQty') or 0, '应收数量', minimum=0)
        if ordered and (abs(ordered - received_qty) > 0.001 or rejected_qty):
            diff_count += 1
        db.execute('INSERT INTO ReceiptLine (ReceiptID, LineNo, ProductID, BatchID, OrderedQty, '
                   'ReceivedQty, RejectedQty, RejectionNote, PurchasePrice) VALUES (?,?,?,?,?,?,?,?,?)',
                   (rid, line_no, pid, batch_id, ordered, received_qty, rejected_qty,
                    line.get('rejectionNote'), price))
        if order_id:
            db.execute('UPDATE PurchaseOrderLine SET ReceivedQty=ReceivedQty+? WHERE OrderID=? AND ProductID=?',
                       (received_qty, order_id, pid))
    require(line_no > 0, '没有有效的收货行')
    # 验收结论与差异说明
    if diff_count and result == '合格':
        db.execute('UPDATE ReceiptNote SET InspectionResult="有差异（已登记）", DiffNote=? WHERE ReceiptID=?',
                   ('共 %d 行与订货不一致，差异已随单登记' % diff_count, rid))
    # 订货单状态
    if order_id:
        remain = db.scalar('SELECT COALESCE(SUM(Quantity - ReceivedQty),0) FROM PurchaseOrderLine '
                           'WHERE OrderID=?', (order_id,))
        db.execute('UPDATE PurchaseOrder SET OrderStatus=? WHERE OrderID=?',
                   ('Received' if remain <= 0.001 else 'Partial', order_id))
    # 进货查验凭证（可在收货时一并登记）
    insp = data.get('inspection') or {}
    if insp.get('certificateNo') or insp.get('licenceNo'):
        db.insert('INSERT INTO IncomingInspection (ReceiptID, SupplierID, RecordedBy, LicenceNo, '
                  'CertificateType, CertificateNo, ValidUntil, RecordedAt, Status, Note) '
                  'VALUES (?,?,?,?,?,?,?,?,?,?)',
                  (rid, supplier_id, req.employee['EmployeeID'], insp.get('licenceNo'),
                   insp.get('certificateType') or '出厂检验合格证明', insp.get('certificateNo'),
                   insp.get('validUntil'), now(), 'Complete', None))
    else:
        db.insert('INSERT INTO IncomingInspection (ReceiptID, SupplierID, RecordedBy, RecordedAt, '
                  'Status, Note) VALUES (?,?,?,?,?,?)',
                  (rid, supplier_id, req.employee['EmployeeID'], now(), 'Missing',
                   '收货时未提供查验凭证，已登记待补交'))
    write_audit(req, '登记收货与验收', 'ReceiptNote', rid,
                '%s 共 %d 行，差异 %d 行' % (receipt_no, line_no, diff_count))
    return ok({'receiptId': rid, 'receiptNo': receipt_no, 'diffLines': diff_count,
               'message': '收货单已保存，进货批次与库存台账已更新'})


@api.post('/api/receipts/<int:rid>/inspection', roles=(OWNER, STOCKER))
def save_inspection(req):
    rid = integer(req.params['rid'], '收货单编号')
    note = db.query_one('SELECT * FROM ReceiptNote WHERE ReceiptID=?', (rid,))
    require(note is not None, '收货单不存在', 404)
    data = req.body
    existing = db.query_one('SELECT * FROM IncomingInspection WHERE ReceiptID=?', (rid,))
    status = 'Complete' if (data.get('certificateNo') or data.get('licenceNo')) else 'Missing'
    if existing:
        db.execute('UPDATE IncomingInspection SET LicenceNo=?, CertificateType=?, CertificateNo=?, '
                   'ValidUntil=?, RecordedAt=?, RecordedBy=?, Status=?, Note=? WHERE InspectionID=?',
                   (data.get('licenceNo'), data.get('certificateType') or '出厂检验合格证明',
                    data.get('certificateNo'), data.get('validUntil'), now(),
                    req.employee['EmployeeID'], status, data.get('note'), existing['InspectionID']))
        iid = existing['InspectionID']
    else:
        iid = db.insert(
            'INSERT INTO IncomingInspection (ReceiptID, SupplierID, RecordedBy, LicenceNo, '
            'CertificateType, CertificateNo, ValidUntil, RecordedAt, Status, Note) '
            'VALUES (?,?,?,?,?,?,?,?,?,?)',
            (rid, note['SupplierID'], req.employee['EmployeeID'], data.get('licenceNo'),
             data.get('certificateType') or '出厂检验合格证明', data.get('certificateNo'),
             data.get('validUntil'), now(), status, data.get('note')))
    write_audit(req, '登记进货查验凭证', 'IncomingInspection', iid, '状态 %s' % status)
    return ok({'inspectionId': iid, 'status': status,
               'message': '查验凭证已登记' if status == 'Complete' else '已登记凭证缺失，待补交'})


@api.get('/api/inspections', roles=(OWNER, STOCKER))
def list_inspections(req):
    status = req.q('status')
    where = ['1=1']
    params = []
    if status in ('Complete', 'Missing'):
        where.append('i.Status=?')
        params.append(status)
    if req.q('expiring') == '1':
        where.append('i.ValidUntil IS NOT NULL AND i.ValidUntil <= date("now","localtime","+30 days")')
    rows = db.query(
        'SELECT i.*, s.Name AS SupplierName, n.ReceiptNo, n.ReceivedAt, e.Name AS RecordedByName '
        'FROM IncomingInspection i JOIN Supplier s ON s.SupplierID=i.SupplierID '
        'JOIN ReceiptNote n ON n.ReceiptID=i.ReceiptID '
        'LEFT JOIN Employee e ON e.EmployeeID=i.RecordedBy '
        'WHERE ' + ' AND '.join(where) + ' ORDER BY i.RecordedAt DESC LIMIT 100', params)
    items = db.rows_to_dict(rows)
    for it in items:
        it['expiringSoon'] = bool(it['ValidUntil'] and it['ValidUntil'] <=
                                  (date.today() + timedelta(days=30)).isoformat())
    return ok({'items': items,
               'summary': {
                   'complete': db.scalar("SELECT COUNT(*) FROM IncomingInspection WHERE Status='Complete'"),
                   'missing': db.scalar("SELECT COUNT(*) FROM IncomingInspection WHERE Status='Missing'"),
                   'expiring': db.scalar("SELECT COUNT(*) FROM IncomingInspection WHERE ValidUntil IS NOT NULL "
                                         "AND ValidUntil <= date('now','localtime','+30 days')"),
               }})
