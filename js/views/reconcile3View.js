/**
 * reconcile3View.js — "Đối chiếu 3 nguồn thuế GTGT": Sổ sách kế toán ↔ HĐĐT Cục Thuế ↔ Tờ khai 01/GTGT (XML).
 * HĐĐT lấy từ dữ liệu đã đồng bộ trong máy, hoặc từ (các) tệp Excel tải từ cổng Thuế. Phép tính: core/reconcile3.js.
 */
import { h, clear, fmtInt, fmtMoney, readBuffer, readText, periodRange, escapeHtml } from '../utils.js';
import { state } from '../core/state.js';
import { readXlsx } from '../core/xlsx.js';
import { loadInvoices } from '../core/invoiceStore.js';
import { DataGrid } from '../core/datagrid.js';
import { dropZone } from '../core/dropzone.js';
import { icon, select, field, toast, withLoading } from '../core/ui.js';
import { exportSheets } from '../export.js';
import { logger } from '../logger.js';
import { FIELD_LABELS, CHI_TIEU_OPTIONS, TRANG_THAI, colLetter, formatNgay, ngayToISO, toNum, processSource, gopTheoKhoa, doiChieu, parseToKhai, chiTieu, recordsFromInvoices } from '../core/reconcile3.js';
import { templateSoSach, templateHDDT } from './reconcile3Templates.js';

const TONE = { ok: 'ok', warn: 'warn', bad: 'bad', kyhieusai: 'gold' };
const PERIODS = [['auto', 'Theo tờ khai (nếu có), không thì theo ngày trong sổ'], ['ledger', 'Theo ngày trong sổ'], ['month', 'Tháng này'], ['lastMonth', 'Tháng trước'], ['quarter', 'Quý này'], ['lastQuarter', 'Quý trước'], ['year', 'Năm nay'], ['custom', 'Tùy chọn…']];
const btnLink = (label, onClick) => h('button.link-btn', { type: 'button', style: { color: 'var(--primary)', fontWeight: 650 }, onclick: onClick }, label);

