/* 经营看板 */
import {
  api, state, esc, fmt, icon, stat, toast, chartLine, chartDonut, barList,
  table, emptyState, loadingBlock, on, $, tag,
} from '../core.js';

export async function render(view, ctx) {
  view.innerHTML = `<div data-wrap>${loadingBlock('正在汇总今日经营数据…')}</div>`;
  const wrap = $('[data-wrap]', view);
  let data;
  try {
    data = await api.get('/api/dashboard/summary');
  } catch (err) {
    wrap.innerHTML = `<div class="alert danger" style="display:block">${esc(err.message)}</div>`;
    return;
  }
  const { today, month, trend, stock, expiry, loss, credit, payable, online, member, todo,
    categorySales, categoryLoss, topProducts } = data;
  const user = ctx.user;
  const isSupplier = user.role === 'Supplier';

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 6) return '凌晨好';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  })();

  // 按角色进入不同工作台：理货员只看库存与效期，销售只看收银与赊账，供货商只看订货与对账
  if (user.role === 'Stocker') return renderStocker(wrap, data, user, greeting);
  if (user.role === 'Salesperson') return renderSales(wrap, data, user, greeting);
  if (user.role === 'Supplier') return renderSupplier(wrap, data, user, greeting);

  const trendData = trend.length ? trend : [{ date: fmt.today(), orders: 0, amount: 0, profit: 0 }];
  const levelTag = (lv) => tag(lv === 'expired' ? '已过期' : lv === 'urgent' ? '今日到期' : '临期',
    lv === 'expired' ? 'danger' : lv === 'urgent' ? 'warn' : 'info');

  wrap.innerHTML = `
    <div class="welcome">
      <div>
        <h3>${greeting}，${esc(user.name)}</h3>
        <p>今天是 ${fmt.date(today.date)} ${fmt.weekday(today.date)} · 系统已按库存与效期台账生成当日的临期预警与补货建议</p>
      </div>
      <div class="mini-stats">
        <div><b>${fmt.yuan(month.amount, 0)}</b><span>本月销售额</span></div>
        <div><b>${fmt.pct(today.margin)}</b><span>今日毛利率</span></div>
        <div><b>${fmt.yuan(stock.value, 0)}</b><span>库存成本</span></div>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom:18px">
      ${stat({ label: '今日销售额', value: fmt.yuan(today.amount, 0), iconName: 'cash', tone: '',
        sub: `<span>${today.orders} 单 · 单均价 ${fmt.yuan(today.avgTicket)}</span>` })}
      ${stat({ label: '今日毛利', value: fmt.yuan(today.profit, 0), iconName: 'chart', tone: 'info',
        sub: `<span>毛利率 <b>${fmt.pct(today.margin)}</b>，目标口径 17%</span>` })}
      ${stat({ label: '临期 / 已过期', value: expiry.expiring + expiry.expired, unit: '项', iconName: 'clock',
        tone: expiry.expired ? 'danger' : expiry.expiring ? 'warn' : 'ok',
        sub: `<span>库存金额 ${fmt.yuan(expiry.value, 0)}${expiry.expired ? ' · 已过期 ' + expiry.expired + ' 项' : ''}</span>` })}
      ${stat({ label: '本月损耗率', value: fmt.pct(loss.rate, 2), iconName: 'alert',
        tone: loss.rate > 1 ? 'warn' : '',
        sub: `<span>报损 ${loss.count} 单 / ${fmt.yuan(loss.amount, 0)}（近 30 天）</span>` })}
    </div>

    <div class="grid grid-side">
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div><h3>近 14 日销售与毛利</h3><div class="desc">按日汇总的销售额与毛利，毛利为成交成本快照口径</div></div>
            <div class="actions"><span class="tag plain">数据来自 SaleOrder / SaleLine</span></div>
          </div>
          <div class="card-body">
            ${chartLine({ data: trendData, series: [
              { key: 'amount', label: '销售额', color: '#0f9d6e' },
              { key: 'profit', label: '毛利', color: '#3b82f6' },
            ], height: 210, yLabel: '元' })}
          </div>
        </div>

        <div class="grid grid-2">
          <div class="card">
            <div class="card-head"><h3>近 30 天品类销售</h3></div>
            <div class="card-body">
              ${chartDonut({
                items: categorySales.slice(0, 6).map((c) => ({ label: c.name, value: c.amount })),
                size: 132, centerTop: fmt.yuan(categorySales.reduce((s, c) => s + c.amount, 0), 0), centerSub: '销售合计',
              })}
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h3>损耗（按品类）</h3></div>
            <div class="card-body">
              ${categoryLoss.length ? barList({
                items: categoryLoss.map((c) => ({ label: c.name, value: c.amount, tone: 'danger' })),
              }) : emptyState('近 30 天没有报损记录', '临期商品请在「临期处理」中登记报损')}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div><h3>临期预警清单</h3><div class="desc">按批次剩余效期与品类阈值计算，开店前生成</div></div>
            <div class="actions"><a class="btn btn-sm" href="#/expiry">去处理 ${icon('arrow')}</a></div>
          </div>
          <div class="card-body flush">
            ${table({
              compact: true,
              columns: [
                { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div>
                  <div class="sub">${esc(r.Specification || '')} · 批次 ${esc(r.BatchNo || '')}</div>` },
                { label: '剩余效期', render: (r) => `${levelTag(r.level)} <span class="tiny muted">${fmt.days(r.RemainDays)}</span>` },
                { label: '现存', cls: 'num', render: (r) => fmt.qty(r.Quantity) + ' ' + esc(r.Unit) },
                { label: '库位', render: (r) => esc(r.Location || '—') },
                { label: '建议', render: (r) => r.level === 'expired' ? '<span class="tag danger">下架报损</span>' : '<span class="tag warn">折价出售</span>' },
              ],
              rows: expiry.top || [],
              empty: '今日没有临期商品',
            })}
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>待办事项</h3><div class="actions"><span class="tag plain">${todo.length} 项</span></div></div>
          <div class="card-body">
            ${todo.length ? `<div class="todo-list">${todo.map((t) => `
              <a class="todo-item ${t.level}" href="${t.route}" style="text-decoration:none;color:inherit">
                <span class="ico">${icon(t.key === 'online' ? 'phone' : t.key === 'credit' ? 'wallet' : t.key === 'statement' ? 'file' : t.key === 'purchase' ? 'cart' : 'clock')}</span>
                <span class="txt">${esc(t.title)}<span>点此进入处理</span></span>
                <span class="n">${t.count}</span>
              </a>`).join('')}</div>` : `<div class="alert ok" style="display:block">
                <b>没有待办事项</b><br>临期、报损、对账、赊账都在正常范围内。</div>`}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>线上与顾客</h3></div>
          <div class="card-body">
            <dl class="kv kv-sm">
              <dt>线上订单</dt><dd>今日 ${online.todayOrders} 单 · ${fmt.yuan(online.todayAmount)}</dd>
              <dt>待拣货</dt><dd>${online.pendingPick ? `<span class="tag warn">${online.pendingPick} 单</span>` : '<span class="muted">无</span>'}</dd>
              <dt>会员</dt><dd>${member.total} 人 · 30 天复购 <b>${fmt.pct(member.repurchase)}</b></dd>
              <dt>赊账余额</dt><dd>${fmt.yuan(credit.outstanding)} ${credit.overdueAccounts ? `<span class="tag danger">逾期 ${credit.overdueAccounts} 户</span>` : ''}</dd>
              <dt>应付账款</dt><dd>${fmt.yuan(payable.open)} ${payable.overdue ? `<span class="tag warn">到结算日 ${payable.overdue}</span>` : ''}</dd>
            </dl>
            <div class="row mt12">
              <a class="btn btn-sm" href="#/online">线上订单</a>
              <a class="btn btn-sm" href="#/credit">赊账台账</a>
              <a class="btn btn-sm" href="#/settle">对账</a>
            </div>
          </div>
        </div>

        ${isSupplier ? '' : `
        <div class="card">
          <div class="card-head"><h3>近 30 天热销商品</h3></div>
          <div class="card-body">
            ${barList({
              items: (topProducts || []).slice(0, 6).map((p) => ({ label: p.name, value: p.amount })),
              formatter: (v) => fmt.yuan(v, 0),
            })}
          </div>
        </div>`}

        <div class="card">
          <div class="card-head"><h3>库存概览</h3></div>
          <div class="card-body">
            <dl class="kv kv-sm">
              <dt>库存批次</dt><dd>${fmt.int(stock.batches)} 个批次</dd>
              <dt>库存数量</dt><dd>${fmt.qty(stock.qty)}</dd>
              <dt>库存成本</dt><dd>${fmt.yuan(stock.value)}</dd>
              <dt>负库存</dt><dd>${stock.negative ? `<span class="tag danger">${stock.negative} 条</span>` : '<span class="tag ok">0 条</span>'}</dd>
              <dt>零库存 SKU</dt><dd>${stock.zeroStock} 个 / 共 ${stock.skuCount} 个</dd>
            </dl>
            <div class="alert info mt12" style="display:block">
              库存台账只由收货、报损、退货、销售、调账五类流水推动，界面不提供直接改数入口。
            </div>
          </div>
        </div>
      </div>
    </div>`;
}


/* ---------------- 角色工作台：理货员 ---------------- */
function todoCard(todo) {
  return todo.length
    ? `<div class="todo-list">${todo.map((t) => `
        <a class="todo-item ${t.level}" href="${t.route}" style="text-decoration:none;color:inherit">
          <span class="ico">${icon(t.key === 'online' ? 'phone' : t.key === 'statement' ? 'file' : t.key === 'purchase' ? 'cart' : 'clock')}</span>
          <span class="txt">${esc(t.title)}<span>点此进入处理</span></span>
          <span class="n">${t.count}</span>
        </a>`).join('')}</div>`
    : `<div class="alert ok" style="display:block"><b>没有待办事项</b><br>临期、报损、收货与盘点都在正常范围内。</div>`;
}

function expiryTable(data) {
  return table({
    compact: true,
    columns: [
      { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div>
        <div class="sub">${esc(r.Specification || '')} · 批次 ${esc(r.BatchNo || '')}</div>` },
      { label: '剩余效期', render: (r) => `${tag(r.level === 'expired' ? '已过期' : r.level === 'urgent' ? '今日到期' : '临期',
        r.level === 'expired' ? 'danger' : r.level === 'urgent' ? 'warn' : 'info')} <span class="tiny muted">${fmt.days(r.RemainDays)}</span>` },
      { label: '现存', cls: 'num', render: (r) => fmt.qty(r.Quantity) + ' ' + esc(r.Unit) },
      { label: '库位', render: (r) => esc(r.Location || '—') },
      { label: '建议', render: (r) => r.level === 'expired' ? '<span class="tag danger">下架报损</span>' : '<span class="tag warn">折价出售</span>' },
    ],
    rows: data.expiry.top || [],
    empty: '今日没有临期商品',
  });
}

