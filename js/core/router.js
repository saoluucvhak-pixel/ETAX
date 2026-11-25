/**
 * router.js — Điều hướng theo hash (#/ten-trang?tham-so=…) và nạp trang theo nhu cầu (dynamic import).
 *
 * Mỗi trang là một module xuất:
 *   export async function mount(host, ctx)  → (tùy chọn) trả về hàm dọn dẹp
 *   export const fill = true                → trang cần bảng chiếm hết chiều cao (Data Grid)
 * ctx = { route, params, shell }
 */
import { state, bus } from './state.js';
import { topProgress, emptyState, icon } from './ui.js';
import { t } from './i18n.js';
import { h, clear } from '../utils.js';
import { logger } from '../logger.js';

const LOADERS = {
  dashboard: () => import('../dashboard.js'),
  login: () => import('../login.js'),
  sync: () => import('../sync.js'),
  'invoices-in': () => import('../invoice.js'),
  'invoices-out': () => import('../invoice.js'),
  lookup: () => import('../views/lookup.js'),
  xml: () => import('../views/xmlView.js'),
  pdf: () => import('../views/pdfView.js'),
  excel: () => import('../views/excelView.js'),
  report: () => import('../report.js'),
  reconcile: () => import('../views/reconcile.js'),
  customers: () => import('../views/partners.js'),
  suppliers: () => import('../views/partners.js'),
  logs: () => import('../views/logs.js'),
  settings: () => import('../views/settings.js'),
};

let cleanup = null;
let shell = null;
let token = 0;

/** Đọc "#/lookup?q=abc" → { route:'lookup', params:{q:'abc'} }. */
export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const route = LOADERS[path] ? path : 'dashboard';
  return { route, params: Object.fromEntries(new URLSearchParams(query)) };
}

/** Chuyển trang (kèm tham số tùy chọn). */
export function go(route, params) {
  const q = params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : '';
  const next = `#/${route}${q}`;
  if (location.hash === next) render(); else location.hash = next;
}

async function render() {
  const my = ++token;
  const { route, params } = parseHash();
  state.route = route;
  bus.emit('route:change', route);
  try { cleanup?.(); } catch (e) { console.warn('Dọn dẹp trang lỗi', e); }
  cleanup = null;

  topProgress.start();
  const host = shell.content;
  clear(host);
  try {
    const mod = await LOADERS[route]();
    if (my !== token) return; // người dùng đã bấm sang trang khác
    shell.setHeading(t(`nav.${route}`), t(`sub.${route}`));
    shell.setFill(!!mod.fill);
    host.scrollTop = 0;
    const page = h('div.page');
    host.append(page);
    cleanup = (await mod.mount(page, { route, params, shell })) || null;
  } catch (e) {
    if (my !== token) return;
    console.error(e);
    logger.error(`Không mở được trang "${route}": ${e.message}`);
    clear(host).append(h('div.page', emptyState({ title: 'Không mở được trang này', text: e.message, action: h('button.btn.primary', { onclick: () => render() }, icon('refresh', 16), 'Thử lại') })));
  } finally {
    if (my === token) topProgress.done();
  }
}

/** Bắt đầu lắng nghe hash. */
export function startRouter(shellApi) {
  shell = shellApi;
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/dashboard'; else render();
}

/** Vẽ lại trang hiện tại (ví dụ sau khi đổi ngôn ngữ). */
export const refreshRoute = () => render();
