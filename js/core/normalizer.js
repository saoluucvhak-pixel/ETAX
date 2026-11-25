/**
 * normalizer.js — Chuẩn hóa mọi nguồn dữ liệu (cổng Thuế, XML, Excel, demo) về MỘT mô hình hóa đơn.
 *
 * Invoice {
 *   key            khóa duy nhất  (MST doanh nghiệp | chiều | MST người bán | mẫu | ký hiệu | số)
 *   companyTax     MST doanh nghiệp sở hữu dữ liệu
 *   direction      'in' (đầu vào) | 'out' (đầu ra)
 *   date           'YYYY-MM-DD' ngày lập
 *   number, series, template
 *   sellerTax/Name/Address · buyerTax/Name/Address
 *   net, vat, total, currency, exchangeRate
 *   status         1..6 (xem INVOICE_STATUS)     processing  mã ttxly
 *   codeStatus     'coma' | 'khongma' | ''
 *   invoiceCode    mã cơ quan thuế (nếu có)
 *   taxBreakdown   [{rate, base, tax}]           items [{stt,name,unit,qty,price,amount,rate,tax,kind}]
 *   source         'gdt' | 'xml' | 'excel' | 'demo'
 *   syncedAt, hasXml, hasPdf, note, tags
 * }
 */
import { INVOICE_STATUS, DIRECTION } from '../config.js';
import { parseNumber, parseDate } from '../utils.js';
import { taxRateKey, PAYMENT_METHOD } from './xmlparser.js';

export function makeInvoiceKey(inv) {
  return [inv.companyTax, inv.direction, inv.sellerTax || '', inv.template || '', inv.series || '', String(inv.number || '').replace(/^0+(?=\d)/, '')].join('|');
}