export async function mount(host) {
  const S = { loai: 'mua', ss: null, hd: null, tk: null, hdMode: 'synced', result: null, invoices: state.companyTax ? await loadInvoices(state.companyTax) : [], filter: 'all' };
  if (!S.invoices.length) S.hdMode = 'upload';

  const boxes = { SS: {}, HD: {}, TK: {} };
  const tol = h('input', { type: 'number', value: '1000', min: 0, step: 100 });
  const per = select(PERIODS, 'auto');
  const from = h('input', { type: 'date', hidden: true });
  const to = h('input', { type: 'date', hidden: true });
  const ctSel = select([['', 'Tự động theo loại đối chiếu'], ...CHI_TIEU_OPTIONS], '');
  const warn = h('span', { style: { color: 'var(--bad)', fontSize: '12.5px' } });
  const runBtn = h('button.btn.primary', { type: 'button', disabled: true, onclick: () => run() }, icon('play', 16), h('span', 'Đối chiếu ngay'));
  const resultBox = h('div');
  const hdInfo = h('div.muted', { style: { fontSize: '12.5px' } });

  // ------------------------------------------------------------ Loại đối chiếu
  const loaiCtl = h('div.seg-control', { role: 'group', 'aria-label': 'Loại đối chiếu' },
    h('button.active', { type: 'button', onclick: () => setLoai('mua') }, 'MUA VÀO (CT23/CT24)'), h('button', { type: 'button', onclick: () => setLoai('ban') }, 'BÁN RA (CT27/CT28)'));
  function setLoai(l) { S.loai = l; [...loaiCtl.children].forEach((b, i) => b.classList.toggle('active', (i === 0) === (l === 'mua'))); refreshHdInfo(); checkReady(); }

  // ------------------------------------------------------------ Nạp tệp
  async function loadFiles(side, files) {
    try {
      const list = await withLoading('Đang đọc tệp…', async () => { const out = []; for (const f of files) out.push({ fileName: f.name, sheets: (await readXlsx(await readBuffer(f))).filter((s) => s.rows.length) }); return out; });
      const enabled = new Set(list.flatMap((f) => f.sheets.map((s) => `${f.fileName}::${s.name}`)));
      S[side === 'SS' ? 'ss' : 'hd'] = { files: list, enabled, override: {}, res: null };
      reprocess(side);
    } catch (e) { toast(`Không đọc được tệp: ${e.message}. Chỉ hỗ trợ .xlsx (tệp .xls hãy Lưu thành .xlsx).`, 'bad'); }
  }

  function reprocess(side) {
    const st = S[side === 'SS' ? 'ss' : 'hd'];
    st.res = processSource(st.files, st.enabled, st.override);
    drawDetect(side); drawSheets(side); drawColMap(side); refreshHdInfo(); checkReady();
  }
  const stOf = (side) => S[side === 'SS' ? 'ss' : 'hd'];

  function drawDetect(side) {
    const b = boxes[side].detect; const st = stOf(side); const r = st.res;
    b.classList.add('show');
    const ok = r.sheetInfo.filter((s) => s.ok); const fail = r.sheetInfo.filter((s) => s.ok === false); const off = r.sheetInfo.filter((s) => s.skipped);
    if (!ok.length) { b.innerHTML = '<span class="fail">Không dò được cột trong sheet nào đang bật.</span>'; return; }
    const mode = r.coSoCT ? 'sochungtu' : r.coKyHieu ? 'kyhieu' : 'sohd';
    const { gop, soTrungLech } = gopTheoKhoa(r.banGhi, mode);
    b.innerHTML = `Đã nhận diện <b>${fmtInt(Object.keys(gop).length)} hóa đơn</b> từ ${ok.length} sheet${fail.length ? `, bỏ qua ${fail.length} sheet không nhận diện được` : ''}${off.length ? `, ${off.length} sheet đang tắt` : ''}`
      + (soTrungLech ? `<br><span class="fail">⚠ ${soTrungLech} hóa đơn trùng khóa giữa các sheet/tệp nhưng giá trị KHÁC NHAU — đã lấy lần xuất hiện đầu tiên, nên kiểm tra lại thủ công.</span>` : '');
  }

  function drawSheets(side) {
    const box = boxes[side].sheets; const st = stOf(side);
    clear(box);
    if (!st) return box.classList.remove('show');
    const multi = st.files.length > 1;
    box.append(h('div.colmap-title', 'Chọn sheet muốn dùng'));
    for (const { fileName, sheets } of st.files) {
      for (const { name } of sheets) {
        const tag = `${fileName}::${name}`; const info = st.res.sheetInfo.find((s) => s.file === fileName && s.name === name);
        const cb = h('input', { type: 'checkbox', checked: st.enabled.has(tag), onchange: () => { if (cb.checked) st.enabled.add(tag); else st.enabled.delete(tag); reprocess(side); } });
        box.append(h('div.sheet-row', h('label', cb, `${multi ? `${fileName} — ` : ''}${name}`), info?.ok ? h('span.sheet-ok', `${info.soDong} dòng`) : info?.ok === false ? h('span.sheet-bad', 'không nhận diện được') : null));
      }
    }
    box.classList.add('show');
  }

  function drawColMap(side) {
    const box = boxes[side].cols; const st = stOf(side);
    clear(box);
    if (!st?.res.sample) return box.classList.remove('show');
    const { headerRow, vt } = st.res.sample;
    box.append(h('div.colmap-title', 'Cột đã nhận diện (sửa lại nếu chưa đúng, áp dụng cho mọi sheet đang bật)'));
    const sels = {};
    for (const [key, label] of FIELD_LABELS) {
      const cur = st.override[key] !== undefined ? st.override[key] : vt[key];
      const opts = [['-1', '— không có —'], ...headerRow.map((hd, c) => [String(c), `${colLetter(c)} — ${hd === null || hd === undefined || String(hd).trim() === '' ? `(cột ${colLetter(c)})` : hd}`])];
      sels[key] = select(opts, String(cur));
      box.append(h('div.colmap-row', h('label', label), sels[key]));
    }
    box.append(h('button.btn.sm', { type: 'button', style: { width: '100%', marginTop: '4px' }, onclick: () => { st.override = Object.fromEntries(Object.entries(sels).map(([k, s]) => [k, parseInt(s.value, 10)])); reprocess(side); } }, 'Dò lại theo lựa chọn này'));
    box.classList.add('show');
  }

  async function loadTK([file]) {
    const tk = parseToKhai(await readText(file));
    S.tk = tk;
    const b = boxes.TK.detect; b.classList.add('show');
    if (!tk) b.innerHTML = '<span class="fail">Không đọc được tệp XML — kiểm tra đúng tệp tờ khai HTKK chưa.</span>';
    else b.innerHTML = `Đã đọc: <b>${escapeHtml(tk.ten || '')}</b> — kỳ <b>${escapeHtml(tk.ky || '')}</b> — nộp lần ${escapeHtml(tk.soLan || '0')}<br>ct23/ct24 (mua vào): ${fmtMoney(tk.ct23)} / ${fmtMoney(tk.ct24)}<br>ct27/ct28 (bán ra): ${fmtMoney(tk.ct27)} / ${fmtMoney(tk.ct28)}`;
    refreshHdInfo(); checkReady();
  }

  // ------------------------------------------------------------ Kỳ cho nguồn "đã đồng bộ"
  function ledgerRange() {
    const ds = (S.ss?.res.banGhi || []).map((r) => ngayToISO(r.ngay)).filter(Boolean).sort();
    return ds.length ? [ds[0], ds.at(-1)] : ['', ''];
  }
  function syncedRange() {
    const v = per.value;
    if (v === 'custom') return [from.value, to.value];
    if (v === 'auto' && S.tk) { const a = ngayToISO(formatNgay(S.tk.tuNgay)); const b = ngayToISO(formatNgay(S.tk.denNgay)); if (a && b) return [a, b]; }
    if (v === 'auto' || v === 'ledger') return ledgerRange();
    return periodRange(v);
  }
  const syncedRecords = () => { const [f, t] = syncedRange(); return { f, t, rec: recordsFromInvoices(S.invoices, { direction: S.loai === 'mua' ? 'in' : 'out', from: f, to: t }) }; };

  function refreshHdInfo() {
    if (S.hdMode !== 'synced') { hdInfo.textContent = ''; return; }
    const { f, t, rec } = syncedRecords();
    hdInfo.textContent = `${fmtInt(rec.length)} hóa đơn ${S.loai === 'mua' ? 'đầu vào' : 'đầu ra'} đã đồng bộ${f || t ? ` trong kỳ ${f || '…'} → ${t || '…'}` : ''} (không tính hóa đơn hủy / bị thay thế).`;
  }
  per.addEventListener('change', () => { from.hidden = to.hidden = per.value !== 'custom'; refreshHdInfo(); checkReady(); });
  from.addEventListener('change', () => { refreshHdInfo(); checkReady(); }); to.addEventListener('change', () => { refreshHdInfo(); checkReady(); });

  function checkReady() {
    const okSS = !!S.ss?.res.banGhi.length;
    const okHD = S.hdMode === 'synced' ? syncedRecords().rec.length > 0 : !!S.hd?.res.banGhi.length;
    runBtn.disabled = !(okSS && okHD);
    warn.textContent = okSS && !okHD ? (S.hdMode === 'synced' ? 'Chưa có hóa đơn đã đồng bộ trong kỳ này. Hãy đồng bộ dữ liệu hoặc chọn tệp Excel từ cổng Thuế.' : 'HĐĐT chưa nhận diện được dòng nào.') : !okSS && S.ss ? 'Sổ sách chưa nhận diện được dòng nào.' : '';
  }

  // ------------------------------------------------------------ Đối chiếu
  function run() {
    let hdRec; let hdFlags; let hdLabel; let range = null;
    if (S.hdMode === 'synced') { const s = syncedRecords(); hdRec = s.rec; hdFlags = { coKyHieu: true, coSoCT: false }; hdLabel = 'Dữ liệu đã đồng bộ'; range = [s.f, s.t]; } else { hdRec = S.hd.res.banGhi; hdFlags = { coKyHieu: S.hd.res.coKyHieu, coSoCT: S.hd.res.coSoCT }; hdLabel = 'Tệp Excel HĐĐT'; }
    const r = doiChieu(S.ss.res.banGhi, hdRec, { ss: { coKyHieu: S.ss.res.coKyHieu, coSoCT: S.ss.res.coSoCT }, hd: hdFlags, tol: toNum(tol.value) });
    r.ketQua.forEach((k, i) => { k.id = i; });
    S.result = { ...r, loai: S.loai, tk: S.tk, tol: toNum(tol.value), hdLabel, range, ct: chiTieu(S.tk, S.loai, ctSel.value) };
    S.filter = 'all';
    logger.info('system', `Đối chiếu 3 nguồn (${S.loai === 'mua' ? 'mua vào' : 'bán ra'}): khớp ${r.soKhop}, lệch ${r.soLech}, chỉ 1 bên ${r.soThieu}, sai ký hiệu ${r.dsKyHieuSai.length}`, { source: hdLabel, mode: r.modeLabel });
    drawResult();
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------ Kết quả
  const cmp = (label, hd, ss, tk, hasTk, tolV) => {
    const dTk = hasTk && tk != null ? tk - hd : null;
    return h(`tr${dTk != null && Math.abs(dTk) > tolV ? '.diff' : ''}`, { style: dTk != null && Math.abs(dTk) > tolV ? { background: 'var(--bad-tint)', fontWeight: 700 } : null },
      h('td', label), h('td.r', fmtMoney(hd)), h('td.r', fmtMoney(ss)), h('td.r', tk == null ? '—' : fmtMoney(tk)), h('td.r', dTk == null ? '—' : fmtMoney(dTk)), h('td.r', fmtMoney(ss - hd)));
  };

  function drawResult() {
    clear(resultBox);
    const r = S.result; if (!r) return;
    const tk = r.tk;
    const kyTag = h('div.notice.info', icon('info', 18), h('div', tk
      ? h('span', 'Tờ khai: ', h('b', tk.ten || ''), ' — kỳ ', h('b', tk.ky || ''), ` (${tk.tuNgay || ''} – ${tk.denNgay || ''}) — nộp lần ${tk.soLan || '0'}, ngày lập ${tk.ngayLap || ''}`)
      : 'Chưa có tờ khai — chỉ đối chiếu 2 nguồn Sổ sách ↔ HĐĐT.',
    r.canhBaoTrungLech ? h('div', { style: { color: 'var(--bad)', fontWeight: 700, marginTop: '4px' } }, `⚠ ${r.canhBaoTrungLech} hóa đơn xuất hiện nhiều lần giữa các sheet/tệp với giá trị KHÁC NHAU — chỉ lấy lần đầu tiên, hãy kiểm tra thủ công vì có thể ảnh hưởng tới tổng số.`) : null));

    // Chỉ tiêu tờ khai
    let chiTieuBlock;
    if (!tk) chiTieuBlock = h('p.muted', 'Tải thêm tệp tờ khai XML để so theo chỉ tiêu.');
    else {
      const ct = r.ct; const dG = (ct.gia_tri ?? 0) - r.tongHD.gia_tri; const dT = (ct.thue ?? 0) - r.tongHD.thue;
      const bad = Math.abs(dG) > r.tol || Math.abs(dT) > r.tol;
      chiTieuBlock = h('div', { style: { display: 'grid', gap: '10px' } },
        h('div.table-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Chỉ tiêu'), h('th.r', 'HĐĐT (độc lập)'), h('th.r', 'Sổ sách kế toán'), h('th.r', 'Đã kê khai (tờ khai)'), h('th.r', 'Chênh lệch (khai − HĐĐT)'), h('th.r', 'Chênh lệch (sổ − HĐĐT)'))),
          h('tbody', cmp(`Giá trị (${ct.tag.split('/')[0].trim()})`, r.tongHD.gia_tri, r.tongSS.gia_tri, ct.gia_tri, true, r.tol), cmp(`Thuế GTGT (${ct.tag.split('/')[1].trim()})`, r.tongHD.thue, r.tongSS.thue, ct.thue, true, r.tol)))),
        ct.gia_tri == null || ct.thue == null ? h('div.notice.warn', icon('alert', 18), h('div', `Tờ khai XML không có thẻ ${ct.tag}. Chọn cặp thẻ khác ở mục "Chỉ tiêu tờ khai".`)) : null,
        h(`div.notice${bad ? '.bad' : '.info'}`, icon(bad ? 'alert' : 'check', 18), h('div', bad
          ? h('span', '🔴 Tờ khai ', h('b', 'lệch với HĐĐT (nguồn độc lập)'), ` ${fmtMoney(dG)}đ giá trị / ${fmtMoney(dT)}đ thuế — kiểm tra các dòng "Chỉ có ở…" trong bảng chi tiết để tìm hóa đơn gây lệch.`)
          : '✅ Tờ khai khớp với HĐĐT trong ngưỡng cho phép.')));
    }

    // Sai ký hiệu / thiếu ký hiệu
    const tbl = (head, rows, right = []) => h('div.table-wrap', { style: { maxHeight: '320px', overflow: 'auto' } }, h('table.tbl', h('thead', h('tr', head.map((c, i) => h(`th${right.includes(i) ? '.r' : ''}`, c)))), h('tbody', rows.map((row) => h('tr', row.map((c, i) => h(`td${right.includes(i) ? '.r' : ''}`, c)))))));
    const saiKH = r.dsKyHieuSai.length ? h('section', h('h3.section-title', `⚠️ Hóa đơn bị sai Ký hiệu hóa đơn (${r.dsKyHieuSai.length})`), tbl(['Số HĐ', 'Tên', 'Ngày', 'Ký hiệu (Sổ sách)', 'Ký hiệu (HĐĐT)'], r.dsKyHieuSai.map((k) => [k.so_hd, k.ten, k.ngay, h('b', k.kyHieuSS), h('b', k.kyHieuHD)]))) : null;
    const thieuKH = r.dsThieuKyHieu.length ? h('section', h('h3.section-title', `Số hóa đơn thiếu Ký hiệu (${r.dsThieuKyHieu.length})`), tbl(['Nguồn bị thiếu', 'Số HĐ', 'Tên', 'Ngày', 'Giá trị', 'Trạng thái sau đối chiếu'], r.dsThieuKyHieu.map((k) => [k.nguon, k.so_hd, k.ten, k.ngay, fmtMoney(k.gia_tri), k.trangThai]), [4])) : null;

    // Bảng chi tiết
    const counts = { ok: r.soKhop, warn: r.soLech, bad: r.soThieu, kyhieusai: r.dsKyHieuSai.length };
    const chips = h('div.range-shortcuts');
    const chip = (key, label, n) => chips.append(h('button.chip', { type: 'button', style: S.filter === key ? { background: 'var(--primary-tint)', borderColor: 'var(--primary)', color: 'var(--primary)' } : null, onclick: () => { S.filter = key; drawResult(); } }, `${label} (${fmtInt(n)})`));
    chip('all', 'Tất cả', r.ketQua.length); chip('ok', TRANG_THAI.khop, counts.ok); chip('warn', TRANG_THAI.lech, counts.warn); chip('bad', '🔴 Chỉ có ở 1 bên', counts.bad); if (counts.kyhieusai) chip('kyhieusai', TRANG_THAI.saiKH, counts.kyhieusai);
    const mc = (key, title, width, extra = {}) => ({ key, title, width, ...extra });
    const grid = new DataGrid({
      rowKey: 'id', footerLabel: 'hóa đơn', selectable: false, rowClass: (row) => TONE[row.cls], stripe: false,
      columns: [mc('hienThi', 'Định danh', 130), mc('so_hd', 'Số HĐ', 90, { align: 'right' }), mc('ten', 'Tên', 'flex'), mc('ngay', 'Ngày', 100),
        mc('giaTriA', 'Giá trị (Sổ sách)', 140, { type: 'money', sum: true }), mc('giaTriB', 'Giá trị (HĐĐT)', 140, { type: 'money', sum: true }), mc('thueA', 'Thuế (Sổ sách)', 124, { type: 'money', sum: true }), mc('thueB', 'Thuế (HĐĐT)', 124, { type: 'money', sum: true }),
        mc('trangThai', 'Trạng thái', 176), mc('ghiChu', 'Ghi chú', 'flex', { render: (row) => h('span', { title: row.ghiChu }, row.ghiChu) })],
    });
    const summary = h('div.notice.info', icon('info', 18), h('div', `✅ Khớp ${fmtInt(r.soKhop)} | 🟡 Lệch số tiền ${fmtInt(r.soLech)} | 🔴 Chỉ có 1 bên ${fmtInt(r.soThieu)}${r.dsKyHieuSai.length ? ` | ⚠️ Sai ký hiệu ${fmtInt(r.dsKyHieuSai.length)}` : ''} — khóa đối chiếu: ${r.modeLabel}${r.soGhepBoSung ? ` (${r.soGhepBoSung} hóa đơn ghép bổ sung theo Số hóa đơn + Tên + Ngày)` : ''} — HĐĐT: ${r.hdLabel}`));

    resultBox.append(h('section.panel', { style: { display: 'grid', gap: '16px', gridTemplateColumns: 'minmax(0, 1fr)' } }, kyTag,
      h('div', h('h2', { style: { fontSize: '16px', marginBottom: '10px' } }, 'Đối chiếu theo chỉ tiêu tờ khai'), chiTieuBlock), saiKH, thieuKH,
      h('div', h('h2', { style: { fontSize: '16px', marginBottom: '10px' } }, 'Đối chiếu chi tiết từng hóa đơn (Sổ sách ↔ HĐĐT)'), summary, h('div', { style: { margin: '10px 0' } }, chips), h('div', { style: { height: '520px', display: 'flex' } }, grid.el)),
      h('div.row-gap', { style: { flexWrap: 'wrap' } }, h('button.btn.primary', { type: 'button', onclick: exportExcel }, icon('sheet', 16), h('span', 'Tải báo cáo Excel đầy đủ (.xlsx)')), h('button.btn', { type: 'button', onclick: () => { host.replaceChildren(); mount(host); } }, icon('refresh', 16), h('span', 'Làm lại từ đầu')))));
    grid.setRows(S.filter === 'all' ? r.ketQua : r.ketQua.filter((k) => k.cls === S.filter));
  }

  // ------------------------------------------------------------ Excel
  async function exportExcel() {
    const r = S.result; if (!r) return;
    const m = (header, key, width = 18) => ({ header, key, type: 'money', width });
    const tkLine = r.tk ? `${r.tk.ten || ''} — kỳ ${r.tk.ky || ''} — nộp lần ${r.tk.soLan || '0'} ngày ${r.tk.ngayLap || ''}` : 'Chưa có tờ khai';
    const detailCols = [{ header: 'Định danh', key: 'hienThi', width: 16 }, { header: 'Số HĐ', key: 'so_hd', width: 12 }, { header: 'Tên', key: 'ten', width: 32 }, { header: 'Ngày', key: 'ngay', width: 12 }, m('Giá trị (Sổ sách)', 'giaTriA'), m('Giá trị (HĐĐT)', 'giaTriB'), m('Thuế (Sổ sách)', 'thueA', 16), m('Thuế (HĐĐT)', 'thueB', 16), { header: 'Trạng thái', key: 'trangThai', width: 22 }, { header: 'Ghi chú', key: 'ghiChu', width: 60 }];
    const tone = (row) => TONE[row.cls];
    const overview = [{ chiTieu: '✅ Khớp', v: r.soKhop, cls: 'ok' }, { chiTieu: '🟡 Lệch số tiền', v: r.soLech, cls: 'warn' }, { chiTieu: '🔴 Chỉ có ở 1 bên', v: r.soThieu, cls: 'bad' }, { chiTieu: '⚠️ Sai ký hiệu', v: r.dsKyHieuSai.length, cls: 'kyhieusai' }, { chiTieu: 'Khóa đối chiếu', v: r.modeLabel }, { chiTieu: 'Nguồn HĐĐT', v: r.hdLabel }, { chiTieu: 'Dung sai (đồng)', v: r.tol }];
    const sheets = [
      { name: 'Tổng quan', title: `ĐỐI CHIẾU 3 NGUỒN THUẾ GTGT — ${r.loai === 'mua' ? 'MUA VÀO' : 'BÁN RA'}`, subtitle: tkLine, columns: [{ header: 'Chỉ tiêu', key: 'chiTieu', width: 26 }, { header: 'Giá trị', key: 'v', width: 44, type: 'text' }], rows: overview, rowTone: tone },
    ];
    if (r.tk) {
      const ct = r.ct;
      const rows = [{ ct: 'Giá trị', hd: r.tongHD.gia_tri, ss: r.tongSS.gia_tri, tk: ct.gia_tri, d: (ct.gia_tri ?? 0) - r.tongHD.gia_tri }, { ct: 'Thuế GTGT', hd: r.tongHD.thue, ss: r.tongSS.thue, tk: ct.thue, d: (ct.thue ?? 0) - r.tongHD.thue }];
      sheets.push({ name: 'Đối chiếu chỉ tiêu', title: `ĐỐI CHIẾU CHỈ TIÊU TỜ KHAI (${ct.tag})`, subtitle: tkLine, columns: [{ header: 'Chỉ tiêu', key: 'ct', width: 16 }, m('HĐĐT (độc lập)', 'hd', 20), m('Sổ sách kế toán', 'ss', 20), m('Đã kê khai (tờ khai)', 'tk', 22), m('Chênh lệch (khai − HĐĐT)', 'd', 24)], rows, rowTone: (row) => (Math.abs(row.d) > r.tol ? 'bad' : undefined) });
    }
    sheets.push({ name: 'Đối chiếu chi tiết', title: 'ĐỐI CHIẾU CHI TIẾT TỪNG HÓA ĐƠN', subtitle: tkLine, columns: detailCols, rows: r.ketQua, rowTone: tone });
    if (r.dsKyHieuSai.length) sheets.push({ name: 'Sai ký hiệu', title: 'HÓA ĐƠN SAI KÝ HIỆU', columns: [{ header: 'Số HĐ', key: 'so_hd', width: 12 }, { header: 'Tên', key: 'ten', width: 32 }, { header: 'Ngày', key: 'ngay', width: 12 }, { header: 'Ký hiệu (Sổ sách)', key: 'kyHieuSS', width: 20 }, { header: 'Ký hiệu (HĐĐT)', key: 'kyHieuHD', width: 20 }], rows: r.dsKyHieuSai, rowTone: () => 'gold' });
    if (r.dsThieuKyHieu.length) sheets.push({ name: 'Thiếu ký hiệu', title: 'SỐ HÓA ĐƠN THIẾU KÝ HIỆU', columns: [{ header: 'Nguồn bị thiếu', key: 'nguon', width: 16 }, { header: 'Số HĐ', key: 'so_hd', width: 12 }, { header: 'Tên', key: 'ten', width: 32 }, { header: 'Ngày', key: 'ngay', width: 12 }, m('Giá trị', 'gia_tri'), { header: 'Trạng thái sau đối chiếu', key: 'trangThai', width: 24 }], rows: r.dsThieuKyHieu });
    await withLoading('Đang tạo file Excel…', () => exportSheets('doi_chieu_3_nguon_gtgt', sheets, { rows: r.ketQua.length }));
  }

  // ------------------------------------------------------------ Dựng giao diện
  const card = (side, title, hint, ...body) => {
    const b = boxes[side];
    b.detect = h('div.detect-box'); b.sheets = h('div.sheetlist-box'); b.cols = h('div.colmap-box');
    return h('div.file-box', { style: { display: 'grid', gap: '6px', alignContent: 'start' } }, h('label.name-label', { style: { fontWeight: 650, fontSize: '13px' } }, title), h('div.hint', hint), ...body, b.detect, b.sheets, b.cols);
  };
  const hdUpload = dropZone({ title: 'Chọn 1 hoặc nhiều tệp .xlsx', hint: 'hoặc kéo thả', accept: '.xlsx', multiple: true, onFiles: (f) => loadFiles('HD', f) });
  const hdSyncedBox = h('div', { style: { display: 'grid', gap: '6px' } }, hdInfo, S.invoices.length ? null : h('div.hint', 'Chưa có hóa đơn đã đồng bộ. Vào Đồng bộ dữ liệu, hoặc dùng tệp Excel.'));
  const hdModeCtl = h('div.seg-control', { role: 'group' },
    h('button', { type: 'button', class: S.hdMode === 'synced' ? 'active' : '', disabled: !S.invoices.length, onclick: () => setHdMode('synced') }, 'Dữ liệu đã đồng bộ'), h('button', { type: 'button', class: S.hdMode === 'upload' ? 'active' : '', onclick: () => setHdMode('upload') }, 'Tệp Excel từ cổng Thuế'));
  function setHdMode(m) {
    S.hdMode = m; [...hdModeCtl.children].forEach((b, i) => b.classList.toggle('active', (i === 0) === (m === 'synced')));
    hdUpload.hidden = m !== 'upload'; hdSyncedBox.hidden = m !== 'synced';
    ['detect', 'sheets', 'cols'].forEach((k) => { boxes.HD[k].hidden = m !== 'upload'; });
    refreshHdInfo(); checkReady();
  }

  const ssCard = card('SS', 'Sổ sách kế toán (phần mềm)', h('span', '1 tệp Excel — ', btnLink('tải tệp mẫu', () => templateSoSach(S.loai))), dropZone({ title: 'Chọn tệp .xlsx', hint: 'hoặc kéo thả', accept: '.xlsx', multiple: false, onFiles: (f) => loadFiles('SS', f) }));
  const hdCard = card('HD', 'HĐĐT Cục Thuế', h('span', 'Dữ liệu đã đồng bộ, hoặc nhiều tệp (không mã / có mã / máy tính tiền) — ', btnLink('tải tệp mẫu', () => templateHDDT(S.loai))), hdModeCtl, hdSyncedBox, hdUpload);
  const tkCard = card('TK', 'Tờ khai 01/GTGT đã nộp', 'Tệp XML kết xuất từ HTKK (không bắt buộc)', dropZone({ title: 'Chọn tệp .xml', hint: 'hoặc kéo thả', accept: '.xml', multiple: false, onFiles: loadTK }));

  host.append(
    h('section.panel', h('div.panel-head', h('div', h('h2', 'Đối chiếu 3 nguồn thuế GTGT'), h('p', 'Sổ sách kế toán ↔ HĐĐT Cục Thuế ↔ Tờ khai 01/GTGT đã nộp (XML). Tự nhận diện cột, đối chiếu từng hóa đơn và tổng theo chỉ tiêu tờ khai.'))),
      h('div', { style: { display: 'grid', gap: '16px', gridTemplateColumns: 'minmax(0, 1fr)' } }, h('div', h('h3.section-title', 'Loại đối chiếu'), loaiCtl),
        h('div.three-col', ssCard, hdCard, tkCard),
        h('div.form-grid', field('Mức chênh lệch vẫn coi là khớp (đồng)', tol),
          field('Kỳ của hóa đơn đã đồng bộ', per, 'Chỉ dùng khi HĐĐT lấy từ dữ liệu đã đồng bộ.'), h('div.field', h('label', 'Từ ngày – đến ngày'), h('div.row-gap', from, to)),
          field('Chỉ tiêu tờ khai', ctSel, 'Thẻ ctNN trong XML có thể không trùng số chỉ tiêu in trên tờ khai ở mọi doanh nghiệp; nếu số khác tờ khai giấy, chọn cặp thẻ khác.')),
        h('div.row-gap', { style: { justifyContent: 'space-between', flexWrap: 'wrap' } }, warn, runBtn))),
    resultBox);
  setHdMode(S.hdMode);
  return () => {};
}
