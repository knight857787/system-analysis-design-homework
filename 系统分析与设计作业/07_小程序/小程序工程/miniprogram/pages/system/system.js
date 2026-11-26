const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: { info: { store: {}, tech: {} }, user: {}, matrix: [], useCaseCount: 0, tableCount: 0 },
  onShow() {
    const user = app.globalData.user || wx.getStorageSync('user');
    if (!user) { app.toLogin(); return; }
    this.setData({ user });
    api.get('/api/system/info', { silent: true }).then((res) => {
      this.setData({
        info: res,
        matrix: (res.permissionMatrix || []).slice(0, 6),
        useCaseCount: (res.useCases || []).length,
        tableCount: (res.tables || []).length,
      });
    }).catch(() => {});
  },
});
