/**
 * settings.js — Trang "Cài đặt": giao diện, đồng bộ tự động, thư mục lưu, kênh kết nối,
 * doanh nghiệp & tài khoản, sao lưu / khôi phục / đặt lại.
 */
import { h, clear, fmtInt, fmtBytes, fmtDateTime, todayISO, isValidTaxCode } from '../utils.js';
import { state, bus } from '../core/state.js';
import { APP, GDT_PROFILES } from '../config.js';
import { repos, storageEstimate } from '../storage.js';
import { saveSettings } from '../core/settings.js';
import { listCompanies, upsertCompany, activateCompany, removeCompany, listAccounts, removeAccount } from '../core/companies.js';
import { pickSaveFolder, clearSaveFolder, supportsFolderPicker, isElectron, saveFile, canInstall, promptInstall } from '../core/platform.js';
import { resolveTransport, diagnose, resetDetectedProfile } from '../api.js';
import { createBackup, restoreBackup, resetEverything } from '../core/backup.js';
import { touchAutoSync } from '../core/autosync.js';
import { icon, select, field, toast, confirmDialog, openModal, progressPanel } from '../core/ui.js';
import { pickFiles } from '../utils.js';

/** Một dòng cài đặt: nhãn + mô tả bên trái, điều khiển bên phải. */
const row = (label, desc, control) => h('div.setting-row', h('div.txt', h('b', label), desc && h('span', desc)), control);
const card = (title, sub, ...kids) => h('section.panel', h('div.panel-head', h('div', h('h2', title), sub && h('p', sub))), ...kids);

