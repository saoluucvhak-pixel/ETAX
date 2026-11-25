/**
 * utils.js — Hàm tiện ích dùng chung: định dạng, ngày tháng, DOM, tải file, CSV…
 * Không phụ thuộc module nào khác để tránh vòng lặp import.
 */

// ---------------------------------------------------------------- Định dạng

const nfVN = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const nfInt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/** Định dạng số tiền kiểu Việt Nam: 1.234.567 */
export const fmtMoney = (n) => (n == null || n === '' || Number.isNaN(Number(n)) ? '' : nfVN.format(Number(n)));
export const fmtInt = (n) => (n == null || Number.isNaN(Number(n)) ? '' : nfInt.format(Number(n)));

/** Rút gọn số tiền lớn cho biểu đồ / thẻ KPI: 1,2 tỷ · 350 tr */
export function fmtCompact(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const f = (x, s) => `${(x).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} ${s}`;
  if (a >= 1e9) return f(v / 1e9, 'tỷ');
  if (a >= 1e6) return f(v / 1e6, 'tr');
  if (a >= 1e3) return f(v / 1e3, 'k');
  return nfInt.format(v);
}

export const fmtPercent = (x, digits = 1) => `${(x * 100).toFixed(digits).replace('.', ',')}%`;

export function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

// ---------------------------------------------------------------- Ngày tháng
// Toàn bộ ngày lưu dạng chuỗi ISO "YYYY-MM-DD" (so sánh chuỗi = so sánh ngày).

const pad = (n) => String(n).padStart(2, '0');

/** Date → "YYYY-MM-DD" theo giờ địa phương. */
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => toISODate(new Date());

/**
 * Nhận nhiều dạng: "2024-05-31", "31/05/2024", "2024-05-31T00:00:00", Date, số serial Excel.
 * @returns {string} ISO date hoặc '' nếu không hợp lệ.
 */
export function parseDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : toISODate(v);
  if (typeof v === 'number') return excelSerialToISO(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToISO(Number(s));
  return '';
}

export function excelSerialToISO(serial) {
  if (!Number.isFinite(serial) || serial < 1) return '';
  const ms = Math.round((serial - 25569) * 86400000); // 25569 = 1970-01-01
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isoToExcelSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569;
}

