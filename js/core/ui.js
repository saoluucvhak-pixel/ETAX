/**
 * ui.js — Bộ thành phần giao diện dùng chung:
 * biểu tượng SVG, Toast, Loading, Progress (thanh trên cùng + khối tiến độ), Modal, Drawer, biểu mẫu.
 */
import { h, clear } from '../utils.js';
import { INVOICE_STATUS, DIRECTION_LABEL } from '../config.js';

// ---------------------------------------------------------------- Biểu tượng

const P = {
  dashboard: '<rect x="3" y="3" width="7" height="8" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M16 7l3 3M14 9l2 2"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
  outbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M12 3v8M9 6l3-3 3 3"/><path d="M5 10.5 3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6l-2-2.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  sheet: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  truck: '<path d="M2 6h11v10H2zM13 9h4.5L21 12.5V16h-8"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 13.5A8.5 8.5 0 1 1 10.5 3a6.5 6.5 0 0 0 10.5 10.5z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  x: '<path d="M5 5l14 14M19 5 5 19"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  alert: '<path d="M12 3 2 20h20zM12 10v4.5M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  building: '<path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 10h5a1 1 0 0 1 1 1v10M2 21h20M8 8h2M8 12h2M8 16h2"/>',
  logout: '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sortUp: '<path d="m7 14 5-5 5 5"/>',
  sortDown: '<path d="m7 10 5 5 5-5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
  wifioff: '<path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-2-1.5M2 8.8a15 15 0 0 1 4.2-2.5M22 8.8A15 15 0 0 0 10.6 4.1M12 20h.01"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  compare: '<path d="M8 3 4 7l4 4M4 7h13M16 21l4-4-4-4M20 17H7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};

export function icon(name, size = 18) {
  const span = h('span.ic');
  span.style.width = span.style.height = `${size}px`;
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`;
  return span;
}

/** Ấn chương đỏ (con dấu) làm biểu tượng thương hiệu. */
export function sealMark(size = 34) {
  const s = h('span.seal');
  s.style.width = s.style.height = `${size}px`;
  s.innerHTML = `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true"><rect x="2" y="2" width="36" height="36" rx="7" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="6.5" y="6.5" width="27" height="27" rx="4" fill="none" stroke="currentColor" stroke-width="1"/><path d="M12 14h16M20 14v14M14 28h12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>`;
  return s;
}

// ---------------------------------------------------------------- Toast

let toastHost;
const TOAST_ICON = { ok: 'check', info: 'info', warn: 'alert', bad: 'alert' };

/**
 * Hiện thông báo nhanh. `bad` không tự tắt để người dùng kịp đọc lỗi.
 * @param {string} message
 * @param {'ok'|'info'|'warn'|'bad'} [tone]
 * @param {{action?:{label:string,onClick:Function}, timeout?:number}} [opts]
 */
export function toast(message, tone = 'info', opts = {}) {
  if (!toastHost) { toastHost = h('div.toasts', { 'aria-live': 'polite' }); document.body.append(toastHost); }
  const close = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 180); };
  const el = h(`div.toast.tone-${tone}`, { role: tone === 'bad' ? 'alert' : 'status' },
    icon(TOAST_ICON[tone] || 'info', 18),
    h('div.toast-msg', message),
    opts.action && h('button.toast-act', { onclick: () => { opts.action.onClick(); close(); } }, opts.action.label),
    h('button.icon-btn.toast-x', { 'aria-label': 'Đóng', onclick: close }, icon('x', 14)));
  toastHost.append(el);
  const timeout = opts.timeout ?? (tone === 'bad' ? 12000 : tone === 'warn' ? 7000 : 3800);
  if (timeout) setTimeout(close, timeout);
  return close;
}

// ---------------------------------------------------------------- Loading + Progress

let overlay;
let overlayCount = 0;

/** Hiện lớp phủ loading; trả về hàm ẩn. Có bộ đếm để lồng nhau an toàn. */
export function showLoading(text = 'Đang xử lý…') {
  if (!overlay) {
    overlay = h('div.loading-overlay', { role: 'alert', 'aria-busy': 'true' }, h('div.spinner'), h('div.loading-text'));
    document.body.append(overlay);
  }
  overlayCount++;
  overlay.querySelector('.loading-text').textContent = text;
  overlay.classList.add('show');
  let done = false;
  return () => { if (done) return; done = true; if (--overlayCount <= 0) { overlayCount = 0; overlay.classList.remove('show'); } };
}

export async function withLoading(text, fn) {
  const hide = showLoading(text);
  try { return await fn(); } finally { hide(); }
}

let topBar;
/** Thanh tiến độ mảnh trên cùng trang. */
export const topProgress = {
  _t: null,
  start() {
    if (!topBar) { topBar = h('div.top-progress', h('div.top-progress-bar')); document.body.append(topBar); }
    clearTimeout(this._t);
    topBar.classList.add('show');
    this.set(0.05);
  },
  set(p) { if (topBar) topBar.firstChild.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`; },
  done() { this.set(1); this._t = setTimeout(() => { topBar?.classList.remove('show'); this.set(0); }, 350); },
};

