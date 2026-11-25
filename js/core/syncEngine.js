/**
 * syncEngine.js — Điều phối đồng bộ: tải danh sách → chuẩn hóa → lưu từng trang → (tùy chọn) tải chi tiết.
 *
 * - Đồng bộ gia tăng: mỗi (doanh nghiệp, chiều) nhớ ngày đã đồng bộ tới đâu; lần sau chỉ tải từ
 *   (ngày đó − 3 ngày) để bắt kịp hóa đơn lập muộn/đổi trạng thái.
 * - Lưu ngay sau mỗi trang nên nếu bị ngắt giữa chừng, dữ liệu đã tải không mất.
 * - Có thể hủy bằng AbortSignal; lỗi phiên (401/403) đánh dấu phiên hết hạn.
 */
import { DIRECTION, DIRECTION_LABEL } from '../config.js';
import { gdt, AuthError } from '../api.js';
import { DemoClient } from './demo.js';
import { repos, SyncStateRepository } from '../storage.js';
import { bus, state, setSession } from './state.js';
import { fromGdtSummary, detailFromGdt } from './normalizer.js';
import { logger } from '../logger.js';
import { addDays, todayISO, pool } from '../utils.js';

const OVERLAP_DAYS = 3;
const demoClients = new Map();

/** Trả về client phù hợp với phiên hiện tại (cổng Thuế thật hoặc dữ liệu mẫu). */
export function getClient() {
  const s = state.session;
  if (s?.mode === 'demo') {
    if (!demoClients.has(s.taxCode)) demoClients.set(s.taxCode, new DemoClient(s.taxCode, s.companyName));
    return demoClients.get(s.taxCode);
  }
  return gdt;
}

export const canSync = () => {
  const s = state.session;
  return !!s && s.status === 'active' && (s.mode === 'gdt' || s.mode === 'demo' || s.mode === 'bridge');
};

/** Có gọi được cổng Thuế / dữ liệu mẫu để tải chi tiết, XML từng hóa đơn không (qua tiện ích thì chưa hỗ trợ). */
export const canFetchRemote = () => {
  const s = state.session;
  return !!s && s.status === 'active' && (s.mode === 'gdt' || s.mode === 'demo');
};

/** Tính khoảng ngày cho chế độ gia tăng của từng chiều. */
export async function incrementalRange(companyTax, direction, fallbackFrom) {
  const st = await repos.syncState.get(SyncStateRepository.makeKey(companyTax, direction));
  const from = st?.lastTo ? addDays(st.lastTo, -OVERLAP_DAYS) : fallbackFrom;
  return [from, todayISO()];
}

/** Ghi mốc đồng bộ gia tăng cho một (doanh nghiệp, chiều) — dùng chung cho cả API trực tiếp và cầu nối. */
export async function checkpointSync({ companyTax, direction, from, to, count, mode }) {
  return repos.syncState.put({
    key: SyncStateRepository.makeKey(companyTax, direction),
    companyTax,
    direction,
    lastSyncAt: Date.now(),
    lastFrom: from,
    lastTo: to,
    lastCount: count,
    mode,
  });
}

/**
 * Chạy đồng bộ.
 * @param {object} o
 * @param {string} o.companyTax
 * @param {string[]} o.directions  ['in','out']
 * @param {string} [o.from] [o.to]  bắt buộc nếu mode='range'
 * @param {'range'|'incremental'} [o.mode]
 * @param {string} [o.fallbackFrom]  ngày bắt đầu nếu chưa từng đồng bộ (mode incremental)
 * @param {'all'|'coma'|'khongma'} [o.codeMode]
 * @param {object} [o.filters]  {number, series, partnerTax, partnerName}
 * @param {boolean} [o.withDetail]
 * @param {AbortSignal} [o.signal]
 * @param {(p:{pct:number,message:string,detail?:string})=>void} [o.onProgress]
 */