export async function mount(host) {
  const s = state.settings;

  // ------------------------------------------------------------ Giao diện
  const theme = select([['auto', 'Theo hệ điều hành'], ['light', 'Sáng'], ['dark', 'Tối']], s.theme, { onchange: (e) => saveSettings({ theme: e.target.value }) });
  const lang = select([['vi', 'Tiếng Việt'], ['en', 'English']], s.language, { onchange: (e) => saveSettings({ language: e.target.value }) });
  const pageSize = select([['25', '25'], ['50', '50'], ['100', '100'], ['200', '200']], String(s.pageSizeGrid), { onchange: (e) => saveSettings({ pageSizeGrid: Number(e.target.value) }) });
  const excl = h('input', { type: 'checkbox', checked: !!s.excludeCancelled, onchange: (e) => saveSettings({ excludeCancelled: e.target.checked }) });

  // ------------------------------------------------------------ Đồng bộ
  const auto = h('input', { type: 'checkbox', checked: !!s.autoSync, onchange: (e) => { saveSettings({ autoSync: e.target.checked }); touchAutoSync(); } });
  const interval = select([['15', '15 phút'], ['30', '30 phút'], ['60', '1 giờ'], ['180', '3 giờ'], ['360', '6 giờ'], ['720', '12 giờ']], String(s.syncIntervalMin), { onchange: (e) => { saveSettings({ syncIntervalMin: Number(e.target.value) }); touchAutoSync(); } });
  const detail = h('input', { type: 'checkbox', checked: !!s.syncDetail, onchange: (e) => saveSettings({ syncDetail: e.target.checked }) });
  const detailConcurrency = select([['1', '1 luồng (chậm, an toàn)'], ['2', '2 luồng (mặc định)'], ['3', '3 luồng'], ['4', '4 luồng'], ['6', '6 luồng (nhanh)']], String(s.detailConcurrency ?? 2), { onchange: (e) => saveSettings({ detailConcurrency: Number(e.target.value) }) });
  const apiGapMs = select([['100', '100 ms'], ['250', '250 ms (mặc định)'], ['500', '500 ms'], ['1000', '1.000 ms (chậm, an toàn)']], String(s.apiGapMs ?? 250), { onchange: (e) => saveSettings({ apiGapMs: Number(e.target.value) }) });

  // ------------------------------------------------------------ Thư mục lưu
  const folderName = h('span', s.saveFolderName || 'Chưa chọn — tệp sẽ tải xuống thư mục Downloads');
  const folderBtns = h('div.row-gap');
  const drawFolder = () => {
    folderName.textContent = state.settings.saveFolderName || 'Chưa chọn — tệp sẽ tải xuống thư mục Downloads';
    clear(folderBtns).append(...[
      supportsFolderPicker() ? h('button.btn.sm', { type: 'button', onclick: async () => { try { const name = await pickSaveFolder(); if (name) { state.settings.saveFolderName = name; drawFolder(); toast('Đã chọn thư mục lưu.', 'ok'); } } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'bad'); } } }, icon('folder', 15), h('span', 'Chọn thư mục')) : null,
      state.settings.saveFolderName ? h('button.btn.sm', { type: 'button', onclick: async () => { await clearSaveFolder(); state.settings.saveFolderName = ''; drawFolder(); } }, 'Bỏ chọn') : null].filter(Boolean));
  };

  // ------------------------------------------------------------ Kết nối
  const transport = select([['auto', 'Tự động'], ['electron', 'Ứng dụng máy tính (Electron)'], ['proxy', 'Máy chủ trung gian cục bộ'], ['direct', 'Trình duyệt gọi thẳng']], s.transport, { onchange: (e) => saveSettings({ transport: e.target.value }) });
  const profile = select([['auto', 'Tự động (thử lần lượt, khuyên dùng)'], ...GDT_PROFILES.map((p) => [p.id, p.label]), ['custom', 'Tùy chỉnh…']], s.gdtProfile || 'auto', {
    onchange: async (e) => { await saveSettings({ gdtProfile: e.target.value }); resetDetectedProfile(); custom.hidden = e.target.value !== 'custom'; },
  });
  const baseUrl = h('input', { type: 'url', value: s.baseUrl || '', placeholder: 'https://hoadondientu.gdt.gov.vn', onchange: (e) => { saveSettings({ baseUrl: e.target.value.trim() }); resetDetectedProfile(); } });
  const apiPrefix = h('input', { type: 'text', value: s.apiPrefix ?? '/api', placeholder: '/api (hoặc để trống)', onchange: (e) => { saveSettings({ apiPrefix: e.target.value.trim() }); resetDetectedProfile(); } });
  const custom = h('div.form-grid', { style: { marginTop: '10px' }, hidden: (s.gdtProfile || 'auto') !== 'custom' }, field('Địa chỉ gốc của cổng Thuế', baseUrl), field('Tiền tố đường dẫn API', apiPrefix));
  const proxyUrl = h('input', { type: 'url', value: s.proxyUrl || '', placeholder: 'Để trống = cùng địa chỉ trang này', onchange: (e) => saveSettings({ proxyUrl: e.target.value.trim() }) });
  const probeOut = h('div', { style: { marginTop: '12px', display: 'grid', gap: '8px' } });
  const probe = async () => {
    clear(probeOut).append(h('span.muted', 'Đang kiểm tra (mỗi cấu hình tối đa 15 giây)…'));
    const via = await resolveTransport(true);
    const results = await diagnose();
    const viaText = { electron: 'ứng dụng máy tính (Electron)', proxy: 'máy chủ trung gian cục bộ', direct: 'trình duyệt gọi thẳng (thường bị chặn CORS)' }[via] || via;
    clear(probeOut).append(h('div.muted', `Kênh kết nối: ${viaText}`), ...results.map((r) => h(`div.notice${r.ok ? '.info' : '.warn'}`, icon(r.ok ? 'check' : 'alert', 18),
      h('div', h('b', `${r.profile.label} — ${r.ok ? `kết nối được (${r.ms} ms)` : 'không kết nối được'}`), r.ok ? null : h('div', { style: { overflowWrap: 'anywhere' } }, r.message)))),
    results.some((r) => r.ok) ? h('div.hint', 'Cấu hình chạy được đã được ghi nhớ; bạn có thể quay lại trang Đăng nhập.') : h('div.hint', 'Không cấu hình nào chạy được: thường do mạng (VPN, tường lửa công ty, nhà mạng chặn) hoặc cổng Thuế đang bảo trì. Thử mở https://hoadondientu.gdt.gov.vn trong trình duyệt để so sánh.'));
  };

  // ------------------------------------------------------------ Doanh nghiệp & tài khoản
  const coBox = h('div');
  const acctBox = h('div');
  async function drawCompanies() {
    const list = await listCompanies();
    const counts = new Map();
    for (const inv of await repos.invoices.getAll()) counts.set(inv.companyTax, (counts.get(inv.companyTax) || 0) + 1);
    clear(coBox).append(list.length ? h('div.acct-list', list.map((c) => h('div.acct-row', icon('building', 16),
      h('div.grow', h('b', c.name || '(chưa có tên)'), h('span.muted', `MST ${c.tax} — ${fmtInt(counts.get(c.tax) || 0)} hóa đơn${c.tax === state.companyTax ? ' — đang chọn' : ''}`)),
      c.tax === state.companyTax ? null : h('button.btn.sm', { type: 'button', onclick: async () => { await activateCompany(c.tax); drawCompanies(); } }, 'Chọn'),
      h('button.icon-btn', { type: 'button', 'aria-label': `Xóa ${c.tax}`, onclick: async () => {
        if (!(await confirmDialog({ title: `Xóa doanh nghiệp ${c.tax}?`, message: `Xóa toàn bộ ${fmtInt(counts.get(c.tax) || 0)} hóa đơn, XML/PDF đính kèm và ghi chú của doanh nghiệp này khỏi máy.`, confirmLabel: 'Xóa', danger: true }))) return;
        await removeCompany(c.tax); toast('Đã xóa doanh nghiệp.', 'ok'); drawCompanies();
      } }, icon('trash', 15))))) : h('p.muted', 'Chưa có doanh nghiệp. Doanh nghiệp được tạo khi bạn đăng nhập, dùng dữ liệu mẫu hoặc thêm thủ công.'),
    h('div', { style: { marginTop: '12px' } }, h('button.btn.sm', { type: 'button', onclick: addCompany }, icon('plus', 15), h('span', 'Thêm doanh nghiệp'))));
    const accts = (await listAccounts()).filter((a) => a.mode === 'gdt');
    clear(acctBox).append(accts.length ? h('div.acct-list', accts.map((a) => h('div.acct-row', icon('key', 16), h('div.grow', h('b', a.username), h('span.muted', `Đăng nhập gần nhất ${fmtDateTime(a.lastLoginAt)}`)),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Quên tài khoản', onclick: async () => { await removeAccount(a.id); drawCompanies(); } }, icon('x', 14))))) : h('p.muted', 'Chưa nhớ tài khoản nào. Mật khẩu không bao giờ được lưu.'));
  }

  function addCompany() {
    const tax = h('input', { type: 'text', placeholder: '0123456789', spellcheck: false });
    const name = h('input', { type: 'text', placeholder: 'Tên doanh nghiệp' });
    openModal({ title: 'Thêm doanh nghiệp', body: h('div.form-grid', { style: { gridTemplateColumns: '1fr' } }, field('Mã số thuế', tax), field('Tên doanh nghiệp', name)),
      actions: [{ label: 'Hủy' }, { label: 'Thêm', kind: 'primary', onClick: async () => {
        const t = tax.value.trim();
        if (!isValidTaxCode(t)) { toast('Mã số thuế cần 10 số (có thể kèm -XXX) hoặc 12 số.', 'warn'); return false; }
        await upsertCompany({ tax: t, name: name.value.trim() });
        if (!state.companyTax) await activateCompany(t);
        bus.emit('company:change', state.companyTax);
        drawCompanies();
        return true;
      } }] });
  }

  // ------------------------------------------------------------ Sao lưu
  const usage = h('span.muted');
  storageEstimate().then((e) => { if (e?.usage != null) usage.textContent = `Đang dùng khoảng ${fmtBytes(e.usage)} trên máy.`; });
  const progress = progressPanel();
  progress.el.hidden = true;
  const restoreMode = select([['merge', 'Gộp (ghi đè bản trùng, giữ dữ liệu khác)'], ['replace', 'Thay thế toàn bộ dữ liệu hiện có']], 'merge');
  const autoBackupChk = h('input', { type: 'checkbox', checked: !!s.autoBackup, onchange: (e) => saveSettings({ autoBackup: e.target.checked }) });
  const backupDaySel = select(Array.from({ length: 28 }, (_, i) => [String(i + 1), `Ngày ${i + 1}`]), String(s.backupDay || 20), { onchange: (e) => saveSettings({ backupDay: Number(e.target.value) }) });
  const lastBackupYmLabel = (ym) => {
    if (!ym) return 'Chưa có lần nào';
    const [y, m] = ym.split('-');
    return `Tháng ${m}/${y}`;
  };
  const lastBackupStatus = h('span.muted', `Lần gần nhất: ${lastBackupYmLabel(s.lastBackupYM)}`);

  async function backup() {
    progress.el.hidden = false;
    try {
      const blob = await createBackup({ onProgress: (p, name) => progress.set(p, 'Đang sao lưu…', name) });
      const r = await saveFile(`eTax_backup_${todayISO().replaceAll('-', '')}.json`, blob);
      progress.done('Đã sao lưu');
      toast(r.where === 'download' ? 'Đã tải file sao lưu xuống.' : `Đã lưu ${r.path}`, 'ok');
    } catch (e) { progress.fail('Sao lưu thất bại'); toast(e.message, 'bad'); }
  }

  async function restore() {
    const [file] = await pickFiles({ accept: '.json,application/json', multiple: false });
    if (!file) return;
    if (restoreMode.value === 'replace' && !(await confirmDialog({ title: 'Thay thế toàn bộ dữ liệu?', message: 'Dữ liệu hiện có trên máy sẽ bị xóa và thay bằng nội dung file sao lưu.', confirmLabel: 'Thay thế', danger: true }))) return;
    progress.el.hidden = false;
    try {
      const r = await restoreBackup(file, { mode: restoreMode.value, onProgress: (p, name) => progress.set(p, 'Đang khôi phục…', name) });
      progress.done('Đã khôi phục');
      toast(`Đã khôi phục ${fmtInt(r.restored)} bản ghi. Ứng dụng sẽ tải lại.`, 'ok');
      setTimeout(() => location.reload(), 1200);
    } catch (e) { progress.fail('Khôi phục thất bại'); toast(e.message, 'bad'); }
  }

  async function reset() {
    if (!(await confirmDialog({ title: 'Đặt lại toàn bộ ứng dụng?', message: 'Xóa TẤT CẢ dữ liệu trên máy: doanh nghiệp, hóa đơn, tệp đính kèm, nhật ký và cài đặt. Nên sao lưu trước. Không thể hoàn tác.', confirmLabel: 'Xóa tất cả', danger: true }))) return;
    await resetEverything();
  }

  const updateBox = h('div');
  const checkUpdateBtn = h('button.btn.sm', { type: 'button', onclick: async () => {
    checkUpdateBtn.disabled = true;
    clear(updateBox).append(h('span.muted', 'Đang kiểm tra bản cập nhật mới…'));
    try {
      const res = await fetch('https://api.github.com/repos/saoluucvhak-pixel/ETAX/releases/latest');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rel = await res.json();
      const latestTag = String(rel.tag_name || '').replace(/^v/, '');
      const curVer = String(APP.version || '').replace(/^v/, '');
      if (latestTag && latestTag !== curVer) {
        const exeAsset = (rel.assets || []).find((a) => a.name?.endsWith('.exe'));
        const extAsset = (rel.assets || []).find((a) => a.name?.endsWith('-extension.zip'));
        clear(updateBox).append(h('div.notice.info', icon('download', 18),
          h('div',
            h('b', `Đã có phiên bản mới v${latestTag}! (Bạn đang dùng v${curVer})`),
            h('div', { style: { marginTop: '6px', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
              exeAsset ? h('a.btn.sm.primary', { href: exeAsset.browser_download_url, target: '_blank', rel: 'noopener' }, 'Tải bộ cài (.exe)') : null,
              extAsset ? h('a.btn.sm', { href: extAsset.browser_download_url, target: '_blank', rel: 'noopener' }, 'Tải Extension (.zip)') : null,
              h('a.btn.sm.ghost', { href: rel.html_url, target: '_blank', rel: 'noopener' }, 'Xem chi tiết')))));
      } else {
        clear(updateBox).append(h('div.notice.ok', icon('check', 18), h('div', `Bạn đang sử dụng phiên bản mới nhất (v${curVer}).`)));
      }
    } catch (e) {
      clear(updateBox).append(h('div.notice.warn', icon('alert', 18), h('div', `Không kiểm tra được: ${e.message}`)));
    } finally {
      checkUpdateBtn.disabled = false;
    }
  } }, icon('sync', 15), h('span', 'Kiểm tra cập nhật'));

  host.append(h('div.settings-grid',
    card('Giao diện', null, row('Chế độ màu', 'Sáng, tối hoặc theo hệ điều hành', theme), row('Ngôn ngữ', 'Menu và tiêu đề trang', lang), row('Số dòng mỗi trang (in)', 'Áp dụng cho bản in', pageSize),
      row('Loại hóa đơn hủy khỏi số liệu', 'Hóa đơn hủy / bị thay thế không tính vào báo cáo', excl)),
    card('Đồng bộ tự động', 'Chỉ chạy khi trang đang mở và phiên còn hợp lệ', row('Tự động đồng bộ', 'Tải phần mới của cả hai chiều', auto), row('Chu kỳ', null, interval), row('Tải chi tiết hàng hóa', 'Đầy đủ hơn nhưng chậm hơn', detail), row('Số luồng tải chi tiết', 'Tăng luồng giúp tải nhanh hơn nhưng dễ bị cổng Thuế giới hạn', detailConcurrency), row('Giãn cách gọi cổng Thuế', 'Thời gian nghỉ tối thiểu giữa các yêu cầu API', apiGapMs)),
    card('Thư mục lưu tệp', 'Nơi lưu Excel, PDF, XML, sao lưu', row('Thư mục hiện tại', isElectron() ? 'Ứng dụng máy tính ghi thẳng vào thư mục này' : supportsFolderPicker() ? 'Trình duyệt sẽ hỏi quyền ghi' : 'Trình duyệt không hỗ trợ chọn thư mục, tệp sẽ tải xuống', h('div', { style: { textAlign: 'right', display: 'grid', gap: '6px', justifyItems: 'end' } }, folderName, folderBtns))),
    card('Kết nối cổng Thuế', 'Chỉ đổi khi cổng Thuế thay đổi địa chỉ hoặc bạn dùng máy chủ riêng', row('Kênh kết nối', 'Trình duyệt thường cần máy chủ trung gian (server/server.mjs) do chính sách CORS', transport),
      row('Địa chỉ API cổng Thuế', 'Tự động: thử cách đặt đường dẫn mới (/api) rồi cách cũ (:30000)', profile), custom,
      h('div.form-grid', { style: { marginTop: '10px' } }, field('Địa chỉ máy chủ trung gian', proxyUrl)),
      h('div.row-gap', { style: { marginTop: '12px' } }, h('button.btn.primary.sm', { type: 'button', onclick: probe }, icon('wifioff', 15), h('span', 'Kiểm tra kết nối'))), probeOut),
    card('Doanh nghiệp', 'Mỗi mã số thuế có kho dữ liệu riêng trên máy', coBox),
    card('Tài khoản đã nhớ', 'Chỉ nhớ tên đăng nhập để điền nhanh', acctBox),
    card('Sao lưu và khôi phục', 'File .json chứa toàn bộ dữ liệu trừ mật khẩu và token', h('div', { style: { display: 'grid', gap: '12px' } }, usage,
      h('div.row-gap', { style: { flexWrap: 'wrap' } }, h('button.btn.primary', { type: 'button', onclick: backup }, icon('download', 16), h('span', 'Sao lưu ngay')), h('button.btn', { type: 'button', onclick: restore }, icon('upload', 16), h('span', 'Khôi phục từ file…'))),
      field('Cách khôi phục', restoreMode), progress.el,
      row('Sao lưu tự động hàng tháng', 'Cần trang đang mở và đã chọn thư mục lưu; không tự xóa bản cũ', autoBackupChk),
      row('Ngày chạy trong tháng', 'Nếu mở ứng dụng trễ hơn ngày này thì chạy bù ngay khi mở', backupDaySel),
      row('Trạng thái', null, lastBackupStatus))),
    card('Ứng dụng', `${APP.name} ${APP.version}`, h('div', { style: { display: 'grid', gap: '12px' } },
      h('div.row-gap', { style: { flexWrap: 'wrap' } }, checkUpdateBtn, install),
      updateBox,
      h('div.notice.warn', icon('alert', 18), h('div', 'Đặt lại sẽ xóa toàn bộ dữ liệu trên máy này.')),
      h('div', h('button.btn.danger', { type: 'button', onclick: reset }, icon('trash', 15), h('span', 'Đặt lại ứng dụng')))))));
  drawFolder();
  await drawCompanies();
  const off = bus.on('company:change', drawCompanies);
  return off;
}