/** Khối tiến độ có nhãn + phần trăm, dùng trong trang Đồng bộ / Nhập / Xuất. */
export function progressPanel() {
  const label = h('div.pp-label', 'Sẵn sàng');
  const pct = h('div.pp-pct', '0%');
  const bar = h('div.pp-fill');
  const detail = h('div.pp-detail');
  const meta = h('div.pp-meta'); // dòng phụ: tốc độ/ETA — chỉ hiện khi được truyền, không ảnh hưởng nơi khác đang dùng progressPanel()
  const el = h('div.progress-panel', h('div.pp-head', label, pct), h('div.pp-track', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar), detail, meta);
  return {
    el,
    set(p, text, sub, metaText) {
      const v = Math.round(Math.max(0, Math.min(1, p)) * 100);
      bar.style.width = `${v}%`;
      pct.textContent = `${v}%`;
      el.querySelector('.pp-track').setAttribute('aria-valuenow', v);
      if (text != null) label.textContent = text;
      if (sub != null) detail.textContent = sub;
      meta.textContent = metaText || '';
      el.classList.remove('is-error', 'is-done');
    },
    done(text) { bar.style.width = '100%'; pct.textContent = '100%'; label.textContent = text || 'Hoàn tất'; meta.textContent = ''; el.classList.add('is-done'); },
    fail(text, sub) { label.textContent = text || 'Thất bại'; if (sub != null) detail.textContent = sub; meta.textContent = ''; el.classList.add('is-error'); },
  };
}

// ---------------------------------------------------------------- Modal & Drawer

