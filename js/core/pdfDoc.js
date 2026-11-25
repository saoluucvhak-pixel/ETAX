/**
 * pdfDoc.js — Dựng PDF THẬT (không qua hộp thoại in của trình duyệt) cho một hóa đơn, dùng thư viện
 * jsPDF đã nhúng sẵn (js/lib/jspdf.umd.min.js) cùng phông Roboto có đủ dấu tiếng Việt (js/lib/fonts/).
 *
 * Vì sao cần file này (khác với printToPdf() trong export.js):
 *  - Bản Electron đã tự tạo PDF thật (webContents.printToPDF, không hộp thoại) — không đụng tới.
 *  - Bản Web/PWA trước đây chỉ có thể tạo PDF qua window.print() + hộp thoại in của trình duyệt (không có
 *    API nào để trình duyệt tự lưu PDF mà không cần người dùng bấm "Lưu dưới dạng PDF"), và mỗi lần in chỉ
 *    ra MỘT bản PDF (gộp nhiều hóa đơn thành nhiều trang của cùng một tệp), không tách được thành nhiều tệp
 *    riêng tự động. jsPDF vẽ PDF bằng lệnh vẽ (vector) trực tiếp trong JavaScript nên lưu thẳng thành Blob,
 *    không cần hộp thoại in — nhờ đó export.js có thể lưu MỖI HÓA ĐƠN MỘT TỆP PDF rời qua saveFile().
 *  - Phông chữ hệ thống mặc định của PDF (Helvetica…) không có dấu tiếng Việt, nên phải nhúng phông
 *    Roboto (đủ chữ Latin + tiếng Việt) vào tệp PDF khi tạo.
 *
 * Thư viện jsPDF và 2 tệp phông chỉ được TẢI KHI CẦN (thẻ <script>/import động, xem loadPdfLib()) vì khá
 * nặng (~800KB tổng), không ảnh hưởng tốc độ mở ứng dụng hay các trang khác — chỉ tải khi người dùng thật
 * sự bấm xuất PDF từng tệp.
 */

const FONT = 'RobotoVN';

/**
 * Nạp jsPDF qua thẻ <script> cổ điển (bản UMD), KHÔNG dùng import() ES module: bản dựng ES module của
 * jsPDF khai báo import "trần" (@babel/runtime/helpers/typeof, fflate) mà trình duyệt không tự phân giải
 * được nếu không qua bundler — đã kiểm chứng gây lỗi "Failed to resolve module specifier". Bản UMD gộp sẵn
 * mọi thứ vào một tệp và tự gắn vào window.jspdf.jsPDF, giống cách extension/lib/jszip.min.js đã dùng.
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Không tải được thư viện PDF (${src})`));
    document.head.append(s);
  });
}

let libPromise = null;
/** Tải (một lần, có cache) jsPDF + 2 phông đã nhúng sẵn. */
export function loadPdfLib() {
  if (!libPromise) {
    const jspdfUrl = new URL('../lib/jspdf.umd.min.js', import.meta.url).href;
    libPromise = Promise.all([
      window.jspdf?.jsPDF ? Promise.resolve() : loadScript(jspdfUrl),
      import('../lib/fonts/roboto-vn-regular.js'),
      import('../lib/fonts/roboto-vn-bold.js'),
    ]).then(([, reg, bold]) => {
      if (!window.jspdf?.jsPDF) throw new Error('Thư viện PDF đã tải nhưng không thấy jsPDF trên window.jspdf.');
      return { jsPDF: window.jspdf.jsPDF, regular: reg.default, bold: bold.default };
    });
  }
  return libPromise;
}

/** Tạo một tài liệu PDF (A4, mm) đã đăng ký sẵn phông RobotoVN (normal/bold). */
export function newDoc({ jsPDF, regular, bold }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('RobotoVN-Regular.ttf', regular);
  doc.addFont('RobotoVN-Regular.ttf', FONT, 'normal');
  doc.addFileToVFS('RobotoVN-Bold.ttf', bold);
  doc.addFont('RobotoVN-Bold.ttf', FONT, 'bold');
  doc.setFont(FONT, 'normal');
  return doc;
}

// ---------------------------------------------------------------- Bố cục trang

const C = {
  ink: [22, 32, 46], navy: [43, 58, 140], muted: [91, 103, 120],
  border: [201, 208, 220], headerBg: [234, 237, 245], red: [194, 55, 45], totalsBg: [243, 245, 250],
};
const M = { l: 12, r: 12, t: 14, b: 14 };
const PW = 210, PH = 297, CW = PW - M.l - M.r;

