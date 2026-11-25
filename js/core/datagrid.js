/**
 * datagrid.js — Data Grid ảo hóa (virtual scroll) cho hàng chục nghìn dòng.
 *
 * Tính năng: sắp xếp (bấm tiêu đề), lọc theo từng cột (ô lọc dưới tiêu đề; cột số hỗ trợ >, <, >=, <=, =, a..b),
 * chọn nhiều (ô tích, Shift để chọn khoảng, tích ô tiêu đề để chọn tất cả dòng đang lọc), dòng tổng ở chân bảng.
 *
 * Cột: { key, title, width?:number|'flex', align?, type?:'text'|'money'|'int'|'date',
 *        render?(row)→Node|string, value?(row)→giá trị dùng để sắp xếp/lọc, sum?:boolean, sortable?, filterable? }
 */
import { h, clear, fmtMoney, fmtInt, fmtDate, normalizeText, sum, parseNumber } from '../utils.js';
import { icon, emptyState } from './ui.js';

const OVERSCAN = 8;

/** Đọc bộ lọc số: ">1000000", "<=500", "=200", "100..200". Trả về hàm kiểm tra hoặc null nếu là chữ thường. */
function parseNumericFilter(text) {
  const raw = text.trim();
  const range = raw.split('..');
  if (range.length === 2 && range.every((x) => /^-?[\d.,]+$/.test(x.trim()))) {
    const [lo, hi] = range.map((x) => parseNumber(x));
    return (v) => v >= lo && v <= hi;
  }
  const m = /^(>=|<=|>|<|=)\s*(-?[\d.,]+)$/.exec(raw);
  if (!m) return null;
  const n = parseNumber(m[2]);
  return { '>=': (v) => v >= n, '<=': (v) => v <= n, '>': (v) => v > n, '<': (v) => v < n, '=': (v) => v === n }[m[1]];
}

export class DataGrid {
  /**
   * @param {object} o
   * @param {object[]} o.columns
   * @param {string} [o.rowKey='key']
   * @param {number} [o.rowHeight=38]
   * @param {boolean} [o.selectable=true]
   * @param {Function} [o.onOpen]  gọi khi bấm vào dòng
   * @param {Function} [o.onSelectionChange]
   * @param {object} [o.empty]  {title,text,action}
   */
  constructor({ columns, rowKey = 'key', rowHeight = 38, selectable = true, onOpen, onSelectionChange, empty, footerLabel = 'dòng', stripe = true, rowClass }) {
    Object.assign(this, { columns, rowKey, rowHeight, selectable, onOpen, onSelectionChange, footerLabel, rowClass });
    this.empty = empty || { title: 'Không có dữ liệu', text: 'Thử đổi bộ lọc hoặc đồng bộ thêm dữ liệu.' };
    this.rows = [];
    this.view = [];
    this.sort = null; // {key, dir}
    this.filters = {};
    this.selected = new Set();
    this.lastClicked = -1;
    this.showFilters = false;
    this._raf = 0;
    this.stripe = stripe;
    this._build();
  }

  // ------------------------------------------------------------ DOM

  _build() {
    const cols = this.columns.map((c) => (c.width === 'flex' || !c.width ? 'minmax(140px,1fr)' : `${c.width}px`));
    if (this.selectable) cols.unshift('40px');
    const minWidth = this.columns.reduce((a, c) => a + (c.width === 'flex' || !c.width ? 140 : c.width), this.selectable ? 40 : 0);

    this.headRow = h('div.grid-row.grid-head-row', { role: 'row' });
    this.filterRow = h('div.grid-row.grid-filter-row', { hidden: true });
    this.checkAll = h('input', { type: 'checkbox', 'aria-label': 'Chọn tất cả', onchange: () => this._toggleAll() });
    if (this.selectable) {
      this.headRow.append(h('div.grid-cell.cell-check', this.checkAll));
      this.filterRow.append(h('div.grid-cell.cell-check'));
    }
    this.columns.forEach((c) => {
      const sortable = c.sortable !== false;
      const cell = h(`div.grid-cell.align-${c.align || (c.type === 'money' || c.type === 'int' ? 'right' : 'left')}${sortable ? '.sortable' : ''}`,
        { role: 'columnheader', 'aria-sort': 'none', title: c.title, onclick: sortable ? () => this._cycleSort(c.key) : undefined },
        h('span.col-title', c.title), h('span.sort-mark'));
      c._headCell = cell;
      this.headRow.append(cell);
      const fcell = h('div.grid-cell');
      if (c.filterable !== false) {
        const numeric = c.type === 'money' || c.type === 'int';
        fcell.append(h('input.filter-input', {
          type: 'text', placeholder: numeric ? '> 1000000' : 'Lọc…', 'aria-label': `Lọc cột ${c.title}`,
          oninput: (e) => { this.filters[c.key] = e.target.value; this._applyDebounced(); },
        }));
      }
      this.filterRow.append(fcell);
    });

    this.rowsEl = h('div.grid-rows');
    this.spacer = h('div.grid-spacer', this.rowsEl);
    this.emptyEl = h('div.grid-empty', { hidden: true });
    this.viewport = h('div.grid-viewport', { role: 'grid', tabindex: 0 }, h('div.grid-sticky', this.headRow, this.filterRow), this.spacer, this.emptyEl);
    this.footer = h('div.grid-foot');
    this.el = h('div.grid', { style: { '--cols': cols.join(' '), '--min-w': `${minWidth}px`, '--row-h': `${this.rowHeight}px` } }, this.viewport, this.footer);

    this.viewport.addEventListener('scroll', () => this._schedule(), { passive: true });
    new ResizeObserver(() => this._schedule()).observe(this.viewport);
    this.viewport.addEventListener('keydown', (e) => this._onKey(e));
    let t;
    this._applyDebounced = () => { clearTimeout(t); t = setTimeout(() => this._apply(), 160); };
  }

