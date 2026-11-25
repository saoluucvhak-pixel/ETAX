/**
 * backup.js — Sao lưu / khôi phục toàn bộ CSDL cục bộ ra một file JSON.
 *
 * Định dạng: { app:'etax-manager', schemaVersion, createdAt, stores:{ tênStore: [bản ghi…] } }
 * Blob (PDF đính kèm) được mã hóa base64 dạng {__blob:true, mime, b64}.
 * Không sao lưu: mật khẩu (không bao giờ lưu), token phiên, handle thư mục lưu.
 */
import { APP } from '../config.js';
import { repos, database, SCHEMA } from '../storage.js';
import { bus } from './state.js';
import { b64encode, b64decode } from '../utils.js';
import { logger } from '../logger.js';

const SKIP_SETTINGS = new Set(['saveDirHandle']);

async function encodeValue(v) {
  if (v instanceof Blob) return { __blob: true, mime: v.type, b64: b64encode(new Uint8Array(await v.arrayBuffer())) };
  return v;
}

const decodeValue = (v) => (v && v.__blob ? new Blob([b64decode(v.b64)], { type: v.mime }) : v);

/** Tính mã băm SHA-256 (hex) cho toàn bộ dữ liệu stores bằng Web Crypto chuẩn. */
export async function computeBackupSha256(stores) {
  const bytes = new TextEncoder().encode(JSON.stringify(stores || {}));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Kiểm tra cấu trúc và mã toàn vẹn SHA-256 (fail-closed) trước khi chạm vào CSDL. */
export async function validateBackupPayload(data) {
  if (!data || data.app !== 'etax-manager' || !data.stores || typeof data.stores !== 'object' || Array.isArray(data.stores)) {
    throw new Error('Đây không phải file sao lưu hợp lệ của eTax Manager.');
  }
  if (data.schemaVersion > APP.dbVersion) {
    throw new Error('File sao lưu được tạo bởi phiên bản mới hơn. Hãy cập nhật ứng dụng trước.');
  }
  for (const [name, rows] of Object.entries(data.stores)) {
    if (!Array.isArray(rows)) throw new Error(`Dữ liệu bảng "${name}" trong file sao lưu không hợp lệ.`);
  }
  if (data.sha256 != null) {
    const actual = await computeBackupSha256(data.stores);
    if (String(data.sha256).toLowerCase() !== actual) {
      throw new Error('File sao lưu không khớp mã kiểm tra toàn vẹn SHA-256 (có thể đã bị hỏng hoặc chỉnh sửa).');
    }
  }
}

/** Tạo file sao lưu. `stores` giới hạn các store cần sao lưu (mặc định tất cả). */
export async function createBackup({ stores = Object.keys(SCHEMA), onProgress } = {}) {
  const out = { app: 'etax-manager', appVersion: APP.version, schemaVersion: APP.dbVersion, createdAt: new Date().toISOString(), stores: {} };
  let i = 0;
  for (const name of stores) {
    let rows = await repos[name].getAll();
    if (name === 'settings') rows = rows.filter((r) => !SKIP_SETTINGS.has(r.key));
    if (name === 'files') rows = await Promise.all(rows.map(async (r) => ({ ...r, data: await encodeValue(r.data) })));
    out.stores[name] = rows;
    onProgress?.(++i / stores.length, name);
  }
  out.sha256 = await computeBackupSha256(out.stores);
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  await logger.info('backup', `Tạo bản sao lưu (${Object.entries(out.stores).map(([k, v]) => `${k}: ${v.length}`).join(', ')})`, { size: blob.size, sha256: out.sha256 });
  return blob;
}

/**
 * Khôi phục từ file sao lưu.
 * @param {File|Blob} file
 * @param {'merge'|'replace'} mode  merge = ghi đè trùng khóa, giữ dữ liệu khác; replace = xóa hết rồi nạp
 */
export async function restoreBackup(file, { mode = 'merge', onProgress } = {}) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('File sao lưu không đọc được (không phải JSON hợp lệ).'); }
  await validateBackupPayload(data);

  const names = Object.keys(data.stores).filter((n) => repos[n]);
  let restored = 0;
  let i = 0;
  for (const name of names) {
    let rows = data.stores[name];
    if (name === 'files') rows = rows.map((r) => ({ ...r, data: decodeValue(r.data) }));
    if (name === 'logs' && mode === 'merge') rows = rows.map(({ id, ...rest }) => rest);
    if (mode === 'replace') await repos[name].clear();
    await repos[name].bulkPut(rows);
    restored += rows.length;
    onProgress?.(++i / names.length, name);
  }
  bus.emit('invoices:change', {});
  bus.emit('settings:change', {});
  await logger.info('backup', `Khôi phục ${restored.toLocaleString('vi-VN')} bản ghi từ bản sao lưu ${data.createdAt}`, { mode, restored });
  return { restored, stores: names, createdAt: data.createdAt };
}

/** Xóa sạch CSDL rồi tải lại trang (dùng cho "đặt lại ứng dụng"). */
export async function resetEverything() {
  await database.destroy();
  sessionStorage.clear();
  location.reload();
}
