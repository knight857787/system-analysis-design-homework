"""演示数据：完全使用虚构门店、人员、联系方式与交易记录。

要点
- 所有姓名、电话、地址、门店和供应商均为模拟数据
- 手机号使用明显不可用于联系的真实号码段之外的演示编号
- 商品交易、库存、临期、报损、赊账、线上订单与对账数据均用于功能演示
- 库存为正，便于演示完整的收货、销售、盘点和追溯流程
- 临期、报损、赊账、线上订单、对账差异都留有可直接操作的演示数据
"""
from __future__ import annotations

import os
import random
from datetime import datetime, timedelta

from server import db
from server.core import hash_password

random.seed(20261014)

NOW = datetime.now()
TODAY = NOW.strftime('%Y-%m-%d')


def ts(dt: datetime) -> str:
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def dstr(dt) -> str:
    return dt.strftime('%Y-%m-%d')


def money(v) -> float:
    return round(float(v) + 1e-9, 2)


def qty(v) -> float:
    return round(float(v) + 1e-9, 3)


# --------------------------------------------------------------------------
# 基础资料
# --------------------------------------------------------------------------
CATEGORIES = [
    # 名称, 临期预警比例
    ('蔬菜', 0.35),
    ('生鲜果蔬', 0.35),
    ('食品', 0.25),
    ('杂粮', 0.20),
    ('饮料', 0.25),
    ('烟', 0.15),
    ('日用品', 0.15),
    ('学习用品', 0.15),
    ('礼盒', 0.25),
]

SUPPLIERS = [
    # 名称, 联系人, 电话, 地址, 账期, 退货比例, 费用项目
    ('模拟供应商甲（饮料）', '联系人甲', '13800001001', '示例市模拟区配送路 1 号', 30, 0.02, '陈列费,促销费'),
    ('模拟供应商乙（食品）', '联系人乙', '13800001002', '示例市模拟区配送路 2 号', 45, 0.03, '陈列费,促销费,返利'),
    ('模拟供应商丙（文具）', '联系人丙', '13800001003', '示例市模拟区配送路 3 号', 15, 0.01, '陈列费'),
    ('模拟供应商丁（日用品）', '联系人丁', '13800001004', '示例市模拟区配送路 4 号', 30, 0.02, '陈列费,促销费'),
    ('模拟供应商戊（生鲜）', '联系人戊', '13800001005', '示例市模拟区配送路 5 号', 7, 0.01, '损耗补偿'),
]

# 品类 -> (毛利率下限, 上限), 保质期范围
CATEGORY_MARGIN = {
    '蔬菜': (0.15, 0.23), '生鲜果蔬': (0.13, 0.21), '食品': (0.12, 0.19),
    '杂粮': (0.09, 0.17), '饮料': (0.14, 0.22), '烟': (0.05, 0.10),
    '日用品': (0.17, 0.27), '学习用品': (0.24, 0.37), '礼盒': (0.19, 0.29),
}
CATEGORY_SUPPLIER = {
    '蔬菜': 5, '生鲜果蔬': 4, '食品': 2, '杂粮': 4, '饮料': 1,
    '烟': 2, '日用品': 1, '学习用品': 3, '礼盒': 2,
}

# (类别, 品名, 规格, 单位, 售价, 保质期天数)
PRODUCTS = [
    ('蔬菜', '土豆', '散装', 'kg', 1.98, 7),
    ('蔬菜', '大白菜', '散装', 'kg', 2.50, 5),
    ('蔬菜', '白萝卜', '散装', 'kg', 1.98, 7),
    ('蔬菜', '胡萝卜', '散装', 'kg', 2.98, 10),
    ('蔬菜', '西红柿', '散装', 'kg', 4.98, 5),
    ('蔬菜', '黄瓜', '散装', 'kg', 3.98, 4),
    ('蔬菜', '青椒', '散装', 'kg', 5.98, 5),
    ('蔬菜', '茄子', '散装', 'kg', 3.28, 5),
    ('蔬菜', '生姜', '散装', 'kg', 8.80, 20),
    ('蔬菜', '大蒜', '散装', 'kg', 7.60, 20),
    ('蔬菜', '小青菜', '散装', 'kg', 3.20, 3),
    ('蔬菜', '莲藕', '散装', 'kg', 6.60, 7),
    ('生鲜果蔬', '豆腐', '散装', 'kg', 3.50, 3),
    ('生鲜果蔬', '豆腐皮', '散装', 'kg', 7.80, 3),
    ('生鲜果蔬', '鸡蛋', '30 枚/板', '板', 22.00, 30),
    ('生鲜果蔬', '猪肉（后腿）', '散装', 'kg', 26.80, 3),
    ('生鲜果蔬', '鸡胸肉', '散装', 'kg', 18.80, 5),
    ('生鲜果蔬', '带鱼', '散装冷冻', 'kg', 19.90, 90),
    ('生鲜果蔬', '苹果', '散装', 'kg', 6.80, 20),
    ('生鲜果蔬', '香蕉', '散装', 'kg', 4.98, 6),
    ('生鲜果蔬', '橘子', '散装', 'kg', 5.80, 14),
    ('生鲜果蔬', '西瓜', '散装', 'kg', 2.98, 10),
    ('生鲜果蔬', '平菇', '散装', 'kg', 9.80, 3),
    ('生鲜果蔬', '金针菇', '150g/包', '包', 3.50, 15),
    ('食品', '康师傅红烧牛肉面', '5 连包', '袋', 13.90, 180),
    ('食品', '康师傅老坛酸菜面', '5 连包', '袋', 13.50, 180),
    ('食品', '双汇火腿肠', '36g', '根', 2.00, 120),
    ('食品', '金锣王中王火腿肠', '10 支装', '袋', 16.80, 120),
    ('食品', '蒙牛纯牛奶', '250ml×12', '箱', 42.00, 180),
    ('食品', '伊利安慕希酸奶', '200g', '瓶', 5.50, 120),
    ('食品', '洽洽香瓜子', '260g', '袋', 9.90, 240),
    ('食品', '乐事黄瓜味薯片', '70g', '袋', 5.50, 180),
    ('食品', '奥利奥饼干', '116g', '包', 6.50, 300),
    ('食品', '好吃点饼干', '200g', '包', 5.80, 300),
    ('食品', '桃酥', '散装', 'kg', 12.80, 20),
    ('食品', '桃李面包', '500g', '袋', 8.50, 7),
    ('食品', '老干妈风味豆豉', '280g', '瓶', 9.90, 540),
    ('食品', '海天金标生抽', '1.28L', '瓶', 13.80, 540),
    ('食品', '加加陈醋', '800ml', '瓶', 7.50, 720),
    ('食品', '太太乐鸡精', '200g', '袋', 7.20, 540),
    ('食品', '陈克明挂面', '1kg', '把', 5.90, 365),
    ('食品', '龙口粉丝', '300g', '袋', 4.80, 540),
    ('食品', '紫菜', '50g', '包', 3.90, 365),
    ('食品', '黑木耳', '100g', '袋', 8.80, 540),
    ('食品', '干香菇', '100g', '袋', 9.50, 540),
    ('食品', '海底捞火锅底料', '150g', '袋', 9.90, 540),
    ('食品', '洋槐蜂蜜', '500g', '瓶', 21.80, 720),
    ('食品', '单晶冰糖', '400g', '袋', 5.20, 720),
    ('食品', '白砂糖', '400g', '袋', 4.50, 720),
    ('食品', '加碘食用盐', '400g', '袋', 2.00, 1080),
    ('杂粮', '东北大米', '5kg', '袋', 32.80, 365),
    ('杂粮', '雪花面粉', '5kg', '袋', 21.80, 365),
    ('杂粮', '小米', '散装', 'kg', 6.98, 365),
    ('杂粮', '玉米面', '散装', 'kg', 3.98, 300),
    ('杂粮', '红豆', '散装', 'kg', 9.80, 540),
    ('杂粮', '绿豆', '散装', 'kg', 8.60, 540),
    ('杂粮', '花生米', '散装', 'kg', 11.80, 240),
    ('杂粮', '糯米', '散装', 'kg', 5.60, 540),
    ('饮料', '娃哈哈纯净水', '596ml', '瓶', 1.50, 365),
    ('饮料', '农夫山泉', '550ml', '瓶', 2.00, 365),
    ('饮料', '可口可乐', '500ml', '瓶', 3.00, 365),
    ('饮料', '雪碧', '500ml', '瓶', 3.00, 365),
    ('饮料', '康师傅冰红茶', '500ml', '瓶', 3.50, 270),
    ('饮料', '康师傅绿茶', '500ml', '瓶', 3.50, 270),
    ('饮料', '王老吉', '310ml', '罐', 4.50, 365),
    ('饮料', '红牛维生素功能饮料', '250ml', '罐', 6.00, 540),
    ('饮料', '伊利优酸乳', '250ml', '瓶', 2.80, 150),
    ('饮料', '蒙牛酸酸乳', '250ml', '盒', 2.80, 150),
    ('饮料', '脉动', '600ml', '瓶', 4.50, 270),
    ('饮料', '果粒橙', '450ml', '瓶', 4.00, 180),
    ('饮料', '苏打水', '410ml', '瓶', 3.50, 365),
    ('饮料', '青岛啤酒', '500ml 罐装', '罐', 4.50, 365),
    ('烟', '中华（软）', '盒', '盒', 65.00, 730),
    ('烟', '芙蓉王（硬）', '盒', '盒', 23.00, 730),
    ('烟', '玉溪（软）', '盒', '盒', 22.50, 730),
    ('烟', '云烟（紫）', '盒', '盒', 10.50, 730),
    ('烟', '利群（新版）', '盒', '盒', 16.50, 730),
    ('烟', '黄鹤楼（软蓝）', '盒', '盒', 19.00, 730),
    ('日用品', '白猫洗洁精', '500g', '瓶', 6.90, 1095),
    ('日用品', '立白洗衣粉', '1kg', '袋', 11.80, 1095),
    ('日用品', '雕牌透明皂', '206g', '块', 4.50, 1095),
    ('日用品', '舒肤佳香皂', '115g', '块', 5.90, 1095),
    ('日用品', '心相印抽纸', '3 层×130 抽', '包', 6.50, 1095),
    ('日用品', '洁柔卷纸', '10 卷/提', '提', 22.80, 1095),
    ('日用品', '高露洁牙膏', '120g', '支', 9.90, 1095),
    ('日用品', '软毛牙刷', '2 支装', '板', 6.80, 1095),
    ('日用品', '清扬洗发水', '400ml', '瓶', 39.90, 1095),
    ('日用品', '力士沐浴露', '400ml', '瓶', 32.80, 1095),
    ('日用品', '背心式垃圾袋', '30 只', '卷', 5.50, 1095),
    ('日用品', '一次性纸杯', '50 只', '包', 5.80, 1095),
    ('日用品', '南孚电池 5 号', '4 粒', '板', 9.90, 1825),
    ('日用品', '雷达电蚊香液', '1 器 2 液', '套', 26.80, 1095),
    ('学习用品', '中性笔（黑）', '0.5mm', '支', 2.00, 1825),
    ('学习用品', 'HB 铅笔', '12 支装', '盒', 6.50, 1825),
    ('学习用品', '橡皮擦', '4B', '块', 1.50, 1825),
    ('学习用品', '作业本', '16 开', '本', 1.80, 1825),
    ('学习用品', '笔记本', 'A5', '本', 5.50, 1825),
    ('学习用品', '文件袋', 'A4 拉链', '个', 3.50, 1825),
    ('学习用品', '订书机', '12 号', '个', 12.80, 1825),
    ('学习用品', '订书钉', '24/6', '盒', 2.00, 1825),
    ('学习用品', '卷笔刀', '双孔', '个', 3.00, 1825),
    ('学习用品', '直尺', '20cm', '把', 1.80, 1825),
    ('礼盒', '蒙牛特仑苏礼盒', '250ml×12', '盒', 62.00, 180),
    ('礼盒', '伊利金典礼盒', '250ml×12', '盒', 65.00, 180),
    ('礼盒', '三只松鼠坚果礼盒', '1.5kg', '盒', 128.00, 180),
    ('礼盒', '六个核桃礼盒', '240ml×20', '盒', 68.00, 240),
    ('礼盒', '泸州老窖礼盒', '500ml×2', '盒', 268.00, 1825),
]

