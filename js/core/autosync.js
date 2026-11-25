/**
 * autosync.js — Tự động đồng bộ gia tăng theo chu kỳ người dùng đặt (Cài đặt → Đồng bộ).
 * Chỉ chạy khi: bật tự động đồng bộ, phiên còn hợp lệ, không có lần đồng bộ nào đang chạy.
 * Phiên "bridge" (đăng nhập bằng trang Thuế) chỉ đồng bộ qua tiện ích và chỉ khi tiện ích + trang Thuế đang sẵn sàng;
 * nếu chưa sẵn sàng thì bỏ qua lặng lẽ (không bao giờ gọi thẳng cổng Thuế bằng client của ứng dụng).
 */
import { state } from './state.js';
import { canSync, runSync } from './syncEngine.js';
import { bridgeStatus, runBridgeSync, normTax } from './bridge.js';
import { toast } from './ui.js';
import { DIRECTION } from '../config.js';
import { fmtInt } from '../utils.js';

let timer = null;
let lastRun = Date.now();

async function tick() {
  const s = state.settings;
  if (!s.autoSync || state.syncing || !canSync() || !state.companyTax) return;
  const intervalMs = Math.max(5, Number(s.syncIntervalMin) || 60) * 60000;
  if (Date.now() - lastRun < intervalMs) return;
  const bridge = state.session?.mode === 'bridge';
  if (bridge) { // cùng điều kiện với thẻ "Đăng nhập bằng trang Thuế": máy chủ cục bộ + tiện ích thấy trong 15 giây + trang Thuế đã đăng nhập
    const st = await bridgeStatus();
    if (!st || (st.job && !st.job.finished) || st.extAgeMs == null || st.extAgeMs >= 15000 || !st.ext?.loggedIn) return; // chưa sẵn sàng: thử lại ở nhịp sau
    // An toàn nhiều doanh nghiệp: MST trên trang Thuế phải khớp doanh nghiệp đang chọn, không thì bỏ qua lặng lẽ (không tự đồng bộ nhầm doanh nghiệp).
    if (st.ext?.mst && normTax(st.ext.mst) !== normTax(state.companyTax)) return;
  }
  lastRun = Date.now();
  try {
    const base = { companyTax: state.companyTax, directions: [DIRECTION.IN, DIRECTION.OUT], mode: 'incremental' };
    const r = bridge ? await runBridgeSync({ ...base, pos: true, xml: true }) : await runSync({ ...base, withDetail: !!s.syncDetail });
    toast(`Tự động đồng bộ xong: ${fmtInt(r.fetched)} hóa đơn (mới ${fmtInt(r.added)}).`, 'ok');
  } catch (e) {
    if (e.name !== 'AbortError') toast(`Tự động đồng bộ thất bại: ${e.message}`, 'bad');
  }
}

/** Bắt đầu vòng kiểm tra mỗi phút (rẻ vì chỉ so sánh thời gian). */
export function startAutoSync() {
  clearInterval(timer);
  timer = setInterval(tick, 60000);
}

/** Đặt lại mốc thời gian (gọi sau khi người dùng đồng bộ thủ công hoặc đổi chu kỳ). */
export const touchAutoSync = () => { lastRun = Date.now(); };