/** Ngày từ cổng Thuế: "2024-05-31T00:00:00Z" (đã là ngày VN) hoặc UTC lệch múi giờ → quy về ngày VN (+7). */
export function gdtDate(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T00:00:00/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return parseDate(s);
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Hóa đơn có được tính vào doanh số/thuế không (loại hóa đơn hủy và hóa đơn đã bị thay thế). */
export const isCounted = (inv) => INVOICE_STATUS[inv.status]?.counted !== false;

/** Xác định chiều hóa đơn dựa vào MST doanh nghiệp. */
export function inferDirection(inv, companyTax, fallback = DIRECTION.IN) {
  if (companyTax && inv.sellerTax === companyTax && inv.buyerTax !== companyTax) return DIRECTION.OUT;
  if (companyTax && inv.buyerTax === companyTax && inv.sellerTax !== companyTax) return DIRECTION.IN;
  return fallback;
}

const codeStatusOf = (ttxly, code) => {
  if (Number(ttxly) === 5 || code) return 'coma';
  if (Number(ttxly) === 6 || Number(ttxly) === 8) return 'khongma';
  return '';
};

/** Gán các trường còn thiếu (key, syncedAt…) cho một hóa đơn đã ánh xạ. */
export function finalizeInvoice(inv, { companyTax, direction, source }) {
  const out = {
    status: 1, codeStatus: '', currency: 'VND', exchangeRate: 1, items: [], taxBreakdown: [],
    hasXml: false, hasPdf: false, note: '', tags: [], ...inv,
    companyTax, direction: direction || inv.direction, source: source || inv.source || 'gdt', syncedAt: Date.now(),
  };
  out.net = Number(out.net) || 0;
  out.vat = Number(out.vat) || 0;
  out.total = Number(out.total) || out.net + out.vat;
  out.number = String(out.number ?? '').replace(/^0+(?=\d)/, '');
  out.key = makeInvoiceKey(out);
  return out;
}

/** Thuế suất từ chuỗi cổng Thuế ("10%", "KCT"…) hoặc số. */
function rateFromGdt(v) {
  if (typeof v === 'number') return taxRateKey(v > 0 && v < 1 ? v * 100 : v);
  return taxRateKey(v);
}

/** Bản ghi trong danh sách (query/invoices/sold|purchase) → Invoice. Chịu được tên trường thiếu. */
export function fromGdtSummary(raw, { direction, companyTax }) {
  const breakdown = (raw.thttltsuat || []).map((x) => ({ rate: rateFromGdt(x.tsuat), base: parseNumber(x.thtien), tax: parseNumber(x.tthue) }));
  const inv = {
    gdtId: raw.id,
    template: String(raw.khmshdon ?? ''),
    series: raw.khhdon || '',
    number: raw.shdon,
    date: gdtDate(raw.tdlap || raw.nky),
    sellerTax: raw.nbmst || '',
    sellerName: raw.nbten || '',
    sellerAddress: raw.nbdchi || '',
    buyerTax: raw.nmmst || '',
    buyerName: raw.nmten || raw.nmtnmua || '',
    buyerAddress: raw.nmdchi || '',
    net: parseNumber(raw.tgtcthue),
    vat: parseNumber(raw.tgtthue),
    total: parseNumber(raw.tgtttbso),
    totalInWords: raw.tgtttbchu || '',
    currency: raw.dvtte || 'VND',
    exchangeRate: parseNumber(raw.tgia) || 1,
    status: Number(raw.tthai) || 1,
    processing: Number(raw.ttxly) || 0,
    invoiceCode: raw.mhdon || '',
    codeStatus: codeStatusOf(raw.ttxly, raw.mhdon),
    paymentMethod: PAYMENT_METHOD[raw.thtttoan] || raw.thtttoan || '',
    taxBreakdown: breakdown,
  };
  // Cổng không trả breakdown → suy ra một dòng nếu tỷ lệ VAT/tiền chưa thuế khớp một thuế suất phổ biến
  if (!breakdown.length && inv.net) {
    const pct = Math.round((inv.vat / inv.net) * 1000) / 10;
    inv.taxBreakdown = [{ rate: [0, 5, 8, 10].includes(pct) ? String(pct) : 'khac', base: inv.net, tax: inv.vat }];
  }
  return finalizeInvoice(inv, { companyTax, direction, source: 'gdt' });
}

/** Bản ghi chi tiết (query/invoices/detail) → các trường bổ sung (items, taxBreakdown…). */
export function detailFromGdt(raw) {
  const items = (raw.hdhhdvu || []).map((it, i) => ({
    stt: it.stt ?? i + 1,
    kind: Number(it.tchat) || 1,
    name: it.ten || '',
    unit: it.dvtinh || '',
    qty: parseNumber(it.sluong),
    price: parseNumber(it.dgia),
    discount: parseNumber(it.stckhau),
    amount: parseNumber(it.thtien),
    rate: rateFromGdt(it.tsuat),
    tax: parseNumber(it.tthue),
  }));
  const taxBreakdown = (raw.thttltsuat || []).map((x) => ({ rate: rateFromGdt(x.tsuat), base: parseNumber(x.thtien), tax: parseNumber(x.tthue) }));
  return { items, ...(taxBreakdown.length ? { taxBreakdown } : {}), paymentMethod: PAYMENT_METHOD[raw.thtttoan] || raw.thtttoan || '' };
}

/** Kết quả parseInvoiceXml → Invoice (tự suy chiều nếu không truyền). */
export function fromParsedXml(parsed, { companyTax, direction }) {
  const dir = direction || inferDirection(parsed, companyTax);
  return finalizeInvoice(parsed, { companyTax, direction: dir, source: 'xml' });
}

// ---------------------------------------------------------------- Excel

/** Các cột Excel có thể ánh xạ; `aliases` dùng để tự nhận diện tiêu đề. */
export const EXCEL_FIELDS = [
  { key: 'date', label: 'Ngày lập', aliases: ['ngay', 'ngay lap', 'ngay hd', 'ngay hoa don', 'date', 'ngay lap hoa don'] },
  { key: 'number', label: 'Số hóa đơn', aliases: ['so hoa don', 'so hd', 'so', 'so hddt', 'invoice no', 'number'] },
  { key: 'series', label: 'Ký hiệu', aliases: ['ky hieu', 'ky hieu hoa don', 'khhdon', 'series', 'ky hieu hd'] },
  { key: 'template', label: 'Ký hiệu mẫu số', aliases: ['mau so', 'ky hieu mau so', 'khmshdon', 'mau so hd', 'template'] },
  { key: 'sellerTax', label: 'MST người bán', aliases: ['mst nguoi ban', 'mst ben ban', 'mst ncc', 'mst nha cung cap', 'mst nb', 'seller tax'] },
  { key: 'sellerName', label: 'Tên người bán', aliases: ['ten nguoi ban', 'nguoi ban', 'ten ben ban', 'nha cung cap', 'ten ncc', 'ten don vi ban'] },
  { key: 'buyerTax', label: 'MST người mua', aliases: ['mst nguoi mua', 'mst ben mua', 'mst khach hang', 'mst kh', 'mst nm', 'buyer tax'] },
  { key: 'buyerName', label: 'Tên người mua', aliases: ['ten nguoi mua', 'nguoi mua', 'ten khach hang', 'khach hang', 'ten kh', 'ten don vi mua'] },
  { key: 'partnerTax', label: 'MST đối tác', aliases: ['mst', 'ma so thue', 'mst doi tac', 'tax code'] },
  { key: 'partnerName', label: 'Tên đối tác', aliases: ['ten', 'ten doi tac', 'ten don vi', 'doi tac'] },
  { key: 'net', label: 'Tiền chưa thuế', aliases: ['tien chua thue', 'gia tri', 'gia tri chua thue', 'tong tien chua thue', 'thanh tien', 'doanh so', 'net', 'gia tri hhdv chua thue'] },
  { key: 'vat', label: 'Tiền thuế', aliases: ['tien thue', 'thue', 'thue gtgt', 'tong tien thue', 'vat', 'tien thue gtgt'] },
  { key: 'total', label: 'Tổng tiền', aliases: ['tong tien', 'tong tien thanh toan', 'tong cong', 'tong thanh toan', 'total'] },
  { key: 'status', label: 'Trạng thái', aliases: ['trang thai', 'tinh trang', 'status'] },
  { key: 'currency', label: 'Loại tiền', aliases: ['loai tien', 'don vi tien', 'nguyen te', 'currency'] },
  { key: 'invoiceCode', label: 'Mã CQT', aliases: ['ma cqt', 'ma co quan thue', 'ma hoa don', 'mccqt'] },
];

const STATUS_TEXT = [
  [/huy/i, 6], [/bi thay the|da bi thay the/i, 4], [/bi dieu chinh|da bi dieu chinh/i, 5],
  [/dieu chinh/i, 3], [/thay the/i, 2], [/moi|binh thuong/i, 1],
];

export function parseStatusText(v) {
  if (typeof v === 'number' && INVOICE_STATUS[v]) return v;
  const s = String(v ?? '').trim();
  if (/^[1-6]$/.test(s)) return Number(s);
  const norm = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  for (const [re, code] of STATUS_TEXT) if (re.test(norm)) return code;
  return 1;
}

/**
 * Một dòng Excel (đã ánh xạ theo EXCEL_FIELDS) → Invoice.
 * `mapped` là object {key: giá trị}. Trả về null nếu thiếu dữ liệu tối thiểu.
 */
export function fromExcelRow(mapped, { companyTax, direction }) {
  const inv = {
    date: parseDate(mapped.date),
    number: String(mapped.number ?? '').trim(),
    series: String(mapped.series ?? '').trim(),
    template: String(mapped.template ?? '').trim(),
    sellerTax: String(mapped.sellerTax ?? '').trim(),
    sellerName: String(mapped.sellerName ?? '').trim(),
    buyerTax: String(mapped.buyerTax ?? '').trim(),
    buyerName: String(mapped.buyerName ?? '').trim(),
    net: parseNumber(mapped.net),
    vat: parseNumber(mapped.vat),
    total: parseNumber(mapped.total),
    currency: String(mapped.currency || 'VND').trim().toUpperCase(),
    status: mapped.status ? parseStatusText(mapped.status) : 1,
    invoiceCode: String(mapped.invoiceCode ?? '').trim(),
  };
  // Cột "đối tác" tự gán cho bên còn lại theo chiều
  if (mapped.partnerTax || mapped.partnerName) {
    const pt = String(mapped.partnerTax ?? '').trim();
    const pn = String(mapped.partnerName ?? '').trim();
    if (direction === DIRECTION.IN) { inv.sellerTax ||= pt; inv.sellerName ||= pn; } else { inv.buyerTax ||= pt; inv.buyerName ||= pn; }
  }
  // Bên còn lại chính là doanh nghiệp đang làm việc
  if (direction === DIRECTION.IN) inv.buyerTax ||= companyTax; else inv.sellerTax ||= companyTax;
  if (!inv.date || !inv.number) return null;
  inv.codeStatus = inv.invoiceCode ? 'coma' : '';
  if (!inv.taxBreakdown?.length && inv.net) {
    const pct = Math.round((inv.vat / inv.net) * 1000) / 10;
    inv.taxBreakdown = [{ rate: [0, 5, 8, 10].includes(pct) ? String(pct) : 'khac', base: inv.net, tax: inv.vat }];
  }
  return finalizeInvoice(inv, { companyTax, direction, source: 'excel' });
}

/** Chọn cột theo tiêu đề: trả về {fieldKey: chỉ số cột}. */
export function autoMapColumns(headerRow) {
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const heads = headerRow.map(norm);
  const map = {};
  const taken = new Set();
  // Khớp chính xác trước, rồi khớp chứa
  for (const pass of ['exact', 'contains']) {
    for (const f of EXCEL_FIELDS) {
      if (map[f.key] !== undefined) continue;
      const idx = heads.findIndex((h, i) => h && !taken.has(i) && f.aliases.some((a) => (pass === 'exact' ? h === a : h.includes(a) && a.length > 3)));
      if (idx >= 0) { map[f.key] = idx; taken.add(idx); }
    }
  }
  return map;
}
