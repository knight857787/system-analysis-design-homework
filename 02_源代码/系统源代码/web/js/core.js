/* ==========================================================================
   核心库：请求、格式化、DOM、表格、图表、弹窗、提示
   无第三方依赖（离线可用）
   ========================================================================== */

export const state = {
  user: null,
  options: { categories: [], suppliers: [], customers: [], employees: [], payMethods: [], channels: [], locations: [], store: {} },
  meta: null,
};

/* ------------------------------------------------------------------ 请求 */
async function request(method, path, { body, query } = {}) {
  let url = path;
  if (query) {
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, v);
    });
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let resp;
  try {
    resp = await fetch(url, init);
  } catch (err) {
    throw new Error('网络连接失败，请确认服务是否在运行');
  }
  let data = null;
  const text = await resp.text();
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = { ok: false, error: '返回内容不是合法 JSON' }; }
  }
  if (resp.status === 401) {
    state.user = null;
    window.dispatchEvent(new CustomEvent('app:unauthorized'));
    throw new Error((data && data.error) || '登录已失效，请重新登录');
  }
  if (!resp.ok || (data && data.ok === false)) {
    const msg = (data && data.error) || ('请求失败（HTTP ' + resp.status + '）');
    const err = new Error(msg);
    err.status = resp.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body, query) => request('POST', path, { body: body || {}, query }),
  put: (path, body) => request('PUT', path, { body: body || {} }),
  del: (path) => request('DELETE', path, {}),
};

/* ------------------------------------------------------------------ 格式化 */
export const fmt = {
  money(v, digits = 2) {
    const n = Number(v || 0);
    return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  },
  yuan(v, digits = 2) { return '¥' + fmt.money(v, digits); },
  qty(v, digits = 2) {
    const n = Number(v || 0);
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(digits).replace(/\.?0+$/, '');
  },
  int(v) { return Number(v || 0).toLocaleString('zh-CN'); },
  pct(v, digits = 1) { return (Number(v || 0)).toFixed(digits) + '%'; },
  date(v) { return v ? String(v).slice(0, 10) : '—'; },
  datetime(v) {
    if (!v) return '—';
    const s = String(v);
    return s.length > 16 ? s.slice(0, 16) : s;
  },
  time(v) { return v ? String(v).slice(11, 16) : '—'; },
  days(v) {
    if (v === null || v === undefined) return '—';
    const n = Number(v);
    if (n < 0) return '已过期 ' + Math.abs(n) + ' 天';
    if (n === 0) return '今日到期';
    return '剩 ' + n + ' 天';
  },
  ago(v) {
    if (!v) return '—';
    const t = new Date(String(v).replace(/-/g, '/')).getTime();
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前';
    return fmt.date(v);
  },
  today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  dateOffset(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  weekday(v) {
    const names = ['日', '一', '二', '三', '四', '五', '六'];
    return '周' + names[new Date(String(v).replace(/-/g, '/')).getDay()];
  },
  signed(v) { const n = Number(v || 0); return (n > 0 ? '+' : '') + fmt.qty(n, 3); },
};

/* ------------------------------------------------------------------ DOM */
export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  });
  children.flat().forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  });
  return el;
}

/** 事件委托：on(root, 'click', '[data-x]', handler)
 *  同一 root + 事件 + 选择器重复注册时只更新处理函数，避免重复触发。 */
const DELEGATES = new WeakMap();
export function on(root, event, selector, handler) {
  if (!root) return;
  let byEvent = DELEGATES.get(root);
  if (!byEvent) {
    byEvent = {};
    DELEGATES.set(root, byEvent);
  }
  const entries = byEvent[event] || (byEvent[event] = []);
  const existing = entries.find((en) => en.selector === selector);
  if (existing) {
    existing.handler = handler;
    return;
  }
  entries.push({ selector, handler });
  if (!byEvent[event + '::attached']) {
    byEvent[event + '::attached'] = true;
    root.addEventListener(event, (e) => {
      const list = byEvent[event] || [];
      const targetEl = e.target instanceof Element ? e.target : e.target.parentElement;
      if (!targetEl) return;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const en = list[i];
        const match = targetEl.closest(en.selector);
        if (match && root.contains(match)) {
          en.handler(e, match);
          return;
        }
      }
    });
  }
}

