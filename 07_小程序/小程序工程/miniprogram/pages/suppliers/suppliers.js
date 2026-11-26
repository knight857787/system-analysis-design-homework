const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');

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
    return api.get('/api/suppliers', { silent: true }).then((res) => {
      const rows = (res.items || []).map((s) => ({
        SupplierID: s.SupplierID,
        Name: s.Name,
        Contact: s.Contact,
        Phone: s.Phone,
        ProductCount: s.ProductCount || 0,
        termText: (s.PaymentTermDays || 0) + ' 天账期',
        payableText: fmt.money(s.OpenPayable),
      }));
      this.setData({ items: rows, loading: false });
    }).catch(() => this.setData({ loading: false }));
  },
});
