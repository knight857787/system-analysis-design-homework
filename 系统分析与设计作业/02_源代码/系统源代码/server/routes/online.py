"""线上订单（UC-11 提交、UC-12 处理）：可售校验、占用库存、拣货、交付、取消。"""
from datetime import datetime, timedelta

from server import db
from server.core import (ALL_ROLES, OWNER, SALESPERSON, STAFF, STOCKER, api, bad, doc_no, integer,
                         money, now, num, ok, require, text, today, write_audit)
from server.routes.sales import take_stock

CHANNEL_LABEL = {'group': '微信群', 'miniProgram': '小程序', 'platform': '第三方平台'}
STATUS_LABEL = {'Pending': '待拣货', 'Picked': '已拣货待交付', 'Completed': '已完成', 'Cancelled': '已取消'}


def reserve(product_id, quantity):
    picked, missing = take_stock(product_id, quantity)
    if missing > 0.0001:
        product = db.query_one('SELECT * FROM Product WHERE ProductID=?', (product_id,))
        available = round(quantity - missing, 3)
        bad('「%s」可售数量不足：需要 %.3f%s，可售 %.3f%s（线上与门店共用一份库存）'
            % (product['ProductName'], quantity, product['Unit'], available, product['Unit']))
    for chunk in picked:
        db.execute('UPDATE StockLedger SET ReservedQty = ReservedQty + ? WHERE ProductID=? AND BatchID=?',
                   (chunk['qty'], product_id, chunk['batchId']))
    return picked


@api.get('/api/online-orders', roles=(OWNER, STOCKER, SALESPERSON))
def list_orders(req):
    page, size = req.page_args(20)
    where = ['1=1']
    params = []
    status = req.q('status')
    if status in ('Pending', 'Picked', 'Completed', 'Cancelled'):
        where.append('o.OrderStatus=?')
        params.append(status)
    if req.q('date'):
        where.append('date(o.PlacedAt)=?')
        params.append(req.q('date'))
    cond = ' AND '.join(where)
    total = db.scalar('SELECT COUNT(*) FROM OnlineOrder o WHERE ' + cond, params)
    rows = db.query(
        'SELECT o.*, c.Name AS CustomerName, c.Phone, e.Name AS ConfirmerName, '
        '(SELECT COUNT(*) FROM OnlineOrderLine l WHERE l.OrderID=o.OrderID) AS LineCount '
        'FROM OnlineOrder o JOIN Customer c ON c.CustomerID=o.CustomerID '
        'LEFT JOIN Employee e ON e.EmployeeID=o.ConfirmedBy '
        'WHERE ' + cond + ' ORDER BY o.PlacedAt DESC LIMIT ? OFFSET ?',
        params + [size, (page - 1) * size])
    items = db.rows_to_dict(rows)
    for it in items:
        it['channelLabel'] = CHANNEL_LABEL.get(it['Channel'], it['Channel'])
        it['statusLabel'] = STATUS_LABEL.get(it['OrderStatus'], it['OrderStatus'])
    return ok({'items': items, 'total': total, 'page': page, 'size': size,
               'summary': {
                   'pending': db.scalar("SELECT COUNT(*) FROM OnlineOrder WHERE OrderStatus='Pending'"),
                   'picked': db.scalar("SELECT COUNT(*) FROM OnlineOrder WHERE OrderStatus='Picked'"),
                   'today': db.scalar("SELECT COUNT(*) FROM OnlineOrder WHERE date(PlacedAt)=date('now','localtime')"),
                   'todayAmount': db.scalar("SELECT ROUND(COALESCE(SUM(TotalAmount),0),2) FROM OnlineOrder "
                                            "WHERE date(PlacedAt)=date('now','localtime') AND RecordStatus='A'"),
               }})


