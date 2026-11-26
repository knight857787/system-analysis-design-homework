const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');

Page({
  data: { sales: {}, categories: [], tops: [], loading: true },
  onShow() {
    const user = app.globalData.user || wx.getStorageSync('user');
    if (!user) { app.toLogin(); return; }
    this.load();
  },
  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    Promise.resolve(this.load()).then(done, done);
  },
  load() {
    return api.get('/api/reports/summary', { silent: true }).then((res) => {
      const s = res.sales || {};
      const cats = (res.byCategory || []).slice(0, 6);
      const max = Math.max.apply(null, cats.map((c) => Number(c.amount || 0)).concat([1]));
      this.setData({
        loading: false,
        sales: {
          orders: s.orders || 0,
          amountText: fmt.money(s.amount),
          profitText: fmt.money(s.profit),
          marginText: fmt.pct(s.margin),
          avgText: fmt.money(s.avgTicket),
          dailyText: fmt.money(s.dailyAvg),
        },
        categories: cats.map((c) => ({
          name: c.name,
          amountText: fmt.money(c.amount),
          pctText: Math.round(Number(c.amount || 0) / max * 100),
        })),
        tops: (res.topProducts || []).slice(0, 5).map((p) => ({
          name: p.name,
          qtyText: Number(p.qty || 0).toFixed(0) + (p.Unit || ''),
          amountText: fmt.money(p.amount),
        })),
      });
    }).catch(() => this.setData({ loading: false }));
  },
});
