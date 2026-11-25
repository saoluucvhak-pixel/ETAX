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
  ink: [17, 17, 17], border: [34, 34, 34], muted: [85, 85, 85],
  red: [185, 28, 28], green: [22, 163, 74], outer: [214, 200, 184],
};
const M = { l: 12, r: 12, t: 12, b: 12 };
const PW = 210, PH = 297, CW = PW - M.l - M.r;

const KIND_LABEL = { 1: 'Hàng hóa, dịch vụ', 2: 'Khuyến mại', 3: 'Chiết khấu', 4: 'Ghi chú' };
const ITEM_COLS = [
  { key: 'stt', label: 'STT', w: 9, align: 'center' },
  { key: 'kind', label: 'Tính chất', w: 21, align: 'left' },
  { key: 'name', label: 'Tên hàng hóa, dịch vụ', w: 54, align: 'left' },
  { key: 'unit', label: 'ĐVT', w: 12, align: 'center' },
  { key: 'qty', label: 'SL', w: 13, align: 'right' },
  { key: 'price', label: 'Đơn giá', w: 21, align: 'right' },
  { key: 'disc', label: 'CK', w: 13, align: 'right' },
  { key: 'rate', label: 'TS', w: 14, align: 'center' },
  { key: 'amount', label: 'Thành tiền chưa thuế', w: 29, align: 'right' },
];
const colX = (idx) => { let x = M.l; for (let i = 0; i < idx; i++) x += ITEM_COLS[i].w; return x; };

function gdtDateWords(iso, fmtDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `Ngày ${m[3]} tháng ${m[2]} năm ${m[1]}` : `Ngày ${fmtDate(iso)}`;
}

function drawTableHeader(doc, y) {
  const h = 9;
  doc.setDrawColor(...C.border);
  doc.rect(M.l, y, CW, h);
  doc.setFont(FONT, 'bold'); doc.setFontSize(7.6); doc.setTextColor(...C.ink);
  ITEM_COLS.forEach((c, i) => {
    const x = colX(i);
    if (i) doc.line(x, y, x, y + h);
    doc.text(c.label, x + c.w / 2, y + 4.2, { align: 'center', maxWidth: c.w - 1.5 });
  });
  return y + h;
}

function stampPageNumbers(doc, pageCount) {
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont(FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C.muted);
    doc.text(`Trang ${p}/${pageCount}`, PW - M.r, PH - 6, { align: 'right' });
  }
}

