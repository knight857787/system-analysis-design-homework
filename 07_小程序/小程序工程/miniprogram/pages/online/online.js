const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');

const STATUS = { Pending: '待拣货', Picking: '拣货中', Delivering: '配送中', Done: '已完成', Cancelled: '已取消', Confirmed: '已确认' };

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
    return api.get('/api/online-orders?page=1&size=20', { silent: true }).then((res) => {
      const rows = (res.items || []).map((o) => ({
        OrderID: o.OrderID,
        OrderNo: o.OrderNo,
        CustomerName: o.CustomerName || '顾客',
        channelText: o.channelLabel || o.Channel,
        FulfilMethod: o.FulfilMethod || '到店自提',
        PlacedAt: (o.PlacedAt || '').slice(5, 16),
        amountText: fmt.money(o.TotalAmount),
        statusText: STATUS[o.OrderStatus] || o.OrderStatus,
      }));
      this.setData({ items: rows, loading: false });
    }).catch(() => this.setData({ loading: false }));
  },
});
