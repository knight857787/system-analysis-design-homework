/* ==========================================================================
   应用外壳：登录、侧边导航、哈希路由、页面懒加载
   ========================================================================== */
import { api, state, esc, icon, toast, $, on, modal } from './core.js';

/* 前端异常兜底：把脚本错误留痕到 <html data-js-error>，便于现场排查 */
window.addEventListener('error', (ev) => {
  const info = `${ev.message || '未知错误'} @${String(ev.filename || '').split('/').pop()}:${ev.lineno || 0}`;
  document.documentElement.dataset.jsError = info;
  if (ev.target && ev.target.tagName === 'SCRIPT') {
    toast('前端脚本加载失败：' + (ev.target.src || ''), 'error', 6000);
  }
});
window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev.reason && (ev.reason.message || ev.reason);
  document.documentElement.dataset.jsError = 'unhandled: ' + String(reason).slice(0, 200);
});

const PAGES = {
  dashboard: () => import('./pages/dashboard.js'),
  expiry: () => import('./pages/expiry.js'),
  receipts: () => import('./pages/receipts.js'),
  purchases: () => import('./pages/purchases.js'),
  products: () => import('./pages/products.js'),
  suppliers: () => import('./pages/suppliers.js'),
  inventory: () => import('./pages/inventory.js'),
  stocktake: () => import('./pages/stocktake.js'),
  pos: () => import('./pages/pos.js'),
  online: () => import('./pages/online.js'),
  credit: () => import('./pages/credit.js'),
  members: () => import('./pages/members.js'),
  settle: () => import('./pages/settle.js'),
  reports: () => import('./pages/reports.js'),
  acceptance: () => import('./pages/acceptance.js'),
  system: () => import('./pages/system.js'),
};

const OWNER = 'Owner', STOCKER = 'Stocker', SALES = 'Salesperson', SUPPLIER = 'Supplier';

export const NAV = [
  {
    title: '经营',
    items: [
      { key: 'dashboard', label: '经营看板', icon: 'dashboard', roles: [OWNER, STOCKER, SALES, SUPPLIER], title: '经营看板', crumb: '今日经营数据与待办' },
      { key: 'reports', label: '经营分析', icon: 'chart', roles: [OWNER], title: '经营分析', crumb: '毛利、损耗与结构分析' },
      { key: 'acceptance', label: '验收指标', icon: 'badge', roles: [OWNER], title: '试运行验收指标', crumb: '报告表 22 的基线 / 目标 / 当前' },
    ],
  },
  {
    title: '门店作业',
    items: [
      { key: 'expiry', label: '临期处理', icon: 'clock', roles: [OWNER, STOCKER], title: '临期商品处理', crumb: 'UC-01 折价 · UC-06 报损 · UC-07 退货' },
      { key: 'receipts', label: '收货验收', icon: 'boxin', roles: [OWNER, STOCKER], title: '收货与验收', crumb: 'UC-03 收货登记 · UC-15 进货查验' },
      { key: 'pos', label: '收银台', icon: 'cash', roles: [OWNER, SALES], title: '收银台', crumb: 'UC-16 记录销售与收款' },
      { key: 'online', label: '线上订单', icon: 'phone', roles: [OWNER, STOCKER, SALES], title: '线上到家订单', crumb: 'UC-11 提交 · UC-12 拣货与交付' },
    ],
  },
  {
    title: '库存与商品',
    items: [
      { key: 'inventory', label: '库存台账', icon: 'boxes', roles: [OWNER, STOCKER, SALES], title: '库存台账', crumb: '按商品 + 批次记的现存量' },
      { key: 'stocktake', label: '盘点差异', icon: 'clipboard', roles: [OWNER, STOCKER], title: '盘点与差异处理', crumb: 'UC-17 实盘、差异原因与调账' },
      { key: 'products', label: '商品档案', icon: 'tag', roles: [OWNER, STOCKER, SALES], title: '商品档案', crumb: 'UC-09 商品、类别与折价规则' },
    ],
  },
  {
    title: '往来与顾客',
    items: [
      { key: 'purchases', label: '订货单', icon: 'cart', roles: [OWNER, STOCKER, SUPPLIER], title: '订货与在途', crumb: 'UC-04 补货建议与订货单' },
      { key: 'settle', label: '供应商对账', icon: 'file', roles: [OWNER, SUPPLIER], title: '供应商对账', crumb: 'UC-02 对账 · UC-07 付款' },
      { key: 'suppliers', label: '供应商档案', icon: 'truck', roles: [OWNER, STOCKER], title: '供应商与结算条款', crumb: 'UC-10 账期、退货比例与扣减项' },
      { key: 'credit', label: '熟客赊账', icon: 'wallet', roles: [OWNER, SALES], title: '熟客赊账', crumb: 'UC-13 挂账、账龄与催收' },
      { key: 'members', label: '会员与积分', icon: 'users', roles: [OWNER, SALES], title: '会员与积分', crumb: 'UC-14 会员复购与积分流水' },
    ],
  },
  {
    title: '系统',
    items: [
      { key: 'system', label: '系统说明', icon: 'settings', roles: [OWNER, STOCKER, SALES, SUPPLIER], title: '系统说明与留痕', crumb: '用例映射、权限矩阵、操作日志' },
    ],
  },
];