# 演示口令：与 /api/auth/demo-accounts 保持一致，可用环境变量覆盖
DEMO_PASSWORD = os.environ.get('DEMO_PASSWORD', 'YlfDemo2026')

# 预置账号：四个角色各一个，供老师直接登录查看分层架构；
# 同时保留邀请码注册（老板在「系统说明 → 邀请码」生成），可用于新增员工账号。
EMPLOYEES = [
    # 登录名, 密码, 姓名, 角色, 电话
    ('boss', DEMO_PASSWORD, '演示老板', 'Owner', '13800000001'),
    ('stocker', DEMO_PASSWORD, '演示理货员', 'Stocker', '13800000002'),
    ('sales', DEMO_PASSWORD, '演示销售员', 'Salesperson', '13800000003'),
    ('supplier', DEMO_PASSWORD, '供应商联系人甲', 'Supplier', '13800000004'),
]

CUSTOMERS = [
    # 姓名, 电话, 地址, 赊账额度, 账期, 是否会员, 会员等级, 备注
    ('模拟顾客 01', '13800000101', '示例市模拟区一号路 1 号', 800, 30, 'Y', '银卡', '高频复购演示账户'),
    ('模拟顾客 02', '13800000102', '示例市模拟区一号路 2 号', 500, 30, 'Y', '普通', '团队采购演示账户'),
    ('模拟顾客 03', '13800000103', '示例市模拟区一号路 3 号', 300, 15, 'Y', '普通', '日用品复购演示'),
    ('模拟顾客 04', '13800000104', '示例市模拟区一号路 4 号', 1000, 30, 'Y', '金卡', '大宗采购演示账户'),
    ('模拟顾客 05', '13800000105', '示例市模拟区一号路 5 号', 400, 30, 'Y', '普通', '赊账演示账户'),
    ('模拟顾客 06', '13800000106', '示例市模拟区一号路 6 号', 600, 30, 'Y', '银卡', '节庆采购演示'),
    ('模拟顾客 07', '13800000107', '示例市模拟区一号路 7 号', 0, 0, 'Y', '普通', '普通会员演示'),
    ('模拟顾客 08', '13800000108', '示例市模拟区一号路 8 号', 0, 0, 'Y', '普通', '普通会员演示'),
    ('模拟顾客 09', '13800000109', '示例市模拟区一号路 9 号', 0, 0, 'Y', '普通', '普通会员演示'),
    ('模拟顾客 10', '13800000110', '示例市模拟区一号路 10 号', 0, 0, 'Y', '普通', '普通会员演示'),
    ('模拟顾客 11', '13800000111', '示例市模拟区一号路 11 号', 0, 0, 'Y', '普通', '普通会员演示'),
    ('模拟顾客 12', '13800000112', '示例市模拟区一号路 12 号', 0, 0, 'Y', '普通', '普通会员演示'),
]

EXPENSE_TYPES = ['陈列费', '促销费', '返利', '损耗补偿']


def seed_all() -> None:
    with db.Tx() as conn:
        suppliers = seed_suppliers(conn)
        employees = seed_employees(conn, suppliers)
        categories = seed_categories(conn)
        rules = seed_markdown_rules(conn, categories)
        products = seed_products(conn, categories, suppliers)
        customers, members = seed_customers(conn)
        batches, receipts = seed_receipts_and_batches(conn, products, suppliers, employees)
        sold = seed_sales(conn, products, customers, members, employees, batches)
        seed_stock_ledger(conn, products, batches, sold)
        keep_ids = seed_expiry_and_loss(conn, products, batches, employees, rules, suppliers)
        clamp_batches(conn, keep_ids)
        shape_member_recent(conn, members)
        seed_purchase_orders(conn, products, suppliers, employees, receipts)
        seed_online_orders(conn, products, customers, employees, batches)
        seed_credit(conn, customers, employees)
        seed_members_points(conn, members, products)
        seed_statements(conn, suppliers, employees, receipts)
        seed_stocktake(conn, products, batches, employees)
        seed_expenses_and_returns(conn, suppliers, employees, products, batches)


# --------------------------------------------------------------------------
def seed_employees(conn, suppliers=None):
    out = {}
    for login, pwd, name, role, phone in EMPLOYEES:
        sid = suppliers[0]['id'] if (role == 'Supplier' and suppliers) else None
        status = 'A'
        cur = conn.execute(
            'INSERT INTO Employee (LoginName, PasswordHash, Name, Role, Phone, SupplierID, RecordStatus) '
            'VALUES (?,?,?,?,?,?,?)',
            (login, hash_password(pwd), name, role, phone, sid, status))
        key = {'Owner': 'boss', 'Stocker': 'stocker',
               'Salesperson': 'sales', 'Supplier': 'supplier'}[role]
        out[key] = cur.lastrowid
    return out


def seed_suppliers(conn):
    out = []
    for name, contact, phone, addr, term_days, return_ratio, expenses in SUPPLIERS:
        cur = conn.execute('INSERT INTO Supplier (Name, Contact, Phone, Address) VALUES (?,?,?,?)',
                           (name, contact, phone, addr))
        sid = cur.lastrowid
        conn.execute(
            'INSERT INTO SettlementTerm (SupplierID, PaymentTermDays, MaxReturnRatio, AllowedExpenseTypes, EffectiveDate) '
            'VALUES (?,?,?,?,?)', (sid, term_days, return_ratio, expenses, '2026-01-01'))
        conn.execute('INSERT INTO SupplierContact (SupplierID, Name, Phone, WeChat) VALUES (?,?,?,?)',
                     (sid, contact, phone, 'wx_' + phone))
        out.append({'id': sid, 'name': name, 'term': term_days, 'contact': contact})
    return out


