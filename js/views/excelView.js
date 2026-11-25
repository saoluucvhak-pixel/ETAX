/**
 * excelView.js — Trang "Excel": nhập hóa đơn từ .xlsx/.csv (tự nhận cột theo tiêu đề tiếng Việt, cho chỉnh lại)
 * và xuất toàn bộ dữ liệu ra Excel; tải file mẫu để điền.
 */
import { h, clear, fmtInt, fmtMoney, fmtDate, readBuffer, readText, dedupe } from '../utils.js';
import { state, bus } from '../core/state.js';
import { DIRECTION } from '../config.js';
import { readXlsx } from '../core/xlsx.js';
import { parseCsv } from '../utils.js';
import { EXCEL_FIELDS, autoMapColumns, fromExcelRow } from '../core/normalizer.js';
import { loadInvoices, saveInvoices, filterInvoices } from '../core/invoiceStore.js';
import { dropZone } from '../core/dropzone.js';
import { icon, select, field, toast, withLoading, emptyState } from '../core/ui.js';
import { exportRows } from '../core/invoiceGrid.js';
import { exportSheets } from '../export.js';
import { logger } from '../logger.js';
import { go } from '../core/router.js';
import { bulkPanel } from './excelBulk.js';

/** Dòng tiêu đề = dòng đầu tiên có từ 3 ô chữ trở lên (bỏ qua các dòng tiêu đề báo cáo phía trên). */
function findHeaderRow(rows) {
  const i = rows.slice(0, 15).findIndex((r) => r.filter((c) => typeof c === 'string' && c.trim()).length >= 3);
  return i < 0 ? 0 : i;
}