const ITEM_COLS = [
  { key: 'stt', label: 'STT', w: 8, align: 'center' },
  { key: 'name', label: 'Tên hàng hóa, dịch vụ', w: 66, align: 'left' },
  { key: 'unit', label: 'ĐVT', w: 14, align: 'center' },
  { key: 'qty', label: 'Số lượng', w: 18, align: 'right' },
  { key: 'price', label: 'Đơn giá', w: 26, align: 'right' },
  { key: 'amount', label: 'Thành tiền', w: 32, align: 'right' },
  { key: 'rate', label: 'Thuế suất', w: 22, align: 'center' },
];
const colX = (idx) => { let x = M.l; for (let i = 0; i < idx; i++) x += ITEM_COLS[i].w; return x; };

function drawTableHeader(doc, y) {
  const h = 7;
  doc.setFillColor(...C.headerBg); doc.setDrawColor(...C.border);
  doc.rect(M.l, y, CW, h, 'FD');
  doc.setFont(FONT, 'bold'); doc.setFontSize(8.3); doc.setTextColor(...C.ink);
  ITEM_COLS.forEach((c, i) => {
    const x = colX(i);
    if (i) doc.line(x, y, x, y + h);
    const align = c.align === 'left' ? 'left' : c.align === 'right' ? 'right' : 'center';
    const tx = c.align === 'left' ? x + 1.5 : c.align === 'right' ? x + c.w - 1.5 : x + c.w / 2;
    doc.text(c.label, tx, y + h / 2 + 1.1, { align, maxWidth: c.w - 2 });
  });
  return y + h;
}

/** Vẽ số trang "Trang X/Y" ở mọi trang đã dùng, canh lại sau khi biết tổng số trang. */
function stampPageNumbers(doc, fmtMoneyFn, pageCount) {
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C.muted);
    doc.text('Bản thể hiện tạo bởi eTax Manager từ dữ liệu đã đồng bộ — không thay thế hóa đơn điện tử gốc có chữ ký số.', M.l, PH - 8, { maxWidth: CW - 26 });
    doc.text(`Trang ${p}/${pageCount}`, PW - M.r, PH - 8, { align: 'right' });
  }
}

/**
 * Vẽ một hóa đơn (bản thể hiện) vào `doc`, bắt đầu ở trang hiện tại (tự thêm trang mới nếu hàng hóa dài).
 * `deps` = { fmtMoney, fmtDate, TAX_RATE_LABEL, INVOICE_STATUS } — truyền vào để dùng đúng hàm định dạng/nhãn
 * của ứng dụng (không lặp logic đã có trong utils.js / config.js).
 */
