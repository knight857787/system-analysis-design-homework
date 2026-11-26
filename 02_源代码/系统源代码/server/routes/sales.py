"""销售与收款（UC-16）：按批次先进先出扣减、成本快照、多支付方式、赊账销售。"""
from datetime import datetime

from server import db
from server.core import (ALL_ROLES, OWNER, SALESPERSON, STAFF, api, bad, doc_no, integer, money, now,
                         num, ok, require, text, today, write_audit)


def markdown_price_for_batch(batch_id):
    row = db.query_one(
        'SELECT p.MarkdownPrice FROM MarkdownPlan p JOIN HandlingLine l '
        'ON l.HandlingID=p.HandlingID AND l.LineNo=p.LineNo '
        'WHERE l.BatchID=? AND p.PlanStatus="Confirmed" AND p.PriceTagStatus="Applied" '
        'ORDER BY p.PlanID DESC LIMIT 1', (batch_id,))
    return row['MarkdownPrice'] if row else None


def take_stock(product_id, quantity):
    """按到期日先进先出扣减，返回 [{batchId, qty, cost, price}]。"""
    batches = db.query(
        'SELECT s.*, b.PurchasePrice FROM vStockSellable s JOIN PurchaseBatch b ON b.BatchID=s.BatchID '
        'WHERE s.ProductID=? AND s.SellableQty > 0.0001 ORDER BY b.ExpiryDate ASC, s.BatchID ASC',
        (product_id,))
    remaining = quantity
    picked = []
    for b in batches:
        if remaining <= 0.0001:
            break
        take = min(remaining, b['SellableQty'])
        if take <= 0:
            continue
        picked.append({'batchId': b['BatchID'], 'qty': round(take, 3),
                       'cost': b['PurchasePrice'], 'location': b['Location'],
                       'expiry': b['ExpiryDate']})
        remaining = round(remaining - take, 3)
    return picked, remaining


def prepare_sale_lines(lines):
    """完成不落库的批次定价与库存校验，供报价和正式开单共用。"""
    require(isinstance(lines, list) and lines, '购物车为空，请先选择商品')
    prepared = []
    total = 0.0
    cost_total = 0.0
    for line in lines:
        pid = integer(line.get('productId'), '商品编号', minimum=1)
        quantity = num(line.get('quantity'), '数量', minimum=0.001)
        product = db.query_one('SELECT * FROM Product WHERE ProductID=?', (pid,))
        require(product is not None, '商品不存在：%s' % pid)
        require(product['OnShelfFlag'] == 'Y', '商品「%s」已下架，不能销售' % product['ProductName'])
        picked, missing = take_stock(pid, quantity)
        if missing > 0.0001:
            available = round(quantity - missing, 3)
            bad('「%s」可售库存不足：需要 %.3f%s，可售 %.3f%s'
                % (product['ProductName'], quantity, product['Unit'], available, product['Unit']))
        for chunk in picked:
            md_price = markdown_price_for_batch(chunk['batchId'])
            price = md_price if md_price is not None else num(
                line.get('unitPrice') or product['ListPrice'], '单价', minimum=0)
            amount = money(price * chunk['qty'])
            chunk.update({'productId': pid, 'price': price, 'amount': amount,
                          'cost': money(chunk['cost'] * chunk['qty']),
                          'markdown': md_price is not None})
            total += amount
            cost_total += chunk['cost']
            prepared.append(chunk)
    return prepared, money(total), money(cost_total)