def seed_categories(conn):
    out = {}
    for name, ratio in CATEGORIES:
        cur = conn.execute('INSERT INTO ProductCategory (CategoryName, ExpiryWarnRatio) VALUES (?,?)',
                           (name, ratio))
        out[name] = cur.lastrowid
    return out


def seed_markdown_rules(conn, categories):
    out = []
    plan = [
        ('蔬菜', '0-1 天', 0, 1, 0.50, '18:00'),
        ('蔬菜', '1-3 天', 1, 3, 0.80, '18:00'),
        ('生鲜果蔬', '0-1 天', 0, 1, 0.50, '18:00'),
        ('生鲜果蔬', '1-3 天', 1, 3, 0.80, '18:00'),
        ('食品', '0-7 天', 0, 7, 0.70, '19:00'),
        ('食品', '7-30 天', 7, 30, 0.90, '19:00'),
        ('饮料', '0-15 天', 0, 15, 0.80, '19:00'),
        ('杂粮', '0-30 天', 0, 30, 0.90, '19:00'),
    ]
    for cat, band, frm, to, rate, tm in plan:
        cur = conn.execute(
            'INSERT INTO MarkdownRule (CategoryID, TriggerTime, ShelfLifeBand, RemainDaysFrom, RemainDaysTo, '
            'DiscountRate, EffectiveDate) VALUES (?,?,?,?,?,?,?)',
            (categories.get(cat), tm, band, frm, to, rate, '2026-01-01'))
        out.append(cur.lastrowid)
    return out


def seed_products(conn, categories, suppliers):
    out = []
    weighing = 0
    for cat, name, spec, unit, price, shelf in PRODUCTS:
        category_id = categories[cat]
        supplier_idx = CATEGORY_SUPPLIER.get(cat, 1)
        supplier_id = suppliers[supplier_idx - 1]['id']
        if unit in ('kg',):
            weighing += 1
            barcode = 'SP%04d' % (1000 + weighing)
        else:
            barcode = '69' + ''.join(random.choice('0123456789') for _ in range(11))
        lo, hi = CATEGORY_MARGIN[cat]
        margin = random.uniform(lo, hi)
        cost = money(price * (1 - margin))
        cur = conn.execute(
            'INSERT INTO Product (CategoryID, Barcode, ProductName, Specification, Unit, ShelfLifeDays, '
            'ListPrice, OnShelfFlag, SupplierID) VALUES (?,?,?,?,?,?,?,?,?)',
            (category_id, barcode, name, spec, unit, shelf, price, 'Y', supplier_id))
        out.append({'id': cur.lastrowid, 'name': name, 'category': cat, 'price': price,
                    'cost': cost, 'unit': unit, 'shelf': shelf, 'supplier': supplier_id,
                    'popularity': None})
    # 热度：饮料/食品/蔬菜是走量品，烟与礼盒是低频高价
    weights = {'饮料': 2.4, '食品': 3.0, '蔬菜': 2.4, '生鲜果蔬': 2.4, '杂粮': 1.0,
               '日用品': 1.3, '学习用品': 0.7, '烟': 1.1, '礼盒': 0.4}
    for p in out:
        p['popularity'] = weights[p['category']] * random.uniform(0.6, 1.5)
    return out


def seed_customers(conn):
    customers = []
    members = []
    for idx, (name, phone, addr, limit, term, is_member, level, note) in enumerate(CUSTOMERS, start=1):
        cur = conn.execute(
            'INSERT INTO Customer (Name, Phone, Address, CreditLimit, CreditTermDays, IsMember, Note) '
            'VALUES (?,?,?,?,?,?,?)', (name, phone, addr, limit, term, is_member, note))
        cid = cur.lastrowid
        customers.append({'id': cid, 'name': name, 'phone': phone, 'limit': limit, 'term': term,
                          'isMember': is_member})
        if is_member == 'Y':
            join = dstr(NOW - timedelta(days=random.randint(40, 330)))
            cur2 = conn.execute(
                'INSERT INTO Member (MemberNo, CustomerID, JoinDate, Level, Points, LastVisitDate) '
                'VALUES (?,?,?,?,?,?)', ('M%05d' % (20260 + idx), cid, join, level,
                                         random.choice([0, 35, 60, 120, 260, 480]), None))
            members.append({'id': cur2.lastrowid, 'customerId': cid, 'name': name,
                            'level': level, 'join': join})
    return customers, members


# --------------------------------------------------------------------------
# 批次与收货
# --------------------------------------------------------------------------
def make_batch(conn, product, supplier_id, prod_date, shelf_days, cost, qty_in, arrival):
    batch_no = 'B' + arrival.strftime('%y%m%d') + '%03d' % random.randint(1, 999)
    expiry = prod_date + timedelta(days=shelf_days)
    cur = conn.execute(
        'INSERT INTO PurchaseBatch (BatchNo, ProductID, SupplierID, ProductionDate, ShelfLifeDays, '
        'ExpiryDate, PurchasePrice, ArrivalDate) VALUES (?,?,?,?,?,?,?,?)',
        (batch_no, product['id'], supplier_id, dstr(prod_date), shelf_days, dstr(expiry),
         cost, dstr(arrival)))
    return {'id': cur.lastrowid, 'productId': product['id'], 'expiry': expiry,
            'prodDate': prod_date, 'qtyIn': qty_in, 'cost': cost, 'supplier': supplier_id,
            'no': batch_no, 'arrival': arrival}


