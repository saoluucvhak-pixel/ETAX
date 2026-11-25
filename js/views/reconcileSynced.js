/**
 * reconcile.js — Trang "Đối chiếu": so sổ quản trị thuế GTGT (Excel/CSV) với hóa đơn đã tải từ cổng Thuế.
 * Tự nhận cột theo tiêu đề (chỉnh lại được), báo cáo hóa đơn khớp / lệch tiền / lệch ngày-kỳ / thiếu bên nào / hủy,
 * và xuất Excel nhiều sheet. Phép tính nằm ở core/reconcile.js.
 */
import { h, clear, fmtInt, fmtMoney, fmtDate, readBuffer, readText, parseCsv, periodRange, todayISO } from '../utils.js';
import { state, bus } from '../core/state.js';
import { readXlsx } from '../core/xlsx.js';
import { DataGrid } from '../core/datagrid.js';
import { loadInvoices } from '../core/invoiceStore.js';
import { LEDGER_FIELDS, STATUS, STATUS_ORDER, autoMapFields, findHeaderRow, readLedger, aggregateLedger, reconcile } from '../core/reconcile.js';
import { dropZone } from '../core/dropzone.js';
import { icon, select, field, toast, withLoading, emptyState, statCard } from '../core/ui.js';
import { saveSettings } from '../core/settings.js';
import { exportSheets } from '../export.js';
import { openInvoiceDrawer } from '../invoiceDetail.js';
import { logger } from '../logger.js';
import { go } from '../core/router.js';

const TONE = { match: 'ok', diff: 'bad', date: 'warn', period: 'warn', mst: 'warn', cancelled: 'bad', missingLedger: 'warn', missingPortal: 'bad', expected: 'muted', pos: 'muted' };
const PERIODS = [['ledger', 'Theo ngày trong sổ'], ['month', 'Tháng này'], ['lastMonth', 'Tháng trước'], ['quarter', 'Quý này'], ['lastQuarter', 'Quý trước'], ['year', 'Năm nay'], ['lastYear', 'Năm trước'], ['custom', 'Tùy chọn…']];

