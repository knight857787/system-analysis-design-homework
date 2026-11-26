"""供应商与结算条款（UC-10）、供应商往来台账。"""
from server import db
from server.core import (ALL_ROLES, OWNER, STAFF, SUPPLIER, api, bad, integer, num, ok, require, text,
                         write_audit)


@api.get('/api/suppliers', roles=STAFF + (SUPPLIER,))
def list_suppliers(req):
    rows = db.query(
        'SELECT s.*, t.PaymentTermDays, t.MaxReturnRatio, t.AllowedExpenseTypes, t.EffectiveDate, '
        '(SELECT COUNT(*) FROM Product p WHERE p.SupplierID=s.SupplierID AND p.RecordStatus="A") AS ProductCount, '
        '(SELECT COUNT(*) FROM PurchaseOrder o WHERE o.SupplierID=s.SupplierID) AS OrderCount, '
        '(SELECT ROUND(COALESCE(SUM(a.PayableAmount - a.PaidAmount),0),2) FROM AccountPayable a '
        ' WHERE a.SupplierID=s.SupplierID AND a.PayableStatus IN ("Open","Partial")) AS OpenPayable, '
        '(SELECT ROUND(COALESCE(SUM(r.ReceivedQty * r.PurchasePrice),0),2) FROM ReceiptNote n '
        ' JOIN ReceiptLine r ON r.ReceiptID=n.ReceiptID WHERE n.SupplierID=s.SupplierID '
        ' AND n.ReceivedAt >= date("now","localtime","-90 days")) AS Received90 '
        'FROM Supplier s LEFT JOIN SettlementTerm t ON t.SupplierID=s.SupplierID AND t.RecordStatus="A" '
        'WHERE s.RecordStatus="A" ORDER BY s.SupplierID')
    items = db.rows_to_dict(rows)
    for it in items:
        contacts = db.rows_to_dict(db.query('SELECT * FROM SupplierContact WHERE SupplierID=?', (it['SupplierID'],)))
        it['contacts'] = contacts
        it['returnRatioPct'] = round((it['MaxReturnRatio'] or 0) * 100, 2)
    return ok({'items': items})


@api.post('/api/suppliers', roles=(OWNER,))
def create_supplier(req):
    data = req.body
    sid = db.insert('INSERT INTO Supplier (Name, Contact, Phone, Address, CreatedBy) VALUES (?,?,?,?,?)',
                    (text(data.get('name'), '供应商名称', maxlen=64),
                     text(data.get('contact'), '联系人', required=False, maxlen=32) or '',
                     text(data.get('phone'), '联系电话', required=False, maxlen=20) or '',
                     text(data.get('address'), '地址', required=False, maxlen=128) or '',
                     req.employee['EmployeeID']))
    term_days = integer(data.get('paymentTermDays') or 30, '账期天数', minimum=0)
    ratio = num(data.get('maxReturnRatio') or 0.02, '最大退货比例', minimum=0)
    db.execute('INSERT INTO SettlementTerm (SupplierID, PaymentTermDays, MaxReturnRatio, '
               'AllowedExpenseTypes, EffectiveDate) VALUES (?,?,?,?,date("now","localtime"))',
               (sid, term_days, ratio, text(data.get('allowedExpenseTypes'), '费用项目', required=False,
                                            maxlen=100) or '陈列费,促销费'))
    write_audit(req, '维护供应商', 'Supplier', sid, data.get('name'))
    return ok({'supplierId': sid, 'message': '供应商与结算条款已保存'})


@api.put('/api/suppliers/<int:sid>', roles=(OWNER,))
def update_supplier(req):
    sid = integer(req.params['sid'], '供应商编号')
    row = db.query_one('SELECT * FROM Supplier WHERE SupplierID=?', (sid,))
    require(row is not None, '供应商不存在', 404)
    data = req.body
    db.execute('UPDATE Supplier SET Name=?, Contact=?, Phone=?, Address=?, '
               'UpdatedAt=datetime("now","localtime"), UpdatedBy=? WHERE SupplierID=?',
               (text(data.get('name', row['Name']), '供应商名称', maxlen=64),
                text(data.get('contact', row['Contact']), '联系人', required=False, maxlen=32),
                text(data.get('phone', row['Phone']), '联系电话', required=False, maxlen=20),
                text(data.get('address', row['Address']), '地址', required=False, maxlen=128),
                req.employee['EmployeeID'], sid))
    write_audit(req, '维护供应商', 'Supplier', sid, '修改供应商资料')
    return ok({'message': '供应商资料已更新'})


