/**
 * demo.js — Nguồn dữ liệu MẪU (không kết nối cổng Thuế).
 *
 * DemoClient có cùng giao diện với GdtClient (iterateInvoices / detail / xml) và trả về bản ghi
 * đúng cấu trúc JSON của cổng, nên toàn bộ đường đi (chuẩn hóa → lưu → hiển thị) được chạy thật.
 * Dữ liệu sinh xác định theo ngày (đồng bộ lại không tạo trùng). Toàn bộ tên/MST là hư cấu.
 */
import { DIRECTION } from '../config.js';
import { splitDateRange, sleep, addDays, todayISO } from '../utils.js';

export const DEMO_COMPANY = Object.freeze({ taxCode: '0900000001', companyName: 'CÔNG TY TNHH DEMO ETAX', userName: 'Người dùng demo' });

const CUSTOMERS = [
  ['0900100011', 'Công ty TNHH Mẫu An Phúc', '12 Đường số 1, Quận 1, TP. Hồ Chí Minh'],
  ['0900100028', 'Công ty CP Ví Dụ Bình Minh', '85 Nguyễn Văn Linh, Hải Châu, Đà Nẵng'],
  ['0900100035', 'Công ty TNHH Thương mại Mẫu Hòa Bình', '7 Lê Lợi, TP. Huế'],
  ['0900100042', 'Doanh nghiệp tư nhân Mẫu Tân Tiến', '40 Trần Phú, Nha Trang, Khánh Hòa'],
  ['0900100059', 'Công ty TNHH Sản xuất Mẫu Đại Việt', 'KCN Mẫu, Bình Dương'],
  ['0900100066', 'Công ty CP Dịch vụ Mẫu Sao Mai', '23 Hoàng Diệu, Quy Nhơn, Bình Định'],
  ['0900100073', 'Công ty TNHH Vận tải Mẫu Phương Nam', '9 Quốc lộ 1A, Quảng Ngãi'],
  ['0900100080', 'Công ty TNHH Mẫu Thiên Long Phát', '55 Hùng Vương, Tam Kỳ, Quảng Nam'],
  ['0900100097', 'Công ty CP Xuất nhập khẩu Mẫu Hải Vân', '3 Bạch Đằng, Sơn Trà, Đà Nẵng'],
  ['0900100104', 'Công ty TNHH Mẫu Kim Long', '18 Phan Chu Trinh, Hội An'],
];
const SUPPLIERS = [
  ['0900200015', 'Công ty TNHH Nguyên liệu Mẫu Xanh', 'Lô 4 KCN Mẫu, Quảng Nam'],
  ['0900200022', 'Công ty CP Điện lực Mẫu Miền Trung', '11 Trần Hưng Đạo, Đà Nẵng'],
  ['0900200039', 'Công ty TNHH Xăng dầu Mẫu Petro', '2 Nguyễn Tất Thành, Đà Nẵng'],
  ['0900200046', 'Công ty TNHH Văn phòng phẩm Mẫu Việt', '66 Lê Duẩn, Hà Nội'],
  ['0900200053', 'Công ty TNHH Bao bì Mẫu Tín Thành', 'KCN Mẫu 2, Long An'],
  ['0900200060', 'Công ty CP Viễn thông Mẫu Net', '1 Láng Hạ, Hà Nội'],
  ['0900200077', 'Công ty TNHH Bảo hiểm Mẫu An Tâm', '30 Hai Bà Trưng, TP. Hồ Chí Minh'],
  ['0900200084', 'Công ty TNHH Thiết bị Mẫu Kỹ Thuật', '14 Điện Biên Phủ, Đà Nẵng'],
];
const SALE_GOODS = [
  ['Sản phẩm mẫu loại A', 'kg', 18500], ['Sản phẩm mẫu loại B', 'kg', 12400], ['Dịch vụ tư vấn mẫu', 'giờ', 450000],
  ['Dịch vụ vận chuyển mẫu', 'chuyến', 2800000], ['Hàng hóa mẫu đóng gói', 'thùng', 96000],
];
const BUY_GOODS = [
  ['Nguyên liệu mẫu số 1', 'tấn', 1850000], ['Điện sản xuất', 'kWh', 2100], ['Nhiên liệu diesel', 'lít', 21500],
  ['Văn phòng phẩm', 'bộ', 185000], ['Bao bì đóng gói', 'cái', 4800], ['Cước viễn thông', 'tháng', 650000], ['Phụ tùng thay thế', 'cái', 730000],
];

