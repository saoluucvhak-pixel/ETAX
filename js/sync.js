/**
 * sync.js — Trang "Đồng bộ dữ liệu": chọn khoảng ngày, chiều hóa đơn, cấp mã và các bộ lọc
 * (số hóa đơn, ký hiệu, MST, khách hàng) rồi tải về CSDL cục bộ với thanh tiến độ.
 */
import { h, clear, fmtInt, fmtDate, fmtRelative, speedEtaText, periodRange, todayISO, toISODate } from './utils.js';
import { state, bus } from './core/state.js';
import { DIRECTION } from './config.js';
import { repos } from './storage.js';
import { runSync, canSync } from './core/syncEngine.js';
import { runBridgeSync, bridgeStatus, normTax } from './core/bridge.js';
import { clearCompanyData } from './core/invoiceStore.js';
import { icon, toast, field, select, progressPanel, confirmDialog, emptyState } from './core/ui.js';
import * as syncSession from './core/syncSession.js';
import { defaultDemoRange } from './core/demo.js';
import { go } from './core/router.js';

const SHORTCUTS = [['month', 'Tháng này'], ['lastMonth', 'Tháng trước'], ['quarter', 'Quý này'], ['lastQuarter', 'Quý trước'], ['year', 'Năm nay'], ['last12', '12 tháng gần đây']];

