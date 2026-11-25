/**
 * bridgeCard.js — Khung "Đăng nhập bằng trang Thuế (khuyên dùng)" trên trang Đăng nhập.
 * Người dùng mở trang Thuế thật, tự đăng nhập ở đó; tiện ích trình duyệt báo về đây khi đã đăng nhập, rồi đồng bộ.
 */
import { h, clear, isValidTaxCode } from './utils.js';
import { state } from './core/state.js';
import { bridgeStatus } from './core/bridge.js';
import { icon, field, openModal, toast } from './core/ui.js';

const PORTAL = 'https://hoadondientu.gdt.gov.vn';

/**
 * @param {{onUse:(mst:string)=>Promise<void>}} o
 * @returns {{el:HTMLElement, stop:()=>void}}
 */
export function bridgeCard({ onUse }) {
  let st = null;
  let timer = null;
  const rows = h('div', { style: { display: 'grid', gap: '6px' } });
  const useBtn = h('button.btn.primary', { type: 'button', disabled: true, onclick: use }, icon('check', 16), h('span', 'Dùng phiên này để đồng bộ'));
  const dot = (tone, text) => h('div.row-gap', h(`span.badge.tone-${tone}`, tone === 'ok' ? 'Đã có' : tone === 'bad' ? 'Chưa' : '…'), h('span', text));

  function draw() {
    const server = !!st;
    const extOk = server && st.extAgeMs != null && st.extAgeMs < 15000;
    const logged = extOk && st.ext?.loggedIn;
    clear(rows).append(
      dot(server ? 'ok' : 'bad', server ? 'eTax Manager đang chạy máy chủ cầu nối cục bộ' : 'Chưa kết nối máy chủ cục bộ (127.0.0.1:8080) — hãy mở lại ứng dụng hoặc chạy Chay-eTax.bat'),
      dot(extOk ? 'ok' : 'bad', extOk ? 'Tiện ích trình duyệt đã kết nối' : 'Chưa thấy tiện ích — cài tiện ích (một lần) rồi mở trang Thuế'),
      dot(logged ? 'ok' : 'bad', logged ? `Trang Thuế đã đăng nhập${st.ext.mst ? ` (MST ${st.ext.mst})` : ''}` : 'Trang Thuế chưa đăng nhập — tự đăng nhập ở tab Thuế'));
    useBtn.disabled = !logged;
  }

  async function poll() { st = await bridgeStatus(); draw(); }

  function use() {
    const mst = st?.ext?.mst || state.companyTax || '';
    if (isValidTaxCode(mst) && st?.ext?.mst) return onUse(mst);
    const tax = h('input', { type: 'text', value: mst, placeholder: '0123456789', spellcheck: false });
    openModal({
      title: 'Mã số thuế doanh nghiệp', size: 'sm',
      body: h('div.form-grid', { style: { gridTemplateColumns: '1fr' } }, h('p.muted', 'Trang Thuế không cho biết mã số thuế qua tiện ích. Nhập MST của doanh nghiệp vừa đăng nhập.'), field('Mã số thuế', tax)),
      actions: [{ label: 'Hủy' }, { label: 'Tiếp tục', kind: 'primary', onClick: async () => { const t = tax.value.trim(); if (!isValidTaxCode(t)) { toast('MST cần 10 số (có thể kèm -XXX) hoặc 12 số.', 'warn'); return false; } await onUse(t); return true; } }],
    });
  }

  const steps = h('details', { style: { fontSize: '13px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, 'Cài tiện ích (chỉ một lần)'),
    h('ol', { style: { margin: '8px 0 0', paddingLeft: '20px', display: 'grid', gap: '4px' } },
      h('li', 'Trong Chrome hoặc Edge, gõ vào thanh địa chỉ: chrome://extensions (Edge: edge://extensions) rồi Enter.'),
      h('li', 'Bật công tắc "Chế độ nhà phát triển" (góc trên bên phải).'),
      h('li', 'Bấm "Tải tiện ích đã giải nén" (Load unpacked).'),
      h('li', 'Chọn thư mục "extension" nằm trong thư mục eTax của bạn (cùng chỗ với Chay-eTax.bat). Xong.'),
      h('li', 'Mở lại trang Thuế: góc dưới bên phải sẽ có hộp "eTax - Tải hóa đơn hàng loạt".')));

  const el = h('section.panel', h('div.panel-head', h('div', h('h2', 'Đăng nhập bằng trang Thuế (khuyên dùng)'), h('p', 'Bạn đăng nhập trên chính trang hoadondientu.gdt.gov.vn; mật khẩu không đi qua eTax Manager'))),
    h('div', { style: { display: 'grid', gap: '12px' } },
      h('ol', { style: { margin: 0, paddingLeft: '20px', display: 'grid', gap: '4px', fontSize: '13px' } },
        h('li', 'Bấm "Mở trang Thuế" và đăng nhập như bình thường (tự nhập mật khẩu, mã xác thực).'),
        h('li', 'Quay lại đây: khi cả ba dòng bên dưới báo "Đã có", bấm "Dùng phiên này để đồng bộ".'),
        h('li', 'Trên trang Thuế mở Tra cứu → Tra cứu hóa đơn và để tab đó mở. Trong "Đồng bộ dữ liệu" chọn kỳ rồi bấm Bắt đầu: tiện ích tự nhận lệnh và chạy (không cần bấm gì ở trang Thuế).')),
      rows,
      h('div.row-gap', { style: { flexWrap: 'wrap' } }, h('button.btn', { type: 'button', onclick: () => window.open(PORTAL, '_blank', 'noopener') }, icon('link', 16), h('span', 'Mở trang Thuế')), useBtn),
      steps));
  draw(); poll(); timer = setInterval(poll, 2000);
  return { el, stop: () => clearInterval(timer) };
}
