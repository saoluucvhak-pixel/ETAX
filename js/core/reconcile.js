/**
 * reconcile.js — Đối chiếu SỔ QUẢN TRỊ THUẾ GTGT (từ Excel/CSV) với hóa đơn đã tải từ cổng Thuế.
 * Chỉ chứa phép tính thuần (không DOM/CSDL) để dễ kiểm thử.
 *
 * Ghép hóa đơn theo khóa chuẩn hóa (MST | ký hiệu | số hóa đơn):
 *   - MST bỏ ký tự không phải chữ/số; số hóa đơn bỏ số 0 đầu và đuôi ".0"; ký hiệu viết hoa, bỏ chữ số mẫu ở đầu ("1C26TAA" → "C26TAA").
 *   - Đầu vào: MST = người bán. Đầu ra: người bán chính là doanh nghiệp, nên khóa dùng MST doanh nghiệp còn MST đối tác chỉ để kiểm tra chéo.
 *   - Ghép theo thứ bậc: (MST, ký hiệu, số) → (ký hiệu, số) duy nhất → (MST, số) duy nhất khi sổ không có ký hiệu.
 */
import { parseNumber, parseDate, monthKey, normalizeText } from '../utils.js';
import { isCounted } from './normalizer.js';

/** Cột của sổ; `aliases` đã bỏ dấu, dùng để tự nhận theo tiêu đề. */
export const LEDGER_FIELDS = [
  { key: 'date', label: 'Ngày hóa đơn', aliases: ['ngay hoa don', 'ngay lap', 'ngay hd', 'ngay chung tu', 'ngay', 'date'] },
  { key: 'postDate', label: 'Ngày ghi sổ / kỳ kê khai', aliases: ['ngay ghi so', 'ngay hach toan', 'ky ke khai', 'thang ghi so', 'ky thue', 'ky'] },
  { key: 'series', label: 'Ký hiệu', aliases: ['ky hieu hoa don', 'ky hieu', 'ky hieu hd', 'khhdon', 'series', 'mau so ky hieu'] },
  { key: 'number', label: 'Số hóa đơn', aliases: ['so hoa don', 'so hd', 'so chung tu', 'so', 'invoice no', 'number'] },
  { key: 'partnerTax', label: 'MST đối tác', aliases: ['ma so thue', 'mst nguoi ban', 'mst nguoi mua', 'mst ben ban', 'mst ben mua', 'mst ncc', 'mst khach hang', 'mst', 'tax code'] },
  { key: 'partnerName', label: 'Tên đối tác', aliases: ['ten ncc', 'ten kh', 'ten ben ban', 'ten ben mua', 'ten nguoi ban', 'ten nguoi mua', 'ten nha cung cap', 'ten khach hang', 'nguoi ban', 'nguoi mua', 'nha cung cap', 'khach hang', 'ten don vi', 'ten doi tac', 'ten'] },
  { key: 'net', label: 'Tiền chưa thuế', aliases: ['gia tri hhdv mua vao chua co thue', 'gia tri hhdv chua thue', 'doanh so chua thue', 'tien chua thue', 'gia tri chua thue', 'chua thue', 'thanh tien', 'doanh so', 'net'] },
  { key: 'vat', label: 'Tiền thuế', aliases: ['thue gtgt', 'tien thue gtgt', 'tien thue', 'so thue', 'thue', 'vat'] },
  { key: 'total', label: 'Tổng tiền thanh toán', aliases: ['tong tien thanh toan', 'tong thanh toan', 'tong tien', 'tong cong', 'total'] },
  { key: 'rate', label: 'Thuế suất', aliases: ['thue suat', 'ts', 'rate'] },
];

const flat = (s) => normalizeText(String(s ?? '')).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Chọn cột theo tiêu đề: khớp chính xác trước, rồi khớp chứa (bỏ alias quá ngắn). Trả về {khóa: chỉ số cột}. */
export function autoMapFields(header, fields = LEDGER_FIELDS) {
  const heads = header.map(flat);
  const map = {};
  const taken = new Set();
  for (const pass of ['exact', 'contains']) {
    for (const f of fields) {
      if (map[f.key] !== undefined) continue;
      const idx = heads.findIndex((hd, i) => hd && !taken.has(i) && f.aliases.some((a) => (pass === 'exact' ? hd === a : a.length > 4 && hd.includes(a))));
      if (idx >= 0) { map[f.key] = idx; taken.add(idx); }
    }
  }
  return map;
}

