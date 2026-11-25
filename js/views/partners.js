/**
 * partners.js — "Khách hàng" (người mua trên hóa đơn đầu ra) và "Nhà cung cấp" (người bán trên hóa đơn đầu vào).
 * Tổng hợp theo MST: số hóa đơn, giá trị, thuế, lần giao dịch đầu/cuối; bấm vào dòng để xem hóa đơn và ghi chú.
 */
import { h, fmtInt, fmtMoney, fmtDate, periodRange, debounce, normalizeText } from '../utils.js';
import { state, bus } from '../core/state.js';
import { DIRECTION } from '../config.js';
import { repos } from '../storage.js';
import { DataGrid } from '../core/datagrid.js';
import { loadInvoices, filterInvoices } from '../core/invoiceStore.js';
import { partnerStats } from '../core/reports.js';
import { invoiceColumns, exportRows } from '../core/invoiceGrid.js';
import { icon, select, menuButton, openDrawer, emptyState, toast } from '../core/ui.js';
import { exportSheets } from '../export.js';
import { openInvoiceDrawer } from '../invoiceDetail.js';
import { go } from '../core/router.js';

export const fill = true;

const PERIODS = [['', 'Mọi thời gian'], ['month', 'Tháng này'], ['quarter', 'Quý này'], ['year', 'Năm nay'], ['lastYear', 'Năm trước']];

