"""路由注册：导入各业务模块即完成注册。"""
from server.routes import (admin, auth, catalog, credit, dashboard, expiry, inventory, online,  # noqa: F401
                           purchasing, reports, sales, settlement, suppliers)
