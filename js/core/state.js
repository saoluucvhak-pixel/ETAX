/**
 * state.js — Trạng thái toàn cục nhỏ gọn + bus sự kiện.
 *
 * Sự kiện phát ra:
 *   session:change   – đăng nhập / đăng xuất / hết phiên
 *   company:change   – đổi doanh nghiệp đang làm việc
 *   invoices:change  – dữ liệu hóa đơn thay đổi (đồng bộ, nhập, xóa)
 *   settings:change  – cài đặt thay đổi
 *   route:change     – đổi trang
 *   sync:progress    – tiến độ đồng bộ (dùng cho thanh trạng thái)
 *   syncSession:change – lần đồng bộ nền (syncSession.js) bắt đầu/tiến độ/xong — sống độc lập với trang đang mở
 */
import { DEFAULT_SETTINGS } from '../config.js';

class Bus {
  constructor() { this.map = new Map(); }

  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt).add(fn);
    return () => this.off(evt, fn);
  }

  off(evt, fn) { this.map.get(evt)?.delete(fn); }

  emit(evt, payload) {
    for (const fn of [...(this.map.get(evt) || [])]) {
      try { fn(payload); } catch (e) { console.error(`[bus:${evt}]`, e); }
    }
  }
}

export const bus = new Bus();

/**
 * session = {
 *   mode: 'gdt' | 'offline' | 'demo',
 *   username, taxCode, companyName, userName,
 *   loginAt (ms), status: 'active' | 'expired' | 'offline',
 *   token (chỉ giữ trong RAM/sessionStorage)
 * }
 */
export const state = {
  settings: { ...DEFAULT_SETTINGS },
  session: null,
  companyTax: '', // doanh nghiệp đang xem dữ liệu
  route: 'dashboard',
  syncing: false,
};

export function setSession(session) {
  state.session = session;
  if (session?.token) sessionStorage.setItem('etax.session', JSON.stringify(session));
  else sessionStorage.removeItem('etax.session');
  bus.emit('session:change', session);
}

export function restoreSession() {
  try {
    const raw = sessionStorage.getItem('etax.session');
    if (raw) state.session = JSON.parse(raw);
  } catch { /* bỏ qua */ }
  return state.session;
}

export function setCompany(tax) {
  if (state.companyTax === tax) return;
  state.companyTax = tax;
  bus.emit('company:change', tax);
}

export const isLoggedIn = () => !!state.session && state.session.status !== 'expired';
