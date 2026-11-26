"""员工与权限、审计留痕、系统说明（设计映射）。"""
import secrets
from datetime import datetime, timedelta

from server import db
from server.core import (ALL_ROLES, OWNER, ROLE_LABEL, api, bad, hash_password, integer, now, ok,
                         require, text, write_audit)

USE_CASES = [
    ('UC-01', '处理临期商品', '理货员', '#/expiry', ['ExpiryHandling', 'HandlingLine', 'MarkdownPlan', 'PurchaseBatch', 'StockLedger']),
    ('UC-02', '核对供应商对账', '老板', '#/settle', ['Statement', 'StatementLine', 'AccountPayable']),
    ('UC-03', '登记收货与验收', '理货员', '#/receipts', ['ReceiptNote', 'ReceiptLine', 'PurchaseBatch', 'StockLedger']),
    ('UC-04', '提交订货单', '老板', '#/purchases', ['PurchaseOrder', 'PurchaseOrderLine']),
    ('UC-05', '提交对账单', '供货商业务员', '#/settle', ['Statement', 'StatementLine']),
    ('UC-06', '登记报损', '理货员', '#/expiry', ['LossReport', 'StockLedger']),
    ('UC-07', '登记货款结算', '老板', '#/settle', ['PaymentRecord', 'AccountPayable']),
    ('UC-08', '查询经营分析报告', '老板', '#/reports', ['SaleOrder', 'SaleLine', 'LossReport', 'StockLedger']),
    ('UC-09', '维护商品档案', '老板', '#/products', ['Product', 'ProductCategory', 'MarkdownRule']),
    ('UC-10', '维护供应商与结算条款', '老板', '#/suppliers', ['Supplier', 'SettlementTerm', 'SupplierContact']),
    ('UC-11', '提交线上订单', '顾客/销售人员', '#/online', ['OnlineOrder', 'OnlineOrderLine']),
    ('UC-12', '处理线上订单', '理货员', '#/online', ['OnlineOrder', 'OnlineOrderLine', 'FulfilmentLog']),
    ('UC-13', '登记与核销熟客赊账', '老板/销售人员', '#/credit', ['CreditAccount', 'CreditEntry', 'Customer']),
    ('UC-14', '维护会员与积分', '老板', '#/members', ['Member', 'PointEntry']),
    ('UC-15', '登记进货查验与处置凭证', '理货员', '#/receipts', ['IncomingInspection', 'ReceiptNote']),
    ('UC-16', '记录销售与收款', '销售人员', '#/pos', ['SaleOrder', 'SaleLine', 'PayRecord', 'StockLedger']),
    ('UC-17', '盘点与差异处理', '理货员', '#/stocktake', ['StocktakePlan', 'StocktakeLine', 'StockAdjust', 'StockLedger']),
]

TABLES = ['Employee', 'Supplier', 'SupplierContact', 'SettlementTerm', 'ProductCategory', 'Product',
          'MarkdownRule', 'PurchaseBatch', 'StockLedger', 'PurchaseOrder', 'PurchaseOrderLine',
          'ReceiptNote', 'ReceiptLine', 'ExpiryHandling', 'HandlingLine', 'MarkdownPlan', 'LossReport',
          'ReturnNote', 'ExpenseNote', 'Statement', 'StatementLine', 'AccountPayable', 'PaymentRecord',
          'Customer', 'Member', 'PointEntry', 'OnlineOrder', 'OnlineOrderLine', 'FulfilmentLog',
          'CreditAccount', 'CreditEntry', 'IncomingInspection', 'SaleOrder', 'SaleLine', 'PayRecord',
          'StocktakePlan', 'StocktakeLine', 'StockAdjust', 'StockMovement', 'AuditLog']

PERMISSION_MATRIX = [
    ('维护商品与售价', '可做', '查询', '查询（改售价须老板确认）'),
    ('收货与验收登记', '可做', '查询', '可做（差异较大时提请老板确认）'),
    ('临期挑货与折价执行', '可做', '查询', '可做'),
    ('确认折价方案', '必须由老板确认', '—', '—'),
    ('报损登记与入账', '可做并确认', '查询', '登记（入账须老板确认）'),
    ('线上订单拣货与交付', '可做', '可做', '可做'),
    ('登记挂账', '可做', '可做（超额须老板确认）', '—'),
    ('核销赊账与收款', '可做并确认', '登记收款', '—'),
    ('确认对账结果', '必须由老板确认', '—', '—'),
    ('删除或修改历史单据', '不允许', '不允许', '不允许'),
]


INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # 去掉易混的 I/O/0/1
INVITE_ROLES = ('Stocker', 'Salesperson')


