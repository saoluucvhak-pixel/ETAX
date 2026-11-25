/**
 * reconcile3.js — Đối chiếu 3 nguồn thuế GTGT: Sổ sách kế toán ↔ HĐĐT Cục Thuế ↔ Tờ khai 01/GTGT (XML HTKK).
 *
 * Chuyển từ công cụ HTML "Đối chiếu 3 nguồn thuế GTGT" (giữ nguyên các quy tắc đã chỉnh dần):
 *  - Tự dò dòng tiêu đề (10 dòng đầu mỗi sheet) và các cột theo từ khóa; cho ghi đè cột bằng tay; bật/tắt từng sheet.
 *  - Khóa đối chiếu: Số chứng từ (nếu cả hai nguồn có) → Ký hiệu + Số hóa đơn → Số hóa đơn.
 *  - Ký hiệu bỏ chữ số mẫu ở đầu ("1K26TAF" = "K26TAF"). Giá trị = giá trị chưa thuế − chiết khấu.
 *  - Trùng khóa TRONG CÙNG một sheet thì cộng dồn (hóa đơn nhiều dòng hàng); trùng GIỮA các sheet/tệp chỉ lấy một lần
 *    và cảnh báo nếu giá trị khác nhau (tránh nhân đôi khi lỡ dán cùng danh sách nhiều lần).
 *  - Ghép bổ sung theo [Số HĐ + Tên + Ngày] khi chỉ khớp duy nhất 1-1: một bên bỏ trống ký hiệu, hoặc "SAI KÝ HIỆU"
 *    khi hai bên đều có ký hiệu nhưng khác nhau.
 * Chỉ chứa phép tính thuần (trừ parseToKhai dùng DOMParser của trình duyệt).
 */
import { parseNumber } from '../utils.js';
import { isCounted } from './normalizer.js';

// ---------------------------------------------------------------- Từ khóa dò cột

export const KW = {
  ky_hieu: ['ky hieu hoa don', 'ky hieu hd', 'ky hieu'],
  so_hd: ['so hoa don'],
  so_ct: ['so chung tu'],
  ngay: ['ngay lap', 'ngay hoa don', 'ngay chung tu', 'ngay hach toan'],
  ten: ['ten nguoi ban', 'ten nguoi mua', 'khach hang', 'nha cung cap'],
  gia_tri: ['gia tri hhdv mua vao chua co thue', 'doanh so ban chua co thue gtgt', 'tong tien chua thue', 'doanh thu chua thue', 'tong tien hang', 'gia tri hang hoa', 'gia tri'],
  thue: ['thue gtgt', 'tong tien thue'],
  chiet_khau: ['tien chiet khau', 'chiet khau thuong mai', 'chiet khau'],
};

export const FIELD_LABELS = [
  ['ky_hieu', 'Ký hiệu hóa đơn'], ['so_hd', 'Số hóa đơn'], ['so_ct', 'Số chứng từ'], ['ngay', 'Ngày'],
  ['ten', 'Tên đối tác'], ['gia_tri', 'Giá trị chưa thuế'], ['thue', 'Thuế GTGT'], ['chiet_khau', 'Chiết khấu'],
];

export const stripDia = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, (m) => (m === 'đ' ? 'd' : 'D'));
export const norm = (s) => stripDia(String(s || '')).toLowerCase().trim();
const TOL_DUP = 1000; // mức chênh coi là "cùng giá trị" khi trùng khóa giữa các sheet

/**
 * Duyệt theo TỪNG từ khóa trước (từ khóa cụ thể nhất đứng đầu), rồi mới duyệt các cột — tránh nhận nhầm "Ký hiệu MẪU SỐ".
 * `taken`: các cột đã được trường khác nhận, không nhận lại (vd. "Doanh số bán chưa có thuế GTGT" chứa cụm "thuế GTGT"
 * nhưng đã là cột Giá trị, nên cột Thuế phải là cột "Thuế GTGT" riêng).
 */
function timCot(rowNorm, kws, taken) {
  for (const kw of kws) for (let i = 0; i < rowNorm.length; i++) if (!taken.has(i) && rowNorm[i].includes(kw)) return i;
  return -1;
}

