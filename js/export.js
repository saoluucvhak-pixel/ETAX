/**
 * export.js — Xuất dữ liệu: Excel (.xlsx), CSV, JSON, PDF.
 *
 *  - Excel/CSV/JSON: dựng file trong trình duyệt rồi lưu qua platform.saveFile (thư mục lưu hoặc tải xuống).
 *  - PDF: dựng trang HTML A4 rồi
 *      · Electron  → chuyển thành PDF thật, lưu thẳng vào thư mục lưu;
 *      · Web/PWA   → mở hộp thoại in của trình duyệt (chọn "Lưu dưới dạng PDF").
 *    (Cách này giữ đúng tiếng Việt có dấu mà không cần nhúng phông chữ vào mã.)
 */
import { DIRECTION_LABEL, INVOICE_STATUS, TAX_RATE_LABEL } from './config.js';
import { writeXlsx } from './core/xlsx.js';
import { saveFile, isElectron, desktop } from './core/platform.js';
import { toast } from './core/ui.js';
import { logger } from './logger.js';
import { state } from './core/state.js';
import { loadPdfLib, newDoc, drawInvoicePdf } from './core/pdfDoc.js';
import { fmtMoney, fmtDate, fmtDateTime, escapeHtml, toCsv, sanitizeFileName, todayISO, sum } from './utils.js';

// ---------------------------------------------------------------- Cột chuẩn

const codeLabel = (inv) => (inv.codeStatus === 'coma' ? 'Có mã' : inv.codeStatus === 'khongma' ? 'Không mã' : '');

/** Cột của bảng hóa đơn khi xuất. */
export const INVOICE_COLUMNS = [
  { header: 'Ngày lập', key: 'date', type: 'date', width: 12 },
  { header: 'Số hóa đơn', key: 'number', width: 12 },
  { header: 'Ký hiệu', value: (i) => `${i.template || ''}${i.series || ''}`, width: 13 },
  { header: 'MST người bán', key: 'sellerTax', width: 16 },
  { header: 'Tên người bán', key: 'sellerName', width: 38 },
  { header: 'MST người mua', key: 'buyerTax', width: 16 },
  { header: 'Tên người mua', key: 'buyerName', width: 38 },
  { header: 'Tiền chưa thuế', key: 'net', type: 'money', width: 16 },
  { header: 'Tiền thuế', key: 'vat', type: 'money', width: 15 },
  { header: 'Tổng tiền', key: 'total', type: 'money', width: 17 },
  { header: 'Loại tiền', key: 'currency', width: 9 },
  { header: 'Trạng thái', value: (i) => INVOICE_STATUS[i.status]?.label || i.status, width: 20 },
  { header: 'Cấp mã', value: codeLabel, width: 11 },
  { header: 'Mã CQT', key: 'invoiceCode', width: 34 },
  { header: 'Chiều', value: (i) => DIRECTION_LABEL[i.direction] || '', width: 10 },
];

const ITEM_COLUMNS = [
  { header: 'Ngày lập', key: 'date', type: 'date', width: 12 },
  { header: 'Số hóa đơn', key: 'number', width: 12 },
  { header: 'Ký hiệu', key: 'series', width: 11 },
  { header: 'Người bán', key: 'sellerName', width: 32 },
  { header: 'STT', key: 'stt', width: 6 },
  { header: 'Tên hàng hóa, dịch vụ', key: 'name', width: 44 },
  { header: 'ĐVT', key: 'unit', width: 9 },
  { header: 'Số lượng', key: 'qty', type: 'number', width: 12 },
  { header: 'Đơn giá', key: 'price', type: 'money', width: 15 },
  { header: 'Thành tiền', key: 'amount', type: 'money', width: 16 },
  { header: 'Thuế suất', value: (r) => TAX_RATE_LABEL[r.rate] || r.rate, width: 12 },
  { header: 'Tiền thuế', key: 'tax', type: 'money', width: 14 },
];

/** Trải phẳng các dòng hàng hóa của danh sách hóa đơn (kèm thông tin hóa đơn). */
export function flattenItems(invoices) {
  const rows = [];
  for (const inv of invoices) {
    for (const it of inv.items || []) rows.push({ ...it, date: inv.date, number: inv.number, series: inv.series, sellerName: inv.sellerName });
  }
  return rows;
}

// ---------------------------------------------------------------- Lưu file + thông báo

async function deliver(filename, blob, kind, meta = {}, silent = false) {
  const r = await saveFile(filename, blob);
  if (!silent) {
    const where = r.where === 'download' ? 'đã tải xuống' : `đã lưu vào ${r.path}`;
    toast(`${filename} ${where}`, 'ok');
  }
  await logger.info('export', `Xuất ${kind}: ${filename}`, { kind, file: filename, size: blob.size, ...meta });
  return r;
}