@api.post('/api/sales', roles=(OWNER, SALESPERSON))
def create_sale(req):
    data = req.body
    lines = data.get('lines') or []
    customer_id = data.get('customerId') or None
    if customer_id:
        require(db.query_one('SELECT 1 FROM Customer WHERE CustomerID=?', (customer_id,)), '顾客不存在')
    occurs = data.get('occurredAt') or now()
    discount = num(data.get('discountAmount') or 0, '折扣金额', minimum=0)
    credit_amount = num(data.get('creditAmount') or 0, '挂账金额', minimum=0)
    sale_no = doc_no('XS')

    prepared, total, cost_total = prepare_sale_lines(lines)
    require(total >= discount, '折扣金额不能大于销售额')
    net = money(total - discount)
    require(credit_amount <= net, '挂账金额不能大于应收金额')
    paid = money(net - credit_amount)

    pays = data.get('pays') or []
    if not pays and paid > 0:
        pays = [{'method': data.get('payMethod') or '现金', 'amount': paid}]
    pay_sum = round(sum(float(p.get('amount') or 0) for p in pays), 2)
    if paid > 0:
        require(abs(pay_sum - paid) <= 0.02,
                '支付金额（%.2f）与应收（%.2f）不一致' % (pay_sum, paid))
    if credit_amount > 0 and not customer_id:
        bad('挂账销售必须选择顾客')

    sale_id = db.insert(
        'INSERT INTO SaleOrder (SaleNo, CashierID, CustomerID, OccurredAt, TotalAmount, DiscountAmount, '
        'PaidAmount, CreditAmount, CostAmount, ProfitAmount, PayStatus, Note) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        (sale_no, req.employee['EmployeeID'], customer_id, occurs, total, discount, paid,
         credit_amount, money(cost_total), money(net - cost_total),
         'Credit' if credit_amount > 0 else 'Paid', data.get('note')))
    line_no = 0
    for chunk in prepared:
        line_no += 1
        db.execute('INSERT INTO SaleLine (SaleID, LineNo, ProductID, BatchID, Quantity, UnitPrice, '
                   'Amount, DiscountAmount, UnitCost, CostAmount) VALUES (?,?,?,?,?,?,?,?,?,?)',
                   (sale_id, line_no, chunk['productId'], chunk['batchId'], chunk['qty'],
                    chunk['price'], chunk['amount'], 0, chunk['cost'] / chunk['qty'] if chunk['qty'] else 0,
                    chunk['cost']))
        db.execute('UPDATE StockLedger SET Quantity=Quantity-?, UpdatedAt=? WHERE ProductID=? AND BatchID=?',
                   (chunk['qty'], now(), chunk['productId'], chunk['batchId']))
        db.execute('INSERT INTO StockMovement (ProductID, BatchID, MoveType, Quantity, RefType, RefID, '
                   'RefNo, OccurredAt, OperatorID, Note) VALUES (?,?,?,?,?,?,?,?,?,?)',
                   (chunk['productId'], chunk['batchId'], 'Sale', -chunk['qty'], 'SaleOrder', sale_id,
                    sale_no, occurs, req.employee['EmployeeID'],
                    '折价销售' if chunk['markdown'] else None))
    for pay in pays:
        amount = num(pay.get('amount'), '支付金额', minimum=0)
        if amount <= 0:
            continue
        db.execute('INSERT INTO PayRecord (SaleID, PayMethod, PayAmount, PaidAt, TradeNo) '
                   'VALUES (?,?,?,?,?)',
                   (sale_id, pay.get('method') or '现金', amount, occurs, pay.get('tradeNo')))

    # 赊账销售：写入赊账流水（额度校核）
    if credit_amount > 0:
        cust = db.query_one('SELECT * FROM Customer WHERE CustomerID=?', (customer_id,))
        acc = db.query_one('SELECT * FROM CreditAccount WHERE CustomerID=?', (customer_id,))
        if acc is None:
            db.insert('INSERT INTO CreditAccount (AccountNo, CustomerID, UsedAmount) VALUES (?,?,0)',
                      ('CA%05d' % customer_id, customer_id))
            acc = db.query_one('SELECT * FROM CreditAccount WHERE CustomerID=?', (customer_id,))
        outstanding = db.scalar('SELECT COALESCE(SUM(Amount - SettledAmount),0) FROM CreditEntry '
                               'WHERE AccountID=? AND EntryType="charge" AND RecordStatus="A"',
                               (acc['AccountID'],))
        limit = cust['CreditLimit'] or 0
        if limit > 0 and outstanding + credit_amount > limit + 0.001 and req.employee['Role'] != OWNER:
            bad('超出约定额度：已用 %.2f，额度 %.2f，本次挂账 %.2f，请老板确认后再挂账'
                % (outstanding, limit, credit_amount))
        due = data.get('dueDate')
        if not due:
            from datetime import timedelta
            due = (datetime.now() + timedelta(days=cust['CreditTermDays'] or 30)).strftime('%Y-%m-%d')
        db.insert('INSERT INTO CreditEntry (EntryNo, AccountID, RegisteredBy, EntryType, Amount, '
                  'SettledAmount, DueDate, Remark, ChargeRef) VALUES (?,?,?,?,?,?,?,?,?)',
                  (doc_no('CG'), acc['AccountID'], req.employee['EmployeeID'], 'charge',
                   credit_amount, 0, due, '收银挂账 %s' % sale_no, sale_no))
        db.execute('UPDATE CreditAccount SET UsedAmount=?, AccountStatus="Normal" WHERE AccountID=?',
                   (money(outstanding + credit_amount), acc['AccountID']))

    # 会员积分（1 元 = 1 分）
    member = db.query_one('SELECT * FROM Member WHERE CustomerID=? AND RecordStatus="A"', (customer_id,)) \
        if customer_id else None
    if member and net > 0:
        points = int(net)
        if points > 0:
            db.insert('INSERT INTO PointEntry (MemberID, EntryType, Points, OccurredAt, OrderRef, Note) '
                      'VALUES (?,?,?,?,?,?)',
                      (member['MemberID'], 'earn', points, occurs, sale_no, '消费积分'))
            db.execute('UPDATE Member SET Points=Points+?, LastVisitDate=? WHERE MemberID=?',
                       (points, occurs[:10], member['MemberID']))
    write_audit(req, '记录销售与收款', 'SaleOrder', sale_id,
                '%s 金额 %.2f，%d 行，支付 %s' % (sale_no, net, line_no,
                                                 ','.join('%s%.2f' % (p.get('method'), p.get('amount') or 0)
                                                          for p in pays) or '挂账'))
    return ok({'saleId': sale_id, 'saleNo': sale_no, 'total': net, 'discount': discount,
               'paid': paid, 'credit': credit_amount, 'cost': money(cost_total),
               'profit': money(net - cost_total), 'lines': line_no,
               'change': money(max(0, pay_sum - paid)) if paid else 0,
               'message': '收款成功，库存已按批次扣减'})


