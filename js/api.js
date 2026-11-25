/**
 * api.js — Máy khách gọi cổng hóa đơn điện tử (Tổng cục Thuế).
 *
 * Nguyên tắc bảo mật:
 *  - Người dùng tự nhập tên đăng nhập, mật khẩu và mã xác thực (CAPTCHA) hiển thị từ chính cổng Thuế.
 *    Ứng dụng KHÔNG né tránh / giải hộ CAPTCHA.
 *  - Mật khẩu chỉ nằm trong RAM đến khi gửi đi; không lưu, không ghi nhật ký.
 *  - Token phiên chỉ giữ trong RAM/sessionStorage (mất khi đóng tab).
 *
 * Kênh truyền (transport):
 *  - electron : gọi từ tiến trình chính của Electron (không bị CORS)
 *  - proxy    : gọi qua server/server.mjs cùng nguồn (/gdt/...) — dùng cho Web/PWA
 *  - direct   : gọi thẳng cổng Thuế (thường bị trình duyệt chặn CORS; chỉ hợp khi có tiện ích mở CORS)
 *
 * Mọi lệnh gọi đều có: timeout, thử lại theo cấp số nhân, hủy bằng AbortSignal, phân loại lỗi.
 */
import { GDT, GDT_PROFILES, RETRY, DIRECTION } from './config.js';
import { state } from './core/state.js';
import { desktop } from './core/platform.js';
import { splitDateRange, sleep, b64decode } from './utils.js';
import { unzip, looksLikeZip, bytesToText } from './core/zip.js';
import { logger } from './logger.js';

