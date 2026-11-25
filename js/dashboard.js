/**
 * dashboard.js — Tổng quan: thuế GTGT tạm tính, doanh thu/mua vào theo tháng, top đối tác,
 * trạng thái đồng bộ và hóa đơn mới nhất.
 *
 * Mở đầu bằng "bảng tính thuế" trình bày như một dòng sổ kế toán (đầu ra − đầu vào = phải nộp,
 * kết quả gạch đôi) vì đó là con số người làm kế toán thuế cần thấy đầu tiên.
 */
import { h, clear, fmtMoney, fmtInt, fmtDate, fmtRelative, periodRange, todayISO, toISODate, fmtCompact } from './utils.js';
import { state, isLoggedIn, bus } from './core/state.js';
import { repos } from './storage.js';
import { loadInvoices, filterInvoices } from './core/invoiceStore.js';
import { summarize, byPeriod, fillMonths, partnerStats, topN, periodLabel } from './core/reports.js';
import { barChart, donutChart, hbarList } from './core/charts.js';
import { statCard, icon, emptyState, statusBadge, directionBadge } from './core/ui.js';
import { canSync } from './core/syncEngine.js';
import { go } from './core/router.js';
import { openInvoiceDrawer } from './invoiceDetail.js';
import { DIRECTION } from './config.js';

const PERIODS = [
  ['month', 'Tháng này'], ['lastMonth', 'Tháng trước'], ['quarter', 'Quý này'], ['year', 'Năm nay'], ['last12', '12 tháng'],
];

/** Khoảng ngày cho mỗi lựa chọn kỳ. */
function rangeOf(kind) {
  if (kind === 'last12') { const now = new Date(); return [toISODate(new Date(now.getFullYear(), now.getMonth() - 11, 1)), todayISO()]; }
  return periodRange(kind);
}

const rangeText = (kind, [from, to]) => (kind === 'month' || kind === 'lastMonth' ? periodLabel(from.slice(0, 7)) : `${fmtDate(from)} – ${fmtDate(to)}`);