export function debounce(fn, wait = 260) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ------------------------------------------------------------------ 图标 */
const PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.6"/><rect x="14" y="3" width="7" height="5" rx="1.6"/><rect x="14" y="12" width="7" height="9" rx="1.6"/><rect x="3" y="16" width="7" height="5" rx="1.6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.9"/>',
  boxin: '<path d="M3 8.5 12 4l9 4.5v9L12 22l-9-4.5z"/><path d="M3 8.5 12 13l9-4.5M12 13v9"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h2.4l2.6 12h11l2-8H6"/>',
  tag: '<path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h9z"/><circle cx="8" cy="8" r="1.4"/>',
  truck: '<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8z"/><circle cx="6" cy="18.5" r="1.6"/><circle cx="17" cy="18.5" r="1.6"/>',
  boxes: '<rect x="3" y="3" width="8" height="8" rx="1.6"/><rect x="13" y="3" width="8" height="8" rx="1.6"/><rect x="3" y="13" width="8" height="8" rx="1.6"/><rect x="13" y="13" width="8" height="8" rx="1.6"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4M8.5 10h7M8.5 14h7M8.5 18h4"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v4M18 10v4"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.6"/><path d="M11 18.6h2"/>',
  wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5z"/><path d="M16 12h5M3 9h18"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5"/><path d="M17 5.2a3.4 3.4 0 0 1 0 6.6M18.5 20c0-2.4-.9-4-2.4-5"/>',
  file: '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l3.5-4 3 3L20 7"/>',
  badge: '<circle cx="12" cy="9.5" r="6.5"/><path d="M8.5 15.2 7 22l5-2.4L17 22l-1.5-6.8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14.2H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 2.6h.1A2 2 0 1 1 13 2.6h.1A1.6 1.6 0 0 0 15 4.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20.4 9v.1a2 2 0 1 1 0 4z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17.2v.2"/>',
  check: '<path d="M4 12.5 9.5 18 20 6.5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  print: '<path d="M6 9V3h12v6M6 18H4.5A1.5 1.5 0 0 1 3 16.5v-5A1.5 1.5 0 0 1 4.5 10h15a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H18"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  flag: '<path d="M5 21V4h9l-1 3h6l-2 5 2 5h-6l1-3H5"/>',
  store: '<path d="M3 9 5 3h14l2 6"/><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 21v-6h6v6"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-3.6 3.6-6 8-6s8 2.4 8 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  refresh2: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  weigh: '<path d="M4 7h16l-2.5 13h-11z"/><path d="M12 7V4M9 11.5c0-1.7 1.3-3 3-3s3 1.3 3 3-1.3 3-3 3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
};

export function icon(name, cls = '') {
  const p = PATHS[name] || PATHS.dashboard;
  return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
}

/* ------------------------------------------------------------------ 标签 */
const TONE_MAP = {
  ok: 'ok', pass: 'ok', done: 'ok', completed: 'ok', confirmed: 'ok', active: 'ok', approved: 'ok', a: 'ok',
  warn: 'warn', pending: 'warn', waiting: 'warn', counting: 'warn', partial: 'warn', submitted: 'info',
  danger: 'danger', overdue: 'danger', expired: 'danger', rejected: 'danger', cancelled: 'danger', cancelled2: 'danger',
  info: 'info', picked: 'info', open: 'info', missing: 'warn',
  violet: 'violet',
};

export function tag(text, tone) {
  const t = tone || TONE_MAP[String(text || '').toLowerCase()] || '';
  return '<span class="tag ' + t + '">' + esc(text) + '</span>';
}

