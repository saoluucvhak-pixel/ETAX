/**
 * syncSession.js — Giữ trạng thái của lần đồng bộ đang chạy tách rời khỏi vòng đời trang "Đồng bộ dữ liệu".
 *
 * Vì sao cần: trước đây trang Đồng bộ tự hủy việc đang tải mỗi khi người dùng rời trang (router dọn dẹp trang cũ).
 * Module này giữ AbortController + tiến độ ở nơi không bị dọn dẹp theo trang, để chuyển sang chức năng khác
 * trong lúc đang tải KHÔNG làm hủy — chỉ nút "Hủy" bấm tay (gọi `cancel()`) mới hủy thật.
 * `js/sync.js` gọi `start()` khi bấm "Bắt đầu đồng bộ", và lắng nghe bus 'syncSession:change' để cập nhật giao diện
 * dù đang mở trang nào; nếu rời trang rồi quay lại trong lúc đang chạy, `isRunning()`/`getSnapshot()` cho biết ngay.
 */
import { bus } from './state.js';
import { touchAutoSync } from './autosync.js';
import { toast } from './ui.js';
import { fmtInt } from '../utils.js';

let ctrl = null;
let running = false;
let snapshot = { pct: 0, message: '', detail: '', speed: null, etaMs: null };
let lastOutcome = null; // { ok:true, result } | { ok:false, aborted?:true, error } | null — của lần chạy gần nhất
let startedAt = 0; // performance.now() lúc bắt đầu lần chạy hiện tại — dùng tính tốc độ/ETA

export const isRunning = () => running;
export const getSnapshot = () => snapshot;
export const getLastOutcome = () => lastOutcome;

/**
 * Bắt đầu một lần đồng bộ chạy nền. `runFn({signal, onProgress})` là `runSync`/`runBridgeSync` đã bọc sẵn tham số.
 * Không await ở nơi gọi — theo dõi qua bus 'syncSession:change'.
 */
export function start(runFn) {
  if (running) { toast('Đang có một lần đồng bộ khác đang chạy.', 'warn'); return; }
  ctrl = new AbortController();
  running = true; lastOutcome = null; startedAt = performance.now();
  snapshot = { pct: 0, message: 'Đang chuẩn bị…', detail: '', speed: null, etaMs: null };
  bus.emit('syncSession:change');
  (async () => {
    try {
      const r = await runFn({
        signal: ctrl.signal,
        onProgress: ({ pct, message, detail, count } = {}) => {
          const p = pct ?? snapshot.pct;
          const elapsedMs = performance.now() - startedAt;
          // Tốc độ (hóa đơn/giây): cần ít nhất 1 giây trôi qua để không nhảy số lúc mới bắt đầu.
          const speed = count != null && elapsedMs > 1000 ? count / (elapsedMs / 1000) : null;
          // ETA: suy từ % đã xong và thời gian đã trôi qua — không cần biết trước tổng số hóa đơn.
          const etaMs = p > 0.03 && p < 1 ? Math.round((elapsedMs * (1 - p)) / p) : null;
          snapshot = { pct: p, message: message || '', detail: detail || '', speed, etaMs };
          bus.emit('syncSession:change');
        },
      });
      lastOutcome = { ok: true, result: r };
      touchAutoSync();
      toast(`Đồng bộ xong: ${fmtInt(r.fetched)} hóa đơn (mới ${fmtInt(r.added)}, cập nhật ${fmtInt(r.updated)}).`, 'ok');
    } catch (err) {
      if (err.name === 'AbortError') { lastOutcome = { ok: false, aborted: true, error: err }; toast('Đã hủy đồng bộ.', 'info'); }
      else { lastOutcome = { ok: false, error: err }; toast(err.message, 'bad'); }
    } finally {
      running = false; ctrl = null;
      bus.emit('syncSession:change');
    }
  })();
}

/** Hủy thật (do người dùng bấm nút Hủy) — không gọi từ nơi dọn dẹp trang. */
export function cancel() { ctrl?.abort(); }