export class ApiError extends Error {
  constructor(message, { status = 0, retriable = false, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retriable = retriable;
    this.cause = cause;
  }
}
/**
 * Cổng Thuế chặn yêu cầu bằng hệ thống chống truy cập tự động (ví dụ "Hệ thống phát hiện hành vi không hợp lệ. Yêu cầu đã bị chặn.").
 * Khác với sai mật khẩu / hết phiên. Ứng dụng KHÔNG cố vượt qua lớp chặn này (không giả danh chương trình khác);
 * người dùng chuyển sang cách tải Excel/XML từ chính trang cổng Thuế rồi nhập vào ứng dụng.
 */
export class BlockedError extends Error {
  constructor(portalMessage = '', status = 403) {
    super('Cổng Thuế đã chặn yêu cầu này bằng hệ thống chống truy cập tự động (không phải do sai mật khẩu hay mã xác thực). Đừng thử lại liên tục. Cách chắc chắn: tải Excel/XML từ chính trang cổng Thuế rồi nhập vào ứng dụng.');
    Object.assign(this, { name: 'BlockedError', blocked: true, status, retriable: false, portalMessage });
  }
}
export const isBlockedText = (t) => /hành vi không hợp lệ|yêu cầu đã bị chặn|request rejected|this page can'?t be displayed/i.test(String(t || ''));

/** Phiên hết hạn / sai thông tin đăng nhập. */
export class AuthError extends ApiError {
  constructor(message, status = 401) { super(message, { status, retriable: false }); this.name = 'AuthError'; }
}

// ---------------------------------------------------------------- Kênh truyền

let probedTransport = null;

/** Chọn kênh truyền theo cài đặt; 'auto' sẽ dò proxy cục bộ. */
export async function resolveTransport(force = false) {
  const pref = state.settings.transport || 'auto';
  if (pref !== 'auto') return pref;
  if (desktop()) return 'electron';
  if (probedTransport && !force) return probedTransport;
  const base = (state.settings.proxyUrl || '').replace(/\/$/, '');
  try {
    const r = await fetch(`${base}${GDT.proxyPrefix}/__ping`, { cache: 'no-store' });
    if (r.ok && (await r.json()).ok) return (probedTransport = 'proxy');
  } catch { /* không có proxy */ }
  return (probedTransport = 'direct');
}

// ---------------------------------------------------------------- Cấu hình đường dẫn (profile)

let detected = null; // cấu hình dò được khi ở chế độ "Tự động"

/** Quên cấu hình đã dò (khi người dùng đổi cài đặt hoặc bấm "Kiểm tra kết nối"). */
export const resetDetectedProfile = () => { detected = null; };

/** Cấu hình đường dẫn đang dùng: theo cài đặt (tự động / cố định / tùy chỉnh). */
export function activeProfile() {
  const pref = state.settings.gdtProfile || 'auto';
  if (pref === 'custom') return { id: 'custom', label: 'Tùy chỉnh', origin: (state.settings.baseUrl || GDT_PROFILES[0].origin).replace(/\/$/, ''), prefix: state.settings.apiPrefix || '' };
  return GDT_PROFILES.find((p) => p.id === pref) || detected || GDT_PROFILES[0];
}

function buildQuery(query) {
  if (!query) return '';
  const parts = Object.entries(query).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Gửi một request qua kênh truyền đã chọn.
 * @returns {Promise<{status:number, headers:object, bytes:Uint8Array}>}
 */
async function rawSend({ method = 'GET', path, query, headers = {}, body, signal, timeoutMs = RETRY.timeoutMs, profile = activeProfile() }) {
  const transport = await resolveTransport();
  const qs = buildQuery(query);
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(new ApiError('Hết thời gian chờ phản hồi từ cổng Thuế.', { retriable: true })), timeoutMs);

  try {
    if (transport === 'electron') {
      const r = await desktop().request({ method, url: `${profile.origin}${profile.prefix}${path}${qs}`, headers, body: body ?? null, timeoutMs });
      return { status: r.status, headers: r.headers || {}, bytes: b64decode(r.bodyBase64 || '') };
    }
    const isProxy = transport === 'proxy';
    const base = isProxy ? `${(state.settings.proxyUrl || '').replace(/\/$/, '')}${GDT.proxyPrefix}` : profile.origin;
    const sendHeaders = isProxy ? { ...headers, 'x-etax-origin': profile.origin } : headers; // máy chủ trung gian chỉ nhận các địa chỉ trong danh sách cho phép
    const res = await fetch(`${base}${profile.prefix}${path}${qs}`, { method, headers: sendHeaders, body, signal: ctrl.signal, cache: 'no-store' });
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (signal?.aborted) throw new DOMException('Đã hủy', 'AbortError');
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof ApiError) throw ctrl.signal.reason;
    const hint = transport === 'direct'
      ? ' Trình duyệt không thể gọi thẳng cổng Thuế (bị chặn CORS). Hãy chạy `node server/server.mjs` hoặc dùng bản Electron — xem docs/HUONG-DAN.md.'
      : '';
    throw new ApiError(`Không kết nối được cổng Thuế (${e.message}).${hint}`, { retriable: transport !== 'direct', cause: e });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Thử lại theo cấp số nhân (có nhiễu) cho lỗi mạng / 429 / 5xx. Không thử lại 401/403/4xx khác. */
export async function withRetry(fn, { attempts = RETRY.attempts, baseDelayMs = RETRY.baseDelayMs, maxDelayMs = RETRY.maxDelayMs, signal, onRetry } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError' || e instanceof AuthError || !(e instanceof ApiError) || !e.retriable || i === attempts) throw e;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (i - 1)) * (0.75 + Math.random() * 0.5);
      onRetry?.(i, delay, e);
      await sleep(delay);
      if (signal?.aborted) throw new DOMException('Đã hủy', 'AbortError');
    }
  }
  throw lastErr;
}

const decodeJson = (bytes) => {
  const text = bytesToText(bytes);
  try { return JSON.parse(text); } catch { throw new ApiError('Cổng Thuế trả về dữ liệu không phải JSON (có thể đang bảo trì).', { retriable: true }); }
};

