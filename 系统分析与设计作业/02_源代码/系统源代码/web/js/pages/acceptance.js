/* 试运行验收指标（报告表 22 的基线 / 目标 / 当前） */
import { api, esc, fmt, icon, toast, table, tag, $, loadingBlock, stat as statCard } from '../core.js';

export async function render(view, ctx) {
  view.innerHTML = `<div data-body>${loadingBlock('正在按报告表 22 逐项取数…')}</div>`;
  const body = $('[data-body]', view);

  async function load() {
    body.innerHTML = loadingBlock('正在按报告表 22 逐项取数…');
    let data;
    try {
      data = await api.get('/api/reports/acceptance');
    } catch (err) {
      body.innerHTML = `<div class="alert danger" style="display:block">${esc(err.message)}</div>`;
      return;
    }
    const level = (st) => (st === 'ok' ? { label: '已达标', tone: 'ok' } : st === 'warn' ? { label: '接近/待改善', tone: 'warn' } : { label: '待实测', tone: 'plain' });
    body.innerHTML = `
      <div class="welcome">
        <div>
          <h3>试运行两周验收指标 · ${data.okCount}/${data.total} 已达标</h3>
          <p>基线为课程案例的模拟验收值，不包含真实门店数据；当前值由本系统实时取数，未达标项写入下一版需求</p>
        </div>
        <div class="mini-stats">
          <div><b>${data.okCount}</b><span>已达标</span></div>
          <div><b>${data.total - data.okCount}</b><span>待改善</span></div>
          <div><b>${data.generatedAt.slice(11, 16)}</b><span>取数时间</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h3>逐项验收</h3><div class="desc">基线 / 目标 / 当前值三列对照，均由系统按库内记录实时计算</div></div>
          <div class="actions"><button class="btn btn-sm" data-refresh>${icon('refresh')} 重新取数</button>
            <button class="btn btn-sm" data-print>${icon('print')} 打印</button></div>
        </div>
        <div class="card-body">
          ${data.items.map((it) => {
            const lv = level(it.status);
            return `<div class="accept-row">
              <div class="metric">${esc(it.metric)}<span class="tiny muted">${tag(lv.label, lv.tone)}</span></div>
              <div class="track">
                <div class="cur"><b>当前：</b>${esc(it.current)}</div>
                <div class="base">基线：${esc(it.baseline)} · 目标：${esc(it.target)}</div>
                <div class="tiny muted mt8">${esc(it.note)}</div>
              </div>
              <div class="right">${tag(lv.label, lv.tone)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h3>验收方式</h3></div>
          <div class="card-body">
            <div class="tiny muted" style="line-height:2">
              库存账实：随机抽 30 个 SKU 现场盘点比对<br>
              损耗计量：预警清单与报损单比对<br>
              供应商对账：抽 3 家供应商现场计时<br>
              全店盘点：全店实盘计时<br>
              线上履约：系统时间戳统计（下单 → 拣货完成 → 交付）<br>
              熟客赊账：抽查 20 笔挂账记录<br>
              会员复购：会员消费汇总与复购率报表<br>
              合规台账：抽查 10 批进货查验与下架记录
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>指标口径来源</h3></div>
          <div class="card-body">
            <div class="tiny muted" style="line-height:2">
              系统内的验收取数直接来自业务表：StockLedger（库存）、LossReport（损耗）、
              Statement（对账“提交→确认”时长）、StocktakePlan（盘点时长与差异率）、
              OnlineOrder + FulfilmentLog（线上履约）、CreditEntry（赊账凭证）、
              Member + SaleOrder（会员复购）、IncomingInspection（合规台账）。
            </div>
            <div class="alert info mt12" style="display:block">
              「对账耗时」「盘点耗时」用系统内时点差计算，属于真实测量值，不依赖手工估算；
              未产生记录的项目显示为「待实测」。
            </div>
          </div>
        </div>
      </div>`;

    $('[data-refresh]', body).addEventListener('click', load);
    $('[data-print]', body).addEventListener('click', () => window.print());
  }

  await load();
}