const stamp = () => `${todayISO().replaceAll('-', '')}`;

function fileBase(invoices, label) {
  const co = state.companyTax || 'eTax';
  return sanitizeFileName(`${label}_${co}_${stamp()}`);
}

// ---------------------------------------------------------------- Excel / CSV / JSON

/** Xuất nhiều sheet tùy ý (dùng cho báo cáo). */
export async function exportSheets(filename, sheets, meta) {
  const blob = await writeXlsx(sheets);
  return deliver(filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`, blob, 'Excel', meta);
}

export async function exportInvoicesExcel(invoices, { label = 'HoaDon', includeItems = true, title } = {}) {
  const rows = invoices.map((inv, i) => ({ ...inv, __no: i + 1 }));
  const sheets = [{
    name: 'Hóa đơn',
    title: title || 'DANH SÁCH HÓA ĐƠN',
    subtitle: [`Doanh nghiệp: ${state.companyTax || ''}`, `Xuất lúc ${fmtDateTime(Date.now())} · ${invoices.length} hóa đơn`],
    columns: [{ header: 'STT', value: (r) => r.__no, type: 'number', width: 6 }, ...INVOICE_COLUMNS],
    rows,
    totals: ['net', 'vat', 'total'],
  }];
  const items = includeItems ? flattenItems(invoices) : [];
  if (items.length) sheets.push({ name: 'Chi tiết hàng hóa', columns: ITEM_COLUMNS, rows: items, totals: ['amount', 'tax'] });
  return exportSheets(`${fileBase(invoices, label)}.xlsx`, sheets, { rows: invoices.length });
}

export async function exportInvoicesCsv(invoices, { label = 'HoaDon' } = {}) {
  const csv = toCsv(INVOICE_COLUMNS, invoices);
  return deliver(`${fileBase(invoices, label)}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'CSV', { rows: invoices.length });
}

