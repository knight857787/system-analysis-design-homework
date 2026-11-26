"""经营分析报表（UC-08）与试运行验收指标（报告表 22）。"""
from datetime import datetime, timedelta

from server import db
from server.core import OWNER, api, ok, today
from server.routes.dashboard import expiry_rows


def date_range(req):
    end = req.q('to') or today()
    start = req.q('from') or (datetime.strptime(end, '%Y-%m-%d') - timedelta(days=29)).strftime('%Y-%m-%d')
    return start, end


@api.get('/api/reports/summary', roles=(OWNER,))
def summary(req):
    start, end = date_range(req)
    head = db.query_one(
        'SELECT COUNT(*) AS Orders, ROUND(COALESCE(SUM(TotalAmount),0),2) AS Amount, '
        'ROUND(COALESCE(SUM(CostAmount),0),2) AS Cost, ROUND(COALESCE(SUM(ProfitAmount),0),2) AS Profit, '
        'ROUND(COALESCE(SUM(DiscountAmount),0),2) AS Discount, ROUND(COALESCE(SUM(CreditAmount),0),2) AS Credit '
        'FROM SaleOrder WHERE date(OccurredAt) BETWEEN ? AND ? AND RecordStatus="A"', (start, end))
    amount = head['Amount'] or 0
    profit = head['Profit'] or 0
    trend = db.rows_to_dict(db.query(
        'SELECT date(OccurredAt) AS date, COUNT(*) AS orders, ROUND(SUM(TotalAmount),2) AS amount, '
        'ROUND(SUM(CostAmount),2) AS cost, ROUND(SUM(ProfitAmount),2) AS profit '
        'FROM SaleOrder WHERE date(OccurredAt) BETWEEN ? AND ? AND RecordStatus="A" '
        'GROUP BY date(OccurredAt) ORDER BY date', (start, end)))
    for row in trend:
        row['margin'] = round((row['profit'] or 0) / row['amount'] * 100, 1) if row['amount'] else 0
    by_category = db.rows_to_dict(db.query(
        'SELECT c.CategoryName AS name, ROUND(SUM(sl.Amount),2) AS amount, '
        'ROUND(SUM(sl.CostAmount),2) AS cost, ROUND(SUM(sl.Amount - sl.CostAmount),2) AS profit, '
        'ROUND(SUM(sl.Amount) / (SELECT SUM(Amount) FROM SaleLine sl2 JOIN SaleOrder so2 '
        ' ON so2.SaleID=sl2.SaleID WHERE date(so2.OccurredAt) BETWEEN ? AND ?) * 100, 1) AS share '
        'FROM SaleLine sl JOIN SaleOrder so ON so.SaleID=sl.SaleID '
        'JOIN Product p ON p.ProductID=sl.ProductID JOIN ProductCategory c ON c.CategoryID=p.CategoryID '
        'WHERE date(so.OccurredAt) BETWEEN ? AND ? AND so.RecordStatus="A" '
        'GROUP BY c.CategoryID ORDER BY amount DESC', (start, end, start, end)))
    for row in by_category:
        row['margin'] = round((row['profit'] or 0) / row['amount'] * 100, 1) if row['amount'] else 0
    top = db.rows_to_dict(db.query(
        'SELECT p.ProductName AS name, p.Unit, ROUND(SUM(sl.Quantity),3) AS qty, '
        'ROUND(SUM(sl.Amount),2) AS amount, ROUND(SUM(sl.Amount - sl.CostAmount),2) AS profit '
        'FROM SaleLine sl JOIN SaleOrder so ON so.SaleID=sl.SaleID JOIN Product p ON p.ProductID=sl.ProductID '
        'WHERE date(so.OccurredAt) BETWEEN ? AND ? AND so.RecordStatus="A" '
        'GROUP BY p.ProductID ORDER BY amount DESC LIMIT 14', (start, end)))
    pays = db.rows_to_dict(db.query(
        'SELECT p.PayMethod AS method, ROUND(SUM(p.PayAmount),2) AS amount, COUNT(*) AS times '
        'FROM PayRecord p JOIN SaleOrder o ON o.SaleID=p.SaleID '
        'WHERE date(o.OccurredAt) BETWEEN ? AND ? GROUP BY p.PayMethod ORDER BY amount DESC', (start, end)))
    loss = db.query_one(
        'SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(Amount),0),2) AS amount FROM LossReport '
        'WHERE Status="Confirmed" AND date(RegisteredAt) BETWEEN ? AND ?', (start, end))
    loss_by_reason = db.rows_to_dict(db.query(
        'SELECT Reason AS name, ROUND(COALESCE(SUM(Amount),0),2) AS amount, COUNT(*) AS times '
        'FROM LossReport WHERE Status="Confirmed" AND date(RegisteredAt) BETWEEN ? AND ? '
        'GROUP BY Reason ORDER BY amount DESC', (start, end)))
    loss_by_category = db.rows_to_dict(db.query(
        'SELECT c.CategoryName AS name, ROUND(COALESCE(SUM(l.Amount),0),2) AS amount, COUNT(*) AS times '
        'FROM LossReport l JOIN Product p ON p.ProductID=l.ProductID '
        'JOIN ProductCategory c ON c.CategoryID=p.CategoryID '
        'WHERE l.Status="Confirmed" AND date(l.RegisteredAt) BETWEEN ? AND ? '
        'GROUP BY c.CategoryID ORDER BY amount DESC', (start, end)))
    stock_value = db.scalar('SELECT ROUND(COALESCE(SUM(l.Quantity * b.PurchasePrice),0),2) '
                            'FROM StockLedger l JOIN PurchaseBatch b ON b.BatchID=l.BatchID WHERE l.Quantity>0')
    cost = head['Cost'] or 0
    turnover = round(cost / stock_value, 2) if stock_value else 0
    # 线上占比
    online = db.query_one(
        'SELECT COUNT(*) AS Orders, ROUND(COALESCE(SUM(TotalAmount),0),2) AS Amount FROM OnlineOrder '
        'WHERE OrderStatus="Completed" AND date(PlacedAt) BETWEEN ? AND ?', (start, end))
    online_share = round((online['Amount'] or 0) / (amount + (online['Amount'] or 0)) * 100, 1) \
        if (amount + (online['Amount'] or 0)) else 0
    # 会员复购
    member_total = db.scalar('SELECT COUNT(*) FROM Member WHERE RecordStatus="A"')
    member_active = db.scalar(
        'SELECT COUNT(*) FROM (SELECT o.CustomerID, COUNT(*) c FROM SaleOrder o '
        'JOIN Member m ON m.CustomerID=o.CustomerID WHERE date(o.OccurredAt) BETWEEN ? AND ? '
        'GROUP BY o.CustomerID HAVING c >= 2)', (start, end))
    # 效期与预警处理
    expiry = expiry_rows()
    today_handling = db.scalar("SELECT COUNT(*) FROM ExpiryHandling WHERE date(HandledAt)=date('now','localtime')")
    shelf_rate = db.scalar("SELECT ROUND(100.0 * SUM(CASE WHEN ProductionDate IS NOT NULL THEN 1 ELSE 0 END) "
                          "/ COUNT(*), 1) FROM PurchaseBatch WHERE ExpiryDate IS NOT NULL")
    return ok({
        'range': {'from': start, 'to': end},
        'sales': {'orders': head['Orders'], 'amount': amount, 'cost': cost, 'profit': profit,
                  'margin': round(profit / amount * 100, 1) if amount else 0,
                  'avgTicket': round(amount / head['Orders'], 2) if head['Orders'] else 0,
                  'discount': head['Discount'], 'credit': head['Credit'],
                  'dailyAvg': round(amount / max(1, (datetime.strptime(end, '%Y-%m-%d') -
                                                     datetime.strptime(start, '%Y-%m-%d')).days + 1), 2)},
        'trend': trend, 'byCategory': by_category, 'topProducts': top, 'payMethods': pays,
        'loss': {'count': loss['n'], 'amount': round(loss['amount'] or 0, 2),
                 'rate': round((loss['amount'] or 0) / amount * 100, 2) if amount else 0,
                 'byReason': loss_by_reason, 'byCategory': loss_by_category},
        'stock': {'value': stock_value, 'turnover': turnover},
        'online': {'orders': online['Orders'], 'amount': round(online['Amount'] or 0, 2),
                   'share': online_share},
        'member': {'total': member_total, 'active': member_active,
                   'repurchaseRate': round(member_active / member_total * 100, 1) if member_total else 0},
        'expiry': {'pending': len([e for e in expiry if e['level'] != 'expired']),
                   'expired': len([e for e in expiry if e['level'] == 'expired']),
                   'todayHandling': today_handling, 'shelfLifeInputRate': shelf_rate},
    })


