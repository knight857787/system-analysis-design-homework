"""商品档案（UC-09）、商品类别、折价规则。"""
from server import db
from server.core import (ALL_ROLES, OWNER, STOCKER, api, bad, integer, money, num, ok,
                         require, text, write_audit)


@api.get('/api/products', roles=ALL_ROLES)
def list_products(req):
    page, size = req.page_args(20)
    q = (req.q('q') or '').strip()
    category_id = req.qint('categoryId')
    on_shelf = req.q('onShelf')
    low = req.q('lowStock') == '1'
    where = ['p.RecordStatus = "A"']
    params = []
    if q:
        where.append('(p.ProductName LIKE ? OR p.Barcode LIKE ? OR p.Specification LIKE ?)')
        like = '%' + q + '%'
        params += [like, like, like]
    if category_id:
        where.append('v.CategoryID = ?')
        params.append(category_id)
    if on_shelf in ('Y', 'N'):
        where.append('v.OnShelfFlag = ?')
        params.append(on_shelf)
    if low:
        where.append('v.StockQty <= 3')
    cond = ' AND '.join(where)
    total = db.scalar('SELECT COUNT(*) FROM vProductStock v JOIN Product p ON p.ProductID=v.ProductID '
                      'WHERE ' + cond, params)
    rows = db.query(
        'SELECT v.*, p.ShelfLifeDays FROM vProductStock v JOIN Product p ON p.ProductID=v.ProductID '
        'WHERE ' + cond + ' ORDER BY v.CategoryID, v.ProductID LIMIT ? OFFSET ?',
        params + [size, (page - 1) * size])
    items = db.rows_to_dict(rows)
    # 补最近进价与临期信息
    for it in items:
        last = db.query_one('SELECT PurchasePrice FROM PurchaseBatch WHERE ProductID=? AND RecordStatus="A" '
                            'ORDER BY ArrivalDate DESC LIMIT 1', (it['ProductID'],))
        it['LastCost'] = last['PurchasePrice'] if last else None
    return ok({'items': items, 'total': total, 'page': page, 'size': size})


@api.get('/api/products/search', roles=ALL_ROLES)
def search_products(req):
    """收银台/拣货用的即时检索：返回有可售库存的商品（按批次先进先出排序）。"""
    q = (req.q('q') or '').strip()
    limit = min(30, req.qint('limit', 12) or 12)
    params = []
    where = ['p.RecordStatus="A"', 'p.OnShelfFlag="Y"']
    if q:
        where.append('(p.ProductName LIKE ? OR p.Barcode LIKE ?)')
        params += ['%' + q + '%', q + '%']
    rows = db.query(
        'SELECT p.ProductID, p.Barcode, p.ProductName, p.Specification, p.Unit, p.ListPrice, '
        'ROUND(COALESCE(SUM(s.SellableQty),0),3) AS SellableQty, '
        'MIN(s.ExpiryDate) AS NearestExpiry '
        'FROM Product p LEFT JOIN vStockSellable s ON s.ProductID=p.ProductID '
        'WHERE ' + ' AND '.join(where) + ' GROUP BY p.ProductID ORDER BY SellableQty DESC, p.ProductName '
        'LIMIT ?', params + [limit])
    return ok({'items': db.rows_to_dict(rows)})


@api.get('/api/products/<int:pid>', roles=ALL_ROLES)
def product_detail(req):
    pid = integer(req.params['pid'], '商品编号')
    p = db.query_one('SELECT v.*, p.ShelfLifeDays, p.RecordStatus FROM vProductStock v '
                     'JOIN Product p ON p.ProductID=v.ProductID WHERE v.ProductID=?', (pid,))
    if p is None:
        bad('商品不存在', 404)
    batches = db.rows_to_dict(db.query(
        'SELECT s.*, b.BatchNo, b.ProductionDate, b.ShelfLifeDays, b.PurchasePrice, b.ArrivalDate, '
        'CAST(julianday(b.ExpiryDate) - julianday(date("now","localtime")) AS INTEGER) AS RemainDays '
        'FROM vStockSellable s JOIN PurchaseBatch b ON b.BatchID=s.BatchID WHERE s.ProductID=? '
        'ORDER BY b.ExpiryDate', (pid,)))
    movements = db.rows_to_dict(db.query(
        'SELECT * FROM StockMovement WHERE ProductID=? ORDER BY OccurredAt DESC LIMIT 30', (pid,)))
    sales = db.rows_to_dict(db.query(
        'SELECT date(so.OccurredAt) AS d, ROUND(SUM(sl.Quantity),3) AS qty, ROUND(SUM(sl.Amount),2) AS amount '
        'FROM SaleLine sl JOIN SaleOrder so ON so.SaleID=sl.SaleID WHERE sl.ProductID=? '
        'AND so.OccurredAt >= date("now","localtime","-30 days") GROUP BY date(so.OccurredAt) ORDER BY d', (pid,)))
    return ok({'product': db.row_to_dict(p), 'batches': batches, 'movements': movements, 'sales': sales})


