const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');
const env = require('../../utils/env.js');

Page({
  data: {
    q: '',
    results: [],
    cart: [],
    discount: '',
    netText: '0.00',
    subtotalText: '0.00',
    submitting: false,
    payMethods: ['现金', '微信支付', '支付宝', '银联'],
    canCheckout: true,
    envLabel: '开发版',
  },

  onLoad() {
    const user = app.globalData.user || {};
    if (user.role !== 'Owner' && user.role !== 'Salesperson') {
      wx.showModal({ title: '无权限', content: '当前角色没有收银权限', showCancel: false, success: () => wx.navigateBack() });
      return;
    }
    this.setData({
      canCheckout: !env.isRelease(),
      envLabel: env.envLabel(),
    });
    this.search('');
  },

  onInput(e) { this.setData({ q: e.detail.value }); this.debounceSearch(); },

  debounceSearch() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.search(this.data.q), 300);
  },

  onSearch() { this.search(this.data.q); },

  search(q) {
    return api.get('/api/products/search', { data: { q: q || '', limit: 12 }, silent: true })
      .then((res) => this.setData({ results: res.items || [] }))
      .catch(() => {});
  },

  scan() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        const code = res.result || '';
        this.setData({ q: code });
        this.search(code);
      },
      fail: () => wx.showToast({ title: '扫码已取消（开发者工具无摄像头）', icon: 'none' }),
    });
  },

  add(e) {
    const p = e.currentTarget.dataset.item;
    const cart = this.data.cart.slice();
    const hit = cart.find((x) => x.productId === p.ProductID);
    if (hit) {
      hit.qty = Number((hit.qty + 1).toFixed(3));
    } else {
      cart.push({
        productId: p.ProductID,
        name: p.ProductName,
        unit: p.Unit,
        price: Number(p.ListPrice || 0),
        qty: 1,
      });
    }
    this.applyCart(cart);
  },

  changeQty(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const delta = Number(e.currentTarget.dataset.delta);
    const cart = this.data.cart.slice();
    const row = cart[idx];
    if (!row) return;
    row.qty = Number((row.qty + delta).toFixed(3));
    if (row.qty <= 0) cart.splice(idx, 1);
    this.applyCart(cart);
  },

  applyCart(cart) {
    const view = cart.map((x) => ({
      productId: x.productId,
      name: x.name,
      unit: x.unit,
      price: x.price,
      qty: x.qty,
      qtyText: String(x.qty),
      priceText: fmt.money(x.price),
      amountText: fmt.money(x.price * x.qty),
    }));
    this.setData({ cart: view });
    this.refreshQuote();
  },

  onDiscount(e) {
    this.setData({ discount: e.detail.value });
    this.refreshQuote();
  },

  refreshQuote() {
    const cart = this.data.cart;
    if (!cart.length) {
      this.setData({ netText: '0.00', subtotalText: '0.00' });
      return;
    }
    api.post('/api/sales/quote', {
      lines: cart.map((c) => ({ productId: c.productId, quantity: c.qty })),
      discountAmount: Number(this.data.discount || 0),
    }, { silent: true })
      .then((res) => this.setData({
        netText: fmt.money(res.net),
        subtotalText: fmt.money(res.subtotal),
      }))
      .catch(() => {});
  },

  checkout() {
    if (!this.data.canCheckout) return;
    const cart = this.data.cart;
    if (!cart.length || this.data.submitting) return;
    wx.showActionSheet({
      itemList: this.data.payMethods,
      success: (res) => {
        const method = this.data.payMethods[res.tapIndex];
        this.submit(method);
      },
    });
  },

  submit(method) {
    const cart = this.data.cart;
    const net = Number(this.data.netText);
    this.setData({ submitting: true });
    api.post('/api/sales', {
      lines: cart.map((c) => ({ productId: c.productId, quantity: c.qty })),
      discountAmount: Number(this.data.discount || 0),
      pays: [{ method, amount: net }],
    })
      .then((res) => {
        this.setData({ submitting: false, cart: [], discount: '', netText: '0.00', subtotalText: '0.00' });
        wx.showModal({
          title: '结算成功',
          content: '单号 ' + (res.saleNo || res.saleId || '') + '\n应收 ¥' + fmt.money(net) + ' · ' + method,
          showCancel: false,
        });
        this.search(this.data.q);
      })
      .catch(() => this.setData({ submitting: false }));
  },
});