export async function mount(host) {
  if (!state.companyTax || !canSync()) {
    const demo = state.session?.mode === 'demo';
    host.append(h('section.panel', emptyState({
      title: state.session?.status === 'expired' ? 'Phiên đăng nhập đã hết hạn' : 'Cần đăng nhập trước khi đồng bộ',
      text: 'Đồng bộ tải hóa đơn từ cổng Thuế điện tử, nên cần một phiên hợp lệ (hoặc bật dữ liệu mẫu để thử). Dữ liệu đã lưu vẫn xem được ở các trang khác.',
      action: h('button.btn.primary', { onclick: () => go('login') }, icon('key', 16), demo ? 'Về trang đăng nhập' : 'Đến trang đăng nhập'),
    })));
    return null;
  }

  const [d0] = periodRange('month');
  const inCk = h('input', { type: 'checkbox', checked: true });
  const outCk = h('input', { type: 'checkbox', checked: true });
  const from = h('input', { type: 'date', value: d0 });
  const to = h('input', { type: 'date', value: todayISO() });
  const codeMode = select([['all', 'Cả có mã và không mã'], ['coma', 'Chỉ hóa đơn đã cấp mã'], ['khongma', 'Chỉ hóa đơn không cấp mã']], 'all');
  const number = h('input', { type: 'text', placeholder: 'Ví dụ 1234' });
  const series = h('input', { type: 'text', placeholder: 'Ví dụ C24TAA' });
  const partnerTax = h('input', { type: 'text', placeholder: 'MST người mua/người bán' });
  const partnerName = h('input', { type: 'text', placeholder: 'Một phần tên' });
  const detail = h('input', { type: 'checkbox', checked: !!state.settings.syncDetail && state.session?.mode !== 'bridge', disabled: state.session?.mode === 'bridge' });
  const pos = h('input', { type: 'checkbox', checked: true }); // chỉ dùng ở chế độ cầu nối: lấy thêm hóa đơn khởi tạo từ máy tính tiền
  const xmlCk = h('input', { type: 'checkbox', checked: true }); // chỉ dùng ở chế độ cầu nối: tải kèm XML gốc + chi tiết hàng hóa
  let mode = 'range';
  const modeCtl = h('div.seg-control', { role: 'group', 'aria-label': 'Chế độ đồng bộ' },
    h('button.active', { type: 'button', onclick: () => setMode('range') }, 'Theo khoảng ngày'),
    h('button', { type: 'button', onclick: () => setMode('incremental') }, 'Gia tăng (chỉ phần mới)'));
  const modeHint = h('div.hint');
  const progress = progressPanel();
  const resultBox = h('div');
  const historyBox = h('div');
  const mstWarnBox = h('div'); // cảnh báo lệch MST giữa eTax và trang Thuế (chỉ chế độ bridge) — điền ở checkMstMatch()
  const startBtn = h('button.btn.primary', { type: 'submit' }, icon('play', 16), h('span', 'Bắt đầu đồng bộ'));
  const cancelBtn = h('button.btn.danger', { type: 'button', hidden: true }, icon('stop', 16), h('span', 'Hủy'));
  let wasRunning = false; // để chỉ vẽ kết quả đúng lúc chuyển từ "đang chạy" sang "xong", không vẽ lại mỗi lần mở trang

  function setMode(m) {
    mode = m;
    [...modeCtl.children].forEach((b, i) => b.classList.toggle('active', (i === 0) === (m === 'range')));
    to.disabled = m === 'incremental';
    modeHint.textContent = m === 'incremental'
      ? 'Mỗi chiều chỉ tải từ ngày đồng bộ gần nhất (lùi 3 ngày để bắt kịp hóa đơn lập muộn/đổi trạng thái). Nếu chưa từng đồng bộ, bắt đầu từ ngày ở ô "Từ ngày".'
      : 'Cổng Thuế chỉ trả tối đa khoảng 1 tháng mỗi lần; ứng dụng tự chia nhỏ khoảng ngày dài và tải lần lượt.';
  }

  function applyShortcut(kind) {
    let r;
    if (kind === 'last12') { const n = new Date(); r = [toISODate(new Date(n.getFullYear(), n.getMonth() - 11, 1)), todayISO()]; } else r = periodRange(kind);
    from.value = r[0]; to.value = r[1] > todayISO() ? todayISO() : r[1];
  }

  async function submit(e) {
    e.preventDefault();
    if (syncSession.isRunning()) return; // nút đã bị vô hiệu hóa lúc đang chạy, chặn thêm cho chắc
    const directions = [inCk.checked && DIRECTION.IN, outCk.checked && DIRECTION.OUT].filter(Boolean);
    if (!directions.length) return toast('Chọn ít nhất một chiều: đầu vào hoặc đầu ra.', 'warn');
    if (!from.value || (mode === 'range' && !to.value)) return toast('Chọn đủ từ ngày và đến ngày.', 'warn');
    if (mode === 'range' && from.value > to.value) return toast('"Từ ngày" phải trước hoặc bằng "Đến ngày".', 'warn');
    const days = mode === 'range' ? (new Date(to.value) - new Date(from.value)) / 86400000 : 0;
    if (days > 366 && !(await confirmDialog({ title: 'Khoảng thời gian dài', message: `Bạn chọn ${fmtInt(Math.round(days))} ngày. Ứng dụng sẽ gọi cổng Thuế khoảng ${fmtInt(Math.ceil(days / 31) * directions.length)} lượt (chưa kể phân trang). Tiếp tục?`, confirmLabel: 'Tiếp tục' }))) return;

    const runner = state.session?.mode === 'bridge' ? runBridgeSync : runSync;
    const params = {
      companyTax: state.companyTax, directions, mode, from: from.value, to: to.value, fallbackFrom: from.value, codeMode: codeMode.value,
      filters: { number: number.value.trim(), series: series.value.trim(), partnerTax: partnerTax.value.trim(), partnerName: partnerName.value.trim() },
      withDetail: detail.checked && state.session?.mode !== 'bridge', pos: pos.checked, xml: state.session?.mode === 'bridge' && xmlCk.checked,
    };
    clear(resultBox);
    progress.set(0, 'Đang chuẩn bị…', '');
    // Chạy nền qua syncSession (không await ở đây): rời trang này để làm việc khác KHÔNG hủy, chỉ nút "Hủy" mới hủy.
    // Giao diện tự cập nhật qua sự kiện 'syncSession:change' ở onSessionChange(), kể cả khi mở lại trang giữa chừng.
    syncSession.start(({ signal, onProgress }) => runner({ ...params, signal, onProgress }));
    onSessionChange();
  }

  /** Dòng phụ "12 hóa đơn/giây · còn khoảng 40 giây" dưới thanh tiến độ — trống nếu chưa đủ dữ liệu để ước tính. */
  /** Phản ánh trạng thái đồng bộ nền lên giao diện trang này — gọi khi mount và mỗi khi syncSession báo thay đổi. */
  function onSessionChange() {
    const running = syncSession.isRunning();
    startBtn.disabled = running; cancelBtn.hidden = !running;
    if (running) {
      const snap = syncSession.getSnapshot();
      progress.set(snap.pct, snap.message, snap.detail, speedEtaText(snap));
    } else if (wasRunning) { // vừa chuyển từ "đang chạy" sang "xong" trong lúc đang xem trang này
      const out = syncSession.getLastOutcome();
      if (out?.ok) { progress.done('Đồng bộ hoàn tất'); showResult(out.result); }
      else if (out?.aborted) progress.fail('Đã hủy — dữ liệu tải được trước đó vẫn được giữ');
      else if (out) progress.fail('Đồng bộ thất bại', out.error?.message || '');
      drawHistory();
    }
    wasRunning = running;
  }
  cancelBtn.addEventListener('click', () => syncSession.cancel());

  function showResult(r) {
    const cell = (v, l) => h('div', h('b', fmtInt(v)), h('span', l));
    const isGeneralErr = (err) => /bỏ qua|cổng bận|máy tính tiền|kết nối|phiên|hết hạn/i.test(err);
    const generalErrs = (r.errors || []).filter(isGeneralErr);
    const invoiceErrs = (r.errors || []).filter((e) => !isGeneralErr(e));
    const generalList = generalErrs.length ? h('div.notice.warn', { style: { marginTop: '10px' } }, icon('alert', 18), h('div',
      h('div', h('b', 'Lưu ý khi đồng bộ:')),
      h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '12.5px' } }, generalErrs.map((err) => h('li', err))))) : null;
    const errList = invoiceErrs.length ? h('div.notice.warn', { style: { marginTop: '10px', alignItems: 'flex-start' } }, icon('alert', 18), h('div',
      h('div', `${invoiceErrs.length} hóa đơn không tải được chi tiết (có thể mở từng hóa đơn để tải lại):`),
      h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '12.5px' } },
        invoiceErrs.slice(0, 10).map((err) => h('li', err)),
        invoiceErrs.length > 10 ? h('li.muted', `… và ${invoiceErrs.length - 10} hóa đơn khác (xem chi tiết trong Nhật ký).`) : null))) : null;
    clear(resultBox).append(...[h('div.result-grid', cell(r.fetched, 'Đã tải'), cell(r.added, 'Mới'), cell(r.updated, 'Cập nhật'), r.detailed ? cell(r.detailed, 'Có chi tiết') : null, h('div', h('b', `${(r.durationMs / 1000).toFixed(1)}s`), h('span', 'Thời gian'))), generalList, errList].filter(Boolean));
  }

  /** Cảnh báo trước nếu MST đang đăng nhập trên trang Thuế khác doanh nghiệp đang chọn — trước khi bấm Bắt đầu. */
  async function checkMstMatch() {
    if (state.session?.mode !== 'bridge') return;
    const st = await bridgeStatus().catch(() => null);
    const extMst = st?.ext?.mst;
    clear(mstWarnBox);
    if (extMst && normTax(extMst) !== normTax(state.companyTax)) {
      mstWarnBox.append(h('div.notice.warn', icon('alert', 18), h('div', `Trang Thuế đang đăng nhập MST ${extMst}, khác doanh nghiệp đang chọn (${state.companyTax}). Đồng bộ sẽ bị chặn để không gắn nhầm hóa đơn — đổi doanh nghiệp đang chọn ở trên, hoặc đăng nhập đúng tài khoản trên trang Thuế.`)));
    }
  }

  async function drawHistory() {
    const [sin, sout] = await repos.syncState.forCompany(state.companyTax);
    const row = (label, st) => h('div.sync-row', h('span', label), h('span.when', st ? `${fmtRelative(st.lastSyncAt)} — ${fmtDate(st.lastFrom)} → ${fmtDate(st.lastTo)} (${fmtInt(st.lastCount)} hóa đơn)` : 'Chưa đồng bộ'));
    clear(historyBox).append(row('Hóa đơn đầu vào', sin), row('Hóa đơn đầu ra', sout));
  }

  async function resync() {
    if (syncSession.isRunning()) return toast('Đang có một lần đồng bộ chạy nền — chờ xong hoặc bấm Hủy trước khi xóa dữ liệu.', 'warn');
    const ok = await confirmDialog({ title: 'Xóa dữ liệu và đồng bộ lại?', message: `Toàn bộ hóa đơn của MST ${state.companyTax} trên máy (kèm XML/PDF đính kèm và ghi chú của bạn) sẽ bị xóa, sau đó bạn đồng bộ lại từ đầu. Nên sao lưu trước ở Cài đặt.`, confirmLabel: 'Xóa và làm lại', danger: true });
    if (!ok) return;
    const n = await clearCompanyData(state.companyTax);
    toast(`Đã xóa ${fmtInt(n)} hóa đơn. Chọn khoảng ngày rồi bấm Bắt đầu đồng bộ.`, 'info');
    setMode('range');
    if (state.session?.mode === 'demo') { [from.value, to.value] = defaultDemoRange(); }
    drawHistory();
  }

  const shortcuts = h('div.range-shortcuts', SHORTCUTS.map(([k, l]) => h('button.chip', { type: 'button', onclick: () => applyShortcut(k) }, l)));
  const form = h('form.panel', { onsubmit: submit },
    h('div.panel-head', h('div', h('h2', 'Chọn dữ liệu cần tải'), h('p', `Doanh nghiệp ${state.companyTax}${state.session?.companyName ? ` — ${state.session.companyName}` : ''}`))),
    h('div', { style: { display: 'grid', gap: '16px' } },
      h('div.field', h('label', 'Chế độ'), modeCtl, modeHint),
      h('div.form-grid', field('Từ ngày', from), field('Đến ngày', to), h('div.field', { style: { gridColumn: '1 / -1' } }, shortcuts)),
      h('div.form-grid', h('div.field', h('label', 'Chiều hóa đơn'), h('div.check-row', h('label.check', inCk, 'Đầu vào (mua vào)'), h('label.check', outCk, 'Đầu ra (bán ra)'))), field('Cấp mã', codeMode)),
      h('div', h('h3.section-title', 'Lọc thêm (bỏ trống nếu không cần)'),
        h('div.form-grid', field('Theo số hóa đơn', number), field('Theo ký hiệu', series), field('Theo MST', partnerTax), field('Theo khách hàng / nhà cung cấp', partnerName))),
      state.session?.mode === 'bridge'
        ? h('div', { style: { display: 'grid', gap: '8px' } }, h('label.check', xmlCk, 'Tải kèm XML gốc và chi tiết hàng hóa (chậm hơn, khoảng 1 giây mỗi hóa đơn)'), h('label.check', pos, 'Lấy thêm hóa đơn khởi tạo từ máy tính tiền'), mstWarnBox, h('div.notice.info', icon('info', 18), h('div', 'Đang đồng bộ qua tiện ích trên trang Thuế: sau khi bấm Bắt đầu, giữ tab Thuế mở ở Tra cứu → Tra cứu hóa đơn. Tiện ích tự nhận lệnh và chạy; nếu bị cổng Thuế chặn thì tự dừng và báo ở đây.')))
        : h('div', { style: { display: 'grid', gap: '8px' } }, h('label.check', detail, 'Tải luôn chi tiết hàng hóa từng hóa đơn (đầy đủ hơn nhưng chậm hơn nhiều)'), h('label.check', pos, 'Lấy thêm hóa đơn khởi tạo từ máy tính tiền')),
      h('div.row-gap', startBtn, cancelBtn)));

  const side = h('div', { style: { display: 'grid', gap: '18px', alignContent: 'start' } },
    h('section.panel', h('div.panel-head', h('h2', 'Tiến độ')), progress.el, resultBox),
    h('section.panel', h('div.panel-head', h('h2', 'Lần đồng bộ gần nhất')), historyBox,
      h('div', { style: { marginTop: '12px' } }, h('button.btn.sm.danger', { type: 'button', onclick: resync }, icon('trash', 15), h('span', 'Xóa dữ liệu doanh nghiệp này & đồng bộ lại')))));

  host.append(h('div.sync-layout', form, side));
  setMode('range');
  if (state.session?.mode === 'demo') { [from.value, to.value] = defaultDemoRange(); host.prepend(h('div.notice.info', icon('info', 18), h('div', 'Đang dùng dữ liệu mẫu: hóa đơn được sinh giả lập, cố định theo ngày, để bạn thử toàn bộ chức năng mà không cần đăng nhập cổng Thuế.'))); }
  await drawHistory();
  checkMstMatch();
  // Mở trang này khi KHÔNG có gì đang chạy nhưng có kết quả lần gần nhất (ví dụ đồng bộ đã xong trong lúc bạn ở trang khác):
  // hiện luôn kết quả đó, thay vì bảng trống. Nếu đang chạy, onSessionChange() bên dưới sẽ tự vẽ tiến độ hiện tại.
  if (!syncSession.isRunning()) {
    const out = syncSession.getLastOutcome();
    if (out?.ok) { progress.done('Đồng bộ hoàn tất'); showResult(out.result); }
    else if (out?.aborted) progress.fail('Đã hủy — dữ liệu tải được trước đó vẫn được giữ');
    else if (out) progress.fail('Đồng bộ thất bại', out.error?.message || '');
  } else wasRunning = true; // để onSessionChange() không hiểu nhầm là "vừa xong" ngay lần gọi đầu
  onSessionChange();
  const off = bus.on('session:change', () => { if (!canSync()) go('login'); });
  const offSession = bus.on('syncSession:change', onSessionChange);
  return () => { off(); offSession(); }; // KHÔNG hủy đồng bộ đang chạy khi rời trang — chỉ nút "Hủy" mới hủy
}
