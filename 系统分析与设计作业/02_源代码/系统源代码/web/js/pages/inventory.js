/* 库存台账与库存流水 */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock,
  pager, bindPager, debounce, stat as statCard, drawer,
} from '../core.js';

export async function render(view, ctx) {
  const canSeeMoney = ((state.user || {}).role === 'Owner');
  const options = state.options;
  let tab = ctx.query.tab || 'ledger';
  let page = 1;
  let keyword = '';
  let categoryId = '';
  let expiringDays = '';

  view.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="seg" data-tabs>
          <button data-tab="ledger" class="${tab === 'ledger' ? 'active' : ''}">库存台账</button>
          <button data-tab="flow" class="${tab === 'flow' ? 'active' : ''}">库存流水</button>
          <button data-tab="overview" class="${tab === 'overview' ? 'active' : ''}">品类库存</button>
        </div>
        <div class="spacer"></div>
        <span class="tag plain">台账是余额，只由收货 / 报损 / 退货 / 销售 / 调账五类流水推动</span>
      </div>
      <div class="card-body" data-body>${loadingBlock()}</div>
    </div>`;

  const body = $('[data-body]', view);
  $$('[data-tabs] button', view).forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $$('[data-tabs] button', view).forEach((x) => x.classList.toggle('active', x === b));
    route();
  }));

  async function route() {
    body.innerHTML = loadingBlock();
    if (tab === 'flow') return renderFlow();
    if (tab === 'overview') return renderOverview();
    return renderLedger();
  }

  /* ------------------------------------------------------------ 台账 */
  async function renderLedger() {
    body.innerHTML = `
      <div class="toolbar" style="border:0;border-bottom:1px solid var(--line-2)">
        <input class="input search" data-q placeholder="商品名称 / 条码 / 批次号" value="${esc(keyword)}">
        <select class="select" data-cat>
          <option value="">全部品类</option>
          ${(options.categories || []).map((c) => `<option value="${c.CategoryID}" ${String(c.CategoryID) === categoryId ? 'selected' : ''}>${esc(c.CategoryName)}</option>`).join('')}
        </select>
        <select class="select" data-days>
          <option value="">全部效期</option>
          <option value="3" ${expiringDays === '3' ? 'selected' : ''}>3 天内到期</option>
          <option value="7" ${expiringDays === '7' ? 'selected' : ''}>7 天内到期</option>
          <option value="30" ${expiringDays === '30' ? 'selected' : ''}>30 天内到期</option>
        </select>
        <div class="spacer"></div>
        <span class="tag plain" data-summary></span>
      </div>
      <div data-table>${loadingBlock()}</div>`;
    const tableBox = $('[data-table]', body);
    $('[data-q]', body).addEventListener('input', debounce((e) => { keyword = e.target.value.trim(); page = 1; load(); }, 320));
    $('[data-cat]', body).addEventListener('change', (e) => { categoryId = e.target.value; page = 1; load(); });
    $('[data-days]', body).addEventListener('change', (e) => { expiringDays = e.target.value; page = 1; load(); });

    async function load() {
      tableBox.innerHTML = loadingBlock();
      const res = await api.get('/api/inventory', { q: keyword, categoryId, expiringDays, page, size: 20 });
      const s = res.summary;
      $('[data-summary]', body).textContent =
        `库存 ${fmt.qty(s.qty)} · 成本 ${fmt.yuan(s.value, 0)} · ${s.batches} 个批次`;
      tableBox.innerHTML = `
        <div class="grid grid-4" style="padding:14px 16px 0">
          ${statCard({ label: '库存数量', value: fmt.qty(s.qty), iconName: 'boxes', sub: `${s.batches} 个批次` })}
          ${canSeeMoney ? statCard({ label: '库存成本', value: fmt.yuan(s.value, 0), tone: 'info', iconName: 'wallet', sub: '按批次进价计' }) : ''}
          ${statCard({ label: '负库存', value: s.negative, unit: '条', tone: s.negative ? 'danger' : 'ok', iconName: 'alert', sub: '报告基线为 -4,849' })}
          ${statCard({ label: '30 天内到期', value: s.expiring30, unit: '个批次', tone: 'warn', iconName: 'clock', sub: '临期预警的来源' })}
        </div>
        <div style="padding:14px 0 0">
        ${table({
          columns: [
            { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">${esc(r.Specification || '')} · ${esc(r.Barcode)}</div>` },
            { label: '品类', render: (r) => tag(r.CategoryName, 'plain') },
            { label: '批次', render: (r) => `<span class="mono">${esc(r.BatchNo || '')}</span><div class="sub">到货 ${fmt.date(r.ArrivalDate)}</div>` },
            { label: '生产 / 到期', render: (r) => `${fmt.date(r.ProductionDate)}<div class="sub">→ ${fmt.date(r.ExpiryDate)}</div>` },
            { label: '剩余效期', render: (r) => tag(fmt.days(r.RemainDays), r.RemainDays < 0 ? 'danger' : r.RemainDays <= 3 ? 'warn' : 'ok') },
            { label: '现存', cls: 'num strong', render: (r) => fmt.qty(r.Quantity) + ' ' + esc(r.Unit) },
            { label: '已占用', cls: 'num', render: (r) => r.ReservedQty ? fmt.qty(r.ReservedQty) : '—' },
            ...(canSeeMoney ? [{ label: '进价', cls: 'num', render: (r) => fmt.yuan(r.PurchasePrice) }] : []),
            ...(canSeeMoney ? [{ label: '库存成本', cls: 'num', render: (r) => fmt.yuan(r.StockValue) }] : []),
            { label: '库位', render: (r) => esc(r.Location || '—') },
            { label: '供应商', render: (r) => esc(r.SupplierName || '—') },
          ],
          rows: res.items,
          rowClass: (r) => (r.RemainDays < 0 ? 'danger-row' : r.RemainDays <= 3 ? 'warn-row' : ''),
          empty: '没有库存记录',
        })}</div>
        ${pager({ page: res.page, size: res.size, total: res.total })}`;
      bindPager(tableBox, (p) => { page = p; load(); });
    }
    await load();
  }

  /* ------------------------------------------------------------ 流水 */
  async function renderFlow() {
    body.innerHTML = `
      <div class="toolbar" style="border:0;border-bottom:1px solid var(--line-2)">
        <select class="select" data-type>
          <option value="">全部类型</option>
          <option value="Receipt">收货入库</option>
          <option value="Sale">销售出库</option>
          <option value="Loss">报损出库</option>
          <option value="Return">退货出库</option>
          <option value="Adjust">盘点调账</option>
        </select>
        <input class="input" type="date" data-from style="width:150px">
        <span class="muted">至</span>
        <input class="input" type="date" data-to style="width:150px">
        <div class="spacer"></div>
        <span class="tag plain" data-count></span>
      </div>
      <div data-table>${loadingBlock()}</div>`;
    const tableBox = $('[data-table]', body);
    let flowPage = 1;
    const filters = { type: '', from: '', to: '' };
    async function load() {
      tableBox.innerHTML = loadingBlock();
      const res = await api.get('/api/inventory/movements', { ...filters, page: flowPage, size: 30 });
      $('[data-count]', body).textContent = `共 ${res.total} 条流水`;
      tableBox.innerHTML = table({
        columns: [
          { label: '时间', render: (r) => fmt.datetime(r.OccurredAt) },
          { label: '类型', render: (r) => tag(r.typeLabel, r.Quantity > 0 ? 'ok' : 'plain') },
          { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">批次 ${esc(r.BatchNo || '—')}</div>` },
          { label: '数量', cls: 'num', render: (r) => `<span class="${r.Quantity > 0 ? 'trend-up' : 'trend-down'}">${fmt.signed(r.Quantity)}</span> ${esc(r.Unit)}` },
          { label: '来源单据', render: (r) => `<span class="mono">${esc(r.RefNo || '—')}</span>` },
          { label: '操作人', render: (r) => esc(r.OperatorName || '系统') },
          { label: '备注', render: (r) => esc(r.Note || '') },
        ],
        rows: res.items,
        empty: '没有流水记录',
      }) + pager({ page: res.page, size: res.size, total: res.total });
      bindPager(tableBox, (p) => { flowPage = p; load(); });
    }
    $('[data-type]', body).addEventListener('change', (e) => { filters.type = e.target.value; flowPage = 1; load(); });
    $('[data-from]', body).addEventListener('change', (e) => { filters.from = e.target.value; flowPage = 1; load(); });
    $('[data-to]', body).addEventListener('change', (e) => { filters.to = e.target.value; flowPage = 1; load(); });
    await load();
  }

  /* ------------------------------------------------------------ 品类 */
  async function renderOverview() {
    const res = await api.get('/api/inventory/overview');
    const total = res.items.reduce((s, i) => s + (i.value || 0), 0);
    body.innerHTML = `
      <div class="grid grid-2">
        <div>${table({
          columns: [
            { label: '品类', render: (r) => `<b>${esc(r.name)}</b>` },
            { label: 'SKU', cls: 'num', render: (r) => r.skus },
            { label: '库存数量', cls: 'num', render: (r) => fmt.qty(r.qty) },
            ...(canSeeMoney ? [{ label: '库存成本', cls: 'num strong', render: (r) => fmt.yuan(r.value) }] : []),
            { label: '占比', render: (r) => `<div class="progress" style="width:90px"><i style="width:${total ? (r.value / total * 100).toFixed(1) : 0}%"></i></div>` },
          ],
          rows: res.items,
        })}</div>
        <div class="card" style="margin:0">
          <div class="card-head"><h3>库存结构</h3></div>
          <div class="card-body">
            ${res.items.map((r) => `
              <div class="bar-row" style="grid-template-columns:96px 1fr 92px">
                <span class="name">${esc(r.name)}</span>
                <span class="bar-track"><i class="bar-fill" style="width:${total ? (r.value / total * 100).toFixed(1) : 0}%"></i></span>
                <span class="val">${fmt.yuan(r.value, 0)}</span>
              </div>`).join('')}
            <div class="alert info mt16" style="display:block">
              库存周转 = 期间出库成本 ÷ 平均库存金额；当前库存成本 ${fmt.yuan(total, 0)}，
              近 30 天出库成本可在「经营分析」中查看。
            </div>
          </div>
        </div>
      </div>`;
  }

  await route();
}