/* ------------------------------------------------------------------ 提示条 */
let toastWrap = null;
export function toast(message, type = 'ok', ms = 3200) {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toast-wrap';
    document.body.appendChild(toastWrap);
  }
  const map = { ok: '✓', error: '✕', warn: '!', info: 'i' };
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = '<div class="ico">' + (map[type] || 'i') + '</div><div class="body">' + esc(message) + '</div>';
  toastWrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* ------------------------------------------------------------------ 弹窗 */
let modalSeq = 0;
export function modal(options) {
  const {
    title = '', desc = '', content = '', size = '', submitText = '确定', cancelText = '取消',
    onSubmit = null, danger = false, hideFooter = false, extraButtons = [],
  } = options;
  const id = 'm' + (++modalSeq);
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div><h3>${esc(title)}</h3>${desc ? '<div class="desc">' + desc + '</div>' : ''}</div>
        <button class="x" data-close aria-label="关闭">×</button>
      </div>
      <form class="modal-form" novalidate>
        <div class="modal-body">
          <div class="form-error" data-error></div>
          ${content}
        </div>
        ${hideFooter ? '' : `<div class="modal-foot">
          ${extraButtons.map((b) => `<button type="button" class="btn ${b.kind || ''}" data-extra="${b.key}">${esc(b.label)}</button>`).join('')}
          <div class="spacer"></div>
          <button type="button" class="btn" data-close>${esc(cancelText)}</button>
          <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(submitText)}</button>
        </div>`}
      </form>
    </div>`;
  document.body.appendChild(mask);
  const form = mask.querySelector('form');
  const errorBox = mask.querySelector('[data-error]');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    mask.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
    if (e.target.closest('[data-close]')) close();
  });
  mask.querySelectorAll('[data-extra]').forEach((btn) => {
    const cfg = extraButtons.find((b) => b.key === btn.dataset.extra);
    btn.addEventListener('click', () => { if (cfg && cfg.onClick) cfg.onClick({ form, close }); });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) { close(); return; }
    const submitBtn = form.querySelector('button[type=submit]');
    const values = Object.fromEntries(new FormData(form).entries());
    form.querySelectorAll('[data-multi]').forEach((box) => {
      const name = box.dataset.multi;
      values[name] = Array.from(form.querySelectorAll('[name="' + name + '"]')).map((x) => x.value);
    });
    errorBox.classList.remove('show');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset.label = submitBtn.textContent; submitBtn.textContent = '处理中…'; }
    try {
      const result = await onSubmit(values, form);
      if (result !== false) close();
    } catch (err) {
      errorBox.textContent = err.message || String(err);
      errorBox.classList.add('show');
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitBtn.dataset.label || '确定'; }
    }
  });
  const focusable = mask.querySelector('input:not([type=hidden]), select, textarea');
  if (focusable) setTimeout(() => focusable.focus(), 60);
  return { close, form, el: mask };
}

export function confirmBox(options) {
  const { title = '确认操作', message = '', confirmText = '确定', danger = false } = options;
  return new Promise((resolve) => {
    let decided = false;
    const m = modal({
      title, size: 'narrow', content: '<p style="margin:0;color:var(--ink-2);line-height:1.7">' + message + '</p>',
      submitText: confirmText, danger, cancelText: '取消',
      onSubmit: () => { decided = true; resolve(true); },
    });
    const observer = new MutationObserver(() => {
      if (!document.body.contains(m.el) && !decided) { decided = true; resolve(false); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true });
  });
}

export function drawer(options) {
  const { title = '', subtitle = '', body = '', footer = '' } = options;
  const mask = document.createElement('div');
  mask.className = 'drawer-mask';
  const panel = document.createElement('div');
  panel.className = 'drawer';
  panel.innerHTML = `
    <div class="drawer-head">
      <div><h3>${esc(title)}</h3>${subtitle ? '<div class="muted small">' + subtitle + '</div>' : ''}</div>
      <div class="spacer"></div>
      <button class="x btn btn-ghost btn-sm" data-close>✕</button>
    </div>
    <div class="drawer-body">${body}</div>
    <div class="drawer-foot">${footer}<div class="spacer"></div><button class="btn" data-close>关闭</button></div>`;
  document.body.appendChild(mask);
  document.body.appendChild(panel);
  const close = () => { mask.remove(); panel.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  mask.addEventListener('click', close);
  panel.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  return { close, el: panel, body: panel.querySelector('.drawer-body'), foot: panel.querySelector('.drawer-foot') };
}

/* ------------------------------------------------------------------ 表格 */
export function table({ columns, rows, empty = '暂无数据', rowClass = null, onRowClick = null, key = 'id', compact = false }) {
  if (!rows || !rows.length) return emptyState(empty);
  const head = columns.map((c) => `<th class="${c.cls || ''}" ${c.width ? 'style="width:' + c.width + '"' : ''}>${c.label || ''}</th>`).join('');
  const body = rows.map((row, i) => {
    const cls = (typeof rowClass === 'function' ? rowClass(row, i) : '') || '';
    const cells = columns.map((c) => {
      const raw = c.render ? c.render(row, i) : (row[c.key] === undefined ? '' : esc(row[c.key]));
      return `<td class="${c.cls || ''}">${raw === null || raw === undefined ? '' : raw}</td>`;
    }).join('');
    const k = row[key] !== undefined ? row[key] : i;
    return `<tr data-row="${esc(k)}" data-i="${i}" class="${cls}">${cells}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="table ${compact ? 'compact' : ''} ${onRowClick ? 'clickable' : ''}">
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    ${onRowClick ? '<span data-rowclick class="hide">' + '1' + '</span>' : ''}`;
}

export function emptyState(text = '暂无数据', sub = '') {
  return `<div class="empty">${icon('boxes')}<p>${esc(text)}</p>${sub ? '<p class="tiny">' + sub + '</p>' : ''}</div>`;
}

/** 分页条 HTML（事件用 bindPager 绑定） */
export function pager({ page = 1, size = 20, total = 0 }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const btn = (p, label, active = false, disabled = false) =>
    `<button data-page="${p}" class="${active ? 'active' : ''}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  let nums = '';
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  for (let p = start; p <= end; p++) nums += btn(p, p, p === page);
  return `<div class="pager">
    <span>共 <b>${total}</b> 条 · 第 ${page}/${pages} 页</span>
    <div class="spacer"></div>
    ${btn(1, '首页', false, page <= 1)}
    ${btn(page - 1, '上一页', false, page <= 1)}
    ${nums}
    ${btn(page + 1, '下一页', false, page >= pages)}
    ${btn(pages, '末页', false, page >= pages)}
  </div>`;
}

