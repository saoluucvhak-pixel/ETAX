/**
 * xmlparser.js — Đọc file XML hóa đơn điện tử (cấu trúc theo Nghị định 123/2020 & Thông tư 78/2021).
 *
 *   HDon
 *   ├─ DLHDon
 *   │   ├─ TTChung   (KHMSHDon, KHHDon, SHDon, NLap, DVTTe, TGia, HTTToan…)
 *   │   └─ NDHDon
 *   │       ├─ NBan / NMua   (Ten, MST, DChi…)
 *   │       ├─ DSHHDVu/HHDVu (THHDVu, DVTinh, SLuong, DGia, ThTien, TSuat…)
 *   │       └─ TToan         (THTTLTSuat/LTSuat, TgTCThue, TgTThue, TgTTTBSo, TgTTTBChu)
 *   ├─ MCCQT     (mã của cơ quan thuế, nếu có)
 *   └─ DSCKS     (chữ ký số người bán / CQT)
 *
 * Bộ đọc tìm phần tử theo tên cục bộ (bỏ qua namespace) nên chịu được các biến thể bọc ngoài
 * như <TDiep><DLieu><HDon>…
 */
import { parseNumber, isValidTaxCode } from '../utils.js';

const kids = (node, name) => (node ? [...node.children].filter((c) => c.localName === name) : []);
const child = (node, name) => kids(node, name)[0] || null;

/** get(node, 'NBan/MST') → text hoặc ''. */
function get(node, path) {
  let cur = node;
  for (const p of path.split('/')) {
    cur = child(cur, p);
    if (!cur) return '';
  }
  return (cur.textContent || '').trim();
}

const findDeep = (root, name) => root.getElementsByTagNameNS('*', name)[0] || null;

export const PAYMENT_METHOD = { 1: 'Tiền mặt', 2: 'Chuyển khoản', 3: 'Tiền mặt/Chuyển khoản', 4: 'Đối trừ công nợ', 5: 'Không thu tiền', 9: 'Khác' };

/** "10%" | "10" | "KCT" | "KKKNT" | "0.1" → '10' | 'KCT' | 'KKKNT' | 'khac' */
export function taxRateKey(v) {
  if (v == null || v === '') return 'khac';
  const s = String(v).trim().toUpperCase();
  if (s === 'KCT' || s === 'KKKNT') return s;
  const m = /^(\d+(?:[.,]\d+)?)\s*%?$/.exec(s);
  if (!m) return 'khac';
  let n = parseFloat(m[1].replace(',', '.'));
  if (n > 0 && n < 1 && !s.includes('%')) n *= 100; // dạng 0.1
  const r = String(Math.round(n * 100) / 100);
  return ['0', '5', '8', '10'].includes(r) ? r : r === '0' ? '0' : 'khac';
}

/**
 * Phân tích một chuỗi XML.
 * @returns {{invoice: object|null, errors: string[], warnings: string[]}}
 */