/** Dò dòng tiêu đề và vị trí các cột trong 10 dòng đầu. Cần: Số HĐ + (Ký hiệu hoặc Số CT) + ít nhất 2 trong Ngày/Giá trị/Thuế. */
export function timViTriCot(rows) {
  const n = Math.min(10, rows.length);
  for (let r = 0; r < n; r++) {
    const rowNorm = (rows[r] || []).map((c) => norm(c));
    const vt = { dongTieuDe: r };
    const taken = new Set();
    for (const k of Object.keys(KW)) {
      vt[k] = timCot(rowNorm, KW[k], taken);
      if (vt[k] >= 0) taken.add(vt[k]);
    }
    const coDinhDanh = vt.so_hd >= 0 && (vt.ky_hieu >= 0 || vt.so_ct >= 0);
    const soPhu = [vt.ngay, vt.gia_tri, vt.thue].filter((v) => v >= 0).length;
    if (coDinhDanh && soPhu >= 2) return vt;
  }
  return null;
}

// ---------------------------------------------------------------- Chuẩn hóa giá trị

/** Ngày → "dd/mm/yyyy" (ISO, số serial Excel, "d/m/yyyy" đều về cùng một dạng để hai nguồn so khớp được). */
export function formatNgay(v) {
  if (typeof v === 'number' && v > 0) {
    const d = new Date((Math.round(v) - 25569) * 86400000); // serial Excel → ngày UTC, không phụ thuộc múi giờ máy
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }
  if (v == null) return '';
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/.exec(s);
  if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
  return s;
}
/** "dd/mm/yyyy" → "yyyy-mm-dd" (rỗng nếu không đúng dạng). */
export const ngayToISO = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };

export const toNum = (v) => (v === null || v === undefined || v === '' ? 0 : typeof v === 'number' ? v : parseNumber(v));
export const normKeyPart = (v) => { if (v === null || v === undefined) return ''; let s = String(v).trim(); if (/^\d+$/.test(s)) s = String(parseInt(s, 10)); return s.toUpperCase(); };
/** Bỏ chữ số mẫu ở đầu ký hiệu ("1K26TAF" → "K26TAF"). */
export const normalizeKyHieu = (v) => (v === null || v === undefined ? '' : String(v).trim().toUpperCase().replace(/^\d+/, ''));

export function colLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// ---------------------------------------------------------------- Đọc sheet → bản ghi

/** @returns {{banGhi:object[], vt:object, headerRow:any[]}|null} null nếu không dò được cột */
export function docSheet(rows, srcTag, override) {
  const autoVt = timViTriCot(rows);
  if (!autoVt) return null;
  const vt = { ...autoVt, ...(override || {}) };
  const banGhi = [];
  for (let r = autoVt.dongTieuDe + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const soHd = vt.so_hd >= 0 ? row[vt.so_hd] : null;
    const kyHieu = vt.ky_hieu >= 0 ? row[vt.ky_hieu] : null;
    const soCT = vt.so_ct >= 0 ? row[vt.so_ct] : null;
    if (!soHd && !soCT) continue;
    const giaTriTho = vt.gia_tri >= 0 ? toNum(row[vt.gia_tri]) : 0;
    const chietKhau = vt.chiet_khau >= 0 ? toNum(row[vt.chiet_khau]) : 0;
    banGhi.push({
      ky_hieu: kyHieu, so_hd: soHd, so_ct: soCT, ten: vt.ten >= 0 ? row[vt.ten] : '', ngay: vt.ngay >= 0 ? formatNgay(row[vt.ngay]) : '',
      gia_tri: giaTriTho - chietKhau, thue: vt.thue >= 0 ? toNum(row[vt.thue]) : 0, srcTag,
    });
  }
  return { banGhi, vt, headerRow: rows[autoVt.dongTieuDe] || [] };
}

/**
 * Đọc lại toàn bộ theo sheet đang bật và cột đã chọn tay.
 * @param {{fileName:string, sheets:{name:string, rows:any[][]}[]}[]} files
 * @param {Set<string>} enabled  các thẻ `${fileName}::${sheetName}` đang bật
 * @param {object} override  {khóa: chỉ số cột}
 */
