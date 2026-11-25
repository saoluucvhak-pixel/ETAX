/**
 * invoiceGrid.js — Cột Data Grid hóa đơn và thao tác xuất/xóa dùng chung cho
 * trang Hóa đơn đầu vào, Hóa đơn đầu ra và Tra cứu.
 */
import { h } from '../utils.js';
import { INVOICE_STATUS, DIRECTION } from '../config.js';
import { statusBadge, directionBadge, toast, withLoading, confirmDialog } from './ui.js';
import { deleteInvoices } from './invoiceStore.js';
import { exportInvoicesExcel, exportInvoicesCsv, exportInvoicesJson, exportInvoicesPdf } from '../export.js';

/**
 * Cột theo yêu cầu: STT, Ngày, Số hóa đơn, Ký hiệu, MST, Khách hàng, Giá trị, Thuế, Tổng tiền, Trạng thái.
 * @param {'in'|'out'|null} direction  null = trang tra cứu (cả hai chiều → thêm cột "Chiều")
 */
export function invoiceColumns(direction) {
  const partnerTax = (r) => (r.direction === DIRECTION.OUT ? r.buyerTax : r.sellerTax) || '';
  const partnerName = (r) => (r.direction === DIRECTION.OUT ? r.buyerName : r.sellerName) || '';
  const partnerTitle = direction === DIRECTION.IN ? 'Nhà cung cấp' : direction === DIRECTION.OUT ? 'Khách hàng' : 'Đối tác';
  const cols = [
    { key: 'stt', title: 'STT', width: 64, align: 'center', sortable: false, filterable: false, render: (_r, i) => String(i + 1) },
    { key: 'date', title: 'Ngày', width: 100, type: 'date' },
    { key: 'number', title: 'Số hóa đơn', width: 118, align: 'right', render: (r) => h('b', r.number), value: (r) => Number(r.number) || r.number },
    { key: 'series', title: 'Ký hiệu', width: 94, value: (r) => `${r.template || ''}${r.series || ''}` },
  ];
  if (!direction) cols.push({ key: 'direction', title: 'Chiều', width: 96, render: (r) => directionBadge(r.direction), value: (r) => r.direction });
  cols.push(
    { key: 'partnerTax', title: 'MST', width: 122, value: partnerTax },
    { key: 'partnerName', title: partnerTitle, width: 'flex', value: partnerName },
    { key: 'net', title: 'Giá trị', width: 122, type: 'money', sum: true },
    { key: 'vat', title: 'Thuế', width: 106, type: 'money', sum: true },
    { key: 'total', title: 'Tổng tiền', width: 126, type: 'money', sum: true },
    { key: 'status', title: 'Trạng thái', width: 142, render: (r) => statusBadge(r), value: (r) => INVOICE_STATUS[r.status]?.label || r.status },
  );
  return cols;
}

/** Tùy chọn cho ô chọn trạng thái. */
export const STATUS_OPTIONS = [['', 'Mọi trạng thái'], ...Object.entries(INVOICE_STATUS).map(([k, v]) => [k, v.label])];
export const CODE_OPTIONS = [['', 'Có mã / không mã'], ['coma', 'Đã cấp mã'], ['khongma', 'Không mã']];

/** Xuất danh sách theo định dạng. `label` dùng trong tên file. */
export async function exportRows(kind, rows, label) {
  if (!rows.length) return toast('Không có hóa đơn nào để xuất.', 'warn');
  try {
    if (kind === 'xlsx') await withLoading('Đang tạo file Excel…', () => exportInvoicesExcel(rows, { label }));
    else if (kind === 'csv') await exportInvoicesCsv(rows, { label });
    else if (kind === 'json') await exportInvoicesJson(rows, { label });
    else if (kind === 'pdf') await exportInvoicesPdf(rows, { title: 'Danh sách hóa đơn' });
  } catch (e) { toast(`Xuất thất bại: ${e.message}`, 'bad'); }
}

/** Menu xuất chuẩn cho `menuButton`. `getRows` trả về dòng cần xuất (đã chọn hoặc đang lọc). */
export function exportMenuItems(getRows, label) {
  return [
    { label: 'Excel (.xlsx)', icon: 'sheet', onClick: () => exportRows('xlsx', getRows(), label) },
    { label: 'CSV', icon: 'file', onClick: () => exportRows('csv', getRows(), label) },
    { label: 'JSON', icon: 'code', onClick: () => exportRows('json', getRows(), label) },
    { label: 'PDF (in)', icon: 'pdf', onClick: () => exportRows('pdf', getRows(), label) },
  ];
}

/** Xác nhận rồi xóa các hóa đơn đã chọn khỏi CSDL cục bộ (không ảnh hưởng dữ liệu trên cổng Thuế). */
export async function confirmDelete(rows) {
  if (!rows.length) return false;
  const ok = await confirmDialog({
    title: `Xóa ${rows.length.toLocaleString('vi-VN')} hóa đơn?`,
    message: 'Chỉ xóa bản lưu trên máy này (kèm XML/PDF đính kèm). Dữ liệu trên cổng Thuế không bị ảnh hưởng; có thể đồng bộ lại bất cứ lúc nào.',
    confirmLabel: 'Xóa khỏi máy', danger: true,
  });
  if (!ok) return false;
  await deleteInvoices(rows.map((r) => r.key));
  toast(`Đã xóa ${rows.length.toLocaleString('vi-VN')} hóa đơn khỏi máy.`, 'ok');
  return true;
}
