# 门店经营助手 · 微信小程序

与网页端（https://oc-emporiumretai-ms.com）并行，共用同一后端与权限模型。

## 快速开始

1. 微信开发者工具 → 导入项目 → 选择本目录 → AppID 填 `touristappid`（或你的真实 AppID）
2. 「详情 → 本地设置」勾选「不校验合法域名、web-view、TLS 版本以及 HTTPS 证书」
3. `Ctrl+B` 编译；模拟器登录页点「老板」自动填入（boss / YlfDemo2026）

## 目录

```
project.config.json      工程配置（miniprogramRoot、urlCheck=false）
miniprogram/
  app.js / app.json      全局与页面注册（17 页）
  app.wxss               主题与通用样式
  utils/api.js           请求封装（Bearer、401 回登录、统一错误提示）
  utils/config.js        服务器地址：域名 / IP 切换（开发默认 IP）
  utils/env.js           运行环境判定（develop/trial/release）
  utils/fmt.js           金额、百分比、日期格式化
  pages/*                17 个页面（登录 + 16 功能页）
```

## 服务器地址模式

域名 ICP 备案已于 2026-11 完成，开发版 / 体验版 / 正式版**统一走域名**（`https://oc-emporiumretai-ms.com`）。
登录页仍保留「服务器」切换，可在后台改走 IP 直连作为应急备用，但需先确认证书与域名一致。

## 正式版行为

`envVersion === 'release'` 时收银页隐藏结算按钮，只展示演示数据（个人主体审核策略）。

## 页面清单

登录、经营看板、收银台、库存台账、商品档案、临期处理、收货验收、盘点差异、
订货单、供应商对账、供应商档案、熟客赊账、会员积分、线上订单、经营分析、验收指标、系统说明。