/** PRNG có hạt giống (mulberry32) để dữ liệu ổn định. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s) => [...s].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 7);
const dayOrdinal = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);

/** Thuế suất theo thời điểm (mô phỏng: 8% giai đoạn giảm thuế, còn lại 10%). */
function vatRateFor(iso, r) {
  if (r < 0.06) return 0;
  if (r < 0.12) return 5;
  if ((iso >= '2022-02-01' && iso <= '2022-12-31') || (iso >= '2025-07-01' && iso <= '2026-12-31')) return r < 0.7 ? 8 : 10;
  return 10;
}

/** Sinh danh sách hóa đơn thô (dạng cổng) cho một ngày. */
function makeDay(iso, direction, companyTax, companyName) {
  const seed = hashStr(`${companyTax}|${direction}|${iso}`);
  const r = rng(seed);
  const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const count = wd === 0 ? (r() < 0.15 ? 1 : 0) : Math.floor(r() * (direction === DIRECTION.OUT ? 3.6 : 3.1));
  const out = [];
  const partners = direction === DIRECTION.OUT ? CUSTOMERS : SUPPLIERS;
  const goods = direction === DIRECTION.OUT ? SALE_GOODS : BUY_GOODS;
  const series = direction === DIRECTION.OUT ? `C${iso.slice(2, 4)}TMA` : `C${iso.slice(2, 4)}TAA`;
  for (let i = 0; i < count; i++) {
    const p = partners[Math.floor(r() ** 1.6 * partners.length)];
    const lines = 1 + Math.floor(r() * 3);
    const items = [];
    const byRate = new Map();
    for (let k = 0; k < lines; k++) {
      const g = goods[Math.floor(r() * goods.length)];
      const qty = Math.max(1, Math.round((1 + r() * 40) * (g[2] > 500000 ? 0.25 : 1) * 10) / 10);
      const price = Math.round(g[2] * (0.9 + r() * 0.2));
      const rate = vatRateFor(iso, r());
      const amount = Math.round(qty * price);
      const tax = Math.round((amount * rate) / 100);
      items.push({ stt: k + 1, ten: g[0], dvtinh: g[1], sluong: qty, dgia: price, thtien: amount, tsuat: `${rate}%`, tthue: tax, tchat: 1 });
      const cur = byRate.get(rate) || { tsuat: `${rate}%`, thtien: 0, tthue: 0 };
      cur.thtien += amount; cur.tthue += tax;
      byRate.set(rate, cur);
    }
    const net = items.reduce((a, x) => a + x.thtien, 0);
    const vat = items.reduce((a, x) => a + x.tthue, 0);
    const s = r();
    const tthai = s < 0.03 ? 6 : s < 0.055 ? 3 : s < 0.07 ? 4 : 1;
    const num = (dayOrdinal(iso) % 3000) * 4 + i + 1;
    const me = { nbmst: companyTax, nbten: companyName, nbdchi: '1 Đường Mẫu, Đà Nẵng' };
    const them = { nbmst: p[0], nbten: p[1], nbdchi: p[2] };
    out.push({
      ...(direction === DIRECTION.OUT ? { ...me, nmmst: p[0], nmten: p[1], nmdchi: p[2] } : { ...them, nmmst: companyTax, nmten: companyName, nmdchi: '1 Đường Mẫu, Đà Nẵng' }),
      id: `demo-${direction}-${iso}-${i}`,
      khmshdon: 1, khhdon: series, shdon: num, tdlap: `${iso}T00:00:00Z`,
      tgtcthue: net, tgtthue: vat, tgtttbso: net + vat, dvtte: 'VND', tgia: 1,
      tthai, ttxly: 5, mhdon: `${Math.floor(r() * 1e15).toString(16).toUpperCase().padStart(16, '0')}${Math.floor(r() * 1e15).toString(16).toUpperCase().padStart(16, '0')}`,
      thtttoan: r() < 0.7 ? 2 : 1, thttltsuat: [...byRate.values()], tgtttbchu: '',
      _items: items,
    });
  }
  return out;
}

export class DemoClient {
  constructor(companyTax = DEMO_COMPANY.taxCode, companyName = DEMO_COMPANY.companyName) {
    this.token = 'demo';
    this.companyTax = companyTax;
    this.companyName = companyName;
    this.latencyMs = 120;
  }

  setToken() { /* không dùng */ }

