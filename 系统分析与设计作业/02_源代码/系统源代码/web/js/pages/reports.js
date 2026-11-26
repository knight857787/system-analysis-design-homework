/* 经营分析（UC-08） */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock,
  chartLine, chartDonut, barList, stat as statCard, downloadCsv,
} from '../core.js';

export async function render(view, ctx) {
  let from = ctx.query.from || fmt.dateOffset(-29);
  let to = ctx.query.to || fmt.today();

  view.innerHTML = `
    <div class="card mb12">
      <div class="toolbar">
        <div class="seg" data-range>
          <button data-days="6">近 7 天</button>
          <button data-days="29" class="active">近 30 天</button>
          <button data-days="89">近 90 天</button>
        </div>
        <input class="input" type="date" data-from value="${from}" style="width:150px">
        <span class="muted">至</span>
        <input class="input" type="date" data-to value="${to}" style="width:150px">
        <button class="btn btn-sm" data-apply>应用</button>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-export>导出明细 CSV</button>
      </div>
    </div>
    <div data-body>${loadingBlock('正在汇总经营数据…')}</div>`;

  const body = $('[data-body]', view);
  $$('[data-range] button', view).forEach((b) => b.addEventListener('click', () => {
    from = fmt.dateOffset(-Number(b.dataset.days));
    to = fmt.today();
    $('[data-from]', view).value = from;
    $('[data-to]', view).value = to;
    $$('[data-range] button', view).forEach((x) => x.classList.toggle('active', x === b));
    load();
  }));
  $('[data-apply]', view).addEventListener('click', () => {
    from = $('[data-from]', view).value;
    to = $('[data-to]', view).value;
    load();
  });
  $('[data-export]', view).addEventListener('click', async () => {
    const res = await api.get('/api/reports/margin', { from, to });
    downloadCsv(`商品毛利_${from}_${to}.csv`,
      res.byProduct.map((p) => [p.name, p.specification, p.category, p.qty, p.amount, p.cost, p.profit, p.margin]),
      ['商品', '规格', '品类', '销量', '销售额', '成本', '毛利', '毛利率%']);
    toast('已导出商品毛利明细', 'ok');
  });

  async function load() {
    body.innerHTML = loadingBlock('正在汇总经营数据…');
    let s;
    try {
      s = await api.get('/api/reports/summary', { from, to });
    } catch (err) {
      body.innerHTML = `<div class="alert danger" style="display:block">${esc(err.message)}</div>`;
      return;
    }
    const loss = s.loss;
    body.innerHTML = `
      <div class="grid grid-4" style="margin-bottom:18px">
        ${statCard({ label: '销售额', value: fmt.yuan(s.sales.amount, 0), iconName: 'cash',
          sub: `${s.sales.orders} 单 · 单均价 ${fmt.yuan(s.sales.avgTicket)} · 日均 ${fmt.yuan(s.sales.dailyAvg, 0)}` })}
        ${statCard({ label: '毛利 / 毛利率', value: fmt.yuan(s.sales.profit, 0), tone: 'info', iconName: 'chart',
          sub: `毛利率 <b>${fmt.pct(s.sales.margin)}</b> · 成本 ${fmt.yuan(s.sales.cost, 0)}` })}
        ${statCard({ label: '损耗金额 / 损耗率', value: fmt.yuan(loss.amount, 0), tone: loss.rate > 1 ? 'warn' : '',
          iconName: 'alert', sub: `${loss.count} 单报损 · 损耗率 ${fmt.pct(loss.rate, 2)}` })}
        ${statCard({ label: '库存周转', value: s.stock.turnover, unit: '次', tone: 'violet', iconName: 'boxes',
          sub: `库存成本 ${fmt.yuan(s.stock.value, 0)} · 期间出库成本 ${fmt.yuan(s.sales.cost, 0)}` })}
      </div>

      <div class="grid grid-side">
        <div class="stack">
          <div class="card">
            <div class="card-head">
              <div><h3>销售与毛利趋势</h3><div class="desc">${from} ~ ${to}</div></div>
              <div class="actions"><span class="tag plain">成交成本快照口径</span></div>
            </div>
            <div class="card-body">
              ${chartLine({ data: s.trend, series: [
                { key: 'amount', label: '销售额', color: '#0f9d6e' },
                { key: 'profit', label: '毛利', color: '#3b82f6' },
              ], height: 220, yLabel: '元' })}
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>品类结构与毛利率</h3></div>
            <div class="card-body flush">
              ${table({
                compact: true,
                columns: [
                  { label: '品类', render: (r) => `<b>${esc(r.name)}</b>` },
                  { label: '销售额', cls: 'num', render: (r) => fmt.yuan(r.amount) },
                  { label: '占比', cls: 'num', render: (r) => fmt.pct(r.share) },
                  { label: '成本', cls: 'num', render: (r) => fmt.yuan(r.cost) },
                  { label: '毛利', cls: 'num strong', render: (r) => fmt.yuan(r.profit) },
                  { label: '毛利率', cls: 'num', render: (r) => tag(fmt.pct(r.margin), r.margin >= 17 ? 'ok' : 'warn') },
                ],
                rows: s.byCategory,
              })}
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>损耗明细</h3><div class="actions"><a class="btn btn-sm" href="#/expiry">去处理临期</a></div></div>
            <div class="card-body">
              <div class="grid grid-2">
                <div>
                  <div class="section-title">按原因</div>
                  ${loss.byReason.length ? barList({
                    items: loss.byReason.map((r) => ({ label: r.name, value: r.amount, tone: 'danger' })),
                  }) : emptyState('期间内没有已确认报损')}
                </div>
                <div>
                  <div class="section-title">按品类</div>
                  ${loss.byCategory.length ? barList({
                    items: loss.byCategory.map((r) => ({ label: r.name, value: r.amount, tone: 'warn' })),
                  }) : emptyState('期间内没有已确认报损')}
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>畅销商品（按销售额）</h3></div>
            <div class="card-body flush">
              ${table({
                compact: true,
                columns: [
                  { label: '商品', render: (r) => `<b>${esc(r.name)}</b> <span class="tiny muted">${esc(r.Unit)}</span>` },
                  { label: '销量', cls: 'num', render: (r) => fmt.qty(r.qty) },
                  { label: '销售额', cls: 'num strong', render: (r) => fmt.yuan(r.amount) },
                  { label: '毛利', cls: 'num', render: (r) => fmt.yuan(r.profit) },
                  { label: '毛利率', cls: 'num', render: (r) => fmt.pct((r.profit / r.amount) * 100) },
                ],
                rows: s.topProducts,
                empty: '期间内没有销售',
              })}
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-head"><h3>支付结构</h3></div>
            <div class="card-body">
              ${chartDonut({
                items: s.payMethods.map((p) => ({ label: p.method, value: p.amount })),
                size: 138, centerTop: fmt.yuan(s.payMethods.reduce((a, p) => a + p.amount, 0), 0), centerSub: '实收合计',
              })}
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>线上与会员</h3></div>
            <div class="card-body">
              <dl class="kv kv-sm">
                <dt>线上订单</dt><dd>${s.online.orders} 单 · ${fmt.yuan(s.online.amount)}</dd>
                <dt>线上占比</dt><dd>${fmt.pct(s.online.share)}（目标日均 10 单）</dd>
                <dt>会员总数</dt><dd>${s.member.total} 人</dd>
                <dt>近 30 天复购</dt><dd>${s.member.active} 人 · <b>${fmt.pct(s.member.repurchaseRate)}</b></dd>
                <dt>临期待处理</dt><dd>${s.expiry.pending} 项 · 已过期 ${s.expiry.expired} 项</dd>
                <dt>今日处理单</dt><dd>${s.expiry.todayHandling} 张</dd>
                <dt>保质期录入率</dt><dd>${fmt.pct(s.expiry.shelfLifeInputRate)}</dd>
              </dl>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>取数口径</h3></div>
            <div class="card-body">
              <div class="tiny muted" style="line-height:1.9">
                毛利 = SaleLine.Amount − SaleLine.CostAmount（成本取成交时批次进价的快照，不用现价重算）<br>
                毛利率 = 毛利 ÷ 销售额<br>
                损耗率 = 已确认报损金额 ÷ 期间销售额<br>
                库存周转 = 期间出库成本 ÷ 平均库存金额（按当前库存成本近似）<br>
                会员复购率 = 期间消费 ≥2 次的会员数 ÷ 会员总数
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  await load();
}
