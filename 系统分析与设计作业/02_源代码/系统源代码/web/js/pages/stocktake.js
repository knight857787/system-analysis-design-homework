/* 盘点与差异处理（UC-17） */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock,
  modal, drawer, confirmBox, stat as statCard,
} from '../core.js';

const STATUS = {
  Counting: { label: '盘点中', tone: 'warn' },
  Submitted: { label: '待老板批准确认', tone: 'info' },
  Approved: { label: '已批准调账', tone: 'ok' },
  Rejected: { label: '已驳回', tone: 'danger' },
};

export async function render(view, ctx) {
  const canSeeMoney = ((state.user || {}).role === 'Owner');
  const options = state.options;
  const isOwner = ctx.user.role === 'Owner';
  let tab = ctx.query.tab || 'plans';

  view.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="seg" data-tabs>
          <button data-tab="plans" class="${tab === 'plans' ? 'active' : ''}">盘点单</button>
          <button data-tab="diff" class="${tab === 'diff' ? 'active' : ''}">历史差异</button>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-sm btn-primary" data-new>${icon('plus')} 发起盘点</button>
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
    if (tab === 'diff') return renderDiff();
    return renderPlans();
  }

  async function renderPlans() {
    const res = await api.get('/api/stocktakes', { size: 20 });
    body.innerHTML = `
      <div class="alert info mb12" style="display:block">
        <b>盘点口径</b>：盘点期间冻结范围内库存变动，收银可继续但按盘点时点口径计算差异；
        差异必须登记原因，不允许直接改库存数；调账须经老板批准；差异率 = 差异金额合计 ÷ 盘点范围内按进价计的库存金额。
      </div>
      ${table({
        columns: [
          { label: '盘点单号', render: (r) => `<span class="mono">${esc(r.PlanNo)}</span><div class="sub">${fmt.datetime(r.PlannedAt)}</div>` },
          { label: '范围', render: (r) => tag(r.Scope, 'plain') },
          { label: '行数', cls: 'num', render: (r) => r.LineCount },
          { label: '未录', cls: 'num', render: (r) => r.Uncounted ? tag(r.Uncounted, 'warn') : '0' },
          { label: '差异行', cls: 'num', render: (r) => r.DiffLines ? tag(r.DiffLines, 'danger') : '0' },
          ...(canSeeMoney ? [{ label: '差异金额', cls: 'num', render: (r) => fmt.yuan(r.DiffAmount) }] : []),
          { label: '差异率', cls: 'num', render: (r) => `<b>${(r.DiffRate * 100).toFixed(2)}%</b>` },
          { label: '状态', render: (r) => tag((STATUS[r.Status] || {}).label || r.Status, (STATUS[r.Status] || {}).tone) },
          { label: '确认人', render: (r) => esc(r.ConfirmerName || '—') },
          { label: '', cls: 'actions', render: (r) => `<button class="btn btn-sm btn-primary" data-detail="${r.PlanID}">${r.Status === 'Counting' ? '录入实盘' : '查看'}</button>` },
        ],
        rows: res.items,
        empty: '还没有盘点记录，点右上角发起一次盘点',
      })}`;

    on(body, 'click', '[data-detail]', async (e, btn) => {
      const d = await api.get('/api/stocktakes/' + btn.dataset.detail);
      const plan = d.plan;
      const editable = plan.Status === 'Counting';
      const lines = d.lines;
      const drawerObj = drawer({
        title: '盘点单 ' + plan.PlanNo,
        subtitle: `${esc(plan.Scope)} · ${fmt.datetime(plan.PlannedAt)} · ${(STATUS[plan.Status] || {}).label || plan.Status}`,
        body: `
          <div class="grid grid-4" style="margin-bottom:14px">
            ${statCard({ label: '盘点行数', value: lines.length })}
            ${statCard({ label: '未录入', value: lines.filter((l) => l.CountedQty === null).length, tone: 'warn' })}
            ${statCard({ label: '差异金额', value: fmt.yuan(plan.DiffAmount), tone: 'danger' })}
            ${statCard({ label: '差异率', value: (plan.DiffRate * 100).toFixed(2) + '%', tone: 'info' })}
          </div>
          ${editable ? '<div class="alert warn mb12" style="display:block">按库位顺序逐项录入实盘数量；差异原因必须填写，容差（≤1 元且 ≤1 件）内自动标记为「正常」。</div>' : ''}
          <div class="table-wrap" style="max-height:52vh">
            <table class="table compact">
              <thead><tr><th>商品</th><th>批次 / 库位</th><th class="num">账面</th><th class="num">实盘</th><th class="num">差异</th><th>差异原因</th></tr></thead>
              <tbody>${lines.map((l, idx) => `
                <tr class="${l.DiffQty ? 'danger-row' : ''}">
                  <td><div class="strong">${esc(l.ProductName)}</div><div class="sub">${esc(l.Specification || '')}</div></td>
                  <td><span class="mono">${esc(l.BatchNo || '')}</span><div class="sub">${fmt.date(l.ExpiryDate)}</div></td>
                  <td class="num">${fmt.qty(l.BookQty)}</td>
                  <td>${editable
                    ? `<input class="input" data-count="${l.LineNo}" value="${l.CountedQty === null ? '' : fmt.qty(l.CountedQty)}" style="height:28px;width:82px" placeholder="未盘">`
                    : fmt.qty(l.CountedQty)}</td>
                  <td class="num">${l.DiffQty === null || l.DiffQty === undefined ? '—'
                    : `<span class="${l.DiffQty ? 'trend-down' : ''}">${fmt.signed(l.DiffQty)}</span>`}</td>
                  <td>${editable
                    ? `<input class="input" data-reason="${l.LineNo}" value="${esc(l.DiffReason || '')}" style="height:28px;width:110px" placeholder="破损/过期/漏记">`
                    : esc(l.DiffReason || '—')}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>`,
        footer: editable
          ? `<button class="btn" data-save>保存实盘</button>
             <button class="btn btn-primary" data-submit>提交盘点</button>`
          : (plan.Status === 'Submitted' && isOwner
            ? `<button class="btn btn-danger" data-reject>驳回，不调账</button>
               <button class="btn btn-primary" data-approve>批准调账</button>` : ''),
      });

      const foot = drawerObj.foot;
      const collect = () => Array.from(foot.closest('.drawer').querySelectorAll('[data-count]')).map((inp) => {
        const lineNo = Number(inp.dataset.count);
        const reasonEl = foot.closest('.drawer').querySelector(`[data-reason="${lineNo}"]`);
        return { lineNo, countedQty: inp.value === '' ? null : Number(inp.value), diffReason: reasonEl ? reasonEl.value : '' };
      }).filter((l) => l.countedQty !== null);

      if (editable) {
        foot.querySelector('[data-save]').addEventListener('click', async () => {
          const payload = collect();
          if (!payload.length) { toast('还没有录入实盘数量', 'warn'); return; }
          try {
            const r2 = await api.post(`/api/stocktakes/${plan.PlanID}/count`, { lines: payload });
            toast(r2.message, 'ok');
            drawerObj.close(); route();
          } catch (err) { toast(err.message, 'error', 5000); }
        });
        foot.querySelector('[data-submit]').addEventListener('click', async () => {
          const payload = collect();
          try {
            if (payload.length) await api.post(`/api/stocktakes/${plan.PlanID}/count`, { lines: payload });
            const r2 = await api.post(`/api/stocktakes/${plan.PlanID}/submit`);
            toast(r2.message + `，差异率 ${r2.diffRate}%`, 'ok', 5000);
            drawerObj.close(); route();
          } catch (err) { toast(err.message, 'error', 5600); }
        });
      }
      if (plan.Status === 'Submitted' && isOwner) {
        foot.querySelector('[data-approve]').addEventListener('click', async () => {
          const ok = await confirmBox({ title: '批准调账', message: '批准后系统按差异数量生成 StockAdjust 并更新库存台账，盘点单锁定。', confirmText: '批准调账' });
          if (!ok) return;
          try {
            const r2 = await api.post(`/api/stocktakes/${plan.PlanID}/approve`, { decision: 'approve' });
            toast(r2.message, 'ok', 4600);
            drawerObj.close(); route();
          } catch (err) { toast(err.message, 'error', 5000); }
        });
        foot.querySelector('[data-reject]').addEventListener('click', async () => {
          try {
            const r2 = await api.post(`/api/stocktakes/${plan.PlanID}/approve`, { decision: 'reject' });
            toast(r2.message, 'warn', 4600);
            drawerObj.close(); route();
          } catch (err) { toast(err.message, 'error'); }
        });
      }
    });
  }

  async function renderDiff() {
    const res = await api.get('/api/stocktakes', { size: 20 });
    const approved = res.items.filter((p) => p.Status === 'Approved');
    body.innerHTML = `
      <div class="grid grid-3 mb12">
        ${statCard({ label: '已完成盘点', value: approved.length, unit: '次', iconName: 'clipboard', sub: '账实相符的闭环' })}
        ${statCard({ label: '最近差异率', value: approved.length ? (approved[0].DiffRate * 100).toFixed(2) + '%' : '—',
          tone: 'info', iconName: 'chart', sub: '目标 ≤ 1%' })}
        ${statCard({ label: '累计差异金额', value: fmt.yuan(approved.reduce((s, p) => s + (p.DiffAmount || 0), 0), 0),
          tone: 'warn', iconName: 'alert', sub: '差异必须有原因' })}
      </div>
      ${table({
        columns: [
          { label: '盘点单号', render: (r) => `<span class="mono">${esc(r.PlanNo)}</span>` },
          { label: '范围', render: (r) => esc(r.Scope) },
          { label: '行数', cls: 'num', render: (r) => r.LineCount },
          { label: '差异行', cls: 'num', render: (r) => r.DiffLines },
          { label: '差异金额', cls: 'num', render: (r) => fmt.yuan(r.DiffAmount) },
          { label: '差异率', cls: 'num', render: (r) => (r.DiffRate * 100).toFixed(2) + '%' },
          { label: '确认时间', render: (r) => fmt.datetime(r.ConfirmedAt) },
          { label: '状态', render: (r) => tag((STATUS[r.Status] || {}).label || r.Status, (STATUS[r.Status] || {}).tone) },
        ],
        rows: res.items,
        empty: '还没有盘点记录',
      })}`;
  }

  $('[data-new]', view).addEventListener('click', () => {
    modal({
      title: '发起盘点',
      desc: '选择盘点范围后，系统按台账生成盘点清单（商品 + 批次 + 账面数量），按库位排序',
      content: `<div class="form-grid">
          <div class="field"><label>盘点范围<span class="req">*</span></label>
            <select class="select" name="scope">
              <option value="全店">全店</option>
              ${(options.categories || []).map((c) => `<option value="${esc(c.CategoryName)}">${esc(c.CategoryName)}</option>`).join('')}
            </select></div>
          <div class="field"><label>备注</label><input class="input" name="note" placeholder="如：月度全店盘点，收银不停业"></div>
        </div>`,
      onSubmit: async (v) => {
        const r2 = await api.post('/api/stocktakes', { scope: v.scope, note: v.note });
        toast(r2.message + `（${r2.lines} 行）`, 'ok');
        route();
      },
    });
  });

  await route();
}