  toggleFilters(force) {
    this.showFilters = force ?? !this.showFilters;
    this.filterRow.hidden = !this.showFilters;
    if (!this.showFilters) {
      this.filters = {};
      this.filterRow.querySelectorAll('input').forEach((i) => { i.value = ''; });
      this._apply();
    }
    return this.showFilters;
  }

  // ------------------------------------------------------------ Dữ liệu

  setRows(rows, { keepSelection = true } = {}) {
    this.rows = rows;
    if (keepSelection) {
      const keys = new Set(rows.map((r) => r[this.rowKey]));
      for (const k of [...this.selected]) if (!keys.has(k)) this.selected.delete(k);
    } else this.selected.clear();
    this._apply();
    this.onSelectionChange?.(this.getSelected());
  }

  getSelected() { return this.rows.filter((r) => this.selected.has(r[this.rowKey])); }
  getView() { return this.view; }
  clearSelection() { this.selected.clear(); this._renderWindow(); this._renderFooter(); this.onSelectionChange?.([]); }

  _value(col, row) { return col.value ? col.value(row) : row[col.key]; }

  _apply() {
    let list = this.rows;
    const active = Object.entries(this.filters).filter(([, v]) => v && v.trim());
    if (active.length) {
      const tests = active.map(([key, text]) => {
        const col = this.columns.find((c) => c.key === key);
        const numeric = col.type === 'money' || col.type === 'int';
        const nf = numeric ? parseNumericFilter(text) : null;
        const needle = normalizeText(text);
        return (row) => {
          const v = this._value(col, row);
          if (nf) return nf(Number(v) || 0);
          const s = col.type === 'date' ? `${v} ${fmtDate(v)}` : numeric ? `${v} ${fmtMoney(v)}` : v;
          return normalizeText(s).includes(needle);
        };
      });
      list = list.filter((r) => tests.every((f) => f(r)));
    }
    if (this.sort) {
      const col = this.columns.find((c) => c.key === this.sort.key);
      const dir = this.sort.dir === 'asc' ? 1 : -1;
      const numeric = col.type === 'money' || col.type === 'int';
      list = [...list].sort((a, b) => {
        const va = this._value(col, a);
        const vb = this._value(col, b);
        if (numeric) return ((Number(va) || 0) - (Number(vb) || 0)) * dir;
        return String(va ?? '').localeCompare(String(vb ?? ''), 'vi', { numeric: true, sensitivity: 'base' }) * dir;
      });
    }
    this.view = list;
    this.spacer.style.height = `${list.length * this.rowHeight}px`;
    this.emptyEl.hidden = list.length > 0;
    if (!list.length) clear(this.emptyEl).append(emptyState(this.empty));
    this._renderHead();
    this._renderWindow();
    this._renderFooter();
  }

  _cycleSort(key) {
    if (!this.sort || this.sort.key !== key) this.sort = { key, dir: 'asc' };
    else if (this.sort.dir === 'asc') this.sort = { key, dir: 'desc' };
    else this.sort = null;
    this._apply();
  }