@api.post('/api/products', roles=(OWNER,))
def create_product(req):
    data = req.body
    barcode = text(data.get('barcode'), '条码/自编号', maxlen=32)
    exists = db.query_one('SELECT 1 FROM Product WHERE Barcode=?', (barcode,))
    require(exists is None, '条码已存在：%s' % barcode)
    category_id = integer(data.get('categoryId'), '商品类别', minimum=1)
    require(db.query_one('SELECT 1 FROM ProductCategory WHERE CategoryID=?', (category_id,)),
            '商品类别不存在')
    price = num(data.get('listPrice'), '售价', minimum=0)
    shelf = integer(data.get('shelfLifeDays'), '保质期天数', minimum=1)
    pid = db.insert(
        'INSERT INTO Product (CategoryID, Barcode, ProductName, Specification, Unit, ShelfLifeDays, '
        'ListPrice, OnShelfFlag, SupplierID, CreatedBy) VALUES (?,?,?,?,?,?,?,?,?,?)',
        (category_id, barcode, text(data.get('productName'), '商品名称', maxlen=128),
         text(data.get('specification'), '规格', required=False, maxlen=64) or '—',
         text(data.get('unit'), '单位', required=False, maxlen=8) or '件', shelf, price,
         data.get('onShelfFlag') or 'Y', data.get('supplierId') or None,
         req.employee['EmployeeID']))
    write_audit(req, '维护商品档案', 'Product', pid, '新增商品 %s' % data.get('productName'))
    return ok({'productId': pid, 'message': '商品已建档'})


@api.put('/api/products/<int:pid>', roles=(OWNER,))
def update_product(req):
    pid = integer(req.params['pid'], '商品编号')
    row = db.query_one('SELECT * FROM Product WHERE ProductID=?', (pid,))
    require(row is not None, '商品不存在', 404)
    data = req.body
    db.execute(
        'UPDATE Product SET ProductName=?, Specification=?, Unit=?, ShelfLifeDays=?, ListPrice=?, '
        'CategoryID=?, SupplierID=?, UpdatedAt=datetime("now","localtime"), UpdatedBy=? WHERE ProductID=?',
        (text(data.get('productName', row['ProductName']), '商品名称', maxlen=128),
         text(data.get('specification', row['Specification']), '规格', required=False, maxlen=64) or '—',
         text(data.get('unit', row['Unit']), '单位', required=False, maxlen=8) or '件',
         integer(data.get('shelfLifeDays', row['ShelfLifeDays']), '保质期天数', minimum=1),
         num(data.get('listPrice', row['ListPrice']), '售价', minimum=0),
         integer(data.get('categoryId', row['CategoryID']), '商品类别', minimum=1),
         data.get('supplierId', row['SupplierID']) or None,
         req.employee['EmployeeID'], pid))
    write_audit(req, '维护商品档案', 'Product', pid, '修改商品 %s' % data.get('productName'))
    return ok({'message': '商品档案已更新'})


@api.post('/api/products/<int:pid>/shelf', roles=(OWNER,))
def toggle_shelf(req):
    pid = integer(req.params['pid'], '商品编号')
    row = db.query_one('SELECT * FROM Product WHERE ProductID=?', (pid,))
    require(row is not None, '商品不存在', 404)
    flag = (req.f('onShelfFlag') or '').strip()
    require(flag in ('Y', 'N'), '上下架标记只能是 Y 或 N')
    db.execute('UPDATE Product SET OnShelfFlag=?, UpdatedAt=datetime("now","localtime"), UpdatedBy=? '
               'WHERE ProductID=?', (flag, req.employee['EmployeeID'], pid))
    action = '上架' if flag == 'Y' else '下架'
    write_audit(req, action + '商品', 'Product', pid, '%s %s' % (action, row['ProductName']))
    return ok({'message': '商品已%s' % action})