export async function mount(host) {
  if (!state.companyTax) {
    host.append(h('section.panel', emptyState({ title: 'Chưa chọn doanh nghiệp', text: 'Chọn doanh nghiệp trước khi nhập hoặc xuất Excel.', action: h('button.btn.primary', { onclick: () => go('login') }, 'Đến trang đăng nhập') })));
    return null;
  }
  let sheets = []; // [{name, rows}]
  let fileName = '';
  const importBox = h('div');

  async function onFile([file]) {
    try {
      fileName = file.name;
      sheets = /\.csv$/i.test(file.name)
        ? [{ name: 'CSV', rows: parseCsv(await readText(file)) }]
        : await withLoading('Đang đọc Excel…', async () => (await readXlsx(await readBuffer(file))).filter((s) => s.rows.length));
      if (!sheets.length) return toast('File không có dữ liệu.', 'warn');
      drawImport(0);
    } catch (e) { toast(`Không đọc được file: ${e.message}`, 'bad'); }
  }

  function drawImport(sheetIdx) {
    const sheet = sheets[sheetIdx];
    const hr = findHeaderRow(sheet.rows);
    const header = sheet.rows[hr].map((c) => String(c ?? '').trim());
    const data = sheet.rows.slice(hr + 1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
    const auto = autoMapColumns(header);
    const map = { ...auto };
    const dirSel = select([['in', 'Đầu vào (mua vào)'], ['out', 'Đầu ra (bán ra)']], 'in');
    const preview = h('div');
    const summary = h('div.muted');
    const importBtn = h('button.btn.primary', { type: 'button' }, icon('save', 16), h('span', 'Nhập vào máy'));

    const build = () => {
      const direction = dirSel.value;
      const invs = [];
      let bad = 0;
      for (const r of data) {
        const mapped = {};
        for (const f of EXCEL_FIELDS) if (map[f.key] !== undefined) mapped[f.key] = r[map[f.key]];
        const inv = fromExcelRow(mapped, { companyTax: state.companyTax, direction });
        if (inv) invs.push(inv); else bad++;
      }
      return { invs, bad };
    };

    const redraw = () => {
      const { invs, bad } = build();
      const uniq = dedupe(invs, (i) => i.key);
      summary.textContent = `${fmtInt(data.length)} dòng dữ liệu — ${fmtInt(uniq.length)} hóa đơn đọc được${bad ? ` — ${fmtInt(bad)} dòng bỏ qua (thiếu ngày hoặc số hóa đơn)` : ''}${uniq.length < invs.length ? ` — ${fmtInt(invs.length - uniq.length)} dòng trùng khóa` : ''}`;
      importBtn.disabled = !uniq.length;
      clear(preview).append(h('div.table-wrap', h('table.tbl', h('thead', h('tr', ['Ngày', 'Số', 'Ký hiệu', 'MST bán', 'MST mua', 'Chưa thuế', 'Thuế', 'Tổng'].map((c, i) => h(`th${i > 4 ? '.r' : ''}`, c)))),
        h('tbody', uniq.slice(0, 8).map((i) => h('tr', h('td', fmtDate(i.date)), h('td', i.number), h('td', i.series), h('td', i.sellerTax), h('td', i.buyerTax), h('td.r', fmtMoney(i.net)), h('td.r', fmtMoney(i.vat)), h('td.r', fmtMoney(i.total))))))));
    };

    importBtn.addEventListener('click', async () => {
      const { invs } = build();
      const uniq = dedupe(invs, (i) => i.key);
      try {
        const r = await withLoading('Đang lưu hóa đơn…', () => saveInvoices(uniq));
        toast(`Đã nhập ${fmtInt(uniq.length)} hóa đơn (mới ${fmtInt(r.added)}, cập nhật ${fmtInt(r.updated)}).`, 'ok', { action: { label: 'Xem danh sách', onClick: () => go(dirSel.value === DIRECTION.OUT ? 'invoices-out' : 'invoices-in') } });
        await logger.info('import', `Nhập Excel: ${fileName}`, { file: fileName, rows: uniq.length, added: r.added, updated: r.updated });
        clear(importBox);
      } catch (e) { toast(e.message, 'bad'); }
    });
    dirSel.addEventListener('change', redraw);

    const opt = [['', '— Không dùng —'], ...header.map((t, i) => [String(i), `${t || '(cột trống)'} — cột ${i + 1}`])];
    const mapping = EXCEL_FIELDS.map((f) => {
      const sel = select(opt, map[f.key] === undefined ? '' : String(map[f.key]));
      sel.addEventListener('change', () => { if (sel.value === '') delete map[f.key]; else map[f.key] = Number(sel.value); redraw(); });
      return field(f.label, sel);
    });

    clear(importBox).append(h('section.panel',
      h('div.panel-head', h('div', h('h2', `Nhập từ ${fileName}`), h('p', 'Kiểm tra cách ghép cột, chỉnh nếu cần rồi bấm Nhập')), importBtn),
      h('div', { style: { display: 'grid', gap: '16px' } },
        h('div.form-grid', field('Chiều hóa đơn', dirSel, 'Dùng chung cho toàn bộ dòng của tệp.'),
          sheets.length > 1 ? field('Sheet', select(sheets.map((s, i) => [String(i), s.name]), String(sheetIdx), { onchange: (e) => drawImport(Number(e.target.value)) })) : null),
        h('div', h('h3.section-title', 'Ghép cột (đã tự nhận theo tiêu đề)'), h('div.form-grid', mapping)),
        h('div', h('h3.section-title', 'Xem trước'), summary, preview))));
    redraw();
  }

  async function exportAll(direction) {
    const all = await loadInvoices(state.companyTax);
    await exportRows('xlsx', filterInvoices(all, { direction }), direction === 'in' ? 'HoaDonDauVao' : direction === 'out' ? 'HoaDonDauRa' : 'HoaDon');
  }

  async function downloadTemplate() {
    const cols = EXCEL_FIELDS.filter((f) => !['partnerTax', 'partnerName', 'template'].includes(f.key)).map((f) => ({ header: f.label, key: f.key, width: 20, type: ['net', 'vat', 'total'].includes(f.key) ? 'money' : undefined }));
    await exportSheets('MauNhapHoaDon', [{ name: 'Hóa đơn', title: 'MẪU NHẬP HÓA ĐƠN', subtitle: ['Xóa dòng ví dụ rồi điền dữ liệu. Ngày dạng dd/mm/yyyy. Cột bắt buộc: Ngày lập, Số hóa đơn.'],
      columns: cols, rows: [{ date: '2025-01-15', number: '1234', series: 'C25TAA', sellerTax: '0100109106', sellerName: 'Công ty ví dụ', buyerTax: state.companyTax, buyerName: 'Doanh nghiệp của bạn', net: 1000000, vat: 80000, total: 1080000, status: 'Hóa đơn mới', currency: 'VND', invoiceCode: '' }] }]);
  }

  host.append(
    bulkPanel(),
    h('section.panel', h('div.panel-head', h('div', h('h2', 'Nhập hóa đơn từ Excel / CSV'), h('p', 'Dùng khi bạn có bảng kê từ phần mềm kế toán hoặc từ cổng Thuế (xuất Excel)')),
      h('button.btn', { type: 'button', onclick: downloadTemplate }, icon('download', 16), h('span', 'Tải file mẫu'))),
      dropZone({ title: 'Kéo tệp .xlsx hoặc .csv vào đây hoặc bấm để chọn', hint: 'Cột được nhận theo tiêu đề tiếng Việt, không phân biệt dấu', accept: '.xlsx,.csv', multiple: false, onFiles: onFile })),
    importBox,
    h('section.panel', h('div.panel-head', h('div', h('h2', 'Xuất ra Excel'), h('p', 'Kèm dòng tổng và sheet chi tiết hàng hóa nếu đã tải'))),
      h('div.row-gap', { style: { flexWrap: 'wrap' } }, h('button.btn.primary', { type: 'button', onclick: () => exportAll(undefined) }, icon('sheet', 16), h('span', 'Tất cả hóa đơn')),
        h('button.btn', { type: 'button', onclick: () => exportAll('in') }, icon('inbox', 16), h('span', 'Chỉ đầu vào')), h('button.btn', { type: 'button', onclick: () => exportAll('out') }, icon('outbox', 16), h('span', 'Chỉ đầu ra')))));
  const off = bus.on('company:change', () => clear(importBox));
  return off;
}