def seed_receipts_and_batches(conn, products, suppliers, employees):
    """近 20 天的到货：生成收货单、批次、进货查验记录。"""
    batches = []
    receipts = []
    stocker = employees['stocker']
    # 每个品类挑一部分商品，安排 1 次到货
    targets = []
    for p in products:
        if p['category'] in ('蔬菜', '生鲜果蔬'):
            if random.random() < 0.55:
                targets.append(p)
        elif p['category'] in ('食品', '杂粮', '饮料'):
            if random.random() < 0.35:
                targets.append(p)
        elif random.random() < 0.12:
            targets.append(p)
    random.shuffle(targets)
    targets = targets[:46]

    # 按供应商分组，每次到货对应一张收货单
    grouped = {}
    for p in targets:
        grouped.setdefault(p['supplier'], []).append(p)

    receipt_seq = 0
    for supplier_id, plist in grouped.items():
        for chunk_start in range(0, len(plist), 8):
            chunk = plist[chunk_start:chunk_start + 8]
            receipt_seq += 1
            days_ago = random.choice([1, 2, 3, 4, 6, 8, 10, 13, 16, 19])
            arrival = NOW - timedelta(days=days_ago, hours=random.randint(1, 6))
            receipt_no = 'RC' + arrival.strftime('%y%m%d') + '%03d' % receipt_seq
            cur = conn.execute(
                'INSERT INTO ReceiptNote (ReceiptNo, OrderID, SupplierID, InspectedBy, ReceivedAt, '
                'InspectionResult, DiffNote) VALUES (?,?,?,?,?,?,?)',
                (receipt_no, None, supplier_id, stocker, ts(arrival), '合格', None))
            rid = cur.lastrowid
            lines = []
            for line_no, p in enumerate(chunk, start=1):
                prod_date = arrival - timedelta(days=random.randint(0, max(0, p['shelf'] // 3)))
                shelf = p['shelf']
                q = qty(random.uniform(8, 40) if p['unit'] == 'kg' else random.randint(8, 45))
                batch = make_batch(conn, p, supplier_id, prod_date, shelf, p['cost'], q, arrival)
                batches.append(batch)
                ordered = q + (random.choice([0, 0, 0, 2, 3]) if p['unit'] != 'kg' else 0)
                rejected = 0
                note = None
                if random.random() < 0.12:
                    rejected = qty(1 if p['unit'] != 'kg' else round(q * 0.06, 2))
                    note = random.choice(['包装破损', '临近保质期（不足 1/3）', '数量短少'])
                conn.execute(
                    'INSERT INTO ReceiptLine (ReceiptID, LineNo, ProductID, BatchID, OrderedQty, '
                    'ReceivedQty, RejectedQty, RejectionNote, PurchasePrice) VALUES (?,?,?,?,?,?,?,?,?)',
                    (rid, line_no, p['id'], batch['id'], ordered, q, rejected, note, p['cost']))
                conn.execute(
                    'INSERT INTO StockMovement (ProductID, BatchID, MoveType, Quantity, RefType, RefID, RefNo, '
                    'OccurredAt, OperatorID, Note) VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (p['id'], batch['id'], 'Receipt', q, 'ReceiptNote', rid, receipt_no, ts(arrival),
                     stocker, None))
                lines.append(p)
            receipts.append({'id': rid, 'no': receipt_no, 'supplier': supplier_id, 'at': arrival,
                             'lines': lines})
            # 进货查验记录：80% 完整，20% 缺凭证（用于到期与缺失提醒演示）
            complete = random.random() < 0.8
            valid = arrival + timedelta(days=random.choice([180, 365, 540]))
            conn.execute(
                'INSERT INTO IncomingInspection (ReceiptID, SupplierID, RecordedBy, LicenceNo, '
                'CertificateType, CertificateNo, ValidUntil, RecordedAt, Status, Note) '
                'VALUES (?,?,?,?,?,?,?,?,?,?)',
                (rid, supplier_id, stocker,
                 'JY' + ''.join(random.choice('0123456789') for _ in range(12)) if complete else None,
                 '出厂检验合格证明' if complete else None,
                 'HG' + ''.join(random.choice('0123456789') for _ in range(8)) if complete else None,
                 dstr(valid) if complete else None, ts(arrival),
                 'Complete' if complete else 'Missing',
                 None if complete else '供货商当场未提供，约定 3 个工作日内补交'))
    return batches, receipts


# --------------------------------------------------------------------------
# 销售流水
# --------------------------------------------------------------------------
def seed_sales(conn, products, customers, members, employees, batches):
    """生成最近 45 天销售；今天是当天已发生部分（按当前时刻折算）。"""
    sold = {}
    cashier_ids = [employees['sales'], employees['boss'], employees['sales']]
    member_customers = [m for m in members]
    sale_seq = 0

    for day_offset in range(45, -1, -1):
        day = (NOW - timedelta(days=day_offset)).date()
        weekday = day.weekday()
        base_orders = 60
        if weekday >= 5:
            base_orders = int(base_orders * 1.12)
        if day_offset == 0:
            elapsed = max(0.25, min(1.0, (NOW.hour * 60 + NOW.minute) / (20 * 60)))
            n_orders = max(6, int(round(base_orders * elapsed)))
            end_hour = max(7, min(20, NOW.hour))
        else:
            n_orders = max(38, int(random.gauss(base_orders, 5)))
            end_hour = 20
        for i in range(n_orders):
            hour = random.choices([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
                                  weights=[3, 5, 6, 7, 9, 11, 7, 6, 6, 7, 9, 12, 8])[0]
            if day_offset == 0 and hour > end_hour:
                hour = end_hour
            occurred = datetime(day.year, day.month, day.day, hour,
                                random.randint(0, 59), random.randint(0, 59))
            if day_offset == 0 and occurred > NOW:
                occurred = NOW - timedelta(minutes=random.randint(1, 40))
            n_lines = random.choices([1, 2, 3, 4, 5], weights=[24, 34, 24, 13, 5])[0]
            picked = []
            pool = products
            weights = [p['popularity'] for p in pool]
            chosen_ids = set()
            for _ in range(n_lines):
                p = random.choices(pool, weights=weights)[0]
                if p['id'] in chosen_ids:
                    continue
                chosen_ids.add(p['id'])
                if p['unit'] == 'kg':
                    q = qty(round(random.uniform(0.25, 1.6), 2))
                else:
                    q = qty(random.choices([1, 1, 1, 2, 2, 3], weights=[45, 20, 10, 15, 6, 4])[0])
                picked.append((p, q))
            if not picked:
                continue
            total = 0.0
            cost_total = 0.0
            discount = 0.0
            # 偶发抹零/折扣
            if random.random() < 0.10:
                discount = qty(round(random.uniform(0.1, 1.0), 1))
            allow_credit = random.random() < 0.02
            cust = None
            if allow_credit:
                cands = [c for c in customers if c['limit'] > 0]
                if cands:
                    cust = random.choice(cands)
            elif random.random() < 0.32 and member_customers:
                cust = random.choice(member_customers)
            sale_seq += 1
            sale_no = 'XS' + occurred.strftime('%y%m%d') + '%05d' % sale_seq
            cur = conn.execute(
                'INSERT INTO SaleOrder (SaleNo, CashierID, CustomerID, OccurredAt, TotalAmount, '
                'DiscountAmount, PaidAmount, CreditAmount, CostAmount, ProfitAmount, PayStatus) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                (sale_no, random.choice(cashier_ids), cust['id'] if cust else None, ts(occurred),
                 0, discount, 0, 0, 0, 0, 'Paid'))
            sale_id = cur.lastrowid
            for line_no, (p, q) in enumerate(picked, start=1):
                price = p['price']
                amount = money(price * q)
                line_cost = money(p['cost'] * q)
                total += amount
                cost_total += line_cost
                conn.execute(
                    'INSERT INTO SaleLine (SaleID, LineNo, ProductID, BatchID, Quantity, UnitPrice, '
                    'Amount, DiscountAmount, UnitCost, CostAmount) VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (sale_id, line_no, p['id'], None, q, price, amount, 0, p['cost'], line_cost))
                sold[p['id']] = sold.get(p['id'], 0) + q
            total = money(max(0.01, total - discount))
            credit_amt = total if cust and allow_credit else 0
            paid = money(total - credit_amt)
            profit = money(total - cost_total)
            conn.execute('UPDATE SaleOrder SET TotalAmount=?, PaidAmount=?, CreditAmount=?, '
                         'CostAmount=?, ProfitAmount=?, PayStatus=? WHERE SaleID=?',
                         (total, paid, credit_amt, money(cost_total), profit,
                          'Credit' if credit_amt > 0 else 'Paid', sale_id))
            if credit_amt > 0 and cust:
                acc = conn.execute('SELECT AccountID FROM CreditAccount WHERE CustomerID=?',
                                   (cust['id'],)).fetchone()
                if acc is None:
                    conn.execute('INSERT INTO CreditAccount (AccountNo, CustomerID, UsedAmount) '
                                 'VALUES (?,?,?)', ('CA%05d' % cust['id'], cust['id'], 0))
                    acc = conn.execute('SELECT AccountID FROM CreditAccount WHERE CustomerID=?',
                                       (cust['id'],)).fetchone()
                due = dstr(occurred.date() + timedelta(days=cust['term'] or 30))
                conn.execute(
                    'INSERT INTO CreditEntry (EntryNo, AccountID, RegisteredBy, EntryType, Amount, '
                    'SettledAmount, DueDate, Remark, ChargeRef) VALUES (?,?,?,?,?,?,?,?,?)',
                    ('CG' + occurred.strftime('%y%m%d') + '%04d' % random.randint(1, 9999),
                     acc['AccountID'], employees['sales'], 'charge', credit_amt, 0, due,
                     '销售挂账 %s' % sale_no, sale_no))
            # 支付记录：现金 20% / 银联 34% / 银豹付 46%
            if paid > 0:
                if random.random() < 0.5:
                    methods = [('银联', paid)]
                elif random.random() < 0.5:
                    methods = [('现金', paid)]
                else:
                    methods = [('银豹付', paid)]
                for m, amt in methods:
                    conn.execute('INSERT INTO PayRecord (SaleID, PayMethod, PayAmount, PaidAt, TradeNo) '
                                 'VALUES (?,?,?,?,?)', (sale_id, m, amt, ts(occurred), None))
            # 库存流水（出库）
            for line_no, (p, q) in enumerate(picked, start=1):
                conn.execute(
                    'INSERT INTO StockMovement (ProductID, BatchID, MoveType, Quantity, RefType, RefID, '
                    'RefNo, OccurredAt, OperatorID, Note) VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (p['id'], None, 'Sale', -q, 'SaleOrder', sale_id, sale_no, ts(occurred),
                     None, None))
    return sold


def seed_stock_ledger(conn, products, batches, sold):
    """按“期末库存 = 期初 + 到货 - 已售”落台账；期初批次单独建，保证数量为正。"""
    by_product = {}
    for b in batches:
        by_product.setdefault(b['productId'], []).append(b)
    for p in products:
        sold_qty = sold.get(p['id'], 0)
        daily = sold_qty / 46.0
        cover_days = random.uniform(14, 26) if p['unit'] != 'kg' else random.uniform(2.2, 4.5)
        target = max(daily * cover_days, 1 if p['unit'] != 'kg' else 0.5)
        target = qty(target)
        existing = by_product.get(p['id'], [])
        received = sum(b['qtyIn'] for b in existing)
        if existing:
            if received >= target:
                # 到货已够：期初批次只覆盖已售部分，期末落在到货批次上
                remaining_on_arrivals = target
                for b in existing:
                    share = b['qtyIn'] / received
                    q = qty(min(b['qtyIn'], remaining_on_arrivals * share))
                    insert_ledger(conn, p['id'], b['id'], q, p)
                opening_left = 0.0
            else:
                for b in existing:
                    insert_ledger(conn, p['id'], b['id'], qty(b['qtyIn']), p)
                opening_left = qty(target - received)
        else:
            opening_left = target
        if opening_left > 0:
            # 期初批次：生产日期按剩余效期反推，避免一上线就全过期
            shelf = p['shelf']
            remain = random.uniform(shelf * 0.45, shelf * 0.95)
            prod = (NOW - timedelta(days=max(0.0, shelf - remain))).date()
            b = make_batch(conn, p, p['supplier'], datetime.combine(prod, datetime.min.time()),
                           shelf, p['cost'], opening_left, NOW - timedelta(days=46))
            insert_ledger(conn, p['id'], b['id'], opening_left, p)


def insert_ledger(conn, product_id, batch_id, quantity, product):
    if quantity <= 0:
        return
    loc = '%s-%02d' % (product['category'][:1], random.randint(1, 12))
    conn.execute(
        'INSERT OR REPLACE INTO StockLedger (ProductID, BatchID, Quantity, ReservedQty, Location, UpdatedAt) '
        'VALUES (?,?,?,?,?,?)', (product_id, batch_id, qty(quantity), 0, loc, ts(NOW)))


# --------------------------------------------------------------------------
# 临期、报损、退货
# --------------------------------------------------------------------------
def seed_expiry_and_loss(conn, products, batches, employees, rules, suppliers):
    stocker = employees['stocker']
    owner = employees['boss']
    sales_person = employees['sales']
    # 挑 14 个批次设为临期（剩余 0~3 天），4 个设为已过期
    by_id = {b['id']: b for b in batches}
    ledger = conn.execute(
        'SELECT l.*, p.ProductName, p.ListPrice, p.CategoryID, p.Unit, b.PurchasePrice '
        'FROM StockLedger l JOIN Product p ON p.ProductID=l.ProductID '
        'JOIN PurchaseBatch b ON b.BatchID=l.BatchID WHERE l.Quantity > 1').fetchall()
    random.shuffle(ledger)
    fresh_cats = {c for c in []}
    chosen = []
    for row in ledger:
        if len(chosen) >= 24:
            break
        chosen.append(row)

    near_expiry = chosen[:14]
    expired = chosen[14:18]
    # 改写到期日，制造临期与过期
    for i, row in enumerate(near_expiry):
        remain = random.choice([0, 0, 1, 1, 2, 3])
        expiry = (NOW + timedelta(days=remain)).date()
        shelf = random.choice([3, 5, 7, 10])
        prod = expiry - timedelta(days=shelf)
        conn.execute('UPDATE PurchaseBatch SET ProductionDate=?, ShelfLifeDays=?, ExpiryDate=? '
                     'WHERE BatchID=?', (dstr(prod), shelf, dstr(expiry), row['BatchID']))
    for row in expired:
        expiry = (NOW - timedelta(days=random.randint(1, 3))).date()
        shelf = random.choice([3, 5, 7])
        prod = expiry - timedelta(days=shelf)
        conn.execute('UPDATE PurchaseBatch SET ProductionDate=?, ShelfLifeDays=?, ExpiryDate=? '
                     'WHERE BatchID=?', (dstr(prod), shelf, dstr(expiry), row['BatchID']))

    # 两张临期处理单：一张已执行完成（昨日），一张进行中（今日）
    for status, when, done in (('Completed', NOW - timedelta(days=1, hours=3), True),
                               ('Draft', NOW - timedelta(hours=2), False)):
        handling_no = 'LX' + when.strftime('%y%m%d') + '%03d' % random.randint(1, 999)
        cur = conn.execute('INSERT INTO ExpiryHandling (HandlingNo, HandledBy, HandledAt, Status, Note) '
                           'VALUES (?,?,?,?,?)', (handling_no, stocker, ts(when), status,
                                                  '按当日临期预警清单挑货'))
        hid = cur.lastrowid
        rows = near_expiry[:5] if done else near_expiry[5:10]
        for line_no, row in enumerate(rows, start=1):
            picked = qty(max(0.5, round(row['Quantity'] * 0.4, 3)))
            htype = random.choice(['Markdown', 'Markdown', 'Return', 'Loss'])
            conn.execute('INSERT INTO HandlingLine (HandlingID, LineNo, ProductID, BatchID, PickedQty, '
                         'HandlingType, Result) VALUES (?,?,?,?,?,?,?)',
                         (hid, line_no, row['ProductID'], row['BatchID'], picked, htype,
                          '已执行' if done else None))
            if htype == 'Markdown':
                rule = conn.execute('SELECT * FROM MarkdownRule WHERE CategoryID=? ORDER BY RemainDaysTo '
                                    'LIMIT 1', (row['CategoryID'],)).fetchone()
                rate = rule['DiscountRate'] if rule else 0.8
                plan_status = 'Confirmed' if done else 'Pending'
                conn.execute(
                    'INSERT INTO MarkdownPlan (HandlingID, LineNo, RuleID, MarkdownTime, DiscountRate, '
                    'MarkdownPrice, PriceTagStatus, ConfirmedBy, ConfirmedAt, PlanStatus) '
                    'VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (hid, line_no, rule['RuleID'] if rule else None,
                     (when.strftime('%Y-%m-%d ') + (rule['TriggerTime'] if rule else '18:00')),
                     rate, money(row['ListPrice'] * rate),
                     'Applied' if done else 'Pending',
                     owner if done else None, ts(when) if done else None, plan_status))

    # 报损单：3 条已确认、2 条待确认
    reasons = ['超过保质期下架', '包装破损', '运输挤压变形', '生鲜挑出品质不佳', '冷柜断电变质']
    for i, row in enumerate(expired):
        q = qty(max(0.5, round(row['Quantity'] * random.uniform(0.3, 0.8), 3)))
        when = NOW - timedelta(days=random.randint(0, 4), hours=random.randint(1, 8))
        loss_no = 'BS' + when.strftime('%y%m%d') + '%03d' % random.randint(1, 999)
        conn.execute(
            'INSERT INTO LossReport (LossNo, ProductID, BatchID, Quantity, Reason, Amount, '
            'RegisteredBy, RegisteredAt, ConfirmedBy, ConfirmedAt, Status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            (loss_no, row['ProductID'], row['BatchID'], q, random.choice(reasons),
             money(q * row['PurchasePrice']), stocker, ts(when),
             owner if i < 3 else None, ts(when) if i < 3 else None,
             'Confirmed' if i < 3 else 'Pending'))
        if i < 3:
            conn.execute('UPDATE StockLedger SET Quantity = MAX(0, Quantity - ?), UpdatedAt=? '
                         'WHERE ProductID=? AND BatchID=?', (q, ts(when), row['ProductID'], row['BatchID']))
            conn.execute('INSERT INTO StockMovement (ProductID, BatchID, MoveType, Quantity, RefType, '
                         'RefID, RefNo, OccurredAt, OperatorID, Note) VALUES (?,?,?,?,?,?,?,?,?,?)',
                         (row['ProductID'], row['BatchID'], 'Loss', -q, 'LossReport', None, loss_no,
                          ts(when), stocker, '报损入账'))

    # 退货单（退给供货商）与费用单在 seed_expenses_and_returns 里生成
    keep_ids = [row['BatchID'] for row in near_expiry] + [row['BatchID'] for row in expired]
    return keep_ids


