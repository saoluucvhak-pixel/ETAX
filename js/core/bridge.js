/**
 * bridge.js — Đồng bộ qua TIỆN ÍCH TRÌNH DUYỆT ("đăng nhập bằng trang Thuế").
 *
 * Người dùng đăng nhập trên chính trang hoadondientu.gdt.gov.vn; tiện ích (thư mục /extension) chạy trong trang đó,
 * gọi API danh sách hóa đơn bằng phiên đăng nhập ấy rồi chuyển dữ liệu về máy chủ cục bộ. Ở đây ứng dụng:
 *   1) tạo lệnh (chiều + khoảng ngày) → 2) chờ tiện ích nhận lệnh và chạy → 3) nhận từng trang dữ liệu, chuẩn hóa và lưu ngay.
 * Ứng dụng không bao giờ thấy mật khẩu hay token của trang Thuế.
 */
import { DIRECTION, DIRECTION_LABEL } from '../config.js';
import { repos } from '../storage.js';
import { bus, state } from './state.js';
import { fromGdtSummary } from './normalizer.js';
import { incrementalRange, checkpointSync } from './syncEngine.js';
import { saveBridgeXml } from './xmlImport.js';
import { logger } from '../logger.js';
import { sleep, todayISO } from '../utils.js';

const POLL_MS = 1200;
/** Chuẩn hóa MST để so sánh (bỏ dấu gạch/khoảng trắng, không phân biệt hoa thường). */
export const normTax = (s) => String(s ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

const bridgeBase = () => (typeof location !== 'undefined' && location.protocol === 'app:' ? 'http://127.0.0.1:8080' : '');

async function api(method, path, body) {
  const r = await fetch(`${bridgeBase()}/__bridge/${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  if (!r.ok) throw new Error(`Cầu nối trả lỗi ${r.status}`);
  return r.json();
}

/** Trạng thái tiện ích / trang Thuế (null nếu ứng dụng không chạy qua server/server.mjs). */
export async function bridgeStatus() {
  try { return await api('GET', 'status'); } catch { return null; }
}

/**
 * Đồng bộ qua tiện ích. Cùng dạng kết quả với syncEngine.runSync.
 * @param {object} o {companyTax, directions, mode, from, to, fallbackFrom, codeMode, pos, signal, onProgress}
 */
export async function runBridgeSync(o) {
  const { companyTax, directions, mode = 'range', codeMode = 'all', pos = false, xml = false, signal, onProgress = () => {} } = o;
  const t0 = performance.now();
  const result = { added: 0, updated: 0, fetched: 0, detailed: 0, byDirection: {}, errors: [] };
  state.syncing = true;
  bus.emit('sync:progress', { running: true, pct: 0, message: 'Bắt đầu đồng bộ qua trang Thuế…' });
  const report = (pct, message, detail, count) => { onProgress({ pct, message, detail, count }); bus.emit('sync:progress', { running: true, pct, message }); };
  const abortIf = async () => { if (signal?.aborted) { await api('POST', 'cancel').catch(() => {}); throw new DOMException('Đã hủy', 'AbortError'); } };

  try {
    // An toàn nhiều doanh nghiệp: MST thực tế đang đăng nhập trên trang Thuế phải khớp doanh nghiệp đang chọn trong eTax,
    // nếu không thì dừng ngay — tuyệt đối không gắn hóa đơn vào nhầm doanh nghiệp.
    const st = await bridgeStatus();
    const extMst = st?.ext?.mst;
    if (extMst && normTax(extMst) !== normTax(companyTax)) {
      throw new Error(`Mã số thuế đang đăng nhập trên trang Thuế (${extMst}) khác với doanh nghiệp đang chọn trong eTax (${companyTax}). Đã dừng để không gắn nhầm hóa đơn — hãy đổi doanh nghiệp đang chọn ở trên, hoặc đăng nhập đúng tài khoản trên trang Thuế.`);
    }
    for (let di = 0; di < directions.length; di++) {
      const direction = directions[di];
      const label = DIRECTION_LABEL[direction];
      const [from, to] = mode === 'incremental' ? await incrementalRange(companyTax, direction, o.fallbackFrom || `${todayISO().slice(0, 4)}-01-01`) : [o.from, o.to];
      const counts = { fetched: 0, added: 0, updated: 0, xml: 0 };
      const listW = xml ? 0.3 : 1; // giống hệt cách tính bên tiện ích (extension/content.js): liệt kê chiếm phần này, tải XML chiếm phần còn lại
      let listSaved = false; // đã chốt mốc "liệt kê xong" cho chiều này chưa
      let sawXml = false; // đã thấy gói XML đầu tiên chưa — tiện ích luôn liệt kê xong 100% rồi mới bắt đầu tải XML, nên đây là
      // tín hiệu chắc chắn (không phụ thuộc đúng lúc poll bắt được %) rằng toàn bộ danh sách của chiều này đã nhận đủ
      const ingest = async (chunks) => { // nhận từng gói từ tiện ích: danh sách hóa đơn hoặc XML gốc
        for (const chunk of chunks) {
          if (chunk.kind === 'xml') {
            sawXml = true;
            const r = await saveBridgeXml(chunk.items, { direction: chunk.direction, companyTax });
            counts.xml += r.saved; result.errors.push(...r.problems);
          } else if (chunk.kind === 'xmlFail') {
            // Tiện ích báo rõ đúng hóa đơn nào không tải được XML (trước đây chỉ có số lượng) — ghi vào kết quả hiển thị
            // và Nhật ký để biết chính xác hóa đơn nào cần tra lại, không phải đoán.
            for (const it of chunk.items) {
              const note = `${label}: hóa đơn ${it.khhdon || '?'} số ${it.shdon || '?'} (MST ${it.nbmst || '?'}) không tải được XML — ${it.message || 'không rõ lý do'}`;
              result.errors.push(note);
              await logger.warn('sync', note, { direction, nbmst: it.nbmst, khhdon: it.khhdon, shdon: it.shdon, khmshdon: it.khmshdon });
            }
          } else {
            const invoices = chunk.items.map((raw) => fromGdtSummary(raw, { direction: chunk.direction, companyTax }));
            const s = await repos.invoices.upsertMany(invoices);
            counts.fetched += invoices.length; counts.added += s.added; counts.updated += s.updated;
          }
        }
      };
      // Chốt mốc đồng bộ ngay khi liệt kê xong (không đợi tải XML xong) — nếu tải XML lỗi/bị chặn giữa chừng ở phía sau,
      // lần đồng bộ sau (chế độ Gia tăng) sẽ không phải liệt kê + tải lại từ đầu đúng số hóa đơn đã có, tránh lặp lại đúng
      // điểm gây lỗi lần trước. Danh sách hóa đơn (nguồn dữ liệu chính) đã lưu đủ vào CSDL tại đây, XML chỉ là chi tiết kèm theo.
      // Gọi ngay sau ingest() mỗi vòng poll — kể cả vòng cuối cùng phát hiện lỗi — để không lọt mất khi lỗi xảy ra rất nhanh.
      const checkpointListIfDone = async (pPct) => {
        if (listSaved || !(sawXml || (pPct || 0) >= listW)) return;
        listSaved = true;
        await checkpointSync({ companyTax, direction, from, to, count: counts.fetched, mode });
        await logger.info('sync', `Đã chốt mốc liệt kê xong ${label.toLowerCase()} (qua trang Thuế): ${counts.fetched} hóa đơn ${from} → ${to}`, { direction, from, to });
      };
      result.byDirection[direction] = counts;
      await logger.info('sync', `Bắt đầu đồng bộ qua trang Thuế: hóa đơn ${label.toLowerCase()} ${from} → ${to}`, { direction, from, to, mode, via: 'extension' });
      await api('POST', 'job', { direction, from, to, codeMode, pos, xml });
      let finished = false;
      while (!finished) {
        await abortIf();
        await sleep(POLL_MS);
        const r = await api('GET', 'pull');
        await ingest(r.items);
        const p = r.progress;
        if (!p) continue;
        const pct = ((di + (p.pct || 0)) / directions.length);
        await checkpointListIfDone(p.pct);
        if (p.state === 'error') throw new Error(p.message || 'Tiện ích báo lỗi.');
        if (p.state === 'waiting') report(pct * 0.98, `${label}: đang chờ tiện ích`, r.extAgeMs == null || r.extAgeMs > 30000 ? 'Chưa thấy tiện ích trên trang Thuế. Hãy cài tiện ích, mở trang hoadondientu.gdt.gov.vn, đăng nhập rồi vào Tra cứu → Tra cứu hóa đơn.' : 'Tiện ích sẽ tự chạy khi tab Thuế đang mở ở Tra cứu → Tra cứu hóa đơn (nếu bạn tắt "Tự chạy" trong hộp tiện ích thì bấm "Chạy lệnh từ eTax").', result.fetched + counts.fetched);
        else {
          if (r.extAgeMs != null && r.extAgeMs > 60000 && p.state === 'running') throw new Error('Mất liên lạc với tiện ích (đã đóng tab Thuế?). Dữ liệu đã nhận vẫn được giữ.');
          report(pct, `${label}: ${p.message || 'đang tải'}`, `Đã nhận ${counts.fetched.toLocaleString('vi-VN')} hóa đơn (mới ${counts.added}, cập nhật ${counts.updated})`, result.fetched + counts.fetched);
        }
        if (p.state === 'done') {
          const last = await api('GET', 'pull'); await ingest(last.items); await checkpointListIfDone(1); finished = true;
          // Tiện ích báo có bỏ qua 1 phần (vd "Không mã") do cổng Thuế báo bận dai dẳng: ghi vào Nhật ký + kết quả hiển thị,
          // để không âm thầm trôi qua — "Đồng bộ hoàn tất" vẫn đúng (phần liệt kê được đã lưu), nhưng cần biết để đồng bộ lại phần thiếu sau.
          if (p.message && p.message.includes('Đã bỏ qua')) {
            const note = `${label}: ${p.message.slice(p.message.indexOf('Đã bỏ qua'))}`;
            result.errors.push(note);
            await logger.warn('sync', `Đồng bộ qua trang Thuế bỏ qua một phần: ${note}`, { direction });
          }
        }
      }
      await checkpointSync({ companyTax, direction, from, to, count: counts.fetched, mode });
      result.added += counts.added; result.updated += counts.updated; result.fetched += counts.fetched; result.detailed += counts.xml;
      await logger.info('sync', `Xong hóa đơn ${label.toLowerCase()} (qua trang Thuế): ${counts.fetched} hóa đơn (mới ${counts.added}, cập nhật ${counts.updated})${xml ? `, ${counts.xml} XML` : ''}`, { direction, ...counts });
      bus.emit('invoices:change', { companyTax });
    }
    result.durationMs = Math.round(performance.now() - t0);
    report(1, 'Hoàn tất', `${result.fetched.toLocaleString('vi-VN')} hóa đơn · ${(result.durationMs / 1000).toFixed(1)} giây`, result.fetched);
    return result;
  } catch (e) {
    if (e.name === 'AbortError') await logger.warn('sync', 'Đồng bộ qua trang Thuế đã bị hủy');
    else await logger.error(`Đồng bộ qua trang Thuế thất bại: ${e.message}`, { via: 'extension' }, 'sync');
    bus.emit('invoices:change', { companyTax });
    throw e;
  } finally {
    state.syncing = false;
    bus.emit('sync:progress', { running: false, pct: 1, message: '' });
  }
}

export { DIRECTION };
