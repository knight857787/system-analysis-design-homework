const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');

// 各角色可办理的入口（依据报告表 7 的用例主执行者）
const ENTRIES = {
  Owner: [
    { key: 'pos', label: '收银台', icon: '¥', tab: true },
    { key: 'inventory', label: '库存台账', icon: '▤', tab: true },
    { key: 'products', label: '商品档案', icon: '☰' },
    { key: 'expiry', label: '临期处理', icon: '⏱' },
    { key: 'receipts', label: '收货验收', icon: '⇩' },
    { key: 'stocktake', label: '盘点差异', icon: '✓' },
    { key: 'purchases', label: '订货单', icon: '⇧' },
    { key: 'settle', label: '供应商对账', icon: '≡' },
    { key: 'suppliers', label: '供应商档案', icon: '☷' },
    { key: 'credit', label: '熟客赊账', icon: '◎' },
    { key: 'members', label: '会员积分', icon: '★' },
    { key: 'online', label: '线上订单', icon: '☎' },
    { key: 'reports', label: '经营分析', icon: '◔' },
    { key: 'acceptance', label: '验收指标', icon: '☑' },
    { key: 'system', label: '系统说明', icon: '⚙' },
  ],
  Stocker: [
    { key: 'inventory', label: '库存台账', icon: '▤', tab: true },
    { key: 'expiry', label: '临期处理', icon: '⏱' },
    { key: 'receipts', label: '收货验收', icon: '⇩' },
    { key: 'stocktake', label: '盘点差异', icon: '✓' },
    { key: 'online', label: '线上拣货', icon: '☎' },
    { key: 'products', label: '商品档案', icon: '☰' },
    { key: 'system', label: '系统说明', icon: '⚙' },
  ],
  Salesperson: [
    { key: 'pos', label: '收银台', icon: '¥', tab: true },
    { key: 'credit', label: '熟客赊账', icon: '◎' },
    { key: 'members', label: '会员积分', icon: '★' },
    { key: 'online', label: '线上订单', icon: '☎' },
    { key: 'inventory', label: '库存台账', icon: '▤', tab: true },
    { key: 'system', label: '系统说明', icon: '⚙' },
  ],
  Supplier: [
    { key: 'purchases', label: '订货单', icon: '⇧' },
    { key: 'settle', label: '对账单', icon: '≡' },
    { key: 'system', label: '系统说明', icon: '⚙' },
  ],
};

Page({
  data: {
    loading: true,
    greeting: '',
    scope: '',
    user: {},
    isOwner: false,
    isSales: false,
    isSupplier: false,
    today: {},
    month: {},
    stock: {},
    expiry: {},
    credit: {},
    online: {},
    supplier: {},
    todos: [],
    entries: [],
  },

  onShow() {
    const user = app.globalData.user || wx.getStorageSync('user');
    if (!user) {
      app.toLogin();
      return;
    }
    const h = new Date().getHours();
    const greeting = h < 6 ? '凌晨好' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    const role = user.role || 'Owner';
    this.setData({
      user,
      greeting,
      isOwner: role === 'Owner',
      isSales: role === 'Salesperson',
      isSupplier: role === 'Supplier',
      entries: ENTRIES[role] || ENTRIES.Owner,
    });
    this.load();
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    Promise.resolve(this.load()).then(done, done);
  },

  load() {
    return api.get('/api/dashboard/summary')
      .then((res) => {
        const t = res.today || {};
        const m = res.month || {};
        const s = res.stock || {};
        const e = res.expiry || {};
        const c = res.credit || {};
        const o = res.online || {};
        const sup = res.supplier || {};
        this.setData({
          loading: false,
          scope: res.scope || '',
          today: {
            orders: t.orders || 0,
            amountText: fmt.money(t.amount),
            profitText: fmt.money(t.profit),
            marginText: fmt.pct(t.margin),
            avgText: fmt.money(t.avgTicket),
          },
          month: {
            amountText: fmt.money(m.amount),
            profitText: fmt.money(m.profit),
          },
          stock: {
            skuCount: s.skuCount || 0,
            batches: s.batches || 0,
            valueText: fmt.money(s.value),
            qtyText: Number(s.qty || 0).toFixed(0),
          },
          expiry: {
            count: e.count || 0,
            expiring: e.expiring || 0,
          },
          credit: {
            outstandingText: fmt.money(c.outstanding),
            overdue: c.overdueAccounts || 0,
          },
          online: {
            pendingPick: o.pendingPick || 0,
            todayOrders: o.todayOrders || 0,
          },
          supplier: {
            pendingOrders: sup.pendingOrders || 0,
            pendingStatements: sup.pendingStatements || 0,
          },
          todos: (res.todo || []).slice(0, 5).map((x) => ({
            key: x.key,
            title: x.title,
            count: x.count,
          })),
        });
      })
      .catch(() => this.setData({ loading: false }));
  },

  go(e) {
    const key = e.currentTarget.dataset.key;
    const item = this.data.entries.find((x) => x.key === key);
    if (!item) return;
    const url = '/pages/' + key + '/' + key;
    if (item.tab) {
      wx.switchTab({ url, fail: () => wx.navigateTo({ url }) });
    } else {
      wx.navigateTo({ url });
    }
  },

  goTodo(e) {
    const key = e.currentTarget.dataset.key;
    const item = this.data.entries.find((x) => x.key === key);
    if (item) {
      this.go({ currentTarget: { dataset: { key } } });
      return;
    }
    wx.showToast({ title: '该事项由老板处理', icon: 'none' });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (r) => { if (r.confirm) app.toLogin(); },
    });
  },
});