@api.get('/api/online-orders/<int:oid>', roles=(OWNER, STOCKER, SALESPERSON))
def order_detail(req):
    oid = integer(req.params['oid'], '订单编号')
    head = db.query_one(
        'SELECT o.*, c.Name AS CustomerName, c.Phone, c.Address, e.Name AS ConfirmerName '
        'FROM OnlineOrder o JOIN Customer c ON c.CustomerID=o.CustomerID '
        'LEFT JOIN Employee e ON e.EmployeeID=o.ConfirmedBy WHERE o.OrderID=?', (oid,))
    require(head is not None, '订单不存在', 404)
    lines = db.rows_to_dict(db.query(
        'SELECT l.*, p.ProductName, p.Specification, p.Unit, p.ListPrice, b.BatchNo, b.ExpiryDate, '
        'sl.Location, ps.ProductName AS SubstitutedName '
        'FROM OnlineOrderLine l JOIN Product p ON p.ProductID=l.ProductID '
        'LEFT JOIN PurchaseBatch b ON b.BatchID=l.BatchID '
        'LEFT JOIN StockLedger sl ON sl.ProductID=l.ProductID AND sl.BatchID=l.BatchID '
        'LEFT JOIN Product ps ON ps.ProductID=l.SubstitutedProductID '
        'WHERE l.OrderID=? ORDER BY l.LineNo', (oid,)))
    logs = db.rows_to_dict(db.query(
        'SELECT f.*, e.Name AS HandlerName FROM FulfilmentLog f '
        'LEFT JOIN Employee e ON e.EmployeeID=f.HandledBy WHERE f.OrderID=? ORDER BY f.OccurredAt', (oid,)))
    data = db.row_to_dict(head)
    data['channelLabel'] = CHANNEL_LABEL.get(data['Channel'], data['Channel'])
    data['statusLabel'] = STATUS_LABEL.get(data['OrderStatus'], data['OrderStatus'])
    return ok({'order': data, 'lines': lines, 'logs': logs})


@api.post('/api/online-orders', roles=(OWNER, SALESPERSON, STOCKER))
def create_order(req):
    data = req.body
    lines = data.get('lines') or []
    require(isinstance(lines, list) and lines, '订单至少需要一个商品')
    customer_id = data.get('customerId')
    if not customer_id:
        name = text(data.get('customerName'), '顾客称呼', maxlen=32)
        phone = text(data.get('customerPhone'), '手机号', required=False, maxlen=20)
        customer_id = db.insert('INSERT INTO Customer (Name, Phone, CreditLimit, CreditTermDays) '
                                'VALUES (?,?,0,30)', (name, phone))
    cust = db.query_one('SELECT * FROM Customer WHERE CustomerID=?', (customer_id,))
    require(cust is not None, '顾客不存在')
    channel = data.get('channel') or 'group'
    require(channel in CHANNEL_LABEL, '渠道取值不合法')
    promised = data.get('promisedAt') or (datetime.now() + timedelta(hours=2)).strftime('%Y-%m-%d %H:%M:%S')
    order_no = doc_no('WM')
    order_id = db.insert(
        'INSERT INTO OnlineOrder (OrderNo, CustomerID, ConfirmedBy, Channel, PlacedAt, PromisedAt, '
        'OrderStatus, TotalAmount, FulfilMethod, PickupCode, ClientNo, Note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        (order_no, customer_id, req.employee['EmployeeID'], channel, now(), promised, 'Pending', 0,
         data.get('fulfilMethod') or '自提',
         '%04d' % (int(datetime.now().timestamp()) % 10000),
         'DEV01-' + now().replace('-', '').replace(':', '').replace(' ', ''), data.get('note')))
    line_no = 0
    total = 0.0
    for line in lines:
        pid = integer(line.get('productId'), '商品编号', minimum=1)
        quantity = num(line.get('quantity'), '数量', minimum=0.001)
        product = db.query_one('SELECT * FROM Product WHERE ProductID=?', (pid,))
        require(product is not None, '商品不存在')
        require(product['OnShelfFlag'] == 'Y', '商品「%s」已下架' % product['ProductName'])
        price = num(line.get('unitPrice') or product['ListPrice'], '单价', minimum=0)
        chunks = reserve(pid, quantity)
        for chunk in chunks:
            line_no += 1
            amount = money(price * chunk['qty'])
            total += amount
            db.execute('INSERT INTO OnlineOrderLine (OrderID, LineNo, ProductID, BatchID, Quantity, '
                       'UnitPrice, PickedQty, ShortQty, LineStatus) VALUES (?,?,?,?,?,?,0,0,?)',
                       (order_id, line_no, pid, chunk['batchId'], chunk['qty'], price, 'Pending'))
    db.execute('UPDATE OnlineOrder SET TotalAmount=? WHERE OrderID=?', (money(total), order_id))
    db.insert('INSERT INTO FulfilmentLog (OrderID, HandledBy, Action, OccurredAt, Note) '
              'VALUES (?,?,?,?,?)',
              (order_id, req.employee['EmployeeID'], 'create', now(),
               '订单已提交，可售数量已校验并占用库存'))
    write_audit(req, '提交线上订单', 'OnlineOrder', order_id,
                '%s 共 %d 行，金额 %.2f' % (order_no, line_no, total))
    return ok({'orderId': order_id, 'orderNo': order_no, 'total': money(total), 'lines': line_no,
               'pickupCode': db.query_one('SELECT PickupCode FROM OnlineOrder WHERE OrderID=?',
                                          (order_id,))['PickupCode'],
               'message': '订单已确认，可售数量已校验，库存已占用'})


