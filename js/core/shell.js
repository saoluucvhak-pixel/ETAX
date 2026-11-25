/**
 * shell.js — Khung ứng dụng: thanh bên (menu 14 mục), thanh công cụ, thanh trạng thái.
 * Trả về API nhỏ cho router/trang: content, setHeading, setFill, refresh.
 */
import { h, clear, fmtInt } from '../utils.js';
import { ROUTES, APP } from '../config.js';
import { state, bus } from './state.js';
import { t } from './i18n.js';
import { icon, sealMark } from './ui.js';
import { listCompanies, activateCompany } from './companies.js';
import { resolveTheme, toggleTheme } from './settings.js';
import { loadInvoices } from './invoiceStore.js';
import { go, parseHash } from './router.js';
import { canInstall, promptInstall, captureInstallPrompt } from './platform.js';

const GROUPS = ['overview', 'data', 'files', 'analysis', 'system'];

/** Nhãn + tông màu của con dấu trạng thái phiên. */
export function sessionInfo(s = state.session) {
  if (!s) return { tone: 'out', label: t('status.loggedOut') };
  if (s.status === 'expired') return { tone: 'expired', label: t('status.expired') };
  if (s.mode === 'demo') return { tone: 'demo', label: t('status.demo') };
  if (s.mode === 'offline') return { tone: 'offline', label: t('status.offline') };
  return { tone: 'active', label: t('status.active') };
}

