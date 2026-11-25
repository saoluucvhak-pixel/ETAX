/**
 * invoiceStore.js — Bộ nhớ đệm hóa đơn trong RAM + truy vấn/tìm kiếm cực nhanh.
 *
 * Vì sao cần: IndexedDB tốt cho lưu trữ nhưng chậm khi lọc/tìm liên tục. Ta nạp hóa đơn của
 * doanh nghiệp đang chọn vào RAM một lần, dựng sẵn chuỗi tìm kiếm đã bỏ dấu cho từng hóa đơn
 * (thuộc tính không liệt kê `_q`, không bị ghi ngược xuống CSDL) rồi lọc bằng vòng lặp thuần.
 * Hàng chục nghìn hóa đơn vẫn lọc dưới vài chục mili-giây.
 */
import { repos } from '../storage.js';
import { bus, state } from './state.js';
import { normalizeText } from '../utils.js';
import { logger } from '../logger.js';

const cache = new Map(); // companyTax → Invoice[]

function indexOne(inv) {
  const q = normalizeText([
    inv.number, inv.series, inv.template, inv.sellerTax, inv.sellerName, inv.buyerTax, inv.buyerName,
    inv.invoiceCode, inv.total, inv.note, (inv.tags || []).join(' '),
  ].join(' '));
  Object.defineProperty(inv, '_q', { value: q, enumerable: false, writable: true, configurable: true });
  return inv;
}

/** Nạp (có cache) toàn bộ hóa đơn của một doanh nghiệp. */
export async function loadInvoices(tax = state.companyTax, { force = false } = {}) {
  if (!tax) return [];
  if (!force && cache.has(tax)) return cache.get(tax);
  const list = (await repos.invoices.listByCompany(tax)).map(indexOne);
  list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number), undefined, { numeric: true }));
  cache.set(tax, list);
  return list;
}

export const invalidate = (tax) => (tax ? cache.delete(tax) : cache.clear());

bus.on('invoices:change', ({ companyTax } = {}) => invalidate(companyTax));

/**
 * Lọc danh sách. Tất cả tiêu chí là tùy chọn và kết hợp bằng AND.
 * @param {object} f
 *   direction 'in'|'out'   from/to 'YYYY-MM-DD'   q (nhiều từ, AND, không phân biệt dấu)
 *   status number[]        codeStatus 'coma'|'khongma'
 *   series, number, taxCode, name (chứa)          minTotal, maxTotal
 *   counted true → loại hóa đơn hủy/bị thay thế
 */
export function filterInvoices(list, f = {}) {
  const tokens = f.q ? normalizeText(f.q).split(/\s+/).filter(Boolean) : [];
  const series = f.series ? normalizeText(f.series) : '';
  const number = f.number ? String(f.number).trim() : '';
  const tax = f.taxCode ? String(f.taxCode).trim() : '';
  const name = f.name ? normalizeText(f.name) : '';
  const statuses = f.status?.length ? new Set(f.status.map(Number)) : null;
  const out = [];
  for (const inv of list) {
    if (f.direction && inv.direction !== f.direction) continue;
    if (f.from && inv.date < f.from) continue;
    if (f.to && inv.date > f.to) continue;
    if (statuses && !statuses.has(inv.status)) continue;
    if (f.codeStatus && inv.codeStatus !== f.codeStatus) continue;
    if (f.counted && (inv.status === 4 || inv.status === 6)) continue;
    if (series && !normalizeText(inv.series).includes(series)) continue;
    if (number && !String(inv.number).includes(number)) continue;
    if (tax && !(inv.sellerTax?.includes(tax) || inv.buyerTax?.includes(tax))) continue;
    if (name && !(normalizeText(inv.sellerName).includes(name) || normalizeText(inv.buyerName).includes(name))) continue;
    if (f.minTotal != null && f.minTotal !== '' && inv.total < Number(f.minTotal)) continue;
    if (f.maxTotal != null && f.maxTotal !== '' && inv.total > Number(f.maxTotal)) continue;
    if (tokens.length) {
      const q = inv._q ?? indexOne(inv)._q;
      let ok = true;
      for (const t of tokens) if (!q.includes(t)) { ok = false; break; }
      if (!ok) continue;
    }
    out.push(inv);
  }
  return out;
}

// ---------------------------------------------------------------- Ghi dữ liệu (kèm phát sự kiện)

const notify = (tax) => bus.emit('invoices:change', { companyTax: tax });

/** Thêm/cập nhật hóa đơn; trả về {added, updated}. */
export async function saveInvoices(list, tax = state.companyTax) {
  const r = await repos.invoices.upsertMany(list);
  notify(tax);
  return r;
}

export async function updateInvoice(inv) {
  await repos.invoices.put(inv);
  notify(inv.companyTax);
}

export async function deleteInvoices(keys, tax = state.companyTax) {
  await repos.invoices.bulkDelete(keys);
  for (const k of keys) { await repos.files.delete(`${k}#xml`); await repos.files.delete(`${k}#pdf`); }
  notify(tax);
  await logger.info('system', `Đã xóa ${keys.length} hóa đơn khỏi CSDL cục bộ`, { count: keys.length });
}

export async function clearCompanyData(tax) {
  const n = await repos.invoices.deleteByCompany(tax);
  await repos.syncState.delete(`${tax}|in`);
  await repos.syncState.delete(`${tax}|out`);
  notify(tax);
  return n;
}
