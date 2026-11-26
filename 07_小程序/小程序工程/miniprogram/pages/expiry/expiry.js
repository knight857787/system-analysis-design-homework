const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');

Page({
  data: { days: 7, items: [], loading: true, expiredCount: 0, soonCount: 0, canSeeMoney: false },

  onShow() {
    const user = app.globalData.user || wx.getStorageSync('user');
    if (!user) { app.toLogin(); return; }
    this.setData({ canSeeMoney: (user.role || '') === 'Owner' });
    this.load();
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    Promise.resolve(this.load()).then(done, done);
  },

  setDays(e) {
    const d = Number(e.currentTarget.dataset.days);
    this.setData({ days: d });
    this.load();
  },

  load() {
    this.setData({ loading: true });
    const q = this.data.days ? '?days=' + this.data.days : '?days=9999';
    return api.get('/api/expiry/warnings' + q, { silent: true })
      .then((res) => {
        const rows = (res.items || []).map((x) => {
          const rd = Number(x.RemainDays || 0);
          return {
            BatchID: x.BatchID,
            ProductName: x.ProductName,
            Specification: x.Specification || '',
            Unit: x.Unit || '',
            QuantityText: Number(x.Quantity || 0).toFixed(2),
            Location: x.Location,
            ExpiryDate: x.ExpiryDate,
            valueText: fmt.money(x.stockValue),
            warn: rd < 0,
            daysText: rd < 0 ? '已过期 ' + Math.abs(rd) + ' 天' : '剩 ' + rd + ' 天',
          };
        });
        this.setData({
          items: rows,
          loading: false,
          expiredCount: rows.filter((r) => r.warn).length,
          soonCount: rows.filter((r) => !r.warn).length,
        });
      })
      .catch(() => this.setData({ loading: false }));
  },
});