export function processSource(files, enabled, override = {}) {
  let banGhi = [];
  const sheetInfo = [];
  let coKyHieu = false;
  let coSoCT = false;
  let sample = null;
  for (const { fileName, sheets } of files) {
    for (const { name, rows } of sheets) {
      const tag = `${fileName}::${name}`;
      if (!enabled.has(tag)) { sheetInfo.push({ name, file: fileName, ok: null, skipped: true }); continue; }
      const res = docSheet(rows, tag, override);
      if (!res) { sheetInfo.push({ name, file: fileName, ok: false }); continue; }
      if (res.vt.ky_hieu >= 0) coKyHieu = true;
      if (res.vt.so_ct >= 0) coSoCT = true;
      sample ||= { headerRow: res.headerRow, vt: res.vt };
      banGhi = banGhi.concat(res.banGhi);
      sheetInfo.push({ name, file: fileName, ok: true, soDong: res.banGhi.length });
    }
  }
  return { banGhi, sheetInfo, coKyHieu, coSoCT, sample };
}

// ---------------------------------------------------------------- Khóa & gộp

export function computeKey(x, mode) {
  if (mode === 'sochungtu') return normKeyPart(x.so_ct);
  if (mode === 'kyhieu') {
    const shd = normKeyPart(x.so_hd);
    if (!shd) return '';
    const kh = normalizeKyHieu(x.ky_hieu);
    return kh ? `${kh}|${shd}` : `~NOKH~${shd}`; // ký hiệu bỏ trống vẫn giữ lại để còn ghép bổ sung
  }
  return normKeyPart(x.so_hd);
}

/** Cộng dồn khi trùng khóa trong CÙNG một sheet; trùng giữa sheet/tệp khác nhau thì chỉ lấy lần đầu. */
export function gopTheoKhoa(banGhi, mode) {
  const perSheet = {};
  for (const x of banGhi) {
    const key = computeKey(x, mode);
    if (!key) continue;
    const bucket = (perSheet[x.srcTag] ||= {});
    bucket[key] ||= { ky_hieu: x.ky_hieu || '', so_hd: x.so_hd || '', so_ct: x.so_ct || '', ten: x.ten, ngay: x.ngay, gia_tri: 0, thue: 0 };
    bucket[key].gia_tri += x.gia_tri;
    bucket[key].thue += x.thue;
  }
  const gop = {};
  let soTrungKhop = 0;
  let soTrungLech = 0;
  for (const bucket of Object.values(perSheet)) {
    for (const [key, rec] of Object.entries(bucket)) {
      if (!gop[key]) { gop[key] = rec; continue; }
      const dv = Math.abs(gop[key].gia_tri - rec.gia_tri);
      const dt = Math.abs(gop[key].thue - rec.thue);
      if (dv <= TOL_DUP && dt <= TOL_DUP) soTrungKhop++; else soTrungLech++;
    }
  }
  return { gop, soTrungKhop, soTrungLech };
}

const nhanDienKey = (x) => (x.ky_hieu ? x.ky_hieu : (x.so_ct || x.so_hd));
const money = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(n));

// ---------------------------------------------------------------- Đối chiếu

export const TRANG_THAI = Object.freeze({
  khop: '✅ Khớp', lech: '🟡 Lệch số tiền', chiSS: '🔴 Chỉ có ở Sổ sách', chiHD: '🔴 Chỉ có ở HĐĐT', saiKH: '⚠️ Sai ký hiệu',
});

/**
 * @param {object[]} ssRec bản ghi sổ sách  @param {object[]} hdRec bản ghi HĐĐT
 * @param {{ss:{coKyHieu,coSoCT}, hd:{coKyHieu,coSoCT}, tol:number}} o
 */
