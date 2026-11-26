"""经营看板：KPI、趋势、待办、临期与损耗概览。"""
from server import db
from server.core import (ALL_ROLES, OWNER, ROLE_LABEL, SALESPERSON, STOCKER, SUPPLIER,
                        api, ok, today)


def warn_threshold(category_ratio, shelf_days):
    """临期阈值：不足总保质期的 1/3（按品类），最长不超过 30 天。"""
    try:
        ratio = float(category_ratio or 0.34)
    except (TypeError, ValueError):
        ratio = 0.34
    return max(1.0, min(float(shelf_days or 30) * ratio, 30.0))


def expiry_rows(limit=None, level=None):
    rows = db.query(
        'SELECT * FROM vExpiryWarning WHERE Quantity > 0.001 ORDER BY RemainDays ASC')
    out = []
    for r in rows:
        th = warn_threshold(r['ExpiryWarnRatio'], r['ShelfLifeDays'])
        remain = r['RemainDays']
        if remain < 0:
            lv = 'expired'
        elif remain <= 1:
            lv = 'urgent'
        elif remain <= th:
            lv = 'warn'
        else:
            continue
        if level and lv != level:
            continue
        d = db.row_to_dict(r)
        d['threshold'] = round(th, 1)
        d['level'] = lv
        d['levelLabel'] = {'expired': '已过期', 'urgent': '今日到期', 'warn': '临期'}[lv]
        d['stockValue'] = round((r['Quantity'] or 0) * (r['PurchasePrice'] or 0), 2)
        out.append(d)
    return out[:limit] if limit else out