export async function runSync(o) {
  const { companyTax, directions, mode = 'range', codeMode = 'all', filters = {}, withDetail = false, signal, onProgress = () => {} } = o;
  if (!canSync()) throw new Error('Cần đăng nhập (hoặc bật dữ liệu mẫu) trước khi đồng bộ.');
  if (!directions.length) throw new Error('Chưa chọn chiều hóa đơn (đầu vào / đầu ra).');

  const client = getClient();
  const t0 = performance.now();
  const result = { added: 0, updated: 0, fetched: 0, detailed: 0, byDirection: {}, errors: [] };
  const touched = []; // hóa đơn cần lấy chi tiết
  state.syncing = true;
  bus.emit('sync:progress', { running: true, pct: 0, message: 'Bắt đầu đồng bộ…' });
  const report = (pct, message, detail, count) => { onProgress({ pct, message, detail, count }); bus.emit('sync:progress', { running: true, pct, message }); };

  try {
    const listShare = withDetail ? 0.7 : 1;
    for (let di = 0; di < directions.length; di++) {
      const direction = directions[di];
      let [from, to] = mode === 'incremental' ? await incrementalRange(companyTax, direction, o.fallbackFrom || `${todayISO().slice(0, 4)}-01-01`) : [o.from, o.to];
      const label = DIRECTION_LABEL[direction];
      const counts = { fetched: 0, added: 0, updated: 0 };
      result.byDirection[direction] = counts;
      await logger.info('sync', `Bắt đầu đồng bộ hóa đơn ${label.toLowerCase()} ${from} → ${to}`, { direction, from, to, mode, codeMode });

      for await (const page of client.iterateInvoices({ direction, from, to, codeMode, ...filters, signal, onRetry: (i, delay, e) => report(undefined, `Lỗi tạm thời, thử lại lần ${i}…`, e.message) })) {
        const invoices = page.items.map((raw) => fromGdtSummary(raw, { direction, companyTax }));
        if (state.session.mode === 'demo') invoices.forEach((x) => { x.source = 'demo'; });
        const r = await repos.invoices.upsertMany(invoices);
        counts.fetched += invoices.length; counts.added += r.added; counts.updated += r.updated;
        touched.push(...invoices);
        const chunkFrac = (page.chunkIndex + 1) / page.chunkCount;
        const pct = ((di + chunkFrac) / directions.length) * listShare;
        report(pct, `${label}: ${page.chunk[0]} → ${page.chunk[1]}`, `Đã tải ${counts.fetched.toLocaleString('vi-VN')} hóa đơn (mới ${counts.added}, cập nhật ${counts.updated})`, result.fetched + counts.fetched);
      }

      await checkpointSync({ companyTax, direction, from, to, count: counts.fetched, mode });
      result.added += counts.added; result.updated += counts.updated; result.fetched += counts.fetched;
      await logger.info('sync', `Xong hóa đơn ${label.toLowerCase()}: ${counts.fetched} hóa đơn (mới ${counts.added}, cập nhật ${counts.updated})`, { direction, ...counts });
      bus.emit('invoices:change', { companyTax });
    }

    if (withDetail) await fetchDetails(client, touched, companyTax, result, report, signal, 0.7);

    result.durationMs = Math.round(performance.now() - t0);
    report(1, 'Hoàn tất', `${result.fetched.toLocaleString('vi-VN')} hóa đơn · ${(result.durationMs / 1000).toFixed(1)} giây`, result.fetched);
    await logger.info('sync', `Đồng bộ hoàn tất: ${result.fetched} hóa đơn (mới ${result.added}, cập nhật ${result.updated})`, { ...result }, result.durationMs);
    return result;
  } catch (e) {
    if (e instanceof AuthError && state.session) setSession({ ...state.session, status: 'expired' });
    if (e.name === 'AbortError') await logger.warn('sync', 'Đồng bộ đã bị hủy bởi người dùng');
    else await logger.error(`Đồng bộ thất bại: ${e.message}`, { direction: directions.join(',') }, 'sync');
    bus.emit('invoices:change', { companyTax });
    throw e;
  } finally {
    state.syncing = false;
    bus.emit('sync:progress', { running: false, pct: 1, message: '' });
  }
}

/** Tải chi tiết hàng hóa cho các hóa đơn chưa có (số luồng cấu hình từ Cài đặt, đã có giãn cách trong client). */
async function fetchDetails(client, invoices, companyTax, result, report, signal, base) {
  const need = invoices.filter((i) => !i.items?.length && i.status !== 6);
  const concurrency = Math.max(1, Math.min(6, Number(state.settings?.detailConcurrency) || 2));
  let done = 0;
  await pool(need, concurrency, async (inv) => {
    if (signal?.aborted) throw new DOMException('Đã hủy', 'AbortError');
    try {
      const det = detailFromGdt(await client.detail(inv, signal));
      await repos.invoices.upsertMany([{ ...inv, ...det }]);
      result.detailed++;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      result.errors.push(`${inv.series} ${inv.number}: ${e.message}`);
    }
    done++;
    if (done % 5 === 0 || done === need.length) report(base + (done / need.length) * (1 - base), 'Đang tải chi tiết hàng hóa', `${done}/${need.length} hóa đơn`, result.fetched + done);
  });
  bus.emit('invoices:change', { companyTax });
  if (result.errors.length) await logger.warn('sync', `${result.errors.length} hóa đơn không tải được chi tiết`, { sample: result.errors.slice(0, 5).join(' | ') });
}

/** Tải chi tiết cho một hóa đơn đơn lẻ (mở chi tiết khi chưa có items). */
export async function loadInvoiceDetail(inv) {
  const client = getClient();
  const det = detailFromGdt(await client.detail(inv));
  const merged = { ...inv, ...det };
  await repos.invoices.upsertMany([merged]);
  bus.emit('invoices:change', { companyTax: inv.companyTax });
  return merged;
}

export { DIRECTION };
