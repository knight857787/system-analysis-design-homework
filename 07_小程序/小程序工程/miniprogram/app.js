const api = require('./utils/api.js');

App({
  globalData: {
    baseUrl: 'https://oc-emporiumretai-ms.com',
    token: '',
    user: null,
  },

  onLaunch() {
    const token = wx.getStorageSync('token') || '';
    const user = wx.getStorageSync('user') || null;
    this.globalData.token = token;
    this.globalData.user = user;
    api.setToken(token);
  },

  // 登录成功后统一落库
  saveSession(token, user) {
    this.globalData.token = token;
    this.globalData.user = user;
    api.setToken(token);
    wx.setStorageSync('token', token);
    wx.setStorageSync('user', user);
  },

  clearSession() {
    this.globalData.token = '';
    this.globalData.user = null;
    api.setToken('');
    wx.removeStorageSync('token');
    wx.removeStorageSync('user');
  },

  toLogin() {
    this.clearSession();
    wx.reLaunch({ url: '/pages/login/login' });
  },
});
