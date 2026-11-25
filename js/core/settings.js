/**
 * settings.js — Nạp/lưu cài đặt người dùng và áp dụng giao diện (sáng/tối).
 * Cài đặt lưu trong IndexedDB (store `settings`); riêng `theme` còn được chép vào localStorage
 * để index.html đặt đúng giao diện ngay từ khung hình đầu tiên (tránh nháy trắng).
 */
import { repos } from '../storage.js';
import { state, bus } from './state.js';
import { DEFAULT_SETTINGS } from '../config.js';

/** Quy đổi 'auto' theo cài đặt hệ điều hành. */
export function resolveTheme(pref = state.settings.theme) {
  if (pref === 'dark' || pref === 'light') return pref;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme() {
  const theme = resolveTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a0f1f' : '#1a2350');
  document.documentElement.lang = state.settings.language === 'en' ? 'en' : 'vi';
}

/** Nạp cài đặt từ CSDL vào state (gọi một lần khi khởi động). */
export async function loadSettings() {
  state.settings = { ...DEFAULT_SETTINGS, ...(await repos.settings.all()) };
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.settings.theme === 'auto') applyTheme(); });
}

/** Lưu một phần cài đặt, áp dụng ngay và báo cho các thành phần khác. */
export async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await repos.settings.setMany(patch);
  if ('theme' in patch) { try { localStorage.setItem('etax.theme', patch.theme); } catch { /* bỏ qua */ } }
  if ('theme' in patch || 'language' in patch) applyTheme();
  bus.emit('settings:change', patch);
}

/** Chuyển nhanh giữa sáng và tối (nút trên thanh công cụ). */
export const toggleTheme = () => saveSettings({ theme: resolveTheme() === 'dark' ? 'light' : 'dark' });
