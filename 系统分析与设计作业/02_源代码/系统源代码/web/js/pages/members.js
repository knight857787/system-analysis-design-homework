/* 会员与积分（UC-14） */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock,
  modal, drawer, stat as statCard, barList,
} from '../core.js';

export async function render(view, ctx) {
  const options = state.options;
  const isOwner = ctx.user.role === 'Owner';
  let days = 30;

  view.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <h3 style="margin:0;font-size:14.5px">会员与积分</h3>
        <select class="select" data-days>
          <option value="30">近 30 天</option>
          <option value="60">近 60 天</option>
          <option value="90">近 90 天</option>
        </select>
        <div class="spacer"></div>
        <span class="tag plain">1 元 = 1 分；收银与线上订单自动累计</span>
        ${isOwner ? `<button class="btn btn-sm btn-primary" data-new>${icon('plus')} 会员建档</button>` : ''}
      </div>
      <div class="card-body" data-body>${loadingBlock()}</div>
    </div>`;

  const body = $('[data-body]', view);
  $('[data-days]', view).addEventListener('change', (e) => { days = Number(e.target.value); load(); });

  async function load() {
    body.innerHTML = loadingBlock();
    const res = await api.get('/api/members', { days });
    const s = res.summary;
    body.innerHTML = `
      <div class="grid grid-4 mb12">
        ${statCard({ label: '会员总数', value: s.total, unit: '人', iconName: 'users', sub: `积分合计 ${fmt.int(s.points)}` })}
        ${statCard({ label: `近 ${days} 天活跃`, value: s.active, unit: '人', tone: 'info', iconName: 'user',
          sub: `活跃率 ${fmt.pct(s.activeRate)}` })}
        ${statCard({ label: '复购会员（≥2 次）', value: s.repurchase, unit: '人', tone: s.repurchaseRate >= 20 ? 'ok' : 'warn',
          iconName: 'chart', sub: `复购率 ${fmt.pct(s.repurchaseRate)} · 目标 20%` })}
        ${statCard({ label: '近 ' + days + ' 天未消费', value: s.noVisit, unit: '人', tone: 'warn', iconName: 'alert',
          sub: '先把老客请回来' })}
      </div>
      ${s.noVisit ? `<div class="alert info mb12" style="display:block">
        <b>召回建议</b>：${s.noVisit} 位会员近 ${days} 天没有消费记录。报告基线是「会员 11 人、无消费占比 100%」，
        试运行目标为复购率 20% 以上（30 天内至少 2 位老客回头）。
      </div>` : ''}
      ${table({
        columns: [
          { label: '会员', render: (r) => `<div class="strong">${esc(r.Name)}</div><div class="sub mono">${esc(r.MemberNo)} · ${esc(r.Phone || '—')}</div>` },
          { label: '等级', render: (r) => tag(r.Level || '普通', r.Level === '金卡' ? 'warn' : r.Level === '银卡' ? 'info' : 'plain') },
          { label: '积分', cls: 'num strong', render: (r) => fmt.int(r.Points) },
          { label: `近 ${days} 天单数`, cls: 'num', render: (r) => r.OrdersRecent || 0 },
          { label: `近 ${days} 天消费`, cls: 'num', render: (r) => fmt.yuan(r.AmountRecent || 0) },
          { label: '累计单数', cls: 'num', render: (r) => r.OrdersTotal || 0 },
          { label: '累计消费', cls: 'num', render: (r) => fmt.yuan(r.AmountTotal || 0) },
          { label: '最近到店', render: (r) => r.LastOrderAt ? fmt.ago(r.LastOrderAt) : '<span class="tag warn">未消费</span>' },
          { label: '入会日期', render: (r) => fmt.date(r.JoinDate) },
          { label: '', cls: 'actions', render: (r) => `
            <button class="btn btn-sm" data-points="${r.MemberID}" data-name="${esc(r.Name)}" data-point="${r.Points}">积分</button>
            <button class="btn btn-sm" data-history="${r.MemberID}" data-name="${esc(r.Name)}">流水</button>` },
        ],
        rows: res.items,
        empty: '还没有会员，请从收银时选择顾客或在此建档',
      })}`;

    on(body, 'click', '[data-points]', (e, btn) => {
      modal({
        title: '积分调整 · ' + btn.dataset.name,
        desc: `当前可用积分 ${fmt.int(Number(btn.dataset.point))}`,
        content: `<div class="form-grid">
            <div class="field"><label>类型</label><select class="select" name="entryType">
              <option value="earn">累计（奖励/补录）</option><option value="redeem">兑换（扣减）</option></select></div>
            <div class="field"><label>积分数量<span class="req">*</span></label><input class="input" name="points" value="50"></div>
            <div class="field full"><label>备注</label><input class="input" name="note" placeholder="如：老客回归奖励"></div>
          </div>`,
        onSubmit: async (v) => {
          const r2 = await api.post(`/api/members/${btn.dataset.points}/points`, {
            entryType: v.entryType, points: Number(v.points), note: v.note,
          });
          toast(r2.message, 'ok');
          load();
        },
      });
    });

    on(body, 'click', '[data-history]', async (e, btn) => {
      const d = await api.get(`/api/members/${btn.dataset.history}/points`);
      drawer({
        title: '积分流水 · ' + btn.dataset.name,
        body: table({
          compact: true,
          columns: [
            { label: '时间', render: (r) => fmt.datetime(r.OccurredAt) },
            { label: '类型', render: (r) => tag(r.EntryType === 'earn' ? '累计' : '兑换', r.EntryType === 'earn' ? 'ok' : 'warn') },
            { label: '积分', cls: 'num', render: (r) => (r.EntryType === 'earn' ? '+' : '−') + fmt.int(r.Points) },
            { label: '关联单号', render: (r) => esc(r.OrderRef || '—') },
            { label: '说明', render: (r) => esc(r.Note || '') },
          ],
          rows: d.items,
          empty: '没有积分流水',
        }),
      });
    });

    const newBtn = $('[data-new]', view);
    if (newBtn) newBtn.onclick = async () => {
      const custs = await api.get('/api/customers', { size: 200 });
      const nonMembers = custs.items.filter((c) => !c.MemberID);
      modal({
        title: '会员建档',
        desc: '会员是经营对象，顾客是交易对象；一个顾客可以不是会员，也可以同时是会员',
        content: `<div class="form-grid">
            <div class="field full"><label>选择顾客<span class="req">*</span></label>
              <select class="select" name="customerId">
                ${nonMembers.map((c) => `<option value="${c.CustomerID}">${esc(c.Name)} · ${esc(c.Phone || '无电话')}</option>`).join('') ||
                  '<option value="">（没有可建档的顾客，请先在熟客赊账 → 顾客档案中建档）</option>'}
              </select></div>
            <div class="field"><label>会员等级</label><select class="select" name="level">
              <option>普通</option><option>银卡</option><option>金卡</option></select></div>
          </div>`,
        onSubmit: async (v) => {
          if (!v.customerId) throw new Error('没有可建档的顾客');
          const r2 = await api.post('/api/members', { customerId: Number(v.customerId), level: v.level });
          toast(r2.message, 'ok');
          load();
        },
      });
    };
  }

  await load();
}
