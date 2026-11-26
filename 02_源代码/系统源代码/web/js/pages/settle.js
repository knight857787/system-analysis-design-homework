/* 供应商对账（UC-02）、应付账款与付款（UC-07） */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock, stat,
  modal, drawer, confirmBox, stat as statCard,
} from '../core.js';

const STATUS = {
  Submitted: { label: '待老板确认', tone: 'warn' },
  Disputed: { label: '有争议待答复', tone: 'danger' },
  Confirmed: { label: '已确认', tone: 'ok' },
  Cancelled: { label: '已作废', tone: 'plain' },
};
const SOURCE = { Receipt: '收货', Return: '退货', Expense: '费用' };

export async function render(view, ctx) {
  const options = state.options;
  const isOwner = ctx.user.role === 'Owner';
  const isSupplier = ctx.user.role === 'Supplier';
  let tab = ctx.query.tab || 'statements';

  view.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="seg" data-tabs>
          <button data-tab="statements" class="${tab === 'statements' ? 'active' : ''}">对账单</button>
          ${isSupplier ? '' : `<button data-tab="payables" class="${tab === 'payables' ? 'active' : ''}">应付账款</button>
          <button data-tab="payments" class="${tab === 'payments' ? 'active' : ''}">付款记录</button>`}
        </div>
        <div class="spacer"></div>
        <span data-info class="tag plain"></span>
        ${isSupplier ? '<button class="btn btn-sm btn-primary" data-new>' + icon('plus') + ' 提交对账单</button>' : ''}
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
    if (tab === 'payables') return renderPayables();
    if (tab === 'payments') return renderPayments();
    return renderStatements();
  }

  /* ------------------------------------------------------------ 对账单 */
  async function renderStatements() {
    const res = await api.get('/api/statements', { size: 30 });
    const s = res.summary || {};
    $('[data-info]', view).textContent = `待处理 ${s.pending || 0} 份`;
    body.innerHTML = `
      <div class="grid grid-3 mb12">
        ${statCard({ label: '待核对对账单', value: s.pending || 0, unit: '份', tone: 'warn', iconName: 'file',
          sub: '差异项需逐条答复' })}
        ${statCard({ label: '待核对差异金额', value: fmt.yuan(s.diffTotal || 0, 0), tone: 'danger', iconName: 'alert',
          sub: '对方金额 − 本方金额' })}
        ${statCard({ label: '未结应付账款', value: fmt.yuan(s.payable || 0, 0), tone: 'info', iconName: 'wallet',
          sub: '按约定账期生成结算计划' })}
      </div>
      <div class="alert info mb12" style="display:block">
        <b>对账口径</b>：以双方确认的送货记录与退货记录为准；费用扣减须符合合同约定；争议项不进入本期应付；
        对账结果一经双方确认不得修改，更正须生成新的调整记录。
      </div>
      ${table({
        columns: [
          { label: '对账单号', render: (r) => `<span class="mono">${esc(r.StatementNo)}</span>` },
          { label: '供应商', render: (r) => esc(r.SupplierName) },
          { label: '对账期间', render: (r) => `<span class="nowrap">${fmt.date(r.PeriodStart)} ~ ${fmt.date(r.PeriodEnd)}</span>` },
          { label: '进货', cls: 'num', render: (r) => fmt.yuan(r.PurchaseAmount) },
          { label: '退货', cls: 'num', render: (r) => fmt.yuan(r.ReturnAmount) },
          { label: '费用', cls: 'num', render: (r) => fmt.yuan(r.ExpenseAmount) },
          { label: '对方合计', cls: 'num', render: (r) => fmt.yuan(r.CounterpartyAmount) },
          { label: '本方合计', cls: 'num strong', render: (r) => fmt.yuan(r.OurAmount) },
          { label: '差异', cls: 'num', render: (r) => Math.abs(r.DiffAmount) > 0.001
            ? `<span class="tag ${r.DiffAmount > 0 ? 'warn' : 'info'}">${fmt.yuan(r.DiffAmount)}</span>` : '<span class="muted">一致</span>' },
          { label: '状态', render: (r) => tag((STATUS[r.StatementStatus] || {}).label || r.StatementStatus, (STATUS[r.StatementStatus] || {}).tone) },
          { label: '', cls: 'actions', render: (r) => `<button class="btn btn-sm" data-detail="${r.StatementID}">核对</button>` },
        ],
        rows: res.items,
        empty: '还没有对账单',
      })}`;

    on(body, 'click', '[data-detail]', async (e, btn) => {
      const d = await api.get('/api/statements/' + btn.dataset.detail);
      const head = d.statement;
      const canEdit = head.StatementStatus === 'Submitted' || head.StatementStatus === 'Disputed';
      const drawerObj = drawer({
        title: '对账单 ' + head.StatementNo,
        subtitle: `${esc(head.SupplierName)} · ${fmt.date(head.PeriodStart)} ~ ${fmt.date(head.PeriodEnd)} · ${(STATUS[head.StatementStatus] || {}).label || head.StatementStatus}`,
        body: `
          <div class="grid grid-4" style="margin-bottom:14px">
            ${statCard({ label: '进货金额', value: fmt.yuan(head.PurchaseAmount, 0) })}
            ${statCard({ label: '退货金额', value: fmt.yuan(head.ReturnAmount, 0), tone: 'info' })}
            ${statCard({ label: '费用扣减', value: fmt.yuan(head.ExpenseAmount, 0), tone: 'violet' })}
            ${statCard({ label: '应付金额', value: fmt.yuan(head.PayableAmount, 0), tone: 'warn' })}
          </div>
          <div class="alert ${Math.abs(head.DiffAmount) > 0.001 ? 'warn' : 'ok'}" style="display:block">
            <b>${Math.abs(head.DiffAmount) > 0.001 ? '存在差异' : '双方一致'}</b>：对方合计 ${fmt.yuan(head.CounterpartyAmount)}，
            本方合计 ${fmt.yuan(head.OurAmount)}，差异 <b>${fmt.yuan(head.DiffAmount)}</b>。
            ${d.lines.filter((l) => Math.abs(l.DiffAmount) > 0.001).length} 行需要处理。
          </div>
          <div class="section-title mt16">逐项核对（差异行已标红）</div>
          ${table({
            compact: true,
            columns: [
              { label: '来源', render: (r) => tag(r.sourceLabel, r.SourceType === 'Receipt' ? 'plain' : 'info') },
              { label: '单号 / 日期', render: (r) => `<span class="mono">${esc(r.SourceDocNo)}</span><div class="sub">${fmt.date(r.OccurredDate)}</div>` },
              { label: '对方金额', cls: 'num', render: (r) => fmt.yuan(r.CounterpartyAmount) },
              { label: '本方金额', cls: 'num', render: (r) => fmt.yuan(r.OurAmount) },
              { label: '差异', cls: 'num', render: (r) => Math.abs(r.DiffAmount) > 0.001
                ? `<span class="tag danger">${fmt.yuan(r.DiffAmount)}</span>` : '<span class="muted">0.00</span>' },
              { label: '差异原因 / 答复', render: (r) => `<div class="sub">${esc(r.DiffReason || '')}</div>${r.Resolution ? '<div class="tiny">答复：' + esc(r.Resolution) + '</div>' : ''}` },
              { label: '', cls: 'actions', render: (r) => (canEdit && Math.abs(r.DiffAmount) > 0.001)
                ? `<button class="btn btn-sm" data-line="${r.StatementLineID}">答复</button>` : '' },
            ],
            rows: d.lines,
            rowClass: (r) => (Math.abs(r.DiffAmount) > 0.001 ? 'danger-row' : ''),
          })}
          ${d.payable ? `<div class="section-title mt16">应付与付款</div>
            <dl class="kv kv-sm">
              <dt>应付单号</dt><dd class="mono">${esc(d.payable.PayableNo)}</dd>
              <dt>应付金额</dt><dd>${fmt.yuan(d.payable.PayableAmount)}</dd>
              <dt>已付</dt><dd>${fmt.yuan(d.payable.PaidAmount)}</dd>
              <dt>计划付款日</dt><dd>${fmt.date(d.payable.PlannedPayDate)} · ${tag(d.payable.PayableStatus === 'Closed' ? '已结清' : d.payable.PayableStatus === 'Partial' ? '部分付款' : '待付款', d.payable.PayableStatus === 'Closed' ? 'ok' : 'warn')}</dd>
            </dl>` : ''}`,
        footer: canEdit && isOwner
          ? `<button class="btn btn-primary" data-approve>确认对账结果</button>
             <button class="btn" data-hold>争议挂起，先结无争议部分</button>`
          : (canEdit && isSupplier ? '<span class="tag info">等待老板确认或答复差异</span>' : ''),
      });

      drawerObj.body.querySelectorAll('[data-line]').forEach((btn2) => btn2.addEventListener('click', () => {
        const line = d.lines.find((l) => String(l.StatementLineID) === btn2.dataset.line);
        modal({
          title: '处理对账差异',
          desc: `${SOURCE[line.SourceType]} ${line.SourceDocNo} · 对方 ${fmt.yuan(line.CounterpartyAmount)} / 本方 ${fmt.yuan(line.OurAmount)}`,
          content: `<div class="form-grid">
              <div class="field"><label>对方金额</label><input class="input" name="counterpartyAmount" value="${line.CounterpartyAmount}" ${isSupplier ? 'readonly' : ''}></div>
              <div class="field"><label>凭证 / 依据</label><input class="input" name="voucher" value="${esc(line.Voucher || '')}" placeholder="如送货单照片编号"></div>
              <div class="field full"><label>答复 / 处理意见<span class="req">*</span></label>
                <textarea class="textarea" name="resolution" placeholder="例如：已核对送货单，按本方记录为准">${esc(line.Resolution || '')}</textarea></div>
            </div>`,
          onSubmit: async (v) => {
            const r2 = await api.post(`/api/statements/${head.StatementID}/lines/${line.StatementLineID}`, {
              counterpartyAmount: isSupplier ? undefined : Number(v.counterpartyAmount),
              resolution: v.resolution, voucher: v.voucher,
            });
            toast(r2.message + (r2.diffLines !== undefined ? `，剩余 ${r2.diffLines} 处差异` : ''), 'ok');
            drawerObj.close();
            route();
          },
        });
      }));

      const approveBtn = drawerObj.foot.querySelector('[data-approve]');
      if (approveBtn) approveBtn.addEventListener('click', async () => {
        const ok = await confirmBox({ title: '确认对账结果', confirmText: '确认生成应付',
          message: '确认后对账结果不可修改，系统将按约定账期生成应付账款与结算计划。' });
        if (!ok) return;
        try {
          const r2 = await api.post(`/api/statements/${head.StatementID}/confirm`, {});
          toast(r2.message, 'ok', 5000);
          drawerObj.close(); route();
        } catch (err) { toast(err.message, 'error', 5600); }
      });
      const holdBtn = drawerObj.foot.querySelector('[data-hold]');
      if (holdBtn) holdBtn.addEventListener('click', async () => {
        const ok = await confirmBox({ title: '争议项挂起', confirmText: '按无争议部分生成应付',
          message: '争议项转入下期对账，本期按无争议部分生成应付账款。差异处理意见仍保留在对账单上。' });
        if (!ok) return;
        try {
          const r2 = await api.post(`/api/statements/${head.StatementID}/confirm`, { holdDispute: true });
          toast(r2.message, 'ok', 5000);
          drawerObj.close(); route();
        } catch (err) { toast(err.message, 'error', 5600); }
      });
    });
  }

  /* ------------------------------------------------------------ 新建对账单 */
  const newBtn = $('[data-new]', view);
  if (newBtn) newBtn.addEventListener('click', () => openNewStatement());

  function openNewStatement() {
    const suppliers = options.suppliers || [];
    const firstSupplier = isSupplier ? suppliers.find((s) => s.SupplierID === ctx.user.supplierId) : suppliers[0];
    const lastMonthEnd = (() => {
      const d = new Date();
      d.setDate(0);
      return d.toISOString().slice(0, 10);
    })();
    const monthStart = lastMonthEnd.slice(0, 8) + '01';
    let previewRows = [];
    let previewMeta = null;

    const m = modal({
      title: '提交对账单',
      desc: '先选择供应商与对账期间，加载本方进货、退货与费用记录，再逐行填写对方金额',
      size: 'wide', submitText: '提交对账单',
      extraButtons: [{ key: 'load', label: '加载本方明细', kind: 'btn-primary' }],
      content: `
        <div class="form-grid mb12">
          <div class="field"><label>供应商<span class="req">*</span></label>
            <select class="select" name="supplierId" ${isSupplier ? 'disabled' : ''}>
              ${suppliers.map((s) => `<option value="${s.SupplierID}" ${firstSupplier && s.SupplierID === firstSupplier.SupplierID ? 'selected' : ''}>${esc(s.Name)}</option>`).join('')}
            </select></div>
          <div class="field"><label>对账期间<span class="req">*</span></label>
            <div class="row" style="gap:6px">
              <input class="input" type="date" name="periodStart" value="${monthStart}">
              <span class="muted">至</span>
              <input class="input" type="date" name="periodEnd" value="${lastMonthEnd}">
            </div></div>
        </div>
        <div data-preview><div class="muted small">点击「加载本方明细」后，系统按收货、退货、费用三类凭证生成本方金额。</div></div>`,
      onSubmit: async (v) => {
        if (!previewRows.length) throw new Error('请先加载本方明细');
        const supplierId = isSupplier ? ctx.user.supplierId : Number(document.querySelector('[name=supplierId]').value);
        const lines = previewRows.map((r, idx) => ({
          sourceDocNo: r.sourceDocNo,
          amount: Number(document.querySelector(`[name=cp_${idx}]`)?.value || 0),
        }));
        const r2 = await api.post('/api/statements', {
          supplierId, periodStart: v.periodStart, periodEnd: v.periodEnd, lines,
          note: '系统按本方进货、退货与费用记录生成，差异待双方确认',
        });
        toast(r2.message + `（差异 ${fmt.yuan(r2.diffAmount)}）`, 'ok', 5200);
        route();
      },
    });

    const loadBtn = m.el.querySelector('[data-extra="load"]');
    loadBtn.addEventListener('click', async () => {
      loadBtn.disabled = true;
      loadBtn.textContent = '加载中…';
      try {
        const supplierId = isSupplier ? ctx.user.supplierId : Number(m.form.querySelector('[name=supplierId]').value);
        const start = m.form.querySelector('[name=periodStart]').value;
        const end = m.form.querySelector('[name=periodEnd]').value;
        const res = await api.get('/api/statements/preview', { supplierId, periodStart: start, periodEnd: end });
        previewRows = res.items;
        previewMeta = res;
        const box = m.el.querySelector('[data-preview]');
        if (!res.items.length) {
          box.innerHTML = '<div class="alert warn" style="display:block">该期间没有本方进货、退货或费用记录，无法生成对账单。</div>';
        } else {
          box.innerHTML = `<div class="row mb8"><b>本方合计 ${fmt.yuan(res.ourAmount)}</b>
              <span class="muted small">共 ${res.count} 笔凭证，可逐行修改「对方金额」以登记对方口径</span></div>
            <div class="table-wrap" style="max-height:44vh"><table class="table compact">
              <thead><tr><th>来源</th><th>单号</th><th>日期</th><th class="num">本方金额</th><th class="num">对方金额</th><th class="num">差异</th></tr></thead>
              <tbody>${res.items.map((r, idx) => `<tr>
                <td>${tag(r.label, r.sourceType === 'Receipt' ? 'plain' : 'info')}</td>
                <td class="mono">${esc(r.sourceDocNo)}</td><td>${fmt.date(r.occurredDate)}</td>
                <td class="num">${fmt.yuan(r.ourAmount)}</td>
                <td><input class="input" name="cp_${idx}" value="${r.ourAmount}" style="height:28px;width:96px;text-align:right" data-idx="${idx}"></td>
                <td class="num" data-diff="${idx}">0.00</td></tr>`).join('')}</tbody></table></div>`;
          box.querySelectorAll('[data-idx]').forEach((inp) => inp.addEventListener('input', () => {
            const idx = Number(inp.dataset.idx);
            const diff = Number(inp.value || 0) - res.items[idx].ourAmount;
            const cell = box.querySelector(`[data-diff="${idx}"]`);
            cell.textContent = fmt.money(diff);
            cell.innerHTML = Math.abs(diff) > 0.001 ? `<span class="tag danger">${fmt.yuan(diff)}</span>` : '<span class="muted">0.00</span>';
          }));
        }
      } catch (err) {
        toast(err.message, 'error', 5000);
      } finally {
        loadBtn.disabled = false;
        loadBtn.textContent = '加载本方明细';
      }
    });
  }

  /* ------------------------------------------------------------ 应付 */
  async function renderPayables() {
    const res = await api.get('/api/payables');
    const s = res.summary || {};
    body.innerHTML = `
      <div class="grid grid-3 mb12">
        ${statCard({ label: '未结应付', value: fmt.yuan(s.open || 0, 0), iconName: 'wallet', tone: 'warn',
          sub: `共 ${s.count || 0} 笔` })}
        ${statCard({ label: '已过结算日', value: fmt.yuan(s.overdue || 0, 0), iconName: 'alert', tone: 'danger',
          sub: '按合同账期生成结算计划' })}
        ${statCard({ label: '已结清（近期）', value: res.items.filter((i) => i.PayableStatus === 'Closed').length, unit: '笔',
          iconName: 'check', sub: '付款登记后自动核销' })}
      </div>
      ${table({
        columns: [
          { label: '应付单号', render: (r) => `<span class="mono">${esc(r.PayableNo)}</span><div class="sub">${esc(r.StatementNo || '')}</div>` },
          { label: '供应商', render: (r) => esc(r.SupplierName) },
          { label: '对账期间', render: (r) => r.PeriodStart ? fmt.date(r.PeriodStart) + ' ~ ' + fmt.date(r.PeriodEnd) : '—' },
          { label: '应付金额', cls: 'num strong', render: (r) => fmt.yuan(r.PayableAmount) },
          { label: '已付', cls: 'num', render: (r) => fmt.yuan(r.PaidAmount) },
          { label: '未付', cls: 'num', render: (r) => fmt.yuan(r.Remain) },
          { label: '计划付款日', render: (r) => fmt.date(r.PlannedPayDate) + (r.OverdueDays > 0 && r.PayableStatus !== 'Closed' ? ' ' + tag('逾期 ' + r.OverdueDays + ' 天', 'danger') : '') },
          { label: '状态', render: (r) => tag(r.PayableStatus === 'Closed' ? '已结清' : r.PayableStatus === 'Partial' ? '部分付款' : '待付款', r.PayableStatus === 'Closed' ? 'ok' : r.PayableStatus === 'Partial' ? 'warn' : 'info') },
          { label: '', cls: 'actions', render: (r) => (r.PayableStatus !== 'Closed' && isOwner)
            ? `<button class="btn btn-sm btn-primary" data-pay="${r.PayableID}" data-remain="${r.Remain}">登记付款</button>` : '' },
        ],
        rows: res.items,
        empty: '没有应付账款',
      })}`;

    on(body, 'click', '[data-pay]', async (e, btn) => {
      const remain = Number(btn.dataset.remain);
      modal({
        title: '登记货款结算', desc: '付款登记后自动更新应付账款与往来台账',
        content: `<div class="form-grid">
            <div class="field"><label>付款金额<span class="req">*</span></label>
              <input class="input" name="amount" value="${fmt.money(remain)}" data-max="${remain}"></div>
            <div class="field"><label>付款方式<span class="req">*</span></label>
              <select class="select" name="method"><option>银行转账</option><option>现金</option><option>微信</option><option>支付宝</option></select></div>
            <div class="field"><label>付款日期</label><input class="input" type="date" name="paidAt" value="${fmt.today()}"></div>
            <div class="field full"><label>备注</label><input class="input" name="note" placeholder="如：按结算计划付清尾款"></div>
          </div>`,
        onSubmit: async (v) => {
          const r2 = await api.post('/api/payments', {
            payableId: Number(btn.dataset.pay), amount: Number(v.amount),
            method: v.method, paidAt: v.paidAt + ' 12:00:00', note: v.note,
          });
          toast(r2.message, 'ok', 4600);
          route();
        },
      });
    });
  }

  async function renderPayments() {
    const res = await api.get('/api/payments');
    body.innerHTML = table({
      columns: [
        { label: '付款单号', render: (r) => `<span class="mono">${esc(r.PayNo)}</span>` },
        { label: '应付单号', render: (r) => `<span class="mono">${esc(r.PayableNo)}</span>` },
        { label: '供应商', render: (r) => esc(r.SupplierName) },
        { label: '金额', cls: 'num strong', render: (r) => fmt.yuan(r.Amount) },
        { label: '方式', render: (r) => tag(r.Method, 'plain') },
        { label: '付款时间', render: (r) => fmt.datetime(r.PaidAt) },
        { label: '登记人', render: (r) => esc(r.RegisterName || '') },
        { label: '备注', render: (r) => esc(r.Note || '—') },
      ],
      rows: res.items,
      empty: '还没有付款记录',
    });
  }

  await route();
}
