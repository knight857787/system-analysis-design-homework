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
    return api.get('/api/receipts/pending-orders', { silent: true })
      .then((res) => {
        const rows = (res.items || []).map((o) => ({
          OrderID: o.OrderID,
          OrderNo: o.OrderNo,
          SupplierName: o.SupplierName,
          ExpectedArrivalDate: o.ExpectedArrivalDate,
          amountText: fmt.money(o.TotalAmount),
          lines: (o.lines || []).slice(0, 6).map((l) => ({
            ProductName: l.ProductName,
            Quantity: l.Quantity,
            Unit: l.Unit || '',
          })),
        }));
        this.setData({ items: rows, loading: false });
      })
      .catch(() => this.setData({ loading: false }));
  },
});
