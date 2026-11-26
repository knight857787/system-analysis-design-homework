/* 收银台（UC-16 记录销售与收款） */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock, debounce,
} from '../core.js';

export async function render(view, ctx) {
  const canSeeMoney = ((state.user || {}).role === 'Owner');
  const options = state.options;
  const cart = [];
  let payMethod = '现金';
  let customerId = '';
  let creditAmount = 0;
  let discount = 0;
  let keyword = '';
  let categoryId = '';
  let quoteSeq = 0;

  view.innerHTML = `
    <div class="pos">
      <div class="stack">
        <div class="card mb0">
          <div class="toolbar">
            <div class="row" style="gap:8px;flex:1">
              <input class="input search" data-q placeholder="扫码或搜索商品名称 / 条码（生鲜按品名检索）" style="width:auto;flex:1">
              <select class="select" data-cat style="width:140px">
                <option value="">全部品类</option>
                ${(options.categories || []).map((c) => `<option value="${c.CategoryID}">${esc(c.CategoryName)}</option>`).join('')}
              </select>
            </div>
            <span class="tag plain" data-count>0 个商品</span>
          </div>
          <div class="card-body">
            <div class="pos-products" data-products>${loadingBlock('正在读取商品与库存…')}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div><h3>今日销售单据</h3><div class="desc">已完成销售单不允许修改，退货与冲红另生成单据</div></div>
            <div class="actions">
              <span class="tag info" data-day-sum>今日 0 单</span>
              <button class="btn btn-sm" data-print>${icon('print')} 打印日结</button>
            </div>
          </div>
          <div class="card-body flush" data-sales>${loadingBlock()}</div>
        </div>
      </div>

      <div class="card cart mb0">
        <div class="card-head">
          <div><h3>购物车</h3><div class="desc" data-cart-count>0 件商品</div></div>
          <div class="actions"><button class="btn btn-ghost btn-sm" data-clear>清空</button></div>
        </div>
        <div class="card-body">
          <div class="cart-list" data-cart></div>
          <div class="cart-sum mt12">
            <div class="line"><span>商品合计</span><span data-subtotal>¥0.00</span></div>
            <div class="line"><span>折扣 / 抹零</span>
              <span><input class="input" data-discount value="0" style="height:28px;width:80px;text-align:right;display:inline-block"> 元</span></div>
            <div class="line big"><span>应收</span><span data-total>¥0.00</span></div>
          </div>

          <div class="mt12">
            <div class="tiny muted mb8">顾客（可选，用于会员积分与挂账）</div>
            <select class="select" data-customer>
              <option value="">散客</option>
              ${(options.customers || []).map((c) => `<option value="${c.CustomerID}">${esc(c.Name)}${c.Phone ? ' · ' + esc(c.Phone) : ''}${c.MemberID ? ' · 会员' : ''}${c.CreditLimit ? ' · 额度 ' + c.CreditLimit : ''}</option>`).join('')}
            </select>
          </div>

          <div class="mt12">
            <div class="tiny muted mb8">支付方式</div>
            <div class="pay-grid" data-pays>
              ${['现金', '银联', '银豹付', '微信支付', '支付宝', '赊账'].map((m) => `
                <div class="pay-opt ${m === '现金' ? 'active' : ''}" data-pay="${m}">${m}</div>`).join('')}
            </div>
          </div>

          <div class="mt16">
            <button class="btn btn-primary btn-lg btn-block" data-submit>
              ${icon('cash')} 收款并出单
            </button>
            <div class="tiny muted center mt8">确认后按批次先进先出扣减库存，并记录成本快照</div>
          </div>
        </div>
      </div>
    </div>`;

  const el = (sel) => $(sel, view);
  const productsBox = el('[data-products]');
  const cartBox = el('[data-cart]');

  function money(n) { return fmt.yuan(n); }

  function cartTotal() {
    return cart.reduce((s, i) => s + i.qty * i.price, 0);
  }

  async function refreshQuote() {
    const seq = ++quoteSeq;
    if (!cart.length) return;
    try {
      const quote = await api.post('/api/sales/quote', {
        lines: cart.map((c) => ({ productId: c.productId, quantity: c.qty })),
        discountAmount: Math.max(0, Number(discount) || 0),
      });
      if (seq !== quoteSeq || !cart.length) return;
      const byId = new Map((quote.lines || []).map((line) => [line.productId, line]));
      cart.forEach((item) => {
        const q = byId.get(item.productId);
        if (q) {
          item.price = Number(q.unitPrice);
          item.markdown = !!q.markdown;
        }
      });
      renderCart(quote);
    } catch (err) {
      if (seq === quoteSeq) toast(err.message, 'error');
    }
  }

  function renderCart(quote = null) {
    if (!cart.length) {
      cartBox.innerHTML = `<div class="empty" style="padding:26px 8px">${icon('cart')}
        <p>购物车是空的</p><p class="tiny">点击左侧商品即可加入，称重商品可改数量</p></div>`;
    } else {
      cartBox.innerHTML = cart.map((item, idx) => `
        <div class="cart-row" data-idx="${idx}">
          <div class="n">${esc(item.name)}<span>${fmt.yuan(item.price)} / ${esc(item.unit)}${item.markdown ? ' · 已折价' : ''}</span></div>
          <div class="qty-box">
            <button data-dec="${idx}">−</button>
            <input data-qty="${idx}" value="${fmt.qty(item.qty, 3)}" inputmode="decimal">
            <button data-inc="${idx}">+</button>
          </div>
          <div class="amt">${money(item.qty * item.price)}</div>
        </div>`).join('');
    }
    const sub = quote ? Number(quote.subtotal) : cartTotal();
    const disc = Math.max(0, Number(discount) || 0);
    const total = quote ? Number(quote.net) : Math.max(0, sub - disc);
    el('[data-subtotal]').textContent = money(sub);
    el('[data-total]').textContent = money(total);
    el('[data-cart-count]').textContent = cart.reduce((s, i) => s + 1, 0) + ' 件商品';
    el('[data-submit]').disabled = !cart.length;
    if (!quote) refreshQuote();
  }

  function addToCart(p) {
    const exist = cart.find((i) => i.productId === p.ProductID);
    if (exist) {
      exist.qty = Number((exist.qty + 1).toFixed(3));
    } else {
      cart.push({
        productId: p.ProductID, name: p.ProductName, price: Number(p.ListPrice),
        unit: p.Unit, qty: 1, stock: Number(p.SellableQty || 0), markdown: false,
      });
    }
    renderCart();
  }

  async function loadProducts() {
    productsBox.innerHTML = loadingBlock('正在读取商品…');
    try {
      const res = await api.get('/api/products', { q: keyword, categoryId, page: 1, size: 60, onShelf: 'Y' });
      const items = res.items.filter((p) => Number(p.StockQty) > 0);
      el('[data-count]').textContent = items.length + ' 个可售商品';
      productsBox.innerHTML = items.length ? items.map((p) => `
        <div class="pos-item" data-pid="${p.ProductID}">
          <span class="badge-stock">${fmt.qty(p.StockQty)} ${esc(p.Unit)}</span>
          <div class="n">${esc(p.ProductName)}</div>
          <div class="s">${esc(p.Specification || '')}</div>
          <div class="p">${fmt.yuan(p.ListPrice)}<small> /${esc(p.Unit)}</small></div>
        </div>`).join('') : emptyState('没有符合条件的商品', '试试清空搜索或换个品类');
      productsBox.querySelectorAll('[data-pid]').forEach((card) => {
        card.addEventListener('click', () => {
          const p = items.find((x) => String(x.ProductID) === card.dataset.pid);
          if (p) addToCart(p);
        });
      });
    } catch (err) {
      productsBox.innerHTML = `<div class="alert danger" style="display:block">${esc(err.message)}</div>`;
    }
  }

  async function loadDaySummary() {
    try {
      const s = await api.get('/api/sales/daily-summary');
      el('[data-day-sum]').textContent = `今日 ${s.orders} 单 · ${fmt.yuan(s.amount)}`;
    } catch (e) { /* ignore */ }
  }

  async function loadSales() {
    el('[data-sales]').innerHTML = loadingBlock();
    try {
      const res = await api.get('/api/sales', { date: fmt.today(), page: 1, size: 8 });
      el('[data-sales]').innerHTML = table({
        compact: true,
        columns: [
          { label: '单号', render: (r) => `<span class="mono">${esc(r.SaleNo)}</span>` },
          { label: '时间', render: (r) => fmt.time(r.OccurredAt) },
          { label: '收银员', render: (r) => esc(r.CashierName || '') },
          { label: '行数', cls: 'num', render: (r) => r.LineCount },
          { label: '金额', cls: 'num strong', render: (r) => fmt.yuan(r.TotalAmount) },
          ...(canSeeMoney ? [{ label: '毛利', cls: 'num', render: (r) => fmt.yuan(r.ProfitAmount) }] : []),
          { label: '支付', render: (r) => (r.PayMethods || '').split(',').filter(Boolean).map((m) => tag(m, m === '赊账' ? 'warn' : 'plain')).join(' ') },
          { label: '', cls: 'actions', render: (r) => `<button class="btn btn-sm btn-ghost" data-view="${r.SaleID}">详情</button>` },
        ],
        rows: res.items,
        empty: '今日还没有销售记录，开第一单试试',
      });
    } catch (err) {
      el('[data-sales]').innerHTML = `<div class="alert danger" style="display:block">${esc(err.message)}</div>`;
    }
  }

  on(el('[data-sales]'), 'click', '[data-view]', async (e, btn) => {
    const d = await api.get('/api/sales/' + btn.dataset.view);
    const { modal } = await import('../core.js');
    modal({
      title: '销售单 ' + d.sale.SaleNo, desc: `收银员 ${esc(d.sale.CashierName || '')} · ${fmt.datetime(d.sale.OccurredAt)}`,
      size: 'wide', hideFooter: true,
      content: table({
        columns: [
          { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">批次 ${esc(r.BatchNo || '—')}</div>` },
          { label: '数量', cls: 'num', render: (r) => fmt.qty(r.Quantity) + ' ' + esc(r.Unit) },
          { label: '单价', cls: 'num', render: (r) => fmt.yuan(r.UnitPrice) },
          { label: '金额', cls: 'num', render: (r) => fmt.yuan(r.Amount) },
          { label: '成本', cls: 'num', render: (r) => fmt.yuan(r.CostAmount) },
        ],
        rows: d.lines,
      }) + `<div class="row mt12"><span class="muted">支付：</span>${d.pays.map((p) => tag(p.PayMethod + ' ' + fmt.yuan(p.PayAmount), 'ok')).join(' ')}
        <span class="spacer"></span><b>实付 ${fmt.yuan(d.sale.PaidAmount)}</b>${d.sale.CreditAmount > 0 ? ' · 挂账 ' + fmt.yuan(d.sale.CreditAmount) : ''}</div>`,
    });
  });

  /* ---------------------------------------------------------------- 事件 */
  on(view, 'click', '[data-pay]', (e, node) => {
    payMethod = node.dataset.pay;
    $$('[data-pay]', view).forEach((n) => n.classList.toggle('active', n === node));
  });
  on(view, 'click', '[data-inc]', (e, b) => {
    const i = Number(b.dataset.inc); cart[i].qty = Number((cart[i].qty + 1).toFixed(3)); renderCart();
  });
  on(view, 'click', '[data-dec]', (e, b) => {
    const i = Number(b.dataset.dec);
    cart[i].qty = Number((cart[i].qty - 1).toFixed(3));
    if (cart[i].qty <= 0) cart.splice(i, 1);
    renderCart();
  });
  on(view, 'change', '[data-qty]', (e, input) => {
    const i = Number(input.dataset.qty);
    const v = Number(input.value);
    if (!v || v <= 0) { cart.splice(i, 1); } else { cart[i].qty = Number(v.toFixed(3)); }
    renderCart();
  });
  on(view, 'input', '[data-discount]', (e, input) => { discount = Number(input.value) || 0; renderCart(); });
  on(view, 'change', '[data-customer]', (e, sel) => { customerId = sel.value; });
  el('[data-clear]').addEventListener('click', () => { cart.length = 0; discount = 0; el('[data-discount]').value = '0'; renderCart(); });
  el('[data-q]').addEventListener('input', debounce((e) => { keyword = e.target.value.trim(); loadProducts(); }, 300));
  el('[data-cat]').addEventListener('change', (e) => { categoryId = e.target.value; loadProducts(); });

  el('[data-submit]').addEventListener('click', async () => {
    if (!cart.length) return;
    const sub = cartTotal();
    const disc = Math.max(0, Number(discount) || 0);
    let total = Math.max(0, sub - disc);
    const isCredit = payMethod === '赊账';
    if (isCredit && !customerId) { toast('挂账销售必须选择顾客', 'error'); return; }
    const btn = el('[data-submit]');
    btn.disabled = true;
    try {
      const lines = cart.map((c) => ({ productId: c.productId, quantity: c.qty }));
      const quote = await api.post('/api/sales/quote', { lines, discountAmount: disc });
      total = Number(quote.net);
      const body = {
        lines,
        discountAmount: disc,
        customerId: customerId || null,
        pays: isCredit ? [] : [{ method: payMethod, amount: total }],
        creditAmount: isCredit ? total : 0,
      };
      const res = await api.post('/api/sales', body);
      toast(`收款成功：${res.saleNo}，应收 ${fmt.yuan(res.total)}，毛利 ${fmt.yuan(res.profit)}`, 'ok');
      cart.length = 0; discount = 0; creditAmount = 0;
      el('[data-discount]').value = '0';
      el('[data-customer]').value = ''; customerId = '';
      renderCart();
      loadSales(); loadDaySummary(); loadProducts();
    } catch (err) {
      toast(err.message, 'error', 5200);
    } finally {
      btn.disabled = false;
    }
  });

  el('[data-print]').addEventListener('click', async () => {
    const s = await api.get('/api/sales/daily-summary');
    const { modal } = await import('../core.js');
    modal({
      title: '日结单 · ' + s.date, desc: '现金对账口径：PayRecord 中现金合计与实缴现金比对',
      hideFooter: true,
      content: `<dl class="kv">
          <dt>销售单数</dt><dd>${s.orders} 单</dd>
          <dt>销售额</dt><dd>${fmt.yuan(s.amount)}</dd>
          <dt>成本</dt><dd>${fmt.yuan(s.cost)}</dd>
          <dt>毛利</dt><dd>${fmt.yuan(s.profit)}（${fmt.pct(s.margin)}）</dd>
          <dt>挂账</dt><dd>${fmt.yuan(s.credit)}</dd>
          <dt>实收合计</dt><dd>${fmt.yuan(s.pays.reduce((a, p) => a + p.amount, 0))}</dd>
        </dl>
        <div class="section-title">支付方式汇总</div>
        ${table({ compact: true, columns: [
          { label: '支付方式', render: (r) => esc(r.method) },
          { label: '笔数', cls: 'num', render: (r) => r.times || '' },
          { label: '金额', cls: 'num strong', render: (r) => fmt.yuan(r.amount) },
        ], rows: s.pays })}`,
    });
  });

  renderCart();
  await Promise.all([loadProducts(), loadSales(), loadDaySummary()]);
}