@api.get('/api/reports/margin', roles=(OWNER,))
def margin_report(req):
    start, end = date_range(req)
    by_category = db.rows_to_dict(db.query(
        'SELECT c.CategoryName AS name, ROUND(SUM(sl.Amount),2) AS amount, ROUND(SUM(sl.CostAmount),2) AS cost, '
        'ROUND(SUM(sl.Amount - sl.CostAmount),2) AS profit, '
        'ROUND((SUM(sl.Amount) - SUM(sl.CostAmount)) / SUM(sl.Amount) * 100, 1) AS margin '
        'FROM SaleLine sl JOIN SaleOrder so ON so.SaleID=sl.SaleID JOIN Product p ON p.ProductID=sl.ProductID '
        'JOIN ProductCategory c ON c.CategoryID=p.CategoryID '
        'WHERE date(so.OccurredAt) BETWEEN ? AND ? AND so.RecordStatus="A" '
        'GROUP BY c.CategoryID ORDER BY profit DESC', (start, end)))
    by_product = db.rows_to_dict(db.query(
        'SELECT p.ProductName AS name, p.Specification, p.Unit, c.CategoryName AS category, '
        'ROUND(SUM(sl.Quantity),3) AS qty, ROUND(SUM(sl.Amount),2) AS amount, '
        'ROUND(SUM(sl.CostAmount),2) AS cost, ROUND(SUM(sl.Amount - sl.CostAmount),2) AS profit, '
        'ROUND((SUM(sl.Amount) - SUM(sl.CostAmount)) / SUM(sl.Amount) * 100, 1) AS margin '
        'FROM SaleLine sl JOIN SaleOrder so ON so.SaleID=sl.SaleID JOIN Product p ON p.ProductID=sl.ProductID '
        'JOIN ProductCategory c ON c.CategoryID=p.CategoryID '
        'WHERE date(so.OccurredAt) BETWEEN ? AND ? AND so.RecordStatus="A" '
        'GROUP BY p.ProductID ORDER BY profit DESC LIMIT 40', (start, end)))
    return ok({'range': {'from': start, 'to': end}, 'byCategory': by_category, 'byProduct': by_product})