@api.get('/api/dashboard/summary', roles=ALL_ROLES)
def summary(req):
    role = req.role()
    day_expr = "date(OccurredAt) = date('now','localtime')"
    today_row = db.query_one(
        'SELECT COUNT(*) AS Orders, COALESCE(SUM(TotalAmount),0) AS Amount, '
        'COALESCE(SUM(ProfitAmount),0) AS Profit, COALESCE(SUM(CostAmount),0) AS Cost '
        'FROM SaleOrder WHERE ' + day_expr + ' AND RecordStatus="A"')
    orders = today_row['Orders'] or 0
    amount = round(today_row['Amount'] or 0, 2)
    profit = round(today_row['Profit'] or 0, 2)
    margin = round(profit / amount * 100, 1) if amount else 0

    month_row = db.query_one(
        "SELECT COALESCE(SUM(TotalAmount),0) AS Amount, COALESCE(SUM(ProfitAmount),0) AS Profit "
        "FROM SaleOrder WHERE OccurredAt >= date('now','localtime','start of month') AND RecordStatus='A'")

    trend = []
    for r in db.query(
            "SELECT date(OccurredAt) AS d, COUNT(*) AS orders, ROUND(SUM(TotalAmount),2) AS amount, "
            "ROUND(SUM(ProfitAmount),2) AS profit FROM SaleOrder "
            "WHERE date(OccurredAt) >= date('now','localtime','-13 days') AND RecordStatus='A' "
            "GROUP BY date(OccurredAt) ORDER BY d"):
        trend.append({'date': r['d'], 'orders': r['orders'], 'amount': r['amount'],
                      'profit': r['profit'],
                      'margin': round((r['profit'] or 0) / r['amount'] * 100, 1) if r['amount'] else 0})

    # 库存
    stock_row = db.query_one(
        'SELECT COUNT(*) AS batches, ROUND(COALESCE(SUM(s.Quantity),0),3) AS qty, '
        'ROUND(COALESCE(SUM(s.Quantity * s.PurchasePrice),0),2) AS value '
        'FROM vStockSellable s WHERE s.Quantity > 0')
    negative = db.scalar('SELECT COUNT(*) FROM StockLedger WHERE Quantity < 0')
    sku_count = db.scalar('SELECT COUNT(*) FROM Product WHERE RecordStatus="A"')
    zero_stock = db.scalar('SELECT COUNT(*) FROM vProductStock WHERE StockQty <= 0')

    # 临期
    warns = expiry_rows()
    expiring_count = len([w for w in warns if w['level'] != 'expired'])
    expired_count = len([w for w in warns if w['level'] == 'expired'])
    expiring_value = round(sum(w['stockValue'] for w in warns), 2)

    # 损耗（近 30 天已确认）
    loss_row = db.query_one(
        "SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(Amount),0),2) AS amt FROM LossReport "
        "WHERE Status='Confirmed' AND RegisteredAt >= date('now','localtime','-30 days')")
    sales30 = db.scalar("SELECT COALESCE(SUM(TotalAmount),0) FROM SaleOrder "
                        "WHERE OccurredAt >= date('now','localtime','-30 days') AND RecordStatus='A'")
    loss_amount = round(loss_row['amt'] or 0, 2)
    loss_rate = round(loss_amount / sales30 * 100, 2) if sales30 else 0

    # 待办
    pending_pick = db.scalar("SELECT COUNT(*) FROM OnlineOrder WHERE OrderStatus IN ('Pending','Picked')")
    pending_markdown = db.scalar("SELECT COUNT(*) FROM MarkdownPlan WHERE PlanStatus='Pending'")
    pending_loss = db.scalar("SELECT COUNT(*) FROM LossReport WHERE Status='Pending'")
    pending_statement = db.scalar("SELECT COUNT(*) FROM Statement WHERE StatementStatus IN ('Submitted','Disputed')")
    pending_receipt = db.scalar("SELECT COUNT(*) FROM PurchaseOrder WHERE OrderStatus IN ('Submitted','Confirmed')")
    missing_inspection = db.scalar("SELECT COUNT(*) FROM IncomingInspection WHERE Status='Missing'")
    expiring_valid = db.scalar("SELECT COUNT(*) FROM IncomingInspection WHERE Status='Complete' "
                               "AND ValidUntil IS NOT NULL AND ValidUntil <= date('now','localtime','+30 days')")
    overdue_credit = db.scalar("SELECT COUNT(*) FROM CreditAccount WHERE OverdueDays > 0")
    credit_outstanding = db.scalar("SELECT COALESCE(SUM(OutstandingAmount),0) FROM vCreditSummary")
    payable_open = db.scalar("SELECT COALESCE(SUM(PayableAmount - PaidAmount),0) FROM AccountPayable "
                             "WHERE PayableStatus IN ('Open','Partial')")
    payable_overdue = db.scalar("SELECT COUNT(*) FROM AccountPayable WHERE PayableStatus IN ('Open','Partial') "
                                "AND PlannedPayDate < date('now','localtime')")

    # 会员与复购
    member_total = db.scalar('SELECT COUNT(*) FROM Member WHERE RecordStatus="A"')
    member_active = db.scalar(
        "SELECT COUNT(*) FROM (SELECT o.CustomerID, COUNT(*) c FROM SaleOrder o "
        "JOIN Customer c ON c.CustomerID=o.CustomerID WHERE c.IsMember='Y' "
        "AND o.OccurredAt >= date('now','localtime','-30 days') AND o.RecordStatus='A' "
        "GROUP BY o.CustomerID HAVING c >= 2)")
    member_repurchase = round(member_active / member_total * 100, 1) if member_total else 0

    # 线上
    online_today = db.query_one(
        "SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(TotalAmount),0),2) AS amt FROM OnlineOrder "
        "WHERE date(PlacedAt)=date('now','localtime') AND RecordStatus='A'")

    # 品类销售与损耗
    cat_sales = db.rows_to_dict(db.query(
        "SELECT c.CategoryName AS name, ROUND(SUM(sl.Amount),2) AS amount, "
        "ROUND(SUM(sl.Amount - sl.CostAmount),2) AS profit "
        "FROM SaleLine sl JOIN SaleOrder so ON so.SaleID=sl.SaleID "
        "JOIN Product p ON p.ProductID=sl.ProductID JOIN ProductCategory c ON c.CategoryID=p.CategoryID "
        "WHERE so.OccurredAt >= date('now','localtime','-30 days') AND so.RecordStatus='A' "
        "GROUP BY c.CategoryID ORDER BY amount DESC"))
    cat_loss = db.rows_to_dict(db.query(
        "SELECT c.CategoryName AS name, ROUND(COALESCE(SUM(l.Amount),0),2) AS amount, COUNT(*) AS times "
        "FROM LossReport l JOIN Product p ON p.ProductID=l.ProductID "
        "JOIN ProductCategory c ON c.CategoryID=p.CategoryID "
        "WHERE l.Status='Confirmed' AND l.RegisteredAt >= date('now','localtime','-30 days') "
        "GROUP BY c.CategoryID ORDER BY amount DESC"))

    # 热销
    top_products = db.rows_to_dict(db.query(
        "SELECT p.ProductName AS name, p.Unit, ROUND(SUM(sl.Quantity),3) AS qty, "
        "ROUND(SUM(sl.Amount),2) AS amount FROM SaleLine sl "
        "JOIN SaleOrder so ON so.SaleID=sl.SaleID JOIN Product p ON p.ProductID=sl.ProductID "
        "WHERE so.OccurredAt >= date('now','localtime','-30 days') AND so.RecordStatus='A' "
        "GROUP BY p.ProductID ORDER BY amount DESC LIMIT 8"))

    # 待办：按角色决定谁能看到哪一类
    todos = []
    if pending_pick:
        todos.append({'key': 'online', 'title': '线上订单待拣货/待交付', 'count': pending_pick,
                      'route': '#/online', 'level': 'high'})
    if expiring_count:
        todos.append({'key': 'expiry', 'title': '临期商品待处理', 'count': expiring_count,
                      'route': '#/expiry', 'level': 'high'})
    if expired_count:
        todos.append({'key': 'expired', 'title': '已过期商品待下架报损', 'count': expired_count,
                      'route': '#/expiry?level=expired', 'level': 'danger'})
    if pending_markdown:
        todos.append({'key': 'markdown', 'title': '折价方案待老板确认', 'count': pending_markdown,
                      'route': '#/expiry', 'level': 'mid'})
    if pending_loss:
        todos.append({'key': 'loss', 'title': '报损单待确认入账', 'count': pending_loss,
                      'route': '#/expiry', 'level': 'mid'})
    if pending_statement:
        todos.append({'key': 'statement', 'title': '供应商对账单待核对确认', 'count': pending_statement,
                      'route': '#/settle', 'level': 'mid'})
    if pending_receipt:
        todos.append({'key': 'purchase', 'title': '订货单在途待收货', 'count': pending_receipt,
                      'route': '#/purchases', 'level': 'low'})
    if missing_inspection:
        todos.append({'key': 'inspection', 'title': '进货查验凭证缺失待补交', 'count': missing_inspection,
                      'route': '#/receipts', 'level': 'mid'})
    if overdue_credit:
        todos.append({'key': 'credit', 'title': '赊账逾期待催收', 'count': overdue_credit,
                      'route': '#/credit', 'level': 'high'})
    if payable_overdue:
        todos.append({'key': 'payable', 'title': '应付账款已到结算日', 'count': payable_overdue,
                      'route': '#/settle', 'level': 'mid'})

    # 每类待办对应的可见角色（依据报告表 7 的用例执行者）
    todo_roles = {
        'online': (OWNER, STOCKER, SALESPERSON),     # UC-12 处理线上订单
        'expiry': (OWNER, STOCKER),                  # UC-01 处理临期商品
        'expired': (OWNER, STOCKER),
        'markdown': (OWNER, STOCKER),                # 方案由店长确认，理货员可见待确认
        'loss': (OWNER, STOCKER),                    # UC-06 登记报损
        'statement': (OWNER, SUPPLIER),              # UC-02 / UC-05
        'purchase': (OWNER, STOCKER, SUPPLIER),      # UC-04 / UC-05
        'inspection': (OWNER, STOCKER),              # UC-15
        'credit': (OWNER, SALESPERSON),              # UC-13
        'payable': (OWNER,),                         # UC-07 货款结算
    }
    my_todos = [t for t in todos if role in todo_roles.get(t['key'], ALL_ROLES)]

    base = {'role': role, 'roleLabel': ROLE_LABEL.get(role, role), 'date': today(),
            'todo': my_todos}

    if role == OWNER:
        payload = dict(base, scope='经营总览')
        payload.update({
            'today': {
                'date': today(), 'orders': orders, 'amount': amount, 'profit': profit,
                'margin': margin, 'avgTicket': round(amount / orders, 2) if orders else 0,
                'itemsPerOrder': round(db.scalar(
                    "SELECT COALESCE(SUM(sl.Quantity),0) FROM SaleLine sl JOIN SaleOrder so "
                    "ON so.SaleID=sl.SaleID WHERE date(so.OccurredAt)=date('now','localtime')") / orders, 2)
                if orders else 0,
            },
            'month': {'amount': round(month_row['Amount'] or 0, 2),
                      'profit': round(month_row['Profit'] or 0, 2)},
            'trend': trend,
            'stock': {'batches': stock_row['batches'], 'qty': round(stock_row['qty'] or 0, 3),
                      'value': round(stock_row['value'] or 0, 2), 'negative': negative,
                      'skuCount': sku_count, 'zeroStock': zero_stock},
            'expiry': {'count': expiring_count + expired_count, 'expiring': expiring_count,
                       'expired': expired_count, 'value': expiring_value, 'top': warns[:6]},
            'loss': {'amount': loss_amount, 'count': loss_row['n'], 'rate': loss_rate},
            'credit': {'outstanding': round(credit_outstanding or 0, 2), 'overdueAccounts': overdue_credit},
            'payable': {'open': round(payable_open or 0, 2), 'overdue': payable_overdue},
            'online': {'todayOrders': online_today['n'],
                       'todayAmount': round(online_today['amt'] or 0, 2),
                       'pendingPick': pending_pick},
            'member': {'total': member_total, 'active30': member_active, 'repurchase': member_repurchase},
            'categorySales': cat_sales,
            'categoryLoss': cat_loss,
            'topProducts': top_products,
        })
    elif role == STOCKER:
        # 理货员：只见库存、临期、收货与盘点相关的量，不接触金额与毛利
        payload = dict(base, scope='库存与效期')
        payload.update({
            'stock': {'batches': stock_row['batches'], 'qty': round(stock_row['qty'] or 0, 3),
                      'negative': negative, 'skuCount': sku_count, 'zeroStock': zero_stock},
            'expiry': {'count': expiring_count + expired_count, 'expiring': expiring_count,
                       'expired': expired_count, 'top': warns[:6]},
            'loss': {'count': loss_row['n']},
        })
    elif role == SALESPERSON:
        # 销售：今日开单量与本班交接，赊账与线上待交付；不含成本与毛利
        payload = dict(base, scope='收银与赊账')
        payload.update({
            'today': {'date': today(), 'orders': orders, 'amount': amount,
                      'avgTicket': round(amount / orders, 2) if orders else 0},
            'credit': {'outstanding': round(credit_outstanding or 0, 2),
                       'overdueAccounts': overdue_credit},
            'online': {'todayOrders': online_today['n'], 'pendingPick': pending_pick},
        })
    else:
        # 供货商业务员：只看到与我方之间的订货与对账，计数按本公司口径
        own = req.employee['SupplierID']
        if own:
            own_orders = db.scalar(
                "SELECT COUNT(*) FROM PurchaseOrder WHERE SupplierID=? "
                "AND OrderStatus IN ('Submitted','Confirmed')", (own,)) or 0
            own_statements = db.scalar(
                "SELECT COUNT(*) FROM Statement WHERE SupplierID=? "
                "AND StatementStatus IN ('Submitted','Disputed')", (own,)) or 0
        else:
            own_orders, own_statements = 0, 0
        payload = dict(base, scope='订货与对账')
        payload.update({
            'supplier': {'pendingOrders': own_orders, 'pendingStatements': own_statements},
        })

    return ok(payload)


@api.get('/api/dashboard/todo')
def todo(req):
    return ok({'items': []})