def _invite_state(row) -> str:
    if row['RecordStatus'] != 'A':
        return 'disabled'
    if row['ExpiresAt'] and row['ExpiresAt'] < now():
        return 'expired'
    if row['UsedCount'] >= row['MaxUses']:
        return 'used_up'
    return 'active'


@api.get('/api/invite-codes', roles=(OWNER,))
def list_invite_codes(req):
    rows = db.rows_to_dict(db.query(
        'SELECT c.*, e.Name AS CreatedByName FROM InviteCode c '
        'LEFT JOIN Employee e ON e.EmployeeID = c.CreatedBy '
        'ORDER BY c.InviteID DESC LIMIT 50'))
    for row in rows:
        row['state'] = _invite_state(row)
    return ok({'items': rows, 'roles': [{'value': r, 'label': ROLE_LABEL[r]} for r in INVITE_ROLES]})


@api.post('/api/invite-codes', roles=(OWNER,))
def create_invite_code(req):
    role = req.f('role') or 'Salesperson'
    require(role in INVITE_ROLES, '邀请码只能开理货员或销售员账号')
    max_uses = integer(req.f('maxUses') or 1, '可用次数', minimum=1)
    require(max_uses <= 99, '单条邀请码最多 99 次')
    hours = integer(req.f('expireHours') or 72, '有效期（小时）', minimum=0)
    require(hours <= 24 * 365, '有效期最长一年')

    code = None
    for _ in range(20):
        candidate = ''.join(secrets.choice(INVITE_ALPHABET) for _ in range(8))
        if db.query_one('SELECT 1 FROM InviteCode WHERE Code = ?', (candidate,)) is None:
            code = candidate
            break
    require(code is not None, '邀请码生成失败，请重试')

    expires = None
    if hours > 0:
        expires = (datetime.now() + timedelta(hours=hours)).strftime('%Y-%m-%d %H:%M:%S')
    invite_id = db.insert(
        'INSERT INTO InviteCode (Code, Role, MaxUses, ExpiresAt, CreatedBy) VALUES (?,?,?,?,?)',
        (code, role, max_uses, expires, req.employee['EmployeeID']))
    write_audit(req, '生成邀请码', 'InviteCode', invite_id,
                '%s（%s，可用 %d 次，有效期 %s 小时）' % (code, ROLE_LABEL[role], max_uses, hours))
    return ok({'inviteId': invite_id, 'code': code, 'expiresAt': expires,
               'message': '邀请码已生成：%s' % code})


@api.put('/api/invite-codes/<int:iid>', roles=(OWNER,))
def update_invite_code(req):
    iid = integer(req.params['iid'], '邀请码编号')
    row = db.query_one('SELECT * FROM InviteCode WHERE InviteID = ?', (iid,))
    require(row is not None, '邀请码不存在')
    status = req.f('recordStatus')
    require(status in ('A', 'V'), '状态不合法')
    db.execute('UPDATE InviteCode SET RecordStatus = ? WHERE InviteID = ?', (status, iid))
    write_audit(req, '停用邀请码' if status == 'V' else '启用邀请码', 'InviteCode', iid, row['Code'])
    return ok({'message': '已停用' if status == 'V' else '已启用'})


@api.get('/api/employees', roles=(OWNER,))
def list_employees(req):
    rows = db.rows_to_dict(db.query(
        'SELECT e.EmployeeID, e.LoginName, e.Name, e.Role, e.Phone, e.SupplierID, s.Name AS SupplierName, '
        'e.CreatedAt, e.RecordStatus FROM Employee e LEFT JOIN Supplier s ON s.SupplierID=e.SupplierID '
        'WHERE e.RecordStatus="A" ORDER BY e.EmployeeID'))
    for row in rows:
        row['roleLabel'] = ROLE_LABEL.get(row['Role'], row['Role'])
    return ok({'items': rows})


@api.post('/api/employees', roles=(OWNER,))
def create_employee(req):
    login = text(req.f('loginName'), '登录名', maxlen=32)
    require(db.query_one('SELECT 1 FROM Employee WHERE LoginName=?', (login,)) is None, '登录名已存在')
    pwd = text(req.f('password'), '初始密码', maxlen=128)
    require(len(pwd) >= 6, '初始密码至少 6 位')
    role = req.f('role')
    require(role in ROLE_LABEL, '角色不合法')
    sid = None
    if role == 'Supplier':
        sid = integer(req.f('supplierId'), '所属供应商', minimum=1)
    eid = db.insert('INSERT INTO Employee (LoginName, PasswordHash, Name, Role, Phone, SupplierID, CreatedBy) '
                    'VALUES (?,?,?,?,?,?,?)',
                    (login, hash_password(pwd), text(req.f('name'), '姓名', maxlen=32), role,
                     text(req.f('phone'), '联系电话', required=False, maxlen=20), sid,
                     req.employee['EmployeeID']))
    write_audit(req, '新增员工', 'Employee', eid, '%s（%s）' % (req.f('name'), ROLE_LABEL[role]))
    return ok({'employeeId': eid, 'message': '员工已创建（一人一号，不共用）'})