export async function mount(host) {
  let kind = 'quarter';
  const body = h('div', { style: { display: 'grid', gap: '18px' } });
  host.append(body);
  let alive = true;

  async function draw() {
    if (!alive) return;
    const tax = state.companyTax;
    clear(body);
    body.append(heroBanner());
    if (!tax) return body.append(h('section.panel', emptyState({
      title: 'Chưa có doanh nghiệp nào',
      text: 'Đăng nhập cổng Thuế điện tử, hoặc bật dữ liệu mẫu để xem thử ứng dụng.',
      action: h('button.btn.primary', { onclick: () => go('login') }, icon('key', 16), 'Đến trang đăng nhập'),
    })));

    const all = await loadInvoices(tax);
    if (!alive) return;
    if (!all.length) return body.append(h('section.panel', emptyState({
      title: 'Chưa có hóa đơn trên máy',
      text: canSync() ? 'Vào Đồng bộ dữ liệu để tải hóa đơn từ cổng Thuế về máy.' : 'Đăng nhập rồi đồng bộ, hoặc nhập hóa đơn từ tệp XML/Excel.',
      action: h('div.row-gap', h('button.btn.primary', { onclick: () => go(canSync() ? 'sync' : 'login') }, icon(canSync() ? 'sync' : 'key', 16), canSync() ? 'Đồng bộ dữ liệu' : 'Đăng nhập'),
        h('button.btn', { onclick: () => go('excel') }, icon('sheet', 16), 'Nhập từ Excel')),
    })));

    const [from, to] = rangeOf(kind);
    const inRange = filterInvoices(all, { from, to });
    const out = summarize(inRange.filter((i) => i.direction === DIRECTION.OUT));
    const inn = summarize(inRange.filter((i) => i.direction === DIRECTION.IN));
    const payable = out.vat - inn.vat;
    const cancelled = inRange.filter((i) => i.status === 6).length;

    body.append(ledgerRow(out, inn, payable, inRange.length), statsRow(out, inn, cancelled), await chartsRow(all, inRange), partnersRow(inRange), recentPanel(all));
  }

  /** Băng rôn đầu trang: tên ứng dụng và lối tắt tới các việc hay làm. */
  function heroBanner() {
    return h('section.hero',
      h('h2', 'eTax Manager HAK Group'),
      h('p', 'Đồng bộ hóa đơn từ cổng Thuế, tra cứu, đối chiếu và báo cáo VAT cho các đơn vị HAK Group.'),
      h('div.row-gap',
        h('button.btn.light', { type: 'button', onclick: () => go(canSync() ? 'sync' : 'login') }, icon(canSync() ? 'sync' : 'key', 16), canSync() ? 'Đồng bộ dữ liệu' : 'Đăng nhập'),
        h('button.btn', { type: 'button', onclick: () => go('lookup') }, icon('search', 16), 'Tra cứu hóa đơn'),
        h('button.btn', { type: 'button', onclick: () => go('excel') }, icon('sheet', 16), 'Nhập từ Excel')));
  }

  function ledgerRow(out, inn, payable, total) {
    const seg = h('div.seg-control', { role: 'group', 'aria-label': 'Chọn kỳ' }, PERIODS.map(([k, label]) => h('button', {
      type: 'button', class: k === kind ? 'active' : '', onclick: () => { kind = k; draw(); },
    }, label)));
    const sheet = h('section.panel.ledger-sheet',
      h('div.panel-head', h('div', h('h2', 'Thuế GTGT tạm tính'), h('p', rangeText(kind, rangeOf(kind)))), seg),
      h('div.ledger-eq',
        h('div.ledger-line', h('span', `Thuế GTGT đầu ra (${fmtInt(out.count)} hóa đơn)`), h('b', fmtMoney(out.vat))),
        h('div.ledger-line', h('span', `Trừ thuế GTGT đầu vào (${fmtInt(inn.count)} hóa đơn)`), h('b', fmtMoney(inn.vat))),
        h('div.ledger-line.result', h('span', payable >= 0 ? 'Thuế phải nộp tạm tính' : 'Thuế còn được khấu trừ'), h(`b${payable < 0 ? '.neg' : ''}`, fmtMoney(Math.abs(payable))))),
      h('p.ledger-note', `Tính từ ${fmtInt(total)} hóa đơn đã lưu trong kỳ, không gồm hóa đơn hủy hoặc đã bị thay thế. Chưa gồm số khấu trừ kỳ trước; số liệu kê khai chính thức theo tờ khai.`));
    return h('div.ledger', sheet, statusPanel());
  }

  function statusPanel() {
    const box = h('section.panel.side-status', h('div.panel-head', h('h2', 'Đồng bộ')));
    repos.syncState.forCompany(state.companyTax).then(([sin, sout]) => {
      const row = (label, st) => h('div.sync-row', h('span', label), h('span.when', st ? `${fmtRelative(st.lastSyncAt)} · tới ${fmtDate(st.lastTo)}` : 'Chưa đồng bộ'));
      box.append(row('Hóa đơn đầu vào', sin), row('Hóa đơn đầu ra', sout),
        h('div.row-gap', { style: { marginTop: '6px', flexWrap: 'wrap' } },
          h('button.btn.primary', { onclick: () => go(canSync() ? 'sync' : 'login') }, icon(canSync() ? 'sync' : 'key', 16), canSync() ? 'Đồng bộ ngay' : 'Đăng nhập để đồng bộ'),
          !isLoggedIn() && h('span.muted', { style: { fontSize: '12px' } }, 'Chưa có phiên đăng nhập')));
    });
    return box;
  }

  function statsRow(out, inn, cancelled) {
    return h('div.stats',
      statCard({ label: 'Doanh thu (chưa thuế)', value: fmtMoney(out.net), sub: `${fmtInt(out.count)} hóa đơn đầu ra`, tone: 'out' }),
      statCard({ label: 'Mua vào (chưa thuế)', value: fmtMoney(inn.net), sub: `${fmtInt(inn.count)} hóa đơn đầu vào`, tone: 'in' }),
      statCard({ label: 'Tổng thanh toán bán ra', value: fmtMoney(out.total), sub: 'Đã gồm thuế' }),
      statCard({ label: 'Tổng thanh toán mua vào', value: fmtMoney(inn.total), sub: 'Đã gồm thuế' }),
      statCard({ label: 'Hóa đơn đã hủy', value: fmtInt(cancelled), sub: 'Không tính vào số liệu', tone: cancelled ? 'bad' : undefined }));
  }

  async function chartsRow(all, inRange) {
    const months = fillMonths(byPeriod(all, 'month'), all.at(-1).date, all[0].date).slice(-12);
    const chart = barChart({
      labels: months.map((m) => periodLabel(m.period).slice(0, 2) + '/' + m.period.slice(2, 4)),
      series: [{ name: 'Doanh thu', values: months.map((m) => m.outNet) }, { name: 'Mua vào', values: months.map((m) => m.inNet) }],
      ariaLabel: 'Doanh thu và mua vào theo tháng (chưa thuế)',
    });
    const customers = partnerStats(inRange, 'customers');
    const donut = customers.length ? donutChart({ items: topN(customers, 5, 'net'), centerLabel: 'chưa thuế', centerValue: fmtCompact(customers.reduce((a, c) => a + c.net, 0)) }) : h('p.muted', 'Chưa có hóa đơn đầu ra trong kỳ.');
    return h('div.two-col',
      h('section.panel', h('div.panel-head', h('div', h('h2', 'Doanh thu và mua vào theo tháng'), h('p', '12 tháng gần nhất có dữ liệu, chưa gồm thuế')), chart.legend()), chart),
      h('section.panel', h('div.panel-head', h('div', h('h2', 'Cơ cấu doanh thu'), h('p', 'Theo khách hàng trong kỳ'))), donut));
  }

  function partnersRow(inRange) {
    const list = (kindName, title, sub) => {
      const rows = partnerStats(inRange, kindName).slice(0, 6);
      return h('section.panel', h('div.panel-head', h('div', h('h2', title), h('p', sub)), h('button.btn.sm.quiet', { onclick: () => go(kindName) }, 'Xem tất cả')),
        rows.length ? hbarList(rows.map((r) => ({ label: r.name, value: r.net, sub: `${r.tax || 'Không có MST'} — ${fmtInt(r.count)} hóa đơn` }))) : h('p.muted', 'Chưa có dữ liệu trong kỳ.'));
    };
    return h('div.two-col', { style: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
      list('customers', 'Khách hàng lớn nhất', 'Theo doanh thu chưa thuế'), list('suppliers', 'Nhà cung cấp lớn nhất', 'Theo giá trị mua chưa thuế'));
  }

  function recentPanel(all) {
    const rows = all.slice(0, 8);
    const tbl = h('table.tbl', h('thead', h('tr', ['Ngày', 'Số', 'Ký hiệu', 'Chiều', 'Đối tác', 'Tổng tiền', 'Trạng thái'].map((c, i) => h(`th${i === 5 ? '.r' : ''}`, c)))),
      h('tbody', rows.map((inv) => h('tr', { style: { cursor: 'pointer' }, onclick: () => openInvoiceDrawer(inv) },
        h('td', fmtDate(inv.date)), h('td', inv.number), h('td', inv.series), h('td', directionBadge(inv.direction)),
        h('td', { style: { maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis' } }, inv.direction === DIRECTION.OUT ? inv.buyerName : inv.sellerName),
        h('td.r', fmtMoney(inv.total)), h('td', statusBadge(inv))))));
    return h('section.panel.flush', h('div.panel-head', { style: { padding: '16px 20px 0' } }, h('h2', 'Hóa đơn mới nhất')), h('div.table-wrap', tbl));
  }

  const offs = [bus.on('invoices:change', draw), bus.on('company:change', draw), bus.on('session:change', draw)];
  await draw();
  return () => { alive = false; offs.forEach((f) => f()); };
}
