/**
 * reconcile.js — Trang "Đối chiếu". Hai cách đối chiếu trong cùng một trang:
 *   1) 3 nguồn: Sổ sách ↔ HĐĐT Cục Thuế ↔ Tờ khai 01/GTGT (reconcile3View.js) — mặc định.
 *   2) So sổ với hóa đơn đã đồng bộ theo MST + ký hiệu + số (reconcileSynced.js): có thêm nhóm hủy/thay thế, máy tính tiền, lệch kỳ.
 */
import { h, clear } from '../utils.js';

const TABS = [
  ['3 nguồn: Sổ sách ↔ HĐĐT ↔ Tờ khai', () => import('./reconcile3View.js')],
  ['So sổ với hóa đơn đã đồng bộ (theo MST)', () => import('./reconcileSynced.js')],
];

export async function mount(host, ctx) {
  const box = h('div');
  let cleanup = null;
  let seq = 0; // chống chạy đè khi bấm đổi tab nhanh lúc tab trước còn đang nạp
  const ctl = h('div.seg-control', { role: 'tablist', style: { width: 'fit-content', maxWidth: '100%', flexWrap: 'wrap' } });
  async function show(i) {
    const my = ++seq;
    try { cleanup?.(); } catch { /* bỏ qua */ }
    cleanup = null;
    [...ctl.children].forEach((b, j) => b.classList.toggle('active', i === j));
    const pane = h('div', { style: { display: 'grid', gap: '18px', gridTemplateColumns: 'minmax(0, 1fr)' } }); // mỗi tab một khung riêng
    clear(box).append(pane);
    const mod = await TABS[i][1]();
    if (my !== seq) return;
    const c = (await mod.mount(pane, ctx)) || null;
    if (my !== seq) { try { c?.(); } catch { /* bỏ qua */ } return; }
    cleanup = c;
    sessionStorage.setItem('etax.reconcileTab', String(i));
  }
  TABS.forEach(([label], i) => ctl.append(h('button', { type: 'button', role: 'tab', onclick: () => show(i) }, label)));
  host.append(ctl, box);
  await show(Number(sessionStorage.getItem('etax.reconcileTab')) || 0);
  return () => { seq++; cleanup?.(); };
}
