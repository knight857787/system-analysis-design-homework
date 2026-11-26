// 统一请求封装：Bearer Token + 401 自动回登录
const app = () => getApp();
const config = require('./config.js');

let token = '';

function setToken(t) {
  token = t || '';
}

function request(path, options) {
  const opts = options || {};
  const baseUrl = config.getBaseUrl();
  const header = { 'Content-Type': 'application/json' };
  const useToken = opts.token === undefined ? token : opts.token;
  if (useToken) header.Authorization = 'Bearer ' + useToken;

  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl + path,
      method: opts.method || 'GET',
      data: opts.data || {},
      header,
      timeout: 15000,
      success(res) {
        if (res.statusCode === 401) {
          if (!opts.silentAuth) {
            const a = app();
            if (a && a.toLogin) a.toLogin();
          }
          reject(new Error('未登录或登录已失效'));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const msg = (res.data && res.data.error) || ('请求失败（' + res.statusCode + '）');
        if (!opts.silent) wx.showToast({ title: msg, icon: 'none' });
        reject(new Error(msg));
      },
      fail(err) {
        const msg = '网络异常：' + ((err && err.errMsg) || '请检查网络');
        if (!opts.silent) wx.showToast({ title: msg, icon: 'none' });
        reject(new Error(msg));
      },
    });
  });
}

module.exports = {
  setToken,
  get: (path, opts) => request(path, Object.assign({}, opts, { method: 'GET' })),
  post: (path, data, opts) => request(path, Object.assign({}, opts, { method: 'POST', data })),
  put: (path, data, opts) => request(path, Object.assign({}, opts, { method: 'PUT', data })),
};
