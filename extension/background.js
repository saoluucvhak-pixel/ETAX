/**
 * background.js - Chuyển tin nhắn giữa trang Thuế (content.js) và eTax Manager chạy trên máy này (http://127.0.0.1:CỔNG).
 * Trang Thuế là https nên không gọi thẳng http://127.0.0.1 được; tiện ích gọi hộ.
 * Chỉ chuyển dữ liệu hóa đơn / tiến độ / trạng thái đăng nhập (MST), KHÔNG chuyển token hay mật khẩu.
 * Nếu eTax Manager không chạy thì im lặng (thử lại thưa, mỗi ~12 giây) để không gây nhiễu.
 */
const PORTS = [8080, 8081, 8082, 9000, 3000];
const RETRY_MS = 12000;
let base = null; // http://127.0.0.1:8080
let pair = null;
let lastFail = 0;

const fetchWithTimeout = (url, opts = {}, ms = 8000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
};

async function findBase() {
  for (const p of base ? [Number(new URL(base).port), ...PORTS] : PORTS) {
    try {
      const r = await fetchWithTimeout(`http://127.0.0.1:${p}/gdt/__ping`, { cache: 'no-store' }, 2500);
      if (r.ok && (await r.json()).ok) return `http://127.0.0.1:${p}`;
    } catch { /* thử cổng khác */ }
  }
  return null;
}

async function ensurePair() {
  if (base && pair) return true;
  if (Date.now() - lastFail < RETRY_MS) return false;
  base = await findBase();
  if (!base) { lastFail = Date.now(); return false; }
  try {
    const r = await fetchWithTimeout(`${base}/__bridge/pair`, { cache: 'no-store' }, 4000);
    if (!r.ok) { lastFail = Date.now(); base = null; return false; }
    pair = (await r.json()).pair;
    return true;
  } catch { lastFail = Date.now(); base = null; return false; }
}

async function call(method, path, body) {
  if (!(await ensurePair())) return { ok: false, error: 'Không thấy eTax Manager đang chạy trên máy này. Hãy bấm Chay-eTax.bat trước.' };
  const send = () => fetchWithTimeout(`${base}/__bridge/${path}`, { method, headers: { Authorization: `Bearer ${pair}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }, 10000);
  let r;
  try { r = await send(); } catch { base = pair = null; lastFail = Date.now(); return { ok: false, error: 'Mất kết nối với eTax Manager.' }; }
  if (r.status === 401) { // eTax khởi động lại -> mã ghép cặp mới
    base = pair = null; lastFail = 0;
    if (!(await ensurePair())) return { ok: false, error: 'Không ghép cặp được với eTax Manager.' };
    try { r = await send(); } catch { base = pair = null; return { ok: false, error: 'Mất kết nối với eTax Manager.' }; }
  }
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'bridge') return false;
  call(msg.method || 'GET', msg.path, msg.body).then(reply);
  return true; // trả lời bất đồng bộ
});