@api.put('/api/suppliers/<int:sid>/terms', roles=(OWNER,))
def update_terms(req):
    sid = integer(req.params['sid'], '供应商编号')
    data = req.body
    term_days = integer(data.get('paymentTermDays'), '账期天数', minimum=0)
    ratio = num(data.get('maxReturnRatio'), '最大退货比例', minimum=0)
    require(ratio <= 0.2, '退货比例一般不超过 20%，请确认后重新填写')
    existing = db.query_one('SELECT * FROM SettlementTerm WHERE SupplierID=? AND RecordStatus="A"', (sid,))
    if existing:
        db.execute('UPDATE SettlementTerm SET PaymentTermDays=?, MaxReturnRatio=?, '
                   'AllowedExpenseTypes=?, EffectiveDate=? WHERE TermID=?',
                   (term_days, ratio, text(data.get('allowedExpenseTypes'), '费用项目', required=False,
                                           maxlen=100) or '陈列费,促销费',
                    data.get('effectiveDate') or '2026-01-01', existing['TermID']))
        tid = existing['TermID']
    else:
        tid = db.insert('INSERT INTO SettlementTerm (SupplierID, PaymentTermDays, MaxReturnRatio, '
                        'AllowedExpenseTypes, EffectiveDate) VALUES (?,?,?,?,?)',
                        (sid, term_days, ratio,
                         text(data.get('allowedExpenseTypes'), '费用项目', required=False,
                              maxlen=100) or '陈列费,促销费', data.get('effectiveDate') or '2026-01-01'))
    write_audit(req, '维护结算条款', 'SettlementTerm', tid,
                '账期 %d 天，退货比例 %.1f%%' % (term_days, ratio * 100))
    return ok({'message': '结算条款已更新'})


@api.get('/api/suppliers/<int:sid>/ledger', roles=ALL_ROLES)
def supplier_ledger(req):
    sid = integer(req.params['sid'], '供应商编号')
    sup = db.query_one('SELECT * FROM Supplier WHERE SupplierID=?', (sid,))
    require(sup is not None, '供应商不存在', 404)
    days = req.qint('days', 90) or 90
    receipts = db.rows_to_dict(db.query(
        'SELECT n.ReceiptID, n.ReceiptNo, n.ReceivedAt, n.InspectionResult, '
        'ROUND(SUM(r.ReceivedQty * r.PurchasePrice),2) AS Amount, COUNT(*) AS Lines '
        'FROM ReceiptNote n JOIN ReceiptLine r ON r.ReceiptID=n.ReceiptID '
        'WHERE n.SupplierID=? AND n.ReceivedAt >= date("now","localtime",?) '
        'GROUP BY n.ReceiptID ORDER BY n.ReceivedAt DESC', (sid, '-%d days' % days)))
    returns = db.rows_to_dict(db.query(
        'SELECT * FROM ReturnNote WHERE SupplierID=? AND ReturnedAt >= date("now","localtime",?) '
        'ORDER BY ReturnedAt DESC', (sid, '-%d days' % days)))
    expenses = db.rows_to_dict(db.query(
        'SELECT * FROM ExpenseNote WHERE SupplierID=? AND OccurredAt >= date("now","localtime",?) '
        'ORDER BY OccurredAt DESC', (sid, '-%d days' % days)))
    statements = db.rows_to_dict(db.query(
        'SELECT * FROM Statement WHERE SupplierID=? ORDER BY PeriodEnd DESC LIMIT 12', (sid,)))
    payables = db.rows_to_dict(db.query(
        'SELECT a.*, s.StatementNo FROM AccountPayable a LEFT JOIN Statement s ON s.StatementID=a.StatementID '
        'WHERE a.SupplierID=? ORDER BY a.PlannedPayDate DESC', (sid,)))
    payments = db.rows_to_dict(db.query(
        'SELECT p.*, a.PayableNo FROM PaymentRecord p JOIN AccountPayable a ON a.PayableID=p.PayableID '
        'WHERE a.SupplierID=? ORDER BY p.PaidAt DESC LIMIT 20', (sid,)))
    totals = {
        'received': round(sum(r['Amount'] or 0 for r in receipts), 2),
        'returned': round(sum(r['Amount'] or 0 for r in returns), 2),
        'expense': round(sum(r['Amount'] or 0 for r in expenses), 2),
        'openPayable': round(sum((a['PayableAmount'] or 0) - (a['PaidAmount'] or 0)
                                 for a in payables if a['PayableStatus'] in ('Open', 'Partial')), 2),
    }
    return ok({'supplier': db.row_to_dict(sup), 'receipts': receipts, 'returns': returns,
               'expenses': expenses, 'statements': statements, 'payables': payables,
               'payments': payments, 'totals': totals})
