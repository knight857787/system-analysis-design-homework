/* 供应商与结算条款（UC-10）、供应商往来台账 */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock,
  modal, drawer, stat as statCard,
} from '../core.js';

export async function render(view, ctx) {
  const isOwner = ctx.user.role === 'Owner';
  view.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <h3 style="margin:0;font-size:14.5px">供应商档案</h3>
        <div class="spacer"></div>
        <span class="tag plain">账期、退货比例与可扣减费用项目都在结算条款里</span>
        <button class="btn btn-sm btn-primary" data-new>${icon('plus')} 新增供应商</button>
      </div>
      <div class="card-body" data-body>${loadingBlock()}</div>
    </div>`;
  const body = $('[data-body]', view);

  async function load() {
    body.innerHTML = loadingBlock();
    const res = await api.get('/api/suppliers');
    body.innerHTML = table({
      columns: [
        { label: '供应商', render: (r) => `<div class="strong">${esc(r.Name)}</div><div class="sub">${esc(r.Address || '')}</div>` },
        { label: '联系人', render: (r) => `${esc(r.Contact || '—')}<div class="sub">${esc(r.Phone || '')}</div>` },
        { label: '账期', cls: 'num', render: (r) => `${r.PaymentTermDays || '—'} 天` },
        { label: '退货比例', cls: 'num', render: (r) => r.MaxReturnRatio ? r.returnRatioPct + '%' : '—' },
        { label: '可扣费用项', render: (r) => (r.AllowedExpenseTypes || '').split(',').filter(Boolean).map((x) => tag(x, 'plain')).join(' ') },
        { label: '在供商品', cls: 'num', render: (r) => r.ProductCount },
        { label: '90 天进货', cls: 'num', render: (r) => fmt.yuan(r.Received90 || 0, 0) },
        { label: '未结应付', cls: 'num strong', render: (r) => fmt.yuan(r.OpenPayable || 0) },
        { label: '', cls: 'actions', render: (r) => `
          <button class="btn btn-sm" data-ledger="${r.SupplierID}">往来台账</button>
          ${isOwner ? `<button class="btn btn-sm" data-terms="${r.SupplierID}">结算条款</button>
          <button class="btn btn-sm" data-edit="${r.SupplierID}">编辑</button>` : ''}
        ` },
      ],
      rows: res.items,
      empty: '还没有供应商',
    });

    on(body, 'click', '[data-ledger]', async (e, btn) => {
      const d = await api.get('/api/suppliers/' + btn.dataset.ledger + '/ledger');
      const t = d.totals;
      drawer({
        title: '供应商往来台账 · ' + d.supplier.Name,
        subtitle: `近 90 天：进货 ${fmt.yuan(t.received)} · 退货 ${fmt.yuan(t.returned)} · 费用 ${fmt.yuan(t.expense)} · 未结应付 ${fmt.yuan(t.openPayable)}`,
        body: `
          <div class="section-title">收货记录</div>
          ${table({
            compact: true,
            columns: [
              { label: '收货单', render: (r) => `<span class="mono">${esc(r.ReceiptNo)}</span>` },
              { label: '时间', render: (r) => fmt.datetime(r.ReceivedAt) },
              { label: '行数', cls: 'num', render: (r) => r.Lines },
              { label: '金额', cls: 'num', render: (r) => fmt.yuan(r.Amount) },
              { label: '结论', render: (r) => tag(r.InspectionResult, r.InspectionResult.includes('差异') ? 'warn' : 'ok') },
            ],
            rows: d.receipts,
            empty: '近 90 天没有收货记录',
          })}
          <div class="section-title mt16">退货与费用（对账扣减项）</div>
          ${table({
            compact: true,
            columns: [
              { label: '类型', render: (r) => tag(r.ExpenseType || '退货', 'info') },
              { label: '单号', render: (r) => `<span class="mono">${esc(r.ExpenseNo || r.ReturnNo)}</span>` },
              { label: '期间', render: (r) => r.Period || fmt.date(r.ReturnedAt) },
              { label: '金额', cls: 'num', render: (r) => fmt.yuan(r.Amount) },
              { label: '凭证', render: (r) => esc(r.Voucher || r.Reason || '—') },
            ],
            rows: [...d.returns.map((r) => ({ ...r, Amount: r.Amount })), ...d.expenses],
            empty: '没有退货或费用记录',
          })}
          <div class="section-title mt16">对账单与应付</div>
          ${table({
            compact: true,
            columns: [
              { label: '对账单', render: (r) => `<span class="mono">${esc(r.StatementNo)}</span>` },
              { label: '期间', render: (r) => fmt.date(r.PeriodStart) + ' ~ ' + fmt.date(r.PeriodEnd) },
              { label: '本方金额', cls: 'num', render: (r) => fmt.yuan(r.OurAmount) },
              { label: '差异', cls: 'num', render: (r) => Math.abs(r.DiffAmount) > 0.001 ? tag(fmt.yuan(r.DiffAmount), 'warn') : '一致' },
              { label: '状态', render: (r) => tag(r.StatementStatus, r.StatementStatus === 'Confirmed' ? 'ok' : 'warn') },
            ],
            rows: d.statements,
            empty: '还没有对账单',
          })}
          ${d.payments.length ? `<div class="section-title mt16">付款记录</div>
          ${table({
            compact: true,
            columns: [
              { label: '付款单', render: (r) => `<span class="mono">${esc(r.PayNo)}</span>` },
              { label: '时间', render: (r) => fmt.datetime(r.PaidAt) },
              { label: '金额', cls: 'num', render: (r) => fmt.yuan(r.Amount) },
              { label: '方式', render: (r) => esc(r.Method) },
            ],
            rows: d.payments,
          })}` : ''}`,
      });
    });

    on(body, 'click', '[data-terms]', (e, btn) => {
      const s = res.items.find((x) => String(x.SupplierID) === btn.dataset.terms);
      modal({
        title: '结算条款 · ' + s.Name,
        desc: '账期决定应付账款的计划付款日；退货比例约束临期退货；可扣费用项决定对账时可扣减的费用类型',
        content: `<div class="form-grid">
            <div class="field"><label>账期（天）<span class="req">*</span></label><input class="input" name="paymentTermDays" value="${s.PaymentTermDays || 30}"></div>
            <div class="field"><label>最大退货比例（0.02 = 2%）<span class="req">*</span></label><input class="input" name="maxReturnRatio" value="${s.MaxReturnRatio || 0.02}"></div>
            <div class="field full"><label>可扣减费用项目（逗号分隔）</label><input class="input" name="allowedExpenseTypes" value="${esc(s.AllowedExpenseTypes || '陈列费,促销费')}"></div>
            <div class="field"><label>生效日期</label><input class="input" type="date" name="effectiveDate" value="${esc(s.EffectiveDate || fmt.today())}"></div>
          </div>`,
        onSubmit: async (v) => {
          const r2 = await api.put(`/api/suppliers/${s.SupplierID}/terms`, {
            paymentTermDays: Number(v.paymentTermDays),
            maxReturnRatio: Number(v.maxReturnRatio),
            allowedExpenseTypes: v.allowedExpenseTypes,
            effectiveDate: v.effectiveDate,
          });
          toast(r2.message, 'ok');
          load();
        },
      });
    });

    on(body, 'click', '[data-edit]', (e, btn) => {
      const s = res.items.find((x) => String(x.SupplierID) === btn.dataset.edit);
      modal({
        title: '编辑供应商 · ' + s.Name,
        content: `<div class="form-grid">
            <div class="field"><label>名称<span class="req">*</span></label><input class="input" name="name" value="${esc(s.Name)}"></div>
            <div class="field"><label>联系人</label><input class="input" name="contact" value="${esc(s.Contact || '')}"></div>
            <div class="field"><label>电话</label><input class="input" name="phone" value="${esc(s.Phone || '')}"></div>
            <div class="field full"><label>地址</label><input class="input" name="address" value="${esc(s.Address || '')}"></div>
          </div>`,
        onSubmit: async (v) => {
          const r2 = await api.put('/api/suppliers/' + s.SupplierID, v);
          toast(r2.message, 'ok');
          load();
        },
      });
    });
  }

  $('[data-new]', view).addEventListener('click', () => {
    modal({
      title: '新增供应商与结算条款',
      content: `<div class="form-grid">
          <div class="field"><label>名称<span class="req">*</span></label><input class="input" name="name" placeholder="如：模拟供应商甲"></div>
          <div class="field"><label>联系人</label><input class="input" name="contact"></div>
          <div class="field"><label>电话</label><input class="input" name="phone"></div>
          <div class="field"><label>地址</label><input class="input" name="address"></div>
          <div class="field"><label>账期（天）</label><input class="input" name="paymentTermDays" value="30"></div>
          <div class="field"><label>最大退货比例</label><input class="input" name="maxReturnRatio" value="0.02"></div>
          <div class="field full"><label>可扣减费用项目</label><input class="input" name="allowedExpenseTypes" value="陈列费,促销费"></div>
        </div>`,
      onSubmit: async (v) => {
        const r2 = await api.post('/api/suppliers', {
          name: v.name, contact: v.contact, phone: v.phone, address: v.address,
          paymentTermDays: Number(v.paymentTermDays), maxReturnRatio: Number(v.maxReturnRatio),
          allowedExpenseTypes: v.allowedExpenseTypes,
        });
        toast(r2.message, 'ok');
        state.options = await api.get('/api/options');
        load();
      },
    });
  });

  await load();
}