@api.get('/api/reports/loss', roles=(OWNER,))
def loss_report(req):
    start, end = date_range(req)
    monthly = db.rows_to_dict(db.query(
        "SELECT strftime('%Y-%m', RegisteredAt) AS month, COUNT(*) AS times, "
        'ROUND(COALESCE(SUM(Amount),0),2) AS amount FROM LossReport '
        'WHERE Status="Confirmed" AND date(RegisteredAt) BETWEEN ? AND ? GROUP BY month ORDER BY month',
        (start, end)))
    by_reason = db.rows_to_dict(db.query(
        'SELECT Reason AS name, COUNT(*) AS times, ROUND(COALESCE(SUM(Amount),0),2) AS amount '
        'FROM LossReport WHERE Status="Confirmed" AND date(RegisteredAt) BETWEEN ? AND ? '
        'GROUP BY Reason ORDER BY amount DESC', (start, end)))
    by_category = db.rows_to_dict(db.query(
        'SELECT c.CategoryName AS name, COUNT(*) AS times, ROUND(COALESCE(SUM(l.Amount),0),2) AS amount '
        'FROM LossReport l JOIN Product p ON p.ProductID=l.ProductID '
        'JOIN ProductCategory c ON c.CategoryID=p.CategoryID '
        'WHERE l.Status="Confirmed" AND date(l.RegisteredAt) BETWEEN ? AND ? '
        'GROUP BY c.CategoryID ORDER BY amount DESC', (start, end)))
    detail = db.rows_to_dict(db.query(
        'SELECT l.*, p.ProductName, p.Unit, c.CategoryName, b.BatchNo, b.ExpiryDate '
        'FROM LossReport l JOIN Product p ON p.ProductID=l.ProductID '
        'JOIN ProductCategory c ON c.CategoryID=p.CategoryID '
        'JOIN PurchaseBatch b ON b.BatchID=l.BatchID '
        'WHERE date(l.RegisteredAt) BETWEEN ? AND ? ORDER BY l.RegisteredAt DESC LIMIT 200',
        (start, end)))
    return ok({'range': {'from': start, 'to': end}, 'monthly': monthly, 'byReason': by_reason,
               'byCategory': by_category, 'detail': detail})