  async* iterateInvoices({ direction, from, to, codeMode = 'all', number, series, partnerTax, partnerName, signal }) {
    const chunks = splitDateRange(from, to, 31);
    for (let ci = 0; ci < chunks.length; ci++) {
      if (signal?.aborted) throw new DOMException('Đã hủy', 'AbortError');
      await sleep(this.latencyMs);
      const [f, t] = chunks[ci];
      let all = [];
      for (let d = f; d <= t; d = addDays(d, 1)) all.push(...makeDay(d, direction, this.companyTax, this.companyName));
      if (codeMode === 'khongma') all = [];
      if (number) all = all.filter((x) => String(x.shdon).includes(String(number)));
      if (series) all = all.filter((x) => x.khhdon.toLowerCase().includes(String(series).toLowerCase()));
      if (partnerTax) all = all.filter((x) => (direction === DIRECTION.OUT ? x.nmmst : x.nbmst).includes(partnerTax));
      if (partnerName) all = all.filter((x) => (direction === DIRECTION.OUT ? x.nmten : x.nbten).toLowerCase().includes(String(partnerName).toLowerCase()));
      for (let i = 0; i < all.length || i === 0; i += 50) {
        const page = all.slice(i, i + 50).map(({ _items, ...raw }) => raw);
        yield { items: page, chunk: [f, t], chunkIndex: ci, chunkCount: chunks.length, total: all.length };
        if (i + 50 >= all.length) break;
      }
    }
  }

  /** Dựng lại chi tiết từ ID/ngày (cùng hạt giống nên trùng với danh sách). */
  async detail(inv) {
    await sleep(this.latencyMs / 2);
    const iso = inv.date;
    const hit = makeDay(iso, inv.direction, this.companyTax, this.companyName).find((x) => x.khhdon === inv.series && String(x.shdon) === String(inv.number));
    if (!hit) throw new Error('Không tìm thấy hóa đơn mẫu');
    return { hdhhdvu: hit._items, thttltsuat: hit.thttltsuat, thtttoan: hit.thtttoan };
  }

  async xml(inv) {
    const det = await this.detail(inv);
    return buildInvoiceXml(inv, det.hdhhdvu);
  }
}

/** Dựng XML hóa đơn theo cấu trúc TT78 (dùng cho dữ liệu mẫu & kiểm thử). */
export function buildInvoiceXml(inv, rawItems = []) {
  const x = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const items = (rawItems.length ? rawItems : (inv.items || []).map((i) => ({ stt: i.stt, ten: i.name, dvtinh: i.unit, sluong: i.qty, dgia: i.price, thtien: i.amount, tsuat: `${i.rate}%`, tthue: i.tax, tchat: i.kind })));
  const rates = inv.taxBreakdown?.length ? inv.taxBreakdown : [];
  return `<?xml version="1.0" encoding="UTF-8"?>
<HDon>
  <DLHDon Id="data">
    <TTChung>
      <PBan>2.1.0</PBan><THDon>Hóa đơn giá trị gia tăng</THDon>
      <KHMSHDon>${x(inv.template || 1)}</KHMSHDon><KHHDon>${x(inv.series)}</KHHDon><SHDon>${x(inv.number)}</SHDon>
      <NLap>${x(inv.date)}</NLap><DVTTe>${x(inv.currency || 'VND')}</DVTTe><TGia>1</TGia><HTTToan>2</HTTToan>
    </TTChung>
    <NDHDon>
      <NBan><Ten>${x(inv.sellerName)}</Ten><MST>${x(inv.sellerTax)}</MST><DChi>${x(inv.sellerAddress)}</DChi></NBan>
      <NMua><Ten>${x(inv.buyerName)}</Ten><MST>${x(inv.buyerTax)}</MST><DChi>${x(inv.buyerAddress)}</DChi></NMua>
      <DSHHDVu>${items.map((it) => `
        <HHDVu><TChat>${it.tchat || 1}</TChat><STT>${it.stt}</STT><THHDVu>${x(it.ten)}</THHDVu><DVTinh>${x(it.dvtinh)}</DVTinh><SLuong>${it.sluong}</SLuong><DGia>${it.dgia}</DGia><ThTien>${it.thtien}</ThTien><TSuat>${x(it.tsuat)}</TSuat></HHDVu>`).join('')}
      </DSHHDVu>
      <TToan>
        <THTTLTSuat>${rates.map((r) => `<LTSuat><TSuat>${r.rate === 'KCT' || r.rate === 'KKKNT' ? r.rate : `${r.rate}%`}</TSuat><ThTien>${r.base}</ThTien><TThue>${r.tax}</TThue></LTSuat>`).join('')}</THTTLTSuat>
        <TgTCThue>${inv.net}</TgTCThue><TgTThue>${inv.vat}</TgTThue><TgTTTBSo>${inv.total}</TgTTTBSo><TgTTTBChu>${x(inv.totalInWords || '')}</TgTTTBChu>
      </TToan>
    </NDHDon>
  </DLHDon>
  ${inv.invoiceCode ? `<MCCQT>${x(inv.invoiceCode)}</MCCQT>` : ''}
  <DSCKS><NBan><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>DEMO</SignatureValue></Signature></NBan></DSCKS>
</HDon>`;
}

/** Khoảng ngày mặc định cho nạp dữ liệu mẫu: 12 tháng gần nhất. */
export function defaultDemoRange() {
  const to = todayISO();
  return [addDays(to, -365), to];
}