export async function mount(host, { route }) {
  const kind = route === 'suppliers' ? 'suppliers' : 'customers';
  const isCust = kind === 'customers';
  const direction = isCust ? DIRECTION.OUT : DIRECTION.IN;
  const noun = isCust ? 'khách hàng' : 'nhà cung cấp';
  if (!state.companyTax) {
    host.append(h('section.panel', emptyState({ title: 'Chưa chọn doanh nghiệp', text: `Đăng nhập hoặc chọn doanh nghiệp để xem ${noun}.`, action: h('button.btn.primary', { onclick: () => go('login') }, 'Đến trang đăng nhập') })));
    return null;
  }
  let all = [];
  let period = '';
  let needle = '';

  const grid = new DataGrid({
    rowKey: 'id', footerLabel: noun,
    columns: [
      { key: 'stt', title: 'STT', width: 60, align: 'center', sortable: false, filterable: false, render: (_r, i) => String(i + 1) },
      { key: 'tax', title: 'MST', width: 130, render: (r) => (r.tax ? r.tax : h('span.muted', 'Không có MST')) },
      { key: 'name', title: isCust ? 'Khách hàng' : 'Nhà cung cấp', width: 'flex' },
      { key: 'count', title: 'Số HĐ', width: 84, type: 'int', sum: false },
      { key: 'net', title: 'Giá trị', width: 140, type: 'money', sum: true },
      { key: 'vat', title: 'Thuế', width: 120, type: 'money', sum: true },
      { key: 'total', title: 'Tổng tiền', width: 146, type: 'money', sum: true },
      { key: 'first', title: 'Lần đầu', width: 104, type: 'date' },
      { key: 'last', title: 'Gần nhất', width: 104, type: 'date' },
    ],
    onOpen: (p) => openPartner(p),
    empty: { title: `Chưa có ${noun}`, text: `${isCust ? 'Khách hàng xuất hiện khi có hóa đơn đầu ra' : 'Nhà cung cấp xuất hiện khi có hóa đơn đầu vào'} trong kỳ đã chọn.` },
  });

  const search = h('input', { type: 'search', placeholder: `Tìm ${noun} theo MST, tên, địa chỉ…`, 'aria-label': `Tìm ${noun}` });
  const per = select(PERIODS, '');
  const exportBtn = menuButton('Xuất', [{ label: 'Danh sách (Excel)', icon: 'sheet', onClick: exportList }]);

  function apply() {
    const [f, t] = period ? periodRange(period) : [undefined, undefined];
    let rows = partnerStats(filterInvoices(all, { direction, from: f, to: t }), kind).map((r) => ({ ...r, id: r.tax || `#${r.name}` }));
    if (needle) rows = rows.filter((r) => normalizeText(`${r.tax} ${r.name} ${r.address}`).includes(needle));
    grid.setRows(rows);
  }
  search.addEventListener('input', debounce(() => { needle = normalizeText(search.value); apply(); }, 150));
  per.addEventListener('change', () => { period = per.value; apply(); });

  async function exportList() {
    const rows = grid.getSelected().length ? grid.getSelected() : grid.getView();
    if (!rows.length) return toast(`Không có ${noun} để xuất.`, 'warn');
    await exportSheets(`${isCust ? 'KhachHang' : 'NhaCungCap'}_${state.companyTax}`, [{
      name: isCust ? 'Khách hàng' : 'Nhà cung cấp', title: isCust ? 'TỔNG HỢP KHÁCH HÀNG' : 'TỔNG HỢP NHÀ CUNG CẤP', subtitle: [`Doanh nghiệp: ${state.companyTax}`],
      columns: [{ header: 'MST', key: 'tax', width: 16 }, { header: 'Tên', key: 'name', width: 42 }, { header: 'Địa chỉ', key: 'address', width: 44 }, { header: 'Số hóa đơn', key: 'count', type: 'number', width: 12 },
        { header: 'Giá trị chưa thuế', key: 'net', type: 'money', width: 18 }, { header: 'Thuế', key: 'vat', type: 'money', width: 16 }, { header: 'Tổng tiền', key: 'total', type: 'money', width: 18 },
        { header: 'Lần đầu', key: 'first', type: 'date', width: 12 }, { header: 'Gần nhất', key: 'last', type: 'date', width: 12 }],
      rows, totals: ['net', 'vat', 'total'],
    }], { rows: rows.length });
  }

  /** Ngăn kéo đối tác: thông tin, ghi chú, danh sách hóa đơn. */
  async function openPartner(p) {
    const noteKey = `${state.companyTax}|${kind}|${p.id}`;
    const saved = await repos.partnerNotes.get(noteKey);
    const invs = filterInvoices(all, { direction }).filter((i) => (isCust ? (i.buyerTax || `#${i.buyerName}`) : (i.sellerTax || `#${i.sellerName}`)) === p.id);
    const note = h('textarea.note-area', { placeholder: 'Ghi chú nội bộ về đối tác này…' });
    note.value = saved?.note || '';
    const invGrid = new DataGrid({ columns: invoiceColumns(direction).filter((c) => !['partnerTax', 'partnerName'].includes(c.key)), selectable: false, footerLabel: 'hóa đơn', onOpen: (inv) => openInvoiceDrawer(inv) });
    const gridBox = h('div', { style: { height: '340px', display: 'flex' } }, invGrid.el);
    openDrawer({
      title: p.name, subtitle: p.tax ? `MST ${p.tax}` : 'Không có MST', width: 860,
      actions: [h('button.btn.sm', { type: 'button', onclick: () => exportRows('xlsx', invs, `HoaDon_${p.tax || 'khachle'}`) }, icon('sheet', 15), h('span', 'Xuất hóa đơn'))],
      body: h('div', { style: { display: 'contents' } },
        h('section', h('h3.section-title', 'Tổng hợp'), h('dl.kv-list', h('dt', 'Địa chỉ'), h('dd', p.address || '—'), h('dt', 'Số hóa đơn'), h('dd', fmtInt(p.count)), h('dt', 'Giá trị chưa thuế'), h('dd', fmtMoney(p.net)),
          h('dt', 'Thuế GTGT'), h('dd', fmtMoney(p.vat)), h('dt', 'Tổng tiền'), h('dd', h('b', fmtMoney(p.total))), h('dt', 'Giao dịch'), h('dd', `${fmtDate(p.first)} → ${fmtDate(p.last)}`))),
        h('section', h('h3.section-title', 'Ghi chú'), note, h('div', { style: { marginTop: '8px' } }, h('button.btn.sm.primary', { type: 'button', onclick: async () => { await repos.partnerNotes.put({ key: noteKey, note: note.value.trim(), updatedAt: Date.now() }); toast('Đã lưu ghi chú.', 'ok'); } }, icon('save', 15), h('span', 'Lưu ghi chú')))),
        h('section', h('h3.section-title', 'Hóa đơn'), gridBox)),
    });
    invGrid.setRows(invs);
  }

  host.append(h('div.toolbar', search, per, h('span.spacer'), exportBtn), grid.el);
  const reload = async () => { all = await loadInvoices(state.companyTax); apply(); };
  await reload();
  const offs = [bus.on('invoices:change', reload), bus.on('company:change', reload)];
  return () => offs.forEach((f) => f());
}