export async function mount(host) {
  if (!state.companyTax) {
    host.append(h('section.panel', emptyState({ title: 'Chưa chọn doanh nghiệp', text: 'Chọn doanh nghiệp và đồng bộ hóa đơn trước khi đối chiếu.', action: h('button.btn.primary', { onclick: () => go('login') }, 'Đến trang đăng nhập') })));
    return null;
  }
  let sheets = [];
  let fileName = '';
  let map = {};
  let data = []; // các dòng dữ liệu của sheet đang chọn
  let result = null;
  let filter = 'all';
  let last = null; // tham số lần đối chiếu gần nhất (dùng khi xuất)

  const dir = select([['in', 'Sổ đầu vào (mua vào)'], ['out', 'Sổ đầu ra (bán ra)']], 'in');
  const per = select(PERIODS, 'ledger');
  const from = h('input', { type: 'date', hidden: true });
  const to = h('input', { type: 'date', hidden: true });
  const tol = h('input', { type: 'number', value: '1', min: 0, step: 1 });
  const merge = h('input', { type: 'checkbox', checked: true });
  const kw = h('input', { type: 'text', value: state.settings.reconcileKeywords ?? 'ngân hàng, bảo hiểm', placeholder: 'ngân hàng, bảo hiểm, bidv' });
  const setup = h('div');
  const out = h('div');
  per.addEventListener('change', () => { from.hidden = to.hidden = per.value !== 'custom'; });

  // ------------------------------------------------------------ Đọc tệp sổ
  async function onFile([file]) {
    try {
      fileName = file.name;
      sheets = /\.csv$/i.test(file.name) ? [{ name: 'CSV', rows: parseCsv(await readText(file)) }] : await withLoading('Đang đọc sổ…', async () => (await readXlsx(await readBuffer(file))).filter((s) => s.rows.length));
      if (!sheets.length) return toast('Tệp không có dữ liệu.', 'warn');
      pickSheet(0);
    } catch (e) { toast(`Không đọc được tệp: ${e.message}`, 'bad'); }
  }

  function pickSheet(idx) {
    const rows = sheets[idx].rows;
    const hr = findHeaderRow(rows);
    const header = rows[hr].map((c) => String(c ?? '').trim());
    data = rows.slice(hr + 1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
    map = autoMapFields(header);
    clear(out);
    result = null;
    drawSetup(idx, header);
  }

  function drawSetup(idx, header) {
    const summary = h('div.muted');
    const run = h('button.btn.primary', { type: 'button', onclick: () => doReconcile() }, icon('play', 16), h('span', 'Đối chiếu'));
    const refresh = () => {
      const { entries, skipped } = readLedger(data, map);
      const missing = [!map.number && 'Số hóa đơn', !map.date && 'Ngày hóa đơn', !map.vat && 'Tiền thuế'].filter(Boolean);
      summary.textContent = `${fmtInt(data.length)} dòng — ${fmtInt(entries.length)} dòng hóa đơn đọc được, ${fmtInt(skipped)} dòng bỏ qua (không có số hóa đơn: dòng tổng, dòng trống).${missing.length ? ` Chưa ghép cột: ${missing.join(', ')}.` : ''}`;
      run.disabled = !map.number || !map.date;
    };
    const opt = [['', '— Không dùng —'], ...header.map((t, i) => [String(i), `${t || '(cột trống)'} — cột ${i + 1}`])];
    const mapping = LEDGER_FIELDS.map((f) => {
      const sel = select(opt, map[f.key] === undefined ? '' : String(map[f.key]));
      sel.addEventListener('change', () => { if (sel.value === '') delete map[f.key]; else map[f.key] = Number(sel.value); refresh(); });
      return field(f.label, sel);
    });
    clear(setup).append(h('section.panel',
      h('div.panel-head', h('div', h('h2', `Sổ: ${fileName}`), h('p', 'Kiểm tra cách ghép cột, chọn kỳ rồi bấm Đối chiếu')), run),
      h('div', { style: { display: 'grid', gap: '16px' } },
        h('div.form-grid', sheets.length > 1 ? field('Sheet', select(sheets.map((s, i) => [String(i), s.name]), String(idx), { onchange: (e) => pickSheet(Number(e.target.value)) })) : null,
          field('Loại sổ', dir), field('Kỳ đối chiếu', per, 'Lọc theo ngày hóa đơn ở cả sổ và cổng Thuế.'), h('div.field', { hidden: false }, h('label', 'Từ ngày – đến ngày'), h('div.row-gap', from, to)),
          field('Dung sai (đồng)', tol, 'Chênh lệch tiền ≤ mức này vẫn tính là khớp.')),
        h('div.form-grid', field('Đối tác coi là chênh lệch thường gặp', kw, 'Tên chứa một trong các từ này mà không có trên cổng sẽ xếp vào nhóm "thường gặp" (ví dụ ngân hàng, bảo hiểm).'),
          h('div.field', h('label', 'Tùy chọn'), h('label.check', merge, 'Cộng gộp các dòng cùng hóa đơn (sổ tách theo thuế suất)'))),
        h('div', h('h3.section-title', 'Ghép cột (đã tự nhận theo tiêu đề)'), h('div.form-grid', mapping), summary))));
    refresh();
  }

  // ------------------------------------------------------------ Đối chiếu
  async function doReconcile() {
    const { entries } = readLedger(data, map);
    if (!entries.length) return toast('Chưa đọc được dòng hóa đơn nào. Kiểm tra ghép cột Số hóa đơn và Ngày hóa đơn.', 'warn');
    let range;
    if (per.value === 'ledger') { const ds = entries.map((e) => e.date).filter(Boolean).sort(); range = [ds[0] || '', ds.at(-1) || '']; } else if (per.value === 'custom') range = [from.value, to.value]; else range = periodRange(per.value);
    if (range[0] && range[1] && range[0] > range[1]) return toast('"Từ ngày" phải trước "Đến ngày".', 'warn');
    const keywords = kw.value.split(',').map((s) => s.trim()).filter(Boolean);
    saveSettings({ reconcileKeywords: kw.value.trim() });
    const invoices = await loadInvoices(state.companyTax);
    if (!invoices.length) toast('Chưa có hóa đơn nào từ cổng Thuế trên máy. Hãy đồng bộ dữ liệu trước, nếu không tất cả sẽ báo "không có trên cổng".', 'warn', { action: { label: 'Đồng bộ', onClick: () => go('sync') } });
    const ledger = merge.checked ? aggregateLedger(entries) : entries.map((e) => ({ ...e, lines: 1, rows: [e.row] }));
    last = { direction: dir.value, from: range[0], to: range[1], tolerance: Number(tol.value) || 0, keywords, fileName };
    result = reconcile(ledger, invoices, { ...last, companyTax: state.companyTax });
    result.rows.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.date || '').localeCompare(b.date || '') || a.number.localeCompare(b.number, undefined, { numeric: true }));
    filter = 'all';
    const by = result.summary.by;
    await logger.info('system', `Đối chiếu sổ ${fileName}: khớp ${by.match.count}, lệch ${by.diff.count}, chưa vào sổ ${by.missingLedger.count}, không có trên cổng ${by.missingPortal.count}`, { direction: dir.value, from: range[0], to: range[1] });
    drawResult();
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------ Kết quả
  function drawResult() {
    clear(out);
    if (!result) return;
    const { summary: s, rows } = result;
    const by = s.by;
    const issues = ['diff', 'date', 'period', 'mst', 'cancelled', 'missingLedger', 'missingPortal'].reduce((a, k) => a + by[k].count, 0);

    const stats = h('div.stats',
      statCard({ label: 'Khớp', value: fmtInt(by.match.count), sub: `trên ${fmtInt(s.ledgerCount)} hóa đơn trong sổ`, tone: 'ok' }),
      statCard({ label: 'Lệch số tiền', value: fmtInt(by.diff.count), sub: `thuế lệch ${fmtMoney(by.diff.difVat)}`, tone: by.diff.count ? 'bad' : undefined }),
      statCard({ label: 'Có trên cổng, chưa vào sổ', value: fmtInt(by.missingLedger.count), sub: `thuế ${fmtMoney(by.missingLedger.porVat)}`, tone: by.missingLedger.count ? 'in' : undefined }),
      statCard({ label: 'Có trong sổ, không có trên cổng', value: fmtInt(by.missingPortal.count), sub: `thuế ${fmtMoney(by.missingPortal.ledVat)}`, tone: by.missingPortal.count ? 'bad' : undefined }),
      statCard({ label: 'Lệch ngày / kỳ / MST / hủy', value: fmtInt(by.date.count + by.period.count + by.mst.count + by.cancelled.count), sub: 'cần xem từng dòng' }));

    const vatRow = (label, a, b, extra) => h('tr', h('td', label), h('td.r', fmtMoney(a)), h('td.r', fmtMoney(b)), h('td.r', fmtMoney(a - b)), h('td', extra || ''));
    const vat = h('section.panel', h('div.panel-head', h('div', h('h2', 'Đối chiếu thuế GTGT'), h('p', `${last.direction === 'in' ? 'Đầu vào' : 'Đầu ra'} — ${last.from ? fmtDate(last.from) : 'đầu'} đến ${last.to ? fmtDate(last.to) : 'nay'} — dung sai ${fmtInt(last.tolerance)} đ`)),
      h('button.btn', { type: 'button', onclick: exportExcel }, icon('sheet', 16), h('span', 'Xuất Excel'))),
      h('div.table-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Chỉ tiêu'), h('th.r', 'Sổ'), h('th.r', 'Cổng Thuế'), h('th.r', 'Chênh lệch'), h('th', ''))),
        h('tbody', vatRow('Số hóa đơn', s.ledgerCount, s.portalCount, 'Cổng không tính hủy / bị thay thế'), vatRow('Tiền chưa thuế', s.ledgerNet, s.portalNet)),
        h('tfoot', h('tr', h('td', 'Tiền thuế GTGT'), h('td.r', fmtMoney(s.ledgerVat)), h('td.r', fmtMoney(s.portalVat)), h('td.r', fmtMoney(s.diffVat)), h('td'))))),
      h('p.hint', { style: { marginTop: '8px' } }, issues ? `Chênh lệch tổng thuế gồm các nhóm bên dưới; bấm vào nhóm để lọc. ${by.expected.count + by.pos.count ? `Nhóm "thường gặp" và "máy tính tiền" (${fmtInt(by.expected.count + by.pos.count)} dòng) là chênh lệch dự kiến.` : ''}` : 'Sổ và cổng Thuế khớp hoàn toàn trong kỳ này.'));

    const chips = h('div.range-shortcuts');
    const chip = (key, label, n) => chips.append(h('button.chip', { type: 'button', class: filter === key ? 'active' : '', style: filter === key ? { background: 'var(--primary-tint)', borderColor: 'var(--primary)', color: 'var(--primary)' } : null, onclick: () => { filter = key; drawResult(); } }, `${label} (${fmtInt(n)})`));
    chip('all', 'Tất cả', rows.length);
    for (const k of STATUS_ORDER) if (by[k].count) chip(k, STATUS[k], by[k].count);

    const col = (key, title, width, extra = {}) => ({ key, title, width, ...extra });
    const grid = new DataGrid({
      rowKey: 'id', footerLabel: 'dòng',
      columns: [
        col('stt', 'STT', 56, { align: 'center', sortable: false, filterable: false, render: (_r, i) => String(i + 1) }),
        col('statusLabel', 'Kết quả', 244, { render: (r) => h(`span.badge.tone-${TONE[r.status]}`, r.statusLabel) }),
        col('date', 'Ngày', 96, { type: 'date' }), col('series', 'Ký hiệu', 92), col('number', 'Số HĐ', 84, { align: 'right' }), col('partnerTax', 'MST', 116),
        col('partnerName', 'Đối tác', 'flex'),
        col('ledVat', 'Thuế (sổ)', 112, { type: 'money', sum: true }), col('porVat', 'Thuế (cổng)', 112, { type: 'money', sum: true }), col('difVat', 'Lệch thuế', 108, { type: 'money', sum: true }),
        col('ledNet', 'Chưa thuế (sổ)', 124, { type: 'money' }), col('porNet', 'Chưa thuế (cổng)', 130, { type: 'money' }),
        col('note', 'Ghi chú', 'flex', { render: (r) => h('span', { title: r.note }, r.note) }),
      ],
      onOpen: (r) => (r.invoice ? openInvoiceDrawer(r.invoice) : toast('Dòng này chỉ có trong sổ, chưa có hóa đơn tương ứng trên máy.', 'info')),
      empty: { title: 'Không có dòng nào', text: 'Chọn nhóm khác ở phía trên.' },
    });
    clear(out).append(stats, vat, h('section', { style: { display: 'grid', gap: '10px' } }, chips, h('div', { style: { height: '520px', display: 'flex' } }, grid.el)));
    grid.setRows(filter === 'all' ? rows : rows.filter((r) => r.status === filter));
  }

  // ------------------------------------------------------------ Xuất Excel
  async function exportExcel() {
    if (!result) return;
    const sub = [`Doanh nghiệp: ${state.companyTax}`, `Sổ: ${last.fileName}`, `Loại: ${last.direction === 'in' ? 'đầu vào' : 'đầu ra'} — kỳ ${last.from || 'đầu'} → ${last.to || 'nay'} — dung sai ${last.tolerance} đ`];
    const m = (header, key, width = 16) => ({ header, key, type: 'money', width });
    const detailCols = [
      { header: 'Kết quả', key: 'statusLabel', width: 28 }, { header: 'Ngày', key: 'date', type: 'date', width: 12 }, { header: 'Ký hiệu', key: 'series', width: 12 }, { header: 'Số HĐ', key: 'number', width: 10 },
      { header: 'MST', key: 'partnerTax', width: 15 }, { header: 'Đối tác', key: 'partnerName', width: 36 },
      m('Chưa thuế (sổ)', 'ledNet'), m('Chưa thuế (cổng)', 'porNet'), m('Thuế (sổ)', 'ledVat'), m('Thuế (cổng)', 'porVat'), m('Lệch thuế', 'difVat'),
      m('Tổng (sổ)', 'ledTotal'), m('Tổng (cổng)', 'porTotal'), { header: 'Ghi chú', key: 'note', width: 60 },
    ];
    const by = result.summary.by;
    const summaryRows = STATUS_ORDER.map((k) => ({ label: STATUS[k], count: by[k].count, ledVat: by[k].ledVat, porVat: by[k].porVat, difVat: by[k].difVat }));
    const sheets = [
      { name: 'Tổng hợp', title: 'ĐỐI CHIẾU SỔ THUẾ GTGT VỚI CỔNG THUẾ', subtitle: [...sub, `Tổng thuế sổ ${fmtMoney(result.summary.ledgerVat)} — tổng thuế cổng ${fmtMoney(result.summary.portalVat)} — chênh lệch ${fmtMoney(result.summary.diffVat)}`],
        columns: [{ header: 'Nhóm', key: 'label', width: 34 }, { header: 'Số hóa đơn', key: 'count', type: 'number', width: 12 }, m('Thuế (sổ)', 'ledVat'), m('Thuế (cổng)', 'porVat'), m('Lệch thuế', 'difVat')], rows: summaryRows, totals: ['count', 'ledVat', 'porVat', 'difVat'] },
      { name: 'Chi tiết', title: 'CHI TIẾT ĐỐI CHIẾU', subtitle: sub, columns: detailCols, rows: result.rows, totals: ['ledNet', 'porNet', 'ledVat', 'porVat', 'difVat'] },
    ];
    const part = (name, title, statuses) => {
      const rows = result.rows.filter((r) => statuses.includes(r.status));
      if (rows.length) sheets.push({ name, title, subtitle: sub, columns: detailCols, rows, totals: ['ledNet', 'porNet', 'ledVat', 'porVat', 'difVat'] });
    };
    part('Lệch số tiền', 'HÓA ĐƠN LỆCH SỐ TIỀN', ['diff']);
    part('Chưa vào sổ', 'CÓ TRÊN CỔNG THUẾ, CHƯA VÀO SỔ', ['missingLedger']);
    part('Không có trên cổng', 'CÓ TRONG SỔ, KHÔNG CÓ TRÊN CỔNG THUẾ', ['missingPortal']);
    part('Lệch ngày-kỳ-MST', 'LỆCH NGÀY LẬP / KỲ / MST', ['date', 'period', 'mst']);
    part('Hủy - thay thế', 'HÓA ĐƠN ĐÃ HỦY / BỊ THAY THẾ VẪN CÒN TRONG SỔ', ['cancelled']);
    await withLoading('Đang tạo file Excel…', () => exportSheets(`DoiChieuGTGT_${state.companyTax}_${todayISO().replaceAll('-', '')}`, sheets, { rows: result.rows.length }));
  }

  host.append(
    h('section.panel', h('div.panel-head', h('div', h('h2', 'Đối chiếu sổ quản trị thuế GTGT'), h('p', 'So sổ của bạn với hóa đơn đã tải từ cổng Thuế; ghép theo MST + ký hiệu + số hóa đơn'))),
      dropZone({ title: 'Kéo tệp sổ (.xlsx hoặc .csv) vào đây hoặc bấm để chọn', hint: 'Sổ chi tiết hóa đơn mua vào / bán ra, mỗi dòng một hóa đơn', accept: '.xlsx,.csv', multiple: false, onFiles: onFile })),
    setup, out);
  const off = bus.on('company:change', () => { clear(setup); clear(out); result = null; });
  return off;
}
