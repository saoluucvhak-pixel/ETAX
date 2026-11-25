#!/usr/bin/env node
/**
 * server.mjs — Máy chủ cục bộ cho bản Web/PWA (không cần cài thêm thư viện, chỉ cần Node.js 18+).
 *
 *  1) Phục vụ các tệp của ứng dụng (index.html, css, js…).
 *  2) Chuyển tiếp /gdt/* tới cổng hóa đơn điện tử của Tổng cục Thuế. Trình duyệt không được gọi thẳng
 *     cổng này vì bị chặn CORS; gọi qua máy chủ này thì cùng nguồn nên không bị chặn.
 *
 * Chạy:   node server/server.mjs            (mặc định http://127.0.0.1:8080)
 *          node server/server.mjs --open     (tự mở trình duyệt; dùng trong Chay-eTax.bat)
 * Tùy chọn (biến môi trường):
 *   PORT=9000                đổi cổng
 *   ETAX_TARGET=https://…    ép mọi yêu cầu đi tới một địa chỉ (dùng để kiểm thử); bỏ trống thì ứng dụng tự chọn địa chỉ cổng Thuế
 *   ETAX_INSECURE_TLS=1      bỏ kiểm tra chứng chỉ TLS của cổng Thuế — CHỈ dùng khi máy bạn không nhận được
 *                            chuỗi chứng chỉ của cổng; sẽ có cảnh báo, mật khẩu vẫn đi qua HTTPS nhưng kém an toàn.
 *
 * An toàn: chỉ lắng nghe 127.0.0.1 (máy khác trong mạng không truy cập được); không ghi nhật ký nội dung yêu cầu,
 * không lưu cookie/token; chỉ chuyển tiếp tới đúng địa chỉ đích đã cấu hình.
 */
import http from 'node:http';
import https from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { exec } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const TARGET = new URL(process.env.ETAX_TARGET || 'https://hoadondientu.gdt.gov.vn:30000');
const INSECURE = process.env.ETAX_INSECURE_TLS === '1';
// Trình duyệt báo địa chỉ cổng Thuế muốn gọi qua header x-etax-origin. CHỈ chấp nhận các địa chỉ trong danh sách này
// (không phải proxy mở). Khi đặt ETAX_TARGET (dùng để kiểm thử) thì luôn đi tới địa chỉ đó.
const ALLOWED_ORIGINS = new Set([TARGET.origin, 'https://hoadondientu.gdt.gov.vn', 'https://hoadondientu.gdt.gov.vn:30000'].map((o) => new URL(o).origin));
const FIXED_TARGET = Boolean(process.env.ETAX_TARGET);

function pickTarget(req) {
  const wanted = req.headers['x-etax-origin'];
  if (!FIXED_TARGET && wanted) {
    try { const u = new URL(String(wanted)); if (ALLOWED_ORIGINS.has(u.origin)) return u; } catch { /* dùng mặc định */ }
  }
  return TARGET;
}
const PREFIX = '/gdt';
const FORWARD_HEADERS = ['authorization', 'content-type', 'accept', 'accept-language', 'user-agent'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

/** Chuyển tiếp một yêu cầu tới cổng Thuế và stream kết quả về. */
function proxy(req, res) {
  const upstreamPath = req.url.slice(PREFIX.length) || '/';
  const target = pickTarget(req);
  const headers = { host: target.host };
  for (const k of FORWARD_HEADERS) if (req.headers[k]) headers[k] = req.headers[k];
  const up = https.request({
    protocol: target.protocol, hostname: target.hostname, port: target.port || 443, method: req.method, path: upstreamPath, headers,
    rejectUnauthorized: !INSECURE, timeout: 90000,
  }, (r) => {
    const out = { ...r.headers };
    delete out['set-cookie']; // không để cookie của cổng Thuế rơi vào trình duyệt
    res.writeHead(r.statusCode || 502, out);
    r.pipe(res);
  });
  up.on('timeout', () => up.destroy(new Error('Hết thời gian chờ cổng Thuế')));
  up.on('error', (e) => {
    if (res.headersSent) return res.end();
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: `Máy chủ trung gian không kết nối được cổng Thuế (${target.origin}): ${e.message}` }));
  });
  req.pipe(up);
}

