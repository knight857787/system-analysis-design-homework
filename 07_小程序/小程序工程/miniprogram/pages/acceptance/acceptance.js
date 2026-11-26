const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');

Page({
  data: { items: [], loading: true, okCount: 0, total: 0 },
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
    return api.get('/api/reports/acceptance', { silent: true }).then((res) => {
      this.setData({
        loading: false,
        items: (res.items || []).map((x) => ({
          key: x.key, metric: x.metric, baseline: x.baseline, target: x.target,
          current: x.current, ok: x.status === 'ok',
        })),
        okCount: res.okCount || 0,
        total: res.total || (res.items || []).length,
      });
    }).catch(() => this.setData({ loading: false }));
  },
});
