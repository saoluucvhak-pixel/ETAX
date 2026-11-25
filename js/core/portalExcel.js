/**
 * portalExcel.js — Đọc HÀNG LOẠT các tệp Excel xuất từ trang cổng Thuế (mua vào, bán ra, máy tính tiền…) trong một lượt.
 * Với mỗi sheet: tự dò dòng tiêu đề và cột, tự nhận CHIỀU (đầu vào / đầu ra) bằng cách so MST doanh nghiệp với cột
 * MST người bán / người mua, và tính kỳ (ngày sớm nhất → muộn nhất). Chỉ chứa phép tính thuần.
 */
import { autoMapColumns, fromExcelRow, EXCEL_FIELDS } from './normalizer.js';
import { findHeaderRow, normTax } from './reconcile.js';
import { dedupe } from '../utils.js';

const REQUIRED = ['date', 'number'];

/** Ghép từng dòng thành object {khóa: giá trị} theo bản đồ cột. */
const mapRow = (row, map) => Object.fromEntries(EXCEL_FIELDS.filter((f) => map[f.key] !== undefined).map((f) => [f.key, row[map[f.key]]]));

/**
 * @param {{fileName:string, sheets:{name:string, rows:any[][]}[]}[]} files
 * @param {string} companyTax
 * @returns {object[]} mỗi sheet một mục {fileName, sheet, ok, reason?, direction, sure, mapped[], count, from, to}
 */
export function parsePortalFiles(files, companyTax) {
  const me = normTax(companyTax);
  const out = [];
  for (const { fileName, sheets } of files) {
    for (const { name, rows } of sheets) {
      const entry = { fileName, sheet: name, ok: false, direction: 'in', sure: false, mapped: [], count: 0, from: '', to: '' };
      out.push(entry);
      if (!rows.length) { entry.reason = 'Sheet trống'; continue; }
      const hr = findHeaderRow(rows);
      const map = autoMapColumns(rows[hr].map((c) => String(c ?? '').trim()));
      const miss = REQUIRED.filter((k) => map[k] === undefined);
      if (miss.length || (map.total === undefined && map.net === undefined)) {
        entry.reason = `Không thấy cột ${[...miss.map((k) => EXCEL_FIELDS.find((f) => f.key === k).label), ...(map.total === undefined && map.net === undefined ? ['tiền'] : [])].join(', ')}`;
        continue;
      }
      entry.mapped = rows.slice(hr + 1).filter((r) => r.some((c) => String(c ?? '').trim() !== '')).map((r) => mapRow(r, map));
      // Nhận chiều: doanh nghiệp là người bán → đầu ra; là người mua → đầu vào
      let asSeller = 0; let asBuyer = 0;
      for (const m of entry.mapped) {
        if (me && normTax(m.sellerTax) === me) asSeller++;
        if (me && normTax(m.buyerTax) === me) asBuyer++;
      }
      entry.sure = asSeller !== asBuyer;
      entry.direction = asSeller > asBuyer ? 'out' : 'in';
      entry.ok = true;
      Object.assign(entry, summarize(entry, companyTax));
    }
  }
  return out;
}

/** Chuyển các dòng đã ghép cột thành hóa đơn theo chiều đang chọn (gọi lại khi người dùng đổi chiều). */
export function invoicesOf(entry, companyTax, direction = entry.direction) {
  return dedupe(entry.mapped.map((m) => fromExcelRow(m, { companyTax, direction })).filter(Boolean), (i) => i.key);
}

function summarize(entry, companyTax) {
  const list = invoicesOf(entry, companyTax);
  const ds = list.map((i) => i.date).filter(Boolean).sort();
  return { count: list.length, from: ds[0] || '', to: ds.at(-1) || '' };
}

/** Tính lại số hóa đơn và kỳ khi đổi chiều. */
export const refresh = (entry, companyTax, direction) => { entry.direction = direction; Object.assign(entry, summarize(entry, companyTax)); };