@api.get('/api/online-orders/pick-list', roles=(OWNER, STOCKER, SALESPERSON))
def pick_list(req):
    rows = db.rows_to_dict(db.query(
        'SELECT l.OrderID, l.LineNo, l.ProductID, l.BatchID, l.Quantity, l.UnitPrice, '
        'p.ProductName, p.Specification, p.Unit, s.Location, b.ExpiryDate, '
        'CAST(julianday(b.ExpiryDate)-julianday(date("now","localtime")) AS INTEGER) AS RemainDays, '
        'o.OrderNo, o.PromisedAt, o.FulfilMethod, c.Name AS CustomerName '
        'FROM OnlineOrderLine l JOIN OnlineOrder o ON o.OrderID=l.OrderID '
        'JOIN Product p ON p.ProductID=l.ProductID JOIN Customer c ON c.CustomerID=o.CustomerID '
        'LEFT JOIN StockLedger s ON s.ProductID=l.ProductID AND s.BatchID=l.BatchID '
        'LEFT JOIN PurchaseBatch b ON b.BatchID=l.BatchID '
        'WHERE o.OrderStatus="Pending" ORDER BY o.PromisedAt ASC, s.Location ASC'))
    return ok({'items': rows})


@api.post('/api/online-orders/<int:oid>/pick', roles=(OWNER, STOCKER))
def pick_order(req):
    oid = integer(req.params['oid'], '订单编号')
    order = db.query_one('SELECT * FROM OnlineOrder WHERE OrderID=?', (oid,))
    require(order is not None, '订单不存在', 404)
    require(order['OrderStatus'] == 'Pending', '订单当前状态不可拣货（%s）' % status_label(order['OrderStatus']))
    picks = req.body.get('lines') or []
    require(isinstance(picks, list) and picks, '请登记拣货结果')
    for pick in picks:
        line_no = integer(pick.get('lineNo'), '行号', minimum=1)
        line = db.query_one('SELECT * FROM OnlineOrderLine WHERE OrderID=? AND LineNo=?', (oid, line_no))
        if line is None:
            continue
        picked = num(pick.get('pickedQty'), '拣货数量', minimum=0)
        require(picked <= line['Quantity'] + 0.001, '拣货数量不能大于订单数量')
        short = round(line['Quantity'] - picked, 3)
        # 释放缺货部分的占用
        if short > 0.0001 and line['BatchID']:
            db.execute('UPDATE StockLedger SET ReservedQty = MAX(0, ReservedQty - ?) '
                       'WHERE ProductID=? AND BatchID=?', (short, line['ProductID'], line['BatchID']))
        sub = pick.get('substitutedProductId') or None
        status = 'Short' if short > 0.0001 else 'Picked'
        db.execute('UPDATE OnlineOrderLine SET PickedQty=?, ShortQty=?, LineStatus=?, '
                   'SubstitutedProductID=? WHERE OrderID=? AND LineNo=?',
                   (picked, short, status, sub, oid, line_no))
        db.insert('INSERT INTO FulfilmentLog (OrderID, LineNo, HandledBy, Action, OccurredAt, Note) '
                  'VALUES (?,?,?,?,?,?)',
                  (oid, line_no, req.employee['EmployeeID'], 'pick', now(),
                   '拣货 %s%s' % (picked, '，缺货 %s' % short if short else '')))
        if sub:
            db.insert('INSERT INTO FulfilmentLog (OrderID, LineNo, HandledBy, Action, OccurredAt, Note) '
                      'VALUES (?,?,?,?,?,?)',
                      (oid, line_no, req.employee['EmployeeID'], 'substitute', now(), '顾客接受替代商品'))
    db.execute('UPDATE OnlineOrder SET OrderStatus="Picked" WHERE OrderID=?', (oid,))
    db.insert('INSERT INTO FulfilmentLog (OrderID, HandledBy, Action, OccurredAt, Note) '
              'VALUES (?,?,?,?,?)',
              (oid, req.employee['EmployeeID'], 'picked_all', now(), '拣货完成，可通知顾客取货'))
    write_audit(req, '处理线上订单', 'OnlineOrder', oid, '拣货完成')
    return ok({'message': '拣货完成，缺货已释放占用，取货码 %s' % order['PickupCode'],
               'pickupCode': order['PickupCode']})


