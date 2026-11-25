/**
 * invoice.js — Trang "Hóa đơn đầu vào" và "Hóa đơn đầu ra": Data Grid có lọc, sắp xếp, tìm kiếm, chọn nhiều.
 * Cùng một module phục vụ hai route; chiều hóa đơn lấy từ ctx.route.
 */
import { h, debounce, periodRange, fmtInt } from './utils.js';
import { DIRECTION } from './config.js';
import { state, bus } from './core/state.js';
import { DataGrid } from './core/datagrid.js';
import { loadInvoices, filterInvoices } from './core/invoiceStore.js';
import { invoiceColumns, STATUS_OPTIONS, CODE_OPTIONS, exportMenuItems, confirmDelete } from './core/invoiceGrid.js';
import { icon, select, menuButton, emptyState } from './core/ui.js';
import { openInvoiceDrawer } from './invoiceDetail.js';
import { go } from './core/router.js';
import { logger } from './logger.js';

export const fill = true;

const PERIOD_OPTIONS = [['', 'Mọi thời gian'], ['month', 'Tháng này'], ['lastMonth', 'Tháng trước'], ['quarter', 'Quý này'], ['lastQuarter', 'Quý trước'], ['year', 'Năm nay'], ['lastYear', 'Năm trước'], ['custom', 'Tùy chọn…']];

export async function mount(host, { route }) {
  const direction = route === 'invoices-out' ? DIRECTION.OUT : DIRECTION.IN;
  const label = direction === DIRECTION.OUT ? 'HoaDonDauRa' : 'HoaDonDauVao';
  const noun = direction === DIRECTION.OUT ? 'đầu ra' : 'đầu vào';
  let all = [];
  const f = { q: '', period: '', from: '', to: '', status: '', codeStatus: '' };

  const grid = new DataGrid({
    columns: invoiceColumns(direction),
    footerLabel: 'hóa đơn',
    onOpen: (inv) => openInvoiceDrawer(inv),
    onSelectionChange: (sel) => { delBtn.hidden = !sel.length; delBtn.querySelector('span:not(.ic)').textContent = `Xóa ${fmtInt(sel.length)} đã chọn`; },
    empty: { title: `Không có hóa đơn ${noun}`, text: 'Đổi bộ lọc, hoặc vào Đồng bộ dữ liệu để tải hóa đơn từ cổng Thuế.' },
  });

  const q = h('input', { type: 'search', placeholder: 'Tìm số, MST, tên, ký hiệu, số tiền…', 'aria-label': 'Tìm trong danh sách' });
  const period = select(PERIOD_OPTIONS, '', { 'aria-label': 'Kỳ' });
  const from = h('input', { type: 'date', hidden: true, 'aria-label': 'Từ ngày' });
  const to = h('input', { type: 'date', hidden: true, 'aria-label': 'Đến ngày' });
  const status = select(STATUS_OPTIONS, '', { 'aria-label': 'Trạng thái' });
  const code = select(CODE_OPTIONS, '', { 'aria-label': 'Cấp mã' });
  const filterBtn = h('button.btn', { type: 'button', onclick: () => filterBtn.classList.toggle('primary', grid.toggleFilters()) }, icon('filter', 16), h('span', 'Lọc theo cột'));
  const delBtn = h('button.btn.danger', { type: 'button', hidden: true, onclick: async () => { if (await confirmDelete(grid.getSelected())) grid.clearSelection(); } }, icon('trash', 16), h('span', 'Xóa'));
  const exportBtn = menuButton('Xuất', exportMenuItems(() => (grid.getSelected().length ? grid.getSelected() : grid.getView()), label));

  function apply() {
    const [pf, pt] = f.period && f.period !== 'custom' ? periodRange(f.period) : [f.from, f.to];
    grid.setRows(filterInvoices(all, { direction, q: f.q, from: pf, to: pt, status: f.status ? [f.status] : null, codeStatus: f.codeStatus }));
  }
  const applyDebounced = debounce(apply, 120);
  q.addEventListener('input', () => { f.q = q.value; applyDebounced(); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && q.value.trim()) logger.info('search', `Tìm hóa đơn ${noun}: "${q.value.trim()}"`, { direction, results: grid.getView().length }); });
  period.addEventListener('change', () => { f.period = period.value; from.hidden = to.hidden = f.period !== 'custom'; apply(); });
  from.addEventListener('change', () => { f.from = from.value; apply(); });
  to.addEventListener('change', () => { f.to = to.value; apply(); });
  status.addEventListener('change', () => { f.status = status.value; apply(); });
  code.addEventListener('change', () => { f.codeStatus = code.value; apply(); });

  async function reload() {
    all = await loadInvoices(state.companyTax);
    apply();
  }

  if (!state.companyTax) {
    host.append(h('section.panel', emptyState({ title: 'Chưa chọn doanh nghiệp', text: 'Đăng nhập hoặc chọn doanh nghiệp để xem hóa đơn.', action: h('button.btn.primary', { onclick: () => go('login') }, 'Đến trang đăng nhập') })));
    return null;
  }

  host.append(
    h('div.toolbar', q, period, from, to, status, code, h('span.spacer'), delBtn, filterBtn, exportBtn),
    grid.el,
  );
  await reload();
  const offs = [bus.on('invoices:change', reload), bus.on('company:change', reload)];
  return () => offs.forEach((off) => off());
}