def clamp_batches(conn, keep_ids):
    """把没有被刻意设为临期/过期的批次拉到合理效期，避免出现“过期一个月”的假数据。"""
    marks = ','.join('?' * len(keep_ids)) if keep_ids else '0'
    rows = conn.execute(
        "SELECT * FROM PurchaseBatch WHERE BatchID NOT IN (" + marks + ") "
        "AND ExpiryDate < date('now','localtime','-3 days')", keep_ids).fetchall()
    for b in rows:
        shelf = b['ShelfLifeDays'] or 30
        remain = random.randint(max(2, int(shelf * 0.2)), max(3, int(shelf * 0.9)))
        expiry = (NOW + timedelta(days=remain)).date()
        prod = expiry - timedelta(days=shelf)
        conn.execute('UPDATE PurchaseBatch SET ExpiryDate=?, ProductionDate=? WHERE BatchID=?',
                     (dstr(expiry), dstr(prod), b['BatchID']))


def shape_member_recent(conn, members):
    """让会员消费呈现真实分布：4 位近 30 天复购、3 位仅 1 次、5 位近期未到店。

    报告基线是「会员 11 人、无消费占比 100%」，试运行目标是复购率 20% 以上，
    因此演示数据里必须有“回头客”也有“沉睡会员”，否则复购率会失真。
    """
    for idx, m in enumerate(members):
        rows = conn.execute(
            "SELECT SaleID FROM SaleOrder WHERE CustomerID=? "
            "AND OccurredAt >= date('now','localtime','-30 days') ORDER BY OccurredAt DESC",
            (m['customerId'],)).fetchall()
        if idx < 4:
            keep = 3
            extra = rows[keep:]
        elif idx < 7:
            extra = rows[1:]
        else:
            extra = rows
        for row in extra:
            conn.execute('UPDATE SaleOrder SET CustomerID=NULL WHERE SaleID=?', (row['SaleID'],))


