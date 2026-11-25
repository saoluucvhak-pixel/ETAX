/**
 * reconcile3Templates.js — Tạo tệp Excel MẪU (sổ sách, danh sách HĐĐT Cục Thuế) cho trang Đối chiếu 3 nguồn.
 * Dòng tiêu đề nằm ở dòng 4 (sau tiêu đề, kỳ, dòng trống); công cụ tự dò nên không bắt buộc đúng vị trí.
 */
import { exportSheets } from '../export.js';

const guide = (name, lines) => ({ name, columns: [{ header: 'CỘT BẮT BUỘC ĐỂ CÔNG CỤ TỰ NHẬN DIỆN ĐƯỢC', key: 0, width: 110, type: 'text' }], rows: lines.map((l) => [l]) });
const cols = (headers, moneyIdx) => headers.map((header, i) => ({ header, key: i, width: Math.max(12, Math.min(34, header.length + 4)), type: moneyIdx.includes(i) ? 'money' : 'text' }));

/** Mẫu sổ sách kế toán (bảng kê mua vào / bán ra từ phần mềm). */
export function templateSoSach(loai) {
  const mua = loai === 'mua';
  const headers = mua
    ? ['Ký hiệu mẫu HĐ', 'Ký hiệu HĐ', 'Số chứng từ', 'Ngày hóa đơn', 'Số hóa đơn', 'Tên người bán', 'MST người bán', 'Giá trị HHDV mua vào chưa có thuế', 'Thuế GTGT', 'Tổng thanh toán']
    : ['Ký hiệu mẫu HĐ', 'Ký hiệu HĐ', 'Số chứng từ', 'Ngày hóa đơn', 'Số hóa đơn', 'Tên người mua', 'MST người mua', 'Doanh số bán chưa có thuế GTGT', 'Thuế GTGT', 'Tổng thanh toán'];
  const rows = mua
    ? [['1', 'C26TPN', 'PCDN00301/01', '05/08/2026', '1234', 'CÔNG TY TNHH VÍ DỤ A', '0400123456', 5000000, 400000, 5400000], ['1', 'C26TPN', 'PCDN00302/01', '12/08/2026', '1235', 'CÔNG TY TNHH VÍ DỤ B', '0400654321', 12000000, 960000, 12960000], ['1', 'C26TPN', 'PCDN00303/01', '20/08/2026', '1236', 'CÔNG TY TNHH VÍ DỤ C', '0400111222', 3000000, 240000, 3240000]]
    : [['1', 'C26TBB', 'HDBR00001/01', '05/08/2026', '501', 'CÔNG TY TNHH KHÁCH HÀNG A', '0400777888', 8000000, 640000, 8640000], ['1', 'C26TBB', 'HDBR00002/01', '14/08/2026', '502', 'CÔNG TY TNHH KHÁCH HÀNG B', '0400999000', 15000000, 1200000, 16200000], ['1', 'C26TBB', 'HDBR00003/01', '22/08/2026', '503', 'CÔNG TY TNHH KHÁCH HÀNG C', '0400333444', 6000000, 480000, 6480000]];
  return exportSheets(mua ? 'MAU_bang_ke_mua_vao_phan_mem' : 'MAU_bang_ke_ban_ra_phan_mem', [
    { name: 'Báo cáo', title: `BẢNG KÊ HÓA ĐƠN, CHỨNG TỪ HÀNG HÓA, DỊCH VỤ ${mua ? 'MUA VÀO' : 'BÁN RA'} (MẪU QUẢN TRỊ)`, subtitle: 'Tháng 8 năm 2026', columns: cols(headers, [7, 8, 9]), rows },
    guide('Hướng dẫn', ['Bắt buộc có 1 trong 2: cột "Ký hiệu hóa đơn"/"Ký hiệu HĐ" HOẶC cột "Số chứng từ"', 'Bắt buộc có cột "Số hóa đơn"',
      'Cần thêm ít nhất 2 trong 3 cột: Ngày (lập/hóa đơn/chứng từ/hạch toán), Giá trị (chưa thuế), Thuế GTGT', 'Tên cột không cần trùng khớp tuyệt đối — công cụ tự dò theo từ khóa gần đúng', 'Dòng tiêu đề không cần cố định ở dòng nào — công cụ tự dò trong 10 dòng đầu mỗi sheet']),
  ]);
}

/** Mẫu danh sách hóa đơn tải từ Cục Thuế. */
export function templateHDDT(loai) {
  const mua = loai === 'mua';
  const headers = ['STT', 'Ký hiệu mẫu số', 'Ký hiệu hóa đơn', 'Số hóa đơn', 'Ngày lập', 'MST người bán', 'Tên người bán', 'MST người mua', 'Tên người mua', 'Tổng tiền chưa thuế', 'Tổng tiền thuế', 'Tổng tiền chiết khấu thương mại', 'Tổng tiền thanh toán', 'Trạng thái hóa đơn'];
  const cty = ['0401633440', 'CÔNG TY TNHH HIỆP VĨNH AN'];
  const rows = mua
    ? [[1, '1', 'C26TPN', '1234', '05/08/2026', '0400123456', 'CÔNG TY TNHH VÍ DỤ A', ...cty, 5000000, 400000, 0, 5400000, 'Hóa đơn mới'], [2, '1', 'C26TPN', '1235', '12/08/2026', '0400654321', 'CÔNG TY TNHH VÍ DỤ B', ...cty, 12000000, 960000, 0, 12960000, 'Hóa đơn mới'], [3, '1', 'C26TPN', '1236', '20/08/2026', '0400111222', 'CÔNG TY TNHH VÍ DỤ C', ...cty, 3000000, 240000, 0, 3240000, 'Hóa đơn mới']]
    : [[1, '1', 'C26TBB', '501', '05/08/2026', ...cty, '0400777888', 'CÔNG TY TNHH KHÁCH HÀNG A', 8000000, 640000, 0, 8640000, 'Hóa đơn mới'], [2, '1', 'C26TBB', '502', '14/08/2026', ...cty, '0400999000', 'CÔNG TY TNHH KHÁCH HÀNG B', 15000000, 1200000, 0, 16200000, 'Hóa đơn mới'], [3, '1', 'C26TBB', '503', '22/08/2026', ...cty, '0400333444', 'CÔNG TY TNHH KHÁCH HÀNG C', 6000000, 480000, 0, 6480000, 'Hóa đơn mới']];
  return exportSheets(mua ? 'MAU_danh_sach_hoa_don_cuc_thue_mua_vao' : 'MAU_danh_sach_hoa_don_cuc_thue_ban_ra', [
    { name: 'sheet 1', title: 'DANH SÁCH HÓA ĐƠN', subtitle: 'Từ ngày 01/08/2026 đến ngày 31/08/2026', columns: cols(headers, [9, 10, 11, 12]), rows },
    guide('Hướng dẫn', ['Bắt buộc có cột "Ký hiệu hóa đơn" và "Số hóa đơn"', 'Cần thêm ít nhất 2 trong 3 cột: Ngày lập, Tổng tiền chưa thuế, Tổng tiền thuế',
      'File tải từ Cục Thuế thường tách thành nhiều file theo loại (không mã/có mã/máy tính tiền) — có thể chọn NHIỀU FILE cùng lúc ở ô "HĐĐT Cục Thuế", công cụ tự gộp lại']),
  ]);
}
