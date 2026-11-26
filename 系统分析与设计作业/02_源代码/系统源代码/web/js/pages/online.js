/* 线上到家订单（UC-11 提交 / UC-12 拣货与交付） */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock,
  modal, drawer, confirmBox, stat as statCard, debounce,
} from '../core.js';

const STATUS = {
  Pending: { label: '待拣货', tone: 'warn' },
  Picked: { label: '已拣货待交付', tone: 'info' },
  Completed: { label: '已完成', tone: 'ok' },
  Cancelled: { label: '已取消', tone: 'danger' },
};
const CHANNEL = { group: '微信群', miniProgram: '小程序', platform: '第三方平台' };

export async function render(view, ctx) {
  const options = state.options;
  let tab = ctx.query.tab || 'pending';

  view.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="seg" data-tabs>
          <button data-tab="pending" class="${tab === 'pending' ? 'active' : ''}">待拣货</button>
          <button data-tab="picked" class="${tab === 'picked' ? 'active' : ''}">待交付</button>
          <button data-tab="all" class="${tab === 'all' ? 'active' : ''}">全部订单</button>
        </div>
        <div class="spacer"></div>
        <span class="tag plain" data-info></span>
        <button class="btn btn-sm btn-primary" data-new>${icon('plus')} 代客下单</button>
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
    const status = tab === 'pending' ? 'Pending' : tab === 'picked' ? 'Picked' : '';
    const res = await api.get('/api/online-orders', { status, size: 40 });
    const s = res.summary || {};
    $('[data-info]', view).textContent = `待拣货 ${s.pending || 0} · 待交付 ${s.picked || 0} · 今日 ${s.today || 0} 单`;

    body.innerHTML = `
      ${tab === 'pending' ? `<div class="grid grid-3 mb12">
        ${statCard({ label: '待拣货', value: s.pending || 0, unit: '单', tone: 'warn', iconName: 'phone', sub: '订单推送到理货员不超过 5 秒' })}
        ${statCard({ label: '今日订单', value: s.today || 0, unit: '单', iconName: 'cash', sub: '目标日均 10 单' })}
        ${statCard({ label: '今日金额', value: fmt.yuan(s.todayAmount || 0, 0), tone: 'info', iconName: 'chart', sub: '线上与门店共用一份库存' })}
      </div>` : ''}
      ${table({
        columns: [
          { label: '订单号', render: (r) => `<span class="mono">${esc(r.OrderNo)}</span><div class="sub">${fmt.datetime(r.PlacedAt)}</div>` },
          { label: '顾客', render: (r) => `<div class="strong">${esc(r.CustomerName)}</div><div class="sub">${esc(r.Phone || '')}</div>` },
          { label: '渠道 / 方式', render: (r) => tag(r.channelLabel, 'plain') + ' ' + tag(r.FulfilMethod, r.FulfilMethod === '自提' ? 'info' : 'violet') },
          { label: '承诺交付', render: (r) => fmt.datetime(r.PromisedAt) },
          { label: '行数', cls: 'num', render: (r) => r.LineCount },
          { label: '金额', cls: 'num strong', render: (r) => fmt.yuan(r.TotalAmount) },
          { label: '取货码', render: (r) => `<span class="mono">${esc(r.PickupCode || '—')}</span>` },
          { label: '状态', render: (r) => tag((STATUS[r.OrderStatus] || {}).label || r.OrderStatus, (STATUS[r.OrderStatus] || {}).tone) },
          { label: '', cls: 'actions', render: (r) => `
            <button class="btn btn-sm" data-detail="${r.OrderID}">明细</button>
            ${r.OrderStatus === 'Pending' ? `<button class="btn btn-sm btn-primary" data-pick="${r.OrderID}">拣货</button>` : ''}
            ${r.OrderStatus === 'Picked' ? `<button class="btn btn-sm btn-primary" data-deliver="${r.OrderID}">收款交付</button>` : ''}
            ${(r.OrderStatus === 'Pending' || r.OrderStatus === 'Picked') && ctx.user.role !== 'Stocker'
              ? `<button class="btn btn-sm btn-danger" data-cancel="${r.OrderID}">取消</button>` : ''}
          ` },
        ],
        rows: res.items,
        empty: tab === 'pending' ? '没有待拣货订单' : '没有订单',
      })}`;

    on(body, 'click', '[data-detail]', async (e, btn) => {
      const d = await api.get('/api/online-orders/' + btn.dataset.detail);
      drawer({
        title: '线上订单 ' + d.order.OrderNo,
        subtitle: `${esc(d.order.CustomerName)} · ${esc(d.order.channelLabel)} · ${fmt.datetime(d.order.PlacedAt)} · ${esc(d.order.statusLabel)}`,
        body: `
          <dl class="kv kv-sm">
            <dt>承诺交付</dt><dd>${fmt.datetime(d.order.PromisedAt)}</dd>
            <dt>履约方式</dt><dd>${esc(d.order.FulfilMethod)} ${d.order.Address ? '· ' + esc(d.order.Address) : ''}</dd>
            <dt>取货码</dt><dd class="mono">${esc(d.order.PickupCode || '—')}</dd>
            <dt>订单金额</dt><dd><b>${fmt.yuan(d.order.TotalAmount)}</b>${d.order.PaidAmount ? ' · 已收 ' + fmt.yuan(d.order.PaidAmount) : ''}</dd>
          </dl>
          <div class="section-title mt16">订单明细（按批次占用库存）</div>
          ${table({
            compact: true,
            columns: [
              { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">批次 ${esc(r.BatchNo || '—')} · 库位 ${esc(r.Location || '—')}${r.SubstitutedName ? ' · 替代：' + esc(r.SubstitutedName) : ''}</div>` },
              { label: '数量', cls: 'num', render: (r) => fmt.qty(r.Quantity) + ' ' + esc(r.Unit) },
              { label: '拣货', cls: 'num', render: (r) => fmt.qty(r.PickedQty) },
              { label: '缺货', cls: 'num', render: (r) => r.ShortQty ? tag(fmt.qty(r.ShortQty), 'danger') : '—' },
              { label: '单价', cls: 'num', render: (r) => fmt.yuan(r.UnitPrice) },
              { label: '状态', render: (r) => tag({ Pending: '待拣', Picked: '已拣', Short: '缺货', Cancelled: '取消' }[r.LineStatus] || r.LineStatus, r.LineStatus === 'Picked' ? 'ok' : r.LineStatus === 'Short' ? 'warn' : 'plain') },
            ],
            rows: d.lines,
          })}
          <div class="section-title mt16">履约记录</div>
          <div class="timeline">${(d.logs || []).map((l) => `
            <div class="timeline-item ${l.Action === 'deliver' ? 'now' : ''}">
              <span class="dot"></span>
              <span class="txt">${esc(actionLabel(l.Action))}${l.Note ? ' · ' + esc(l.Note) : ''}
                <span>${fmt.datetime(l.OccurredAt)} · ${esc(l.HandlerName || '系统')}</span></span>
            </div>`).join('') || '<div class="muted small">无履约记录</div>'}</div>`,
      });
    });

    on(body, 'click', '[data-pick]', async (e, btn) => {
      const d = await api.get('/api/online-orders/' + btn.dataset.pick);
      const rows = d.lines.map((l, idx) => `
        <tr>
          <td><div class="strong">${esc(l.ProductName)}</div><div class="sub">库位 ${esc(l.Location || '—')} · 批次 ${esc(l.BatchNo || '')}</div></td>
          <td class="num">${fmt.qty(l.Quantity)}</td>
          <td><input class="input" name="pick_${idx}" value="${fmt.qty(l.Quantity)}" style="height:30px;width:80px"></td>
          <td><input class="input" name="sub_${idx}" placeholder="替代商品编号（可选）" style="height:30px;width:130px"></td>
        </tr>`).join('');
      modal({
        title: '拣货 · ' + d.order.OrderNo,
        desc: `承诺交付 ${fmt.datetime(d.order.PromisedAt)}；缺货须在承诺时间前通知顾客，缺货部分会释放库存占用`,
        size: 'wide', submitText: '提交拣货结果',
        content: `<div class="table-wrap"><table class="table compact">
            <thead><tr><th>商品</th><th class="num">订单量</th><th>实拣量</th><th>替代商品</th></tr></thead>
            <tbody>${rows}</tbody></table></div>
          <div class="form-hint mt8">生鲜称重商品按实际称重录入；拣货完成后系统自动推送取货码给顾客。</div>`,
        onSubmit: async () => {
          const lines = d.lines.map((l, idx) => ({
            lineNo: l.LineNo,
            pickedQty: Number(document.querySelector(`[name=pick_${idx}]`).value),
            substitutedProductId: document.querySelector(`[name=sub_${idx}]`).value || null,
          }));
          const r2 = await api.post(`/api/online-orders/${d.order.OrderID}/pick`, { lines });
          toast(r2.message, 'ok', 4600);
          route();
        },
      });
    });

    on(body, 'click', '[data-deliver]', async (e, btn) => {
      const d = await api.get('/api/online-orders/' + btn.dataset.deliver);
      modal({
        title: '收款交付 · ' + d.order.OrderNo,
        desc: '交付时扣减线上占用库存，与门店库存同源',
        content: `<div class="form-grid">
            <div class="field"><label>收款金额<span class="req">*</span></label>
              <input class="input" name="paidAmount" value="${fmt.money(d.order.TotalAmount)}"></div>
            <div class="field"><label>收款方式<span class="req">*</span></label>
              <select class="select" name="payMethod"><option>银豹付</option><option>微信支付</option><option>支付宝</option><option>现金</option><option>银联</option></select></div>
            <div class="field full"><label>取货码核对</label><input class="input" value="${esc(d.order.PickupCode || '')}" readonly></div>
          </div>
          <div class="alert info mt12" style="display:block">顾客拒收或超时未取时请改为取消订单，系统会回滚线上占用库存。</div>`,
        onSubmit: async (v) => {
          const r2 = await api.post(`/api/online-orders/${d.order.OrderID}/deliver`, {
            payMethod: v.payMethod, paidAmount: Number(v.paidAmount),
          });
          toast(r2.message, 'ok', 4200);
          route();
        },
      });
    });

    on(body, 'click', '[data-cancel]', async (e, btn) => {
      const ok = await confirmBox({ title: '取消订单', message: '取消后系统释放线上占用库存，并按需退款。订单不物理删除。', danger: true, confirmText: '取消订单' });
      if (!ok) return;
      try {
        const r2 = await api.post(`/api/online-orders/${btn.dataset.cancel}/cancel`, { reason: '顾客取消/超时未取' });
        toast(r2.message, 'warn'); route();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  $('[data-new]', view).addEventListener('click', () => openNewOrder());

  function openNewOrder() {
    const items = [];
    let searchResults = [];
    const m = modal({
      title: '代客下单',
      desc: '顾客在微信群报单，店员代录；系统按库存与效期台账当场校验可售数量，缺货挡在下单之前',
      size: 'wide', submitText: '确认订单并占用库存',
      content: `
        <div class="form-grid mb12">
          <div class="field"><label>顾客</label>
            <select class="select" name="customerId">
              <option value="">+ 新顾客（请在下方填写称呼）</option>
              ${(options.customers || []).map((c) => `<option value="${c.CustomerID}">${esc(c.Name)} · ${esc(c.Phone || '')}</option>`).join('')}
            </select></div>
          <div class="field"><label>渠道</label>
            <select class="select" name="channel">${(options.channels || []).map((c) =>
              `<option value="${c.value}">${c.label}</option>`).join('')}</select></div>
          <div class="field"><label>新顾客称呼</label><input class="input" name="customerName" placeholder="仅新顾客填写"></div>
          <div class="field"><label>手机号</label><input class="input" name="customerPhone"></div>
          <div class="field"><label>承诺交付时间</label><input class="input" name="promisedAt" type="datetime-local" value="${promisedDefault()}"></div>
          <div class="field"><label>履约方式</label><select class="select" name="fulfilMethod"><option>自提</option><option>送货</option></select></div>
        </div>
        <div class="section-title">选择商品</div>
        <div class="row mb8">
          <input class="input" data-search placeholder="搜索商品名称或条码" style="flex:1">
          <button type="button" class="btn" data-do-search>搜索</button>
        </div>
        <div data-results class="mb12"><div class="muted small">输入关键字后点搜索，或直接选择热销商品</div></div>
        <div data-cart></div>`,
      onSubmit: async (v) => {
        if (!items.length) throw new Error('请至少添加一个商品');
        const customerId = v.customerId ? Number(v.customerId) : null;
        if (!customerId && !v.customerName) throw new Error('新顾客请填写称呼');
        const r2 = await api.post('/api/online-orders', {
          customerId, customerName: v.customerName, customerPhone: v.customerPhone,
          channel: v.channel, promisedAt: (v.promisedAt || '').replace('T', ' ') + ':00',
          fulfilMethod: v.fulfilMethod,
          lines: items.map((i) => ({ productId: i.productId, quantity: i.qty, unitPrice: i.price })),
        });
        toast(r2.message + '，取货码 ' + r2.pickupCode, 'ok', 5200);
        tab = 'pending';
        route();
      },
    });

    const resultsBox = m.el.querySelector('[data-results]');
    const cartBox = m.el.querySelector('[data-cart]');

    const renderCart = () => {
      cartBox.innerHTML = items.length ? `<div class="table-wrap"><table class="table compact">
        <thead><tr><th>商品</th><th>数量</th><th class="num">单价</th><th class="num">金额</th><th></th></tr></thead>
        <tbody>${items.map((i, idx) => `<tr><td>${esc(i.name)}</td>
          <td><input class="input" data-q="${idx}" value="${i.qty}" style="height:28px;width:70px"></td>
          <td class="num">${fmt.yuan(i.price)}</td><td class="num">${fmt.yuan(i.price * i.qty)}</td>
          <td class="actions"><button type="button" class="btn btn-sm btn-danger" data-del="${idx}">移除</button></td></tr>`).join('')}</tbody>
        <tfoot><tr class="total-row"><td colspan="3">合计</td><td class="num">${fmt.yuan(items.reduce((s, i) => s + i.price * i.qty, 0))}</td><td></td></tr></tfoot>
      </table></div>` : '<div class="muted small">还没有选择商品</div>';
      cartBox.querySelectorAll('[data-q]').forEach((inp) => inp.addEventListener('change', () => {
        items[Number(inp.dataset.q)].qty = Number(inp.value); renderCart();
      }));
      cartBox.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        items.splice(Number(b.dataset.del), 1); renderCart();
      }));
    };

    const doSearch = async () => {
      const q = m.el.querySelector('[data-search]').value.trim();
      const res = await api.get('/api/products/search', { q, limit: 12 });
      searchResults = res.items;
      resultsBox.innerHTML = `<div class="pos-products">${searchResults.map((p, idx) => `
        <div class="pos-item" data-add="${idx}">
          <span class="badge-stock">${fmt.qty(p.SellableQty)} ${esc(p.Unit)}</span>
          <div class="n">${esc(p.ProductName)}</div>
          <div class="s">${esc(p.Specification || '')}</div>
          <div class="p">${fmt.yuan(p.ListPrice)}<small>/${esc(p.Unit)}</small></div>
        </div>`).join('')}</div>`;
      resultsBox.querySelectorAll('[data-add]').forEach((card) => card.addEventListener('click', () => {
        const p = searchResults[Number(card.dataset.add)];
        if (!p.SellableQty || p.SellableQty <= 0) { toast('该商品可售数量为 0', 'warn'); return; }
        const exist = items.find((i) => i.productId === p.ProductID);
        if (exist) exist.qty += 1;
        else items.push({ productId: p.ProductID, name: p.ProductName, price: p.Price || p.ListPrice, qty: 1 });
        renderCart();
      }));
    };
    m.el.querySelector('[data-do-search]').addEventListener('click', doSearch);
    m.el.querySelector('[data-search]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
    doSearch();
    renderCart();
  }

  await route();
}

function promisedDefault() {
  const d = new Date(Date.now() + 2 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function actionLabel(a) {
  return {
    create: '订单提交，可售数量已校验', pick: '拣货', substitute: '顾客接受替代商品',
    picked_all: '拣货完成', deliver: '收款并交付', cancel: '取消订单', short: '缺货登记',
  }[a] || a;
}
