const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');

const PAY = { Open: '待付款', Partial: '部分付款', Paid: '已付清', Overdue: '已逾期' };
const STMT = { Draft: '草稿', Submitted: '待确认', Confirmed: '已确认', Rejected: '有差异' };

Page({
  data: { tab: 'payable', items: [], loading: true, payableSum: '0.00' },
  onShow() {
    const user = app.globalData.user || wx.getStorageSync('user');
    if (!user) { app.toLogin(); return; }
    this.load();
  },
  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    Promise.resolve(this.load()).then(done, done);
  },
  switchTab(e) {
    const t = e.currentTarget.dataset.tab;
    if (t === this.data.tab) return;
    this.setData({ tab: t });
    this.load();
  },
  load() {
    this.setData({ loading: true, items: [] });
    if (this.data.tab === 'payable') {
      return api.get('/api/payables', { silent: true }).then((res) => {
        const rows = (res.items || []).map((p) => ({
          PayableID: p.PayableID,
          PayableNo: p.PayableNo,
          SupplierName: p.SupplierName,
          PlannedPayDate: p.PlannedPayDate,
          remainText: fmt.money(p.Remain),
          statusText: PAY[p.PayableStatus] || p.PayableStatus,
        }));
        const sum = rows.reduce((s, r) => s + Number(r.remainText), 0);
        this.setData({ items: rows, loading: false, payableSum: fmt.money(sum) });
      }).catch(() => this.setData({ loading: false }));
    }
    return api.get('/api/statements?page=1&size=20', { silent: true }).then((res) => {
      const rows = (res.items || []).map((s) => ({
        StatementID: s.StatementID,
        StatementNo: s.StatementNo,
        period: (s.PeriodStart || '') + ' ~ ' + (s.PeriodEnd || ''),
        amountText: fmt.money(s.CounterpartyAmount || s.PurchaseAmount),
        statusText: STMT[s.StatementStatus] || s.StatementStatus,
      }));
      this.setData({ items: rows, loading: false });
    }).catch(() => this.setData({ loading: false }));
  },
});
