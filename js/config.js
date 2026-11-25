/**
 * config.js — Cấu hình tập trung của eTax Manager.
 *
 * Mọi hằng số (tên CSDL, endpoint, ánh xạ trạng thái, thuế suất…) nằm ở đây để
 * khi cổng Thuế điện tử thay đổi, chỉ cần chỉnh một nơi.
 */

export const APP = Object.freeze({
  name: 'eTax Manager HAK Group',
  version: '1.3.11',
  dbName: 'etax-manager',
  dbVersion: 1,
});

/**
 * Cấu hình kết nối cổng hóa đơn điện tử (Tổng cục Thuế).
 * Các đường dẫn dưới đây dựa trên API công khai mà cổng tra cứu hóa đơn đang dùng.
 * Nếu cổng thay đổi, chỉ cần sửa `paths` / `params` — phần còn lại của ứng dụng không đổi.
 */
export const GDT = Object.freeze({
  baseUrl: 'https://hoadondientu.gdt.gov.vn:30000',
  paths: Object.freeze({
    captcha: '/captcha',
    login: '/security-taxpayer/authenticate',
    profile: '/security-taxpayer/profile',
    sold: '/query/invoices/sold',
    purchase: '/query/invoices/purchase',
    detail: '/query/invoices/detail',
    exportXml: '/query/invoices/export-xml',
  }),
  /** Số bản ghi mỗi trang khi gọi danh sách. */
  pageSize: 50,
  /** Cổng chỉ cho truy vấn tối đa ~1 tháng mỗi lần → ứng dụng tự chia nhỏ khoảng ngày. */
  maxRangeDays: 31,
  /** Sắp xếp mặc định. */
  sort: 'tdlap:desc,khmshdon:asc,shdon:desc',
  /** Mã trạng thái xử lý (ttxly) dùng khi lọc "đã cấp mã / không mã". */
  processing: Object.freeze({ coMa: 5, khongMa: 6 }),
  /** Tiền tố đường dẫn proxy cục bộ (xem server/server.mjs). */
  proxyPrefix: '/gdt',
});

/**
 * Các cách đặt địa chỉ API của cổng Thuế mà ứng dụng tự dò (theo thứ tự) ở chế độ "Tự động".
 * Cổng đã từng dùng cổng mạng riêng :30000 (gọi thẳng /query/…), các tài liệu gần đây mô tả đường dẫn
 * /api/… trên tên miền chính. Không có tài liệu chính thức nên ứng dụng thử lần lượt và nhớ cách nào chạy được.
 * Đường dẫn thực tế = origin + prefix + GDT.paths.*
 */
export const GDT_PROFILES = Object.freeze([
  { id: 'api', label: 'Tên miền chính + /api', origin: 'https://hoadondientu.gdt.gov.vn', prefix: '/api' },
  { id: 'legacy', label: 'Cổng riêng :30000 (cách cũ)', origin: 'https://hoadondientu.gdt.gov.vn:30000', prefix: '' },
]);

/** Cấu hình thử lại khi lỗi mạng. */
export const RETRY = Object.freeze({ attempts: 4, baseDelayMs: 800, maxDelayMs: 8000, timeoutMs: 45000 });

/** Trạng thái hóa đơn (trường tthai của cổng). */
export const INVOICE_STATUS = Object.freeze({
  1: { label: 'Hóa đơn mới', tone: 'ok', counted: true },
  2: { label: 'Hóa đơn thay thế', tone: 'ok', counted: true },
  3: { label: 'Hóa đơn điều chỉnh', tone: 'info', counted: true },
  4: { label: 'Đã bị thay thế', tone: 'muted', counted: false },
  5: { label: 'Đã bị điều chỉnh', tone: 'warn', counted: true },
  6: { label: 'Đã bị hủy', tone: 'bad', counted: false },
});

