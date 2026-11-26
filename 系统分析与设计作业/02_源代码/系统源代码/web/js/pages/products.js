/* 商品档案（UC-09）、类别、折价规则 */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock,
  modal, drawer, pager, bindPager, debounce, downloadCsv,
} from '../core.js';

export async function render(view, ctx) {
  const options = state.options;
  const isOwner = ctx.user.role === 'Owner';
  let tab = ctx.query.tab || 'products';
  let page = 1;
  let keyword = '';
  let categoryId = '';
  let onShelf = '';
  let lowStock = false;

  view.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="seg" data-tabs>
          <button data-tab="products" class="${tab === 'products' ? 'active' : ''}">商品档案</button>
          <button data-tab="categories" class="${tab === 'categories' ? 'active' : ''}">商品类别</button>
          <button data-tab="rules" class="${tab === 'rules' ? 'active' : ''}">折价规则</button>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-export>导出 CSV</button>
        ${isOwner ? `<button class="btn btn-sm btn-primary" data-new>${icon('plus')} 新增商品</button>` : ''}
      </div>
      <div class="card-body" data-body>${loadingBlock()}</div>
    </div>
    <div data-list></div>`;

  const body = $('[data-body]', view);
  $$('[data-tabs] button', view).forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    $$('[data-tabs] button', view).forEach((x) => x.classList.toggle('active', x === b));
    route();
  }));
  const newBtn = $('[data-new]', view);
  if (newBtn) {
    newBtn.addEventListener('click', () => {
      if (tab === 'categories') openCategoryForm(null);
      else if (tab === 'rules') openRuleForm(null);
      else openProductForm(null);
    });
  }

  async function route() {
    body.innerHTML = loadingBlock();
    const newBtn = $('[data-new]', view);
    if (newBtn) {
      newBtn.style.display = isOwner ? '' : 'none';
      newBtn.textContent = tab === 'categories' ? '新增类别' : tab === 'rules' ? '新增规则' : '新增商品';
    }
    if (tab === 'categories') return renderCategories();
    if (tab === 'rules') return renderRules();
    return renderProducts();
  }

  /* ------------------------------------------------------------ 商品 */
  async function renderProducts() {
    body.innerHTML = `
      <div class="toolbar" style="border:0;border-bottom:1px solid var(--line-2)">
        <input class="input search" data-q placeholder="搜索商品名称 / 条码 / 规格" value="${esc(keyword)}">
        <select class="select" data-cat>
          <option value="">全部品类</option>
          ${(options.categories || []).map((c) => `<option value="${c.CategoryID}" ${String(c.CategoryID) === categoryId ? 'selected' : ''}>${esc(c.CategoryName)}</option>`).join('')}
        </select>
        <select class="select" data-shelf>
          <option value="">全部状态</option>
          <option value="Y" ${onShelf === 'Y' ? 'selected' : ''}>在售</option>
          <option value="N" ${onShelf === 'N' ? 'selected' : ''}>已下架</option>
        </select>
        <label class="checkbox"><input type="checkbox" data-low ${lowStock ? 'checked' : ''}> 只看低库存</label>
        <div class="spacer"></div>
        <span class="tag plain" data-count></span>
      </div>
      <div data-table></div>`;
    const tableBox = $('[data-table]', body);
    $('[data-q]', body).addEventListener('input', debounce((e) => { keyword = e.target.value.trim(); page = 1; load(); }, 320));
    $('[data-cat]', body).addEventListener('change', (e) => { categoryId = e.target.value; page = 1; load(); });
    $('[data-shelf]', body).addEventListener('change', (e) => { onShelf = e.target.value; page = 1; load(); });
    $('[data-low]', body).addEventListener('change', (e) => { lowStock = e.target.checked; page = 1; load(); });

    async function load() {
      tableBox.innerHTML = loadingBlock();
      const res = await api.get('/api/products', { q: keyword, categoryId, onShelf, lowStock: lowStock ? 1 : '', page, size: 20 });
      $('[data-count]', body).textContent = `共 ${res.total} 个商品`;
      tableBox.innerHTML = table({
        columns: [
          { label: '商品', render: (r) => `<div class="strong">${esc(r.ProductName)}</div><div class="sub">${esc(r.Specification || '')} · ${esc(r.Barcode)}</div>` },
          { label: '类别', render: (r) => tag(r.CategoryName, 'plain') },
          { label: '单位', render: (r) => esc(r.Unit) },
          { label: '售价', cls: 'num strong', render: (r) => fmt.yuan(r.ListPrice) },
          { label: '最近进价', cls: 'num', render: (r) => r.LastCost ? fmt.yuan(r.LastCost) : '—' },
          { label: '库存', cls: 'num', render: (r) => `<span class="${r.StockQty <= 0 ? 'tag danger' : r.StockQty <= 3 ? 'tag warn' : ''}">${fmt.qty(r.StockQty)}</span> ${esc(r.Unit)}` },
          { label: '库存成本', cls: 'num', render: (r) => fmt.yuan(r.StockValue) },
          { label: '保质期', cls: 'num', render: (r) => r.ShelfLifeDays + ' 天' },
          { label: '供应商', render: (r) => esc(r.SupplierName || '—') },
          { label: '状态', render: (r) => tag(r.OnShelfFlag === 'Y' ? '在售' : '已下架', r.OnShelfFlag === 'Y' ? 'ok' : 'plain') },
          { label: '', cls: 'actions', render: (r) => `
            <button class="btn btn-sm" data-detail="${r.ProductID}">详情</button>
            ${isOwner ? `<button class="btn btn-sm" data-edit="${r.ProductID}">编辑</button>
            <button class="btn btn-sm ${r.OnShelfFlag === 'Y' ? 'btn-danger' : ''}" data-shelf-toggle="${r.ProductID}" data-flag="${r.OnShelfFlag}">
              ${r.OnShelfFlag === 'Y' ? '下架' : '上架'}</button>` : ''}
          ` },
        ],
        rows: res.items,
        empty: '没有符合条件的商品',
      }) + pager({ page: res.page, size: res.size, total: res.total });
      bindPager(tableBox, (p) => { page = p; load(); });

      on(tableBox, 'click', '[data-detail]', async (e, btn) => {
        const d = await api.get('/api/products/' + btn.dataset.detail);
        const p = d.product;
        drawer({
          title: p.ProductName, subtitle: `${esc(p.Specification || '')} · ${esc(p.CategoryName)} · 条码 ${esc(p.Barcode)}`,
          body: `
            <div class="grid grid-3 mb12">
              <div class="stat"><div class="stat-label">售价</div><div class="stat-value">${fmt.yuan(p.ListPrice)}<small>/${esc(p.Unit)}</small></div><div class="stat-sub">保质期 ${p.ShelfLifeDays} 天</div></div>
              <div class="stat"><div class="stat-label">库存</div><div class="stat-value">${fmt.qty(p.StockQty)}<small>${esc(p.Unit)}</small></div><div class="stat-sub">库存成本 ${fmt.yuan(p.StockValue)}</div></div>
              <div class="stat"><div class="stat-label">供应商</div><div style="font-size:13px;margin-top:8px">${esc(p.SupplierName || '未登记')}</div><div class="stat-sub">${p.OnShelfFlag === 'Y' ? '在售' : '已下架'}</div></div>
            </div>
            <div class="section-title">批次与效期（临期预警的计算依据）</div>
            ${d.batches.length ? table({
              compact: true,
              columns: [
                { label: '批次', render: (r) => `<span class="mono">${esc(r.BatchNo || '')}</span><div class="sub">${fmt.date(r.ProductionDate)} → ${fmt.date(r.ExpiryDate)}</div>` },
                { label: '现存', cls: 'num', render: (r) => fmt.qty(r.Quantity) },
                { label: '占用', cls: 'num', render: (r) => fmt.qty(r.ReservedQty) },
                { label: '进价', cls: 'num', render: (r) => fmt.yuan(r.PurchasePrice) },
                { label: '剩余', render: (r) => tag(fmt.days(r.RemainDays), r.RemainDays < 0 ? 'danger' : r.RemainDays <= 3 ? 'warn' : 'ok') },
                { label: '库位', render: (r) => esc(r.Location || '—') },
              ],
              rows: d.batches,
            }) : '<div class="muted small">没有库存批次</div>'}
            <div class="section-title">最近库存流水</div>
            ${table({
              compact: true,
              columns: [
                { label: '时间', render: (r) => fmt.datetime(r.OccurredAt) },
                { label: '类型', render: (r) => tag({ Receipt: '收货', Sale: '销售', Loss: '报损', Return: '退货', Adjust: '调账' }[r.MoveType] || r.MoveType, 'plain') },
                { label: '数量', cls: 'num', render: (r) => `<span class="${r.Quantity > 0 ? 'trend-up' : 'trend-down'}">${fmt.signed(r.Quantity)}</span>` },
                { label: '单据', render: (r) => esc(r.RefNo || '—') },
              ],
              rows: d.movements.slice(0, 12),
            })}`,
        });
      });

      on(tableBox, 'click', '[data-edit]', async (e, btn) => {
        const d = await api.get('/api/products/' + btn.dataset.edit);
        openProductForm(d.product);
      });
      on(tableBox, 'click', '[data-shelf-toggle]', async (e, btn) => {
        const flag = btn.dataset.flag === 'Y' ? 'N' : 'Y';
        try {
          const r2 = await api.post(`/api/products/${btn.dataset.shelfToggle}/shelf`, { onShelfFlag: flag });
          toast(r2.message, 'ok'); load();
        } catch (err) { toast(err.message, 'error'); }
      });
    }
    await load();
  }

  function openProductForm(p) {
    const editing = !!p;
    modal({
      title: editing ? '编辑商品档案' : '新增商品档案',
      desc: '条码只作唯一约束，主键仍由系统生成；生鲜称重商品用自编号（如 SP1001）',
      size: 'wide',
      content: `<div class="form-grid">
          <div class="field"><label>商品名称<span class="req">*</span></label><input class="input" name="productName" value="${esc(p ? p.ProductName : '')}"></div>
          <div class="field"><label>条码 / 自编号<span class="req">*</span></label><input class="input" name="barcode" value="${esc(p ? p.Barcode : '')}" ${editing ? 'readonly' : ''}></div>
          <div class="field"><label>规格</label><input class="input" name="specification" value="${esc(p ? p.Specification : '')}"></div>
          <div class="field"><label>单位</label><input class="input" name="unit" value="${esc(p ? p.Unit : '件')}"></div>
          <div class="field"><label>商品类别<span class="req">*</span></label>
            <select class="select" name="categoryId">${(options.categories || []).map((c) =>
              `<option value="${c.CategoryID}" ${p && p.CategoryID === c.CategoryID ? 'selected' : ''}>${esc(c.CategoryName)}</option>`).join('')}</select></div>
          <div class="field"><label>保质期（天）<span class="req">*</span></label><input class="input" name="shelfLifeDays" value="${p ? p.ShelfLifeDays : 180}"></div>
          <div class="field"><label>售价（元）<span class="req">*</span></label><input class="input" name="listPrice" value="${p ? p.ListPrice : ''}"></div>
          <div class="field"><label>默认供应商</label>
            <select class="select" name="supplierId">
              <option value="">未指定</option>
              ${(options.suppliers || []).map((s) => `<option value="${s.SupplierID}" ${p && p.SupplierID === s.SupplierID ? 'selected' : ''}>${esc(s.Name)}</option>`).join('')}
            </select></div>
        </div>`,
      onSubmit: async (v) => {
        const payload = {
          productName: v.productName, barcode: v.barcode, specification: v.specification,
          unit: v.unit, categoryId: Number(v.categoryId), shelfLifeDays: Number(v.shelfLifeDays),
          listPrice: Number(v.listPrice), supplierId: v.supplierId ? Number(v.supplierId) : null,
        };
        const r2 = editing
          ? await api.put('/api/products/' + p.ProductID, payload)
          : await api.post('/api/products', payload);
        toast(r2.message, 'ok');
        route();
      },
    });
  }

  /* ------------------------------------------------------------ 类别 */
  async function renderCategories() {
    const res = await api.get('/api/categories');
    body.innerHTML = `<div class="alert info mb12" style="display:block">
        品类决定临期预警阈值：剩余保质期不足总保质期的 ExpiryWarnRatio（默认 1/3，最长 30 天）即进入预警清单。
      </div>
      ${table({
      columns: [
        { label: '类别', render: (r) => `<b>${esc(r.CategoryName)}</b>` },
        { label: '商品数', cls: 'num', render: (r) => r.ProductCount },
        { label: '临期预警比例', cls: 'num', render: (r) => (r.ExpiryWarnRatio * 100).toFixed(0) + '%' },
        { label: '预警口径', render: (r) => `剩余效期 ≤ 保质期 × ${r.ExpiryWarnRatio}（最长 30 天）` },
        { label: '', cls: 'actions', render: (r) => isOwner ? `<button class="btn btn-sm" data-cedit="${r.CategoryID}">编辑</button>` : '' },
      ],
      rows: res.items,
    })}`;
    on(body, 'click', '[data-cedit]', (e, btn) => {
      const c = res.items.find((x) => String(x.CategoryID) === btn.dataset.cedit);
      openCategoryForm(c);
    });
  }

  function openCategoryForm(c) {
    modal({
      title: c ? '编辑类别' : '新增类别',
      content: `<div class="form-grid">
          <div class="field"><label>类别名称<span class="req">*</span></label><input class="input" name="categoryName" value="${esc(c ? c.CategoryName : '')}"></div>
          <div class="field"><label>临期预警比例（0~1）</label><input class="input" name="expiryWarnRatio" value="${c ? c.ExpiryWarnRatio : 0.34}"></div>
        </div>`,
      onSubmit: async (v) => {
        const payload = { categoryName: v.categoryName, expiryWarnRatio: Number(v.expiryWarnRatio) };
        const r2 = c ? await api.put('/api/categories/' + c.CategoryID, payload) : await api.post('/api/categories', payload);
        toast(r2.message, 'ok');
        state.options = await api.get('/api/options');
        route();
      },
    });
  }

  /* ------------------------------------------------------------ 折价规则 */
  async function renderRules() {
    const res = await api.get('/api/markdown-rules');
    body.innerHTML = `<div class="alert warn mb12" style="display:block">
        折价梯度按「剩余效期区间 + 品类」配置，系统在生成临期处理单时自动套用最近的一条规则；
        每一轮降价仍须老板确认后才执行（见「临期处理 → 折价方案」）。
      </div>
      ${table({
      columns: [
        { label: '品类', render: (r) => esc(r.CategoryName || '全部') },
        { label: '剩余效期区间', render: (r) => esc(r.ShelfLifeBand) },
        { label: '区间（天）', cls: 'num', render: (r) => r.RemainDaysFrom + ' ~ ' + r.RemainDaysTo },
        { label: '折价率', cls: 'num strong', render: (r) => (r.DiscountRate * 10).toFixed(1) + ' 折' },
        { label: '折价时点', render: (r) => esc(r.TriggerTime) },
        { label: '生效日期', render: (r) => fmt.date(r.EffectiveDate) },
        { label: '', cls: 'actions', render: (r) => isOwner ? `<button class="btn btn-sm" data-redit="${r.RuleID}">编辑</button>` : '' },
      ],
      rows: res.items,
      empty: '还没有折价规则',
    })}`;
    on(body, 'click', '[data-redit]', (e, btn) => {
      const r = res.items.find((x) => String(x.RuleID) === btn.dataset.redit);
      openRuleForm(r);
    });
  }

  function openRuleForm(r) {
    modal({
      title: r ? '编辑折价规则' : '新增折价规则',
      content: `<div class="form-grid">
          <div class="field"><label>商品类别<span class="req">*</span></label>
            <select class="select" name="categoryId">${(options.categories || []).map((c) =>
              `<option value="${c.CategoryID}" ${r && r.CategoryID === c.CategoryID ? 'selected' : ''}>${esc(c.CategoryName)}</option>`).join('')}</select></div>
          <div class="field"><label>剩余效期区间（文案）</label><input class="input" name="shelfLifeBand" value="${esc(r ? r.ShelfLifeBand : '0-2 天')}"></div>
          <div class="field"><label>区间起（天）</label><input class="input" name="remainDaysFrom" value="${r ? r.RemainDaysFrom : 0}"></div>
          <div class="field"><label>区间止（天）</label><input class="input" name="remainDaysTo" value="${r ? r.RemainDaysTo : 2}"></div>
          <div class="field"><label>折扣率（0.8 = 八折）<span class="req">*</span></label><input class="input" name="discountRate" value="${r ? r.DiscountRate : 0.8}"></div>
          <div class="field"><label>折价时点</label><input class="input" name="triggerTime" value="${r ? r.TriggerTime : '18:00'}"></div>
        </div>`,
      onSubmit: async (v) => {
        const payload = {
          categoryId: Number(v.categoryId), shelfLifeBand: v.shelfLifeBand,
          remainDaysFrom: Number(v.remainDaysFrom), remainDaysTo: Number(v.remainDaysTo),
          discountRate: Number(v.discountRate), triggerTime: v.triggerTime,
        };
        const r2 = r ? await api.put('/api/markdown-rules/' + r.RuleID, payload) : await api.post('/api/markdown-rules', payload);
        toast(r2.message, 'ok');
        route();
      },
    });
  }

  $('[data-export]', view).addEventListener('click', async () => {
    const res = await api.get('/api/products', { size: 500, q: keyword, categoryId, onShelf });
    downloadCsv('商品档案_' + fmt.today() + '.csv',
      res.items.map((p) => [p.Barcode, p.ProductName, p.Specification, p.Unit, p.CategoryName, p.ListPrice, p.StockQty, p.ShelfLifeDays, p.SupplierName || '', p.OnShelfFlag]),
      ['条码', '商品名称', '规格', '单位', '类别', '售价', '库存', '保质期天数', '供应商', '在售']);
    toast('已导出 ' + res.items.length + ' 条商品档案', 'ok');
  });

  await route();
}
