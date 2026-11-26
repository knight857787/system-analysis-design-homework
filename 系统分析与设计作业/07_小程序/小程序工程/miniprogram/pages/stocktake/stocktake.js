const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');

const STATUS = { Draft: '草稿', Counting: '盘点中', Confirmed: '已确认', Cancelled: '已取消' };

Page({
  data: { items: [], loading: true },

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
    return api.get('/api/stocktakes?page=1&size=20', { silent: true })
      .then((res) => {
        const rows = (res.items || []).map((p) => ({
          PlanID: p.PlanID,
          PlanNo: p.PlanNo,
          Scope: p.Scope || '全部',
          LineCount: p.LineCount || 0,
          PlannedAt: p.PlannedAt || '',
          statusText: STATUS[p.Status] || p.Status,
          diffText: '¥' + fmt.money(p.DiffAmount),
          rateText: fmt.pct(p.DiffRate),
        }));
        this.setData({ items: rows, loading: false });
      })
      .catch(() => this.setData({ loading: false }));
  },
});
