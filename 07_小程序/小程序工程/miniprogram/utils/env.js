// 运行环境：develop=开发者工具，trial=体验版，release=正式版
function envVersion() {
  try {
    const info = wx.getAccountInfoSync();
    return (info && info.miniProgram && info.miniProgram.envVersion) || 'develop';
  } catch (e) {
    return 'develop';
  }
}

// 正式版按“管理工具”定位：不提供结算动作，仅展示演示数据
function isRelease() {
  return envVersion() === 'release';
}

// 返回给用户看的版本名
function envLabel() {
  const map = { develop: '开发版', trial: '体验版', release: '正式版' };
  return map[envVersion()] || '开发版';
}

module.exports = { envVersion, isRelease, envLabel };
