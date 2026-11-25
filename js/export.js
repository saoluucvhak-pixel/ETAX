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
@page { size: A4; margin: 10mm 12mm; }
* { box-sizing: border-box; }
body { font: 11px/1.42 "Times New Roman", "Segoe UI", Arial, sans-serif; color: #111827; margin: 0; }
h1 { font-size: 16px; margin: 0 0 2px; color: #1e3a8a; }
h2 { font-size: 13px; margin: 14px 0 6px; }
.sub { color: #5b6778; margin-bottom: 10px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #475569; padding: 4px 6px; vertical-align: top; }
th { background: #f1f5f9; text-align: center; font-weight: 700; }
td.r { text-align: right; font-variant-numeric: tabular-nums; }
td.c { text-align: center; }
tfoot td { font-weight: 700; background: #f8fafc; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
.gdt-sheet { border: 2px solid #1e3a8a; padding: 12px 14px; position: relative; background: #fff; }
.gdt-inner { border: 1px solid #94a3b8; padding: 10px 12px; }
.gdt-head { display: grid; grid-template-columns: 150px 1fr 175px; gap: 10px; align-items: start; border-bottom: 1.5px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 8px; }
.gdt-title { text-align: center; }
.gdt-title h1 { font-size: 18px; color: #b91c1c; text-transform: uppercase; letter-spacing: .3px; margin: 0; }
.gdt-title .gdt-sub { font-size: 11px; font-style: italic; color: #334155; margin-top: 2px; }
.gdt-title .gdt-date { font-size: 11.5px; margin-top: 4px; font-style: italic; }
.gdt-meta { font-size: 11px; line-height: 1.55; }
.gdt-meta .inv-no { color: #b91c1c; font-size: 14px; font-weight: 700; }
.gdt-box { border-bottom: 1px dashed #94a3b8; padding: 6px 0; margin-bottom: 6px; }
.gdt-kv { display: grid; grid-template-columns: 145px 1fr; gap: 2px 8px; font-size: 11.5px; }
.gdt-kv span:nth-child(odd) { color: #334155; }
.gdt-colnum th { font-size: 10px; font-weight: 400; font-style: italic; padding: 2px 4px; background: #f8fafc; }
.stamp { display: inline-block; border: 2px solid #b91c1c; color: #b91c1c; padding: 2px 8px; border-radius: 3px; font-weight: 700; font-size: 10px; transform: rotate(-4deg); text-transform: uppercase; }
.gdt-totals { margin-top: 0; }
.gdt-totals td { border-top: 0; }
.words { padding: 6px 8px; border: 1px solid #475569; border-top: 0; font-size: 11.5px; }
.gdt-signs { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 14px; text-align: center; font-size: 11.5px; }
.sig-valid { display: inline-block; margin-top: 8px; border: 1.5px solid #16a34a; background: #f0fdf4; color: #15803d; padding: 6px 10px; text-align: left; font-size: 10.5px; line-height: 1.45; min-width: 220px; }
.sig-valid b { display: block; font-size: 11px; margin-bottom: 2px; }
.foot { margin-top: 12px; padding-top: 6px; border-top: 1px solid #cbd5e1; color: #475569; font-size: 10px; display: flex; justify-content: space-between; gap: 10px; }
`;

function gdtDateWords(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `Ngày ${m[3]} tháng ${m[2]} năm ${m[1]}` : `Ngày ${fmtDate(iso)}`;
}

/** HTML "bản thể hiện" hóa đơn điện tử theo mẫu chuẩn Nghị định 123 / cổng Thuế. */
export function invoiceHtml(inv) {
  const e = escapeHtml;
  const rows = inv.items?.length
    ? inv.items.map((it, i) => `<tr><td class="c">${e(it.stt || i + 1)}</td><td>${e(it.name)}</td><td class="c">${e(it.unit)}</td><td class="r">${fmtMoney(it.qty)}</td><td class="r">${fmtMoney(it.price)}</td><td class="r">${fmtMoney(it.amount)}</td><td class="c">${e(TAX_RATE_LABEL[it.rate] || it.rate || '')}</td><td class="r">${fmtMoney(it.tax)}</td></tr>`).join('')
    : `<tr><td colspan="8" class="c" style="color:#64748b;padding:12px">Chưa có chi tiết hàng hóa (mới đồng bộ phần tóm tắt).</td></tr>`;
  const breakdown = (inv.taxBreakdown || []).map((b) => `<tr><td colspan="5" class="r">Tổng hợp theo thuế suất ${e(TAX_RATE_LABEL[b.rate] || b.rate)}:</td><td class="r">${fmtMoney(b.base)}</td><td class="c">${e(TAX_RATE_LABEL[b.rate] || b.rate)}</td><td class="r">${fmtMoney(b.tax)}</td></tr>`).join('');
  const showStamp = Number(inv.status) && Number(inv.status) !== 1;
  const sigBox = (inv.hasSignature || inv.invoiceCode)
    ? `<div class="sig-valid"><b>&#10004; Signature Valid</b><div>Ký bởi: ${e(inv.sellerName || inv.sellerTax)}</div><div>Ký ngày: ${e(fmtDate(inv.date))}</div></div>`
    : `<div style="height:48px"></div>`;
  return `<section class="page"><div class="gdt-sheet"><div class="gdt-inner">
  <div class="gdt-head">
    <div>${showStamp ? `<div class="stamp">${e(INVOICE_STATUS[inv.status]?.label || '')}</div>` : ''}</div>
    <div class="gdt-title">
      <h1>${e(inv.invoiceName || 'HÓA ĐƠN GIÁ TRỊ GIA TĂNG')}</h1>
      <div class="gdt-sub">(Bản thể hiện của hóa đơn điện tử)</div>
      <div class="gdt-date">${e(gdtDateWords(inv.date))}</div>
    </div>
    <div class="gdt-meta">
      <div>Mẫu số: <b>${e(inv.template || '1')}</b></div>
      <div>Ký hiệu: <b>${e(inv.series || '')}</b></div>
      <div>Số: <span class="inv-no">${e(String(inv.number || '').padStart(7, '0'))}</span></div>
    </div>
  </div>
  <div class="gdt-box"><div class="gdt-kv">
    <span>Đơn vị bán hàng:</span><b>${e(inv.sellerName)}</b>
    <span>Mã số thuế:</span><b>${e(inv.sellerTax)}</b>
    <span>Địa chỉ:</span><span>${e(inv.sellerAddress)}</span>
    ${inv.sellerPhone ? `<span>Điện thoại:</span><span>${e(inv.sellerPhone)}</span>` : ''}
    ${inv.sellerBank ? `<span>Số tài khoản:</span><span>${e(inv.sellerBank)}</span>` : ''}
  </div></div>
  <div class="gdt-box" style="border-bottom:0;margin-bottom:4px"><div class="gdt-kv">
    <span>Họ tên người mua hàng:</span><span>${e(inv.buyerContact || '')}</span>
    <span>Tên đơn vị:</span><b>${e(inv.buyerName)}</b>
    <span>Mã số thuế:</span><b>${e(inv.buyerTax)}</b>
    <span>Địa chỉ:</span><span>${e(inv.buyerAddress)}</span>
    <span>Hình thức thanh toán:</span><span>${e(inv.paymentMethod || '')} &nbsp;&nbsp; <i>Đơn vị tiền tệ:</i> ${e(inv.currency || 'VND')}${inv.exchangeRate && inv.exchangeRate !== 1 ? ` (Tỷ giá: ${fmtMoney(inv.exchangeRate)})` : ''}</span>
  </div></div>
  <table>
    <thead>
      <tr><th style="width:30px">STT</th><th>Tên hàng hóa, dịch vụ</th><th style="width:48px">ĐVT</th><th style="width:56px">Số lượng</th><th style="width:76px">Đơn giá</th><th style="width:86px">Thành tiền</th><th style="width:56px">Thuế suất</th><th style="width:76px">Tiền thuế</th></tr>
      <tr class="gdt-colnum"><th>(1)</th><th>(2)</th><th>(3)</th><th>(4)</th><th>(5)</th><th>(6) = (4)x(5)</th><th>(7)</th><th>(8) = (6)x(7)</th></tr>
    </thead>
    <tbody>${rows}${breakdown}</tbody>
  </table>
  <table class="gdt-totals"><tbody>
    <tr><td colspan="5" class="r"><b>Cộng tiền hàng:</b></td><td class="r" style="width:86px"><b>${fmtMoney(inv.net)}</b></td><td style="width:56px"></td><td class="r" style="width:76px"><b>${fmtMoney(inv.vat)}</b></td></tr>
    <tr><td colspan="5" class="r"><b>Tổng cộng tiền thanh toán (${e(inv.currency || 'VND')}):</b></td><td class="r" colspan="3"><b>${fmtMoney(inv.total)}</b></td></tr>
  </tbody></table>
  <div class="words"><i>Số tiền viết bằng chữ:</i> <b>${e(inv.totalInWords || '')}</b></div>
  <div class="gdt-signs">
    <div><b>Người mua hàng</b><div style="font-style:italic;font-size:10.5px">(Chữ ký số (nếu có))</div></div>
    <div><b>Người bán hàng</b><div style="font-style:italic;font-size:10.5px">(Ký, ghi rõ họ, tên)</div>${sigBox}</div>
  </div>
  <div class="foot">
    <span>${inv.invoiceCode ? `Mã của cơ quan thuế: <b>${e(inv.invoiceCode)}</b>` : 'Hóa đơn điện tử không có mã của cơ quan thuế'}</span>
    <span>Tra cứu tại: https://hoadondientu.gdt.gov.vn</span>
  </div>
</div></div></section>`;
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