@api.get('/api/categories', roles=ALL_ROLES)
def list_categories(req):
    rows = db.rows_to_dict(db.query(
        'SELECT c.*, (SELECT COUNT(*) FROM Product p WHERE p.CategoryID=c.CategoryID '
        'AND p.RecordStatus="A") AS ProductCount FROM ProductCategory c WHERE c.RecordStatus="A" '
        'ORDER BY c.CategoryID'))
    return ok({'items': rows})


@api.post('/api/categories', roles=(OWNER,))
def create_category(req):
    name = text(req.f('categoryName'), '类别名称', maxlen=64)
    ratio = num(req.f('expiryWarnRatio') or 0.3, '临期预警比例', minimum=0.01)
    require(0 < ratio <= 1, '临期预警比例应在 0～1 之间')
    cid = db.insert('INSERT INTO ProductCategory (CategoryName, ExpiryWarnRatio) VALUES (?,?)', (name, ratio))
    write_audit(req, '维护商品类别', 'ProductCategory', cid, name)
    return ok({'categoryId': cid, 'message': '类别已创建'})


@api.put('/api/categories/<int:cid>', roles=(OWNER,))
def update_category(req):
    cid = integer(req.params['cid'], '类别编号')
    name = text(req.f('categoryName'), '类别名称', maxlen=64)
    ratio = num(req.f('expiryWarnRatio') or 0.3, '临期预警比例', minimum=0.01)
    db.execute('UPDATE ProductCategory SET CategoryName=?, ExpiryWarnRatio=? WHERE CategoryID=?',
               (name, ratio, cid))
    return ok({'message': '类别已更新'})


@api.get('/api/markdown-rules', roles=ALL_ROLES)
def list_rules(req):
    rows = db.rows_to_dict(db.query(
        'SELECT r.*, c.CategoryName FROM MarkdownRule r LEFT JOIN ProductCategory c '
        'ON c.CategoryID=r.CategoryID WHERE r.RecordStatus="A" ORDER BY r.CategoryID, r.RemainDaysTo'))
    return ok({'items': rows})


@api.post('/api/markdown-rules', roles=(OWNER,))
def create_rule(req):
    data = req.body
    cat = integer(data.get('categoryId'), '商品类别', minimum=1)
    rate = num(data.get('discountRate'), '折扣率', minimum=0.01)
    require(rate <= 1, '折扣率不能大于 1（例如 0.8 表示八折）')
    rid = db.insert(
        'INSERT INTO MarkdownRule (CategoryID, TriggerTime, ShelfLifeBand, RemainDaysFrom, '
        'RemainDaysTo, DiscountRate, EffectiveDate) VALUES (?,?,?,?,?,?,date("now","localtime"))',
        (cat, text(data.get('triggerTime'), '折价时点', required=False, maxlen=8) or '18:00',
         text(data.get('shelfLifeBand'), '剩余效期区间', required=False, maxlen=32) or '0-2 天',
         num(data.get('remainDaysFrom') or 0, '区间起', minimum=0),
         num(data.get('remainDaysTo') or 2, '区间止', minimum=0), rate))
    write_audit(req, '维护折价规则', 'MarkdownRule', rid, '折扣 %s' % rate)
    return ok({'ruleId': rid, 'message': '折价规则已保存'})


@api.put('/api/markdown-rules/<int:rid>', roles=(OWNER,))
def update_rule(req):
    rid = integer(req.params['rid'], '规则编号')
    data = req.body
    db.execute('UPDATE MarkdownRule SET TriggerTime=?, ShelfLifeBand=?, RemainDaysFrom=?, '
               'RemainDaysTo=?, DiscountRate=? WHERE RuleID=?',
               (data.get('triggerTime') or '18:00', data.get('shelfLifeBand') or '0-2 天',
                num(data.get('remainDaysFrom') or 0, '区间起', minimum=0),
                num(data.get('remainDaysTo') or 2, '区间止', minimum=0),
                num(data.get('discountRate'), '折扣率', minimum=0.01), rid))
    return ok({'message': '折价规则已更新'})
