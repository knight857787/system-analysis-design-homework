"""门店经营助手 · 启动入口。

用法：
    python run.py                # 首次运行会自动建库并灌入演示数据
    python run.py --reset        # 删库重建（重置演示数据）
    python run.py --port 8080    # 指定端口
    python run.py --host 0.0.0.0 # 允许手机等设备通过局域网访问
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server import db  # noqa: E402
from server import routes  # noqa: E402,F401  注册全部 API 路由
from server.core import AppServer  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description='门店经营助手（洋流生活超市课程模拟店）')
    parser.add_argument('--host', default=os.environ.get('APP_HOST', '127.0.0.1'),
                        help='监听地址，0.0.0.0 表示允许局域网或反向代理访问')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '19870')),
                        help='监听端口（默认读取 PORT，未设置时为 19870）')
    parser.add_argument('--reset', action='store_true', help='删除现有数据库并重置演示数据')
    args = parser.parse_args()

    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print('[启动] 正在检查数据库…')
    db.init_db(force=args.reset)
    db.migrate()
    imported = db.scalar('SELECT COUNT(*) FROM Employee')
    print('[启动] 数据库就绪：员工 %d 人，商品 %d 个，销售单 %d 张' % (
        imported,
        db.scalar('SELECT COUNT(*) FROM Product'),
        db.scalar('SELECT COUNT(*) FROM SaleOrder')))
    db.close_db()

    try:
        AppServer(host=args.host, port=args.port).serve_forever()
    except OSError as exc:
        print('[错误] 无法监听 %s:%d —— %s' % (args.host, args.port, exc))
        print('       端口被占用时可换一个端口：python run.py --port 19871')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