export function bindPager(root, handler) {
  on(root, 'click', '[data-page]', (e, el) => {
    if (el.disabled) return;
    handler(Number(el.dataset.page));
  });
}

/* ------------------------------------------------------------------ 表单 */
export function fieldHtml(cfg) {
  const { name, label, type = 'text', value = '', options = [], required = false, hint = '',
    placeholder = '', full = false, min, max, step = 'any', readonly = false } = cfg;
  const id = 'f_' + name;
  const reqMark = required ? '<span class="req">*</span>' : '';
  let control = '';
  if (type === 'select') {
    const opts = options.map((o) => {
      const val = typeof o === 'object' ? o.value : o;
      const lab = typeof o === 'object' ? o.label : o;
      return `<option value="${esc(val)}" ${String(val) === String(value) ? 'selected' : ''}>${esc(lab)}</option>`;
    }).join('');
    control = `<select class="select" id="${id}" name="${name}" ${readonly ? 'disabled' : ''}>${opts}</select>`;
  } else if (type === 'textarea') {
    control = `<textarea class="textarea" id="${id}" name="${name}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
  } else if (type === 'static') {
    control = `<div class="input" style="display:flex;align-items:center;background:#f8fafc">${value}</div>`;
  } else {
    control = `<input class="input" id="${id}" name="${name}" type="${type}" value="${esc(value)}"
      placeholder="${esc(placeholder)}" ${min !== undefined ? 'min=' + min : ''} ${max !== undefined ? 'max=' + max : ''}
      step="${step}" ${required ? 'required' : ''} ${readonly ? 'readonly' : ''}>`;
  }
  return `<div class="field ${full ? 'full' : ''}">
    <label for="${id}">${esc(label)}${reqMark}</label>
    ${control}
    ${hint ? '<div class="form-hint">' + hint + '</div>' : ''}
  </div>`;
}

export function formFields(fields) {
  return '<div class="form-grid">' + fields.map(fieldHtml).join('') + '</div>';
}

export function formError(message) {
  return '<div class="form-error show">' + esc(message) + '</div>';
}

/* ------------------------------------------------------------------ 图表 */
const PALETTE = ['#0f9d6e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#84cc16', '#6366f1', '#f97316'];

export function chartLine({ data, xKey = 'date', series = [], height = 190, showArea = true, yLabel = '' }) {
  if (!data || !data.length) return emptyState('暂无趋势数据');
  const w = 720, hgt = height, padL = 46, padR = 14, padT = 14, padB = 26;
  const values = [];
  data.forEach((d) => series.forEach((s) => values.push(Number(d[s.key] || 0))));
  const maxV = Math.max(...values, 1);
  const niceMax = niceCeil(maxV);
  const innerW = w - padL - padR, innerH = hgt - padT - padB;
  const x = (i) => padL + (data.length === 1 ? innerW / 2 : (i * innerW) / (data.length - 1));
  const y = (v) => padT + innerH - (Number(v || 0) / niceMax) * innerH;
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const gv = (niceMax / 4) * i;
    const gy = y(gv);
    grid += `<line class="grid-line" x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}"/>`;
    grid += `<text class="axis-text" x="${padL - 7}" y="${gy + 3.5}" text-anchor="end">${shortNum(gv)}</text>`;
  }
  let paths = '';
  series.forEach((s, si) => {
    const color = s.color || PALETTE[si % PALETTE.length];
    const pts = data.map((d, i) => [x(i), y(d[s.key])]);
    const line = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    if (showArea && si === 0) {
      paths += `<path d="${line} L ${pts[pts.length - 1][0].toFixed(1)} ${padT + innerH} L ${pts[0][0].toFixed(1)} ${padT + innerH} Z"
        fill="url(#areaGrad${si})" opacity=".9"/>`;
    }
    paths += `<path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
    paths += pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${data.length > 20 ? 1.6 : 2.8}"
      fill="#fff" stroke="${color}" stroke-width="2"><title>${esc(data[i][xKey])} ${esc(s.label || s.key)}: ${fmt.num1 ? '' : ''}${data[i][s.key]}</title></circle>`).join('');
  });
  const xLabels = data.map((d, i) => {
    const step = Math.ceil(data.length / 8);
    if (i % step !== 0 && i !== data.length - 1) return '';
    return `<text class="axis-text" x="${x(i).toFixed(1)}" y="${hgt - 8}" text-anchor="middle">${esc(String(d[xKey]).slice(5))}</text>`;
  }).join('');
  const defs = series.map((s, si) => `<linearGradient id="areaGrad${si}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${s.color || PALETTE[si % PALETTE.length]}" stop-opacity=".22"/>
      <stop offset="100%" stop-color="${s.color || PALETTE[si % PALETTE.length]}" stop-opacity="0"/>
    </linearGradient>`).join('');
  return `<div class="legend" style="margin-bottom:6px">${series.map((s, si) =>
    `<span><i style="background:${s.color || PALETTE[si % PALETTE.length]}"></i>${esc(s.label || s.key)}</span>`).join('')}
    ${yLabel ? '<span class="tiny">单位：' + esc(yLabel) + '</span>' : ''}</div>
    <svg class="chart chart-line" viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" style="height:${hgt}px">
      <defs>${defs}</defs>${grid}${paths}${xLabels}
    </svg>`;
}