def seed_expenses_and_returns(conn, suppliers, employees, products, batches):
    owner = employees['boss']
    stocker = employees['stocker']
    # 退货单：2 张（临期按合同比例退回）
    picks = random.sample(products, 3)
    for i, p in enumerate(picks):
        when = NOW - timedelta(days=random.randint(2, 12))
        q = qty(2 if p['unit'] != 'kg' else 1.5)
        rno = 'TH' + when.strftime('%y%m%d') + '%03d' % random.randint(1, 999)
        conn.execute(
            'INSERT INTO ReturnNote (ReturnNo, SupplierID, ProductID, BatchID, Quantity, UnitPrice, '
            'Amount, Reason, ReturnedAt, Status) VALUES (?,?,?,?,?,?,?,?,?,?)',
            (rno, p['supplier'], p['id'], None, q, p['cost'], money(q * p['cost']),
             '临期按合同比例退回', ts(when), 'Confirmed'))
        conn.execute('INSERT INTO StockMovement (ProductID, BatchID, MoveType, Quantity, RefType, '
                     'RefID, RefNo, OccurredAt, OperatorID, Note) VALUES (?,?,?,?,?,?,?,?,?,?)',
                     (p['id'], None, 'Return', -q, 'ReturnNote', None, rno, ts(when), stocker, '退回供货商'))

    # 费用单：陈列费、促销费（对账扣减项的证据）
    for i in range(6):
        sid = random.choice(suppliers)['id']
        etype = random.choice(EXPENSE_TYPES)
        period = (NOW - timedelta(days=random.randint(5, 35))).strftime('%Y-%m')
        amount = money(random.choice([120, 180, 200, 260, 320, 450]))
        when = NOW - timedelta(days=random.randint(1, 25))
        eno = 'FY' + when.strftime('%y%m%d') + '%03d' % random.randint(1, 999)
        conn.execute(
            'INSERT INTO ExpenseNote (ExpenseNo, SupplierID, ExpenseType, Amount, Period, Voucher, '
            'RegisteredBy, OccurredAt, Status) VALUES (?,?,?,?,?,?,?,?,?)',
            (eno, sid, etype, amount, period, '陈列协议 %s' % period, owner, ts(when), 'Confirmed'))


# --------------------------------------------------------------------------
# 订货单
# --------------------------------------------------------------------------
def seed_purchase_orders(conn, products, suppliers, employees, receipts):
    owner = employees['boss']
    # 历史已完成：以收货单反推 6 张
    for i, rc in enumerate(receipts[:6]):
        when = rc['at'] - timedelta(days=1, hours=2)
        sup = [s for s in suppliers if s['id'] == rc['supplier']][0]
        ono = 'DH' + when.strftime('%y%m%d') + '%03d' % (i + 1)
        total = 0.0
        lines = []
        for p in rc['lines']:
            q = max(6, round(random.uniform(10, 35)))
            total += p['cost'] * q
            lines.append((p, q))
        cur = conn.execute(
            'INSERT INTO PurchaseOrder (OrderNo, SupplierID, SubmittedBy, SubmittedAt, ExpectedArrivalDate, '
            'OrderStatus, TotalAmount, Note) VALUES (?,?,?,?,?,?,?,?)',
            (ono, rc['supplier'], owner, ts(when), dstr(rc['at'].date()), 'Received',
             money(total), '按库存与近 30 日销售建议生成'))
        oid = cur.lastrowid
        for line_no, (p, q) in enumerate(lines, start=1):
            conn.execute('INSERT INTO PurchaseOrderLine (OrderID, LineNo, ProductID, Quantity, '
                         'AgreedPrice, ReceivedQty) VALUES (?,?,?,?,?,?)',
                         (oid, line_no, p['id'], q, p['cost'], q))
        conn.execute('UPDATE ReceiptNote SET OrderID=? WHERE ReceiptID=?', (oid, rc['id']))

    # 待处理订货单：2 张已提交待供货商确认，1 张已在途
    for idx, (sid, status, days) in enumerate([(1, 'Submitted', 1), (2, 'Confirmed', 2), (5, 'Submitted', 0)]):
        when = NOW - timedelta(days=days, hours=random.randint(1, 5))
        sup_products = [p for p in products if p['supplier'] == sid][:6]
        if not sup_products:
            continue
        ono = 'DH' + when.strftime('%y%m%d') + 'PO%d' % (idx + 1)
        total = 0.0
        cur = conn.execute(
            'INSERT INTO PurchaseOrder (OrderNo, SupplierID, SubmittedBy, SubmittedAt, ExpectedArrivalDate, '
            'OrderStatus, TotalAmount, Note) VALUES (?,?,?,?,?,?,?,?)',
            (ono, sid, owner, ts(when), dstr((when + timedelta(days=2)).date()), status, 0,
             '系统按库存与销量给出建议量，老板确认后提交'))
        oid = cur.lastrowid
        for line_no, p in enumerate(sup_products, start=1):
            q = max(6, round(random.uniform(15, 40)))
            total += p['cost'] * q
            conn.execute('INSERT INTO PurchaseOrderLine (OrderID, LineNo, ProductID, Quantity, '
                         'AgreedPrice, ReceivedQty) VALUES (?,?,?,?,?,?)',
                         (oid, line_no, p['id'], q, p['cost'], 0))
        conn.execute('UPDATE PurchaseOrder SET TotalAmount=? WHERE OrderID=?', (money(total), oid))


# --------------------------------------------------------------------------
# 线上订单
# --------------------------------------------------------------------------
def seed_online_orders(conn, products, customers, employees, batches):
    sales_person = employees['sales']
    stocker = employees['stocker']
    # 3 张待拣货（今日承诺）、2 张已拣货待交付、其余为近 14 天已完成订单
    plans = [
        ('Pending', 0, 'group', '待拣货', '自提'),
        ('Pending', 0, 'group', '待拣货', '送货'),
        ('Pending', 1, 'group', '待拣货', '自提'),
        ('Picked', 1, 'group', '已拣货待交付', '自提'),
        ('Picked', 2, 'group', '已拣货待交付', '送货'),
    ]
    # 线上到家按“试运行两周、日均 2~3 单”的虚构场景铺开。
    for day in range(1, 15):
        for _ in range(random.randint(1, 3)):
            plans.append(('Completed', day, random.choice(['group', 'group', 'group', 'miniProgram']),
                          '已完成', random.choice(['自提', '自提', '送货'])))
    seq = 0
    for status, day_delta, channel, label, fulfil in plans:
        seq += 1
        placed = NOW - timedelta(days=max(0, -day_delta), hours=random.randint(0, 5),
                                 minutes=random.randint(0, 50)) if day_delta <= 0 else NOW - timedelta(days=day_delta)
        if day_delta == 0:
            placed = NOW - timedelta(hours=1, minutes=random.randint(5, 40))
        promised = placed + timedelta(hours=random.choice([1, 2, 3]))
        cust = random.choice([c for c in customers if c['isMember'] == 'Y'])
        ono = 'WM' + placed.strftime('%y%m%d') + '%03d' % seq
        cur = conn.execute(
            'INSERT INTO OnlineOrder (OrderNo, CustomerID, ConfirmedBy, Channel, PlacedAt, PromisedAt, '
            'OrderStatus, PayMethod, TotalAmount, PaidAmount, FulfilMethod, PickupCode, Note) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (ono, cust['id'], sales_person, channel, ts(placed), ts(promised), status,
             '银豹付' if status == 'Completed' else None, 0, 0, fulfil,
             '%04d' % random.randint(1000, 9999), None))
        oid = cur.lastrowid
        total = 0.0
        picks = random.sample(products, random.randint(2, 4))
        for line_no, p in enumerate(picks, start=1):
            q = qty(round(random.uniform(0.4, 1.5), 2) if p['unit'] == 'kg' else random.randint(1, 3))
            amount = money(p['price'] * q)
            total += amount
            picked = q if status in ('Picked', 'Completed') else 0
            short = 0
            line_status = 'Picked' if status in ('Picked', 'Completed') else 'Pending'
            if status in ('Picked', 'Completed') and random.random() < 0.15:
                short = qty(min(q, 1))
                picked = qty(q - short)
                line_status = 'Short'
            conn.execute(
                'INSERT INTO OnlineOrderLine (OrderID, LineNo, ProductID, BatchID, SubstitutedProductID, '
                'Quantity, UnitPrice, PickedQty, ShortQty, LineStatus) VALUES (?,?,?,?,?,?,?,?,?,?)',
                (oid, line_no, p['id'], None, None, q, p['price'], picked, short, line_status))
        conn.execute('UPDATE OnlineOrder SET TotalAmount=? WHERE OrderID=?', (money(total), oid))
        if status in ('Picked', 'Completed'):
            cost = 0.0
            for line in conn.execute('SELECT * FROM OnlineOrderLine WHERE OrderID=?', (oid,)):
                conn.execute('INSERT INTO FulfilmentLog (OrderID, LineNo, HandledBy, Action, OccurredAt, Note) '
                             'VALUES (?,?,?,?,?,?)',
                             (oid, line['LineNo'], stocker, 'pick', ts(placed + timedelta(minutes=20)),
                              '拣货 %s' % line['PickedQty']))
                if line['ShortQty']:
                    conn.execute('INSERT INTO FulfilmentLog (OrderID, LineNo, HandledBy, Action, OccurredAt, Note) '
                                 'VALUES (?,?,?,?,?,?)',
                                 (oid, line['LineNo'], stocker, 'short', ts(placed + timedelta(minutes=22)),
                                  '库存不足，缺货 %s' % line['ShortQty']))
            conn.execute('INSERT INTO FulfilmentLog (OrderID, LineNo, HandledBy, Action, OccurredAt, Note) '
                         'VALUES (?,?,?,?,?,?)', (oid, None, stocker, 'picked_all',
                                                  ts(placed + timedelta(minutes=25)), '拣货完成'))
        if status == 'Completed':
            paid = money(total)
            conn.execute('UPDATE OnlineOrder SET PaidAmount=? WHERE OrderID=?', (paid, oid))
            conn.execute('INSERT INTO FulfilmentLog (OrderID, LineNo, HandledBy, Action, OccurredAt, Note) '
                         'VALUES (?,?,?,?,?,?)', (oid, None, sales_person, 'deliver',
                                                  ts(placed + timedelta(minutes=55)), '收款交付'))