export function doiChieu(ssRec, hdRec, o) {
  const { tol = 1000 } = o;
  let mode; let modeLabel;
  if (o.ss.coSoCT && o.hd.coSoCT) { mode = 'sochungtu'; modeLabel = 'Số chứng từ'; } else if (o.ss.coKyHieu && o.hd.coKyHieu) { mode = 'kyhieu'; modeLabel = 'Ký hiệu + Số hóa đơn'; } else { mode = 'sohd'; modeLabel = 'Số hóa đơn (không có khóa chung tốt hơn)'; }

  const rSS = gopTheoKhoa(ssRec, mode);
  const rHD = gopTheoKhoa(hdRec, mode);
  const gopSS = rSS.gop;
  const gopHD = rHD.gop;
  const keysA = Object.keys(gopSS);
  const keysB = Object.keys(gopHD);
  const setA = new Set(keysA);
  const setB = new Set(keysB);
  const commonKeys = keysA.filter((k) => setB.has(k));
  let onlyAKeys = keysA.filter((k) => !setB.has(k));
  let onlyBKeys = keysB.filter((k) => !setA.has(k));

  let soKhop = 0; let soLech = 0; let soThieu = 0; let soGhepBoSung = 0;
  const ketQua = []; const dsKyHieuSai = []; const dsThieuKyHieu = [];

  function themDong(a, b, mau, ghiChuThem, kyHieuSaiInfo) {
    const lg = Math.abs((a ? a.gia_tri : 0) - (b ? b.gia_tri : 0));
    const lt = Math.abs((a ? a.thue : 0) - (b ? b.thue : 0));
    let trangThai; let ghiChu; let cls;
    if (a && b) {
      if (lg > tol || lt > tol) { trangThai = TRANG_THAI.lech; cls = 'warn'; ghiChu = `Giá trị lệch ${money(lg)}đ, thuế lệch ${money(lt)}đ`; soLech++; } else { trangThai = TRANG_THAI.khop; cls = 'ok'; ghiChu = ''; soKhop++; }
    } else { trangThai = a ? TRANG_THAI.chiSS : TRANG_THAI.chiHD; cls = 'bad'; ghiChu = ''; soThieu++; }
    if (kyHieuSaiInfo) { trangThai = TRANG_THAI.saiKH; cls = 'kyhieusai'; }
    if (ghiChuThem) ghiChu = ghiChu ? `${ghiChu} — ${ghiChuThem}` : ghiChuThem;
    const dong = { hienThi: nhanDienKey(mau), so_hd: mau.so_hd, ten: mau.ten, ngay: mau.ngay, giaTriA: a ? a.gia_tri : null, giaTriB: b ? b.gia_tri : null, thueA: a ? a.thue : null, thueB: b ? b.thue : null, trangThai, ghiChu, cls };
    ketQua.push(dong);
    if (kyHieuSaiInfo) dsKyHieuSai.push({ ...dong, ...kyHieuSaiInfo });
    if (mode === 'kyhieu' && !kyHieuSaiInfo) {
      if (a && !normalizeKyHieu(a.ky_hieu)) dsThieuKyHieu.push({ nguon: 'Sổ sách', so_hd: a.so_hd, ten: a.ten, ngay: a.ngay, gia_tri: a.gia_tri, trangThai });
      if (b && !normalizeKyHieu(b.ky_hieu)) dsThieuKyHieu.push({ nguon: 'HĐĐT', so_hd: b.so_hd, ten: b.ten, ngay: b.ngay, gia_tri: b.gia_tri, trangThai });
    }
  }

  for (const key of commonKeys) themDong(gopSS[key], gopHD[key], gopSS[key]);

  // Ghép bổ sung [Số HĐ + Tên + Ngày] — chỉ khi khớp duy nhất 1-1
  const khoaBoSung = (rec) => { const shd = normKeyPart(rec.so_hd); return shd ? `${shd}|${norm(rec.ten)}|${norm(rec.ngay)}` : ''; };
  {
    const bySoHdA = {}; const bySoHdB = {};
    for (const k of onlyAKeys) { const kk = khoaBoSung(gopSS[k]); if (kk) (bySoHdA[kk] = bySoHdA[kk] || []).push(k); }
    for (const k of onlyBKeys) { const kk = khoaBoSung(gopHD[k]); if (kk) (bySoHdB[kk] = bySoHdB[kk] || []).push(k); }
    const daGhepA = new Set(); const daGhepB = new Set();
    for (const kk of Object.keys(bySoHdA)) {
      if (!(bySoHdB[kk] && bySoHdA[kk].length === 1 && bySoHdB[kk].length === 1)) continue;
      const ka = bySoHdA[kk][0]; const kb = bySoHdB[kk][0];
      daGhepA.add(ka); daGhepB.add(kb); soGhepBoSung++;
      const khA = normalizeKyHieu(gopSS[ka].ky_hieu); const khB = normalizeKyHieu(gopHD[kb].ky_hieu);
      if (khA && khB && khA !== khB) {
        themDong(gopSS[ka], gopHD[kb], gopSS[ka], `SAI KÝ HIỆU — sổ sách ghi "${gopSS[ka].ky_hieu}", HĐĐT ghi "${gopHD[kb].ky_hieu}"`, { kyHieuSS: gopSS[ka].ky_hieu, kyHieuHD: gopHD[kb].ky_hieu });
      } else themDong(gopSS[ka], gopHD[kb], gopSS[ka], 'Ghép theo Số hóa đơn + Tên người bán + Ngày (1 bên thiếu Ký hiệu)');
    }
    onlyAKeys = onlyAKeys.filter((k) => !daGhepA.has(k));
    onlyBKeys = onlyBKeys.filter((k) => !daGhepB.has(k));
  }

  for (const k of onlyAKeys) themDong(gopSS[k], null, gopSS[k]);
  for (const k of onlyBKeys) themDong(null, gopHD[k], gopHD[k]);
  const rank = (c) => (c === 'bad' ? 0 : c === 'kyhieusai' ? 1 : c === 'warn' ? 2 : 3);
  ketQua.sort((x, y) => rank(x.cls) - rank(y.cls));

  const tong = (g) => ({ gia_tri: Object.values(g).reduce((s, x) => s + x.gia_tri, 0), thue: Object.values(g).reduce((s, x) => s + x.thue, 0) });
  return { modeLabel, ketQua, soKhop, soLech, soThieu, soGhepBoSung, dsKyHieuSai, dsThieuKyHieu, tongSS: tong(gopSS), tongHD: tong(gopHD), canhBaoTrungLech: rSS.soTrungLech + rHD.soTrungLech };
}