@api.post('/api/online-orders/<int:oid>/deliver', roles=(OWNER, SALESPERSON))
def deliver_order(req):
    oid = integer(req.params['oid'], '订单编号')
    order = db.query_one('SELECT * FROM OnlineOrder WHERE OrderID=?', (oid,))
    require(order is not None, '订单不存在', 404)
    require(order['OrderStatus'] == 'Picked', '订单未拣货，不能交付')
    method = req.f('payMethod') or '银豹付'
    paid = num(req.f('paidAmount') or order['TotalAmount'], '收款金额', minimum=0)
    lines = db.query('SELECT * FROM OnlineOrderLine WHERE OrderID=?', (oid,))
    cost = 0.0
    for line in lines:
        picked = line['PickedQty'] or 0
        if picked <= 0:
            db.execute('UPDATE OnlineOrderLine SET LineStatus="Cancelled" WHERE OrderID=? AND LineNo=?',
                       (oid, line['LineNo']))
            continue
        ledger = db.query_one('SELECT * FROM StockLedger WHERE ProductID=? AND BatchID=?',
                              (line['ProductID'], line['BatchID']))
        batch = db.query_one('SELECT * FROM PurchaseBatch WHERE BatchID=?', (line['BatchID'],))
        if ledger is None or batch is None:
            continue
        take = min(picked, ledger['Quantity'])
        cost += take * batch['PurchasePrice']
        db.execute('UPDATE StockLedger SET Quantity=MAX(0, Quantity-?), '
                   'ReservedQty=MAX(0, ReservedQty-?) WHERE LedgerID=?', (take, picked, ledger['LedgerID']))
        db.execute('INSERT INTO StockMovement (ProductID, BatchID, MoveType, Quantity, RefType, RefID, '
                   'RefNo, OccurredAt, OperatorID, Note) VALUES (?,?,?,?,?,?,?,?,?,?)',
                   (line['ProductID'], line['BatchID'], 'Sale', -take, 'OnlineOrder', oid,
                    order['OrderNo'], now(), req.employee['EmployeeID'], '线上订单交付'))
    db.execute('UPDATE OnlineOrder SET OrderStatus="Completed", PayMethod=?, PaidAmount=? WHERE OrderID=?',
               (method, paid, oid))
    db.execute('INSERT INTO PayRecord (SaleID, PayMethod, PayAmount, PaidAt, TradeNo) VALUES (NULL,?,?,?,?)',
               (method, paid, now(), order['OrderNo']))
    db.insert('INSERT INTO FulfilmentLog (OrderID, HandledBy, Action, OccurredAt, Note) '
              'VALUES (?,?,?,?,?)',
              (oid, req.employee['EmployeeID'], 'deliver', now(),
               '收款 %.2f（%s）并交付，取货码 %s' % (paid, method, order['PickupCode'])))
    # 会员积分
    member = db.query_one('SELECT * FROM Member WHERE CustomerID=? AND RecordStatus="A"',
                          (order['CustomerID'],))
    if member and paid > 0:
        db.insert('INSERT INTO PointEntry (MemberID, EntryType, Points, OccurredAt, OrderRef, Note) '
                  'VALUES (?,?,?,?,?,?)',
                  (member['MemberID'], 'earn', int(paid), now(), order['OrderNo'], '线上订单消费积分'))
        db.execute('UPDATE Member SET Points=Points+?, LastVisitDate=? WHERE MemberID=?',
                   (int(paid), today(), member['MemberID']))
    write_audit(req, '交付线上订单', 'OnlineOrder', oid, '收款 %.2f，成本 %.2f' % (paid, cost))
    return ok({'message': '订单已完成交付，线上占用库存已扣减', 'paidAmount': paid})


@api.post('/api/online-orders/<int:oid>/cancel', roles=(OWNER, SALESPERSON))
def cancel_order(req):
    oid = integer(req.params['oid'], '订单编号')
    order = db.query_one('SELECT * FROM OnlineOrder WHERE OrderID=?', (oid,))
    require(order is not None, '订单不存在', 404)
    require(order['OrderStatus'] in ('Pending', 'Picked'), '订单已完成或已取消')
    for line in db.query('SELECT * FROM OnlineOrderLine WHERE OrderID=?', (oid,)):
        release = line['PickedQty'] or line['Quantity'] or 0
        if line['BatchID'] and release:
            db.execute('UPDATE StockLedger SET ReservedQty=MAX(0, ReservedQty-?) WHERE ProductID=? AND BatchID=?',
                       (release, line['ProductID'], line['BatchID']))
    db.execute('UPDATE OnlineOrder SET OrderStatus="Cancelled" WHERE OrderID=?', (oid,))
    db.insert('INSERT INTO FulfilmentLog (OrderID, HandledBy, Action, OccurredAt, Note) '
              'VALUES (?,?,?,?,?)', (oid, req.employee['EmployeeID'], 'cancel', now(),
                                     req.f('reason') or '取消订单，占用库存已释放'))
    write_audit(req, '取消线上订单', 'OnlineOrder', oid, req.f('reason') or '')
    return ok({'message': '订单已取消，线上占用库存已释放'})


def status_label(status):
    return STATUS_LABEL.get(status, status)