# --------------------------------------------------------------------------
# 赊账
# --------------------------------------------------------------------------
def seed_credit(conn, customers, employees):
    owner = employees['boss']
    sales_person = employees['sales']
    # 已挂账的账户由销售生成时自动建了；这里补充两笔历史挂账与一笔已核销的挂账
    for cust in customers:
        if cust['limit'] <= 0:
            continue
        acc = conn.execute('SELECT * FROM CreditAccount WHERE CustomerID=?', (cust['id'],)).fetchone()
        if acc is None:
            conn.execute('INSERT INTO CreditAccount (AccountNo, CustomerID, UsedAmount) VALUES (?,?,?)',
                         ('CA%05d' % cust['id'], cust['id'], 0))
            acc = conn.execute('SELECT * FROM CreditAccount WHERE CustomerID=?', (cust['id'],)).fetchone()
        # 一笔已核销的历史挂账
        if random.random() < 0.7:
            when = NOW - timedelta(days=random.randint(35, 70))
            amt = money(random.uniform(80, 320))
            due = dstr((when + timedelta(days=cust['term'] or 30)).date())
            eno = 'CG' + when.strftime('%y%m%d') + '%04d' % random.randint(1, 9999)
            conn.execute(
                'INSERT INTO CreditEntry (EntryNo, AccountID, RegisteredBy, EntryType, Amount, '
                'SettledAmount, DueDate, SettledAt, Remark, ChargeRef) VALUES (?,?,?,?,?,?,?,?,?,?)',
                (eno, acc['AccountID'], sales_person, 'charge', amt, amt, due,
                 ts(when + timedelta(days=random.randint(3, 20))), '熟客赊账（粮油）', None))
            sno = 'HX' + when.strftime('%y%m%d') + '%04d' % random.randint(1, 9999)
            conn.execute(
                'INSERT INTO CreditEntry (EntryNo, AccountID, RegisteredBy, EntryType, Amount, '
                'SettledAmount, DueDate, SettledAt, Remark) VALUES (?,?,?,?,?,?,?,?,?)',
                (sno, acc['AccountID'], owner, 'settle', amt, 0, due,
                 ts(when + timedelta(days=random.randint(3, 20))), '收款核销 %s' % eno))
        # 一笔逾期未还（催收清单演示）
        if random.random() < 0.5:
            when = NOW - timedelta(days=random.randint(40, 55))
            amt = money(random.uniform(120, 380))
            due = dstr((when + timedelta(days=cust['term'] or 30)).date())
            eno = 'CG' + when.strftime('%y%m%d') + '%04d' % random.randint(1, 9999)
            conn.execute(
                'INSERT INTO CreditEntry (EntryNo, AccountID, RegisteredBy, EntryType, Amount, '
                'SettledAmount, DueDate, Remark) VALUES (?,?,?,?,?,?,?,?)',
                (eno, acc['AccountID'], sales_person, 'charge', amt, 0, due, '熟客赊账（酒水）'))
    # 重算账户余额与逾期天数
    for acc in conn.execute('SELECT * FROM CreditAccount').fetchall():
        used = db.scalar('SELECT COALESCE(SUM(Amount - SettledAmount),0) FROM CreditEntry '
                         'WHERE AccountID=? AND EntryType="charge" AND RecordStatus="A"', (acc['AccountID'],))
        overdue = db.scalar(
            'SELECT CAST(MAX(0, julianday(date("now","localtime")) - julianday(MIN(DueDate))) AS INTEGER) '
            'FROM CreditEntry WHERE AccountID=? AND EntryType="charge" AND RecordStatus="A" '
            'AND Amount - SettledAmount > 0.001 AND DueDate < date("now","localtime")', (acc['AccountID'],))
        conn.execute('UPDATE CreditAccount SET UsedAmount=?, OverdueDays=?, AccountStatus=? WHERE AccountID=?',
                     (money(used), int(overdue or 0),
                      'Overdue' if (overdue or 0) > 0 else ('Normal' if used > 0 else 'Idle'),
                      acc['AccountID']))


def seed_members_points(conn, members, products):
    for m in members:
        base = conn.execute('SELECT Points FROM Member WHERE MemberID=?', (m['id'],)).fetchone()['Points']
        if base and base > 0:
            conn.execute('INSERT INTO PointEntry (MemberID, EntryType, Points, OccurredAt, OrderRef, Note) '
                         'VALUES (?,?,?,?,?,?)',
                         (m['id'], 'earn', base, ts(NOW - timedelta(days=random.randint(5, 60))),
                          None, '历史积分导入'))
        # 两位会员近 30 天有两次以上消费（复购率演示）
    hot = conn.execute(
        'SELECT c.CustomerID, c.Name, COUNT(o.SaleID) AS cnt, MAX(o.OccurredAt) AS last_at, '
        'SUM(CASE WHEN o.OccurredAt >= date("now","localtime","-30 days") THEN 1 ELSE 0 END) AS cnt30 '
        'FROM Customer c JOIN SaleOrder o ON o.CustomerID = c.CustomerID '
        'WHERE c.IsMember="Y" GROUP BY c.CustomerID ORDER BY cnt30 DESC LIMIT 4').fetchall()
    for row in hot:
        member = conn.execute('SELECT * FROM Member WHERE CustomerID=?', (row['CustomerID'],)).fetchone()
        if member:
            conn.execute('UPDATE Member SET LastVisitDate=? WHERE MemberID=?',
                         ((row['last_at'] or '')[:10], member['MemberID']))


