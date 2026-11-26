/* 订货（UC-04）与在途 */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock, stat,
  modal, drawer, confirmBox, debounce, stat as statCard,
} from '../core.js';

const STATUS = {
  Submitted: { label: '待供货商确认', tone: 'warn' },
  Confirmed: { label: '已接单在途', tone: 'info' },
  Partial: { label: '部分收货', tone: 'warn' },
  Received: { label: '已收货', tone: 'ok' },
  Cancelled: { label: '已作废', tone: 'danger' },
};

export async function render(view, ctx) {
  const options = state.options;
  const isSupplier = ctx.user.role === 'Supplier';
  let tab = ctx.query.tab || (isSupplier ? 'orders' : 'suggest');
  let supplierId = isSupplier ? String(ctx.user.supplierId || '') : '';
  let keyword = '';
  const chosen = new Map();

  view.innerHTML = `
    <div class="card">
      <div class="toolbar">
        ${isSupplier ? '' : `<div class="seg" data-tabs>
          <button data-tab="suggest" class="${tab === 'suggest' ? 'active' : ''}">补货建议</button>
          <button data-tab="orders" class="${tab === 'orders' ? 'active' : ''}">订货单</button>
        </div>`}
        <input class="input search" data-q placeholder="搜索商品名称">
        <select class="select" data-supplier>
          <option value="">全部供应商</option>
          ${(options.suppliers || []).map((s) => `<option value="${s.SupplierID}" ${String(s.SupplierID) === supplierId ? 'selected' : ''}>${esc(s.Name)}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <span class="tag plain" data-info></span>
      </div>
      <div class="card-body" data-body>${loadingBlock()}</div>
    </div>`;

  const body = $('[data-body]', view);
  $$('[data-tabs] button', view).forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $$('[data-tabs] button', view).forEach((x) => x.classList.toggle('active', x === b));
    route();
  }));
  $('[data-supplier]', view).addEventListener('change', (e) => { supplierId = e.target.value; chosen.clear(); route(); });
  $('[data-q]', view).addEventListener('input', debounce((e) => { keyword = e.target.value.trim(); if (tab === 'suggest') route(); }, 320));

  async function route() {
    body.innerHTML = loadingBlock();
    if (tab === 'suggest' && !isSupplier) return renderSuggest();
    return renderOrders();
  }

  /* ------------------------------------------------------------ 补货建议 */
  async function renderSuggest() {
    const res = await api.get('/api/purchase/suggestions', { supplierId, q: keyword });
    const items = res.items;
    const urgent = items.filter((i) => i.urgent).length;
    const totalSuggested = items.reduce((s, i) => s + (i.suggestedQty || 0), 0);
    $('[data-info]', view).textContent = `${items.length} 个商品 · 建议订货 ${totalSuggested} 件`;

    body.innerHTML = `
      <div class="grid grid-4 mb12">
        ${statCard({ label: '建议补货商品', value: items.filter((i) => i.suggestedQty > 0).length, unit: '个', iconName: 'cart',
          sub: `共建议 ${totalSuggested} 件` })}
        ${statCard({ label: '缺货风险', value: urgent, unit: '个', tone: urgent ? 'warn' : '', iconName: 'alert',
          sub: '可用天数低于目标覆盖天数' })}
        ${statCard({ label: '在途数量', value: fmt.int(items.reduce((s, i) => s + (i.inTransit || 0), 0)), unit: '件',
          tone: 'info', iconName: 'truck', sub: '已提交未收货，不重复订' })}
        ${statCard({ label: '计算口径', value: '30', unit: '天', tone: 'violet', iconName: 'chart',
          sub: '近 30 日销量 ÷ 30 × 覆盖天数 − 库存 − 在途' })}
      </div>
      <div class="row mb12">
        <span class="muted">已选 <b data-sel>0</b> 个商品</span>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-auto>勾选全部建议量 &gt; 0</button>
        <button class="btn btn-sm btn-primary" data-create disabled>${icon('plus')} 生成订货单</button>
      </div>
      ${table({
        columns: [
          { label: '', width: '34px', render: (r) => `<input type="checkbox" data-pick="${r.productId}" ${chosen.has(r.productId) ? 'checked' : ''} ${r.suggestedQty ? '' : 'disabled'}>` },
          { label: '商品', render: (r) => `<div class="strong">${esc(r.productName)}</div><div class="sub">${esc(r.categoryName)} · ${esc(r.specification || '')}</div>` },
          { label: '供应商', render: (r) => esc(r.supplierName || '—') },
          { label: '现存', cls: 'num', render: (r) => fmt.qty(r.stockQty) + ' ' + esc(r.unit) },
          { label: '近30日销量', cls: 'num', render: (r) => fmt.qty(r.sold30) },
          { label: '日均', cls: 'num', render: (r) => fmt.qty(r.daily, 2) },
          { label: '可用天数', cls: 'num', render: (r) => r.coverDays === null ? '—'
            : `<span class="${r.coverDays < r.targetCover ? 'tag warn' : ''}">${r.coverDays} 天</span>` },
          { label: '在途', cls: 'num', render: (r) => fmt.qty(r.inTransit) },
          { label: '建议订货', cls: 'num', render: (r) => r.suggestedQty
            ? `<input class="editable" data-qty="${r.productId}" value="${r.suggestedQty}">` : '<span class="muted">充足</span>' },
          { label: '单价', cls: 'num', render: (r) => fmt.yuan(r.lastCost) },
        ],
        rows: items,
        rowClass: (r) => (r.urgent ? 'warn-row' : ''),
        empty: '没有需要补货的商品（或该供应商下暂无商品）',
      })}`;

    const updateSel = () => {
      $('[data-sel]', body).textContent = chosen.size;
      $('[data-create]', body).disabled = chosen.size === 0;
    };
    on(body, 'change', '[data-pick]', (e, cb) => {
      const pid = Number(cb.dataset.pick);
      if (cb.checked) {
        const item = items.find((i) => i.productId === pid);
        const qtyInput = body.querySelector(`[data-qty="${pid}"]`);
        chosen.set(pid, {
          productId: pid, supplierId: item.supplierId, name: item.productName,
          quantity: Number(qtyInput ? qtyInput.value : item.suggestedQty), price: item.lastCost,
        });
      } else chosen.delete(pid);
      updateSel();
    });
    on(body, 'change', '[data-qty]', (e, input) => {
      const pid = Number(input.dataset.qty);
      if (chosen.has(pid)) chosen.get(pid).quantity = Number(input.value);
    });
    $('[data-auto]', body).addEventListener('click', () => {
      items.filter((i) => i.suggestedQty > 0).forEach((i) => {
        chosen.set(i.productId, {
          productId: i.productId, supplierId: i.supplierId, name: i.productName,
          quantity: Number(body.querySelector(`[data-qty="${i.productId}"]`)?.value || i.suggestedQty),
          price: i.lastCost,
        });
      });
      updateSel();
      $$('[data-pick]', body).forEach((cb) => { cb.checked = chosen.has(Number(cb.dataset.pick)); });
    });
    $('[data-create]', body).addEventListener('click', () => {
      const list = Array.from(chosen.values());
      const first = list[0];
      const supplier = (options.suppliers || []).find((s) => s.SupplierID === first.supplierId);
      modal({
        title: '生成订货单',
        desc: '订货量必须参考库存与销售数据；同一商品同一到货日只允许一张有效订货单',
        size: 'wide', submitText: '提交订货单',
        content: `
          <div class="form-grid mb12">
            <div class="field"><label>供应商<span class="req">*</span></label>
              <input class="input" value="${esc(supplier ? supplier.Name : '')}" readonly></div>
            <div class="field"><label>预计到货日期<span class="req">*</span></label>
              <input class="input" type="date" name="expectedArrivalDate" value="${fmt.dateOffset(supplier ? (supplier.PaymentTermDays ? 2 : 2) : 2)}"></div>
            <div class="field full"><label>备注</label><input class="input" name="note" placeholder="例如：系统建议量，老板已确认"></div>
          </div>
          <div class="table-wrap"><table class="table compact">
            <thead><tr><th>商品</th><th class="num">数量</th><th class="num">单价</th><th class="num">金额</th></tr></thead>
            <tbody>${list.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${i.quantity}</td>
              <td class="num">${fmt.yuan(i.price)}</td><td class="num">${fmt.yuan(i.price * i.quantity)}</td></tr>`).join('')}</tbody>
            <tfoot><tr class="total-row"><td>合计</td><td></td><td></td>
              <td class="num">${fmt.yuan(list.reduce((s, i) => s + i.price * i.quantity, 0))}</td></tr></tfoot>
          </table></div>`,
        onSubmit: async (v) => {
          if (!first.supplierId) throw new Error('请先选择供应商');
          const r2 = await api.post('/api/purchase-orders', {
            supplierId: first.supplierId,
            expectedArrivalDate: v.expectedArrivalDate,
            note: v.note,
            lines: list.map((i) => ({ productId: i.productId, quantity: i.quantity, agreedPrice: i.price })),
          });
          toast(r2.message, 'ok', 4200);
          chosen.clear();
          tab = 'orders';
          route();
        },
      });
    });
  }

  /* ------------------------------------------------------------ 订货单 */
  async function renderOrders() {
    const res = await api.get('/api/purchase-orders', { supplierId, size: 30 });
    const rows = res.items;
    body.innerHTML = `
      ${table({
        columns: [
          { label: '订货单号', render: (r) => `<span class="mono">${esc(r.OrderNo)}</span>` },
          { label: '供应商', render: (r) => esc(r.SupplierName) },
          { label: '提交时间', render: (r) => fmt.datetime(r.SubmittedAt) },
          { label: '预计到货', render: (r) => fmt.date(r.ExpectedArrivalDate) },
          { label: '行数', cls: 'num', render: (r) => r.LineCount },
          { label: '金额', cls: 'num strong', render: (r) => fmt.yuan(r.TotalAmount) },
          { label: '状态', render: (r) => tag((STATUS[r.OrderStatus] || {}).label || r.OrderStatus, (STATUS[r.OrderStatus] || {}).tone) },
          { label: '', cls: 'actions', render: (r) => `
            <button class="btn btn-sm" data-detail="${r.OrderID}">明细</button>
            ${r.OrderStatus === 'Submitted' && isSupplier ? `<button class="btn btn-sm btn-primary" data-confirm="${r.OrderID}">接单</button>` : ''}
            ${r.OrderStatus === 'Submitted' && ctx.user.role === 'Owner' ? `<button class="btn btn-sm btn-danger" data-cancel="${r.OrderID}">作废</button>` : ''}
            ${r.OrderStatus === 'Confirmed' && ctx.user.role !== 'Supplier' ? `<a class="btn btn-sm btn-primary" href="#/receipts">去收货</a>` : ''}
          ` },
        ],
        rows,
        empty: '还没有订货单',
      })}
      ${res.total > rows.length ? `<div class="pager"><span>仅显示最近 ${rows.length} 张（共 ${res.total} 张）</span></div>` : ''}`;

    on(body, 'click', '[data-detail]', async (e, btn) => {
      const d = await api.get('/api/purchase-orders/' + btn.dataset.detail);
      drawer({
        title: '订货单 ' + d.order.OrderNo,
        subtitle: `${esc(d.order.SupplierName)} · ${fmt.datetime(d.order.SubmittedAt)} · ${(STATUS[d.order.OrderStatus] || {}).label || d.order.OrderStatus}`,
        body: `
          <dl class="kv kv-sm">
            <dt>预计到货</dt><dd>${fmt.date(d.order.ExpectedArrivalDate)}</dd>
            <dt>提交人</dt><dd>${esc(d.order.SubmittedByName || '')}</dd>
            <dt>订货金额</dt><dd><b>${fmt.yuan(d.order.TotalAmount)}</b></dd>
            <dt>客户端单号</dt><dd class="mono">${esc(d.order.ClientNo || '—')}</dd>
            <dt>备注</dt><dd>${esc(d.order.Note || '—')}</dd>
          </dl>
          <div class="section-title mt16">订货明细</div>
          ${table({
            compact: true,
            columns: [
              { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">${esc(r.Specification || '')}</div>` },
              { label: '数量', cls: 'num', render: (r) => fmt.qty(r.Quantity) + ' ' + esc(r.Unit) },
              { label: '单价', cls: 'num', render: (r) => fmt.yuan(r.AgreedPrice) },
              { label: '已收', cls: 'num', render: (r) => fmt.qty(r.ReceivedQty) },
              { label: '金额', cls: 'num', render: (r) => fmt.yuan(r.Amount) },
            ],
            rows: d.lines,
          })}
          <div class="alert info mt16" style="display:block">
            订货单只作废、不删除；发出后修改须留痕。供货商确认接单后状态变为「已接单在途」，收货完成自动变为「已收货」。
          </div>`,
      });
    });
    on(body, 'click', '[data-confirm]', async (e, btn) => {
      try {
        const r2 = await api.post(`/api/purchase-orders/${btn.dataset.confirm}/confirm`, { action: 'accept' });
        toast(r2.message, 'ok'); route();
      } catch (err) { toast(err.message, 'error', 5000); }
    });
    on(body, 'click', '[data-cancel]', async (e, btn) => {
      const ok = await confirmBox({ title: '作废订货单', message: '作废后订单状态变为「已作废」，在途数量释放。单据不会物理删除。', danger: true, confirmText: '作废' });
      if (!ok) return;
      try {
        const r2 = await api.post(`/api/purchase-orders/${btn.dataset.cancel}/cancel`, { reason: '老板作废' });
        toast(r2.message, 'warn'); route();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  await route();
}