export function buildShell(root) {
  const navItems = new Map();
  const counts = new Map();

  // ---- Thanh bên
  const nav = h('nav.nav', { 'aria-label': 'Menu chính' });
  const rebuildNav = () => {
    clear(nav); navItems.clear(); counts.clear();
    for (const g of GROUPS) {
      nav.append(h('div.nav-group', t(`group.${g}`)));
      for (const r of ROUTES.filter((x) => x.group === g)) {
        const count = h('span.nav-count');
        const a = h('a.nav-item', { href: `#/${r.id}`, dataset: { route: r.id }, onclick: () => app.classList.remove('nav-open') }, icon(r.icon, 18), h('span', t(`nav.${r.id}`)), count);
        navItems.set(r.id, a); counts.set(r.id, count);
        nav.append(a);
      }
    }
    markActive();
    refreshCounts();
  };
  const markActive = () => navItems.forEach((a, id) => { a.classList.toggle('active', id === state.route); if (id === state.route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });

  const installBtn = h('button.link-btn', { hidden: true, onclick: () => promptInstall() }, 'Cài như ứng dụng');
  captureInstallPrompt(() => { installBtn.hidden = !canInstall(); });
  const sideFoot = h('div.side-foot', h('div.row-gap', h('span', `Phiên bản ${APP.version}`), installBtn), h('span', 'Dữ liệu chỉ lưu trên máy này.'));
  const sidebar = h('aside.sidebar', h('div.brand', sealMark(38), h('div', h('div.brand-name', 'eTax Manager'), h('div.brand-sub', 'HAK Group · Hóa đơn điện tử'))), nav, sideFoot);

  // ---- Thanh công cụ
  const title = h('h1');
  const subtitle = h('p');
  const search = h('input', { type: 'search', placeholder: t('toolbar.quickSearch'), 'aria-label': 'Tìm nhanh hóa đơn' });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && search.value.trim()) { go('lookup', { q: search.value.trim() }); search.blur(); }
  });
  const companySel = h('select.company-select', { 'aria-label': t('toolbar.company'), onchange: (e) => activateCompany(e.target.value) });
  const companyWrap = h('div.row-gap', icon('building', 18), companySel);
  const themeBtn = h('button.icon-btn', { type: 'button', onclick: () => toggleTheme() });
  const stamp = h('button.session-stamp', { type: 'button', title: 'Mở trang đăng nhập', onclick: () => go('login') });
  const menuBtn = h('button.icon-btn.menu-toggle', { type: 'button', 'aria-label': 'Mở menu', onclick: () => app.classList.toggle('nav-open') }, icon('menu', 22));
  const topbar = h('header.topbar', menuBtn, h('div.page-heading', title, subtitle), h('div.quick-search', icon('search', 16), search), companyWrap, themeBtn, stamp);

  // ---- Thanh trạng thái
  const statLeft = h('span');
  const syncMini = h('div.sync-mini', { hidden: true }, h('span.sm-msg'), h('div.pp-track', h('div.pp-fill')));
  const online = h('span');
  const statusbar = h('footer.statusbar', statLeft, h('span.spacer'), syncMini, online);

  const content = h('main.content', { id: 'content', tabindex: -1 });
  const app = h('div.app', sidebar, h('div.main', topbar, content, statusbar));
  clear(root).append(app);
  root.classList.remove('boot');

  // ---- Cập nhật động
  const refreshTheme = () => {
    clear(themeBtn).append(icon(resolveTheme() === 'dark' ? 'sun' : 'moon', 20));
    themeBtn.setAttribute('aria-label', resolveTheme() === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối');
  };
  const refreshSession = () => {
    const info = sessionInfo();
    stamp.className = `session-stamp tone-${info.tone}`;
    stamp.replaceChildren(icon(info.tone === 'active' ? 'shield' : info.tone === 'expired' ? 'alert' : info.tone === 'out' ? 'key' : 'database', 14), info.label);
  };
  const refreshCompanies = async () => {
    const list = await listCompanies();
    companyWrap.hidden = list.length === 0;
    companySel.replaceChildren(...list.map((c) => h('option', { value: c.tax, selected: c.tax === state.companyTax }, `${c.name ? `${c.name} — ` : ''}${c.tax}`)));
    if (state.companyTax) companySel.value = state.companyTax;
  };
  async function refreshCounts() {
    const tax = state.companyTax;
    const list = tax ? await loadInvoices(tax) : [];
    const n = { in: 0, out: 0 };
    for (const i of list) n[i.direction === 'out' ? 'out' : 'in']++;
    counts.get('invoices-in') && (counts.get('invoices-in').textContent = n.in ? fmtInt(n.in) : '');
    counts.get('invoices-out') && (counts.get('invoices-out').textContent = n.out ? fmtInt(n.out) : '');
    statLeft.textContent = tax ? `MST ${tax} — ${fmtInt(list.length)} hóa đơn trên máy` : t('toolbar.noCompany');
  }
  const refreshOnline = () => { online.textContent = navigator.onLine ? '' : 'Máy đang ngoại tuyến'; };

  bus.on('session:change', refreshSession);
  bus.on('company:change', () => { refreshCompanies(); refreshCounts(); });
  bus.on('invoices:change', () => { refreshCounts(); });
  bus.on('settings:change', (p) => {
    refreshTheme();
    if (p && 'language' in p) { rebuildNav(); search.placeholder = t('toolbar.quickSearch'); refreshSession(); const r = parseHash().route; title.textContent = t(`nav.${r}`); subtitle.textContent = t(`sub.${r}`); }
  });
  bus.on('route:change', () => { markActive(); app.classList.remove('nav-open'); });
  bus.on('sync:progress', (p) => {
    syncMini.hidden = !p.running;
    if (!p.running) return;
    syncMini.querySelector('.sm-msg').textContent = p.message || 'Đang đồng bộ…';
    syncMini.querySelector('.pp-fill').style.width = `${Math.round((p.pct || 0) * 100)}%`;
  });
  window.addEventListener('online', refreshOnline);
  window.addEventListener('offline', refreshOnline);

  rebuildNav(); refreshTheme(); refreshSession(); refreshCompanies(); refreshOnline();

  return {
    content,
    setHeading(t1, t2) { title.textContent = t1; subtitle.textContent = t2 || ''; document.title = `${t1} — ${APP.name}`; },
    setFill(on) { content.classList.toggle('fill', on); },
    refreshCompanies, refreshCounts,
    focusSearch: () => search.focus(),
  };
}