@api.post('/api/sales/quote', roles=(OWNER, SALESPERSON), audit=False)
def quote_sale(req):
    """按实际可售批次返回实时应收，避免临期折价批次与购物车展示价不一致。"""
    lines = req.body.get('lines') or []
    discount = num(req.body.get('discountAmount') or 0, '折扣金额', minimum=0)
    prepared, subtotal, cost = prepare_sale_lines(lines)
    require(subtotal >= discount, '折扣金额不能大于销售额')
    net = money(subtotal - discount)
    aggregated = {}
    for chunk in prepared:
        key = chunk['productId']
        item = aggregated.setdefault(key, {
            'productId': key, 'quantity': 0.0, 'amount': 0.0, 'cost': 0.0,
            'markdown': False,
        })
        item['quantity'] = round(item['quantity'] + chunk['qty'], 3)
        item['amount'] = money(item['amount'] + chunk['amount'])
        item['cost'] = money(item['cost'] + chunk['cost'])
        item['markdown'] = item['markdown'] or chunk['markdown']
    for item in aggregated.values():
        item['unitPrice'] = money(item['amount'] / item['quantity']) if item['quantity'] else 0
    return ok({'subtotal': subtotal, 'discount': discount, 'net': net, 'cost': cost,
               'lines': list(aggregated.values())})