// ---------------------------------------------------------------- Chuẩn hóa khóa

export const normTax = (s) => String(s ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
export const normNumber = (v) => String(v ?? '').trim().replace(/\.0+$/, '').replace(/[^0-9A-Za-z]/g, '').replace(/^0+(?=\d)/, '');
export function normSeries(v) {
  const s = String(v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return /^[1-9][A-Z]\d{2}[A-Z]{2,3}$/.test(s) ? s.slice(1) : s;
}
/** Hóa đơn máy tính tiền: ký hiệu dạng C26Mxx / K26Mxx. */
export const isPosSeries = (series) => /^[CK]\d{2}M/.test(normSeries(series));

/** "2026-05-12", "12/05/2026", serial Excel, "05/2026", "T5/2026" → "2026-05" (rỗng nếu không đọc được). */
export function toPeriod(v) {
  if (v == null || v === '') return '';
  const d = parseDate(v);
  if (d) return monthKey(d);
  const m = /(\d{1,2})\s*[/\-.]\s*(\d{4})/.exec(String(v));
  return m ? `${m[2]}-${String(m[1]).padStart(2, '0')}` : '';
}

// ---------------------------------------------------------------- Đọc dòng sổ

/**
 * Chuyển các dòng bảng tính đã ghép cột thành bản ghi sổ. Dòng thiếu số hóa đơn (dòng tổng, dòng trống) bị bỏ qua.
 * @returns {{entries:object[], skipped:number}}
 */
export function readLedger(rows, map) {
  const entries = [];
  let skipped = 0;
  const cell = (r, k) => (map[k] === undefined ? undefined : r[map[k]]);
  rows.forEach((r, i) => {
    const number = normNumber(cell(r, 'number'));
    const date = parseDate(cell(r, 'date')) || '';
    if (!number || !/\d/.test(number)) { skipped++; return; } // dòng tiêu đề phụ, dòng tổng, dòng trống
    let net = map.net === undefined ? null : parseNumber(cell(r, 'net'));
    let vat = map.vat === undefined ? null : parseNumber(cell(r, 'vat'));
    let total = map.total === undefined ? null : parseNumber(cell(r, 'total'));
    if (net === null && vat !== null && total !== null) net = total - vat;
    entries.push({
      row: i, date, period: toPeriod(cell(r, 'postDate')),
      series: normSeries(cell(r, 'series')), number,
      tax: normTax(cell(r, 'partnerTax')), taxRaw: String(cell(r, 'partnerTax') ?? '').trim(),
      name: String(cell(r, 'partnerName') ?? '').trim(),
      net, vat, total, rate: String(cell(r, 'rate') ?? '').trim(),
    });
  });
  return { entries, skipped };
}

/** Cộng gộp các dòng cùng hóa đơn (sổ hay tách dòng theo thuế suất). Giữ số dòng để cảnh báo. */
export function aggregateLedger(entries) {
  const map = new Map();
  for (const e of entries) {
    const k = `${e.tax}|${e.series}|${e.number}`;
    const cur = map.get(k);
    if (!cur) { map.set(k, { ...e, lines: 1, rows: [e.row] }); continue; }
    cur.lines += 1; cur.rows.push(e.row);
    for (const f of ['net', 'vat', 'total']) if (e[f] !== null) cur[f] = (cur[f] ?? 0) + e[f];
    if (!cur.name) cur.name = e.name;
  }
  return [...map.values()];
}

// ---------------------------------------------------------------- Đối chiếu

export const STATUS = Object.freeze({
  match: 'Khớp',
  diff: 'Lệch số tiền',
  date: 'Lệch ngày lập',
  period: 'Lệch kỳ',
  mst: 'Lệch MST',
  cancelled: 'Hủy / bị thay thế',
  missingLedger: 'Có trên cổng, chưa vào sổ',
  missingPortal: 'Có trong sổ, không có trên cổng',
  expected: 'Chênh lệch thường gặp',
  pos: 'Máy tính tiền (ngoài cổng)',
});

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {object[]} ledger  bản ghi sổ (đã cộng gộp hoặc không)
 * @param {object[]} invoices hóa đơn của doanh nghiệp (mọi chiều/kỳ; hàm tự lọc theo direction, from, to)
 * @param {object} o {direction, companyTax, from, to, tolerance=1, keywords=[], onlyLedgerInRange=true}
 */
export function reconcile(ledger, invoices, o) {
  const { direction, companyTax, from, to, tolerance = 1, keywords = [] } = o;
  const tax = normTax(companyTax);
  const inRange = (d) => (!from || (d && d >= from)) && (!to || (d && d <= to));
  const kw = keywords.map(flat).filter(Boolean);

  const portal = invoices.filter((i) => i.direction === direction && inRange(i.date));
  const pKey = (i) => `${direction === 'out' ? tax : normTax(i.sellerTax)}|${normSeries(i.series)}|${normNumber(i.number)}`;
  const p1 = new Map(portal.map((i) => [pKey(i), i]));
  const p2 = new Map();
  const p3 = new Map();
  for (const i of portal) {
    const k2 = `${normSeries(i.series)}|${normNumber(i.number)}`;
    const k3 = `${direction === 'out' ? normTax(i.buyerTax) : normTax(i.sellerTax)}|${normNumber(i.number)}`;
    (p2.get(k2) || p2.set(k2, []).get(k2)).push(i);
    (p3.get(k3) || p3.set(k3, []).get(k3)).push(i);
  }

  const used = new Set();
  const rows = [];
  const scoped = ledger.filter((l) => !l.date || inRange(l.date));

  const take = (l) => {
    const ledTax = direction === 'out' ? tax : l.tax;
    let inv = p1.get(`${ledTax}|${l.series}|${l.number}`);
    let via = 'exact';
    if (!inv || used.has(inv.key)) {
      inv = null;
      const c2 = l.series ? (p2.get(`${l.series}|${l.number}`) || []).filter((i) => !used.has(i.key)) : [];
      if (c2.length === 1) { inv = c2[0]; via = 'series'; } else if (!l.series && l.tax) {
        const c3 = (p3.get(`${l.tax}|${l.number}`) || []).filter((i) => !used.has(i.key));
        if (c3.length === 1) { inv = c3[0]; via = 'noSeries'; }
      }
    }
    return { inv, via };
  };

  for (const l of scoped) {
    const { inv, via } = take(l);
    if (!inv) {
      const pos = isPosSeries(l.series);
      const expected = kw.length && kw.some((k) => flat(l.name).includes(k));
      rows.push(makeRow(pos ? 'pos' : expected ? 'expected' : 'missingPortal', { l, inv: null, notes: pos ? ['Hóa đơn máy tính tiền không nằm trong tệp hóa đơn thường của cổng Thuế'] : expected ? ['Nhóm đối tác đã khai báo là chênh lệch thường gặp'] : ['Không tìm thấy hóa đơn này trên cổng Thuế trong kỳ'] }));
      continue;
    }
    used.add(inv.key);
    const notes = [];
    const fields = [];
    if (l.net !== null && Math.abs(l.net - inv.net) > tolerance) fields.push('net');
    if (l.vat !== null && Math.abs(l.vat - inv.vat) > tolerance) fields.push('vat');
    if (l.total !== null && Math.abs(l.total - inv.total) > tolerance) fields.push('total');
    if (fields.length) notes.push(`Lệch: ${fields.map((f) => ({ net: 'tiền chưa thuế', vat: 'tiền thuế', total: 'tổng tiền' }[f])).join(', ')}`);
    if (via === 'series') notes.push('Ghép theo ký hiệu + số (MST trong sổ khác/thiếu)');
    if (via === 'noSeries') notes.push('Ghép theo MST + số (sổ không có ký hiệu)');
    const partnerPortal = direction === 'out' ? inv.buyerTax : inv.sellerTax;
    const mstBad = l.tax && normTax(partnerPortal) && l.tax !== normTax(partnerPortal);
    if (mstBad) notes.push(`MST sổ ${l.taxRaw} ≠ cổng ${partnerPortal}`);
    const dateBad = l.date && inv.date && l.date !== inv.date;
    if (dateBad) notes.push(`Ngày lập sổ ${l.date} ≠ cổng ${inv.date}`);
    const periodBad = l.period && monthKey(inv.date) !== l.period;
    if (periodBad) notes.push(`Ghi sổ kỳ ${l.period}, hóa đơn lập tháng ${monthKey(inv.date)}`);
    if (l.lines > 1) notes.push(`Cộng gộp ${l.lines} dòng trong sổ`);
    let status = 'match';
    if (!isCounted(inv)) { status = 'cancelled'; notes.unshift('Hóa đơn đã hủy / bị thay thế trên cổng nhưng vẫn còn trong sổ'); } else if (fields.length) status = 'diff';
    else if (periodBad) status = 'period';
    else if (dateBad) status = 'date';
    else if (mstBad) status = 'mst';
    rows.push(makeRow(status, { l, inv, notes }));
  }

  // Có trên cổng, chưa vào sổ (bỏ hóa đơn hủy / bị thay thế)
  for (const inv of portal) {
    if (used.has(inv.key) || !isCounted(inv)) continue;
    rows.push(makeRow('missingLedger', { l: null, inv, notes: ['Có trên cổng Thuế nhưng chưa thấy trong sổ'] }));
  }

  return { rows, summary: summarize(rows, scoped, portal) };
}

function makeRow(status, { l, inv, notes }) {
  const partnerTax = l?.taxRaw || (inv ? (inv.direction === 'out' ? inv.buyerTax : inv.sellerTax) : '');
  const partnerName = l?.name || (inv ? (inv.direction === 'out' ? inv.buyerName : inv.sellerName) : '');
  const led = { net: l?.net ?? null, vat: l?.vat ?? null, total: l?.total ?? null };
  const por = { net: inv?.net ?? null, vat: inv?.vat ?? null, total: inv?.total ?? null };
  const cnt = inv && !isCounted(inv) ? 0 : 1;
  // Có cả hai phía: chênh lệch chỉ tính khi sổ có cột đó. Thiếu một phía: phía vắng coi như 0.
  const dif = (a, b) => (l && inv ? (a === null ? null : round(a - (b ?? 0))) : round((a ?? 0) - (b ?? 0)));
  return {
    id: `${status}|${l ? `L${l.row}` : ''}|${inv?.key || ''}`,
    status, statusLabel: STATUS[status],
    date: l?.date || inv?.date || '', series: l?.series || normSeries(inv?.series), number: l?.number || normNumber(inv?.number),
    partnerTax, partnerName, lines: l?.lines || 0,
    ledNet: led.net, ledVat: led.vat, ledTotal: led.total,
    porNet: por.net, porVat: por.vat, porTotal: por.total,
    difNet: dif(led.net, por.net), difVat: dif(led.vat, por.vat), difTotal: dif(led.total, por.total),
    counted: cnt, note: notes.join('; '), invoice: inv,
  };
}

function summarize(rows, ledger, portal) {
  const by = {};
  for (const k of Object.keys(STATUS)) by[k] = { count: 0, ledVat: 0, porVat: 0, difVat: 0 };
  for (const r of rows) {
    const b = by[r.status];
    b.count += 1; b.ledVat += r.ledVat || 0; b.porVat += r.porVat || 0; b.difVat += r.difVat || 0;
  }
  for (const b of Object.values(by)) for (const k of ['ledVat', 'porVat', 'difVat']) b[k] = round(b[k]);
  const sum = (arr, f) => round(arr.reduce((a, x) => a + (Number(f(x)) || 0), 0));
  const counted = portal.filter(isCounted);
  return {
    by,
    ledgerCount: ledger.length, portalCount: counted.length,
    ledgerVat: sum(ledger, (x) => x.vat), portalVat: sum(counted, (x) => x.vat),
    ledgerNet: sum(ledger, (x) => x.net), portalNet: sum(counted, (x) => x.net),
    diffVat: round(sum(ledger, (x) => x.vat) - sum(counted, (x) => x.vat)),
    diffNet: round(sum(ledger, (x) => x.net) - sum(counted, (x) => x.net)),
  };
}

/** Dòng tiêu đề = dòng đầu tiên (trong 20 dòng đầu) có từ 3 ô chữ trở lên; bỏ qua các dòng tiêu đề báo cáo phía trên. */
export function findHeaderRow(rows) {
  const i = rows.slice(0, 20).findIndex((r) => r.filter((c) => typeof c === 'string' && c.trim()).length >= 3);
  return i < 0 ? 0 : i;
}

/** Thứ tự hiển thị: vấn đề cần xử lý lên trước, dòng khớp xuống cuối. */
export const STATUS_ORDER = ['diff', 'missingPortal', 'missingLedger', 'cancelled', 'period', 'date', 'mst', 'expected', 'pos', 'match'];
