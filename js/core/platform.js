/**
 * platform.js — Che giấu khác biệt giữa Web / PWA / Electron.
 *
 *  - Lưu file: Electron ghi thẳng vào "Thư mục lưu"; Chrome/Edge dùng File System Access API
 *    (thư mục do người dùng chọn); còn lại tải xuống bình thường.
 *  - Nhận biết môi trường để chọn kênh gọi mạng (xem api.js).
 */
import { repos } from '../storage.js';
import { downloadBlob, b64encode } from '../utils.js';

/** Cầu nối do electron/preload.js cung cấp (nếu chạy trong Electron). */
export const desktop = () => window.etaxDesktop || null;
export const isElectron = () => !!window.etaxDesktop;
export const supportsFolderPicker = () => isElectron() || 'showDirectoryPicker' in window;

const HANDLE_KEY = 'saveDirHandle';

/** Cho người dùng chọn thư mục lưu. Trả về tên thư mục hiển thị. */
export async function pickSaveFolder() {
  if (isElectron()) {
    const r = await desktop().pickFolder();
    if (!r) return null;
    await repos.settings.setValue('saveFolderName', r.path);
    return r.path;
  }
  if (!('showDirectoryPicker' in window)) throw new Error('Trình duyệt này không hỗ trợ chọn thư mục. Tệp sẽ được tải xuống vào thư mục Downloads.');
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'etax-save' });
  await repos.settings.setValue(HANDLE_KEY, handle);
  await repos.settings.setValue('saveFolderName', handle.name);
  return handle.name;
}

export async function clearSaveFolder() {
  await repos.settings.delete(HANDLE_KEY);
  await repos.settings.setValue('saveFolderName', '');
  if (isElectron()) await desktop().clearFolder?.();
}

async function getHandle() {
  const row = await repos.settings.get(HANDLE_KEY);
  const handle = row?.value;
  if (!handle) return null;
  try {
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'prompt') perm = await handle.requestPermission({ mode: 'readwrite' });
    return perm === 'granted' ? handle : null;
  } catch { return null; }
}

/**
 * Lưu một Blob thành file.
 * @returns {Promise<{where:'electron'|'folder'|'download', path:string}>}
 */
export async function saveFile(filename, blob) {
  if (isElectron()) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const r = await desktop().saveFile({ name: filename, dataBase64: b64encode(buf) });
    if (r?.path) return { where: 'electron', path: r.path };
  } else {
    const handle = await getHandle();
    if (handle) {
      try {
        const fh = await handle.getFileHandle(filename, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        return { where: 'folder', path: `${handle.name}/${filename}` };
      } catch (e) { console.warn('Ghi vào thư mục đã chọn thất bại, chuyển sang tải xuống', e); }
    }
  }
  downloadBlob(blob, filename);
  return { where: 'download', path: filename };
}

/** Đăng ký service worker (PWA) khi chạy qua http(s). */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return false;
  try { await navigator.serviceWorker.register('./sw.js'); return true; } catch (e) { console.warn('SW lỗi', e); return false; }
}

let deferredInstall = null;
export function captureInstallPrompt(onChange) {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; onChange?.(true); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; onChange?.(false); });
}
export const canInstall = () => !!deferredInstall;
export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  return outcome === 'accepted';
}
