const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');

Page({
  data: { items: [], loading: true, activeCount: 0 },
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
    this.setData({ loading: true });
    return api.get('/api/members?days=30', { silent: true }).then((res) => {
      const rows = (res.items || []).map((m) => ({
        MemberID: m.MemberID,
        Name: m.Name,
        Phone: m.Phone,
        Level: m.Level || '普通',
        PointsText: Number(m.Points || 0).toFixed(0),
        OrdersRecent: m.OrdersRecent || 0,
        AmountRecent: fmt.money(m.AmountRecent),
        AmountTotal: fmt.money(m.AmountTotal),
        active: Number(m.OrdersRecent) > 0,
      }));
      this.setData({ items: rows, loading: false, activeCount: rows.filter((r) => r.active).length });
    }).catch(() => this.setData({ loading: false }));
  },
});