/** Phục vụ tệp tĩnh, chặn thoát khỏi thư mục dự án và không phục vụ các thư mục nội bộ. */
async function serveStatic(req, res) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Bad Request');
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, `.${rel}`);
  const blocked = /^(server|electron|tests|node_modules|\.git)([\\/]|$)/.test(path.relative(ROOT, file));
  if (!file.startsWith(ROOT + path.sep) || blocked) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not file');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Không tìm thấy');
  }
}


// ---------------------------------------------------------------- Cầu nối với tiện ích trình duyệt
/**
 * Luồng "đăng nhập bằng trang Thuế": người dùng đăng nhập trên chính trang hoadondientu.gdt.gov.vn trong trình duyệt của mình;
 * tiện ích eTax (thư mục /extension) chạy trong trang đó, lấy hóa đơn bằng chính phiên đăng nhập đó rồi chuyển về đây.
 *   Ứng dụng (cùng nguồn) : POST /__bridge/job · GET /__bridge/status · GET /__bridge/pull · POST /__bridge/cancel
 *   Tiện ích (chrome-extension://) : GET /__bridge/pair (nhận mã ghép cặp) rồi hello / job / progress / data kèm mã đó
 * Mật khẩu và token của trang Thuế KHÔNG bao giờ đi qua đây: tiện ích chỉ gửi dữ liệu hóa đơn.
 */
