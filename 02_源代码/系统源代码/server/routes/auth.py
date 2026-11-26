"""登录、注册、登出、当前用户。"""
import os
import re
import secrets

from server import db
from server.core import (SESSION_COOKIE, SESSION_HOURS, ROLE_LABEL, api, create_session, destroy_session,
                         fail, hash_password, load_session, now, ok, require, sanitize_user, text,
                         verify_password, write_audit, Response)

# 演示账号口令：部署时用环境变量 DEMO_PASSWORD 覆盖，默认与线上演示一致
DEMO_PASSWORD = os.environ.get('DEMO_PASSWORD', 'YlfDemo2026')

DEMO_ACCOUNTS = [
    {'loginName': 'boss', 'password': DEMO_PASSWORD, 'name': '演示老板', 'role': 'Owner', 'roleLabel': '老板',
     'desc': '全部权限：确认折价、对账、盘点调账、赊账核销'},
    {'loginName': 'stocker', 'password': DEMO_PASSWORD, 'name': '演示理货员', 'role': 'Stocker',
     'roleLabel': '理货员', 'desc': '只看到库存与效期：收货验收、临期处理、盘点差异、线上拣货'},
    {'loginName': 'sales', 'password': DEMO_PASSWORD, 'name': '演示销售员', 'role': 'Salesperson',
     'roleLabel': '销售人员', 'desc': '只看到收银与赊账：开单收款、登记挂账、会员积分、线上交付'},
    {'loginName': 'supplier', 'password': DEMO_PASSWORD, 'name': '供应商联系人甲', 'role': 'Supplier',
     'roleLabel': '供货商业务员', 'desc': '只看到本公司订货与对账：查看订货单、提交对账单、答复差异'},
]

# 邀请码：部署时用环境变量 REGISTER_INVITE 覆盖；置空字符串可关闭注册
REGISTER_INVITE = os.environ.get('REGISTER_INVITE', 'YANGLIU2026')
LOGIN_NAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]{2,31}$')


def cookie_secure_suffix(req) -> str:
    """HTTPS 反向代理下强制 Secure；本地 HTTP 默认仍可用。"""
    mode = os.environ.get('COOKIE_SECURE', 'auto').lower()
    if mode in ('1', 'true', 'yes', 'always'):
        return '; Secure'
    if req.headers.get('x-forwarded-proto', '').lower() == 'https':
        return '; Secure'
    return ''


@api.post('/api/auth/login', auth=False)
def login(req):
    login_name = text(req.f('loginName'), '登录名', maxlen=64)
    password = text(req.f('password'), '密码', maxlen=128)
    row = db.query_one('SELECT * FROM Employee WHERE LoginName = ? AND RecordStatus = "A"', (login_name,))
    if row is None or not verify_password(password, row['PasswordHash']):
        return fail('登录名或密码不正确', 401, 'BAD_CREDENTIALS')
    token = create_session(row['EmployeeID'], req.headers.get('user-agent', ''))
    db.execute('DELETE FROM SessionToken WHERE ExpiresAt < ?', (now(),))
    payload = {'user': sanitize_user(row), 'token': token}
    resp = ok(payload)
    secure = cookie_secure_suffix(req)
    resp.headers.append(('Set-Cookie', '%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax%s'
                         % (SESSION_COOKIE, token, SESSION_HOURS * 3600, secure)))
    req.employee = row
    req.token = token
    write_audit(req, '登录', 'Employee', row['EmployeeID'], '账号 %s 登录成功' % login_name)
    return resp


