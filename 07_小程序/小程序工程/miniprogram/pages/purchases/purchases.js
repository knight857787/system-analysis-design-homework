const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');

const STATUS = { Draft: '草稿', Submitted: '已提交', Received: '已收货', Cancelled: '已取消', Pending: '待处理' };

Page({
  data: { items: [], loading: true, totalAmount: '0.00' },
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
    return api.get('/api/purchase-orders?page=1&size=20', { silent: true })
      .then((res) => {
        const rows = (res.items || []).map((o) => ({
          OrderID: o.OrderID,
          OrderNo: o.OrderNo,
          SupplierName: o.SupplierName,
          ExpectedArrivalDate: o.ExpectedArrivalDate,
          amountText: fmt.money(o.TotalAmount),
          statusText: STATUS[o.OrderStatus] || o.OrderStatus,
        }));
        const total = rows.reduce((s, r) => s + Number(r.amountText), 0);
        this.setData({ items: rows, loading: false, totalAmount: fmt.money(total) });
      })
      .catch(() => this.setData({ loading: false }));
  },
});
