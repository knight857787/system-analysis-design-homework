/* 系统说明：用例映射、权限矩阵、数据表、员工与操作留痕 */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock,
  modal, pager, bindPager, stat as statCard,
} from '../core.js';

export async function render(view, ctx) {
  const isOwner = ctx.user.role === 'Owner';
  let tab = ctx.query.tab || 'about';

  view.innerHTML = `
    <div class="card mb12">
      <div class="toolbar">
        <div class="seg" data-tabs>
          <button data-tab="about" class="${tab === 'about' ? 'active' : ''}">系统信息</button>
          <button data-tab="usecases" class="${tab === 'usecases' ? 'active' : ''}">用例映射</button>
          <button data-tab="tables" class="${tab === 'tables' ? 'active' : ''}">关系模式</button>
          ${isOwner ? `<button data-tab="staff" class="${tab === 'staff' ? 'active' : ''}">员工与权限</button>
          <button data-tab="invites" class="${tab === 'invites' ? 'active' : ''}">邀请码</button>
          <button data-tab="audit" class="${tab === 'audit' ? 'active' : ''}">操作留痕</button>` : ''}
        </div>
        <div class="spacer"></div>
        <span class="tag plain">${esc(state.options.store.name || '')}</span>
      </div>
      <div class="card-body" data-body>${loadingBlock()}</div>
    </div>`;

  const body = $('[data-body]', view);
  $$('[data-tabs] button', view).forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $$('[data-tabs] button', view).forEach((x) => x.classList.toggle('active', x === b));
    route();
  }));

  let info = null;
  async function route() {
    body.innerHTML = loadingBlock();
    if (!info) info = await api.get('/api/system/info');
    if (tab === 'usecases') return renderUseCases();
    if (tab === 'tables') return renderTables();
    if (tab === 'staff') return renderStaff();
    if (tab === 'invites') return renderInvites();
    if (tab === 'audit') return renderAudit();
    return renderAbout();
  }

  function renderAbout() {
    const t = info.tech;
    body.innerHTML = `
      <div class="grid grid-side">
        <div class="stack">
          <div class="card">
            <div class="card-head"><h3>这个系统是什么</h3></div>
            <div class="card-body">
              <p style="margin-top:0;line-height:1.9;color:var(--ink-2)">
                「门店经营助手」是报告《门店经营助手——小型个体户生活超市运营系统》的设计落地实现：
                按报告第 4 节的 17 个系统用例、第 6 节与第 7 节的关系模式（38 张表）、
                附录 A 的数据字典与附录 D 的取数口径，做成一套可在门店实际运行的前后端系统。
              </p>
              <div class="alert ok mt12" style="display:block">
                <b>它不替代收银机，而是补上收银机承担不了的那部分：</b>
                库存与损耗台账、临期预警与折价、供应商对账、线上到家接单、熟客赊账台账、会员复购。
              </div>
              <div class="section-title mt16">设计约束在代码里的落点</div>
              <ul style="margin:0;padding-left:18px;line-height:2;color:var(--ink-2);font-size:13px">
                ${info.designNotes.map((n) => `<li>${esc(n)}</li>`).join('')}
              </ul>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>技术栈</h3></div>
            <div class="card-body">
              <dl class="kv">
                <dt>后端</dt><dd>${esc(t.backend)}</dd>
                <dt>数据库</dt><dd>${esc(t.database)}</dd>
                <dt>前端</dt><dd>${esc(t.frontend)}</dd>
                <dt>登录</dt><dd>${esc(t.auth)}</dd>
                <dt>留痕</dt><dd>${esc(t.audit)}</dd>
                <dt>版本</dt><dd>v${esc(info.version)} · 构建 ${esc(info.build)}</dd>
              </dl>
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-head"><h3>门店与账号</h3></div>
            <div class="card-body">
              <dl class="kv kv-sm">
                <dt>门店</dt><dd>${esc(info.store.name)}</dd>
                <dt>地址</dt><dd>${esc(info.store.address)}</dd>
                <dt>系统</dt><dd>${esc(info.store.system)}</dd>
                <dt>当前账号</dt><dd>${esc(info.currentUser.name)} · ${esc(info.currentUser.role)}</dd>
              </dl>
              <div class="alert info mt12" style="display:block">
                演示账号：boss / boss123（老板）、stocker / stocker123（理货员）、
                sales / sales123（销售人员）、supplier / supplier123（供货商业务员）。
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h3>权限矩阵（报告表 23）</h3></div>
            <div class="card-body flush">
              ${table({
                compact: true,
                columns: [
                  { label: '操作', render: (r) => esc(r.action) },
                  { label: '老板', render: (r) => tag(r.owner, r.owner.includes('必须') ? 'warn' : r.owner.includes('不允许') ? 'danger' : 'ok') },
                  { label: '销售人员', render: (r) => tag(r.sales, r.sales === '—' ? 'plain' : 'info') },
                  { label: '理货员', render: (r) => tag(r.stocker, r.stocker === '—' ? 'plain' : 'info') },
                ],
                rows: info.permissionMatrix,
              })}
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderUseCases() {
    body.innerHTML = `
      <div class="alert info mb12" style="display:block">
        报告表 49 给出了每个系统用例的来源：<b>外部指向系统的消息构成系统用例，消息另一端的角色构成系统执行者</b>。
        下表把 17 个用例与系统的页面入口、写入的关系模式逐一对应，点卡片可直接跳转。
      </div>
      <div class="uc-grid">
        ${info.useCases.map((u) => `
          <a class="uc-card" href="${u.route}" style="text-decoration:none;color:inherit">
            <span class="no">${esc(u.no)}</span>
            <h4>${esc(u.name)}</h4>
            <p>主执行者：${esc(u.actor)}</p>
            <p class="mono" style="margin-top:6px;color:#7f93a8">${u.tables.slice(0, 3).join(' · ')}${u.tables.length > 3 ? ' …' : ''}</p>
          </a>`).join('')}
      </div>
      <div class="card mt16">
        <div class="card-head"><h3>用例 → 关系模式对照</h3><div class="actions"><span class="tag plain">报告表 13 / 表 18</span></div></div>
        <div class="card-body flush">
          ${table({
            compact: true,
            columns: [
              { label: '编号', render: (r) => `<span class="mono">${esc(r.no)}</span>` },
              { label: '用例', render: (r) => `<b>${esc(r.name)}</b>` },
              { label: '执行者', render: (r) => esc(r.actor) },
              { label: '写入的关系模式', render: (r) => r.tables.map((t) => tag(t, 'plain')).join(' ') },
              { label: '入口', render: (r) => `<a href="${r.route}">${esc(r.route.replace('#/', ''))}</a>` },
            ],
            rows: info.useCases,
          })}
        </div>
      </div>`;
  }

  function renderTables() {
    const totalRows = info.tables.reduce((s, t) => s + t.rows, 0);
    body.innerHTML = `
      <div class="grid grid-3 mb12">
        ${statCard({ label: '业务表', value: info.tables.length, unit: '张', iconName: 'boxes', sub: '与报告表 12/18/53 一一对应' })}
        ${statCard({ label: '数据行数合计', value: fmt.int(totalRows), tone: 'info', iconName: 'chart', sub: '含演示数据' })}
        ${statCard({ label: '视图', value: 4, unit: '个', tone: 'violet', iconName: 'file', sub: '派生属性与清单不建表' })}
      </div>
      <div class="card">
        <div class="card-head"><h3>表与行数</h3><div class="actions"><span class="tag plain">命名：英文标识符 + 通用字段</span></div></div>
        <div class="card-body">
          <div class="uc-grid">
            ${info.tables.map((t) => `<div class="uc-card" style="cursor:default">
              <span class="no mono">${esc(t.table)}</span>
              <div class="row" style="margin-top:6px"><b style="font-size:15px">${fmt.int(t.rows)}</b>
                <span class="muted small">行</span></div>
            </div>`).join('')}
          </div>
          <div class="alert info mt16" style="display:block">
            另有两个实现辅助对象：<b>StockMovement</b>（把收货/销售/报损/退货/调账四类流水落到一处，便于追溯）与
            <b>AuditLog</b>（所有写操作留痕）；四个视图：vStockSellable、vExpiryWarning、vProductStock、vCreditSummary。
          </div>
        </div>
      </div>`;
  }

  const INVITE_STATE = {
    active: ['有效', 'ok'],
    used_up: ['已用完', 'plain'],
    expired: ['已过期', 'warn'],
    disabled: ['已停用', 'plain'],
  };

  async function renderInvites() {
    const res = await api.get('/api/invite-codes');
    body.innerHTML = `
      <div class="row mb12">
        <span class="tag plain">邀请码用于登录页「注册」：填码即开号，角色由码决定；可设有效期与可用次数</span>
        <div class="spacer"></div>
        <button class="btn btn-sm btn-primary" data-newinvite>${icon('plus')} 生成邀请码</button>
      </div>
      ${table({
        columns: [
          { label: '邀请码', render: (r) => `<span class="mono"><b>${esc(r.Code)}</b></span>` },
          { label: '开通角色', render: (r) => tag(r.Role === 'Stocker' ? '理货员' : '销售员', 'info') },
          { label: '已用/上限', render: (r) => `${r.UsedCount} / ${r.MaxUses}` },
          { label: '有效期至', render: (r) => (r.ExpiresAt ? fmt.date(r.ExpiresAt) : '永久') },
          { label: '状态', render: (r) => tag(...(INVITE_STATE[r.state] || ['未知', 'plain'])) },
          { label: '创建人', render: (r) => esc(r.CreatedByName || '—') },
          { label: '创建时间', render: (r) => fmt.date(r.CreatedAt) },
          { label: '', cls: 'actions', render: (r) => (r.RecordStatus === 'A'
            ? `<button class="btn btn-sm" data-off="${r.InviteID}">停用</button>`
            : `<button class="btn btn-sm" data-on="${r.InviteID}">启用</button>`) },
        ],
        rows: res.items,
        empty: '还没有邀请码，点右上角「生成邀请码」',
      })}`;

    $('[data-newinvite]', body).addEventListener('click', () => {
      modal({
        title: '生成邀请码',
        desc: '把邀请码发给要入职的同事，他在登录页「注册」里填入即可自助开号',
        content: `<div class="form-grid">
            <div class="field"><label>开通角色</label>
              <select class="select" name="role">${(res.roles || []).map((r) =>
                `<option value="${r.value}">${r.label}</option>`).join('')}</select></div>
            <div class="field"><label>可用次数</label>
              <input class="input" name="maxUses" type="number" min="1" max="99" value="1"></div>
            <div class="field"><label>有效期（小时，0 表示永久）</label>
              <input class="input" name="expireHours" type="number" min="0" max="8760" value="72"></div>
          </div>`,
        onSubmit: async (v) => {
          const r2 = await api.post('/api/invite-codes', {
            role: v.role,
            maxUses: Number(v.maxUses || 1),
            expireHours: Number(v.expireHours || 0),
          });
          toast('邀请码：' + r2.code, 'ok');
          if (navigator.clipboard) {
            navigator.clipboard.writeText(r2.code).catch(() => {});
          }
          renderInvites();
        },
      });
    });

    on(body, 'click', '[data-off]', async (e, btn) => {
      await api.put('/api/invite-codes/' + btn.dataset.off, { recordStatus: 'V' });
      toast('已停用，该邀请码不能再用于注册', 'ok');
      renderInvites();
    });
    on(body, 'click', '[data-on]', async (e, btn) => {
      await api.put('/api/invite-codes/' + btn.dataset.on, { recordStatus: 'A' });
      toast('已启用', 'ok');
      renderInvites();
    });
  }

  async function renderStaff() {
    const res = await api.get('/api/employees');
    body.innerHTML = `
      <div class="row mb12">
        <span class="tag plain">账号一人一号、不共用；涉及钱与库存的操作按角色分权</span>
        <div class="spacer"></div>
        <button class="btn btn-sm btn-primary" data-newstaff>${icon('plus')} 新增员工</button>
      </div>
      ${table({
        columns: [
          { label: '姓名', render: (r) => `<div class="row"><span class="avatar">${esc((r.Name || '').slice(-2))}</span><b>${esc(r.Name)}</b></div>` },
          { label: '登录名', render: (r) => `<span class="mono">${esc(r.LoginName)}</span>` },
          { label: '角色', render: (r) => tag(r.roleLabel, r.Role === 'Owner' ? 'ok' : r.Role === 'Supplier' ? 'violet' : 'info') },
          { label: '联系电话', render: (r) => esc(r.Phone || '—') },
          { label: '所属供应商', render: (r) => esc(r.SupplierName || '—') },
          { label: '创建时间', render: (r) => fmt.date(r.CreatedAt) },
          { label: '', cls: 'actions', render: (r) => `
            <button class="btn btn-sm" data-editstaff="${r.EmployeeID}">编辑</button>
            <button class="btn btn-sm" data-pwd="${r.EmployeeID}">重置密码</button>` },
        ],
        rows: res.items,
      })}`;
    $('[data-newstaff]', body).addEventListener('click', () => openStaffForm(null, null));
    on(body, 'click', '[data-editstaff]', (e, btn) => {
      const row = res.items.find((x) => String(x.EmployeeID) === btn.dataset.editstaff);
      openStaffForm(row, null);
    });
    on(body, 'click', '[data-pwd]', (e, btn) => {
      modal({
        title: '重置密码', content: `<div class="field"><label>新密码（至少 6 位）</label>
          <input class="input" name="password" type="text" value="123456"></div>`,
        onSubmit: async (v) => {
          const r2 = await api.post(`/api/employees/${btn.dataset.pwd}/password`, { password: v.password });
          toast(r2.message, 'ok');
        },
      });
    });
  }

  function openStaffForm(row, suppliers) {
    const isNew = !row;
    modal({
      title: isNew ? '新增员工' : '编辑员工 · ' + row.Name,
      desc: '供货商业务员账号只能查看本公司订货单与对账单',
      content: `<div class="form-grid">
          <div class="field"><label>姓名<span class="req">*</span></label><input class="input" name="name" value="${esc(row ? row.Name : '')}"></div>
          <div class="field"><label>角色<span class="req">*</span></label>
            <select class="select" name="role">${(state.options.roles || []).map((r) =>
              `<option value="${r.value}" ${row && row.Role === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}</select></div>
          ${isNew ? `<div class="field"><label>登录名<span class="req">*</span></label><input class="input" name="loginName"></div>
          <div class="field"><label>初始密码<span class="req">*</span></label><input class="input" name="password" value="123456"></div>` : ''}
          <div class="field"><label>联系电话</label><input class="input" name="phone" value="${esc(row ? row.Phone || '' : '')}"></div>
          <div class="field"><label>所属供应商（供货商角色必填）</label>
            <select class="select" name="supplierId">
              <option value="">不适用</option>
              ${(state.options.suppliers || []).map((s) => `<option value="${s.SupplierID}" ${row && row.SupplierID === s.SupplierID ? 'selected' : ''}>${esc(s.Name)}</option>`).join('')}
            </select></div>
        </div>`,
      onSubmit: async (v) => {
        if (isNew) {
          const r2 = await api.post('/api/employees', {
            name: v.name, role: v.role, loginName: v.loginName, password: v.password,
            phone: v.phone, supplierId: v.supplierId ? Number(v.supplierId) : null,
          });
          toast(r2.message, 'ok');
        } else {
          const r2 = await api.put('/api/employees/' + row.EmployeeID, {
            name: v.name, role: v.role, phone: v.phone,
            supplierId: v.supplierId ? Number(v.supplierId) : null,
          });
          toast(r2.message, 'ok');
        }
        route();
      },
    });
  }

  async function renderAudit() {
    body.innerHTML = `
      <div class="row mb12">
        <input class="input search" data-q placeholder="搜索操作、对象或操作人">
        <span class="tag plain" data-count></span>
      </div>
      <div data-list>${loadingBlock()}</div>`;
    const list = $('[data-list]', body);
    let page = 1;
    let q = '';
    async function load() {
      list.innerHTML = loadingBlock();
      const res = await api.get('/api/audit-logs', { q, page, size: 30 });
      $('[data-count]', body).textContent = `共 ${res.total} 条留痕`;
      list.innerHTML = table({
        columns: [
          { label: '时间', render: (r) => fmt.datetime(r.CreatedAt) },
          { label: '操作人', render: (r) => `<b>${esc(r.EmployeeName || '匿名')}</b><div class="sub">${esc(r.Role || '')}</div>` },
          { label: '操作', render: (r) => esc(r.Action) },
          { label: '对象', render: (r) => `<span class="mono">${esc(r.Entity || '')}${r.EntityID ? '#' + esc(r.EntityID) : ''}</span>` },
          { label: '详情', render: (r) => `<span class="sub">${esc(r.Detail || '')}</span>` },
          { label: 'IP', render: (r) => `<span class="mono small">${esc(r.IP || '')}</span>` },
        ],
        rows: res.items,
        empty: '没有留痕记录',
      }) + pager({ page: res.page, size: res.size, total: res.total });
      bindPager(list, (p) => { page = p; load(); });
    }
    $('[data-q]', body).addEventListener('input', (e) => {
      q = e.target.value.trim();
      clearTimeout(window.__auditT);
      window.__auditT = setTimeout(() => { page = 1; load(); }, 320);
    });
    await load();
  }

  await route();
}
