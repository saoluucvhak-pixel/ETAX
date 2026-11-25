/**
 * lookup.js — Trang "Tra cứu": tìm hóa đơn theo số, ký hiệu, MST, tên, khoảng ngày, khoảng tiền, trạng thái.
 * Tìm trên toàn bộ dữ liệu đã lưu của doanh nghiệp (cả hai chiều) bằng bộ nhớ đệm RAM nên phản hồi tức thời.
 */
import { h, debounce, fmtInt, fmtMoney, sum } from '../utils.js';
import { state, bus } from '../core/state.js';
import { DataGrid } from '../core/datagrid.js';
import { loadInvoices, filterInvoices } from '../core/invoiceStore.js';
import { invoiceColumns, STATUS_OPTIONS, CODE_OPTIONS, exportMenuItems } from '../core/invoiceGrid.js';
import { icon, select, field, menuButton, emptyState } from '../core/ui.js';
import { openInvoiceDrawer } from '../invoiceDetail.js';
import { isCounted } from '../core/normalizer.js';
import { logger } from '../logger.js';
import { go } from '../core/router.js';

export const fill = true;

export async function mount(host, { params }) {
  if (!state.companyTax) {
    host.append(h('section.panel', emptyState({ title: 'Chưa chọn doanh nghiệp', text: 'Đăng nhập hoặc chọn doanh nghiệp để tra cứu.', action: h('button.btn.primary', { onclick: () => go('login') }, 'Đến trang đăng nhập') })));
    return null;
  }
  let all = [];
  const grid = new DataGrid({ columns: invoiceColumns(null), footerLabel: 'kết quả', onOpen: (inv) => openInvoiceDrawer(inv), empty: { title: 'Không tìm thấy hóa đơn phù hợp', text: 'Thử bỏ bớt điều kiện hoặc gõ ít từ hơn. Tìm không phân biệt dấu.' } });

  const q = h('input', { type: 'search', value: params.q || '', placeholder: 'Số hóa đơn, MST, tên, ký hiệu, số tiền…' });
  const dir = select([['', 'Cả hai chiều'], ['in', 'Đầu vào'], ['out', 'Đầu ra']], '');
  const from = h('input', { type: 'date' });
  const to = h('input', { type: 'date' });
  const series = h('input', { type: 'text', placeholder: 'Ký hiệu' });
  const number = h('input', { type: 'text', placeholder: 'Số hóa đơn' });
  const tax = h('input', { type: 'text', placeholder: 'MST' });
  const name = h('input', { type: 'text', placeholder: 'Tên người mua/bán' });
  const minT = h('input', { type: 'number', placeholder: 'Từ (đ)', min: 0 });
  const maxT = h('input', { type: 'number', placeholder: 'Đến (đ)', min: 0 });
  const status = select(STATUS_OPTIONS, '');
  const code = select(CODE_OPTIONS, '');
  const summary = h('div.muted');
  const inputs = [q, dir, from, to, series, number, tax, name, minT, maxT, status, code];

  const criteria = () => ({
    q: q.value, direction: dir.value || undefined, from: from.value, to: to.value, series: series.value, number: number.value, taxCode: tax.value,
    name: name.value, minTotal: minT.value, maxTotal: maxT.value, status: status.value ? [status.value] : null, codeStatus: code.value,
  });

  function run() {
    const rows = filterInvoices(all, criteria());
    grid.setRows(rows);
    const counted = rows.filter(isCounted);
    summary.textContent = `${fmtInt(rows.length)} hóa đơn — tổng tiền (không tính hủy/bị thay thế) ${fmtMoney(sum(counted, (r) => r.total))} đ`;
  }
  const runDebounced = debounce(run, 150);
  const log = () => logger.info('search', 'Tra cứu hóa đơn', { ...Object.fromEntries(Object.entries(criteria()).filter(([, v]) => v && !(Array.isArray(v) && !v.length))), results: grid.getView().length });
  inputs.forEach((el) => { el.addEventListener('input', runDebounced); el.addEventListener('change', run); });
  inputs.forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { run(); log(); } }));

  const reset = () => { inputs.forEach((el) => { el.value = ''; }); run(); q.focus(); };
  const exportBtn = menuButton('Xuất', exportMenuItems(() => (grid.getSelected().length ? grid.getSelected() : grid.getView()), 'TraCuuHoaDon'));

  host.append(
    h('section.panel', { style: { padding: '14px 16px' } },
      h('div.toolbar', { style: { marginBottom: '12px' } }, h('div.quick-search', { style: { position: 'relative', flex: 1, maxWidth: 'none', margin: 0 } }, icon('search', 16), q),
        h('button.btn.primary', { type: 'button', onclick: () => { run(); log(); } }, icon('search', 16), h('span', 'Tra cứu')),
        h('button.btn', { type: 'button', onclick: reset }, icon('x', 16), h('span', 'Xóa điều kiện')), exportBtn),
      h('div.filters-bar', field('Chiều', dir), field('Từ ngày', from), field('Đến ngày', to), field('Ký hiệu', series), field('Số hóa đơn', number), field('MST', tax), field('Tên', name),
        field('Tiền từ', minT), field('Tiền đến', maxT), field('Trạng thái', status), field('Cấp mã', code))),
    summary, grid.el);

  const reload = async () => { all = await loadInvoices(state.companyTax); run(); };
  await reload();
  if (params.q) log();
  q.focus();
  const offs = [bus.on('invoices:change', reload), bus.on('company:change', reload)];
  return () => offs.forEach((f) => f());
}