@api.get('/api/sales', roles=(OWNER, SALESPERSON))
def list_sales(req):
    page, size = req.page_args(20)
    where = ['1=1']
    params = []
    if req.q('date'):
        where.append('date(o.OccurredAt)=?')
        params.append(req.q('date'))
    if req.q('from'):
        where.append('date(o.OccurredAt) >= ?')
        params.append(req.q('from'))
    if req.q('to'):
        where.append('date(o.OccurredAt) <= ?')
        params.append(req.q('to'))
    if req.q('q'):
        where.append('o.SaleNo LIKE ?')
        params.append('%' + req.q('q') + '%')
    if req.role() == SALESPERSON:
        where.append('o.CashierID=?')  # 销售人员只看本人经手的单
        params.append(req.employee['EmployeeID'])
    cond = ' AND '.join(where)
    total = db.scalar('SELECT COUNT(*) FROM SaleOrder o WHERE ' + cond, params)
    rows = db.query(
        'SELECT o.*, e.Name AS CashierName, c.Name AS CustomerName, '
        '(SELECT COUNT(*) FROM SaleLine l WHERE l.SaleID=o.SaleID) AS LineCount, '
        '(SELECT GROUP_CONCAT(DISTINCT p.PayMethod) FROM PayRecord p WHERE p.SaleID=o.SaleID) AS PayMethods '
        'FROM SaleOrder o LEFT JOIN Employee e ON e.EmployeeID=o.CashierID '
        'LEFT JOIN Customer c ON c.CustomerID=o.CustomerID '
        'WHERE ' + cond + ' ORDER BY o.OccurredAt DESC LIMIT ? OFFSET ?',
        params + [size, (page - 1) * size])
    return ok({'items': db.rows_to_dict(rows), 'total': total, 'page': page, 'size': size})


@api.get('/api/sales/<int:sid>', roles=(OWNER, SALESPERSON))
def sale_detail(req):
    sid = integer(req.params['sid'], '销售单编号')
    head = db.query_one(
        'SELECT o.*, e.Name AS CashierName, c.Name AS CustomerName, c.Phone FROM SaleOrder o '
        'LEFT JOIN Employee e ON e.EmployeeID=o.CashierID '
        'LEFT JOIN Customer c ON c.CustomerID=o.CustomerID WHERE o.SaleID=?', (sid,))
    require(head is not None, '销售单不存在', 404)
    if req.role() == SALESPERSON:
        require(head['CashierID'] == req.employee['EmployeeID'], '只能查看本人经手的销售单', 403)
    lines = db.rows_to_dict(db.query(
        'SELECT l.*, p.ProductName, p.Specification, p.Unit, b.BatchNo, b.ExpiryDate, '
        'ROUND(l.Amount - l.CostAmount,2) AS Profit FROM SaleLine l '
        'JOIN Product p ON p.ProductID=l.ProductID LEFT JOIN PurchaseBatch b ON b.BatchID=l.BatchID '
        'WHERE l.SaleID=? ORDER BY l.LineNo', (sid,)))
    pays = db.rows_to_dict(db.query('SELECT * FROM PayRecord WHERE SaleID=?', (sid,)))
    return ok({'sale': db.row_to_dict(head), 'lines': lines, 'pays': pays})


@api.get('/api/sales/daily-summary', roles=(OWNER, SALESPERSON))
def daily_summary(req):
    day = req.q('date') or today()
    head = db.query_one(
        'SELECT COUNT(*) AS Orders, ROUND(COALESCE(SUM(TotalAmount),0),2) AS Amount, '
        'ROUND(COALESCE(SUM(CostAmount),0),2) AS Cost, ROUND(COALESCE(SUM(ProfitAmount),0),2) AS Profit, '
        'ROUND(COALESCE(SUM(CreditAmount),0),2) AS Credit '
        'FROM SaleOrder WHERE date(OccurredAt)=? AND RecordStatus="A"', (day,))
    pays = db.rows_to_dict(db.query(
        'SELECT p.PayMethod AS method, ROUND(SUM(p.PayAmount),2) AS amount FROM PayRecord p '
        'JOIN SaleOrder o ON o.SaleID=p.SaleID WHERE date(o.OccurredAt)=? GROUP BY p.PayMethod', (day,)))
    hourly = db.rows_to_dict(db.query(
        "SELECT strftime('%H', OccurredAt) AS hour, ROUND(SUM(TotalAmount),2) AS amount, COUNT(*) AS orders "
        "FROM SaleOrder WHERE date(OccurredAt)=? GROUP BY hour ORDER BY hour", (day,)))
    return ok({'date': day, 'orders': head['Orders'], 'amount': head['Amount'],
               'cost': head['Cost'], 'profit': head['Profit'],
               'margin': round((head['Profit'] or 0) / head['Amount'] * 100, 1) if head['Amount'] else 0,
               'credit': head['Credit'], 'pays': pays, 'hourly': hourly,
               'cashTotal': round(sum(p['amount'] for p in pays if p['method'] == '现金'), 2)})
