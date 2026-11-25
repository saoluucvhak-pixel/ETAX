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
import { qrSvg, invoiceQrPayload } from './core/qr.js';
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
body { font: 11px/1.4 "Times New Roman", Times, serif; color: #111; margin: 0; }
h1 { font-size: 16px; margin: 0 0 2px; color: #111; }
h2 { font-size: 13px; margin: 14px 0 6px; }
.sub { color: #5b6778; margin-bottom: 10px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #222; padding: 3px 5px; vertical-align: middle; }
th { background: #fff; text-align: center; font-weight: 700; }
td.r { text-align: right; font-variant-numeric: tabular-nums; }
td.c { text-align: center; }
tfoot td { font-weight: 700; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
.gdt-sheet { border: 1px solid #d6c8b8; padding: 12px 14px; background: #fff; }
.gdt-head { display: grid; grid-template-columns: 120px 1fr 140px; gap: 8px; align-items: start; margin-bottom: 6px; }
.gdt-meta { font-size: 11px; line-height: 1.5; text-align: left; }
.gdt-title { text-align: center; padding-top: 6px; }
.gdt-title h1 { font-size: 17px; font-weight: 700; text-transform: uppercase; margin: 0; letter-spacing: .2px; }
.gdt-title .gdt-date { font-size: 11px; margin-top: 3px; }
.gdt-title .gdt-mccqt { font-size: 10.5px; margin-top: 2px; word-break: break-all; }
.gdt-sec { border-top: 1px solid #555; padding: 5px 0; font-size: 11px; line-height: 1.52; }
.gdt-line { display: flex; flex-wrap: wrap; gap: 4px 28px; }
.gdt-tbl { margin-top: 6px; font-size: 10.5px; }
.gdt-summary { display: grid; grid-template-columns: 40% 58%; justify-content: space-between; gap: 10px; margin-top: 10px; align-items: start; font-size: 10.5px; }
.gdt-signs { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 16px; text-align: center; font-size: 11px; }
.sig-valid { display: inline-block; margin-top: 8px; border: 1.5px solid #22c55e; background: #fff; color: #16a34a; padding: 6px 10px; text-align: left; font-size: 10.5px; line-height: 1.45; min-width: 215px; }
.sig-valid b { display: block; font-size: 11px; margin-bottom: 2px; }
.gdt-note-mid { text-align: center; font-style: italic; font-size: 10.5px; margin-top: 12px; }
.gdt-foreign { border-top: 1px solid #555; margin-top: 10px; padding-top: 8px; font-size: 10px; line-height: 1.45; }
.gdt-foreign h3 { text-align: center; font-size: 11.5px; margin: 0 0 6px; }
.gdt-foreign ul { margin: 0; padding-left: 16px; }
.stamp { display: inline-block; border: 2px solid #b91c1c; color: #b91c1c; padding: 2px 6px; font-weight: 700; font-size: 9.5px; transform: rotate(-4deg); text-transform: uppercase; }
`;

const KIND_LABEL = { 1: 'Hàng hóa, dịch vụ', 2: 'Khuyến mại', 3: 'Chiết khấu thương mại', 4: 'Ghi chú, diễn giải' };

function gdtDateWords(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `Ngày ${m[3]} tháng ${m[2]} năm ${m[1]}` : `Ngày ${fmtDate(iso)}`;
}

/** HTML "bản thể hiện" hóa đơn điện tử theo đúng mẫu của Tổng cục Thuế. */
export function invoiceHtml(inv) {
  const e = escapeHtml;
  const rows = inv.items?.length
    ? inv.items.map((it, i) => `<tr>
      <td class="c">${e(it.stt || i + 1)}</td>
      <td>${e(KIND_LABEL[it.kind] || 'Hàng hóa, dịch vụ')}</td>
      <td></td>
      <td>${e(it.name)}</td>
      <td class="c">${e(it.unit)}</td>
      <td class="r">${fmtMoney(it.qty)}</td>
      <td class="r">${fmtMoney(it.price)}</td>
      <td class="r">${fmtMoney(it.discount || 0)}</td>
      <td class="c">${e(TAX_RATE_LABEL[it.rate] || it.rate || '')}</td>
      <td class="r">${fmtMoney(it.amount)}</td>
    </tr>`).join('')
    : `<tr><td colspan="10" class="c" style="color:#666;padding:10px">Chưa có chi tiết hàng hóa (mới đồng bộ phần tóm tắt).</td></tr>`;

  const rateRows = (inv.taxBreakdown || []).length
    ? inv.taxBreakdown.map((b) => `<tr><td class="c">${e(TAX_RATE_LABEL[b.rate] || b.rate)}</td><td class="r">${fmtMoney(b.base)}</td><td class="r">${fmtMoney(b.tax)}</td></tr>`).join('')
    : `<tr><td class="c">-</td><td class="r">${fmtMoney(inv.net)}</td><td class="r">${fmtMoney(inv.vat)}</td></tr>`;

  const showStamp = Number(inv.status) && Number(inv.status) !== 1;
  const sigBox = (inv.hasSignature || inv.invoiceCode)
    ? `<div class="sig-valid"><b>Signature Valid</b><div>Ký bởi ${e(inv.sellerName || inv.sellerTax)}</div><div>Ký ngày: ${e(fmtDate(inv.date))} &#10004;</div></div>`
    : `<div style="height:48px"></div>`;

  const totalDiscount = (inv.totalDiscount != null && Number(inv.totalDiscount) > 0)
    ? Number(inv.totalDiscount)
    : (inv.items || []).reduce((acc, it) => acc + (Number(it.kind) === 3 ? (Number(it.amount) || 0) : (Number(it.discount) || 0)), 0);

  return `<section class="page"><div class="gdt-sheet">
  <div class="gdt-head">
    <div style="display:flex;align-items:flex-start;gap:6px">${qrSvg(invoiceQrPayload(inv), 72)}${showStamp ? `<div class="stamp">${e(INVOICE_STATUS[inv.status]?.label || '')}</div>` : ''}</div>
    <div class="gdt-title">
      <h1>${e(inv.invoiceName || 'HOÁ ĐƠN GIÁ TRỊ GIA TĂNG')}</h1>
      <div class="gdt-date">${e(gdtDateWords(inv.date))}</div>
      ${inv.invoiceCode ? `<div class="gdt-mccqt">MCCQT: ${e(inv.invoiceCode)}</div>` : ''}
    </div>
    <div class="gdt-meta">
      <div><b>Mẫu số</b> ${e(inv.template || '1')}</div>
      <div><b>Ký hiệu:</b> ${e(inv.series || '')}</div>
      <div><b>Số:</b> ${e(inv.number || '')}</div>
    </div>
  </div>

  <div class="gdt-sec">
    <div>Tên người bán: ${e(inv.sellerName)}</div>
    <div>Mã số thuế: ${e(inv.sellerTax)}</div>
    <div>Mã cửa hàng:</div>
    <div>Tên cửa hàng:</div>
    <div>Địa chỉ: ${e(inv.sellerAddress)}</div>
    <div>Điện thoại: ${e(inv.sellerPhone || '')}</div>
    <div>Số tài khoản: ${e(inv.sellerBank || '')}</div>
  </div>

  <div class="gdt-sec">
    <div>Tên người mua: ${e(inv.buyerName)}</div>
    <div>Họ tên người mua hàng: ${e(inv.buyerContact || '')}</div>
    <div>Mã số thuế: ${e(inv.buyerTax)}</div>
    <div>Mã ĐVCQHVNSNN:</div>
    <div>CCCD người mua:</div>
    <div>Số hộ chiếu:</div>
    <div>Địa chỉ: ${e(inv.buyerAddress)}</div>
    <div>Hình thức thanh toán: ${e(inv.paymentMethod || '')}</div>
    <div>Số tài khoản:</div>
    <div>Đơn vị tiền tệ: ${e(inv.currency || 'VND')}${inv.exchangeRate && inv.exchangeRate !== 1 ? ` &nbsp;&nbsp; Tỷ giá: ${fmtMoney(inv.exchangeRate)}` : ''}</div>
    <div class="gdt-line"><span>Số bảng kê:</span><span>Ngày bảng kê:</span></div>
  </div>

  <table class="gdt-tbl">
    <thead>
      <tr>
        <th style="width:26px">STT</th>
        <th style="width:62px">Tính chất</th>
        <th style="width:52px">Loại hàng hoá đặc trưng</th>
        <th>Tên hàng hóa, dịch vụ</th>
        <th style="width:42px">Đơn vị tính</th>
        <th style="width:44px">Số lượng</th>
        <th style="width:62px">Đơn giá</th>
        <th style="width:50px">Chiết khấu</th>
        <th style="width:42px">Thuế suất</th>
        <th style="width:74px">Thành tiền chưa có thuế GTGT</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="gdt-summary">
    <table>
      <thead><tr><th>Thuế suất</th><th>Tổng tiền chưa thuế</th><th>Tổng tiền thuế</th></tr></thead>
      <tbody>${rateRows}</tbody>
    </table>
    <table>
      <tbody>
        <tr><td>Tổng tiền chưa thuế (Tổng cộng thành tiền chưa có thuế)</td><td class="r" style="width:120px">${fmtMoney(inv.net)}</td></tr>
        <tr><td>Tổng tiền thuế (Tổng cộng tiền thuế)</td><td class="r">${fmtMoney(inv.vat)}</td></tr>
        <tr><td>Tổng tiền phí</td><td class="r"></td></tr>
        <tr><td>Tổng tiền chiết khấu thương mại</td><td class="r">${totalDiscount ? fmtMoney(totalDiscount) : '0'}</td></tr>
        <tr><td>Tổng tiền thanh toán bằng số</td><td class="r"><b>${fmtMoney(inv.total)}</b></td></tr>
        <tr><td>Tổng tiền thanh toán bằng chữ</td><td class="c">${e(inv.totalInWords || '')}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="gdt-signs">
    <div><div>NGƯỜI MUA HÀNG</div><div style="font-style:italic;font-size:10px">(Chữ ký số (nếu có))</div></div>
    <div><div>NGƯỜI BÁN HÀNG</div><div style="font-style:italic;font-size:10px">(Chữ ký điện tử, chữ ký số)</div>${sigBox}</div>
  </div>
  <div class="gdt-note-mid">(Cần kiểm tra, đối chiếu khi lập, nhận hóa đơn)</div>

  <div class="gdt-foreign">
    <h3>Thông tin quan trọng cho người nước ngoài</h3>
    <ul>
      <li>Bạn phải đáp ứng đầy đủ điều kiện tại Thông tư số 72/2014/TT-BTC ngày 30/05/2014; Thông tư số 92/2019/TT-BTC ngày 31/12/2019 sửa đổi, bổ sung Thông tư số 72/2014/TT-BTC của Bộ Tài Chính để được hoàn thuế GTGT;</li>
      <li>Bạn phải làm thủ tục hoàn thuế trong vòng 60 ngày kể từ ngày mua hàng (kể từ ngày phát hành hóa đơn);</li>
      <li>Bạn được hoàn thuế GTGT khi đi đường hàng không/đường biển tại sân bay quốc tế/cảng biển quốc tế.</li>
    </ul>
  </div>
</div></section>`;
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
  const useElectronPrint = isElectron() && !!state.settings.saveFolderName;
  const lib = useElectronPrint ? null : await loadPdfLib();
  const used = new Set();
  let ok = 0, fail = 0;
  for (const inv of invoices) {
    try {
      let base = sanitizeFileName(invoiceFileName(inv));
      let name = `${base}.pdf`;
      for (let i = 2; used.has(name); i++) name = `${base}_${i}.pdf`;
      used.add(name);
      if (useElectronPrint) {
        const html = wrapHtml(base, invoiceHtml(inv), false);
        const r = await desktop().printPdf({ html, name, landscape: false });
        if (!r?.path) throw new Error('Đã hủy lưu tệp');
        await logger.info('export', `Xuất PDF: ${name}`, { invoiceKey: inv.key, file: name });
      } else {
        const doc = newDoc(lib);
        drawInvoicePdf(doc, inv, { fmtMoney, fmtDate, TAX_RATE_LABEL, INVOICE_STATUS });
        await deliver(name, doc.output('blob'), 'PDF', { invoiceKey: inv.key }, true);
      }
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