/** Trạng thái xử lý / cấp mã (trường ttxly). */
export const PROCESSING_STATUS = Object.freeze({
  5: 'Đã cấp mã hóa đơn',
  6: 'Đã nhận – không mã',
  8: 'Đã nhận – khởi tạo từ máy tính tiền',
});

export const DIRECTION = Object.freeze({
  IN: 'in', // Hóa đơn đầu vào (mua vào)
  OUT: 'out', // Hóa đơn đầu ra (bán ra)
});

export const DIRECTION_LABEL = Object.freeze({ in: 'Đầu vào', out: 'Đầu ra' });

/** Thuế suất phổ biến để nhóm trong báo cáo VAT. Giá trị chuỗi khớp `taxRateKey()`. */
export const TAX_RATES = Object.freeze(['0', '5', '8', '10', 'KCT', 'KKKNT', 'khac']);
export const TAX_RATE_LABEL = Object.freeze({
  0: '0%', 5: '5%', 8: '8%', 10: '10%', KCT: 'Không chịu thuế', KKKNT: 'Không kê khai nộp thuế', khac: 'Khác / không rõ',
});

/** Cài đặt mặc định của người dùng (lưu trong IndexedDB → settings). */
export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'auto', // auto | light | dark
  language: 'vi', // vi | en
  autoSync: false,
  syncIntervalMin: 60,
  syncDetail: false, // tải luôn chi tiết hàng hóa khi đồng bộ
  detailConcurrency: 2, // số luồng tải chi tiết hàng hóa song song (1–6)
  apiGapMs: 250, // giãn cách tối thiểu giữa các lần gọi cổng Thuế (ms)
  transport: 'auto', // auto | electron | proxy | direct
  gdtProfile: 'auto', // auto | api | legacy | custom
  baseUrl: 'https://hoadondientu.gdt.gov.vn', // chỉ dùng khi gdtProfile = custom
  apiPrefix: '/api', // chỉ dùng khi gdtProfile = custom
  proxyUrl: '', // để trống = cùng nguồn (server/server.mjs)
  saveFolderName: '', // chỉ để hiển thị; handle thật lưu ở IndexedDB
  pageSizeGrid: 50,
  excludeCancelled: true,
  lastCompany: '',
  reconcileKeywords: 'ngân hàng, bảo hiểm', // đối tác coi là "chênh lệch thường gặp" khi đối chiếu sổ
  autoBackup: false, // bật sao lưu tự động định kỳ hàng tháng
  backupDay: 20, // ngày trong tháng để chạy sao lưu tự động (nếu mở ứng dụng trễ hơn thì chạy bù ngay)
  lastBackupYM: '', // "YYYY-MM" của lần sao lưu tự động gần nhất đã chạy thành công
  lastBackupWarnYM: '', // "YYYY-MM" đã cảnh báo thiếu thư mục lưu — tránh báo lặp lại nhiều lần trong cùng tháng
});

/** Danh sách route (khớp thứ tự menu trong yêu cầu). */
export const ROUTES = Object.freeze([
  { id: 'dashboard', icon: 'dashboard', group: 'overview' },
  { id: 'login', icon: 'key', group: 'overview' },
  { id: 'sync', icon: 'sync', group: 'data' },
  { id: 'invoices-in', icon: 'inbox', group: 'data' },
  { id: 'invoices-out', icon: 'outbox', group: 'data' },
  { id: 'lookup', icon: 'search', group: 'data' },
  { id: 'xml', icon: 'code', group: 'files' },
  { id: 'pdf', icon: 'pdf', group: 'files' },
  { id: 'excel', icon: 'sheet', group: 'files' },
  { id: 'report', icon: 'chart', group: 'analysis' },
  { id: 'reconcile', icon: 'compare', group: 'analysis' },
  { id: 'customers', icon: 'users', group: 'analysis' },
  { id: 'suppliers', icon: 'truck', group: 'analysis' },
  { id: 'logs', icon: 'list', group: 'system' },
  { id: 'settings', icon: 'gear', group: 'system' },
]);