export async function exportInvoicesJson(invoices, { label = 'HoaDon' } = {}) {
  const payload = { exportedAt: new Date().toISOString(), companyTax: state.companyTax, count: invoices.length, invoices };
  return deliver(`${fileBase(invoices, label)}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'JSON', { rows: invoices.length });
}

// ---------------------------------------------------------------- PDF (in ra)

const PRINT_CSS = `
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { font: 11px/1.45 "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #16202e; margin: 0; }
h1 { font-size: 16px; margin: 0 0 2px; color: #2b3a8c; }
h2 { font-size: 13px; margin: 14px 0 6px; }
.sub { color: #5b6778; margin-bottom: 10px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #c9d0dc; padding: 3px 5px; vertical-align: top; }
th { background: #eaedf5; text-align: center; font-weight: 600; }
td.r { text-align: right; font-variant-numeric: tabular-nums; }
td.c { text-align: center; }
tfoot td { font-weight: 700; background: #f3f5fa; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
.inv-head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #2b3a8c; padding-bottom: 8px; margin-bottom: 10px; }
.inv-title { text-align: center; flex: 1; }
.inv-title h1 { font-size: 19px; text-transform: uppercase; }
.kv { display: grid; grid-template-columns: 120px 1fr; gap: 2px 10px; margin: 2px 0; }
.kv span:nth-child(odd) { color: #5b6778; }
.stamp { display: inline-block; border: 2px solid #c2372d; color: #c2372d; padding: 2px 8px; border-radius: 4px; font-weight: 700; transform: rotate(-4deg); }
.sum { width: 46%; margin-left: auto; margin-top: 8px; }
.words { margin-top: 8px; font-style: italic; }
.foot { margin-top: 14px; color: #5b6778; font-size: 10px; }
`;

/** HTML "bản thể hiện" của một hóa đơn (không phải bản gốc có chữ ký số). */
export function invoiceHtml(inv) {
  const e = escapeHtml;
  const items = inv.items?.length
    ? inv.items.map((it, i) => `<tr><td class="c">${e(it.stt || i + 1)}</td><td>${e(it.name)}</td><td class="c">${e(it.unit)}</td><td class="r">${fmtMoney(it.qty)}</td><td class="r">${fmtMoney(it.price)}</td><td class="r">${fmtMoney(it.amount)}</td><td class="c">${e(TAX_RATE_LABEL[it.rate] || it.rate || '')}</td></tr>`).join('')
    : `<tr><td colspan="7" class="c" style="color:#5b6778">Chưa có chi tiết hàng hóa (mới đồng bộ phần tóm tắt).</td></tr>`;
  const breakdown = (inv.taxBreakdown || []).map((b) => `<tr><td>Thuế suất ${e(TAX_RATE_LABEL[b.rate] || b.rate)}</td><td class="r">${fmtMoney(b.base)}</td><td class="r">${fmtMoney(b.tax)}</td></tr>`).join('');
  return `<section class="page">
  <div class="inv-head">
    <div><div class="stamp">${INVOICE_STATUS[inv.status]?.label || ''}</div></div>
    <div class="inv-title"><h1>${e(inv.invoiceName || 'Hóa đơn giá trị gia tăng')}</h1><div>Ngày ${fmtDate(inv.date)}</div></div>
    <div style="text-align:right"><div>Mẫu số: <b>${e(inv.template)}</b></div><div>Ký hiệu: <b>${e(inv.series)}</b></div><div>Số: <b>${e(inv.number)}</b></div></div>
  </div>
  <div class="kv"><span>Người bán</span><b>${e(inv.sellerName)}</b><span>Mã số thuế</span><span>${e(inv.sellerTax)}</span><span>Địa chỉ</span><span>${e(inv.sellerAddress)}</span></div>
  <hr style="border:0;border-top:1px dashed #c9d0dc;margin:8px 0">
  <div class="kv"><span>Người mua</span><b>${e(inv.buyerName)}</b><span>Mã số thuế</span><span>${e(inv.buyerTax)}</span><span>Địa chỉ</span><span>${e(inv.buyerAddress)}</span><span>Hình thức TT</span><span>${e(inv.paymentMethod)}</span></div>
  <h2>Hàng hóa, dịch vụ</h2>
  <table><thead><tr><th style="width:32px">STT</th><th>Tên hàng hóa, dịch vụ</th><th style="width:50px">ĐVT</th><th style="width:60px">Số lượng</th><th style="width:80px">Đơn giá</th><th style="width:90px">Thành tiền</th><th style="width:60px">Thuế suất</th></tr></thead><tbody>${items}</tbody></table>
  <table class="sum"><tbody>${breakdown}<tr><td>Cộng tiền hàng</td><td class="r" colspan="2">${fmtMoney(inv.net)}</td></tr><tr><td>Tiền thuế GTGT</td><td class="r" colspan="2">${fmtMoney(inv.vat)}</td></tr></tbody><tfoot><tr><td>Tổng thanh toán (${e(inv.currency)})</td><td class="r" colspan="2">${fmtMoney(inv.total)}</td></tr></tfoot></table>
  ${inv.totalInWords ? `<div class="words">Số tiền viết bằng chữ: ${e(inv.totalInWords)}</div>` : ''}
  ${inv.invoiceCode ? `<div class="foot">Mã của cơ quan thuế: ${e(inv.invoiceCode)}</div>` : ''}
  <div class="foot">Bản thể hiện tạo bởi eTax Manager từ dữ liệu đã đồng bộ — không thay thế hóa đơn điện tử gốc có chữ ký số.</div>
</section>`;
}

/** HTML bảng danh sách hóa đơn. */
export function invoiceListHtml(invoices, title) {
  const rows = invoices.map((i, n) => `<tr><td class="c">${n + 1}</td><td class="c">${fmtDate(i.date)}</td><td class="c">${escapeHtml(i.number)}</td><td class="c">${escapeHtml(`${i.template || ''}${i.series || ''}`)}</td><td>${escapeHtml(i.direction === 'in' ? i.sellerTax : i.buyerTax)}</td><td>${escapeHtml(i.direction === 'in' ? i.sellerName : i.buyerName)}</td><td class="r">${fmtMoney(i.net)}</td><td class="r">${fmtMoney(i.vat)}</td><td class="r">${fmtMoney(i.total)}</td><td class="c">${escapeHtml(INVOICE_STATUS[i.status]?.label || '')}</td></tr>`).join('');
  return `<h1>${escapeHtml(title)}</h1><div class="sub">Doanh nghiệp ${escapeHtml(state.companyTax)} · ${invoices.length} hóa đơn · ${fmtDateTime(Date.now())}</div>
  <table><thead><tr><th>STT</th><th>Ngày</th><th>Số</th><th>Ký hiệu</th><th>MST đối tác</th><th>Đối tác</th><th>Chưa thuế</th><th>Thuế</th><th>Tổng tiền</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody>
  <tfoot><tr><td colspan="6">Tổng cộng</td><td class="r">${fmtMoney(sum(invoices, (i) => i.net))}</td><td class="r">${fmtMoney(sum(invoices, (i) => i.vat))}</td><td class="r">${fmtMoney(sum(invoices, (i) => i.total))}</td><td></td></tr></tfoot></table>`;
}

const wrapHtml = (title, body, landscape) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}${landscape ? '@page{size:A4 landscape}' : ''}</style></head><body>${body}</body></html>`;

/**
 * In một trang HTML thành PDF.
 * Electron: tạo PDF thật. Web: mở hộp thoại in (iframe ẩn).
 */
export async function printToPdf(title, bodyHtml, { landscape = false, filename } = {}) {
  const html = wrapHtml(title, bodyHtml, landscape);
  const name = `${sanitizeFileName(filename || title)}.pdf`;
  if (isElectron()) {
    const r = await desktop().printPdf({ html, name, landscape });
    if (r?.path) { toast(`${name} đã lưu vào ${r.path}`, 'ok'); await logger.info('export', `Xuất PDF: ${name}`, { file: name }); return r; }
  }
  await new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.append(frame);
    frame.onload = () => {
      const w = frame.contentWindow;
      w.onafterprint = () => { frame.remove(); resolve(); };
      setTimeout(() => { w.focus(); w.print(); setTimeout(() => { frame.remove(); resolve(); }, 60000); }, 250);
    };
    frame.srcdoc = html;
  });
  toast('Trong hộp thoại in, chọn "Lưu dưới dạng PDF".', 'info');
  await logger.info('export', `Mở hộp thoại in PDF: ${name}`, { file: name });
}

/** Tên tệp chuẩn cho PDF của một hóa đơn (không kèm đuôi .pdf) — dùng chung cho mọi nơi xuất PDF từng hóa đơn. */
const invoiceFileName = (inv) => `HoaDon_${inv.series || ''}_${inv.number || ''}`;

export const exportInvoicesPdf = (invoices, { title = 'Danh sách hóa đơn' } = {}) => printToPdf(title, invoiceListHtml(invoices, title), { landscape: true, filename: fileBase(invoices, 'DanhSachHoaDon') });
export const exportInvoiceDetailsPdf = (invoices) => printToPdf(`Hóa đơn ${invoices.length === 1 ? invoices[0].number : `(${invoices.length})`}`, invoices.map(invoiceHtml).join(''), { filename: invoices.length === 1 ? invoiceFileName(invoices[0]) : fileBase(invoices, 'ChiTietHoaDon') });

/** Lưu HTML báo cáo dạng PDF (dùng cho trang Báo cáo). */
export const exportReportPdf = (title, html, opts) => printToPdf(title, `<h1>${escapeHtml(title)}</h1><div class="sub">${escapeHtml(state.companyTax)} · ${fmtDateTime(Date.now())}</div>${html}`, opts);

// ---------------------------------------------------------------- PDF (tệp thật, mỗi hóa đơn một tệp riêng)

/**
 * Xuất mỗi hóa đơn thành MỘT TỆP PDF THẬT riêng (không qua hộp thoại in — xem js/core/pdfDoc.js), lưu lần
 * lượt qua saveFile() (vào thư mục đã chọn nếu có, hoặc tải xuống). Dùng cho nút "Mỗi hóa đơn một tệp PDF".
 * @param {Array} invoices
 * @param {{onProgress?: (done:number, total:number)=>void}} opts
 * @returns {Promise<{ok:number, fail:number, total:number}>}
 */
export async function exportInvoiceFilesPdf(invoices, { onProgress } = {}) {
  const lib = await loadPdfLib();
  const used = new Set();
  let ok = 0, fail = 0;
  for (const inv of invoices) {
    try {
      const doc = newDoc(lib);
      drawInvoicePdf(doc, inv, { fmtMoney, fmtDate, TAX_RATE_LABEL, INVOICE_STATUS });
      let base = sanitizeFileName(invoiceFileName(inv));
      let name = `${base}.pdf`;
      for (let i = 2; used.has(name); i++) name = `${base}_${i}.pdf`;
      used.add(name);
      await deliver(name, doc.output('blob'), 'PDF', { invoiceKey: inv.key }, true);
      ok++;
    } catch (e) {
      fail++;
      await logger.warn('export', `Lỗi tạo PDF hóa đơn ${inv.series || ''} ${inv.number || ''}: ${e.message}`, { invoiceKey: inv.key, error: e.message });
    }
    onProgress?.(ok + fail, invoices.length);
  }
  await logger.info('export', `Xuất PDF từng hóa đơn: ${ok}/${invoices.length} tệp${fail ? `, ${fail} lỗi` : ''}`, { ok, fail, total: invoices.length });
  return { ok, fail, total: invoices.length };
}

export { deliver as deliverBlob };
