// 服务器地址：ICP 备案已完成，统一使用域名（不再保留 IP 直连模式）
const BASE_URL = 'https://oc-emporiumretai-ms.com';

function getBaseUrl() {
  return BASE_URL;
}

function label() {
  return '域名 ' + BASE_URL.replace('https://', '');
}

module.exports = { getBaseUrl, label, BASE_URL };
