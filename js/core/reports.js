/**
 * reports.js — Các phép tổng hợp thuần (không đụng DOM/CSDL) để dùng chung cho Dashboard,
 * Báo cáo, Khách hàng/Nhà cung cấp và xuất Excel.
 *
 * Quy ước: hóa đơn "hủy" (6) và "đã bị thay thế" (4) KHÔNG được tính vào doanh số/thuế
 * (xem INVOICE_STATUS.counted trong config.js). Hóa đơn điều chỉnh giảm có giá trị âm được cộng đúng dấu.
 */
import { DIRECTION, INVOICE_STATUS, TAX_RATES, TAX_RATE_LABEL } from '../config.js';
import { isCounted } from './normalizer.js';
import { monthKey, quarterKey, yearKey, sum } from '../utils.js';

const counted = (list, exclude = true) => (exclude ? list.filter(isCounted) : list);

/** Tổng số lượng / tiền của một danh sách. */
export function summarize(list, exclude = true) {
  const l = counted(list, exclude);
  return { count: l.length, net: sum(l, (x) => x.net), vat: sum(l, (x) => x.vat), total: sum(l, (x) => x.total) };
}

const keyFns = { month: monthKey, quarter: quarterKey, year: yearKey };

/**
 * Thống kê theo kỳ, mỗi dòng gồm cả đầu ra và đầu vào.
 * @param {'month'|'quarter'|'year'} granularity
 */
export function byPeriod(list, granularity = 'month', exclude = true) {
  const kf = keyFns[granularity];
  const map = new Map();
  for (const inv of counted(list, exclude)) {
    const k = kf(inv.date);
    if (!k) continue;
    if (!map.has(k)) map.set(k, { period: k, outCount: 0, outNet: 0, outVat: 0, outTotal: 0, inCount: 0, inNet: 0, inVat: 0, inTotal: 0 });
    const r = map.get(k);
    const p = inv.direction === DIRECTION.OUT ? 'out' : 'in';
    r[`${p}Count`] += 1;
    r[`${p}Net`] += inv.net;
    r[`${p}Vat`] += inv.vat;
    r[`${p}Total`] += inv.total;
  }
  return [...map.values()].sort((a, b) => a.period.localeCompare(b.period)).map((r) => ({ ...r, vatPayable: r.outVat - r.inVat }));
}

/** Lấp các kỳ tháng trống trong [from, to] để biểu đồ liên tục. */
export function fillMonths(rows, from, to) {
  const have = new Map(rows.map((r) => [r.period, r]));
  const out = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ey, em] = to.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    out.push(have.get(k) || { period: k, outCount: 0, outNet: 0, outVat: 0, outTotal: 0, inCount: 0, inNet: 0, inVat: 0, inTotal: 0, vatPayable: 0 });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** Bảng phân tích thuế theo thuế suất. Trả về {rows, totals}. */
export function vatByRate(list, exclude = true) {
  const acc = Object.fromEntries(TAX_RATES.map((r) => [r, { rate: r, label: TAX_RATE_LABEL[r], outBase: 0, outTax: 0, inBase: 0, inTax: 0 }]));
  for (const inv of counted(list, exclude)) {
    const lines = inv.taxBreakdown?.length ? inv.taxBreakdown : [{ rate: 'khac', base: inv.net, tax: inv.vat }];
    for (const l of lines) {
      const row = acc[TAX_RATES.includes(l.rate) ? l.rate : 'khac'];
      if (inv.direction === DIRECTION.OUT) { row.outBase += l.base; row.outTax += l.tax; } else { row.inBase += l.base; row.inTax += l.tax; }
    }
  }
  const rows = Object.values(acc).filter((r) => r.outBase || r.outTax || r.inBase || r.inTax);
  const totals = rows.reduce((t, r) => ({ outBase: t.outBase + r.outBase, outTax: t.outTax + r.outTax, inBase: t.inBase + r.inBase, inTax: t.inTax + r.inTax }), { outBase: 0, outTax: 0, inBase: 0, inTax: 0 });
  return { rows, totals: { ...totals, payable: totals.outTax - totals.inTax } };
}

/**
 * Tổng hợp theo đối tác.
 * @param {'customers'|'suppliers'} kind khách hàng = người mua trên HĐ đầu ra; NCC = người bán trên HĐ đầu vào
 */
export function partnerStats(list, kind, exclude = true) {
  const dir = kind === 'customers' ? DIRECTION.OUT : DIRECTION.IN;
  const map = new Map();
  for (const inv of counted(list, exclude)) {
    if (inv.direction !== dir) continue;
    const tax = kind === 'customers' ? inv.buyerTax : inv.sellerTax;
    const name = kind === 'customers' ? inv.buyerName : inv.sellerName;
    const address = kind === 'customers' ? inv.buyerAddress : inv.sellerAddress;
    const key = tax || `#${name}`; // khách lẻ không có MST gom theo tên
    if (!map.has(key)) map.set(key, { tax: tax || '', name: name || '(Không rõ tên)', address: address || '', count: 0, net: 0, vat: 0, total: 0, first: inv.date, last: inv.date });
    const r = map.get(key);
    r.count++; r.net += inv.net; r.vat += inv.vat; r.total += inv.total;
    if (inv.date < r.first) r.first = inv.date;
    if (inv.date > r.last) { r.last = inv.date; if (name) r.name = name; }
    if (!r.address && address) r.address = address;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/** Phân bố theo trạng thái hóa đơn. */
export function statusBreakdown(list) {
  const map = new Map();
  for (const inv of list) map.set(inv.status, (map.get(inv.status) || 0) + 1);
  return [...map.entries()].map(([s, count]) => ({ status: Number(s), label: INVOICE_STATUS[s]?.label || `Trạng thái ${s}`, count })).sort((a, b) => b.count - a.count);
}

/** Nhóm doanh nghiệp theo tổng tiền, gộp phần còn lại vào "Khác" (dùng cho biểu đồ tròn). */
export function topN(rows, n, valueKey = 'total', labelKey = 'name') {
  const top = rows.slice(0, n).map((r) => ({ label: r[labelKey], value: r[valueKey] }));
  const rest = sum(rows.slice(n), (r) => r[valueKey]);
  if (rest > 0) top.push({ label: 'Khác', value: rest });
  return top;
}

/** Tên kỳ hiển thị: "2024-05" → "05/2024", "2024-Q2" → "Quý 2/2024". */
export function periodLabel(p) {
  if (/^\d{4}-Q\d$/.test(p)) return `Quý ${p.slice(-1)}/${p.slice(0, 4)}`;
  if (/^\d{4}-\d{2}$/.test(p)) return `${p.slice(5)}/${p.slice(0, 4)}`;
  return p;
}
