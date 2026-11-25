/**
 * charts.js — Biểu đồ SVG tự vẽ (cột nhóm, tròn) không cần thư viện.
 * Màu lấy từ biến CSS (--series-1…) nên tự đổi theo chế độ sáng/tối.
 */
import { h, fmtCompact, fmtMoney } from '../utils.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids.filter((k) => k != null));
  return el;
};

/** Làm tròn trần "đẹp" cho trục Y. */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/**
 * Biểu đồ cột nhóm.
 * @param {{labels:string[], series:{name:string, values:number[]}[], height?:number, format?:Function}} o
 */
export function barChart({ labels, series, height = 260, format = fmtCompact, ariaLabel = 'Biểu đồ cột' }) {
  const wrap = h('div.chart', { role: 'img', 'aria-label': ariaLabel });
  const tip = h('div.chart-tip', { hidden: true });
  wrap.append(tip);

  const draw = () => {
    wrap.querySelector('svg')?.remove();
    const W = Math.max(320, wrap.clientWidth || 640);
    const M = { l: 58, r: 10, t: 10, b: 30 };
    const iw = W - M.l - M.r;
    const ih = height - M.t - M.b;
    const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
    const min = Math.min(0, ...series.flatMap((s) => s.values));
    const lo = min < 0 ? -niceMax(-min) : 0;
    const y = (v) => M.t + ih - ((v - lo) / (max - lo)) * ih;
    const root = svg('svg', { viewBox: `0 0 ${W} ${height}`, width: W, height, class: 'chart-svg' });

    // Lưới + nhãn trục Y
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = lo + ((max - lo) * i) / ticks;
      root.append(svg('line', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), class: i === 0 ? 'axis' : 'grid-line' }));
      const t = svg('text', { x: M.l - 8, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' });
      t.textContent = format(v);
      root.append(t);
    }

    const n = labels.length;
    const gw = iw / Math.max(1, n);
    const bw = Math.max(3, Math.min(28, (gw * 0.72) / series.length));
    const every = Math.ceil(n / Math.max(1, Math.floor(iw / 54)));
    labels.forEach((lb, i) => {
      const gx = M.l + gw * i + gw / 2;
      series.forEach((s, si) => {
        const v = s.values[i] || 0;
        const x = gx - (bw * series.length) / 2 + si * bw;
        const y0 = y(0);
        const yv = y(v);
        root.append(svg('rect', { x, y: Math.min(y0, yv), width: Math.max(1, bw - 1.5), height: Math.max(0, Math.abs(y0 - yv)), rx: 2, class: `bar s${si + 1}` }));
      });
      if (i % every === 0) {
        const t = svg('text', { x: gx, y: height - 9, class: 'tick', 'text-anchor': 'middle' });
        t.textContent = lb;
        root.append(t);
      }
      // Vùng bắt hover cho cả nhóm
      const hit = svg('rect', { x: M.l + gw * i, y: M.t, width: gw, height: ih, fill: 'transparent' });
      hit.addEventListener('mousemove', (e) => {
        const box = wrap.getBoundingClientRect();
        tip.hidden = false;
        tip.replaceChildren(h('b', lb), ...series.map((s, si) => h('div.tip-row', h(`i.dot.s${si + 1}`), `${s.name}: `, h('b', fmtMoney(s.values[i] || 0)))));
        tip.style.left = `${Math.min(e.clientX - box.left + 12, box.width - 190)}px`;
        tip.style.top = `${Math.max(0, e.clientY - box.top - 12)}px`;
      });
      hit.addEventListener('mouseleave', () => { tip.hidden = true; });
      root.append(hit);
    });
    wrap.prepend(root);
  };

  // Vẽ lại khi đổi kích thước (thay đổi cửa sổ, mở/đóng sidebar)
  let lastW = 0;
  const ro = new ResizeObserver(() => { const w = wrap.clientWidth; if (w && Math.abs(w - lastW) > 4) { lastW = w; draw(); } });
  queueMicrotask(() => { ro.observe(wrap); });
  wrap.legend = () => h('div.legend', series.map((s, i) => h('span.legend-item', h(`i.dot.s${i + 1}`), s.name)));
  return wrap;
}

/** Biểu đồ tròn rỗng giữa + chú giải. items: [{label, value}] */
export function donutChart({ items, size = 168, centerLabel, centerValue, format = fmtCompact }) {
  const total = items.reduce((a, x) => a + x.value, 0);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'donut-svg', role: 'img', 'aria-label': 'Biểu đồ tròn' });
  root.append(svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', class: 'donut-bg', 'stroke-width': 18 }));
  let acc = 0;
  items.forEach((it, i) => {
    if (!total || it.value <= 0) return;
    const len = (it.value / total) * c;
    const seg = svg('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': 18,
      'stroke-dasharray': `${Math.max(0, len - 1.5)} ${c - Math.max(0, len - 1.5)}`, 'stroke-dashoffset': -acc,
      transform: `rotate(-90 ${size / 2} ${size / 2})`, class: `seg s${(i % 6) + 1}`,
    });
    seg.append(svg('title', {}, `${it.label}: ${fmtMoney(it.value)} (${((it.value / total) * 100).toFixed(1)}%)`));
    root.append(seg);
    acc += len;
  });
  const ctr = svg('text', { x: size / 2, y: size / 2 - 2, 'text-anchor': 'middle', class: 'donut-val' });
  ctr.textContent = centerValue ?? format(total);
  const ctl = svg('text', { x: size / 2, y: size / 2 + 16, 'text-anchor': 'middle', class: 'donut-lbl' });
  ctl.textContent = centerLabel || '';
  root.append(ctr, ctl);
  const legend = h('ul.donut-legend', items.map((it, i) => h('li', h(`i.dot.s${(i % 6) + 1}`), h('span.dl-name', { title: it.label }, it.label), h('span.dl-val', total ? `${((it.value / total) * 100).toFixed(1)}%` : '—'))));
  return h('div.donut', root, legend);
}

/** Thanh ngang đơn giản (top đối tác). rows: [{label, value, sub}] */
export function hbarList(rows, format = fmtCompact) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('ol.hbars', rows.map((r) => h('li',
    h('div.hb-top', h('span.hb-label', { title: r.label }, r.label), h('span.hb-val', format(r.value))),
    h('div.hb-track', h('div.hb-fill', { style: { width: `${(r.value / max) * 100}%` } })),
    r.sub && h('div.hb-sub', r.sub))));
}