// ---------------------------------------------------------------- Tờ khai XML (HTKK) & chỉ tiêu

/** Đọc tờ khai 01/GTGT XML từ HTKK. Trả về null nếu XML không hợp lệ. */
export function parseToKhai(xmlText) {
  const xmlDoc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (xmlDoc.querySelector('parsererror')) return null;
  const timTag = (tag) => {
    let els = xmlDoc.getElementsByTagNameNS('*', tag);
    if (els.length) return els[0].textContent.trim();
    els = xmlDoc.getElementsByTagName(tag);
    return els.length ? els[0].textContent.trim() : null;
  };
  const get = (tag) => { const v = timTag(tag); return v === null ? null : toNum(v); };
  const ct = {};
  for (const n of [23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]) ct[`ct${n}`] = get(`ct${n}`);
  return {
    mst: timTag('mst'), ten: timTag('tenNNT'), ky: timTag('kyKKhai'), tuNgay: timTag('kyKKhaiTuNgay'), denNgay: timTag('kyKKhaiDenNgay'),
    ngayLap: timTag('ngayLapTKhai'), nguoiKy: timTag('nguoiKy'), soLan: timTag('soLan'), ...ct,
  };
}

/** Các cặp thẻ (giá trị, thuế) có thể dùng làm chỉ tiêu. Mặc định: mua vào ct23/ct24; bán ra ct27/ct28 (nếu thiếu thì ct34/ct35). */
export const CHI_TIEU_OPTIONS = [['ct23|ct24', 'ct23 / ct24 (mua vào trong nước)'], ['ct27|ct28', 'ct27 / ct28 (bán ra chịu thuế)'], ['ct34|ct35', 'ct34 / ct35 (tổng doanh thu / thuế bán ra)']];

export function chiTieu(tk, loai, chosen) {
  if (!tk) return null;
  if (chosen) { const [g, t] = chosen.split('|'); return { tag: chosen.replace('|', ' / '), gia_tri: tk[g], thue: tk[t] }; }
  if (loai === 'mua') return { tag: 'ct23 / ct24', gia_tri: tk.ct23, thue: tk.ct24 };
  return { tag: 'ct27 / ct28', gia_tri: tk.ct27 ?? tk.ct34, thue: tk.ct28 ?? tk.ct35 };
}

// ---------------------------------------------------------------- Nguồn HĐĐT từ dữ liệu đã đồng bộ

/**
 * Chuyển hóa đơn đã đồng bộ thành bản ghi như đọc từ Excel. Chỉ lấy đúng chiều, trong kỳ [from,to] (ISO), bỏ hóa đơn hủy / bị thay thế.
 */
export function recordsFromInvoices(invoices, { direction, from, to }) {
  const out = [];
  for (const i of invoices) {
    if (i.direction !== direction || !isCounted(i)) continue;
    if ((from && i.date < from) || (to && i.date > to)) continue;
    out.push({
      ky_hieu: i.series || '', so_hd: i.number, so_ct: null, ten: (direction === 'in' ? i.sellerName : i.buyerName) || '',
      ngay: formatNgay(i.date), gia_tri: i.net || 0, thue: i.vat || 0, srcTag: 'Dữ liệu đã đồng bộ',
    });
  }
  return out;
}
