/* 熟客赊账（UC-13） */
import {
  api, state, esc, fmt, icon, toast, table, tag, on, $, $$, emptyState, loadingBlock,
  modal, drawer, confirmBox, stat as statCard,
} from '../core.js';

export async function render(view, ctx) {
  const options = state.options;
  const isOwner = ctx.user.role === 'Owner';
  let tab = ctx.query.tab || 'accounts';

  view.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="seg" data-tabs>
          <button data-tab="accounts" class="${tab === 'accounts' ? 'active' : ''}">赊账账户</button>
          <button data-tab="dunning" class="${tab === 'dunning' ? 'active' : ''}">催收清单</button>
          <button data-tab="customers" class="${tab === 'customers' ? 'active' : ''}">顾客档案</button>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-newcust>${icon('plus')} 顾客建档</button>
        <button class="btn btn-sm btn-primary" data-newdebt>${icon('wallet')} 登记挂账</button>
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
    if (tab === 'dunning') return renderDunning();
    if (tab === 'customers') return renderCustomers();
    return renderAccounts();
  }

  /* ------------------------------------------------------------ 账户 */
  async function renderAccounts() {
    const res = await api.get('/api/credit/accounts');
    const s = res.summary;
    body.innerHTML = `
      <div class="grid grid-4 mb12">
        ${statCard({ label: '赊账余额合计', value: fmt.yuan(s.outstanding, 0), iconName: 'wallet', tone: 'warn',
          sub: `${s.accounts} 户有未结挂账` })}
        ${statCard({ label: '逾期账户', value: s.overdue, unit: '户', tone: 'danger', iconName: 'alert',
          sub: '账龄超过约定期限，进入催收清单' })}
        ${statCard({ label: '授信额度合计', value: fmt.yuan(s.limit, 0), tone: 'info', iconName: 'badge',
          sub: '额度校核在挂账时实时进行' })}
        ${statCard({ label: '账龄口径', value: '按到期日', tone: 'violet', iconName: 'calendar',
          sub: '最早未结挂账的到期日与今天之差' })}
      </div>
      <div class="alert info mb12" style="display:block">
        <b>业务规则</b>：挂账必须留下凭证与联系方式，单笔与累计金额不得超过约定额度；超出额度须老板确认；
        账龄超过约定期限自动进入催收清单；核销必须与收款记录一一对应；赊账数据不得物理删除。
      </div>
      ${table({
        columns: [
          { label: '账户 / 顾客', render: (r) => `<div class="strong">${esc(r.Name)}</div><div class="sub mono">${esc(r.AccountNo)} · ${esc(r.Phone || '无电话')}</div>` },
          { label: '额度', cls: 'num', render: (r) => fmt.yuan(r.CreditLimit) },
          { label: '已用', cls: 'num strong', render: (r) => fmt.yuan(r.Outstanding) },
          { label: '可用', cls: 'num', render: (r) => r.AvailableAmount === null ? '—' : fmt.yuan(r.AvailableAmount) },
          { label: '额度使用', render: (r) => r.LimitUsedPct === null ? '<span class="muted">无额度</span>'
            : `<div class="progress ${r.LimitUsedPct > 90 ? 'danger' : r.LimitUsedPct > 70 ? 'warn' : ''}" style="width:96px"><i style="width:${Math.min(100, r.LimitUsedPct)}%"></i></div>
               <span class="tiny muted">${r.LimitUsedPct}%</span>` },
          { label: '账龄', render: (r) => (r.OverdueDays > 0 ? tag('逾期 ' + r.OverdueDays + ' 天', 'danger') : r.Outstanding > 0 ? tag('账期内', 'ok') : '<span class="muted">无挂账</span>') },
          { label: '最早到期', render: (r) => fmt.date(r.EarliestDue) },
          { label: '状态', render: (r) => tag(r.AccountStatus === 'Overdue' ? '逾期' : r.AccountStatus === 'Normal' ? '正常' : '空闲', r.AccountStatus === 'Overdue' ? 'danger' : r.AccountStatus === 'Normal' ? 'ok' : 'plain') },
          { label: '', cls: 'actions', render: (r) => `<button class="btn btn-sm" data-detail="${r.AccountID}">流水</button>
            ${r.Outstanding > 0 ? `<button class="btn btn-sm btn-primary" data-settle="${r.AccountID}">收款核销</button>` : ''}` },
        ],
        rows: res.items,
        empty: '还没有赊账账户，请先在「顾客档案」维护额度',
      })}`;

    on(body, 'click', '[data-detail]', async (e, btn) => {
      const d = await api.get('/api/credit/accounts/' + btn.dataset.detail + '/entries');
      drawer({
        title: '赊账流水 · ' + d.account.Name,
        subtitle: `账户 ${esc(d.account.AccountNo)} · 额度 ${fmt.yuan(d.account.CreditLimit)} · 账期 ${d.account.CreditTermDays} 天`,
        body: table({
          columns: [
            { label: '流水号', render: (r) => `<span class="mono">${esc(r.EntryNo)}</span>` },
            { label: '类型', render: (r) => tag(r.EntryType === 'charge' ? '挂账' : '核销', r.EntryType === 'charge' ? 'warn' : 'ok') },
            { label: '金额', cls: 'num strong', render: (r) => fmt.yuan(r.Amount) },
            { label: '已核销', cls: 'num', render: (r) => fmt.yuan(r.SettledAmount) },
            { label: '未核销', cls: 'num', render: (r) => r.EntryType === 'charge' ? fmt.yuan(r.Remain) : '—' },
            { label: '约定还款日', render: (r) => fmt.date(r.DueDate) + (r.EntryType === 'charge' && r.Remain > 0.001
              ? (r.OverdueDays > 0 ? ' ' + tag('逾期 ' + r.OverdueDays + ' 天', 'danger') : '') : '') },
            { label: '登记', render: (r) => esc(r.RegisterName || '') + `<div class="sub">${fmt.datetime(r.CreatedAt)}</div>` },
            { label: '备注', render: (r) => esc(r.Remark || '') },
            { label: '', cls: 'actions', render: (r) => (r.EntryType === 'charge' && r.Remain > 0.001)
              ? `<button class="btn btn-sm" data-settleone="${r.EntryID}" data-remain="${r.Remain}">核销</button>` : '' },
          ],
          rows: d.items,
          empty: '没有流水',
        }),
      }).body.querySelectorAll('[data-settleone]').forEach((b) => b.addEventListener('click', () => {
        openSettle(Number(b.dataset.settleone), Number(b.dataset.remain), () => { document.querySelector('.drawer-mask')?.click(); route(); });
      }));
    });
    on(body, 'click', '[data-settle]', async (e, btn) => {
      const acc = res.items.find((a) => String(a.AccountID) === btn.dataset.settle);
      const d = await api.get(`/api/credit/accounts/${acc.AccountID}/entries`);
      const open = d.items.filter((i) => i.EntryType === 'charge' && i.Remain > 0.001);
      if (open.length === 1) {
        openSettle(open[0].EntryID, open[0].Remain, route);
      } else {
        modal({
          title: '选择要核销的挂账 · ' + acc.Name, size: 'wide', hideFooter: true,
          content: table({
            columns: [
              { label: '流水号', render: (r) => `<span class="mono">${esc(r.EntryNo)}</span>` },
              { label: '挂账金额', cls: 'num', render: (r) => fmt.yuan(r.Amount) },
              { label: '未核销', cls: 'num', render: (r) => fmt.yuan(r.Remain) },
              { label: '到期日', render: (r) => fmt.date(r.DueDate) },
              { label: '', cls: 'actions', render: (r) => `<button class="btn btn-sm btn-primary" data-pick-settle="${r.EntryID}" data-remain="${r.Remain}">核销</button>` },
            ],
            rows: open,
          }),
        }).el.querySelectorAll('[data-pick-settle]').forEach((b) => b.addEventListener('click', () => {
          document.querySelector('.modal-mask')?.remove();
          openSettle(Number(b.dataset.pickSettle), Number(b.dataset.remain), route);
        }));
      }
    });
  }

  function openSettle(entryId, remain, after) {
    modal({
      title: '收款核销', desc: '核销必须与收款记录一一对应；部分还款会保留未核销余额并重新计算账龄',
      content: `<div class="form-grid">
          <div class="field"><label>本次收款金额<span class="req">*</span></label>
            <input class="input" name="amount" value="${fmt.money(remain)}" data-max="${remain}"></div>
          <div class="field"><label>收款方式<span class="req">*</span></label>
            <select class="select" name="payMethod"><option>现金</option><option>微信</option><option>支付宝</option><option>银联</option></select></div>
          <div class="field full"><label>备注</label><input class="input" name="remark" placeholder="如：顾客到店结清"></div>
        </div>`,
      onSubmit: async (v) => {
        const amount = Number(v.amount);
        if (amount <= 0) throw new Error('收款金额必须大于 0');
        const r2 = await api.post(`/api/credit/entries/${entryId}/settle`, { amount, payMethod: v.payMethod });
        toast(r2.message, 'ok', 4200);
        if (after) after();
      },
    });
  }

  /* ------------------------------------------------------------ 催收 */
  async function renderDunning() {
    const res = await api.get('/api/credit/dunning');
    const s = res.summary;
    body.innerHTML = `
      <div class="grid grid-3 mb12">
        ${statCard({ label: '逾期未收', value: fmt.yuan(s.overdueAmount, 0), tone: 'danger', iconName: 'alert',
          sub: `${s.overdueCount} 笔已过约定还款日` })}
        ${statCard({ label: '挂账余额合计', value: fmt.yuan(s.totalOutstanding, 0), iconName: 'wallet',
          sub: '含未到期挂账' })}
        ${statCard({ label: '催收清单', value: res.items.filter((i) => i.OverdueDays >= 0).length, unit: '笔', tone: 'warn',
          iconName: 'calendar', sub: '每日开店前生成' })}
      </div>
      <div class="alert warn mb12" style="display:block">
        逾期时间越长越难收：建议 3 天提醒、7 天上门、15 天停止赊账。系统保留全部挂账凭证与流水，顾客有异议时可逐笔核对。
      </div>
      ${table({
        columns: [
          { label: '顾客', render: (r) => `<div class="strong">${esc(r.Name)}</div><div class="sub">${esc(r.Phone || '未留电话')}</div>` },
          { label: '挂账', cls: 'num', render: (r) => fmt.yuan(r.Amount) },
          { label: '已核销', cls: 'num', render: (r) => fmt.yuan(r.SettledAmount) },
          { label: '未核销', cls: 'num strong', render: (r) => fmt.yuan(r.Remain) },
          { label: '约定还款日', render: (r) => fmt.date(r.DueDate) },
          { label: '账龄', render: (r) => tag(r.stage, r.level === 'danger' ? 'danger' : r.level === 'warn' ? 'warn' : r.level === 'info' ? 'info' : 'plain') },
          { label: '备注', render: (r) => esc(r.Remark || '') },
          { label: '', cls: 'actions', render: (r) => `<button class="btn btn-sm btn-primary" data-settleone="${r.EntryID}" data-remain="${r.Remain}">登记收款</button>` },
        ],
        rows: res.items,
        rowClass: (r) => (r.OverdueDays > 0 ? 'warn-row' : ''),
        empty: '没有待收挂账',
      })}`;
    on(body, 'click', '[data-settleone]', (e, btn) => openSettle(Number(btn.dataset.settleone), Number(btn.dataset.remain), route));
  }

  /* ------------------------------------------------------------ 顾客 */
  async function renderCustomers() {
    const res = await api.get('/api/customers', { size: 100 });
    body.innerHTML = table({
      columns: [
        { label: '顾客', render: (r) => `<div class="strong">${esc(r.Name)}</div><div class="sub">${esc(r.Phone || '—')} ${esc(r.Address || '')}</div>` },
        { label: '会员', render: (r) => r.MemberID ? tag(r.Level || '会员', 'violet') + ` <span class="tiny muted">${fmt.int(r.Points || 0)} 分</span>` : '<span class="muted">—</span>' },
        { label: '赊账额度', cls: 'num', render: (r) => r.CreditLimit ? fmt.yuan(r.CreditLimit) : '—' },
        { label: '账期', cls: 'num', render: (r) => r.CreditLimit ? r.CreditTermDays + ' 天' : '—' },
        { label: '未结挂账', cls: 'num', render: (r) => r.Outstanding ? `<span class="${r.Outstanding > 0 ? 'tag warn' : ''}">${fmt.yuan(r.Outstanding)}</span>` : '0.00' },
        { label: '消费单数', cls: 'num', render: (r) => r.OrderCount || 0 },
        { label: '累计消费', cls: 'num', render: (r) => fmt.yuan(r.TotalSpent || 0) },
        { label: '最近到店', render: (r) => r.LastOrderAt ? fmt.ago(r.LastOrderAt) : '<span class="muted">未消费</span>' },
        { label: '', cls: 'actions', render: (r) => isOwner ? `<button class="btn btn-sm" data-edit="${r.CustomerID}">修改</button>` : '' },
      ],
      rows: res.items,
      empty: '还没有顾客档案',
    });

    on(body, 'click', '[data-edit]', (e, btn) => {
      const c = res.items.find((x) => String(x.CustomerID) === btn.dataset.edit);
      modal({
        title: '修改顾客档案 · ' + c.Name,
        content: `<div class="form-grid">
            <div class="field"><label>顾客称呼</label><input class="input" name="name" value="${esc(c.Name)}"></div>
            <div class="field"><label>手机号</label><input class="input" name="phone" value="${esc(c.Phone || '')}"></div>
            <div class="field"><label>赊账额度（元）</label><input class="input" name="creditLimit" value="${c.CreditLimit || 0}"></div>
            <div class="field"><label>账期（天）</label><input class="input" name="creditTermDays" value="${c.CreditTermDays || 30}"></div>
            <div class="field full"><label>地址</label><input class="input" name="address" value="${esc(c.Address || '')}"></div>
            <div class="field full"><label>备注</label><input class="input" name="note" value="${esc(c.Note || '')}"></div>
          </div>`,
        onSubmit: async (v) => {
          await api.put('/api/customers/' + c.CustomerID, {
            name: v.name, phone: v.phone, address: v.address,
            creditLimit: Number(v.creditLimit), creditTermDays: Number(v.creditTermDays), note: v.note,
          });
          toast('顾客资料已更新', 'ok');
          route();
        },
      });
    });
  }

  $('[data-newcust]', view).addEventListener('click', () => {
    modal({
      title: '顾客建档', desc: '手机号只用于催收与通知，按最小必要采集',
      content: `<div class="form-grid">
          <div class="field"><label>顾客称呼<span class="req">*</span></label><input class="input" name="name" placeholder="如：模拟顾客 01"></div>
          <div class="field"><label>手机号</label><input class="input" name="phone"></div>
          <div class="field"><label>赊账额度（元）</label><input class="input" name="creditLimit" value="0"></div>
          <div class="field"><label>账期（天）</label><input class="input" name="creditTermDays" value="30"></div>
          <div class="field full"><label>地址</label><input class="input" name="address"></div>
          <div class="field full"><label class="checkbox"><input type="checkbox" name="isMember" value="Y" checked> 同时开通会员（累计积分与复购统计）</label></div>
        </div>`,
      onSubmit: async (v) => {
        const r2 = await api.post('/api/customers', {
          name: v.name, phone: v.phone, address: v.address,
          creditLimit: Number(v.creditLimit), creditTermDays: Number(v.creditTermDays),
          isMember: v.isMember ? 'Y' : 'N',
        });
        toast(r2.message, 'ok');
        tab = 'customers';
        $$('[data-tabs] button', view).forEach((x) => x.classList.toggle('active', x.dataset.tab === 'customers'));
        route();
      },
    });
  });

  $('[data-newdebt]', view).addEventListener('click', async () => {
    const custs = await api.get('/api/customers', { credit: 1, size: 100 });
    if (!custs.items.length) { toast('还没有约定赊账额度的顾客，请先建档并维护额度', 'warn'); return; }
    modal({
      title: '登记挂账',
      desc: '系统会校核可用额度；超出额度须老板确认后才能挂账',
      content: `<div class="form-grid">
          <div class="field"><label>顾客<span class="req">*</span></label>
            <select class="select" name="customerId">${custs.items.map((c) =>
              `<option value="${c.CustomerID}">${esc(c.Name)} · 额度 ${fmt.yuan(c.CreditLimit)} · 已用 ${fmt.yuan(c.Outstanding || 0)}</option>`).join('')}</select></div>
          <div class="field"><label>挂账金额（元）<span class="req">*</span></label><input class="input" name="amount" value="100"></div>
          <div class="field"><label>约定还款日期<span class="req">*</span></label><input class="input" type="date" name="dueDate" value="${fmt.dateOffset(30)}"></div>
          <div class="field"><label>备注</label><input class="input" name="remark" placeholder="如：粮油，月底结"></div>
        </div>
        ${isOwner ? '<div class="form-hint mt8">老板账号可直接登记超额挂账（系统会留痕标记）。</div>' : ''}`,
      onSubmit: async (v) => {
        const r2 = await api.post('/api/credit/entries', {
          customerId: Number(v.customerId), amount: Number(v.amount),
          dueDate: v.dueDate, remark: v.remark, ownerConfirm: isOwner,
        });
        toast(r2.message + (r2.overLimit ? '（已超额度，老板确认）' : ''), 'ok', 4600);
        route();
      },
    });
  });

  await route();
}