function trapEscape(el, close) {
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

/**
 * Mở hộp thoại.
 * @param {{title:string, body:Node|string, actions?:{label:string,kind?:string,onClick?:Function,keepOpen?:boolean}[], size?:'sm'|'md'|'lg'}} o
 */
export function openModal({ title, body, actions = [], size = 'md', onClose }) {
  const prev = document.activeElement;
  const backdrop = h('div.backdrop');
  let off;
  const close = (result) => {
    off?.();
    backdrop.classList.add('leaving');
    setTimeout(() => backdrop.remove(), 140);
    prev?.focus?.();
    onClose?.(result);
  };
  const footer = actions.length ? h('div.modal-foot', actions.map((a) => h(`button.btn.${a.kind || 'ghost'}`, {
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try { const r = await a.onClick?.(); if (!a.keepOpen && r !== false) close(a.label); } finally { btn.disabled = false; }
    },
  }, a.label))) : null;
  const dlg = h(`div.modal.size-${size}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-head', h('h2', title), h('button.icon-btn', { 'aria-label': 'Đóng', onclick: () => close('x') }, icon('x'))),
    h('div.modal-body', typeof body === 'string' ? h('p', body) : body), footer);
  backdrop.append(dlg);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close('backdrop'); });
  document.body.append(backdrop);
  off = trapEscape(dlg, () => close('esc'));
  setTimeout(() => (dlg.querySelector('[autofocus], input, select, textarea') || dlg.querySelector('.btn.primary, .btn.danger') || dlg).focus?.(), 30);
  return { close, el: dlg };
}

/** Hộp thoại xác nhận → Promise<boolean>. */
export function confirmDialog({ title, message, confirmLabel = 'Đồng ý', cancelLabel = 'Hủy', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    openModal({
      title, size: 'sm', body: typeof message === 'string' ? h('p.confirm-msg', message) : message,
      actions: [{ label: cancelLabel, onClick: () => done(false) }, { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => done(true) }],
      onClose: () => done(false),
    });
  });
}

/** Ngăn kéo bên phải (chi tiết hóa đơn, chi tiết đối tác…). */
export function openDrawer({ title, subtitle, body, actions = [], width = 640, onClose }) {
  const prev = document.activeElement;
  const backdrop = h('div.backdrop.drawer-backdrop');
  let off;
  const close = () => { off?.(); backdrop.classList.add('leaving'); setTimeout(() => backdrop.remove(), 200); prev?.focus?.(); onClose?.(); };
  const panel = h('aside.drawer', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { width: `min(${width}px, 100vw)` } },
    h('div.drawer-head', h('div', h('h2', title), subtitle && h('p.muted', subtitle)), h('div.row-gap', actions, h('button.icon-btn', { 'aria-label': 'Đóng', onclick: close }, icon('x')))),
    h('div.drawer-body', body));
  backdrop.append(panel);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  off = trapEscape(panel, close);
  setTimeout(() => panel.focus?.(), 30);
  return { close, el: panel, body: panel.querySelector('.drawer-body') };
}

// ---------------------------------------------------------------- Biểu mẫu & thành phần nhỏ

/** Nhãn + ô nhập + gợi ý. */
export function field(label, input, hint) {
  const id = input.id || `f${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h('div.field', h('label', { for: id }, label), input, hint && h('div.hint', hint));
}

export function select(options, value, props = {}) {
  const el = h('select', props, options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: String(v) === String(value) }, l);
  }));
  if (value != null) el.value = value;
  return el;
}

export function statusBadge(inv) {
  const s = INVOICE_STATUS[inv.status] || { label: `Trạng thái ${inv.status}`, tone: 'muted' };
  return h(`span.badge.tone-${s.tone}`, s.label);
}

export const directionBadge = (d) => h(`span.badge.dir-${d}`, DIRECTION_LABEL[d] || d);

export function emptyState({ title, text, action }) {
  return h('div.empty', h('div.empty-mark', icon('database', 28)), h('h3', title), text && h('p', text), action);
}

/** Thẻ số liệu chính. */
export function statCard({ label, value, sub, tone }) {
  return h(`div.stat${tone ? `.tone-${tone}` : ''}`, h('div.stat-label', label), h('div.stat-value', value), sub && h('div.stat-sub', sub));
}

/** Nút có biểu tượng. */
export function button(label, { kind = 'ghost', icon: ic, onClick, title, disabled } = {}) {
  return h(`button.btn.${kind}`, { onclick: onClick, title, disabled, type: 'button' }, ic && icon(ic, 16), label && h('span', label));
}

/** Menu thả xuống nhỏ (dùng cho nút "Xuất"). */
export function menuButton(label, items, { ic = 'download', kind = 'ghost' } = {}) {
  const menu = h('div.menu', { hidden: true }, items.map((it) => h('button.menu-item', { type: 'button', onclick: () => { menu.hidden = true; it.onClick(); } }, it.icon && icon(it.icon, 16), it.label)));
  const btn = h(`button.btn.${kind}`, { type: 'button', 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, icon(ic, 16), h('span', label), icon('chevronDown', 14));
  const wrap = h('div.menu-wrap', btn, menu);
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) menu.hidden = true; });
  wrap.setDisabled = (v) => { btn.disabled = v; };
  return wrap;
}

/** Tabs đơn giản. */
export function tabs(items, initial = 0) {
  const body = h('div.tab-body');
  const head = h('div.tabs', { role: 'tablist' });
  const show = (i) => {
    [...head.children].forEach((b, j) => { b.classList.toggle('active', i === j); b.setAttribute('aria-selected', i === j); });
    clear(body).append(typeof items[i].render === 'function' ? items[i].render() : items[i].render);
  };
  items.forEach((it, i) => head.append(h('button.tab', { type: 'button', role: 'tab', onclick: () => show(i) }, it.label)));
  show(initial);
  return h('div.tabs-wrap', head, body);
}
