/**
 * bridgeServer.cjs — Máy chủ cầu nối cục bộ (127.0.0.1:8080) chạy nhúng trong Electron
 * để tiện ích trình duyệt (/extension) kết nối được với bản cài đặt Desktop (.exe)
 * giống hệt như khi chạy qua server/server.mjs.
 */
const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');

const isExtOrigin = (o) => /^(chrome|moz)-extension:\/\//.test(o || '');
const isElectronOrigin = (o) => o === 'app://etax';

function readJson(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Dữ liệu quá lớn'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function createBridgeServer({ port = 8080 } = {}) {
  const BRIDGE = { pair: randomBytes(16).toString('hex'), job: null, inbox: [], progress: null, extSeen: 0, extInfo: {} };
  const isAppRequest = (req) => {
    const o = req.headers.origin || '';
    return req.headers['sec-fetch-site'] === 'same-origin'
      || isElectronOrigin(o)
      || [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(o);
  };

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const send = (code, obj) => {
      const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
      if (isExtOrigin(origin) || isElectronOrigin(origin)) {
        Object.assign(h, {
          'access-control-allow-origin': origin,
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
        });
      }
      res.writeHead(code, h);
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'OPTIONS') return send(204, {});
    if (!req.url || !req.url.startsWith('/__bridge/')) return send(404, { error: 'not found' });

    let route;
    try {
      route = new URL(req.url, 'http://x').pathname.replace('/__bridge/', '');
    } catch {
      return send(400, { error: 'bad url' });
    }

    const appReq = isAppRequest(req);
    const ext = !appReq && (isExtOrigin(origin) || !origin);
    if (!ext && !appReq) return send(403, { error: 'forbidden' });

    try {
      if (ext) {
        if (route === 'pair' && req.method === 'GET') return send(200, { pair: BRIDGE.pair });
        const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
        const want = Buffer.from(BRIDGE.pair);
        if (given.length !== want.length || !timingSafeEqual(given, want)) return send(401, { error: 'pair' });
        BRIDGE.extSeen = Date.now();
        if (route === 'hello' && req.method === 'POST') {
          const b = await readJson(req);
          BRIDGE.extInfo = { loggedIn: !!b.loggedIn, user: String(b.user || ''), mst: String(b.mst || ''), page: String(b.page || '') };
          return send(200, { ok: true });
        }
        if (route === 'job' && req.method === 'GET') return send(200, { job: BRIDGE.job && !BRIDGE.job.finished ? BRIDGE.job : null });
        if (route === 'progress' && req.method === 'POST') {
          const b = await readJson(req);
          if (BRIDGE.job && b.jobId === BRIDGE.job.id) {
            BRIDGE.progress = { ...b, at: Date.now() };
            if (b.state === 'done' || b.state === 'error') BRIDGE.job.finished = true;
          }
          return send(200, { ok: true });
        }
        if (route === 'data' && req.method === 'POST') {
          const b = await readJson(req);
          if (BRIDGE.job && b.jobId === BRIDGE.job.id) {
            BRIDGE.inbox.push({ direction: b.direction, kind: b.kind || 'list', items: Array.isArray(b.items) ? b.items : [] });
          }
          return send(200, { ok: true });
        }
        return send(404, { error: 'not found' });
      }

      if (route === 'status' && req.method === 'GET') {
        return send(200, { extAgeMs: BRIDGE.extSeen ? Date.now() - BRIDGE.extSeen : null, ext: BRIDGE.extInfo, job: BRIDGE.job, progress: BRIDGE.progress });
      }
      if (route === 'job' && req.method === 'POST') {
        const b = await readJson(req);
        BRIDGE.job = { id: randomBytes(6).toString('hex'), direction: b.direction, from: b.from, to: b.to, codeMode: b.codeMode || 'all', pos: !!b.pos, xml: !!b.xml, createdAt: Date.now() };
        BRIDGE.inbox = [];
        BRIDGE.progress = { state: 'waiting', message: 'Đang chờ tiện ích trên trang Thuế nhận lệnh…', pct: 0, jobId: BRIDGE.job.id };
        return send(200, { job: BRIDGE.job });
      }
      if (route === 'cancel' && req.method === 'POST') {
        BRIDGE.job = null;
        BRIDGE.inbox = [];
        return send(200, { ok: true });
      }
      if (route === 'pull' && req.method === 'GET') {
        const items = BRIDGE.inbox;
        BRIDGE.inbox = [];
        return send(200, { progress: BRIDGE.progress, items, extAgeMs: BRIDGE.extSeen ? Date.now() - BRIDGE.extSeen : null });
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      return send(400, { error: e.message });
    }
  });

  return server;
}

function startBridgeServer(port = Number(process.env.PORT) || 8080) {
  const server = createBridgeServer({ port });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[eTax] Cổng cầu nối ${port} đang được dùng (có thể server.mjs đang chạy sẵn).`);
    } else {
      console.error(`[eTax] Lỗi máy chủ cầu nối: ${err.message}`);
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { createBridgeServer, startBridgeServer };