/** "2024-05-31" → "31/05/2024" */
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtRelative(ts) {
  if (!ts) return 'chưa bao giờ';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

/** Khoảng thời gian (mili giây) → chuỗi ngắn gọn: "45 giây" / "3 phút" / "1 giờ 5 phút". Dùng cho ETA. */
export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} giây`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM ? `${h} giờ ${remM} phút` : `${h} giờ`;
}

/**
 * Dòng "tốc độ + ETA" ngắn gọn từ {speed, etaMs} (xem syncSession.js) — dùng làm metaText cho
 * progressPanel().set(...) ở các tiến trình chạy theo lô nhiều hóa đơn (đồng bộ, xuất PDF hàng loạt…).
 */
export function speedEtaText(snap) {
  const parts = [];
  if (snap.speed != null) parts.push(`${snap.speed >= 10 ? Math.round(snap.speed) : snap.speed.toFixed(1)} hóa đơn/giây`);
  if (snap.etaMs != null) parts.push(`còn khoảng ${fmtDuration(snap.etaMs)}`);
  return parts.join(' · ');
}

export const monthKey = (iso) => (iso || '').slice(0, 7); // "2024-05"
export const yearKey = (iso) => (iso || '').slice(0, 4);
export function quarterKey(iso) {
  if (!iso) return '';
  return `${iso.slice(0, 4)}-Q${Math.ceil(Number(iso.slice(5, 7)) / 3)}`;
}

/** Trả về [từ, đến] ISO cho các kỳ nhanh: 'month' | 'lastMonth' | 'quarter' | 'year'. */
export function periodRange(kind, ref = new Date()) {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const last = (yy, mm) => new Date(yy, mm + 1, 0);
  switch (kind) {
    case 'month': return [toISODate(new Date(y, m, 1)), toISODate(last(y, m))];
    case 'lastMonth': return [toISODate(new Date(y, m - 1, 1)), toISODate(last(y, m - 1))];
    case 'quarter': { const q = Math.floor(m / 3) * 3; return [toISODate(new Date(y, q, 1)), toISODate(last(y, q + 2))]; }
    case 'lastQuarter': { const q = Math.floor(m / 3) * 3 - 3; return [toISODate(new Date(y, q, 1)), toISODate(last(y, q + 2))]; }
    case 'year': return [`${y}-01-01`, `${y}-12-31`];
    case 'lastYear': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    default: return [toISODate(new Date(y, m, 1)), toISODate(last(y, m))];
  }
}

/** Chia [from, to] thành các đoạn liên tiếp không quá `maxDays` ngày (theo tháng lịch nếu có thể). */
export function splitDateRange(from, to, maxDays = 31) {
  const out = [];
  let cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end) {
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const cap = new Date(cur.getTime() + (maxDays - 1) * 86400000);
    const stop = new Date(Math.min(end.getTime(), monthEnd.getTime(), cap.getTime()));
    out.push([toISODate(cur), toISODate(stop)]);
    cur = new Date(stop.getTime() + 86400000);
  }
  return out;
}

export const addDays = (iso, n) => toISODate(new Date(new Date(`${iso}T00:00:00`).getTime() + n * 86400000));

// ---------------------------------------------------------------- Chuỗi / tìm kiếm

/** Bỏ dấu tiếng Việt + hạ chữ thường → phục vụ tìm kiếm không phân biệt dấu. */
export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Kiểm tra mã số thuế Việt Nam: 10 số hoặc 10 số-3 số (chi nhánh) hoặc 12 số (CCCD). */
export const isValidTaxCode = (s) => /^(\d{10}(-\d{3})?|\d{12})$/.test(String(s || '').trim());

export const sanitizeFileName = (s) => String(s || 'file').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);

// ---------------------------------------------------------------- Hàm tổng quát

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function debounce(fn, ms = 200) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Chạy tối đa `limit` tác vụ song song. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  if (!items.length) return results;
  let i = 0;
  const concurrency = Math.max(1, Math.min(items.length, Number(limit) || 1));
  const runners = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------- DOM

/**
 * Hyperscript nhỏ gọn: h('div.card#id', {onclick}, child, ...)
 * - `class`/`className`, `dataset`, `style` (object), `on*` (sự kiện), `html` (innerHTML tin cậy).
 */
export function h(tag, props, ...children) {
  const m = /^([a-z0-9-]+)((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m ? m[1] : tag);
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ---------------------------------------------------------------- File / tải xuống

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Mở hộp thoại chọn file. Trả về mảng File (rỗng nếu hủy). */
export function pickFiles({ accept = '', multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export const readText = (file) => file.text();
export const readBuffer = (file) => file.arrayBuffer();

export const b64encode = (u8) => {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode(...u8.subarray(i, i + CH));
  return btoa(s);
};
export const b64decode = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ---------------------------------------------------------------- CSV

/** Chuyển mảng đối tượng thành CSV (có BOM UTF-8 để Excel đọc đúng tiếng Việt). */
export function toCsv(columns, rows, delimiter = ',') {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.header)).join(delimiter)];
  for (const r of rows) lines.push(columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(delimiter));
  return `\uFEFF${lines.join('\r\n')}`;
}

/** Phân tích CSV đơn giản (hỗ trợ ngoặc kép, xuống dòng trong ô). */
export function parseCsv(text, delimiter) {
  const t = text.replace(/^\uFEFF/, '');
  if (!delimiter) {
    const first = t.split(/\r?\n/, 1)[0] || '';
    delimiter = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  }
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

/** Đọc số tiền từ chuỗi kiểu VN ("1.234.567,89") hoặc EN ("1,234,567.89"). */
export function parseNumber(v) {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  let s = String(v).trim().replace(/[^\d,.\-()]/g, '');
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[()-]/g, '');
  const lastC = s.lastIndexOf(',');
  const lastD = s.lastIndexOf('.');
  if (lastC > -1 && lastD > -1) {
    s = lastC > lastD ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastC > -1) {
    s = s.split(',').length > 2 || /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastD > -1 && (s.split('.').length > 2 || /\.\d{3}$/.test(s))) {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : neg ? -n : n;
}

/** Loại phần tử trùng khóa, giữ bản xuất hiện SAU CÙNG (dữ liệu nhập sau ghi đè dữ liệu trước). */
export function dedupe(arr, keyFn) {
  const map = new Map();
  for (const x of arr) map.set(keyFn(x), x);
  return [...map.values()];
}
