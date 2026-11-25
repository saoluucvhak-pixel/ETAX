/**
 * report.js — Trang "Báo cáo": doanh thu, thuế GTGT, khách hàng, nhà cung cấp; thống kê theo tháng/quý/năm.
 * Xuất Excel (nhiều sheet) và PDF. Hóa đơn hủy / đã bị thay thế không được tính (xem reports.js).
 */
import { h, fmtMoney, fmtInt, fmtDate, fmtCompact, fmtPercent, periodRange, todayISO, toISODate, sum } from './utils.js';
import { state, bus } from './core/state.js';
import { DIRECTION } from './config.js';
import { loadInvoices, filterInvoices } from './core/invoiceStore.js';
import { summarize, byPeriod, vatByRate, partnerStats, topN, periodLabel } from './core/reports.js';
import { barChart, donutChart } from './core/charts.js';
import { statCard, icon, select, tabs, menuButton, emptyState, toast, withLoading } from './core/ui.js';
import { exportSheets, exportReportPdf } from './export.js';
import { escapeHtml } from './utils.js';
import { go } from './core/router.js';

const RANGES = [['all', 'Mọi thời gian'], ['month', 'Tháng này'], ['lastMonth', 'Tháng trước'], ['quarter', 'Quý này'], ['lastQuarter', 'Quý trước'], ['year', 'Năm nay'], ['lastYear', 'Năm trước'], ['last12', '12 tháng gần đây'], ['custom', 'Tùy chọn…']];
const GRANS = [['month', 'Tháng'], ['quarter', 'Quý'], ['year', 'Năm']];

const shortLabel = (p) => (/^\d{4}-Q\d$/.test(p) ? `Q${p.slice(-1)}/${p.slice(2, 4)}` : /^\d{4}-\d{2}$/.test(p) ? `${p.slice(5)}/${p.slice(2, 4)}` : p);

/** Bảng đơn giản. cols: [{title, key|get, right, fmt}] ; totals: object cùng khóa hoặc null. */
function table(cols, rows, totals) {
  const cell = (c, r) => (c.get ? c.get(r) : r[c.key]);
  const fmt = (c, v) => (c.fmt ? c.fmt(v) : c.right ? fmtMoney(v) : v ?? '');
  return h('div.table-wrap', h('table.tbl',
    h('thead', h('tr', cols.map((c) => h(`th${c.right ? '.r' : ''}`, c.title)))),
    h('tbody', rows.map((r) => h('tr', cols.map((c) => { const v = cell(c, r); return h(`td${c.right ? '.r' : ''}${c.right && Number(v) < 0 ? '.neg' : ''}`, fmt(c, v)); })))),
    totals && h('tfoot', h('tr', cols.map((c, i) => h(`td${c.right ? '.r' : ''}`, i === 0 && totals[c.key] === undefined ? 'Cộng' : totals[c.key] !== undefined ? fmt(c, totals[c.key]) : ''))))));
}

