/**
 * login.js — Màn hình "Đăng nhập".
 *
 * Luồng đăng nhập cổng Thuế: tải ảnh mã xác thực (CAPTCHA) → người dùng TỰ đọc và nhập → gửi
 * tên đăng nhập + mật khẩu + mã xác thực. Ứng dụng không giải, không bỏ qua mã xác thực.
 * Mật khẩu chỉ nằm trong RAM khoảng vài giây khi gửi, xóa khỏi ô nhập ngay sau đó, không ghi nhật ký.
 *
 * Ngoài ra có hai chế độ không cần cổng Thuế: "Dữ liệu mẫu" (thử ứng dụng) và "Ngoại tuyến"
 * (chỉ làm việc với dữ liệu đã lưu / nhập từ XML, Excel).
 */
import { h, clear, fmtDateTime, isValidTaxCode } from './utils.js';
import { state, setSession } from './core/state.js';
import { gdt, resolveTransport } from './api.js';
import { DEMO_COMPANY } from './core/demo.js';
import { upsertCompany, activateCompany, rememberAccount, listAccounts, removeAccount } from './core/companies.js';
import { icon, toast, withLoading, field, openModal, confirmDialog } from './core/ui.js';
import { sessionInfo } from './core/shell.js';
import { logger } from './logger.js';
import { go } from './core/router.js';
import { bridgeCard } from './bridgeCard.js';

const TRANSPORT_TEXT = {
  electron: 'Ứng dụng máy tính (Electron) — gọi thẳng cổng Thuế',
  proxy: 'Máy chủ trung gian cục bộ (server/server.mjs)',
  direct: 'Trình duyệt gọi thẳng — thường bị chặn CORS, nên chạy server/server.mjs hoặc bản Electron',
};

