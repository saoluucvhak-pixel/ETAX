/**
 * logger.js — Nhật ký thao tác.
 *
 * Ghi: đăng nhập, đồng bộ, tìm kiếm, xuất dữ liệu, lỗi, thời gian thực hiện.
 * Mỗi bản ghi: { ts, level, type, message, meta, companyTax, durationMs }
 * Lưu vào IndexedDB (store `logs`) và phát cho các listener (để cập nhật giao diện).
 */
import { repos } from './storage.js';
import { state } from './core/state.js';

export const LOG_TYPES = Object.freeze({
  login: 'Đăng nhập',
  sync: 'Đồng bộ',
  search: 'Tìm kiếm',
  export: 'Xuất dữ liệu',
  import: 'Nhập dữ liệu',
  backup: 'Sao lưu',
  error: 'Lỗi',
  system: 'Hệ thống',
});

const listeners = new Set();

/** Ghi một dòng nhật ký. Không bao giờ ném lỗi (nhật ký không được làm hỏng luồng chính). */
async function write(level, type, message, meta = {}, durationMs) {
  const entry = {
    ts: Date.now(),
    level,
    type,
    message,
    meta: sanitizeMeta(meta),
    companyTax: state.companyTax || '',
    durationMs: durationMs ?? null,
  };
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug)(`[${type}] ${message}`, meta);
  try {
    entry.id = await repos.logs.add(entry);
  } catch (e) {
    console.warn('Không ghi được nhật ký', e);
  }
  for (const fn of listeners) {
    try { fn(entry); } catch { /* bỏ qua */ }
  }
  return entry;
}

/** Không bao giờ ghi mật khẩu / token vào nhật ký. */
function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (/pass|token|secret|captcha|cvalue|authorization/i.test(k)) continue;
    out[k] = v instanceof Error ? v.message : v;
  }
  return out;
}

export const logger = {
  info: (type, message, meta, ms) => write('info', type, message, meta, ms),
  warn: (type, message, meta, ms) => write('warn', type, message, meta, ms),
  error: (message, meta, type = 'error') => write('error', type, message, meta),

  /** Đo thời gian một tác vụ và ghi log khi xong / lỗi. */
  async time(type, message, fn, meta) {
    const t0 = performance.now();
    try {
      const r = await fn();
      await write('info', type, message, meta, Math.round(performance.now() - t0));
      return r;
    } catch (e) {
      await write('error', type, `${message} — thất bại: ${e.message}`, { ...meta, error: e.message }, Math.round(performance.now() - t0));
      throw e;
    }
  },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

// Bắt lỗi chưa xử lý để không bỏ sót trong nhật ký.
export function installGlobalErrorHandlers() {
  window.addEventListener('error', (e) => { if (/ResizeObserver loop/.test(e.message)) { e.stopImmediatePropagation(); return; } logger.error(`Lỗi chưa xử lý: ${e.message}`, { source: e.filename, line: e.lineno }); });
  window.addEventListener('unhandledrejection', (e) => logger.error(`Promise bị từ chối: ${e.reason?.message || e.reason}`));
}