# --------------------------------------------------------------------------
# 对账
# --------------------------------------------------------------------------
def seed_statements(conn, suppliers, employees, receipts):
    owner = employees['boss']
    # 对账期间：上月 1 日至月末
    end = (NOW.replace(day=1) - timedelta(days=1)).date()
    start = end.replace(day=1)
    for idx, sup in enumerate(suppliers[:2]):
        statement_status = 'Submitted' if idx == 0 else 'Confirmed'
        lines = []
        # 本方：该供应商本期间收货金额、退货、费用
        purchases = conn.execute(
            'SELECT r.ReceiptNo AS doc_no, date(r.ReceivedAt) AS d, r.ReceiptID AS id, '
            'ROUND(SUM(rl.ReceivedQty * rl.PurchasePrice),2) AS amt '
            'FROM ReceiptNote r JOIN ReceiptLine rl ON rl.ReceiptID=r.ReceiptID '
            'WHERE r.SupplierID=? AND date(r.ReceivedAt) BETWEEN ? AND ? GROUP BY r.ReceiptID',
            (sup['id'], dstr(start), dstr(end))).fetchall()
        if not purchases:
            purchases = conn.execute(
                'SELECT r.ReceiptNo AS doc_no, date(r.ReceivedAt) AS d, r.ReceiptID AS id, '
                'ROUND(SUM(rl.ReceivedQty * rl.PurchasePrice),2) AS amt '
                'FROM ReceiptNote r JOIN ReceiptLine rl ON rl.ReceiptID=r.ReceiptID '
                'WHERE r.SupplierID=? GROUP BY r.ReceiptID LIMIT 4', (sup['id'],)).fetchall()
        returns = conn.execute(
            'SELECT ReturnNo AS doc_no, date(ReturnedAt) AS d, ReturnID AS id, Amount AS amt '
            'FROM ReturnNote WHERE SupplierID=? AND Status="Confirmed"', (sup['id'],)).fetchall()
        expenses = conn.execute(
            'SELECT ExpenseNo AS doc_no, date(OccurredAt) AS d, ExpenseID AS id, Amount AS amt, '
            'ExpenseType AS t FROM ExpenseNote WHERE SupplierID=?', (sup['id'],)).fetchall()
        conn.execute('DELETE FROM ReturnNote WHERE 0')
        total_purchase = 0.0
        for p in purchases:
            total_purchase += p['amt']
            lines.append(('Receipt', p['id'], p['doc_no'], p['d'], p['amt'], p['amt'], 'N'))
        total_return = 0.0
        for r in returns:
            total_return += r['amt']
            lines.append(('Return', r['id'], r['doc_no'], r['d'], -r['amt'], -r['amt'], 'N'))
        total_expense = 0.0
        for e in expenses:
            total_expense += e['amt']
            lines.append(('Expense', e['id'], e['doc_no'], e['d'], -e['amt'], -e['amt'], 'N'))

        # 对方口径：制造 2~3 处差异
        adjusted = []
        diff_applied = 0
        for i, (stype, sid_, doc_no, d, cp_amt, our_amt, disputed) in enumerate(lines):
            cp = cp_amt
            if diff_applied < 2 and random.random() < 0.45:
                if stype == 'Receipt':
                    cp = money(cp_amt + random.choice([-36.5, -18.2, 24.0, 45.6]))
                elif stype == 'Expense':
                    cp = money(cp_amt * random.choice([0.5, 0.75]))
                diff_applied += 1
                disputed = 'Y' if diff_applied == 1 else 'N'
            adjusted.append((stype, sid_, doc_no, d, cp, our_amt, disputed))
        # 对方多出一条本方没有的记录（历史未入账）
        if idx == 0:
            adjusted.append(('Receipt', None, 'SH20260928001', dstr(start + timedelta(days=12)),
                             money(random.uniform(180, 420)), 0, 'Y'))

        cp_total = sum(x[4] for x in adjusted)
        our_total = sum(x[5] for x in adjusted)
        diff = money(cp_total - our_total)
        payable = money(our_total)
        sno = 'DZ' + start.strftime('%y%m') + '%02d' % (idx + 1)
        submitted_at = NOW - timedelta(days=1, hours=2 + idx)
        confirmed_at = submitted_at + timedelta(minutes=random.randint(6, 11))
        cur = conn.execute(
            'INSERT INTO Statement (StatementNo, SupplierID, PeriodStart, PeriodEnd, SubmittedBy, '
            'SubmittedAt, StatementStatus, ConfirmedBy, ConfirmedAt, PurchaseAmount, ReturnAmount, '
            'ExpenseAmount, CounterpartyAmount, OurAmount, DiffAmount, PayableAmount, Note) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (sno, sup['id'], dstr(start), dstr(end), owner, ts(submitted_at),
             statement_status, owner if statement_status == 'Confirmed' else None,
             ts(confirmed_at) if statement_status == 'Confirmed' else None,
             money(total_purchase), money(total_return), money(total_expense),
             money(cp_total), money(our_total), diff, payable,
             '供货商微信提交电子对账单，老板代录'))
        stid = cur.lastrowid
        for line_no, (stype, sid_, doc_no, d, cp_amt, our_amt, disputed) in enumerate(adjusted, start=1):
            diff_amt = money(cp_amt - our_amt)
            reason = None
            if abs(diff_amt) > 0.001:
                reason = '对方金额与己方收货/费用记录不一致，待供货商答复'
            conn.execute(
                'INSERT INTO StatementLine (StatementID, LineNo, SourceType, SourceDocID, SourceDocNo, '
                'OccurredDate, CounterpartyAmount, OurAmount, DiffAmount, DiffReason, DisputedFlag, '
                'Resolution, Voucher) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (stid, line_no, stype, sid_, doc_no, d, cp_amt, our_amt, diff_amt, reason,
                 disputed, None, None))
        if statement_status == 'Confirmed':
            pay_date = (NOW + timedelta(days=sup['term'])).date()
            cur2 = conn.execute(
                'INSERT INTO AccountPayable (PayableNo, SupplierID, StatementID, PaymentTermDays, '
                'PlannedPayDate, PayableAmount, PaidAmount, PayableStatus) VALUES (?,?,?,?,?,?,?,?)',
                ('YF' + start.strftime('%y%m') + '%02d' % (idx + 1), sup['id'], stid, sup['term'],
                 dstr(pay_date), payable, money(payable * 0.4), 'Partial'))
            pid = cur2.lastrowid
            conn.execute(
                'INSERT INTO PaymentRecord (PayNo, PayableID, Amount, Method, PaidAt, RegisteredBy, Note) '
                'VALUES (?,?,?,?,?,?,?)',
                ('FK' + NOW.strftime('%y%m%d') + '%03d' % (idx + 1), pid, money(payable * 0.4),
                 '银行转账', ts(NOW - timedelta(days=1)), owner, '按结算计划先付 40%'))
    # 一条新的应付（已确认对账另一家）
    pass


# --------------------------------------------------------------------------
# 盘点
# --------------------------------------------------------------------------
def seed_stocktake(conn, products, batches, employees):
    owner = employees['boss']
    stocker = employees['stocker']
    when = NOW - timedelta(days=6, hours=4)
    plan_no = 'PD' + when.strftime('%y%m%d') + '001'
    cur = conn.execute(
        'INSERT INTO StocktakePlan (PlanNo, PlannedAt, Scope, FrozenAt, Status, ConfirmedBy, '
        'ConfirmedAt, Note) VALUES (?,?,?,?,?,?,?,?)',
        (plan_no, ts(when), '全店', ts(when), 'Approved', owner, ts(when + timedelta(hours=2)),
         '月度全店盘点，收银未停业'))
    plan_id = cur.lastrowid
    ledger = conn.execute(
        'SELECT l.*, b.PurchasePrice, p.ProductName FROM StockLedger l '
        'JOIN PurchaseBatch b ON b.BatchID=l.BatchID JOIN Product p ON p.ProductID=l.ProductID '
        'WHERE l.Quantity > 0 ORDER BY l.Location LIMIT 60').fetchall()
    diff_amount = 0.0
    total_cost = 0.0
    for line_no, row in enumerate(ledger, start=1):
        book = row['Quantity']
        total_cost += book * row['PurchasePrice']
        r = random.random()
        if r < 0.14:
            diff = -qty(round(random.uniform(0.2, 1.2), 2))
        elif r < 0.20:
            diff = qty(round(random.uniform(0.2, 0.8), 2))
        elif r < 0.24:
            diff = -book
        else:
            diff = 0.0
        counted = qty(max(0.0, book + diff))
        diff = qty(counted - book)
        reason = None
        if diff != 0:
            reason = random.choice(['破损', '过期未及时报损', '漏记出库', '错录', '待查'])
        amt = money(diff * row['PurchasePrice'])
        diff_amount += abs(amt)
        conn.execute(
            'INSERT INTO StocktakeLine (PlanID, LineNo, ProductID, BatchID, BookQty, CountedQty, '
            'DiffQty, DiffReason, UnitCost, DiffAmount) VALUES (?,?,?,?,?,?,?,?,?,?)',
            (plan_id, line_no, row['ProductID'], row['BatchID'], qty(book), counted, qty(diff),
             reason, row['PurchasePrice'], amt))
        if diff != 0:
            conn.execute('INSERT INTO StockAdjust (PlanID, LineNo, ApprovedBy, AdjustQty, '
                         'AdjustReason, OccurredAt) VALUES (?,?,?,?,?,?)',
                         (plan_id, line_no, owner, qty(diff), reason, ts(when + timedelta(hours=2))))
            conn.execute('UPDATE StockLedger SET Quantity = ?, UpdatedAt=? WHERE ProductID=? AND BatchID=?',
                         (counted, ts(when + timedelta(hours=2)), row['ProductID'], row['BatchID']))
    rate = diff_amount / total_cost if total_cost else 0
    conn.execute('UPDATE StocktakePlan SET DiffAmount=?, DiffRate=? WHERE PlanID=?',
                 (money(diff_amount), round(rate, 5), plan_id))

    # 一张进行中的盘点单（等待实盘录入）
    when2 = NOW - timedelta(hours=3)
    cur2 = conn.execute(
        'INSERT INTO StocktakePlan (PlanNo, PlannedAt, Scope, FrozenAt, Status, Note) '
        'VALUES (?,?,?,?,?,?)',
        ('PD' + when2.strftime('%y%m%d') + '002', ts(when2), '蔬菜', ts(when2), 'Counting',
         '生鲜区专项盘点，待理货员录入实盘'))
    plan2 = cur2.lastrowid
    rows2 = conn.execute(
        'SELECT l.*, b.PurchasePrice FROM StockLedger l JOIN PurchaseBatch b ON b.BatchID=l.BatchID '
        'JOIN Product p ON p.ProductID=l.ProductID WHERE p.CategoryID=(SELECT CategoryID FROM '
        'ProductCategory WHERE CategoryName="蔬菜") AND l.Quantity > 0 ORDER BY l.Location LIMIT 14').fetchall()
    for line_no, row in enumerate(rows2, start=1):
        conn.execute(
            'INSERT INTO StocktakeLine (PlanID, LineNo, ProductID, BatchID, BookQty, CountedQty, '
            'DiffQty, DiffReason, UnitCost, DiffAmount) VALUES (?,?,?,?,?,?,?,?,?,?)',
            (plan2, line_no, row['ProductID'], row['BatchID'], qty(row['Quantity']), None, None,
             None, row['PurchasePrice'], 0))