/** Chuyển mã trạng thái HTTP thành lỗi có nghĩa. */
function checkStatus(r, what) {
  if (r.status >= 200 && r.status < 300) return;
  let detail = '';
  try { const j = JSON.parse(bytesToText(r.bytes)); detail = j.message || j.error_description || j.error || ''; } catch { /* không phải JSON */ }
  if (isBlockedText(detail) || isBlockedText(bytesToText(r.bytes).slice(0, 2000))) throw new BlockedError(detail, r.status);
  if (r.status === 401 || r.status === 403) throw new AuthError(detail || 'Phiên đăng nhập đã hết hạn hoặc thông tin không đúng.', r.status);
  if (r.status === 400 && /captcha/i.test(detail)) throw new ApiError(`Mã xác thực (CAPTCHA) không đúng. ${detail}`.trim(), { status: 400 });
  throw new ApiError(`${what} thất bại (HTTP ${r.status}). ${detail}`.trim(), { status: r.status, retriable: r.status === 429 || r.status >= 500 });
}

// ---------------------------------------------------------------- Dò cấu hình & chẩn đoán kết nối

/**
 * Thử lấy CAPTCHA theo từng cấu hình đường dẫn. Không thử lại khi lỗi để chẩn đoán nhanh (mỗi cấu hình tối đa ~15 giây).
 * @returns {Promise<{profile:object, ok:boolean, ms:number, message?:string, captcha?:object}[]>}
 */
export async function probeProfiles({ signal, stopAtFirst = false } = {}) {
  const results = [];
  for (const profile of GDT_PROFILES) {
    const t0 = performance.now();
    try {
      const res = await rawSend({ path: GDT.paths.captcha, profile, headers: { Accept: 'application/json' }, signal, timeoutMs: 15000 });
      checkStatus(res, 'Tải mã xác thực');
      const j = decodeJson(res.bytes);
      if (!(j.key || j.ckey) || !(j.content || j.image)) throw new ApiError('Phản hồi không đúng dạng mã xác thực.');
      results.push({ profile, ok: true, ms: Math.round(performance.now() - t0), captcha: j });
      if (stopAtFirst) break;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      results.push({ profile, ok: false, ms: Math.round(performance.now() - t0), message: e.message });
    }
  }
  return results;
}

/** Chẩn đoán cho trang Cài đặt: thử mọi cấu hình, nhớ cấu hình chạy được đầu tiên (chế độ tự động). */
export async function diagnose(signal) {
  resetDetectedProfile();
  const results = await probeProfiles({ signal });
  const ok = results.find((r) => r.ok);
  if (ok && (state.settings.gdtProfile || 'auto') === 'auto') detected = ok.profile;
  return results;
}

/** Gộp các lỗi dò thành một thông báo dễ hiểu. */
function explainProbeFailure(results) {
  const lines = results.map((r) => `• ${r.profile.label}: ${r.message}`);
  return `Không kết nối được cổng Thuế bằng cách nào:\n${lines.join('\n')}\nHãy mở https://hoadondientu.gdt.gov.vn trong trình duyệt để xem cổng có truy cập được từ máy này không (mạng công ty/VPN/tường lửa có thể chặn), rồi xem Cài đặt → Kết nối cổng Thuế.`;
}

// ---------------------------------------------------------------- Định dạng tham số