function niceCeil(v) {
  const exp = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
  const f = v / exp;
  let nf = 1;
  if (f <= 1) nf = 1; else if (f <= 2) nf = 2; else if (f <= 2.5) nf = 2.5;
  else if (f <= 5) nf = 5; else nf = 10;
  return nf * exp;
}
function shortNum(v) {
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return Math.round(v).toString();
}

export function chartDonut({ items, size = 148, thickness = 20, centerTop = '', centerSub = '' }) {
  const list = (items || []).filter((i) => Number(i.value) > 0);
  if (!list.length) return emptyState('暂无占比数据');
  const total = list.reduce((s, i) => s + Number(i.value), 0);
  const r = size / 2 - thickness / 2 - 2;
  const cx = size / 2, cy = size / 2;
  let angle = -Math.PI / 2;
  let arcs = '';
  list.forEach((item, idx) => {
    const frac = Number(item.value) / total;
    const end = angle + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const color = item.color || PALETTE[idx % PALETTE.length];
    if (frac >= 0.9999) {
      arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${thickness}"/>`;
    } else {
      arcs += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}" fill="none"
        stroke="${color}" stroke-width="${thickness}" stroke-linecap="butt"><title>${esc(item.label)}</title></path>`;
    }
    angle = end;
  });
  return `<div class="donut-wrap">
    <div style="position:relative;width:${size}px;height:${size}px;flex:none">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${arcs}</svg>
      <div style="position:absolute;inset:0;display:grid;place-content:center;text-align:center">
        <div style="font-size:16px;font-weight:680">${esc(centerTop)}</div>
        <div class="tiny muted">${esc(centerSub)}</div>
      </div>
    </div>
    <div class="donut-legend">${list.map((item, idx) => `
      <div class="donut-item"><i style="background:${item.color || PALETTE[idx % PALETTE.length]}"></i>
        <span class="name">${esc(item.label)}</span>
        <span class="val">${item.display || fmt.yuan(item.value)}</span></div>`).join('')}
    </div>
  </div>`;
}

export function barList({ items, tone = '', formatter = null, max = null }) {
  const list = items || [];
  if (!list.length) return emptyState('暂无数据');
  const top = max || Math.max(...list.map((i) => Number(i.value || 0)), 1);
  return '<div class="bars">' + list.map((item) => {
    const v = Number(item.value || 0);
    const pct = Math.max(2, (v / top) * 100);
    const t = item.tone || tone;
    return `<div class="bar-row">
      <span class="name" title="${esc(item.label)}">${esc(item.label)}</span>
      <span class="bar-track"><i class="bar-fill ${t}" style="width:${pct.toFixed(1)}%"></i></span>
      <span class="val">${formatter ? formatter(v, item) : fmt.yuan(v)}</span></div>`;
  }).join('') + '</div>';
}

/* ------------------------------------------------------------------ 其他 */
export function stat({ label, value, unit = '', sub = '', tone = '', iconName = '' }) {
  return `<div class="stat ${tone ? 'tone-' + tone : ''}">
    ${iconName ? '<div class="stat-ico">' + icon(iconName) + '</div>' : ''}
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${value}${unit ? '<small>' + esc(unit) + '</small>' : ''}</div>
    <div class="stat-sub">${sub || ''}</div>
  </div>`;
}

export function sectionTitle(text, extra = '') {
  return `<div class="section-title">${esc(text)}${extra ? '<div class="spacer"></div>' + extra : ''}</div>`;
}

export function downloadCsv(filename, rows, headers) {
  const esc0 = (v) => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(esc0).join(',')].concat(rows.map((r) => r.map(esc0).join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

export function loadingBlock(text = '数据加载中…') {
  return `<div class="loading-block">
    <div class="row"><span class="spinner"></span><span class="muted">${esc(text)}</span></div>
    <div class="skeleton" style="width:38%"></div><div class="skeleton" style="width:72%"></div>
    <div class="skeleton" style="width:54%"></div></div>`;
}

export function optionsOf(list, labelKey = 'Name', valueKey = 'SupplierID') {
  return (list || []).map((x) => ({ value: x[valueKey], label: x[labelKey] }));
}
