// 凭邀请码注册：角色由邀请码决定（理货员 / 销售人员）
const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    inviteCode: '',
    loginName: '',
    name: '',
    phone: '',
    password: '',
    password2: '',
    loading: false,
    error: '',
  },

  onInvite(e) { this.setData({ inviteCode: (e.detail.value || '').trim().toUpperCase() }); },
  onLoginName(e) { this.setData({ loginName: (e.detail.value || '').trim() }); },
  onName(e) { this.setData({ name: (e.detail.value || '').trim() }); },
  onPhone(e) { this.setData({ phone: (e.detail.value || '').trim() }); },
  onPassword(e) { this.setData({ password: e.detail.value || '' }); },
  onPassword2(e) { this.setData({ password2: e.detail.value || '' }); },

  submit() {
    const d = this.data;
    if (!d.inviteCode) return this.setData({ error: '请填写老板给你的邀请码' });
    if (!d.loginName) return this.setData({ error: '请填写登录名（字母开头，3–32 位）' });
    if (!d.name) return this.setData({ error: '请填写姓名' });
    if ((d.password || '').length < 8) return this.setData({ error: '密码至少 8 位' });
    if (d.password !== d.password2) return this.setData({ error: '两次输入的密码不一致' });

    this.setData({ loading: true, error: '' });
    api.post('/api/auth/register', {
      inviteCode: d.inviteCode,
      loginName: d.loginName,
      name: d.name,
      phone: d.phone,
      password: d.password,
    }, { token: '', silentAuth: true }).then((res) => {
      const user = res.user || {};
      const tk = res.token || '';
      api.setToken(tk);
      if (app && app.globalData) {
        app.globalData.user = user;
        app.globalData.token = tk;
      }
      wx.setStorageSync('user', user);
      wx.setStorageSync('token', tk);
      this.setData({ loading: false });
      wx.showToast({ title: '注册成功，正在进入', icon: 'success' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/dashboard/dashboard',
          fail: () => wx.reLaunch({ url: '/pages/dashboard/dashboard' }) });
      }, 800);
    }).catch((err) => {
      this.setData({ loading: false, error: (err && err.message) || '注册失败' });
    });
  },

  back() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/login/login' }) });
  },
});