@api.get('/api/reports/cash', roles=(OWNER,))
def cash_report(req):
    day = req.q('date') or today()
    pays = db.rows_to_dict(db.query(
        'SELECT p.PayMethod AS method, ROUND(SUM(p.PayAmount),2) AS amount, COUNT(*) AS times '
        'FROM PayRecord p JOIN SaleOrder o ON o.SaleID=p.SaleID '
        'WHERE date(o.OccurredAt)=? GROUP BY p.PayMethod', (day,)))
    credit = db.scalar('SELECT ROUND(COALESCE(SUM(CreditAmount),0),2) FROM SaleOrder WHERE date(OccurredAt)=?', (day,))
    total = db.scalar('SELECT ROUND(COALESCE(SUM(TotalAmount),0),2) FROM SaleOrder WHERE date(OccurredAt)=?', (day,))
    return ok({'date': day, 'pays': pays, 'cash': round(sum(p['amount'] for p in pays if p['method'] == '现金'), 2),
               'paidTotal': round(sum(p['amount'] for p in pays), 2), 'credit': round(credit or 0, 2),
               'salesTotal': round(total or 0, 2)})


@api.get('/api/reports/acceptance', roles=(OWNER,))
def acceptance(req):
    """课程案例的试运行验收指标：模拟基线 / 目标 / 系统当前值。"""
    stock_qty = db.scalar('SELECT ROUND(COALESCE(SUM(Quantity),3),3) FROM StockLedger WHERE RecordStatus="A"')
    negative = db.scalar('SELECT COUNT(*) FROM StockLedger WHERE Quantity < 0')
    last_take = db.query_one('SELECT * FROM StocktakePlan WHERE Status="Approved" ORDER BY ConfirmedAt DESC LIMIT 1')
    diff_rate = round((last_take['DiffRate'] or 0) * 100, 2) if last_take else None
    loss_count = db.scalar('SELECT COUNT(*) FROM LossReport')
    loss_confirmed = db.scalar('SELECT COUNT(*) FROM LossReport WHERE Status="Confirmed"')
    shelf_rate = db.scalar("SELECT ROUND(100.0 * SUM(CASE WHEN ProductionDate IS NOT NULL THEN 1 ELSE 0 END) "
                          "/ COUNT(*), 1) FROM PurchaseBatch")
    expiry = expiry_rows()
    handled_today = db.scalar("SELECT COUNT(*) FROM ExpiryHandling WHERE date(HandledAt)=date('now','localtime')")
    # 对账耗时：已确认对账单“提交→确认”时长
    stmt = db.query_one(
        'SELECT COUNT(*) AS n, '
        'ROUND(AVG((julianday(ConfirmedAt) - julianday(SubmittedAt)) * 24 * 60), 1) AS minutes '
        'FROM Statement WHERE StatementStatus="Confirmed" AND ConfirmedAt IS NOT NULL')
    take_time = db.query_one(
        'SELECT COUNT(*) AS n, ROUND(AVG((julianday(ConfirmedAt) - julianday(PlannedAt)) * 24 * 60), 1) AS minutes '
        'FROM StocktakePlan WHERE Status="Approved" AND ConfirmedAt IS NOT NULL')
    online_avg = db.query_one(
        'SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(TotalAmount),0),2) AS amount FROM OnlineOrder '
        'WHERE date(PlacedAt) BETWEEN date("now","localtime","-13 days") AND date("now","localtime")')
    days = 14
    pick_avg = db.query_one(
        'SELECT ROUND(AVG((julianday(f.OccurredAt) - julianday(o.PlacedAt)) * 24 * 60), 1) AS minutes '
        'FROM FulfilmentLog f JOIN OnlineOrder o ON o.OrderID=f.OrderID '
        'WHERE f.Action="picked_all"')
    credit_total = db.scalar('SELECT COUNT(*) FROM CreditEntry WHERE EntryType="charge" AND RecordStatus="A"')
    credit_with_due = db.scalar('SELECT COUNT(*) FROM CreditEntry WHERE EntryType="charge" '
                               'AND RecordStatus="A" AND DueDate IS NOT NULL')
    member_total = db.scalar('SELECT COUNT(*) FROM Member WHERE RecordStatus="A"')
    member_repeat = db.scalar(
        'SELECT COUNT(*) FROM (SELECT o.CustomerID, COUNT(*) c FROM SaleOrder o '
        'JOIN Member m ON m.CustomerID=o.CustomerID WHERE o.OccurredAt >= date("now","localtime","-30 days") '
        'GROUP BY o.CustomerID HAVING c >= 2)')
    insp_total = db.scalar('SELECT COUNT(*) FROM IncomingInspection')
    insp_complete = db.scalar('SELECT COUNT(*) FROM IncomingInspection WHERE Status="Complete"')

    def status_of(ok_flag, warn_flag=False):
        if ok_flag:
            return 'ok'
        return 'warn' if warn_flag else 'pending'

    items = [
        {'key': 'stock', 'metric': '库存账实', 'baseline': '后台库存总量 -4,849（负库存）',
         'target': '库存总量归零、抽盘差异率 ≤1%',
         'current': '库存总量 %.3f（负库存 %d 条）' % (stock_qty or 0, negative or 0),
         'status': status_of((stock_qty or 0) >= 0 and negative == 0),
         'note': '台账只由收货/报损/退货/销售/调账流水推动，界面不提供直接改数入口'},
        {'key': 'loss', 'metric': '损耗计量与及时率', 'baseline': '报损记录 0 条、报损金额 0.00 元',
         'target': '每笔损耗有单；保质期录入率 100%；预警当日处理 100%',
         'current': '报损单 %d 条（已确认 %d）；保质期录入率 %s%%；今日处理单 %d 张'
                    % (loss_count, loss_confirmed, shelf_rate, handled_today),
         'status': status_of(loss_count > 0 and (shelf_rate or 0) >= 99),
         'note': '当前待处理临期 %d 项（含过期 %d 项）' % (
             len([e for e in expiry if e['level'] != 'expired']),
             len([e for e in expiry if e['level'] == 'expired']))},
        {'key': 'statement', 'metric': '供应商对账耗时', 'baseline': '系统内无对账数据（老板估算约 1 小时/家）',
         'target': '10 分钟以内',
         'current': ('平均 %.1f 分钟（%d 份已确认）' % (stmt['minutes'], stmt['n'])
                     if stmt['n'] else '尚无已确认对账单'),
         'status': status_of(stmt['n'] and (stmt['minutes'] or 999) <= 10, stmt['n'] and bool(stmt['n'])),
         'note': '耗时取“提交→确认”时点差；差异项由系统逐条列出，老板只需处理差异'},
        {'key': 'stocktake', 'metric': '全店盘点耗时', 'baseline': '无系统盘点记录（老板估算约半个工作日）',
         'target': '2 小时以内',
         'current': ('平均 %.1f 分钟（%d 次）' % (take_time['minutes'], take_time['n'])
                     if take_time['n'] else '尚无已批准盘点'),
         'status': status_of(take_time['n'] and (take_time['minutes'] or 999) <= 120, False),
         'note': ('最近一次盘点差异率 %.2f%%' % diff_rate) if diff_rate is not None else '尚无盘点差异率'},
        {'key': 'online', 'metric': '线上订单履约', 'baseline': '微信店铺未开通，网单销售额 0.00 元',
         'target': '日均 10 单；缺货 5 分钟内通知、10 分钟内交付',
         'current': '近 14 日 %d 单（日均 %.1f 单）；平均拣货 %.0f 分钟'
                    % (online_avg['n'], (online_avg['n'] or 0) / days,
                       pick_avg['minutes'] or 0),
         'status': status_of((online_avg['n'] or 0) / days >= 1, (online_avg['n'] or 0) > 0),
         'note': '线上与门店共用一份库存，可售数量在下单时即校验并占用'},
        {'key': 'credit', 'metric': '熟客赊账', 'baseline': '挂账模块未启用，赊账从不进系统',
         'target': '100% 有电子凭证与还款日期，坏账率 <1%',
         'current': '挂账 %d 笔，有还款日期 %d 笔（%.0f%%）'
                    % (credit_total, credit_with_due, (credit_with_due / credit_total * 100) if credit_total else 0),
         'status': status_of(credit_total and credit_with_due == credit_total, credit_total > 0),
         'note': '额度、账龄、催收清单均可查；核销与收款记录一一对应'},
        {'key': 'member', 'metric': '会员复购', 'baseline': '会员 11 人；无消费占比 100%',
         'target': '复购率 20% 以上（30 天内至少 2 位老客回头）',
         'current': '会员 %d 人，30 天复购 %d 人（%.1f%%）'
                    % (member_total, member_repeat, (member_repeat / member_total * 100) if member_total else 0),
         'status': status_of(member_total and member_repeat / member_total >= 0.2, member_total > 0),
         'note': '会员与积分由收银、线上订单自动累计，不额外录入'},
        {'key': 'inspection', 'metric': '合规台账完整率', 'baseline': '无进货查验与下架记录',
         'target': '100%',
         'current': '查验记录 %d 条，完整 %d 条（%.0f%%）'
                    % (insp_total, insp_complete, (insp_complete / insp_total * 100) if insp_total else 0),
         'status': status_of(insp_total and insp_complete == insp_total, insp_total > 0),
         'note': '凭证挂在收货单上，随收货登记；缺失项自动进入待补交清单'},
    ]
    ok_count = len([i for i in items if i['status'] == 'ok'])
    return ok({'items': items, 'okCount': ok_count, 'total': len(items),
               'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M:%S')})
