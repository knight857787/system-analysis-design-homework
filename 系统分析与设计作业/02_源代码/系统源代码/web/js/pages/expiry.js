/* 临期商品处理（UC-01）、报损（UC-06）、退货（UC-07） */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock, stat,
  modal, confirmBox, drawer, stat as statCard,
} from '../core.js';

const TABS = [
  { key: 'warnings', label: '临期预警' },
  { key: 'handling', label: '处理单' },
  { key: 'plans', label: '折价方案' },
  { key: 'loss', label: '报损单' },
  { key: 'returns', label: '退货记录' },
];

export async function render(view, ctx) {
  const canSeeMoney = ((state.user || {}).role === 'Owner');
  const isOwner = ctx.user.role === 'Owner';
  let tab = ctx.query.tab || 'warnings';
  view.innerHTML = `
    <div class="card mb12">
      <div class="toolbar">
        <div class="seg" data-tabs>
          ${TABS.map((t) => `<button data-tab="${t.key}" class="${t.key === tab ? 'active' : ''}">${t.label}</button>`).join('')}
        </div>
        <div class="spacer"></div>
        <span class="tag plain">剩余效期不足总保质期 1/3 进入预警（按品类可调，最长 30 天）</span>
      </div>
      <div class="card-body" data-body>${loadingBlock()}</div>
    </div>`;

  const body = $('[data-body]', view);
  $$('[data-tabs] button', view).forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $$('[data-tabs] button', view).forEach((x) => x.classList.toggle('active', x === b));
    route();
  }));
  const go = (k) => { tab = k; $$('[data-tabs] button', view).forEach((x) => x.classList.toggle('active', x.dataset.tab === k)); route(); };

  async function route() {
    body.innerHTML = loadingBlock();
    if (tab === 'warnings') return renderWarnings();
    if (tab === 'handling') return renderHandling();
    if (tab === 'plans') return renderPlans();
    if (tab === 'loss') return renderLoss();
    return renderReturns();
  }

  /* ------------------------------------------------------------ 临期预警 */
  let selected = new Set();
  async function renderWarnings() {
    const res = await api.get('/api/expiry/warnings');
    const s = res.summary;
    body.innerHTML = `
      <div class="grid grid-4 mb12">
        ${statCard({ label: '预警总数', value: s.total, unit: '项', iconName: 'clock',
          sub: canSeeMoney ? `库存金额 ${fmt.yuan(s.value)}` : '按批次统计' })}
        ${statCard({ label: '已过期', value: s.expired, unit: '项', tone: 'danger', iconName: 'alert',
          sub: '必须下架报损，不得继续陈列销售' })}
        ${statCard({ label: '今日到期', value: s.urgent, unit: '项', tone: 'warn', iconName: 'flag',
          sub: '建议当日折价处理' })}
        ${statCard({ label: '今日处理单', value: res.todayHandling, unit: '张', tone: 'info', iconName: 'clipboard',
          sub: '按清单挑货，扫码确认' })}
      </div>
      <div class="row mb12">
        <div class="alert info" style="display:block;flex:1">
          <b>业务规则</b>：已过保质期的商品必须下架报损；折价按梯度执行（例如 18:00 八折、19:00 七折、20:00 六折），每一轮降价须经老板确认；处理方式为退货的商品须符合合同约定比例。
        </div>
      </div>
      <div class="row mb12">
        <span class="muted">已选 <b data-sel>0</b> 项</span>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-select-all>全选临期</button>
        <button class="btn btn-sm btn-primary" data-create disabled>${icon('plus')} 生成处理单</button>
      </div>
      ${table({
        columns: [
          { label: '', width: '34px', render: (r) => `<input type="checkbox" data-pick="${r.BatchID}" data-pid="${r.ProductID}" ${selected.has(r.BatchID) ? 'checked' : ''}>` },
          { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">${esc(r.Specification || '')} · ${esc(r.Barcode)}</div>` },
          { label: '品类', render: (r) => esc(r.CategoryName) },
          { label: '批次 / 生产日期', render: (r) => `<span class="mono">${esc(r.BatchNo || '')}</span><div class="sub">${fmt.date(r.ProductionDate)} → ${fmt.date(r.ExpiryDate)}</div>` },
          { label: '剩余效期', render: (r) => tag(r.levelLabel, r.level === 'expired' ? 'danger' : r.level === 'urgent' ? 'warn' : 'info') + ` <span class="tiny muted">${fmt.days(r.RemainDays)}</span>` },
          { label: '现存', cls: 'num', render: (r) => fmt.qty(r.Quantity) + ' ' + esc(r.Unit) },
          { label: '库位', render: (r) => esc(r.Location || '—') },
          ...(canSeeMoney ? [{ label: '库存成本', cls: 'num', render: (r) => fmt.yuan(r.stockValue) }] : []),
          { label: '建议', render: (r) => r.level === 'expired' ? tag('下架报损', 'danger') : tag('折价 / 退货', 'warn') },
        ],
        rows: res.items,
        rowClass: (r) => r.level === 'expired' ? 'danger-row' : r.level === 'urgent' ? 'warn-row' : '',
        empty: '今日没有临期商品，账实与效期台账正常',
      })}`;

    const updateSel = () => {
      $('[data-sel]', body).textContent = selected.size;
      $('[data-create]', body).disabled = selected.size === 0;
      $$('[data-pick]', body).forEach((cb) => { cb.checked = selected.has(Number(cb.dataset.pick)); });
    };
    on(body, 'change', '[data-pick]', (e, cb) => {
      const k = Number(cb.dataset.pick);
      if (cb.checked) selected.add(k); else selected.delete(k);
      updateSel();
    });
    $('[data-select-all]', body).addEventListener('click', () => {
      res.items.filter((i) => i.level !== 'expired').forEach((i) => selected.add(i.BatchID));
      updateSel();
    });
    $('[data-create]', body).addEventListener('click', async () => {
      const chosen = res.items.filter((i) => selected.has(i.BatchID));
      const rowsHtml = chosen.map((i, idx) => `
        <tr>
          <td>${esc(i.ProductName)}<div class="sub">${esc(i.Specification || '')}</div></td>
          <td>${fmt.qty(i.Quantity)} ${esc(i.Unit)}</td>
          <td><input class="input" name="qty_${idx}" value="${fmt.qty(Math.min(i.Quantity, Math.max(0.5, i.Quantity * 0.5)), 3)}" style="height:30px"></td>
          <td><select class="select" name="type_${idx}" style="height:30px">
            <option value="Markdown">折价出售</option>
            <option value="Return">退回供货商</option>
            <option value="Loss">转报损</option>
          </select></td>
        </tr>`).join('');
      modal({
        title: '生成临期处理单',
        desc: '挑出结果会生成处理单；折价方案自动按折价规则计算，须老板确认后才可执行',
        size: 'wide', submitText: '生成处理单',
        content: `<div class="table-wrap"><table class="table compact">
            <thead><tr><th>商品</th><th>现存</th><th>挑出数量</th><th>处理方式</th></tr></thead>
            <tbody>${rowsHtml}</tbody></table></div>`,
        onSubmit: async () => {
          const lines = chosen.map((i, idx) => ({
            productId: i.ProductID,
            batchId: i.BatchID,
            pickedQty: Number(document.querySelector(`[name=qty_${idx}]`).value),
            handlingType: document.querySelector(`[name=type_${idx}]`).value,
          }));
          const res2 = await api.post('/api/expiry/handling', { lines, note: '按当日临期预警清单挑货' });
          toast(res2.message, 'ok');
          selected.clear();
          go('handling');
        },
      });
    });
  }

  /* ------------------------------------------------------------ 处理单 */
  async function renderHandling() {
    const res = await api.get('/api/expiry/handling', { size: 30 });
    body.innerHTML = table({
      columns: [
        { label: '处理单号', render: (r) => `<span class="mono">${esc(r.HandlingNo)}</span>` },
        { label: '处理时间', render: (r) => fmt.datetime(r.HandledAt) },
        { label: '处理人', render: (r) => esc(r.HandlerName || '') },
        { label: '行数', cls: 'num', render: (r) => r.LineCount },
        { label: '折价方案', cls: 'num', render: (r) => r.MarkdownPlanCount || 0 },
        { label: '待确认', cls: 'num', render: (r) => r.PendingPlans ? tag(r.PendingPlans + ' 条', 'warn') : '—' },
        { label: '状态', render: (r) => tag({ Draft: '草稿', WaitingApproval: '待老板确认', Completed: '已完成' }[r.Status] || r.Status,
          r.Status === 'Completed' ? 'ok' : r.Status === 'WaitingApproval' ? 'warn' : 'plain') },
        { label: '', cls: 'actions', render: (r) => `<button class="btn btn-sm" data-detail="${r.HandlingID}">查看处理</button>` },
      ],
      rows: res.items,
      empty: '还没有处理单，请从「临期预警」生成',
    });
    on(body, 'click', '[data-detail]', async (e, btn) => {
      const d = await api.get('/api/expiry/handling/' + btn.dataset.detail);
      const dEl = drawer({
        title: '临期处理单 ' + d.handling.HandlingNo,
        subtitle: `${fmt.datetime(d.handling.HandledAt)} · 处理人 ${esc(d.handling.HandlerName || '')} · ${esc(d.handling.Status)}`,
        body: `
          <div class="section-title">处理明细</div>
          ${table({
            compact: true,
            columns: [
              { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">批次 ${esc(r.BatchNo)} · 到期 ${fmt.date(r.ExpiryDate)}</div>` },
              { label: '挑出', cls: 'num', render: (r) => fmt.qty(r.PickedQty) + ' ' + esc(r.Unit) },
              { label: '方式', render: (r) => tag({ Markdown: '折价', Return: '退货', Loss: '报损' }[r.HandlingType], 'plain') },
              { label: '结果', render: (r) => r.Result ? `<span class="tag ok">${esc(r.Result)}</span>` : '<span class="muted">待执行</span>' },
              { label: '', cls: 'actions', render: (r) => r.Result ? '' : `<button class="btn btn-sm" data-exec="${r.LineNo}">执行</button>` },
            ],
            rows: d.lines,
          })}
          <div class="section-title">折价方案</div>
          ${d.plans.length ? table({
            compact: true,
            columns: [
              { label: '行', render: (r) => '#' + r.LineNo },
              { label: '折价时点', render: (r) => fmt.datetime(r.MarkdownTime) },
              { label: '折扣', cls: 'num', render: (r) => (r.DiscountRate * 10).toFixed(1) + ' 折' },
              { label: '折后价', cls: 'num', render: (r) => fmt.yuan(r.MarkdownPrice) },
              { label: '状态', render: (r) => tag({ Pending: '待确认', Confirmed: '已确认', Rejected: '已驳回' }[r.PlanStatus], r.PlanStatus === 'Confirmed' ? 'ok' : r.PlanStatus === 'Rejected' ? 'danger' : 'warn') },
              { label: '确认人', render: (r) => esc(r.ConfirmerName || '—') },
            ],
            rows: d.plans,
          }) : '<div class="muted small">本单没有折价方案</div>'}
          <div class="alert info mt16" style="display:block">
            执行「折价」只更新价签状态；执行「退货」会生成退货单并扣减库存；执行「报损」生成待确认的报损单，须老板确认后才入账。
          </div>`,
      });
      dEl.body.querySelectorAll('[data-exec]').forEach((b) => b.addEventListener('click', async () => {
        try {
          const r2 = await api.post(`/api/expiry/handling/${d.handling.HandlingID}/execute`, { lineNo: Number(b.dataset.exec) });
          toast(r2.message, 'ok');
          dEl.close();
          go('handling');
        } catch (err) { toast(err.message, 'error', 5000); }
      }));
    });
  }

  /* ------------------------------------------------------------ 折价方案 */
  async function renderPlans() {
    const res = await api.get('/api/expiry/markdown-plans');
    body.innerHTML = `
      <div class="alert ${isOwner ? 'warn' : 'info'} mb12" style="display:block">
        <b>${isOwner ? '待您确认的方案' : '折价确认权限'}</b>：每一轮降价必须经老板确认后才可执行；
        当前待确认 <b>${res.pending}</b> 条。${isOwner ? '' : '您只能查看，确认操作请转老板账号。'}
      </div>
      ${table({
        columns: [
          { label: '处理单 / 行', render: (r) => `<span class="mono">${esc(r.HandlingNo)}</span><div class="sub">第 ${r.LineNo} 行</div>` },
          { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">${esc(r.CategoryName)} · 批次 ${esc(r.BatchNo || '')}</div>` },
          { label: '剩余效期', render: (r) => tag(fmt.days(r.RemainDays), r.RemainDays < 0 ? 'danger' : 'warn') },
          { label: '原价', cls: 'num', render: (r) => fmt.yuan(r.ListPrice) },
          { label: '折扣', cls: 'num', render: (r) => (r.DiscountRate * 10).toFixed(1) + ' 折' },
          { label: '折后价', cls: 'num strong', render: (r) => fmt.yuan(r.MarkdownPrice) },
          { label: '折价时点', render: (r) => fmt.datetime(r.MarkdownTime) },
          { label: '状态', render: (r) => tag({ Pending: '待确认', Confirmed: '已确认', Rejected: '已驳回' }[r.PlanStatus], r.PlanStatus === 'Confirmed' ? 'ok' : r.PlanStatus === 'Rejected' ? 'danger' : 'warn') },
          { label: '确认人', render: (r) => esc(r.ConfirmerName || '—') },
          { label: '', cls: 'actions', render: (r) => (isOwner && r.PlanStatus === 'Pending')
            ? `<button class="btn btn-sm btn-primary" data-ok="${r.PlanID}">确认</button>
               <button class="btn btn-sm btn-danger" data-no="${r.PlanID}">驳回</button>` : '' },
        ],
        rows: res.items,
        empty: '没有折价方案',
      })}`;
    on(body, 'click', '[data-ok]', async (e, btn) => {
      const ok = await confirmBox({
        title: '确认折价方案', confirmText: '确认执行',
        message: '确认后该方案可被执行（价签更新为折后价）。请确认折扣梯度符合当日经营策略。',
      });
      if (!ok) return;
      try {
        const r2 = await api.post(`/api/expiry/markdown-plans/${btn.dataset.ok}/decision`, { decision: 'confirm' });
        toast(r2.message, 'ok'); route();
      } catch (err) { toast(err.message, 'error', 5000); }
    });
    on(body, 'click', '[data-no]', async (e, btn) => {
      try {
        const r2 = await api.post(`/api/expiry/markdown-plans/${btn.dataset.no}/decision`, { decision: 'reject' });
        toast(r2.message, 'warn'); route();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ------------------------------------------------------------ 报损单 */
  async function renderLoss() {
    const res = await api.get('/api/expiry/loss-reports');
    const s = res.summary;
    body.innerHTML = `
      <div class="grid grid-4 mb12">
        ${statCard({ label: '待确认报损', value: s.pending, unit: '单', tone: 'warn', iconName: 'alert', sub: '老板确认后才入账' })}
        ${statCard({ label: '已确认（30 天）', value: s.confirmed30, unit: '单', iconName: 'check', sub: '每笔损耗都有单据' })}
        ${canSeeMoney ? statCard({ label: '损耗金额（30 天）', value: fmt.yuan(s.amount30, 0), tone: 'danger', iconName: 'chart', sub: '归集到损耗率口径' }) : ''}
        ${statCard({ label: '报损原因', value: '5', unit: '类', tone: 'info', iconName: 'flag', sub: '过期 / 破损 / 变质 / 挑出 / 断电' })}
      </div>
      <div class="row mb12">
        <span class="tag plain">单据只作废不物理删除；报损必须经老板确认后方可入账</span>
        <div class="spacer"></div>
        <button class="btn btn-sm btn-primary" data-new>${icon('plus')} 登记报损</button>
      </div>
      ${table({
        columns: [
          { label: '报损单号', render: (r) => `<span class="mono">${esc(r.LossNo)}</span>` },
          { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">批次 ${esc(r.BatchNo)} · 到期 ${fmt.date(r.ExpiryDate)}</div>` },
          { label: '数量', cls: 'num', render: (r) => fmt.qty(r.Quantity) + ' ' + esc(r.Unit) },
          ...(canSeeMoney ? [{ label: '金额', cls: 'num', render: (r) => fmt.yuan(r.Amount) }] : []),
          { label: '原因', render: (r) => esc(r.Reason) },
          { label: '登记', render: (r) => esc(r.RegisterName || '') + `<div class="sub">${fmt.datetime(r.RegisteredAt)}</div>` },
          { label: '状态', render: (r) => tag(r.Status === 'Confirmed' ? '已入账' : r.Status === 'Rejected' ? '已驳回' : '待确认', r.Status === 'Confirmed' ? 'ok' : r.Status === 'Rejected' ? 'danger' : 'warn') },
          { label: '确认人', render: (r) => esc(r.ConfirmerName || '—') },
          { label: '', cls: 'actions', render: (r) => (isOwner && r.Status === 'Pending')
            ? `<button class="btn btn-sm btn-primary" data-confirm="${r.LossID}">确认入账</button>
               <button class="btn btn-sm" data-reject="${r.LossID}">驳回</button>` : '' },
        ],
        rows: res.items,
        empty: '暂无报损单',
      })}`;

    $('[data-new]', body).addEventListener('click', async () => {
      const warns = await api.get('/api/expiry/warnings');
      modal({
        title: '登记报损', desc: '报损登记后生成待确认单据，老板确认后才扣减库存并计入损耗',
        content: `<div class="form-grid">
            <div class="field full"><label>批次（临期或已过期）<span class="req">*</span></label>
              <select class="select" name="batch">${warns.items.map((w) =>
                `<option value="${w.BatchID}|${w.ProductID}">${esc(w.ProductName)} · 批次 ${esc(w.BatchNo || '')} · 现存 ${fmt.qty(w.Quantity)} ${esc(w.Unit)}</option>`).join('')}
              </select></div>
            <div class="field"><label>报损数量<span class="req">*</span></label><input class="input" name="quantity" value="1"></div>
            <div class="field"><label>报损原因<span class="req">*</span></label>
              <select class="select" name="reason">
                <option>超过保质期下架</option><option>包装破损</option><option>生鲜挑出品质不佳</option>
                <option>冷柜断电变质</option><option>运输挤压变形</option>
              </select></div>
          </div>`,
        onSubmit: async () => {
          const sel = document.querySelector('[name=batch]').value.split('|');
          await api.post('/api/expiry/loss-reports', {
            batchId: Number(sel[0]), productId: Number(sel[1]),
            quantity: Number(document.querySelector('[name=quantity]').value),
            reason: document.querySelector('[name=reason]').value,
          });
          toast('报损单已登记，待老板确认入账', 'ok');
          route();
        },
      });
    });
    on(body, 'click', '[data-confirm]', async (e, btn) => {
      try {
        const r2 = await api.post(`/api/expiry/loss-reports/${btn.dataset.confirm}/confirm`, { decision: 'confirm' });
        toast(r2.message, 'ok'); route();
      } catch (err) { toast(err.message, 'error', 5000); }
    });
    on(body, 'click', '[data-reject]', async (e, btn) => {
      try {
        await api.post(`/api/expiry/loss-reports/${btn.dataset.reject}/confirm`, { decision: 'reject' });
        toast('报损单已驳回', 'warn'); route();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ------------------------------------------------------------ 退货 */
  async function renderReturns() {
    const res = await api.get('/api/expiry/returns');
    body.innerHTML = table({
      columns: [
        { label: '退货单号', render: (r) => `<span class="mono">${esc(r.ReturnNo)}</span>` },
        { label: '供应商', render: (r) => esc(r.SupplierName) },
        { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">批次 ${esc(r.BatchNo || '—')}</div>` },
        { label: '数量', cls: 'num', render: (r) => fmt.qty(r.Quantity) + ' ' + esc(r.Unit) },
        { label: '单价', cls: 'num', render: (r) => fmt.yuan(r.UnitPrice) },
        { label: '金额', cls: 'num strong', render: (r) => fmt.yuan(r.Amount) },
        { label: '原因', render: (r) => esc(r.Reason || '—') },
        { label: '退货时间', render: (r) => fmt.date(r.ReturnedAt) },
        { label: '状态', render: (r) => tag(r.Status === 'Confirmed' ? '已确认' : r.Status, 'ok') },
      ],
      rows: res.items,
      empty: '暂无退货记录',
    });
  }

  await route();
}