export function parseInvoiceXml(text) {
  const errors = [];
  const warnings = [];
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    return { invoice: null, errors: ['XML không đúng cú pháp (không đọc được).'], warnings };
  }

  const dl = findDeep(doc, 'DLHDon');
  if (!dl) return { invoice: null, errors: ['Không tìm thấy phần tử <DLHDon> — có thể đây không phải file hóa đơn điện tử.'], warnings };

  const tt = child(dl, 'TTChung');
  const nd = child(dl, 'NDHDon');
  const nban = child(nd, 'NBan');
  const nmua = child(nd, 'NMua');
  const ttoan = child(nd, 'TToan');

  const invoice = {
    template: get(tt, 'KHMSHDon'),
    series: get(tt, 'KHHDon'),
    number: String(get(tt, 'SHDon')).replace(/^0+(?=\d)/, ''),
    date: (get(tt, 'NLap') || '').slice(0, 10),
    currency: get(tt, 'DVTTe') || 'VND',
    exchangeRate: parseNumber(get(tt, 'TGia')) || 1,
    paymentMethod: PAYMENT_METHOD[get(tt, 'HTTToan')] || get(tt, 'HTTToan'),
    invoiceName: get(tt, 'THDon'),
    invoiceCode: (findDeep(doc, 'MCCQT')?.textContent || '').trim(),
    sellerName: get(nban, 'Ten'),
    sellerTax: get(nban, 'MST'),
    sellerAddress: get(nban, 'DChi'),
    sellerPhone: get(nban, 'SDThoai'),
    sellerBank: [get(nban, 'STKNHang'), get(nban, 'TNHang')].filter(Boolean).join(' – '),
    buyerName: get(nmua, 'Ten') || get(nmua, 'HVTNMHang'),
    buyerTax: get(nmua, 'MST'),
    buyerAddress: get(nmua, 'DChi'),
    buyerPhone: get(nmua, 'SDThoai'),
    net: parseNumber(get(ttoan, 'TgTCThue')),
    vat: parseNumber(get(ttoan, 'TgTThue')),
    total: parseNumber(get(ttoan, 'TgTTTBSo')),
    totalInWords: get(ttoan, 'TgTTTBChu'),
    status: 1,
    codeStatus: '',
    items: [],
    taxBreakdown: [],
    hasSignature: !!findDeep(doc, 'Signature') || !!findDeep(doc, 'DSCKS'),
    source: 'xml',
    hasXml: true,
  };
  invoice.codeStatus = invoice.invoiceCode ? 'coma' : 'khongma';

  // Hàng hóa dịch vụ
  for (const it of kids(child(nd, 'DSHHDVu'), 'HHDVu')) {
    invoice.items.push({
      stt: get(it, 'STT'),
      kind: Number(get(it, 'TChat')) || 1, // 1 hàng hóa · 2 khuyến mại · 3 chiết khấu · 4 ghi chú
      code: get(it, 'MHHDVu'),
      name: get(it, 'THHDVu'),
      unit: get(it, 'DVTinh'),
      qty: parseNumber(get(it, 'SLuong')),
      price: parseNumber(get(it, 'DGia')),
      discount: parseNumber(get(it, 'STCKhau')),
      amount: parseNumber(get(it, 'ThTien')),
      rate: taxRateKey(get(it, 'TSuat')),
      tax: parseNumber(get(it, 'TThue')),
    });
  }

  // Thuế theo từng thuế suất
  for (const l of kids(child(ttoan, 'THTTLTSuat'), 'LTSuat')) {
    invoice.taxBreakdown.push({ rate: taxRateKey(get(l, 'TSuat')), base: parseNumber(get(l, 'ThTien')), tax: parseNumber(get(l, 'TThue')) });
  }

  // ---- Kiểm tra
  if (!invoice.number) errors.push('Thiếu số hóa đơn (SHDon).');
  if (!invoice.date) errors.push('Thiếu ngày lập (NLap).');
  if (!invoice.sellerTax) errors.push('Thiếu MST người bán.');
  if (errors.length) return { invoice: null, errors, warnings };

  if (!isValidTaxCode(invoice.sellerTax)) warnings.push(`MST người bán "${invoice.sellerTax}" không đúng định dạng.`);
  if (invoice.buyerTax && !isValidTaxCode(invoice.buyerTax)) warnings.push(`MST người mua "${invoice.buyerTax}" không đúng định dạng.`);
  if (!invoice.hasSignature) warnings.push('Không thấy chữ ký số trong file XML.');

  const tol = invoice.currency === 'VND' ? 2 : 0.05;
  if (Math.abs(invoice.net + invoice.vat - invoice.total) > tol * 2) {
    warnings.push(`Tổng tiền (${invoice.total}) khác Tiền chưa thuế + Thuế (${invoice.net + invoice.vat}).`);
  }
  if (invoice.taxBreakdown.length) {
    const sb = invoice.taxBreakdown.reduce((a, x) => a + x.base, 0);
    const st = invoice.taxBreakdown.reduce((a, x) => a + x.tax, 0);
    if (Math.abs(sb - invoice.net) > tol * invoice.taxBreakdown.length + 1) warnings.push('Tổng "thành tiền chưa thuế" theo thuế suất khác tổng tiền chưa thuế của hóa đơn.');
    if (Math.abs(st - invoice.vat) > tol * invoice.taxBreakdown.length + 1) warnings.push('Tổng thuế theo thuế suất khác tổng tiền thuế của hóa đơn.');
  }
  if (invoice.items.length) {
    const goods = invoice.items.reduce((a, x) => a + (x.kind === 3 ? -x.amount : x.kind === 4 ? 0 : x.amount), 0);
    if (invoice.net && Math.abs(goods - invoice.net) > tol * invoice.items.length + 1) warnings.push(`Tổng thành tiền các dòng hàng (${goods}) khác tiền chưa thuế (${invoice.net}).`);
  }

  return { invoice, errors, warnings };
}

/** Định dạng lại XML cho dễ đọc (thụt lề). */
export function prettyXml(text) {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return text;
    const out = [];
    const walk = (n, depth) => {
      const pad = '  '.repeat(depth);
      if (n.nodeType === 3) { const t = n.nodeValue.trim(); if (t) out[out.length - 1] += t; return; }
      if (n.nodeType !== 1) return;
      const attrs = [...n.attributes].map((a) => ` ${a.name}="${a.value}"`).join('');
      const hasEl = [...n.childNodes].some((c) => c.nodeType === 1);
      if (!hasEl) {
        const txt = n.textContent.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;');
        out.push(`${pad}<${n.nodeName}${attrs}>${txt}</${n.nodeName}>`);
        return;
      }
      out.push(`${pad}<${n.nodeName}${attrs}>`);
      for (const c of n.childNodes) walk(c, depth + 1);
      out.push(`${pad}</${n.nodeName}>`);
    };
    walk(doc.documentElement, 0);
    return out.join('\n');
  } catch { return text; }
}