const BRIDGE = { pair: randomBytes(16).toString('hex'), job: null, inbox: [], progress: null, extSeen: 0, extInfo: {} };
const isExtOrigin = (o) => /^(chrome|moz)-extension:\/\//.test(o || '');
const isAppRequest = (req) => req.headers['sec-fetch-site'] === 'same-origin' || [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`].includes(req.headers.origin || '');

function readJson(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Dữ liệu quá lớn')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function bridge(req, res) {
  const origin = req.headers.origin || '';
  const send = (code, obj) => {
    const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
    if (isExtOrigin(origin)) Object.assign(h, { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' });
    res.writeHead(code, h); res.end(JSON.stringify(obj));
  };
  if (req.method === 'OPTIONS') return send(204, {});
  let route;
  try {
    route = new URL(req.url, 'http://x').pathname.replace('/__bridge/', '');
  } catch {
    return send(400, { error: 'bad url' });
  }
  // Yêu cầu từ trang web khác (có Origin là web) bị từ chối; tiện ích chạy nền có thể không gửi Origin nên chấp nhận khi vắng Origin.
  // Mọi lệnh của tiện ích vẫn cần mã ghép cặp, mà mã này trình duyệt không cho trang web khác đọc (không có CORS).
  const app = isAppRequest(req);
  const ext = !app && (isExtOrigin(origin) || !origin);
  if (!ext && !app) return send(403, { error: 'forbidden' });
  try {
    if (ext) {
      if (route === 'pair' && req.method === 'GET') return send(200, { pair: BRIDGE.pair });
      const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
      const want = Buffer.from(BRIDGE.pair);
      if (given.length !== want.length || !timingSafeEqual(given, want)) return send(401, { error: 'pair' });
      BRIDGE.extSeen = Date.now();
      if (route === 'hello' && req.method === 'POST') { const b = await readJson(req); BRIDGE.extInfo = { loggedIn: !!b.loggedIn, user: String(b.user || ''), mst: String(b.mst || ''), page: String(b.page || '') }; return send(200, { ok: true }); }
      if (route === 'job' && req.method === 'GET') return send(200, { job: BRIDGE.job && !BRIDGE.job.finished ? BRIDGE.job : null }); // lệnh đã xong thì không mời chạy lại
      if (route === 'progress' && req.method === 'POST') { const b = await readJson(req); if (BRIDGE.job && b.jobId === BRIDGE.job.id) { BRIDGE.progress = { ...b, at: Date.now() }; if (b.state === 'done' || b.state === 'error') BRIDGE.job.finished = true; } return send(200, { ok: true }); }
      if (route === 'data' && req.method === 'POST') { const b = await readJson(req); if (BRIDGE.job && b.jobId === BRIDGE.job.id) BRIDGE.inbox.push({ direction: b.direction, kind: b.kind || 'list', items: Array.isArray(b.items) ? b.items : [] }); return send(200, { ok: true }); }
      return send(404, { error: 'not found' });
    }
    // Phía ứng dụng
    if (route === 'status' && req.method === 'GET') return send(200, { extAgeMs: BRIDGE.extSeen ? Date.now() - BRIDGE.extSeen : null, ext: BRIDGE.extInfo, job: BRIDGE.job, progress: BRIDGE.progress });
    if (route === 'job' && req.method === 'POST') { const b = await readJson(req); BRIDGE.job = { id: randomBytes(6).toString('hex'), direction: b.direction, from: b.from, to: b.to, codeMode: b.codeMode || 'all', pos: !!b.pos, xml: !!b.xml, createdAt: Date.now() }; BRIDGE.inbox = []; BRIDGE.progress = { state: 'waiting', message: 'Đang chờ tiện ích trên trang Thuế nhận lệnh…', pct: 0, jobId: BRIDGE.job.id }; return send(200, { job: BRIDGE.job }); }
    if (route === 'cancel' && req.method === 'POST') { BRIDGE.job = null; BRIDGE.inbox = []; return send(200, { ok: true }); }
    if (route === 'pull' && req.method === 'GET') { const items = BRIDGE.inbox; BRIDGE.inbox = []; return send(200, { progress: BRIDGE.progress, items, extAgeMs: BRIDGE.extSeen ? Date.now() - BRIDGE.extSeen : null }); }
    return send(404, { error: 'not found' });
  } catch (e) { return send(400, { error: e.message }); }
}

const server = http.createServer((req, res) => {
  if (req.url === `${PREFIX}/__ping`) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, target: TARGET.origin, root: ROOT }));
  }
  if (req.url.startsWith('/__bridge/')) return bridge(req, res);
  if (req.url.startsWith(`${PREFIX}/`)) return proxy(req, res);
  return serveStatic(req, res);
});

const URL_APP = `http://127.0.0.1:${PORT}`;
const AUTO_OPEN = process.argv.includes('--open');

/** Mở địa chỉ bằng trình duyệt mặc định của hệ điều hành (bỏ qua nếu không mở được). */
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

// Dữ liệu hóa đơn lưu theo ĐỊA CHỈ trang (kể cả số cổng) nên KHÔNG tự đổi cổng: đổi cổng = thấy kho dữ liệu rỗng.
server.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') { console.error(`Không khởi động được: ${e.message}`); process.exit(1); }
  try {
    const r = await fetch(`${URL_APP}${PREFIX}/__ping`);
    const info = r.ok ? await r.json() : {};
    if (info.ok && info.root && path.resolve(info.root) !== ROOT) { // bản eTax của THƯ MỤC KHÁC (thường là bản cũ) đang giữ cổng này
      console.error(`\nĐang có một bản eTax KHÁC chạy sẵn ở cổng ${PORT}, từ thư mục:\n  ${info.root}\nBản này (thư mục ${ROOT}) chưa chạy được.\n=> Hãy ĐÓNG cửa sổ đen của bản cũ (hoặc bấm Ctrl+C trong đó), rồi bấm lại Chay-eTax.bat.`);
      return process.exit(1);
    }
    if (info.ok && !info.root) { // bản cũ (chưa báo thư mục) đang chạy: chắc chắn không phải bản mới
      console.error(`\nĐang có bản eTax CŨ chạy sẵn ở cổng ${PORT}. Bản mới chưa chạy được.\n=> Hãy ĐÓNG cửa sổ đen của bản cũ (hoặc bấm Ctrl+C trong đó), rồi bấm lại Chay-eTax.bat.`);
      return process.exit(1);
    }
    if (info.ok) {
      console.log(`eTax Manager đã đang chạy sẵn tại ${URL_APP}. Mở lại trình duyệt…`);
      if (AUTO_OPEN) openBrowser(URL_APP);
      return setTimeout(() => process.exit(0), 800);
    }
  } catch { /* cổng bị chương trình khác chiếm */ }
  console.error(`Cổng ${PORT} đang được chương trình khác dùng. Thử cổng khác (lưu ý dữ liệu tách riêng theo cổng): đặt PORT=9000 rồi chạy lại.`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('==============================================');
  console.log(` eTax Manager đang chạy: ${URL_APP}`);
  console.log(' Giữ cửa sổ này mở khi đang dùng. Đóng cửa sổ (hoặc Ctrl+C) để tắt.');
  console.log('==============================================');
  console.log(`Chuyển tiếp ${PREFIX}/* → ${TARGET.origin}`);
  if (INSECURE) console.warn('CẢNH BÁO: đã tắt kiểm tra chứng chỉ TLS (ETAX_INSECURE_TLS=1).');
  if (AUTO_OPEN) openBrowser(URL_APP);
});