  _renderHead() {
    for (const c of this.columns) {
      const active = this.sort?.key === c.key;
      c._headCell.setAttribute('aria-sort', active ? (this.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      const mark = c._headCell.querySelector('.sort-mark');
      clear(mark);
      if (active) mark.append(icon(this.sort.dir === 'asc' ? 'sortUp' : 'sortDown', 14));
    }
    const n = this.view.length;
    const sel = this.view.filter((r) => this.selected.has(r[this.rowKey])).length;
    this.checkAll.checked = n > 0 && sel === n;
    this.checkAll.indeterminate = sel > 0 && sel < n;
  }

  // ------------------------------------------------------------ Ảo hóa

  _schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._renderWindow(); });
  }

  _renderWindow() {
    const rh = this.rowHeight;
    const total = this.view.length;
    const top = this.viewport.scrollTop;
    const vh = this.viewport.clientHeight || 600;
    const start = Math.max(0, Math.floor(top / rh) - OVERSCAN);
    const end = Math.min(total, Math.ceil((top + vh) / rh) + OVERSCAN);
    this.rowsEl.style.transform = `translateY(${start * rh}px)`;
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) frag.append(this._rowEl(this.view[i], i));
    clear(this.rowsEl).append(frag);
  }

  _rowEl(row, index) {
    const key = row[this.rowKey];
    const isSel = this.selected.has(key);
    const tone = this.rowClass?.(row);
    const el = h(`div.grid-row.grid-data-row${isSel ? '.selected' : ''}${this.stripe && index % 2 ? '.alt' : ''}${tone ? `.row-${tone}` : ''}`, {
      role: 'row', dataset: { index }, tabindex: -1,
      onclick: (e) => { if (!e.target.closest('.cell-check, a, button, input')) this.onOpen?.(row); },
    });
    if (this.selectable) {
      el.append(h('div.grid-cell.cell-check', h('input', {
        type: 'checkbox', checked: isSel, 'aria-label': 'Chọn dòng',
        onclick: (e) => this._toggleRow(index, e.shiftKey),
      })));
    }
    for (const c of this.columns) {
      const align = c.align || (c.type === 'money' || c.type === 'int' ? 'right' : 'left');
      const cell = h(`div.grid-cell.align-${align}${c.type === 'money' ? '.num' : ''}`, { role: 'gridcell' });
      if (c.render) {
        const r = c.render(row, index);
        if (r instanceof Node) cell.append(r); else cell.textContent = r ?? '';
        cell.title = '';
      } else {
        const v = this._value(c, row);
        const text = c.type === 'money' ? fmtMoney(v) : c.type === 'int' ? fmtInt(v) : c.type === 'date' ? fmtDate(v) : (v ?? '');
        cell.textContent = text;
        cell.title = String(text);
      }
      el.append(cell);
    }
    return el;
  }

  // ------------------------------------------------------------ Chọn

  _toggleRow(index, range) {
    const key = this.view[index][this.rowKey];
    const on = !this.selected.has(key);
    if (range && this.lastClicked >= 0) {
      const [a, b] = [this.lastClicked, index].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) (on ? this.selected.add(this.view[i][this.rowKey]) : this.selected.delete(this.view[i][this.rowKey]));
    } else if (on) this.selected.add(key); else this.selected.delete(key);
    this.lastClicked = index;
    this._afterSelect();
  }

  _toggleAll() {
    const all = this.view.length > 0 && this.view.every((r) => this.selected.has(r[this.rowKey]));
    for (const r of this.view) (all ? this.selected.delete(r[this.rowKey]) : this.selected.add(r[this.rowKey]));
    this._afterSelect();
  }

  _afterSelect() {
    this._renderHead();
    this._renderWindow();
    this._renderFooter();
    this.onSelectionChange?.(this.getSelected());
  }

  _onKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && this.selectable) { e.preventDefault(); for (const r of this.view) this.selected.add(r[this.rowKey]); this._afterSelect(); }
    if (e.key === 'Escape' && this.selected.size) this.clearSelection();
  }

  // ------------------------------------------------------------ Chân bảng

  _renderFooter() {
    const sel = this.selected.size ? this.getSelected() : [];
    const basis = this.selected.size ? sel : this.view;
    const parts = [h('span', `${this.view.length.toLocaleString('vi-VN')}${this.view.length !== this.rows.length ? ` / ${this.rows.length.toLocaleString('vi-VN')}` : ''} ${this.footerLabel}`)];
    if (this.selected.size) parts.push(h('span.foot-sel', `Đã chọn ${this.selected.size.toLocaleString('vi-VN')}`));
    const sums = this.columns.filter((c) => c.sum);
    if (sums.length) {
      const wrap = h('span.foot-sums', this.selected.size ? 'Tổng đã chọn: ' : 'Tổng: ');
      sums.forEach((c, i) => wrap.append(h('span.foot-sum', `${i ? ' · ' : ''}${c.title} `, h('b', fmtMoney(sum(basis, (r) => this._value(c, r)))))));
      parts.push(wrap);
    }
    clear(this.footer).append(...parts);
  }
}
