/**
 * app.js — Điểm vào của ứng dụng: mở CSDL, nạp cài đặt, khôi phục phiên, dựng khung và bắt đầu điều hướng.
 */
import { database } from './storage.js';
import { installGlobalErrorHandlers, logger } from './logger.js';
import { state, restoreSession, bus } from './core/state.js';
import { loadSettings } from './core/settings.js';
import { listCompanies } from './core/companies.js';
import { buildShell } from './core/shell.js';
import { startRouter } from './core/router.js';
import { registerServiceWorker } from './core/platform.js';
import { startAutoSync } from './core/autosync.js';
import { startAutoBackup } from './core/autoBackup.js';
import { gdt } from './api.js';
import { toast } from './core/ui.js';
import { h } from './utils.js';

/** Khi CSDL không mở được (ví dụ chế độ riêng tư chặn IndexedDB) hiện thông báo rõ ràng thay vì trang trắng. */
function showFatal(root, e) {
  root.classList.remove('boot');
  root.replaceChildren(h('div.page', { style: { padding: '48px 24px', maxWidth: '640px', margin: '0 auto' } },
    h('h1', { style: { fontFamily: 'var(--font-title)' } }, 'Không khởi động được eTax Manager'),
    h('p', { style: { margin: '12px 0' } }, e.message || String(e)),
    h('p.muted', 'Trình duyệt cần cho phép IndexedDB. Hãy thử thoát chế độ riêng tư/ẩn danh, hoặc mở bằng bản Electron. Xem docs/HUONG-DAN.md.'),
    h('button.btn.primary', { onclick: () => location.reload() }, 'Tải lại')));
}

async function boot() {
  const root = document.getElementById('app');
  installGlobalErrorHandlers();
  try {
    await database.open();
    await loadSettings();
  } catch (e) { showFatal(root, e); return; }

  // Khôi phục phiên trong tab (token chỉ nằm trong sessionStorage, đóng tab là mất).
  const session = restoreSession();
  if (session?.mode === 'gdt' && session.token) gdt.setToken(session.token);

  // Chọn doanh nghiệp làm việc: theo phiên → lần dùng gần nhất → doanh nghiệp đầu tiên.
  const companies = await listCompanies();
  const pick = [session?.taxCode, state.settings.lastCompany, companies[0]?.tax].find((t) => t && (companies.some((c) => c.tax === t) || t === session?.taxCode));
  if (pick) state.companyTax = pick;

  const shell = buildShell(root);
  startRouter(shell);
  startAutoSync();
  startAutoBackup();
  registerServiceWorker();
  logger.info('system', 'Khởi động ứng dụng', { companies: companies.length });

  // Phím tắt: "/" để tìm nhanh (khi không đang gõ ở ô nhập).
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); shell.focusSearch(); }
  });

  // Báo khi phiên hết hạn để người dùng biết cần đăng nhập lại.
  bus.on('session:change', (s) => { if (s?.status === 'expired') toast('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để đồng bộ tiếp.', 'warn', { action: { label: 'Đăng nhập', onClick: () => { location.hash = '#/login'; } } }); });
}

boot();