@api.put('/api/employees/<int:eid>', roles=(OWNER,))
def update_employee(req):
    eid = integer(req.params['eid'], '员工编号')
    row = db.query_one('SELECT * FROM Employee WHERE EmployeeID=?', (eid,))
    require(row is not None, '员工不存在', 404)
    role = req.f('role') or row['Role']
    require(role in ROLE_LABEL, '角色不合法')
    db.execute('UPDATE Employee SET Name=?, Role=?, Phone=?, SupplierID=?, '
               'UpdatedAt=datetime("now","localtime"), UpdatedBy=? WHERE EmployeeID=?',
               (text(req.f('name', row['Name']), '姓名', maxlen=32), role,
                text(req.f('phone', row['Phone']), '联系电话', required=False, maxlen=20),
                req.f('supplierId') or row['SupplierID'], req.employee['EmployeeID'], eid))
    write_audit(req, '修改员工', 'Employee', eid, '角色 %s' % ROLE_LABEL[role])
    return ok({'message': '员工资料已更新'})


@api.post('/api/employees/<int:eid>/password', roles=(OWNER,))
def reset_password(req):
    eid = integer(req.params['eid'], '员工编号')
    pwd = text(req.f('password'), '新密码', maxlen=128)
    require(len(pwd) >= 6, '新密码至少 6 位')
    db.execute('UPDATE Employee SET PasswordHash=? WHERE EmployeeID=?', (hash_password(pwd), eid))
    write_audit(req, '重置密码', 'Employee', eid, '')
    return ok({'message': '密码已重置'})


@api.get('/api/audit-logs', roles=(OWNER,))
def audit_logs(req):
    page, size = req.page_args(30)
    where = ['1=1']
    params = []
    if req.q('q'):
        where.append('(Action LIKE ? OR Entity LIKE ? OR EmployeeName LIKE ? OR Detail LIKE ?)')
        like = '%' + req.q('q') + '%'
        params += [like, like, like, like]
    if req.q('role'):
        where.append('Role=?')
        params.append(req.q('role'))
    cond = ' AND '.join(where)
    total = db.scalar('SELECT COUNT(*) FROM AuditLog WHERE ' + cond, params)
    rows = db.query('SELECT * FROM AuditLog WHERE ' + cond +
                    ' ORDER BY LogID DESC LIMIT ? OFFSET ?', params + [size, (page - 1) * size])
    return ok({'items': db.rows_to_dict(rows), 'total': total, 'page': page, 'size': size})


@api.get('/api/system/info', roles=ALL_ROLES)
def system_info(req):
    counts = []
    for table in TABLES:
        try:
            n = db.scalar('SELECT COUNT(*) FROM ' + table)
        except Exception:
            n = 0
        counts.append({'table': table, 'rows': n})
    user = req.employee['Name']
    return ok({
        'store': {'name': '平利县寅利丰生活超市', 'system': '门店经营助手',
                  'address': '示例省示例市模拟区课程路 1 号', 'owner': '演示老板'},
        'version': '1.0.0',
        'build': now(),
        'tech': {
            'backend': 'Python 3.13 标准库（http.server + sqlite3，零第三方依赖）',
            'database': 'SQLite（关系型，38 张业务表 + 4 个视图）',
            'frontend': '原生 ES Module + 动态渲染（无框架、无 CDN，离线可用）',
            'auth': 'scrypt 口令散列 + HttpOnly 会话 Cookie（12 小时）',
            'audit': '所有写操作写入 AuditLog（谁在什么时候做了什么）',
        },
        'useCases': [{'no': u[0], 'name': u[1], 'actor': u[2], 'route': u[3], 'tables': u[4]}
                     for u in USE_CASES],
        'tables': counts,
        'permissionMatrix': [{'action': p[0], 'owner': p[1], 'sales': p[2], 'stocker': p[3]}
                             for p in PERMISSION_MATRIX],
        'currentUser': {'name': user, 'role': ROLE_LABEL.get(req.employee['Role'], '')},
        'designNotes': [
            '派生属性不建列：剩余效期天数由生产日期与保质期实时计算，差异金额由对方金额减本方金额得出。',
            '库存台账是余额，收货明细/报损单/退货单/销售明细是流水；台账只由流水推动，界面不提供改数入口。',
            '单据只作废不物理删除（RecordStatus = A/V），更正生成新的调整记录。',
            '单据号由门店端生成并带客户端单号（ClientNo），服务端去重，保证断网补传不重复入库。',
            '对账明细的来源类型＋来源单号跨三张表，有效性由应用层校验（全库唯一需要应用层兜底的约束）。',
        ],
    })