export async function mount(host) {
  const view = h('div.login-layout');
  host.append(view);
  let captcha = { key: '', image: '' };
  let disposed = false;

  let bridge = null;
  const render = () => {
    bridge?.stop();
    bridge = bridgeCard({ onUse: useBridge });
    const direct = loginCard();
    const older = h('details', { open: state.session?.status === 'expired' },
      h('summary', { style: { cursor: 'pointer', fontWeight: 600, padding: '4px 2px', color: 'var(--ink-2)' } }, 'Cách cũ: đăng nhập trực tiếp trong eTax Manager (thường bị cổng Thuế chặn)'), h('div', { style: { marginTop: '10px' } }, direct));
    let started = false;
    const start = () => { if (older.open && !started) { started = true; direct.startCaptcha(); } };
    older.addEventListener('toggle', start);
    clear(view).append(h('div', { style: { display: 'grid', gap: '18px', alignContent: 'start' } }, bridge.el, older, direct.altBlock), sessionPanel());
    start();
  };

  /** Phiên "qua trang Thuế": dùng tiện ích trên trang Thuế để lấy hóa đơn; ứng dụng không giữ mật khẩu/token. */
  async function useBridge(mst) {
    await upsertCompany({ tax: mst, name: '' });
    setSession({ mode: 'bridge', username: mst, taxCode: mst, companyName: '', userName: 'Đăng nhập qua trang Thuế', loginAt: Date.now(), status: 'active', token: 'bridge' });
    await activateCompany(mst);
    await logger.info('login', `Dùng phiên đăng nhập trên trang Thuế (MST ${mst})`, { via: 'extension' });
    toast('Đã sẵn sàng đồng bộ qua trang Thuế.', 'ok');
    go('sync');
  }

  // ------------------------------------------------------------ Thẻ đăng nhập
  function loginCard() {
    const user = h('input', { type: 'text', autocomplete: 'username', placeholder: 'Mã số thuế / tên đăng nhập', spellcheck: false });
    const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Mật khẩu' });
    const code = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Nhập ký tự trong ảnh', maxlength: 8, spellcheck: false });
    const img = h('div.captcha-img', h('span.muted', 'Chưa tải mã xác thực'));
    const blockedBox = h('div');
    const transportLine = h('div.hint', 'Đang kiểm tra kênh kết nối…');
    resolveTransport().then((tr) => { transportLine.textContent = `Kênh kết nối: ${TRANSPORT_TEXT[tr] || tr}`; });

    const showCaptcha = (content, isError) => {
      clear(img);
      if (content.image) img.append(h('img', { src: content.image, alt: 'Mã xác thực do cổng Thuế cấp' }));
      else img.append(h('span.muted', { style: isError ? { color: '#b42f27' } : null }, content.message || ''));
    };
    async function loadCaptcha() {
      showCaptcha({ message: 'Đang tải mã xác thực…' });
      try {
        captcha = await gdt.captcha();
        if (disposed) return;
        showCaptcha(captcha);
        code.value = '';
      } catch (e) {
        captcha = { key: '', image: '' };
        showCaptcha({ message: e.message }, true);
      }
    }

    /** Khi cổng Thuế chặn đăng nhập tự động: giải thích và chỉ cách làm khác (không tìm cách vượt lớp chặn). */
    function showBlocked() {
      clear(blockedBox).append(h('div.notice.warn', { style: { marginBottom: '16px' } }, icon('alert', 18), h('div', { style: { display: 'grid', gap: '8px' } },
        h('b', 'Cổng Thuế đã chặn yêu cầu đăng nhập tự động'),
        h('div', 'Đây không phải do sai mật khẩu hay mã xác thực: cổng có lớp bảo vệ chống truy cập tự động và đã từ chối yêu cầu này. Đừng thử lại liên tục (nhiều lần bị từ chối có thể khiến tài khoản bị hạn chế).'),
        h('div', h('b', 'Cách làm chắc chắn, không cần đăng nhập tại đây:')),
        h('ol', { style: { margin: '0', paddingLeft: '20px' } },
          h('li', 'Mở https://hoadondientu.gdt.gov.vn bằng trình duyệt và đăng nhập như bình thường.'),
          h('li', 'Vào Tra cứu hóa đơn, chọn khoảng ngày rồi Xuất Excel (làm riêng mua vào, bán ra; có thể có thêm tệp cho hóa đơn máy tính tiền).'),
          h('li', 'Quay lại đây: mục Excel để nhập vào kho dữ liệu, hoặc mục Đối chiếu để nạp thẳng các tệp Excel đó.')),
        h('div.row-gap', { style: { flexWrap: 'wrap' } },
          h('button.btn.sm.primary', { type: 'button', onclick: () => goWithCompany('excel') }, icon('sheet', 15), h('span', 'Nhập Excel từ cổng Thuế')),
          h('button.btn.sm', { type: 'button', onclick: () => goWithCompany('reconcile') }, icon('compare', 15), h('span', 'Đối chiếu 3 nguồn'))))));
    }
    /** Các trang nhập/đối chiếu cần một doanh nghiệp (MST): chưa có thì hỏi MST trước (chế độ ngoại tuyến), rồi mới chuyển trang. */
    const goWithCompany = (route) => (state.companyTax ? go(route) : startOffline(() => go(route), user.value.trim()));

    async function submit(ev) {
      ev.preventDefault();
      const username = user.value.trim();
      const password = pass.value;
      const captchaText = code.value.trim();
      if (!username || !password) return toast('Nhập tên đăng nhập và mật khẩu.', 'warn');
      if (!captcha.key) return toast('Chưa có mã xác thực. Bấm "Đổi mã" để tải lại.', 'warn');
      if (!captchaText) return toast('Nhập mã xác thực hiển thị trong ảnh.', 'warn');
      try {
        await withLoading('Đang đăng nhập cổng Thuế…', async () => {
          await gdt.login({ username, password, captchaText, captchaKey: captcha.key });
          pass.value = ''; // xóa mật khẩu khỏi giao diện ngay khi đã gửi
          const prof = await gdt.profile(username);
          const session = { mode: 'gdt', username, taxCode: prof.taxCode, companyName: prof.companyName, userName: prof.userName, loginAt: Date.now(), status: 'active', token: gdt.token };
          await upsertCompany({ tax: session.taxCode, name: session.companyName });
          await rememberAccount({ username, taxCode: session.taxCode, companyName: session.companyName });
          setSession(session);
          await activateCompany(session.taxCode);
          await logger.info('login', `Đăng nhập thành công: ${session.taxCode}`, { username, taxCode: session.taxCode });
        });
        toast('Đăng nhập thành công.', 'ok', { action: { label: 'Đồng bộ ngay', onClick: () => go('sync') } });
        render();
      } catch (e) {
        pass.value = '';
        await logger.warn('login', e.blocked ? 'Cổng Thuế chặn yêu cầu đăng nhập tự động (hệ thống chống truy cập tự động)' : `Đăng nhập thất bại: ${e.message}`, { username });
        if (e.blocked) showBlocked(); else toast(e.message, 'bad');
        loadCaptcha(); // mã xác thực chỉ dùng được một lần
      }
    }

    const saved = h('div.acct-list');
    listAccounts().then((list) => {
      const gdtAccts = list.filter((a) => a.mode === 'gdt');
      if (!gdtAccts.length) return;
      saved.append(h('div.section-title', 'Tài khoản đã dùng (chỉ nhớ tên đăng nhập, không nhớ mật khẩu)'));
      for (const a of gdtAccts.slice(0, 5)) {
        saved.append(h('div.acct-row', icon('building', 16),
          h('div.grow', h('b', a.companyName || a.username), h('span.muted', a.username)),
          h('button.btn.sm', { type: 'button', onclick: () => { user.value = a.username; pass.focus(); } }, 'Dùng'),
          h('button.icon-btn', { type: 'button', 'aria-label': 'Quên tài khoản này', onclick: async () => { await removeAccount(a.id); render(); } }, icon('x', 14))));
      }
    });

    const form = h('form', { onsubmit: submit, autocomplete: 'on' },
      blockedBox,
      h('div.form-grid', { style: { gridTemplateColumns: '1fr' } },
        field('Tên đăng nhập', user),
        field('Mật khẩu', pass),
        h('div.field', h('label', 'Mã xác thực'),
          h('div.captcha-box', img, h('button.btn', { type: 'button', onclick: loadCaptcha, title: 'Tải mã mới' }, icon('refresh', 16), h('span', 'Đổi mã'))),
          code, h('div.hint', 'Bạn tự đọc ảnh và nhập. Ứng dụng không giải mã xác thực thay bạn.'),
          h('div', h('button.btn.sm.quiet', { type: 'button', onclick: () => go('settings') }, icon('wifioff', 15), h('span', 'Kiểm tra kết nối cổng Thuế')))),
      ),
      h('div.row-gap', { style: { marginTop: '16px' } }, h('button.btn.primary', { type: 'submit' }, icon('key', 16), h('span', 'Đăng nhập')), transportLine));

    const alt = h('div.row-gap', { style: { flexWrap: 'wrap', marginTop: '4px' } },
      h('button.btn', { type: 'button', onclick: () => startDemo() }, icon('play', 16), h('span', 'Dùng dữ liệu mẫu')),
      h('button.btn', { type: 'button', onclick: () => startOffline() }, icon('wifioff', 16), h('span', 'Làm việc ngoại tuyến')));

    const card = h('section.panel.login-card', h('div.panel-head', h('div', h('h2', 'Cổng Thuế điện tử'), h('p', 'hoadondientu.gdt.gov.vn — dùng tài khoản của doanh nghiệp'))), form,
      h('div', { style: { marginTop: '18px', display: 'grid', gap: '14px' } }, saved,
        h('div.notice.info', icon('shield', 18), h('div', 'Mật khẩu và token chỉ giữ trong bộ nhớ của tab này, không lưu vào CSDL hay nhật ký. Đóng tab là mất phiên.')),
        null));
    showCaptcha({ message: 'Đang mở…' });
    card.altBlock = h('section.panel', h('div.section-title', 'Không có kết nối hoặc chỉ muốn thử?'), alt); // luôn hiện, không nằm trong mục "cách cũ"
    card.startCaptcha = loadCaptcha; // chỉ tải mã xác thực khi người dùng mở mục "cách cũ" (tránh gọi cổng Thuế không cần thiết)
    return card;
  }

  // ------------------------------------------------------------ Chế độ dữ liệu mẫu / ngoại tuyến
  async function startDemo() {
    await upsertCompany({ tax: DEMO_COMPANY.taxCode, name: DEMO_COMPANY.companyName });
    setSession({ mode: 'demo', username: 'demo', taxCode: DEMO_COMPANY.taxCode, companyName: DEMO_COMPANY.companyName, userName: DEMO_COMPANY.userName, loginAt: Date.now(), status: 'active', token: 'demo' });
    await activateCompany(DEMO_COMPANY.taxCode);
    await logger.info('login', 'Bật chế độ dữ liệu mẫu');
    toast('Đã bật dữ liệu mẫu (không kết nối cổng Thuế).', 'info', { action: { label: 'Nạp dữ liệu', onClick: () => go('sync') } });
    render();
  }

  function startOffline(then, prefill = '') {
    const tax = h('input', { type: 'text', placeholder: '0123456789', value: state.companyTax || (isValidTaxCode(prefill) ? prefill : ''), spellcheck: false });
    const name = h('input', { type: 'text', placeholder: 'Tên doanh nghiệp (tùy chọn)' });
    openModal({
      title: 'Làm việc ngoại tuyến',
      body: h('div.form-grid', { style: { gridTemplateColumns: '1fr' } },
        h('p.muted', 'Không cần đăng nhập. Bạn nhập hóa đơn từ XML/Excel hoặc xem lại dữ liệu đã đồng bộ. Mỗi mã số thuế có dữ liệu riêng.'),
        field('Mã số thuế doanh nghiệp', tax), field('Tên doanh nghiệp', name)),
      actions: [{ label: 'Hủy' }, {
        label: 'Bắt đầu', kind: 'primary', onClick: async () => {
          const t = tax.value.trim();
          if (!isValidTaxCode(t)) { toast('Mã số thuế cần 10 số (có thể kèm -XXX) hoặc 12 số.', 'warn'); return false; }
          await upsertCompany({ tax: t, name: name.value.trim() });
          setSession({ mode: 'offline', username: '', taxCode: t, companyName: name.value.trim(), userName: 'Ngoại tuyến', loginAt: Date.now(), status: 'offline', token: '' });
          await activateCompany(t);
          await logger.info('login', `Làm việc ngoại tuyến với MST ${t}`);
          render();
          then?.();
          return true;
        },
      }],
    });
  }

  // ------------------------------------------------------------ Thẻ phiên đăng nhập
  function sessionPanel() {
    const s = state.session;
    const info = sessionInfo(s);
    const modeText = { gdt: 'Cổng Thuế điện tử', bridge: 'Qua trang Thuế (tiện ích trình duyệt)', demo: 'Dữ liệu mẫu', offline: 'Ngoại tuyến' }[s?.mode] || '—';
    const stampText = { active: 'Phiên hợp lệ', expired: 'Hết phiên', out: 'Chưa đăng nhập', demo: 'Dữ liệu mẫu', offline: 'Ngoại tuyến' }[info.tone];
    const rows = [
      ['Tên doanh nghiệp', s?.companyName || (s ? '(chưa có tên — cổng không trả về)' : '—')],
      ['Mã số thuế', s?.taxCode || '—'],
      ['Người sử dụng', s?.userName || '—'],
      ['Thời gian đăng nhập', s ? fmtDateTime(s.loginAt) : '—'],
      ['Trạng thái phiên', info.label],
      ['Nguồn dữ liệu', modeText],
    ];
    const actions = h('div.row-gap', { style: { flexWrap: 'wrap' } });
    if (s) {
      actions.append(h('button.btn.danger', { type: 'button', onclick: logout }, icon('logout', 16), h('span', 'Đăng xuất')));
      if ((s.mode === 'gdt' || s.mode === 'bridge') && s.status !== 'expired') actions.append(h('button.btn.primary', { type: 'button', onclick: () => go('sync') }, icon('sync', 16), h('span', 'Đồng bộ dữ liệu')));
    }
    return h('section.panel.session-panel',
      h('div.panel-head', h('div', h('h2', 'Phiên làm việc'), h('p', 'Thông tin tài khoản đang dùng trong ứng dụng'))),
      h(`div.big-stamp.tone-${info.tone}`, stampText, s?.taxCode && h('small', `MST ${s.taxCode}`)),
      h('dl.kv-list', rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)])),
      s?.status === 'expired' && h('div.notice.warn', icon('alert', 18), h('div', 'Phiên đã hết hạn. Nhập lại mật khẩu và mã xác thực ở khung bên trái để tiếp tục đồng bộ. Dữ liệu đã lưu vẫn còn.')),
      actions);
  }

  async function logout() {
    if (!(await confirmDialog({ title: 'Đăng xuất', message: 'Dữ liệu hóa đơn đã lưu trên máy vẫn được giữ. Bạn cần đăng nhập lại để đồng bộ.', confirmLabel: 'Đăng xuất' }))) return;
    await logger.info('login', 'Đăng xuất');
    gdt.setToken(null);
    setSession(null);
    render();
  }

  render();
  return () => { disposed = true; bridge?.stop(); };
}