export async function mount(host) {
  if (!state.companyTax) {
    host.append(h('section.panel', emptyState({ title: 'Chưa chọn doanh nghiệp', text: 'Đăng nhập hoặc chọn doanh nghiệp để xem báo cáo.', action: h('button.btn.primary', { onclick: () => go('login') }, 'Đến trang đăng nhập') })));
    return null;
  }
  let all = [];
  let gran = 'month';
  let range = 'year';
  let from = '';
  let to = '';
  let activeTab = 0;
  const body = h('div');
  const rangeSel = select(RANGES, range);
  const fromIn = h('input', { type: 'date', hidden: true });
  const toIn = h('input', { type: 'date', hidden: true });
  const granCtl = h('div.seg-control', { role: 'group', 'aria-label': 'Thống kê theo' }, GRANS.map(([k, l]) => h('button', { type: 'button', class: k === gran ? 'active' : '', dataset: { k }, onclick: () => { gran = k; [...granCtl.children].forEach((b) => b.classList.toggle('active', b.dataset.k === k)); draw(); } }, l)));

  function bounds() {
    if (range === 'all') return ['', ''];
    if (range === 'custom') return [from, to];
    if (range === 'last12') { const n = new Date(); return [toISODate(new Date(n.getFullYear(), n.getMonth() - 11, 1)), todayISO()]; }
    return periodRange(range);
  }

  /** Dữ liệu tính toán dùng chung cho màn hình, Excel và PDF. */
  function compute() {
    const [f, t] = bounds();
    const list = filterInvoices(all, { from: f, to: t });
    return {
      f, t, list,
      out: summarize(list.filter((i) => i.direction === DIRECTION.OUT)), inn: summarize(list.filter((i) => i.direction === DIRECTION.IN)),
      periods: byPeriod(list, gran), vat: vatByRate(list),
      customers: partnerStats(list, 'customers'), suppliers: partnerStats(list, 'suppliers'),
    };
  }

  const revenueCols = [
    { title: 'Kỳ', get: (r) => periodLabel(r.period) }, { title: 'HĐ đầu ra', key: 'outCount', right: true, fmt: fmtInt }, { title: 'Doanh thu', key: 'outNet', right: true }, { title: 'Thuế đầu ra', key: 'outVat', right: true },
    { title: 'HĐ đầu vào', key: 'inCount', right: true, fmt: fmtInt }, { title: 'Mua vào', key: 'inNet', right: true }, { title: 'Thuế đầu vào', key: 'inVat', right: true },
  ];
  const partnerCols = (label) => [
    { title: 'MST', get: (r) => r.tax || '(không có)' }, { title: label, key: 'name' }, { title: 'Số HĐ', key: 'count', right: true, fmt: fmtInt },
    { title: 'Giá trị', key: 'net', right: true }, { title: 'Thuế', key: 'vat', right: true }, { title: 'Tổng tiền', key: 'total', right: true },
  ];

  function panel(title, sub, ...kids) { return h('section.panel', h('div.panel-head', h('div', h('h2', title), sub && h('p', sub))), ...kids); }

  function draw() {
    const d = compute();
    body.replaceChildren();
    if (!d.list.length) return body.append(h('section.panel', emptyState({ title: 'Không có hóa đơn trong kỳ này', text: 'Chọn kỳ khác hoặc đồng bộ thêm dữ liệu.', action: h('button.btn', { onclick: () => go('sync') }, icon('sync', 16), 'Đồng bộ dữ liệu') })));
    const payable = d.out.vat - d.inn.vat;

    const revenueTab = () => {
      const chart = barChart({ labels: d.periods.map((p) => shortLabel(p.period)), series: [{ name: 'Doanh thu', values: d.periods.map((p) => p.outNet) }, { name: 'Mua vào', values: d.periods.map((p) => p.inNet) }], ariaLabel: 'Doanh thu và mua vào theo kỳ' });
      const totals = { outCount: d.out.count, outNet: d.out.net, outVat: d.out.vat, inCount: d.inn.count, inNet: d.inn.net, inVat: d.inn.vat };
      return h('div', { style: { display: 'grid', gap: '18px' } }, panel('Doanh thu và mua vào', 'Giá trị chưa thuế theo kỳ', chart.legend(), chart), panel('Bảng số liệu theo kỳ', null, table(revenueCols, d.periods, totals)));
    };

    const vatTab = () => {
      const rateCols = [{ title: 'Thuế suất', key: 'label' }, { title: 'Doanh thu chịu thuế', key: 'outBase', right: true }, { title: 'Thuế đầu ra', key: 'outTax', right: true }, { title: 'Mua vào', key: 'inBase', right: true }, { title: 'Thuế đầu vào', key: 'inTax', right: true }];
      const perCols = [{ title: 'Kỳ', get: (r) => periodLabel(r.period) }, { title: 'Thuế đầu ra', key: 'outVat', right: true }, { title: 'Thuế đầu vào', key: 'inVat', right: true }, { title: 'Phải nộp / (được khấu trừ)', key: 'vatPayable', right: true }];
      const chart = barChart({ labels: d.periods.map((p) => shortLabel(p.period)), series: [{ name: 'Thuế đầu ra', values: d.periods.map((p) => p.outVat) }, { name: 'Thuế đầu vào', values: d.periods.map((p) => p.inVat) }], ariaLabel: 'Thuế GTGT đầu ra và đầu vào theo kỳ' });
      return h('div', { style: { display: 'grid', gap: '18px' } },
        h('div.stats', statCard({ label: 'Thuế đầu ra', value: fmtMoney(d.out.vat), tone: 'out' }), statCard({ label: 'Thuế đầu vào', value: fmtMoney(d.inn.vat), tone: 'in' }), statCard({ label: payable >= 0 ? 'Phải nộp tạm tính' : 'Còn được khấu trừ', value: fmtMoney(Math.abs(payable)), tone: payable >= 0 ? 'bad' : 'ok' })),
        panel('Phân tích theo thuế suất', 'Cộng từ bảng thuế từng hóa đơn', table(rateCols, d.vat.rows, d.vat.totals)),
        panel('Thuế theo kỳ', null, chart.legend(), chart, table(perCols, d.periods, { outVat: d.out.vat, inVat: d.inn.vat, vatPayable: payable })));
    };

    const partnerTab = (kind) => {
      const rows = kind === 'customers' ? d.customers : d.suppliers;
      const label = kind === 'customers' ? 'Khách hàng' : 'Nhà cung cấp';
      const grand = sum(rows, (r) => r.net);
      const cols = [...partnerCols(label), { title: 'Tỷ trọng', get: (r) => (grand ? fmtPercent(r.net / grand) : ''), right: true, fmt: (v) => v }];
      return h('div', { style: { display: 'grid', gap: '18px' } },
        rows.length ? panel(`Cơ cấu ${label.toLowerCase()}`, 'Top 6 theo giá trị chưa thuế', donutChart({ items: topN(rows, 6, 'net'), centerLabel: 'chưa thuế', centerValue: fmtCompact(grand) })) : null,
        panel(`Danh sách ${label.toLowerCase()}`, `${fmtInt(rows.length)} đối tác`, rows.length ? table(cols, rows.slice(0, 100), { count: sum(rows, (r) => r.count), net: grand, vat: sum(rows, (r) => r.vat), total: sum(rows, (r) => r.total) }) : h('p.muted', 'Không có dữ liệu.')),
        rows.length > 100 ? h('p.muted', 'Chỉ hiện 100 đối tác lớn nhất. Xem đầy đủ ở trang Khách hàng / Nhà cung cấp.') : null);
    };

    body.append(tabs([{ label: 'Doanh thu', render: revenueTab }, { label: 'Thuế GTGT', render: vatTab }, { label: 'Khách hàng', render: () => partnerTab('customers') }, { label: 'Nhà cung cấp', render: () => partnerTab('suppliers') }], activeTab));
    body.querySelectorAll('.tab').forEach((b, i) => b.addEventListener('click', () => { activeTab = i; }));
  }

  // ------------------------------------------------------------ Xuất
  async function exportExcel() {
    const d = compute();
    if (!d.list.length) return toast('Không có số liệu để xuất.', 'warn');
    const sub = [`Doanh nghiệp: ${state.companyTax}`, `Kỳ: ${d.f ? fmtDate(d.f) : 'đầu'} – ${d.t ? fmtDate(d.t) : 'nay'}`];
    const payable = d.out.vat - d.inn.vat;
    const col = (header, key, type = 'money', width = 18) => ({ header, key, type, width });
    await withLoading('Đang tạo báo cáo Excel…', () => exportSheets(`BaoCao_${state.companyTax}_${todayISO().replaceAll('-', '')}`, [
      { name: 'Doanh thu', title: 'BÁO CÁO DOANH THU VÀ MUA VÀO', subtitle: sub, columns: [{ header: 'Kỳ', value: (r) => periodLabel(r.period), width: 14 }, col('HĐ đầu ra', 'outCount', 'number', 12), col('Doanh thu', 'outNet'), col('Thuế đầu ra', 'outVat'), col('HĐ đầu vào', 'inCount', 'number', 12), col('Mua vào', 'inNet'), col('Thuế đầu vào', 'inVat')], rows: d.periods, totals: ['outNet', 'outVat', 'inNet', 'inVat'] },
      { name: 'Thuế GTGT', title: `BÁO CÁO THUẾ GTGT — phải nộp tạm tính: ${fmtMoney(payable)}`, subtitle: sub, columns: [{ header: 'Thuế suất', key: 'label', width: 24 }, col('Doanh thu chịu thuế', 'outBase'), col('Thuế đầu ra', 'outTax'), col('Mua vào', 'inBase'), col('Thuế đầu vào', 'inTax')], rows: d.vat.rows, totals: ['outBase', 'outTax', 'inBase', 'inTax'] },
      { name: 'Thuế theo kỳ', title: 'THUẾ GTGT THEO KỲ', subtitle: sub, columns: [{ header: 'Kỳ', value: (r) => periodLabel(r.period), width: 14 }, col('Thuế đầu ra', 'outVat'), col('Thuế đầu vào', 'inVat'), col('Phải nộp / (khấu trừ)', 'vatPayable')], rows: d.periods, totals: ['outVat', 'inVat', 'vatPayable'] },
      { name: 'Khách hàng', title: 'KHÁCH HÀNG', subtitle: sub, columns: [{ header: 'MST', key: 'tax', width: 16 }, { header: 'Khách hàng', key: 'name', width: 44 }, col('Số HĐ', 'count', 'number', 10), col('Giá trị', 'net'), col('Thuế', 'vat'), col('Tổng tiền', 'total')], rows: d.customers, totals: ['net', 'vat', 'total'] },
      { name: 'Nhà cung cấp', title: 'NHÀ CUNG CẤP', subtitle: sub, columns: [{ header: 'MST', key: 'tax', width: 16 }, { header: 'Nhà cung cấp', key: 'name', width: 44 }, col('Số HĐ', 'count', 'number', 10), col('Giá trị', 'net'), col('Thuế', 'vat'), col('Tổng tiền', 'total')], rows: d.suppliers, totals: ['net', 'vat', 'total'] },
    ], { periods: d.periods.length }));
  }

  async function exportPdf() {
    const d = compute();
    if (!d.list.length) return toast('Không có số liệu để xuất.', 'warn');
    const e = escapeHtml;
    const tbl = (head, rows) => `<table><thead><tr>${head.map((x) => `<th>${e(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'r' : ''}">${e(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const payable = d.out.vat - d.inn.vat;
    const html = `<h2>Thuế GTGT tạm tính</h2>${tbl(['Chỉ tiêu', 'Số tiền'], [['Thuế GTGT đầu ra', fmtMoney(d.out.vat)], ['Thuế GTGT đầu vào', fmtMoney(d.inn.vat)], [payable >= 0 ? 'Phải nộp tạm tính' : 'Còn được khấu trừ', fmtMoney(Math.abs(payable))]])}
      <h2>Theo kỳ</h2>${tbl(['Kỳ', 'Doanh thu', 'Thuế đầu ra', 'Mua vào', 'Thuế đầu vào'], d.periods.map((p) => [periodLabel(p.period), fmtMoney(p.outNet), fmtMoney(p.outVat), fmtMoney(p.inNet), fmtMoney(p.inVat)]))}
      <h2>Theo thuế suất</h2>${tbl(['Thuế suất', 'Doanh thu', 'Thuế đầu ra', 'Mua vào', 'Thuế đầu vào'], d.vat.rows.map((r) => [r.label, fmtMoney(r.outBase), fmtMoney(r.outTax), fmtMoney(r.inBase), fmtMoney(r.inTax)]))}
      <h2>Top khách hàng</h2>${tbl(['MST', 'Khách hàng', 'Số HĐ', 'Giá trị'], d.customers.slice(0, 15).map((r) => [r.tax, r.name, fmtInt(r.count), fmtMoney(r.net)]))}
      <h2>Top nhà cung cấp</h2>${tbl(['MST', 'Nhà cung cấp', 'Số HĐ', 'Giá trị'], d.suppliers.slice(0, 15).map((r) => [r.tax, r.name, fmtInt(r.count), fmtMoney(r.net)]))}`;
    await exportReportPdf('Báo cáo hóa đơn và thuế GTGT', html, { filename: `BaoCao_${state.companyTax}` });
  }

  rangeSel.addEventListener('change', () => { range = rangeSel.value; fromIn.hidden = toIn.hidden = range !== 'custom'; draw(); });
  fromIn.addEventListener('change', () => { from = fromIn.value; draw(); });
  toIn.addEventListener('change', () => { to = toIn.value; draw(); });

  host.append(h('div.toolbar', rangeSel, fromIn, toIn, granCtl, h('span.spacer'), menuButton('Xuất báo cáo', [{ label: 'Excel (nhiều sheet)', icon: 'sheet', onClick: exportExcel }, { label: 'PDF (in)', icon: 'pdf', onClick: exportPdf }])), body);
  const reload = async () => { all = await loadInvoices(state.companyTax); draw(); };
  await reload();
  const offs = [bus.on('invoices:change', reload), bus.on('company:change', reload)];
  return () => offs.forEach((f) => f());
}