@api.post('/api/auth/register', auth=False)
def register(req):
    """邀请码注册：角色由邀请码决定（理货员/销售员），注册成功即自动登录。"""
    invite = str(req.f('inviteCode') or '').strip().upper()
    if not invite:
        return fail('请填写邀请码', 400, 'BAD_INVITE')

    invite_row = db.query_one("SELECT * FROM InviteCode WHERE Code = ? AND RecordStatus = 'A'", (invite,))
    if invite_row is not None:
        if invite_row['ExpiresAt'] and invite_row['ExpiresAt'] < now():
            return fail('该邀请码已过期，请向管理员再要一个', 400, 'INVITE_EXPIRED')
        if invite_row['UsedCount'] >= invite_row['MaxUses']:
            return fail('该邀请码已用完（%d/%d），请向管理员再要一个'
                        % (invite_row['UsedCount'], invite_row['MaxUses']), 400, 'INVITE_USED_UP')
        role = invite_row['Role'] if invite_row['Role'] in ('Stocker', 'Salesperson') else 'Salesperson'
        invite_id = invite_row['InviteID']
    else:
        # 兼容：未走数据库邀请码时，回退到环境变量邀请码（角色固定销售员）
        if not REGISTER_INVITE or not secrets.compare_digest(invite, REGISTER_INVITE):
            return fail('邀请码不正确，请向管理员索取', 400, 'BAD_INVITE')
        role = 'Salesperson'
        invite_id = None

    login_name = str(req.f('loginName') or '').strip()
    if not LOGIN_NAME_RE.match(login_name):
        return fail('登录名需字母开头，3–32 位字母/数字/下划线', 400, 'BAD_LOGIN_NAME')
    if db.query_one('SELECT 1 FROM Employee WHERE LoginName = ?', (login_name,)) is not None:
        return fail('该登录名已被占用，请换一个', 409, 'LOGIN_EXISTS')

    password = str(req.f('password') or '')
    if len(password) < 8:
        return fail('密码至少 8 位', 400, 'WEAK_PASSWORD')

    name = text(req.f('name'), '姓名', maxlen=32)
    phone = text(req.f('phone'), '手机号', required=False, maxlen=20)

    emp_id = db.insert(
        'INSERT INTO Employee (LoginName, PasswordHash, Name, Role, Phone) VALUES (?,?,?,?,?)',
        (login_name, hash_password(password), name, role, phone))
    if invite_id is not None:
        db.execute('UPDATE InviteCode SET UsedCount = UsedCount + 1, LastUsedAt = ? WHERE InviteID = ?',
                   (now(), invite_id))
    row = db.query_one('SELECT * FROM Employee WHERE EmployeeID = ?', (emp_id,))
    token = create_session(emp_id, req.headers.get('user-agent', ''))
    req.employee = row
    req.token = token
    write_audit(req, '自助注册', 'Employee', emp_id,
                '%s 通过邀请码 %s 注册（角色：%s）' % (login_name, invite, ROLE_LABEL.get(role, role)))

    role_label = ROLE_LABEL.get(role, role)
    resp = ok({'user': sanitize_user(row), 'token': token,
               'message': '注册成功，已自动登录（角色：%s）' % role_label,
               'roleLabel': role_label})
    secure = cookie_secure_suffix(req)
    resp.headers.append(('Set-Cookie', '%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax%s'
                         % (SESSION_COOKIE, token, SESSION_HOURS * 3600, secure)))
    return resp


@api.post('/api/auth/logout')
def logout(req):
    destroy_session(req.token)
    payload = ok({'message': '已退出登录'})
    secure = cookie_secure_suffix(req)
    payload.headers.append(('Set-Cookie', '%s=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax%s'
                            % (SESSION_COOKIE, secure)))
    return payload


@api.get('/api/auth/me')
def me(req):
    user = sanitize_user(req.employee)
    if user['role'] == 'Supplier' and user['supplierId']:
        sup = db.query_one('SELECT Name FROM Supplier WHERE SupplierID = ?', (user['supplierId'],))
        user['supplierName'] = sup['Name'] if sup else ''
    return ok({'user': user})


@api.get('/api/auth/demo-accounts', auth=False)
def demo_accounts(req):
    return ok({'accounts': DEMO_ACCOUNTS})


@api.get('/api/options')
def options(req):
    """下拉选项：类别、供应商、顾客、员工、支付方式、库位等。"""
    data = {
        'categories': db.rows_to_dict(db.query('SELECT * FROM ProductCategory WHERE RecordStatus="A" ORDER BY CategoryID')),
        'suppliers': db.rows_to_dict(db.query(
            'SELECT s.*, t.PaymentTermDays, t.MaxReturnRatio, t.AllowedExpenseTypes FROM Supplier s '
            'LEFT JOIN SettlementTerm t ON t.SupplierID = s.SupplierID AND t.RecordStatus="A" '
            'WHERE s.RecordStatus="A" ORDER BY s.SupplierID')),
        'customers': db.rows_to_dict(db.query(
            'SELECT c.*, m.MemberID, m.Level, m.Points FROM Customer c '
            'LEFT JOIN Member m ON m.CustomerID = c.CustomerID AND m.RecordStatus="A" '
            'WHERE c.RecordStatus="A" ORDER BY c.CustomerID')),
        'employees': db.rows_to_dict(db.query(
            'SELECT EmployeeID, Name, Role, LoginName FROM Employee WHERE RecordStatus="A"')),
        'payMethods': ['现金', '银联', '银豹付', '微信支付', '支付宝'],
        'channels': [{'value': 'group', 'label': '微信群'}, {'value': 'miniProgram', 'label': '小程序'},
                     {'value': 'platform', 'label': '第三方平台'}],
        'locations': ['蔬-01', '蔬-02', '生-01', '生-02', '食-01', '食-02', '杂-01', '饮-01',
                      '饮-02', '烟-01', '日-01', '学-01', '礼-01'],
        'expenseTypes': ['陈列费', '促销费', '返利', '损耗补偿'],
        'roles': [{'value': 'Owner', 'label': '老板'}, {'value': 'Stocker', 'label': '理货员'},
                  {'value': 'Salesperson', 'label': '销售人员'}, {'value': 'Supplier', 'label': '供货商业务员'}],
        'store': {'name': '平利县寅利丰生活超市', 'system': '门店经营助手', 'owner': '演示老板',
                  'address': '示例省示例市模拟区课程路 1 号'},
    }
    return ok(data)


@api.get('/api/health', auth=False)
def health(req):
    db.scalar('SELECT 1')
    return ok({'status': 'up', 'time': now(), 'database': 'ok', 'version': '1.0.0'})