export function drawInvoicePdf(doc, inv, deps) {
  const { fmtMoney, fmtDate, TAX_RATE_LABEL, INVOICE_STATUS } = deps;
  let page = 1;
  let y = M.t;

  // Khung ngoài trang nhã
  doc.setDrawColor(...C.outer); doc.rect(M.l - 2, M.t - 2, CW + 4, PH - M.t - M.b + 4);

  // Đầu trang
  if (Number(inv.status) && Number(inv.status) !== 1) {
    const stLabel = INVOICE_STATUS[inv.status]?.label || '';
    if (stLabel) {
      doc.setDrawColor(...C.red); doc.setTextColor(...C.red); doc.setFont(FONT, 'bold'); doc.setFontSize(8.5);
      const wStamp = doc.getTextWidth(stLabel) + 5;
      doc.rect(M.l, y, wStamp, 6);
      doc.text(stLabel.toUpperCase(), M.l + wStamp / 2, y + 4.2, { align: 'center' });
    }
  }
  doc.setFont(FONT, 'bold'); doc.setFontSize(14.5); doc.setTextColor(...C.ink);
  doc.text(String(inv.invoiceName || 'HOÁ ĐƠN GIÁ TRỊ GIA TĂNG').toUpperCase(), PW / 2, y + 5, { align: 'center' });
  doc.setFont(FONT, 'normal'); doc.setFontSize(9);
  doc.text(gdtDateWords(inv.date, fmtDate), PW / 2, y + 10, { align: 'center' });
  if (inv.invoiceCode) {
    doc.setFontSize(8);
    doc.text(`MCCQT: ${inv.invoiceCode}`, PW / 2, y + 14.5, { align: 'center' });
  }

  doc.setFontSize(8.5);
  const rx = M.l + CW - 36;
  doc.setFont(FONT, 'bold'); doc.text(`Mẫu số: ${inv.template || '1'}`, rx, y + 2);
  doc.text(`Ký hiệu: ${inv.series || ''}`, rx, y + 6.5);
  doc.text(`Số: ${inv.number || ''}`, rx, y + 11);

  y += 17;
  doc.setDrawColor(...C.muted); doc.line(M.l, y, M.l + CW, y);
  y += 4.5;

  const line = (label, val = '') => {
    doc.setFont(FONT, 'normal'); doc.setFontSize(8.8); doc.setTextColor(...C.ink);
    const txt = `${label}: ${val ?? ''}`;
    const lines = doc.splitTextToSize(txt, CW);
    doc.text(lines, M.l, y);
    y += 4.2 * lines.length;
  };
  line('Tên người bán', inv.sellerName);
  line('Mã số thuế', inv.sellerTax);
  line('Địa chỉ', inv.sellerAddress);
  line('Điện thoại', inv.sellerPhone || '');
  line('Số tài khoản', inv.sellerBank || '');
  y += 1;
  doc.setDrawColor(...C.muted); doc.line(M.l, y, M.l + CW, y);
  y += 4.5;
  line('Tên người mua', inv.buyerName);
  line('Họ tên người mua hàng', inv.buyerContact || '');
  line('Mã số thuế', inv.buyerTax);
  line('Địa chỉ', inv.buyerAddress);
  line('Hình thức thanh toán', inv.paymentMethod || '');
  line('Đơn vị tiền tệ', inv.currency || 'VND');

  y += 2;
  y = drawTableHeader(doc, y);

  const items = inv.items?.length ? inv.items : [{ __empty: true }];
  doc.setFont(FONT, 'normal'); doc.setFontSize(7.8); doc.setTextColor(...C.ink);
  items.forEach((it, i) => {
    const nameLines = it.__empty
      ? ['Chưa có chi tiết hàng hóa (mới đồng bộ phần tóm tắt).']
      : doc.splitTextToSize(String(it.name || ''), ITEM_COLS[2].w - 2);
    const rowH = Math.max(6, nameLines.length * 3.8 + 2);
    if (y + rowH > PH - M.b - 68) { doc.addPage(); page++; y = M.t; y = drawTableHeader(doc, y); }
    doc.setDrawColor(...C.border);
    doc.rect(M.l, y, CW, rowH);
    ITEM_COLS.forEach((c, ci) => { if (ci) doc.line(colX(ci), y, colX(ci), y + rowH); });
    const midY = y + rowH / 2 + 1;
    if (it.__empty) {
      doc.setTextColor(...C.muted);
      doc.text(nameLines, colX(2) + 1, midY);
      doc.setTextColor(...C.ink);
    } else {
      doc.text(String(it.stt ?? i + 1), colX(0) + ITEM_COLS[0].w / 2, midY, { align: 'center' });
      doc.text(KIND_LABEL[it.kind] || 'Hàng hóa, dịch vụ', colX(1) + 1, midY, { maxWidth: ITEM_COLS[1].w - 2 });
      doc.text(nameLines, colX(2) + 1, y + 3.8);
      doc.text(String(it.unit || ''), colX(3) + ITEM_COLS[3].w / 2, midY, { align: 'center' });
      doc.text(fmtMoney(it.qty), colX(4) + ITEM_COLS[4].w - 1, midY, { align: 'right' });
      doc.text(fmtMoney(it.price), colX(5) + ITEM_COLS[5].w - 1, midY, { align: 'right' });
      doc.text(fmtMoney(it.discount || 0), colX(6) + ITEM_COLS[6].w - 1, midY, { align: 'right' });
      doc.text(String(TAX_RATE_LABEL[it.rate] || it.rate || ''), colX(7) + ITEM_COLS[7].w / 2, midY, { align: 'center' });
      doc.text(fmtMoney(it.amount), colX(8) + ITEM_COLS[8].w - 1, midY, { align: 'right' });
    }
    y += rowH;
  });

  // Hai bảng tổng hợp song song
  const rates = inv.taxBreakdown?.length ? inv.taxBreakdown : [{ rate: '-', base: inv.net, tax: inv.vat }];
  const blockH = Math.max(36, (rates.length + 1) * 5.5) + 46;
  if (y + blockH > PH - M.b) { doc.addPage(); page++; y = M.t; }
  y += 4;
  const ly = y;
  doc.setDrawColor(...C.border); doc.setFontSize(7.8);
  // Bảng trái: Thuế suất
  const lw = [22, 27, 25]; const lx = M.l;
  doc.setFont(FONT, 'bold');
  doc.rect(lx, ly, 74, 6); doc.line(lx + lw[0], ly, lx + lw[0], ly + 6); doc.line(lx + lw[0] + lw[1], ly, lx + lw[0] + lw[1], ly + 6);
  doc.text('Thuế suất', lx + 11, ly + 4, { align: 'center' });
  doc.text('Chưa thuế', lx + 35.5, ly + 4, { align: 'center' });
  doc.text('Tiền thuế', lx + 61.5, ly + 4, { align: 'center' });
  doc.setFont(FONT, 'normal');
  rates.forEach((b, idx) => {
    const ry = ly + 6 + idx * 5.5;
    doc.rect(lx, ry, 74, 5.5); doc.line(lx + lw[0], ry, lx + lw[0], ry + 5.5); doc.line(lx + lw[0] + lw[1], ry, lx + lw[0] + lw[1], ry + 5.5);
    doc.text(String(TAX_RATE_LABEL[b.rate] || b.rate), lx + 11, ry + 3.8, { align: 'center' });
    doc.text(fmtMoney(b.base), lx + lw[0] + lw[1] - 1, ry + 3.8, { align: 'right' });
    doc.text(fmtMoney(b.tax), lx + 73, ry + 3.8, { align: 'right' });
  });

  // Bảng phải: Tổng tiền
  const rxT = M.l + 78; const rw = CW - 78; const rLabelW = rw - 38;
  const sumRows = [
    ['Tổng tiền chưa thuế', fmtMoney(inv.net)],
    ['Tổng tiền thuế', fmtMoney(inv.vat)],
    ['Tổng tiền phí', ''],
    ['Tổng tiền chiết khấu TM', '0'],
    ['Tổng tiền thanh toán bằng số', fmtMoney(inv.total)],
    ['Tổng tiền thanh toán bằng chữ', inv.totalInWords || ''],
  ];
  let sy = ly;
  sumRows.forEach(([lbl, val], idx) => {
    const lines = idx === 5 ? doc.splitTextToSize(String(val), 36) : [String(val)];
    const h = Math.max(5.5, lines.length * 3.8 + 1.8);
    doc.rect(rxT, sy, rw, h); doc.line(rxT + rLabelW, sy, rxT + rLabelW, sy + h);
    doc.setFont(FONT, 'normal'); doc.text(lbl, rxT + 1.5, sy + 3.8);
    doc.setFont(FONT, idx === 4 ? 'bold' : 'normal');
    doc.text(lines, idx === 5 ? rxT + rLabelW + 19 : rxT + rw - 1.5, sy + 3.8, { align: idx === 5 ? 'center' : 'right' });
    sy += h;
  });

  y = Math.max(ly + 6 + rates.length * 5.5, sy) + 7;
  // Chữ ký số
  doc.setFont(FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...C.ink);
  doc.text('NGƯỜI MUA HÀNG', M.l + 40, y, { align: 'center' });
  doc.text('NGƯỜI BÁN HÀNG', M.l + CW - 42, y, { align: 'center' });
  doc.setFontSize(7.5);
  doc.text('(Chữ ký số (nếu có))', M.l + 40, y + 4, { align: 'center' });
  doc.text('(Chữ ký điện tử, chữ ký số)', M.l + CW - 42, y + 4, { align: 'center' });
  if (inv.hasSignature || inv.invoiceCode) {
    const bx = M.l + CW - 74, by = y + 7;
    doc.setDrawColor(...C.green); doc.setTextColor(...C.green);
    doc.rect(bx, by, 64, 16);
    doc.setFont(FONT, 'bold'); doc.text('Signature Valid', bx + 2, by + 4.5);
    doc.setFont(FONT, 'normal');
    doc.text(`Ký bởi ${inv.sellerName || inv.sellerTax || ''}`, bx + 2, by + 9, { maxWidth: 60 });
    doc.text(`Ký ngày: ${fmtDate(inv.date)}`, bx + 2, by + 13.5);
  }
  doc.setTextColor(...C.ink); doc.setFontSize(8);
  doc.text('(Cần kiểm tra, đối chiếu khi lập, nhận hóa đơn)', PW / 2, y + 28, { align: 'center' });

  stampPageNumbers(doc, page);
  return page;
}
