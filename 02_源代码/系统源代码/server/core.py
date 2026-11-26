"""HTTP 核心：路由、请求/响应、登录态、角色权限、静态文件。"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from server import db

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(BASE_DIR, 'web')
SESSION_COOKIE = 'ylf_sid'
SESSION_HOURS = 12

OWNER = 'Owner'
STOCKER = 'Stocker'
SALESPERSON = 'Salesperson'
SUPPLIER = 'Supplier'
STAFF = (OWNER, STOCKER, SALESPERSON)
ALL_ROLES = (OWNER, STOCKER, SALESPERSON, SUPPLIER)
ROLE_LABEL = {OWNER: '老板', STOCKER: '理货员', SALESPERSON: '销售人员', SUPPLIER: '供货商业务员'}


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = 'BAD_REQUEST'):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def bad(message: str, status: int = 400):
    raise ApiError(message, status)


def require(condition, message: str, status: int = 400):
    if not condition:
        raise ApiError(message, status)


# --------------------------------------------------------------------------
# 数值/文本工具
# --------------------------------------------------------------------------
def num(value, field: str = '数值', allow_none: bool = False, minimum=None):
    if value is None or value == '':
        if allow_none:
            return None
        bad(f'{field}不能为空')
    try:
        v = float(value)
    except (TypeError, ValueError):
        bad(f'{field}必须是数字')
    if minimum is not None and v < minimum:
        bad(f'{field}不能小于{minimum}')
    return v


def integer(value, field: str = '数值', allow_none: bool = False, minimum=None):
    if value is None or value == '':
        if allow_none:
            return None
        bad(f'{field}不能为空')
    try:
        v = int(value)
    except (TypeError, ValueError):
        bad(f'{field}必须是整数')
    if minimum is not None and v < minimum:
        bad(f'{field}不能小于{minimum}')
    return v


def text(value, field: str, required: bool = True, maxlen: int = 200, default: str = ''):
    if value is None:
        value = ''
    s = str(value).strip()
    if required and not s:
        bad(f'{field}不能为空')
    if len(s) > maxlen:
        bad(f'{field}不能超过 {maxlen} 个字符')
    return s or default


def pick(row, *keys, default=None):
    """从 sqlite3.Row / dict 取第一个存在的键。"""
    if row is None:
        return default
    for k in keys:
        try:
            v = row[k]
        except (KeyError, IndexError):
            continue
        if v is not None:
            return v
    return default


def row_to_dict(row):
    if row is None:
        return None
    if isinstance(row, dict):
        return row
    return {k: row[k] for k in row.keys()}


def rows_to_dict(rows):
    return [row_to_dict(r) for r in rows]


def today() -> str:
    return datetime.now().strftime('%Y-%m-%d')


def money(value) -> float:
    try:
        return round(float(value) + 1e-9, 2)
    except (TypeError, ValueError):
        return 0.0


def now() -> str:
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def doc_no(prefix: str) -> str:
    """单据号：前缀 + yymmdd + 6 位随机，保证唯一且门店端可离线生成。"""
    return prefix + datetime.now().strftime('%y%m%d') + secrets.token_hex(3).upper()


# --------------------------------------------------------------------------
# 请求与响应
# --------------------------------------------------------------------------
class Request:
    def __init__(self, method, path, query, body, headers, cookies, ip, params):
        self.method = method
        self.path = path
        self.query = query
        self.body = body if isinstance(body, dict) else {}
        self.headers = headers
        self.cookies = cookies
        self.ip = ip
        self.params = params
        self.employee = None
        self.token = None

    # 便捷取值
    def q(self, key, default=None):
        v = self.query.get(key)
        if isinstance(v, list):
            return v[0] if v else default
        return v if v is not None else default

    def qnum(self, key, default=None):
        v = self.q(key)
        if v in (None, ''):
            return default
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    def qint(self, key, default=None):
        v = self.q(key)
        if v in (None, ''):
            return default
        try:
            return int(v)
        except (TypeError, ValueError):
            return default

    def f(self, key, default=None):
        v = self.body.get(key, default)
        return v

    def role(self) -> str:
        return self.employee['Role'] if self.employee else ''

    def is_owner(self) -> bool:
        return self.role() == OWNER

    def page_args(self, default_size=20, max_size=200):
        page = max(1, self.qint('page', 1) or 1)
        size = min(max_size, max(1, self.qint('size', default_size) or default_size))
        return page, size


class Response:
    def __init__(self, payload=None, status=200, headers=None, raw=None, content_type='application/json'):
        self.payload = payload
        self.status = status
        self.headers = headers or []
        self.raw = raw
        self.content_type = content_type


# 字段级脱敏：路由级权限只能拦住整条接口，同一接口里仍可能带出角色不该看的字段。
# 依据报告表 25：理货员不接触钱与库存金额；销售不接触成本与毛利；供货商不接触门店成本。
ROLE_HIDDEN_FIELDS = {
    STOCKER: {
        'PurchasePrice', 'CostPrice', 'UnitCost', 'Cost', 'CostAmount', 'TotalCost',
        'Profit', 'ProfitAmount', 'margin', 'Margin',
        'Amount', 'TotalAmount', 'Subtotal', 'PayableAmount', 'OutstandingAmount',
        'value', 'Value', 'stockValue', 'profit',
    },
    SALESPERSON: {
        'PurchasePrice', 'CostPrice', 'UnitCost', 'Cost', 'CostAmount', 'TotalCost',
        'Profit', 'ProfitAmount', 'profit', 'margin', 'Margin', 'value', 'Value', 'stockValue',
    },
    SUPPLIER: {
        'CostPrice', 'UnitCost', 'Cost', 'CostAmount', 'TotalCost',
        'Profit', 'ProfitAmount', 'profit', 'margin', 'Margin',
    },
}


def sanitize_for_role(payload, role):
    """按角色剔除敏感字段，不改动结构与顺序。"""
    hidden = ROLE_HIDDEN_FIELDS.get(role)
    if not hidden:
        return payload

    def walk(node):
        if isinstance(node, dict):
            return {k: walk(v) for k, v in node.items() if k not in hidden}
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node

    return walk(payload)


def ok(payload=None, **extra):
    data = {'ok': True}
    if isinstance(payload, dict):
        data.update(payload)
    elif payload is not None:
        data['data'] = payload
    data.update(extra)
    return Response(data)


def fail(message, status=400, code='BAD_REQUEST'):
    return Response({'ok': False, 'error': message, 'code': code}, status=status)


# --------------------------------------------------------------------------
# 路由
# --------------------------------------------------------------------------
def compile_pattern(pattern: str):
    names = []
    kinds = []
    out = '^'
    for part in re.split(r'(<[^>]+>)', pattern):
        if part.startswith('<') and part.endswith('>'):
            body = part[1:-1]
            if ':' in body:
                kind, name = body.split(':', 1)
            else:
                kind, name = 'str', body
            names.append(name)
            kinds.append(kind)
            out += r'(\d+)' if kind == 'int' else r'([^/]+)'
        else:
            out += re.escape(part)
    return re.compile(out + '$'), names, kinds


class Route:
    def __init__(self, method, pattern, handler, roles, auth, audit):
        self.method = method
        self.pattern = pattern
        self.handler = handler
        self.roles = roles
        self.auth = auth
        self.audit = audit
        self.regex, self.names, self.kinds = compile_pattern(pattern)

    def match(self, method, path):
        if method != self.method:
            return None
        m = self.regex.match(path)
        if not m:
            return None
        params = {}
        for name, kind, value in zip(self.names, self.kinds, m.groups()):
            params[name] = int(value) if kind == 'int' else value
        return params


class Router:
    def __init__(self):
        self.routes: list[Route] = []

    def add(self, method, pattern, roles=None, auth=True, audit=True):
        def decorator(fn):
            self.routes.append(Route(method, pattern, fn, roles, auth, audit))
            return fn
        return decorator

    def get(self, pattern, roles=None, auth=True):
        return self.add('GET', pattern, roles=roles, auth=auth, audit=False)

    def post(self, pattern, roles=None, auth=True, audit=True):
        return self.add('POST', pattern, roles=roles, auth=auth, audit=audit)

    def put(self, pattern, roles=None, auth=True, audit=True):
        return self.add('PUT', pattern, roles=roles, auth=auth, audit=audit)

    def delete(self, pattern, roles=None, auth=True, audit=True):
        return self.add('DELETE', pattern, roles=roles, auth=auth, audit=audit)

    def resolve(self, method, path):
        for route in self.routes:
            params = route.match(method, path)
            if params is not None:
                return route, params
        return None, None


api = Router()


# --------------------------------------------------------------------------
# 登录态
# --------------------------------------------------------------------------
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = _scrypt(password, salt)
    return f'scrypt${salt}${digest}'


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt, digest = stored.split('$')
    except ValueError:
        return False
    if algo != 'scrypt':
        return False
    return secrets.compare_digest(_scrypt(password, salt), digest)


def _scrypt(password: str, salt: str) -> str:
    import hashlib
    return hashlib.scrypt(password.encode('utf-8'), salt=salt.encode('utf-8'),
                          n=16384, r=8, p=1, dklen=32).hex()


def create_session(employee_id: int, user_agent: str = '') -> str:
    token = secrets.token_urlsafe(32)
    created = now()
    expires = datetime.now().timestamp() + SESSION_HOURS * 3600
    expires_str = datetime.fromtimestamp(expires).strftime('%Y-%m-%d %H:%M:%S')
    db.execute('INSERT INTO SessionToken (Token, EmployeeID, CreatedAt, ExpiresAt, UserAgent) VALUES (?,?,?,?,?)',
               (token, employee_id, created, expires_str, user_agent[:200]))
    return token


def load_session(token: str):
    if not token:
        return None
    row = db.query_one(
        'SELECT e.*, s.ExpiresAt FROM SessionToken s JOIN Employee e ON e.EmployeeID = s.EmployeeID '
        'WHERE s.Token = ? AND e.RecordStatus = "A"', (token,))
    if not row:
        return None
    if row['ExpiresAt'] < now():
        db.execute('DELETE FROM SessionToken WHERE Token = ?', (token,))
        return None
    return row


def destroy_session(token: str) -> None:
    if token:
        db.execute('DELETE FROM SessionToken WHERE Token = ?', (token,))


def sanitize_user(row) -> dict:
    if row is None:
        return None
    d = {
        'employeeId': row['EmployeeID'],
        'name': row['Name'],
        'loginName': row['LoginName'],
        'role': row['Role'],
        'roleLabel': ROLE_LABEL.get(row['Role'], row['Role']),
        'phone': row['Phone'],
        'supplierId': row['SupplierID'],
    }
    return d


def redact_audit_detail(value) -> str:
    """脱敏请求体，避免密码、令牌等敏感字段进入审计日志。"""
    sensitive = ('password', 'token', 'secret', 'credential')
    if isinstance(value, dict):
        safe = {
            key: '[REDACTED]' if any(word in str(key).lower() for word in sensitive) else item
            for key, item in value.items()
        }
    else:
        safe = value
    return json.dumps(safe, ensure_ascii=False)[:400]


def write_audit(req: Request, action: str, entity: str = '', entity_id='', detail: str = '') -> None:
    try:
        db.execute(
            'INSERT INTO AuditLog (EmployeeID, EmployeeName, Role, Action, Entity, EntityID, Detail, IP, CreatedAt) '
            'VALUES (?,?,?,?,?,?,?,?,?)',
            (req.employee['EmployeeID'] if req.employee else None,
             req.employee['Name'] if req.employee else '匿名',
             req.employee['Role'] if req.employee else '',
             action, entity, str(entity_id), detail[:500], req.ip, now()))
    except Exception:
        pass


# --------------------------------------------------------------------------
# 请求处理
# --------------------------------------------------------------------------
def parse_cookies(header: str) -> dict:
    out = {}
    for chunk in (header or '').split(';'):
        if '=' in chunk:
            k, v = chunk.split('=', 1)
            out[k.strip()] = unquote(v.strip())
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = 'YinlifengStore/1.0'
    protocol_version = 'HTTP/1.1'

    # 屏蔽 BaseHTTPRequestHandler 的默认日志，改为简洁日志
    def log_message(self, fmt, *args):
        if os.environ.get('YLF_DEBUG'):
            sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))

    def do_GET(self):
        self._dispatch('GET')

    def do_HEAD(self):
        """HEAD 与 GET 使用同一路由和头信息，但不返回响应正文。"""
        self._dispatch('GET')

    def do_POST(self):
        self._dispatch('POST')

    def do_PUT(self):
        self._dispatch('PUT')

    def do_DELETE(self):
        self._dispatch('DELETE')

    # ------------------------------------------------------------------
    def _dispatch(self, method):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query, keep_blank_values=True)
        headers = {k.lower(): v for k, v in self.headers.items()}
        cookies = parse_cookies(headers.get('cookie', ''))
        body = {}
        length = int(headers.get('content-length') or 0)
        if length:
            raw = self.rfile.read(length)
            ctype = headers.get('content-type', '')
            if 'application/json' in ctype and raw:
                try:
                    body = json.loads(raw.decode('utf-8'))
                except Exception:
                    return self._send(fail('请求体不是合法的 JSON'))
            elif 'application/x-www-form-urlencoded' in ctype:
                body = {k: v[0] for k, v in parse_qs(raw.decode('utf-8')).items()}
        req = Request(method, path, query, body, headers, cookies,
                      self.client_address[0] if self.client_address else '', {})

        try:
            if path.startswith('/api/'):
                route, params = api.resolve(method, path)
                if route is None:
                    return self._send(fail('接口不存在：%s %s' % (method, path), 404, 'NOT_FOUND'))
                req.params = params
                if route.auth:
                    # 浏览器用 Cookie；小程序/第三方客户端用 Authorization: Bearer <token>
                    token = cookies.get(SESSION_COOKIE, '')
                    authz = (headers.get('authorization') or '').strip()
                    if not token and authz.lower().startswith('bearer '):
                        token = authz[7:].strip()
                    employee = load_session(token)
                    if employee is None:
                        return self._send(fail('登录已失效，请重新登录', 401, 'UNAUTHORIZED'))
                    req.employee = employee
                    req.token = token
                    if route.roles and employee['Role'] not in route.roles:
                        return self._send(fail('当前角色（%s）无权执行该操作' %
                                               ROLE_LABEL.get(employee['Role'], employee['Role']), 403, 'FORBIDDEN'))
                result = route.handler(req)
                if req.employee:
                    # handler 返回 Response（ok() 的产物），需按角色脱敏其 payload
                    if isinstance(result, Response):
                        result.payload = sanitize_for_role(result.payload, req.employee['Role'])
                    else:
                        result = sanitize_for_role(result, req.employee['Role'])
                if route.audit and method in ('POST', 'PUT', 'DELETE') and req.employee:
                    write_audit(req, '%s %s' % (method, path), entity=path.split('/')[2] if len(path.split('/')) > 2 else '',
                                entity_id=params.get('id', ''), detail=redact_audit_detail(body))
                if isinstance(result, Response):
                    return self._send(result)
                return self._send(ok(result))
            # 静态文件
            return self._serve_static(path)
        except ApiError as exc:
            return self._send(fail(exc.message, exc.status, exc.code))
        except BrokenPipeError:
            return
        except Exception as exc:  # noqa: BLE001
            if os.environ.get('YLF_DEBUG'):
                traceback.print_exc()
            return self._send(fail('服务器内部错误：%s' % exc, 500, 'INTERNAL'))
        finally:
            db.close_db()

    def _send(self, resp: Response):
        if resp.raw is not None:
            payload = resp.raw
            ctype = resp.content_type
        else:
            payload = json.dumps(resp.payload, ensure_ascii=False, default=str).encode('utf-8')
            ctype = 'application/json; charset=utf-8'
        self.send_response(resp.status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store' if ctype.startswith('application/json') else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
        for k, v in resp.headers:
            self.send_header(k, v)
        self.end_headers()
        if self.command == 'HEAD':
            return
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _serve_static(self, path: str):
        if path in ('/', '/index.html'):
            rel = 'index.html'
        else:
            rel = path.lstrip('/')
            if rel.startswith('web/'):
                rel = rel[4:]
        full = os.path.normpath(os.path.join(WEB_DIR, rel))
        if not full.startswith(os.path.normpath(WEB_DIR)):
            return self._send(Response(raw=b'403 forbidden', status=403, content_type='text/plain; charset=utf-8'))
        if not os.path.isfile(full):
            # SPA 回退
            if not os.path.splitext(rel)[1]:
                full = os.path.join(WEB_DIR, 'index.html')
                rel = 'index.html'
            else:
                return self._send(Response(raw=b'404 not found', status=404, content_type='text/plain; charset=utf-8'))
        ext = os.path.splitext(full)[1].lower()
        # 显式 MIME：Python 的 mimetypes 在部分版本上把 .css 标成 application/x-css，
        # 浏览器会拒绝应用样式表，因此在这里固定常见静态资源的类型。
        CTYPE = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.mjs': 'text/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.ico': 'image/x-icon',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.map': 'application/json; charset=utf-8',
            '.txt': 'text/plain; charset=utf-8',
            '.csv': 'text/csv; charset=utf-8',
        }
        ctype = CTYPE.get(ext) or (mimetypes.guess_type(full)[0] or 'application/octet-stream')
        with open(full, 'rb') as fp:
            data = fp.read()
        return self._send(Response(raw=data, status=200, content_type=ctype))


class AppServer:
    def __init__(self, host='127.0.0.1', port=19870):
        self.host = host
        self.port = port
        self.httpd = None

    def serve_forever(self):
        self.httpd = ThreadingHTTPServer((self.host, self.port), Handler)
        self.httpd.daemon_threads = True
        print('=' * 62)
        print('  门店经营助手 · 平利县寅利丰生活超市')
        print('  访问地址：http://%s:%d' % ('127.0.0.1' if self.host in ('0.0.0.0', '') else self.host, self.port))
        print('  演示账号：boss / boss123（老板）  stocker / stocker123（理货员）')
        print('            sales / sales123（销售人员）  supplier / supplier123（供货商）')
        print('  停止服务：Ctrl + C')
        print('=' * 62)
        try:
            self.httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n服务已停止')
        finally:
            self.httpd.server_close()
