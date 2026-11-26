const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');

Page({
  data: {
    q: '',
    items: [],
    total: 0,
    page: 1,
    size: 20,
    hasMore: true,
    loading: true,
    onShelf: 'Y',
  },

  onShow() {
    const user = app.globalData.user || wx.getStorageSync('user');
    if (!user) { app.toLogin(); return; }
    if (!this.data.items.length) this.reload();
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    this.reload().then(done, done);
  },

  onInput(e) { this.setData({ q: e.detail.value }); },

  toggleShelf() {
    this.setData({ onShelf: this.data.onShelf === 'Y' ? '' : 'Y' });
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
    const data = { q: this.data.q || '', page: this.data.page, size: this.data.size };
    if (this.data.onShelf) data.onShelf = this.data.onShelf;
    return api.get('/api/products', { data, silent: true })
      .then((res) => {
        const rows = (res.items || []).map((x) => ({
          ProductID: x.ProductID,
          ProductName: x.ProductName,
          CategoryName: x.CategoryName,
          Specification: x.Specification,
          Unit: x.Unit,
          OnShelfFlag: x.OnShelfFlag,
          ListPriceText: fmt.money(x.ListPrice),
          StockQtyText: Number(x.StockQty || 0).toFixed(2),
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