function navFor(role) {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) }))
    .filter((g) => g.items.length);
}

/* ------------------------------------------------------------------ 登录 */
async function renderLogin(message = '') {
  const demo = await api.get('/api/auth/demo-accounts').catch(() => ({ accounts: [] }));
  const now = new Date();
  const timeText = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateText = now.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
  const root = $('#root');
  root.innerHTML = `
  <div class="os-login">
    <div class="os-fluid os-fluid-a"></div>
    <div class="os-fluid os-fluid-b"></div>
    <header class="os-login-top">
      <div class="os-wordmark">
        <div class="os-logo-mark">洋</div>
        <div><b>门店经营助手</b><small>STORE OPS</small></div>
      </div>
      <div class="os-system-status">
        <span><i></i>系统在线</span>
        <span>${esc(dateText)}</span>
        <span>安全会话</span>
      </div>
    </header>
    <main class="os-login-main">
      <section class="os-login-card" aria-labelledby="os-welcome">
        <div class="os-clock">
          <strong>${esc(timeText)}</strong>
          <span>${esc(dateText)}</span>
        </div>
        <div class="os-profile">
          <div class="os-account-avatar">${icon('store')}</div>
          <h1 id="os-welcome">欢迎回来</h1>
          <p>登录门店经营助手，进入门店经营工作台</p>
        </div>
        <div class="os-tabs" role="tablist" aria-label="登录或注册">
          <button type="button" class="os-tab active" data-tab="login" role="tab" aria-selected="true">登录</button>
          <button type="button" class="os-tab" data-tab="register" role="tab" aria-selected="false">注册</button>
        </div>
        <div class="os-account-caption" aria-live="polite">
          <b data-os-account-name>本地账户</b>
          <span data-os-account-hint>选择演示身份或输入登录名</span>
        </div>
        <div class="os-login-error ${message ? 'show' : ''}" data-error>${esc(message)}</div>
        <div data-pane="login">
          <form class="os-login-form" data-login>
            <div class="os-input-wrap">
              ${icon('user')}
              <input class="input" id="loginName" name="loginName" autocomplete="username" placeholder="登录名" aria-label="登录名" required>
            </div>
            <div class="os-input-wrap">
              ${icon('lock')}
              <input class="input" id="password" name="password" type="password" autocomplete="current-password" placeholder="密码" aria-label="密码" required>
            </div>
            <button class="btn os-submit" type="submit">进入工作台 <span aria-hidden="true">→</span></button>
          </form>
        </div>
        <div data-pane="register" style="display:none">
          <form class="os-login-form" data-register>
            <div class="os-input-wrap">
              ${icon('badge')}
              <input class="input" name="inviteCode" placeholder="邀请码（向老板索取）" aria-label="邀请码" required>
            </div>
            <div class="os-input-wrap">
              ${icon('user')}
              <input class="input" name="name" placeholder="姓名" aria-label="姓名" maxlength="32" required>
            </div>
            <div class="os-input-wrap">
              ${icon('user')}
              <input class="input" name="loginName" placeholder="登录名（字母开头，3–32 位）" aria-label="登录名"
                     pattern="[A-Za-z][A-Za-z0-9_]{2,31}" autocomplete="username" required>
            </div>
            <div class="os-input-wrap">
              ${icon('lock')}
              <input class="input" name="password" type="password" placeholder="密码（至少 8 位）" aria-label="密码"
                     minlength="8" autocomplete="new-password" required>
            </div>
            <div class="os-input-wrap">
              ${icon('lock')}
              <input class="input" name="confirm" type="password" placeholder="确认密码" aria-label="确认密码"
                     minlength="8" autocomplete="new-password" required>
            </div>
            <button class="btn os-submit" type="submit">创建账号并进入 <span aria-hidden="true">→</span></button>
          </form>
        </div>
        <div class="os-quick">
          <div class="os-quick-head"><b>演示身份</b><span>点击账户可快速填入</span></div>
          <div class="os-account-grid">
            ${(demo.accounts || []).map((a) => `
              <button type="button" class="os-account" data-account='${esc(JSON.stringify(a))}'>
                <strong>${esc(a.roleLabel)} · ${esc(a.name)}</strong>
                <span>${esc(a.loginName)} / ${esc(a.role)}</span>
              </button>`).join('')}
          </div>
        </div>
      </section>
    </main>
    <footer class="os-login-foot">
      <span class="os-security">本地安全会话 · 数据仅保存在当前设备</span>
      <span>门店经营助手 · 平利县寅利丰生活超市 · v1.0</span>
    </footer>
  </div>`;

  const form = $('[data-login]', root);
  const errorBox = $('[data-error]', root);
  const accountName = $('[data-os-account-name]', root);
  const accountHint = $('[data-os-account-hint]', root);
  root.querySelectorAll('[data-account]').forEach((el) => {
    el.addEventListener('click', () => {
      const acc = JSON.parse(el.dataset.account);
      root.querySelectorAll('[data-account]').forEach((node) => node.classList.toggle('active', node === el));
      accountName.textContent = acc.roleLabel + ' · ' + acc.name;
      accountHint.textContent = acc.desc;
      form.loginName.value = acc.loginName;
      form.password.value = acc.password;
      form.password.focus();
    });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = '正在进入门店经营助手…';
    errorBox.classList.remove('show');
    try {
      const res = await api.post('/api/auth/login', {
        loginName: form.loginName.value.trim(),
        password: form.password.value,
      });
      state.user = res.user;
      await bootShell();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add('show');
      btn.disabled = false;
      btn.textContent = '进入工作台 →';
    }
  });

  /* 登录 / 注册 页签 */
  const panes = {
    login: $('[data-pane="login"]', root),
    register: $('[data-pane="register"]', root),
  };
  const quick = $('.os-quick', root);
  const caption = $('.os-account-caption', root);
  function switchTab(name) {
    root.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Object.keys(panes).forEach((k) => { panes[k].style.display = k === name ? '' : 'none'; });
    if (quick) quick.style.display = name === 'login' ? '' : 'none';
    if (caption) caption.style.display = name === 'login' ? '' : 'none';
    errorBox.classList.remove('show');
  }
  root.querySelectorAll('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });
  if (location.hash === '#register') switchTab('register');

  /* 邀请码注册 */
  const regForm = $('[data-register]', root);
  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = regForm.querySelector('button[type=submit]');
      if (regForm.password.value !== regForm.confirm.value) {
        errorBox.textContent = '两次输入的密码不一致';
        errorBox.classList.add('show');
        return;
      }
      btn.disabled = true;
      btn.textContent = '正在创建账号…';
      errorBox.classList.remove('show');
      try {
        const res = await api.post('/api/auth/register', {
          inviteCode: regForm.inviteCode.value.trim(),
          name: regForm.name.value.trim(),
          loginName: regForm.loginName.value.trim(),
          password: regForm.password.value,
        });
        state.user = res.user;
        await bootShell();
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.classList.add('show');
        btn.disabled = false;
        btn.textContent = '创建账号并进入 →';
      }
    });
  }
}

