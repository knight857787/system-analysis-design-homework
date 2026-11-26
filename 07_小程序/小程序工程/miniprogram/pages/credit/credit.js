const app = getApp();
const api = require('../../utils/api.js');
const fmt = require('../../utils/fmt.js');

Page({
  data: { tab: 'account', items: [], loading: true },
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
    if (this.data.tab === 'account') {
      return api.get('/api/credit/accounts', { silent: true }).then((res) => {
        const rows = (res.items || []).map((a) => ({
          key: a.AccountID,
          title: a.Name,
          amountText: fmt.money(a.Outstanding),
          overdue: Number(a.OverdueDays) > 0,
          sub: '额度 ¥' + fmt.money(a.CreditLimit) + ' · 已用 ' + fmt.pct(a.LimitUsedPct) +
               (Number(a.OverdueDays) > 0 ? ' · 逾期 ' + a.OverdueDays + ' 天' : ' · 未逾期'),
        }));
        this.setData({ items: rows, loading: false });
      }).catch(() => this.setData({ loading: false }));
    }
    return api.get('/api/credit/dunning', { silent: true }).then((res) => {
      const rows = (res.items || []).map((d) => ({
        key: d.EntryID,
        title: d.Name,
        amountText: fmt.money(d.Remain),
        overdue: Number(d.OverdueDays) > 0,
        sub: d.EntryNo + ' · 到期 ' + (d.DueDate || '—') +
             (Number(d.OverdueDays) > 0 ? ' · 逾期 ' + d.OverdueDays + ' 天' : ''),
      }));
      this.setData({ items: rows, loading: false });
    }).catch(() => this.setData({ loading: false }));
  },
});