export function drawInvoicePdf(doc, inv, deps) {
  const { fmtMoney, fmtDate, TAX_RATE_LABEL, INVOICE_STATUS } = deps;
  let page = 1;
  let y = M.t;

  // ---- Đầu trang: tem trạng thái, tiêu đề, mẫu số/ký hiệu/số
  const stLabel = INVOICE_STATUS[inv.status]?.label || '';
  if (stLabel) {
    doc.setDrawColor(...C.red); doc.setTextColor(...C.red); doc.setFont(FONT, 'bold'); doc.setFontSize(10);
    const wStamp = doc.getTextWidth(stLabel) + 6;
    doc.roundedRect(M.l, y, wStamp, 7, 1, 1);
    doc.text(stLabel, M.l + wStamp / 2, y + 4.8, { align: 'center' });
  }
  doc.setFont(FONT, 'bold'); doc.setFontSize(16); doc.setTextColor(...C.navy);
  doc.text(String(inv.invoiceName || 'Hóa đơn giá trị gia tăng').toUpperCase(), PW / 2, y + 5, { align: 'center' });
  doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...C.ink);
  doc.text(`Ngày ${fmtDate(inv.date)}`, PW / 2, y + 11, { align: 'center' });

  doc.setFontSize(9);
  const rx = M.l + CW;
  doc.text(`Mẫu số: ${inv.template || ''}`, rx, y + 2.5, { align: 'right' });
  doc.text(`Ký hiệu: ${inv.series || ''}`, rx, y + 7, { align: 'right' });
  doc.text(`Số: ${inv.number || ''}`, rx, y + 11.5, { align: 'right' });

  y += 16;
  doc.setDrawColor(...C.navy); doc.setLineWidth(0.6); doc.line(M.l, y, M.l + CW, y); doc.setLineWidth(0.2);
  y += 5;

  function kv(label, value, opts = {}) {
    doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...C.muted);
    doc.text(label, M.l, y);
    doc.setFont(FONT, opts.bold ? 'bold' : 'normal'); doc.setTextColor(...C.ink);
    const lines = doc.splitTextToSize(String(value ?? ''), CW - 34);
    doc.text(lines, M.l + 34, y);
    y += 5 * lines.length;
  }
  kv('Người bán', inv.sellerName, { bold: true });
  kv('Mã số thuế', inv.sellerTax);
  kv('Địa chỉ', inv.sellerAddress);
  y += 1.5;
  doc.setDrawColor(...C.border); doc.setLineDashPattern([1, 1], 0); doc.line(M.l, y, M.l + CW, y); doc.setLineDashPattern([], 0);
  y += 5;
  kv('Người mua', inv.buyerName, { bold: true });
  kv('Mã số thuế', inv.buyerTax);
  kv('Địa chỉ', inv.buyerAddress);
  if (inv.paymentMethod) kv('Hình thức TT', inv.paymentMethod);

  y += 3;
  doc.setFont(FONT, 'bold'); doc.setFontSize(10.5); doc.setTextColor(...C.ink);
  doc.text('Hàng hóa, dịch vụ', M.l, y);
  y += 3;
  y = drawTableHeader(doc, y);

  const items = inv.items?.length ? inv.items : [{ __empty: true }];
  doc.setFont(FONT, 'normal'); doc.setFontSize(8.3); doc.setTextColor(...C.ink);
  items.forEach((it, i) => {
    const nameLines = it.__empty
      ? ['Chưa có chi tiết hàng hóa (mới đồng bộ phần tóm tắt).']
      : doc.splitTextToSize(String(it.name || ''), ITEM_COLS[1].w - 3);
    const rowH = Math.max(6, nameLines.length * 4 + 2);
    if (y + rowH > PH - M.b - 55) { doc.addPage(); page++; y = M.t; y = drawTableHeader(doc, y); }
    doc.setDrawColor(...C.border);
    doc.rect(M.l, y, CW, rowH);
    ITEM_COLS.forEach((c, ci) => { if (ci) doc.line(colX(ci), y, colX(ci), y + rowH); });
    const midY = y + rowH / 2 + 1.1;
    if (it.__empty) {
      doc.setTextColor(...C.muted);
      doc.text(nameLines, colX(1) + 1.5, midY);
      doc.setTextColor(...C.ink);
    } else {
      doc.text(String(it.stt ?? i + 1), colX(0) + ITEM_COLS[0].w / 2, midY, { align: 'center' });
      doc.text(nameLines, colX(1) + 1.5, y + 4);
      doc.text(String(it.unit || ''), colX(2) + ITEM_COLS[2].w / 2, midY, { align: 'center' });
      doc.text(fmtMoney(it.qty), colX(3) + ITEM_COLS[3].w - 1.5, midY, { align: 'right' });
      doc.text(fmtMoney(it.price), colX(4) + ITEM_COLS[4].w - 1.5, midY, { align: 'right' });
      doc.text(fmtMoney(it.amount), colX(5) + ITEM_COLS[5].w - 1.5, midY, { align: 'right' });
      doc.text(String(TAX_RATE_LABEL[it.rate] || it.rate || ''), colX(6) + ITEM_COLS[6].w / 2, midY, { align: 'center' });
    }
    y += rowH;
  });

  // ---- Khối tổng cộng
  const sumW = 90, sumX = M.l + CW - sumW;
  const breakdown = inv.taxBreakdown || [];
  const sumH = (2 + breakdown.length + 1) * 5.5 + 6;
  if (y + sumH > PH - M.b - 12) { doc.addPage(); page++; y = M.t; }
  y += 4;
  let sy = y;
  doc.setFont(FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(...C.ink);
  breakdown.forEach((b) => {
    doc.text(`Thuế suất ${TAX_RATE_LABEL[b.rate] || b.rate}`, sumX, sy);
    doc.text(fmtMoney(b.tax), sumX + sumW, sy, { align: 'right' });
    sy += 5.5;
  });
  doc.text('Cộng tiền hàng', sumX, sy); doc.text(fmtMoney(inv.net), sumX + sumW, sy, { align: 'right' }); sy += 5.5;
  doc.text('Tiền thuế GTGT', sumX, sy); doc.text(fmtMoney(inv.vat), sumX + sumW, sy, { align: 'right' }); sy += 6.5;
  doc.setFillColor(...C.totalsBg); doc.rect(sumX - 2, sy - 4.3, sumW + 2, 7, 'F');
  doc.setFont(FONT, 'bold'); doc.setFontSize(10);
  doc.text(`Tổng thanh toán (${inv.currency || 'VND'})`, sumX, sy);
  doc.text(fmtMoney(inv.total), sumX + sumW, sy, { align: 'right' });
  y = sy + 7;

  if (inv.totalInWords) {
    doc.setFont(FONT, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...C.ink);
    const lines = doc.splitTextToSize(`Số tiền viết bằng chữ: ${inv.totalInWords}`, CW);
    doc.text(lines, M.l, y); y += lines.length * 5;
  }
  if (inv.invoiceCode) {
    doc.setFontSize(9); doc.setTextColor(...C.muted);
    doc.text(`Mã của cơ quan thuế: ${inv.invoiceCode}`, M.l, y);
  }

  stampPageNumbers(doc, fmtMoney, page);
  return page;
}