/* ------------------------------------------------------------------ 外壳 */
async function bootShell() {
  const me = await api.get('/api/auth/me');
  state.user = me.user;
  state.options = await api.get('/api/options');
  const groups = navFor(me.user.role);
  const root = $('#root');
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="logo">${icon('store')}</div>
          <div class="txt"><b>门店经营助手</b><span>STORE WORKSPACE</span></div>
        </div>
        <div class="sidebar-store">
          <b>${esc(state.options.store.name || '平利县寅利丰生活超市')}</b>
          示例省示例市模拟区 · 单店
        </div>
        <nav class="nav">
          ${groups.map((g) => `
            <div class="nav-group">
              <div class="nav-group-title">${esc(g.title)}</div>
              ${g.items.map((i) => `
                <a class="nav-item" href="#/${i.key}" data-nav="${i.key}">
                  <span class="nav-icon">${icon(i.icon)}</span><span>${esc(i.label)}</span>
                </a>`).join('')}
            </div>`).join('')}
        </nav>
        <div class="sidebar-foot">© 2026 门店经营助手 · 平利县寅利丰生活超市</div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div>
            <h2 data-title>经营看板</h2>
            <div class="crumb" data-crumb>今日经营数据与待办</div>
          </div>
          <div class="topbar-actions">
            <span class="date-chip hide-sm">${icon('calendar')} <b>${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}</b></span>
            <button class="btn btn-sm" data-refresh title="刷新当前页面">${icon('refresh')} 刷新</button>
            <div class="user-box" data-user>
              <span class="avatar">${esc(me.user.name.slice(-2))}</span>
              <span class="who"><b>${esc(me.user.name)}</b><span>${esc(me.user.roleLabel)}${me.user.supplierName ? ' · ' + esc(me.user.supplierName) : ''}</span></span>
            </div>
          </div>
        </header>
        <main class="content" id="view"></main>
      </div>
    </div>`;

  $('[data-refresh]', root).addEventListener('click', () => navigate(currentRoute(), true));
  $('[data-user]', root).addEventListener('click', () => userMenu());

  window.addEventListener('hashchange', () => navigate(parseHash()));
  const start = parseHash();
  navigate(start.fallback ? { page: groups[0].items[0].key } : start);
}

function userMenu() {
  modal({
    title: '当前账号',
    size: 'narrow',
    hideFooter: true,
    content: `<div class="row" style="gap:14px">
        <span class="avatar lg">${esc(state.user.name.slice(-2))}</span>
        <div><b style="font-size:15px">${esc(state.user.name)}</b>
          <div class="muted small">${esc(state.user.roleLabel)} · 登录名 ${esc(state.user.loginName)}</div>
          <div class="muted small">${esc(state.user.phone || '')}</div>
        </div>
      </div>
      <div class="alert info mt16" style="display:block">
        ${roleHint(state.user.role)}
      </div>
      <button class="btn btn-block mt16" data-logout>退出登录</button>`,
  }).el.querySelector('[data-logout]').addEventListener('click', async () => {
    try { await api.post('/api/auth/logout'); } catch (e) { /* ignore */ }
    state.user = null;
    document.querySelectorAll('.modal-mask').forEach((n) => n.remove());
    location.hash = '';
    renderLogin();
  });
}

function roleHint(role) {
  const map = {
    Owner: '老板：可确认折价方案、批准盘点调账、确认对账结果、核销赊账与登记付款。',
    Stocker: '理货员：负责临期挑货、收货验收、线上拣货与实盘录入；报损入账与折价确认须老板确认。',
    Salesperson: '销售人员：负责收银记账、线上订单交付、登记挂账与收款；超出额度须老板确认。',
    Supplier: '供货商业务员：只能查看本公司订货单与对账单，可提交对账单、答复差异。',
  };
  return map[role] || '';
}

/* ------------------------------------------------------------------ 路由 */
function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const page = (pathPart || '').split('/')[0];
  const query = {};
  new URLSearchParams(queryPart || '').forEach((v, k) => { query[k] = v; });
  if (!page) {
    const groups = navFor(state.user ? state.user.role : 'Owner');
    return { page: groups[0].items[0].key, query, fallback: true };
  }
  return { page, query, fallback: false };
}

let currentPage = null;
function currentRoute() { return currentPage; }

async function navigate(route, force = false) {
  const meta = NAV.flatMap((g) => g.items).find((i) => i.key === route.page);
  if (!meta) {
    $('#view').innerHTML = `<div class="card"><div class="card-body">
      <div class="empty">${'页面不存在'}${'<p class="tiny">请从左侧菜单选择功能</p>'}</div></div></div>`;
    return;
  }
  const allowed = meta.roles.includes(state.user.role);
  const view = $('#view');
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === route.page);
  });
  const t = document.querySelector('[data-title]');
  const c = document.querySelector('[data-crumb]');
  if (t) t.textContent = meta.title;
  if (c) c.textContent = meta.crumb;
  document.title = meta.title + ' · 门店经营助手';
  currentPage = route.page;

  if (!allowed) {
    view.innerHTML = `<div class="card"><div class="card-body">
      <div class="alert danger" style="display:block">
        <b>无权访问</b><br>当前角色（${esc(state.user.roleLabel)}）没有该功能的权限，请联系老板调整账号角色。</div></div></div>`;
    return;
  }

  view.innerHTML = `<div class="loading-block">
      <div class="row"><span class="spinner"></span><span class="muted">正在加载 ${esc(meta.title)}…</span></div>
      <div class="skeleton" style="width:42%"></div>
      <div class="skeleton" style="width:76%"></div>
      <div class="skeleton" style="width:58%"></div>
    </div>`;
  try {
    const mod = await PAGES[route.page]();
    view.innerHTML = '';
    await mod.render(view, { query: route.query, user: state.user, options: state.options, meta });
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card"><div class="card-body">
      <div class="alert danger" style="display:block"><b>页面加载失败</b><br>${esc(err.message || err)}</div>
      <button class="btn mt12" onclick="location.reload()">重新加载</button></div></div>`;
  }
}

window.addEventListener('app:unauthorized', () => {
  // 首次进入（还没有会话）时静默回到登录页；只有“已登录后被踢出”才提示
  const hadSession = Boolean(state.user);
  state.user = null;
  location.hash = '';
  renderLogin(hadSession ? '登录已失效，请重新登录' : '');
});

/* ------------------------------------------------------------------ 启动 */
(async function boot() {
  try {
    const me = await api.get('/api/auth/me');
    state.user = me.user;
    await bootShell();
  } catch (err) {
    renderLogin();
  }
})();
