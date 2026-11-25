/**
 * autoBackup.js — Tự động sao lưu định kỳ hàng tháng (Cài đặt → Sao lưu và khôi phục).
 * Chạy vào ngày đã đặt (mặc định 20) mỗi tháng, chỉ khi trang đang mở (giống autosync.js).
 * Nếu mở ứng dụng trễ hơn ngày đó trong cùng tháng (ví dụ máy tắt đúng hôm đó) thì chạy bù ngay
 * khi phát hiện, không đợi đến ngày quy định của tháng sau. Không tự xóa bản sao lưu cũ.
 * Cần đã chọn "Thư mục lưu" (hoặc chạy Electron) để ghi lặng lẽ; nếu chưa chọn thì báo một lần
 * mỗi tháng (toast + Nhật ký) rồi thôi, không lặp lại liên tục.
 */
import { state } from './state.js';
import { saveSettings } from './settings.js';
import { createBackup } from './backup.js';
import { saveFile, isElectron } from './platform.js';
import { repos } from '../storage.js';
import { toast } from './ui.js';
import { logger } from '../logger.js';
import { todayISO } from '../utils.js';

let timer = null;

const ymOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Đã có nơi để ghi lặng lẽ chưa (Electron luôn có; trình duyệt cần đã chọn thư mục còn quyền ghi). */
async function hasSaveFolder() {
  if (isElectron()) return true;
  const row = await repos.settings.get('saveDirHandle');
  return !!row?.value;
}

async function tick() {
  const s = state.settings;
  if (!s.autoBackup) return;
  const now = new Date();
  if (now.getDate() < (Number(s.backupDay) || 20)) return;
  const ym = ymOf(now);
  if (s.lastBackupYM === ym) return; // đã sao lưu tháng này rồi

  if (!(await hasSaveFolder())) {
    if (s.lastBackupWarnYM !== ym) {
      await saveSettings({ lastBackupWarnYM: ym });
      toast('Đến kỳ sao lưu tự động nhưng chưa chọn thư mục lưu — hãy chọn ở Cài đặt → Thư mục lưu tệp.', 'warn');
      await logger.warn('backup', 'Bỏ qua sao lưu tự động: chưa chọn thư mục lưu', { ym });
    }
    return;
  }

  try {
    const blob = await createBackup();
    const r = await saveFile(`eTax_backup_${todayISO().replaceAll('-', '')}.json`, blob);
    await saveSettings({ lastBackupYM: ym });
    if (r.where === 'download') {
      toast(`Đã tự động sao lưu (tải xuống ${r.path}) — không ghi được vào thư mục đã chọn, kiểm tra lại quyền thư mục.`, 'warn');
    } else {
      toast(`Đã tự động sao lưu vào ${r.path}.`, 'ok');
    }
  } catch (e) {
    await logger.error(`Sao lưu tự động thất bại: ${e.message}`, { ym }, 'backup');
    toast(`Sao lưu tự động thất bại: ${e.message}`, 'bad');
  }
}

/** Bắt đầu vòng kiểm tra mỗi phút (rẻ vì chỉ so sánh ngày/tháng); kiểm tra ngay để chạy bù nếu lỡ mất ngày quy định. */
export function startAutoBackup() {
  clearInterval(timer);
  tick();
  timer = setInterval(tick, 60000);
}