/** ISO "2024-05-31" → "31/05/2024T00:00:00" (định dạng bộ lọc của cổng). */
const gdtStamp = (iso, end) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}T${end ? '23:59:59' : '00:00:00'}`; };

/** Ghép chuỗi `search` cho bộ lọc. */
export function buildSearch({ from, to, direction, codeMode = 'all', number, series, partnerTax, partnerName }) {
  const s = [`tdlap=ge=${gdtStamp(from)}`, `tdlap=le=${gdtStamp(to, true)}`];
  if (codeMode === 'coma') s.push(`ttxly==${GDT.processing.coMa}`);
  if (codeMode === 'khongma') s.push(`ttxly==${GDT.processing.khongMa}`);
  if (number) s.push(`shdon==${String(number).trim()}`);
  if (series) s.push(`khhdon==${String(series).trim()}`);
  if (partnerTax) s.push(`${direction === DIRECTION.OUT ? 'nmmst' : 'nbmst'}==${String(partnerTax).trim()}`);
  if (partnerName) s.push(`${direction === DIRECTION.OUT ? 'nmten' : 'nbten'}=like=${String(partnerName).trim()}`);
  return s.join(';');
}

// ---------------------------------------------------------------- Máy khách

export class GdtClient {
  constructor() {
    this.token = null;
    this.minGapMs = 250; // giãn cách giữa các request để không làm quá tải cổng
    this._last = 0;
  }

  setToken(t) { this.token = t; }

  async _throttle() {
    const gap = Math.max(0, Number(state.settings?.apiGapMs ?? this.minGapMs) || 0);
    const now = Date.now();
    const slot = Math.max(now, this._last + gap);
    this._last = slot;
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
  }

  _auth() { return this.token ? { Authorization: `Bearer ${this.token}` } : {}; }

  /** Lấy ảnh CAPTCHA (SVG) từ cổng. Trả về {key, image(dataURL)}. */
  async captcha(signal) {
    let j;
    if ((state.settings.gdtProfile || 'auto') === 'auto' && !detected) {
      // Chưa biết cổng đang dùng cách đặt đường dẫn nào → dò lần lượt, nhớ cách chạy được.
      const results = await probeProfiles({ signal, stopAtFirst: true });
      const ok = results.find((x) => x.ok);
      if (!ok) throw new ApiError(explainProbeFailure(results));
      detected = ok.profile;
      logger.info('login', `Cổng Thuế trả lời theo cấu hình: ${ok.profile.label}`, { profile: ok.profile.id });
      j = ok.captcha;
    } else {
      const r = await withRetry(async () => {
        const res = await rawSend({ path: GDT.paths.captcha, headers: { Accept: 'application/json' }, signal });
        checkStatus(res, 'Tải mã xác thực');
        return res;
      }, { signal, attempts: 2 });
      j = decodeJson(r.bytes);
    }
    const content = j.content || j.image || '';
    const image = /^\s*</.test(content) ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}` : content;
    return { key: j.key || j.ckey, image };
  }

  /**
   * Đăng nhập. `captchaText` do người dùng đọc từ ảnh và tự nhập.
   * @returns {Promise<string>} token
   */
  async login({ username, password, captchaText, captchaKey }, signal) {
    const res = await rawSend({
      method: 'POST', path: GDT.paths.login, signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password, cvalue: captchaText, ckey: captchaKey }),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      let msg = '';
      try { const j = decodeJson(res.bytes); msg = j.message || j.error_description || ''; } catch { /* bỏ qua */ }
      if (isBlockedText(msg) || isBlockedText(bytesToText(res.bytes).slice(0, 2000))) throw new BlockedError(msg, res.status);
      throw new AuthError(msg || 'Sai tên đăng nhập, mật khẩu hoặc mã xác thực.', res.status);
    }
    checkStatus(res, 'Đăng nhập');
    const j = decodeJson(res.bytes);
    if (!j.token) throw new AuthError('Cổng Thuế không trả về token đăng nhập.');
    this.token = j.token;
    return j.token;
  }

  /** Thông tin tài khoản (tên doanh nghiệp, MST). Nếu thất bại vẫn dùng được: MST = tên đăng nhập. */
  async profile(fallbackUsername, signal) {
    try {
      const res = await rawSend({ path: GDT.paths.profile, headers: { ...this._auth(), Accept: 'application/json' }, signal });
      checkStatus(res, 'Lấy thông tin tài khoản');
      const j = decodeJson(res.bytes);
      const d = j.data || j;
      return {
        taxCode: d.mst || d.tin || d.taxCode || d.username || fallbackUsername,
        companyName: d.ten || d.name || d.tenDn || d.companyName || '',
        userName: d.hoTen || d.fullName || d.userName || d.nguoiDaiDien || fallbackUsername,
      };
    } catch (e) {
      if (e instanceof AuthError) throw e;
      logger.warn('login', 'Không lấy được hồ sơ tài khoản, dùng tên đăng nhập làm MST.', { error: e.message });
      return { taxCode: fallbackUsername, companyName: '', userName: fallbackUsername };
    }
  }

  /**
   * Duyệt danh sách hóa đơn theo từng đoạn ngày (mỗi đoạn ≤ 31 ngày) và từng trang.
   * @yields {{items:object[], chunk:[string,string], chunkIndex:number, chunkCount:number, total:number}}
   */
  async* iterateInvoices({ direction, from, to, codeMode = 'all', number, series, partnerTax, partnerName, signal, onRetry }) {
    const path = direction === DIRECTION.OUT ? GDT.paths.sold : GDT.paths.purchase;
    const chunks = splitDateRange(from, to, GDT.maxRangeDays);
    for (let ci = 0; ci < chunks.length; ci++) {
      const [f, t] = chunks[ci];
      const search = buildSearch({ from: f, to: t, direction, codeMode, number, series, partnerTax, partnerName });
      let cursor = null;
      let total = 0;
      let guard = 0;
      do {
        if (signal?.aborted) throw new DOMException('Đã hủy', 'AbortError');
        await this._throttle();
        const res = await withRetry(async () => {
          const r = await rawSend({ path, signal, headers: { ...this._auth(), Accept: 'application/json' }, query: { sort: GDT.sort, size: GDT.pageSize, search, ...(cursor ? { state: cursor } : {}) } });
          checkStatus(r, 'Tải danh sách hóa đơn');
          return r;
        }, { signal, onRetry });
        const j = decodeJson(res.bytes);
        const items = j.datas || j.data || [];
        total = j.total ?? total;
        cursor = j.state || null;
        yield { items, chunk: [f, t], chunkIndex: ci, chunkCount: chunks.length, total };
        if (items.length < GDT.pageSize) cursor = null;
      } while (cursor && ++guard < 2000);
    }
  }

  _detailQuery(inv) {
    return { nbmst: inv.sellerTax, khhdon: inv.series, shdon: inv.number, khmshdon: inv.template };
  }

  /** Chi tiết một hóa đơn (hàng hóa, thuế suất…). */
  async detail(inv, signal) {
    await this._throttle();
    const res = await withRetry(async () => {
      const r = await rawSend({ path: GDT.paths.detail, signal, headers: { ...this._auth(), Accept: 'application/json' }, query: this._detailQuery(inv) });
      checkStatus(r, 'Tải chi tiết hóa đơn');
      return r;
    }, { signal });
    return decodeJson(res.bytes);
  }

  /** Tải XML gốc của hóa đơn. Cổng thường trả về gói ZIP chứa file XML. */
  async xml(inv, signal) {
    await this._throttle();
    const res = await withRetry(async () => {
      const r = await rawSend({ path: GDT.paths.exportXml, signal, headers: { ...this._auth() }, query: this._detailQuery(inv), timeoutMs: 90000 });
      checkStatus(r, 'Tải XML hóa đơn');
      return r;
    }, { signal });
    if (looksLikeZip(res.bytes)) {
      const files = await unzip(res.bytes);
      const name = [...files.keys()].find((n) => /\.xml$/i.test(n));
      if (!name) throw new ApiError('Gói tải về không chứa file XML.');
      return bytesToText(files.get(name));
    }
    return bytesToText(res.bytes);
  }
}

/** Đối tượng dùng chung toàn ứng dụng. */
export const gdt = new GdtClient();
