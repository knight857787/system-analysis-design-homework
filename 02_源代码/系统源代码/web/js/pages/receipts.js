/* 收货与验收（UC-03）、进货查验（UC-15） */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock, stat,
  modal, drawer, stat as statCard,
} from '../core.js';

export async function render(view, ctx) {
  const canSeeMoney = ((state.user || {}).role === 'Owner');
  const options = state.options;
  let tab = ctx.query.tab || 'pending';

  view.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="seg" data-tabs>
          <button data-tab="pending" class="${tab === 'pending' ? 'active' : ''}">待收货订货单</button>
          <button data-tab="list" class="${tab === 'list' ? 'active' : ''}">收货单记录</button>
          <button data-tab="insp" class="${tab === 'insp' ? 'active' : ''}">进货查验台账</button>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-direct>${icon('plus')} 无单直送 / 现场建单</button>
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
    if (tab === 'pending') return renderPending();
    if (tab === 'list') return renderList();
    return renderInspections();
  }

  /* ------------------------------------------------------------ 待收货 */
  async function renderPending() {
    const res = await api.get('/api/receipts/pending-orders');
    body.innerHTML = res.items.length ? `
      <div class="alert info mb12" style="display:block">
        <b>按单验收</b>：生产线日期与保质期逐批登记，否则临期预警不准；无生产日期或已过保质期的商品一律拒收；订货与实收差异必须当场登记。
      </div>
      ${res.items.map((o) => `
        <div class="card" style="margin-bottom:14px">
          <div class="card-head">
            <div>
              <h3>${esc(o.OrderNo)} · ${esc(o.SupplierName)}</h3>
              <div class="desc">预计到货 ${fmt.date(o.ExpectedArrivalDate)} · 共 ${fmt.yuan(o.TotalAmount)} · ${o.lines.length} 行</div>
            </div>
            <div class="actions">
              ${tag(o.OrderStatus === 'Submitted' ? '待供货商确认' : '已接单在途', o.OrderStatus === 'Submitted' ? 'warn' : 'info')}
              <button class="btn btn-sm btn-primary" data-receive="${o.OrderID}">登记收货</button>
              <button class="btn btn-sm" data-view="${o.OrderID}">明细</button>
            </div>
          </div>
          <div class="card-body flush">
            ${table({
              compact: true,
              columns: [
                { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">${esc(r.Specification || '')} · ${esc(r.Unit)}</div>` },
                { label: '订货量', cls: 'num', render: (r) => fmt.qty(r.Quantity) },
                { label: '已收', cls: 'num', render: (r) => fmt.qty(r.ReceivedQty) },
                ...(canSeeMoney ? [{ label: '约定单价', cls: 'num', render: (r) => fmt.yuan(r.AgreedPrice) }] : []),
                ...(canSeeMoney ? [{ label: '金额', cls: 'num', render: (r) => fmt.yuan(r.Quantity * r.AgreedPrice) }] : []),
              ],
              rows: o.lines,
            })}
          </div>
        </div>`).join('')}` : emptyState('没有待收货的订货单', '可以点右上角「无单直送」现场建单');

    on(body, 'click', '[data-view]', async (e, btn) => {
      const d = await api.get('/api/purchase-orders/' + btn.dataset.view);
      modal({
        title: '订货单 ' + d.order.OrderNo, desc: `${esc(d.order.SupplierName)} · 状态 ${esc(d.order.OrderStatus)}`,
        size: 'wide', hideFooter: true,
        content: table({
          columns: [
            { label: '#', render: (r) => r.LineNo },
            { label: '商品', render: (r) => esc(r.ProductName) + `<div class="sub">${esc(r.Specification || '')}</div>` },
            { label: '数量', cls: 'num', render: (r) => fmt.qty(r.Quantity) + ' ' + esc(r.Unit) },
            { label: '单价', cls: 'num', render: (r) => fmt.yuan(r.AgreedPrice) },
            { label: '已收', cls: 'num', render: (r) => fmt.qty(r.ReceivedQty) },
            ...(canSeeMoney ? [{ label: '金额', cls: 'num', render: (r) => fmt.yuan(r.Amount) }] : []),
          ],
          rows: d.lines,
        }),
      });
    });
    on(body, 'click', '[data-receive]', (e, btn) => {
      const order = res.items.find((o) => String(o.OrderID) === btn.dataset.receive);
      openReceiveModal(order);
    });
  }

  function openReceiveModal(order) {
    const lines = order ? order.lines : [];
    const todayStr = fmt.today();
    const rows = lines.map((l, idx) => `
      <tr data-line="${idx}">
        <td><div class="strong">${esc(l.ProductName)}</div><div class="sub">${esc(l.Specification || '')} · ${esc(l.Unit)}</div>
          <input type="hidden" name="pid_${idx}" value="${l.ProductID}"></td>
        <td class="num">${fmt.qty(l.Quantity)}</td>
        <td><input class="input" name="qty_${idx}" value="${fmt.qty(l.Quantity)}" style="height:30px;width:84px"></td>
        <td><input class="input" name="rej_${idx}" value="0" style="height:30px;width:70px"></td>
        <td><input class="input" name="price_${idx}" value="${l.AgreedPrice}" style="height:30px;width:84px"></td>
        <td><input class="input" type="date" name="prod_${idx}" value="${todayStr}" style="height:30px;width:132px"></td>
        <td><input class="input" name="shelf_${idx}" value="${l.ShelfLifeDays || 180}" style="height:30px;width:76px"></td>
      </tr>`).join('');
    modal({
      title: order ? '登记收货 · ' + order.OrderNo : '无单直送 · 现场建单',
      desc: '实收数量 > 0 时会按「生产日期 + 保质期」生成进货批次并更新库存台账；拒收数量不会入库',
      size: 'wide', submitText: '保存收货单',
      content: `
        ${order ? '' : `<div class="form-grid mb12">
          <div class="field"><label>供应商<span class="req">*</span></label>
            <select class="select" name="supplierId">${(options.suppliers || []).map((s) =>
              `<option value="${s.SupplierID}">${esc(s.Name)}</option>`).join('')}</select></div>
          <div class="field"><label>库位</label><input class="input" name="location" value="蔬-01"></div>
        </div>`}
        <div class="table-wrap" style="max-height:46vh">
          <table class="table compact">
            <thead><tr><th>商品</th><th>应收</th><th>实收</th><th>拒收</th><th>进价</th><th>生产日期</th><th>保质期(天)</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" class="muted">该订货单没有明细</td></tr>'}</tbody>
          </table>
        </div>
        ${order ? '' : `<div class="form-hint mt8">无单直送需要选择商品：请先在「商品档案」确认商品已建档；此处以订货单明细方式录入，若需临时建单请选择供应商后逐行填写商品编号。</div>`}
        <div class="section-title mt16">进货查验凭证（可选，缺失会自动登记为待补交）</div>
        <div class="form-grid">
          <div class="field"><label>许可证编号</label><input class="input" name="licenceNo" placeholder="JY..."></div>
          <div class="field"><label>证明类型</label><input class="input" name="certificateType" value="出厂检验合格证明"></div>
          <div class="field"><label>证明编号</label><input class="input" name="certificateNo" placeholder="HG..."></div>
          <div class="field"><label>有效期至</label><input class="input" type="date" name="validUntil"></div>
          <div class="field full"><label>验收结论 / 差异说明</label>
            <select class="select" name="inspectionResult">
              <option>合格</option><option>有差异（已登记）</option><option>部分拒收</option><option>让步接收</option>
            </select></div>
        </div>`,
      onSubmit: async (v) => {
        const goods = [];
        lines.forEach((l, idx) => {
          const qty = Number(document.querySelector(`[name=qty_${idx}]`).value);
          const rej = Number(document.querySelector(`[name=rej_${idx}]`).value) || 0;
          if (!qty && !rej) return;
          goods.push({
            productId: l.ProductID,
            orderedQty: l.Quantity,
            receivedQty: qty || 0,
            rejectedQty: rej,
            purchasePrice: Number(document.querySelector(`[name=price_${idx}]`).value),
            productionDate: document.querySelector(`[name=prod_${idx}]`).value,
            shelfLifeDays: Number(document.querySelector(`[name=shelf_${idx}]`).value),
            rejectionNote: rej ? '验收差异（拒收）' : null,
          });
        });
        if (!goods.length) throw new Error('请至少填写一行实收或拒收数量');
        const payload = {
          orderId: order ? order.OrderID : null,
          supplierId: order ? order.SupplierID : Number(document.querySelector('[name=supplierId]').value),
          inspectionResult: v.inspectionResult,
          location: document.querySelector('[name=location]') ? document.querySelector('[name=location]').value : null,
          lines: goods,
          inspection: { licenceNo: v.licenceNo, certificateType: v.certificateType, certificateNo: v.certificateNo, validUntil: v.validUntil },
        };
        const r2 = await api.post('/api/receipts', payload);
        toast(r2.message + (r2.diffLines ? `，其中 ${r2.diffLines} 行与订货不一致` : ''), 'ok', 4600);
        tab = 'list';
        $$('[data-tabs] button', body.closest('.card').querySelector('.seg')).forEach((x) =>
          x.classList.toggle('active', x.dataset.tab === 'list'));
        route();
      },
    });
  }

  $('[data-direct]', view).addEventListener('click', async () => {
    const res = await api.get('/api/products', { size: 200 });
    const prods = res.items.slice(0, 120);
    modal({
      title: '无订货单直送 · 现场建单',
      desc: '适用于供货商临时送货、无订货单的场景；同样按批次登记生产日期与保质期',
      size: 'wide', submitText: '保存收货单',
      content: `
        <div class="form-grid">
          <div class="field"><label>供应商<span class="req">*</span></label>
            <select class="select" name="supplierId">${(options.suppliers || []).map((s) =>
              `<option value="${s.SupplierID}">${esc(s.Name)}</option>`).join('')}</select></div>
          <div class="field"><label>库位</label><input class="input" name="location" value="待定"></div>
          <div class="field"><label>商品<span class="req">*</span></label>
            <select class="select" name="productId">${prods.map((p) =>
              `<option value="${p.ProductID}|${p.ShelfLifeDays}">${esc(p.ProductName)} · ${esc(p.Specification || '')}</option>`).join('')}</select></div>
          <div class="field"><label>实收数量<span class="req">*</span></label><input class="input" name="qty" value="10"></div>
          <div class="field"><label>进价</label><input class="input" name="price" value=""></div>
          <div class="field"><label>生产日期<span class="req">*</span></label><input class="input" type="date" name="prod" value="${fmt.today()}"></div>
          <div class="field"><label>保质期（天）</label><input class="input" name="shelf" value="180"></div>
          <div class="field"><label>许可证编号</label><input class="input" name="licenceNo"></div>
          <div class="field"><label>合格证明编号</label><input class="input" name="certificateNo"></div>
        </div>`,
      onSubmit: async (v) => {
        const [pid, shelf] = document.querySelector('[name=productId]').value.split('|');
        const prod = await api.get('/api/products/' + pid);
        const price = Number(document.querySelector('[name=price]').value) ||
          (prod.product.LastCost || prod.product.ListPrice * 0.84);
        const r2 = await api.post('/api/receipts', {
          supplierId: Number(v.supplierId),
          location: v.location,
          inspectionResult: '合格',
          lines: [{
            productId: Number(pid), receivedQty: Number(document.querySelector('[name=qty]').value),
            rejectedQty: 0, orderedQty: 0, purchasePrice: Number(price.toFixed(2)),
            productionDate: document.querySelector('[name=prod]').value,
            shelfLifeDays: Number(document.querySelector('[name=shelf]').value),
          }],
          inspection: { licenceNo: v.licenceNo, certificateType: '出厂检验合格证明', certificateNo: v.certificateNo },
        });
        toast(r2.message, 'ok', 4200);
        tab = 'list';
        route();
      },
    });
  });

  /* ------------------------------------------------------------ 收货记录 */
  async function renderList() {
    const res = await api.get('/api/receipts', { size: 30 });
    body.innerHTML = table({
      columns: [
        { label: '收货单号', render: (r) => `<span class="mono">${esc(r.ReceiptNo)}</span>` },
        { label: '供应商', render: (r) => esc(r.SupplierName) },
        { label: '收货时间', render: (r) => fmt.datetime(r.ReceivedAt) },
        { label: '验收人', render: (r) => esc(r.InspectorName || '') },
        { label: '行数', cls: 'num', render: (r) => r.LineCount },
        ...(canSeeMoney ? [{ label: '金额', cls: 'num strong', render: (r) => fmt.yuan(r.Amount) }] : []),
        { label: '验收结论', render: (r) => tag(r.InspectionResult, r.InspectionResult.includes('差异') ? 'warn' : 'ok') },
        { label: '查验凭证', render: (r) => r.InspectionStatus === 'Complete'
          ? tag('完整', 'ok') : tag('缺失待补', 'warn') },
        { label: '', cls: 'actions', render: (r) => `<button class="btn btn-sm" data-detail="${r.ReceiptID}">查看</button>` },
      ],
      rows: res.items,
      empty: '还没有收货记录',
    });
    on(body, 'click', '[data-detail]', async (e, btn) => {
      const d = await api.get('/api/receipts/' + btn.dataset.detail);
      const insp = d.inspection || {};
      drawer({
        title: '收货单 ' + d.receipt.ReceiptNo,
        subtitle: `${esc(d.receipt.SupplierName)} · ${fmt.datetime(d.receipt.ReceivedAt)} · 验收人 ${esc(d.receipt.InspectorName || '')}`,
        body: `
          <dl class="kv kv-sm">
            <dt>验收结论</dt><dd>${esc(d.receipt.InspectionResult)}</dd>
            <dt>关联订货单</dt><dd>${esc(d.receipt.OrderNo || '无（直送）')}</dd>
            <dt>差异说明</dt><dd>${esc(d.receipt.DiffNote || '无')}</dd>
          </dl>
          <div class="section-title mt16">收货明细（按批次入库）</div>
          ${table({
            compact: true,
            columns: [
              { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">批次 ${esc(r.BatchNo || '—')} · 到期 ${fmt.date(r.ExpiryDate)}</div>` },
              { label: '应收', cls: 'num', render: (r) => fmt.qty(r.OrderedQty) },
              { label: '实收', cls: 'num strong', render: (r) => fmt.qty(r.ReceivedQty) },
              { label: '拒收', cls: 'num', render: (r) => r.RejectedQty ? tag(fmt.qty(r.RejectedQty), 'danger') : '0' },
              { label: '进价', cls: 'num', render: (r) => fmt.yuan(r.PurchasePrice) },
              { label: '金额', cls: 'num', render: (r) => fmt.yuan(r.Amount) },
            ],
            rows: d.lines,
          })}
          <div class="section-title mt16">进货查验记录</div>
          ${insp.InspectionID ? `<dl class="kv kv-sm">
              <dt>状态</dt><dd>${tag(insp.Status === 'Complete' ? '凭证完整' : '缺失待补交', insp.Status === 'Complete' ? 'ok' : 'warn')}</dd>
              <dt>许可证号</dt><dd>${esc(insp.LicenceNo || '—')}</dd>
              <dt>证明类型</dt><dd>${esc(insp.CertificateType || '—')}</dd>
              <dt>证明编号</dt><dd>${esc(insp.CertificateNo || '—')}</dd>
              <dt>有效期至</dt><dd>${fmt.date(insp.ValidUntil)}</dd>
              <dt>备注</dt><dd>${esc(insp.Note || '—')}</dd>
            </dl>` : '<div class="muted small">没有查验记录</div>'}
          <div class="row mt16"><button class="btn btn-primary btn-sm" data-insp="${d.receipt.ReceiptID}">登记 / 补录查验凭证</button></div>`,
      }).body.querySelector('[data-insp]').addEventListener('click', () => openInspection(d.receipt.ReceiptID, insp));
    });
  }

  function openInspection(receiptId, insp) {
    modal({
      title: '登记进货查验凭证',
      desc: '食品经营者采购食品应当查验供货者的许可证与出厂检验合格证明，凭证随收货单留存',
      content: `<div class="form-grid">
          <div class="field"><label>许可证编号</label><input class="input" name="licenceNo" value="${esc(insp.LicenceNo || '')}"></div>
          <div class="field"><label>证明类型</label><input class="input" name="certificateType" value="${esc(insp.CertificateType || '出厂检验合格证明')}"></div>
          <div class="field"><label>证明编号</label><input class="input" name="certificateNo" value="${esc(insp.CertificateNo || '')}"></div>
          <div class="field"><label>有效期至</label><input class="input" type="date" name="validUntil" value="${esc(insp.ValidUntil || '')}"></div>
          <div class="field full"><label>备注</label><input class="input" name="note" value="${esc(insp.Note || '')}"></div>
        </div>`,
      onSubmit: async (v) => {
        const r2 = await api.post(`/api/receipts/${receiptId}/inspection`, v);
        toast(r2.message, 'ok');
        route();
      },
    });
  }

  /* ------------------------------------------------------------ 查验台账 */
  async function renderInspections() {
    const res = await api.get('/api/inspections');
    const s = res.summary;
    body.innerHTML = `
      <div class="grid grid-3 mb12">
        ${statCard({ label: '凭证完整', value: s.complete, unit: '批', iconName: 'check', sub: '许可证 + 合格证明已留存' })}
        ${statCard({ label: '缺失待补交', value: s.missing, unit: '批', tone: 'warn', iconName: 'alert', sub: '逾期由老板跟进' })}
        ${statCard({ label: '30 天内到期', value: s.expiring, unit: '批', tone: 'info', iconName: 'calendar', sub: '证照有效期提醒' })}
      </div>
      ${table({
        columns: [
          { label: '收货单', render: (r) => `<span class="mono">${esc(r.ReceiptNo)}</span><div class="sub">${fmt.date(r.ReceivedAt)}</div>` },
          { label: '供应商', render: (r) => esc(r.SupplierName) },
          { label: '许可证号', render: (r) => esc(r.LicenceNo || '—') },
          { label: '证明类型', render: (r) => esc(r.CertificateType || '—') },
          { label: '证明编号', render: (r) => esc(r.CertificateNo || '—') },
          { label: '有效期', render: (r) => fmt.date(r.ValidUntil) + (r.expiringSoon ? ' ' + tag('即将到期', 'warn') : '') },
          { label: '状态', render: (r) => tag(r.Status === 'Complete' ? '完整' : '缺失', r.Status === 'Complete' ? 'ok' : 'warn') },
          { label: '登记人', render: (r) => esc(r.RecordedByName || '') },
          { label: '', cls: 'actions', render: (r) => `<button class="btn btn-sm" data-insp2="${r.ReceiptID}">补录</button>` },
        ],
        rows: res.items,
        empty: '暂无查验记录',
      })}`;
    on(body, 'click', '[data-insp2]', (e, btn) => openInspection(btn.dataset.insp2, {}));
  }

  await route();
}
