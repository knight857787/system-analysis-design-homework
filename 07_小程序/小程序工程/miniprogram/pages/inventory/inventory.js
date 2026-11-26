const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    q: '',
    items: [],
    total: 0,
    page: 1,
    size: 20,
    hasMore: true,
    loading: true,
    onlyStock: true,
  },

  onShow() {
    const user = app.globalData.user || wx.getStorageSync('user');
    if (!user) { app.toLogin(); return; }
    if (user.role === 'Supplier') {
      wx.showModal({
        title: '无权限',
        content: '供货商账号只能查看订货单与对账单',
        showCancel: false,
        success: () => wx.switchTab({ url: '/pages/dashboard/dashboard' }),
      });
      return;
    }
    if (!this.data.items.length) this.reload();
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    this.reload().then(done, done);
  },

  onInput(e) { this.setData({ q: e.detail.value }); },

  toggleOnlyStock() {
    this.setData({ onlyStock: !this.data.onlyStock });
    this.reload();
  },

  reload() {
    this.setData({ page: 1, items: [], hasMore: true, loading: true });
    return this.fetch();
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    this.setData({ page: this.data.page + 1 });
    this.fetch();
  },

  fetch() {
    const q = this.data.q || '';
    return api.get('/api/inventory', {
      data: {
        q,
        page: this.data.page,
        size: this.data.size,
        inStock: this.data.onlyStock ? 1 : 0,
      },
      silent: true,
    })
      .then((res) => {
        const rows = (res.items || []).map((x) => ({
          LedgerID: x.LedgerID,
          ProductName: x.ProductName || x.Name,
          BatchNo: x.BatchNo || x.BatchID,
          ExpiryDate: x.ExpiryDate || '',
          ExpiryText: (x.RemainDays === null || x.RemainDays === undefined)
            ? ''
            : (Number(x.RemainDays) < 0 ? '（已过期 ' + Math.abs(x.RemainDays) + ' 天）' : '（剩 ' + x.RemainDays + ' 天）'),
          Location: x.Location,
          Unit: x.Unit || '',
          QuantityText: Number(x.Quantity || 0).toFixed(2),
        }));
        const items = this.data.page === 1 ? rows : this.data.items.concat(rows);
        this.setData({
          items,
          total: res.total || items.length,
          loading: false,
          hasMore: items.length < (res.total || items.length),
        });
      })
      .catch(() => this.setData({ loading: false }));
  },
});
