const app = getApp();
const api = require('../../utils/api.js');
const config = require('../../utils/config.js');

// 服务器不通时也能看到演示账号（与线上口令一致）
const FALLBACK_ACCOUNTS = [
  { loginName: 'boss', password: 'YlfDemo2026', roleLabel: '老板' },
  { loginName: 'stocker', password: 'YlfDemo2026', roleLabel: '理货员' },
  { loginName: 'sales', password: 'YlfDemo2026', roleLabel: '销售人员' },
  { loginName: 'supplier', password: 'YlfDemo2026', roleLabel: '供货商' },
];

Page({
  data: {
    loginName: '',
    password: '',
    error: '',
    netTip: '',
    loading: false,
    timeText: '',
    dateText: '',
    demoAccounts: FALLBACK_ACCOUNTS,
  },

  onLoad() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 30000);
    this.loadDemo();
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer);
  },

  tick() {
    const now = new Date();
    const hh = ('0' + now.getHours()).slice(-2);
    const mm = ('0' + now.getMinutes()).slice(-2);
    const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    this.setData({
      timeText: hh + ':' + mm,
      dateText: now.getFullYear() + ' 年 ' + (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 周' + week,
    });
  },

  loadDemo() {
    api.get('/api/auth/demo-accounts', { token: '', silent: true })
      .then((res) => {
        const accounts = (res.accounts || []).map((a) => ({
          loginName: a.loginName,
          password: a.password,
          roleLabel: a.roleLabel,
        }));
        if (accounts.length) this.setData({ demoAccounts: accounts, netTip: '' });
      })
      .catch((err) => {
        this.setData({
          netTip: '服务器未连通：' + ((err && err.message) || '未知原因') +
            '（已使用内置演示账号；请检查“详情→本地设置→不校验合法域名”）',
        });
      });
  },


  testConn() {
    wx.showLoading({ title: '连接中…' });
    api.get('/api/health', { token: '', silent: true })
      .then((res) => {
        wx.hideLoading();
        wx.showModal({
          title: '服务器连通',
          content: '地址：' + config.getBaseUrl() + '\n状态：' + (res.status || 'up') + '\n数据库：' + (res.database || '-'),
          showCancel: false,
        });
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showModal({ title: '连接失败', content: String((err && err.message) || err), showCancel: false });
      });
  },

  onLoginName(e) { this.setData({ loginName: e.detail.value }); },
  onPassword(e) { this.setData({ password: e.detail.value }); },

  pickAccount(e) {
    const name = e.currentTarget.dataset.name;
    const acc = this.data.demoAccounts.find((a) => a.loginName === name);
    if (!acc) return;
    this.setData({ loginName: acc.loginName, password: acc.password, error: '' });
  },

  goRegister() {
    wx.navigateTo({ url: '/pages/register/register' });
  },

  submit() {
    if (this.data.loading) return;
    const loginName = (this.data.loginName || '').trim();
    const password = this.data.password || '';
    if (!loginName || !password) {
      this.setData({ error: '请填写登录名和密码' });
      return;
    }
    this.setData({ loading: true, error: '' });
    api.post('/api/auth/login', { loginName, password }, { token: '', silentAuth: true })
      .then((res) => {
        app.saveSession(res.token, res.user);
        wx.reLaunch({ url: '/pages/dashboard/dashboard' });
      })
      .catch((err) => {
        this.setData({ loading: false, error: err.message || '登录失败' });
      });
  },
});