function renderStocker(wrap, data, user, greeting) {
  wrap.innerHTML = `
    <div class="welcome">
      <div>
        <h3>${greeting}，${esc(user.name)}</h3>
        <p>${fmt.date(data.date)} ${fmt.weekday(data.date)} · 这里是你负责的库存、效期与门店作业待办</p>
      </div>
      <div class="mini-stats">
        <div><b>${fmt.int(data.stock.batches)}</b><span>库存批次</span></div>
        <div><b>${fmt.int(data.expiry.expiring)}</b><span>临期待处理</span></div>
        <div><b>${fmt.int(data.expiry.expired)}</b><span>已过期</span></div>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom:18px">
      ${stat({ label: '库存数量', value: fmt.qty(data.stock.qty), iconName: 'box', sub: `<span>共 ${data.stock.skuCount} 个在架 SKU</span>` })}
      ${stat({ label: '临期商品', value: data.expiry.expiring, unit: '项', iconName: 'clock', tone: data.expiry.expiring ? 'warn' : 'ok', sub: '<span>按批次剩余效期计算</span>' })}
      ${stat({ label: '已过期', value: data.expiry.expired, unit: '项', iconName: 'alert', tone: data.expiry.expired ? 'danger' : 'ok', sub: '<span>需下架并登记报损</span>' })}
      ${stat({ label: '报损单', value: data.loss.count, unit: '单', iconName: 'file', sub: '<span>近 30 天已登记</span>' })}
    </div>

    <div class="grid grid-side">
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div><h3>临期预警清单</h3><div class="desc">开店前生成，按剩余效期排序</div></div>
            <div class="actions"><a class="btn btn-sm" href="#/expiry">去处理 ${icon('arrow')}</a></div>
          </div>
          <div class="card-body flush">${expiryTable(data)}</div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>待办事项</h3><div class="actions"><span class="tag plain">${data.todo.length} 项</span></div></div>
          <div class="card-body">${todoCard(data.todo)}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>库存概览</h3></div>
          <div class="card-body">
            <dl class="kv kv-sm">
              <dt>库存批次</dt><dd>${fmt.int(data.stock.batches)} 个</dd>
              <dt>库存数量</dt><dd>${fmt.qty(data.stock.qty)}</dd>
              <dt>负库存</dt><dd>${data.stock.negative ? `<span class="tag danger">${data.stock.negative} 条</span>` : '<span class="tag ok">0 条</span>'}</dd>
              <dt>零库存 SKU</dt><dd>${data.stock.zeroStock} 个</dd>
            </dl>
            <div class="alert info mt12" style="display:block">库存台账只由收货、报损、退货、销售、调账五类流水推动，界面不提供直接改数入口。</div>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---------------- 角色工作台：销售人员 ---------------- */
function renderSales(wrap, data, user, greeting) {
  wrap.innerHTML = `
    <div class="welcome">
      <div>
        <h3>${greeting}，${esc(user.name)}</h3>
        <p>${fmt.date(data.date)} ${fmt.weekday(data.date)} · 这里是你本班的开单、赊账与线上交付</p>
      </div>
      <div class="mini-stats">
        <div><b>${fmt.int(data.today.orders)}</b><span>今日开单</span></div>
        <div><b>${fmt.yuan(data.today.amount, 0)}</b><span>今日收款</span></div>
        <div><b>${fmt.yuan(data.credit.outstanding, 0)}</b><span>赊账余额</span></div>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom:18px">
      ${stat({ label: '今日开单', value: data.today.orders, unit: '单', iconName: 'cash', sub: `<span>单均价 ${fmt.yuan(data.today.avgTicket)}</span>` })}
      ${stat({ label: '今日收款', value: fmt.yuan(data.today.amount, 0), iconName: 'wallet', sub: '<span>仅本班金额，不含成本</span>' })}
      ${stat({ label: '赊账余额', value: fmt.yuan(data.credit.outstanding, 0), iconName: 'credit', tone: data.credit.overdueAccounts ? 'warn' : '', sub: `<span>逾期 ${data.credit.overdueAccounts} 户</span>` })}
      ${stat({ label: '线上待拣货', value: data.online.pendingPick, unit: '单', iconName: 'phone', tone: data.online.pendingPick ? 'warn' : 'ok', sub: `<span>今日线上 ${data.online.todayOrders} 单</span>` })}
    </div>

    <div class="grid grid-side">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>本班快捷入口</h3></div>
          <div class="card-body">
            <div class="row" style="flex-wrap:wrap;gap:10px">
              <a class="btn" href="#/pos">去收银</a>
              <a class="btn" href="#/credit">登记挂账</a>
              <a class="btn" href="#/online">线上订单</a>
              <a class="btn" href="#/members">会员积分</a>
            </div>
            <div class="alert info mt12" style="display:block">
              按报告的分工，销售负责开单、登记挂账与线上交付；改售价、核销赊账、确认折价由老板执行。
            </div>
          </div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>待办事项</h3><div class="actions"><span class="tag plain">${data.todo.length} 项</span></div></div>
          <div class="card-body">${todoCard(data.todo)}</div>
        </div>
      </div>
    </div>`;
}

/* ---------------- 角色工作台：供货商业务员 ---------------- */
function renderSupplier(wrap, data, user, greeting) {
  const s = data.supplier || {};
  wrap.innerHTML = `
    <div class="welcome">
      <div>
        <h3>${greeting}，${esc(user.name)}</h3>
        <p>${fmt.date(data.date)} ${fmt.weekday(data.date)} · 这里只展示与我方之间的订货单与对账单</p>
      </div>
      <div class="mini-stats">
        <div><b>${fmt.int(s.pendingOrders || 0)}</b><span>在途订货</span></div>
        <div><b>${fmt.int(s.pendingStatements || 0)}</b><span>待核对对账</span></div>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom:18px">
      ${stat({ label: '在途订货单', value: s.pendingOrders || 0, unit: '单', iconName: 'cart', sub: '<span>待确认或待发货</span>' })}
      ${stat({ label: '待核对对账单', value: s.pendingStatements || 0, unit: '份', iconName: 'file', tone: (s.pendingStatements || 0) ? 'warn' : 'ok', sub: '<span>含已提交与有差异</span>' })}
    </div>

    <div class="grid grid-side">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>可办理事项</h3></div>
          <div class="card-body">
            <div class="row" style="flex-wrap:wrap;gap:10px">
              <a class="btn" href="#/purchases">查看订货单</a>
              <a class="btn" href="#/settle">提交对账单</a>
            </div>
            <div class="alert info mt12" style="display:block">
              供货商只能看到与我方之间的订货与对账数据，看不到门店销售、库存与毛利。
            </div>
          </div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>待办事项</h3><div class="actions"><span class="tag plain">${data.todo.length} 项</span></div></div>
          <div class="card-body">${todoCard(data.todo)}</div>
        </div>
      </div>
    </div>`;
}
