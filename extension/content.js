(() => {
  if (window.__etaxBridgeLoaded) return;
  window.__etaxBridgeLoaded = true;

  const POLL_MS = 2500;
  const GAP_MS = 900;
  const MAX_DAYS = 31;

  let autoRun = true;
  let running = false;
  let cachedProfile = null;
  let cachedToken = '';
  let cachedApiBase = '';

  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin || ev.data?.type !== '__etax_portal_auth') return;
    if (ev.data.token && ev.data.token !== cachedToken) {
      cachedToken = ev.data.token;
      cachedProfile = null;
    }
    if (ev.data.apiBase) cachedApiBase = ev.data.apiBase;
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function bridge(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'bridge', path, method, body }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || 'Bridge error'));
        resolve(res.data);
      });
    });
  }

  function extractJwt(val) {
    if (typeof val !== 'string') return '';
    const s = val.trim().replace(/^"|"$/g, '').replace(/^Bearer\s+/i, '');
    if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s)) return s;
    return '';
  }

  function findJwtInObj(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 3) return '';
    for (const v of Object.values(obj)) {
      const hit = extractJwt(v);
      if (hit) return hit;
      if (v && typeof v === 'object') {
        const nested = findJwtInObj(v, depth + 1);
        if (nested) return nested;
      }
    }
    return '';
  }

  function findJwtInStorage(store) {
    try {
      for (let i = 0; i < store.length; i++) {
        const v = store.getItem(store.key(i)) || '';
        const direct = extractJwt(v);
        if (direct) return direct;
        if (v.startsWith('{') || v.startsWith('[')) {
          try {
            const hit = findJwtInObj(JSON.parse(v));
            if (hit) return hit;
          } catch { /* bỏ qua */ }
        }
      }
    } catch { /* bỏ qua */ }
    return '';
  }

  function findJwtInCookie() {
    try {
      for (const part of (document.cookie || '').split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        const val = decodeURIComponent(part.slice(idx + 1).trim());
        const hit = extractJwt(val);
        if (hit) return hit;
      }
    } catch { /* bỏ qua */ }
    return '';
  }

  function getPortalToken() {
    if (cachedToken) return cachedToken;
    const t = findJwtInStorage(localStorage) || findJwtInStorage(sessionStorage) || findJwtInCookie();
    if (t) cachedToken = t;
    return t || '';
  }

  async function portalFetch(path, { timeoutMs = 45000, responseType = 'json' } = {}) {
    const token = getPortalToken();
    const defaults = location.port === '30000'
      ? [location.origin, 'https://hoadondientu.gdt.gov.vn/api']
      : [`${location.origin}/api`, 'https://hoadondientu.gdt.gov.vn:30000'];
    const candidates = cachedApiBase
      ? [cachedApiBase, ...defaults.filter((b) => b !== cachedApiBase)]
      : defaults;

    let lastErr;
    for (const base of candidates) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${base}${path}`, {
          method: 'GET',
          credentials: 'include',
          signal: ctrl.signal,
          headers: {
            Accept: responseType === 'json' ? 'application/json' : '*/*',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status} (${path.split('?')[0]})`);
          err.status = res.status;
          lastErr = err;
          if (res.status === 401) throw err;
          continue;
        }
        cachedApiBase = base;
        return responseType === 'json' ? await res.json() : new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        lastErr = e;
        if (e.status === 401) throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr || new Error('Không kết nối được API cổng Thuế');
  }

  function decodeJwtPayload(token) {
    try {
      const parts = String(token || '').split('.');
      if (parts.length !== 3) return null;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(b64).split('').map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  async function fetchProfile() {
    const token = getPortalToken();
    if (cachedProfile?.mst && token) return { loggedIn: true, ...cachedProfile };
    try {
      const j = await portalFetch('/security-taxpayer/profile', { timeoutMs: 12000 });
      const d = j?.data || j || {};
      const mst = String(d.mst || d.tin || d.taxCode || d.maSoThue || d.username || d.id || '');
      const user = String(d.hoTen || d.fullName || d.ten || d.name || d.tenNnt || d.companyName || d.username || '');
      if (mst || user) {
        cachedProfile = { mst, user };
        return { loggedIn: true, ...cachedProfile };
      }
    } catch (e) {
      if (e.status === 401) {
        cachedProfile = null;
        return { loggedIn: false, mst: '', user: '', reason: 'HTTP 401' };
      }
      if (token) {
        const p = decodeJwtPayload(token);
        if (p && (!p.exp || p.exp * 1000 > Date.now())) {
          const mst = String(p.mst || p.tin || p.taxCode || p.sub || p.username || '');
          const user = String(p.name || p.hoTen || p.username || '');
          cachedProfile = { mst, user };
          return { loggedIn: true, ...cachedProfile };
        }
        if (e.status !== 403) return { loggedIn: true, mst: cachedProfile?.mst || '', user: cachedProfile?.user || '' };
      }
      return { loggedIn: false, mst: '', user: '', reason: `${e.message} · ${token ? 'có token' : 'chưa có token'}` };
    }
    if (token) {
      const p = decodeJwtPayload(token);
      if (p && (!p.exp || p.exp * 1000 > Date.now())) {
        const mst = String(p.mst || p.tin || p.taxCode || p.sub || p.username || '');
        return { loggedIn: true, mst, user: String(p.name || p.username || '') };
      }
    }
    cachedProfile = null;
    return { loggedIn: false, mst: '', user: '', reason: token ? 'profile trống' : 'chưa thấy token' };
  }

  function splitDateRange(from, to) {
    const out = [];
    const pad = (n) => String(n).padStart(2, '0');
    const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    let cur = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cur <= end) {
      const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      const cap = new Date(cur.getTime() + (MAX_DAYS - 1) * 86400000);
      const stop = new Date(Math.min(end.getTime(), monthEnd.getTime(), cap.getTime()));
      out.push([toISO(cur), toISO(stop)]);
      cur = new Date(stop.getTime() + 86400000);
    }
    return out;
  }

  const gdtStamp = (iso, end) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}T${end ? '23:59:59' : '00:00:00'}`;
  };

  async function withPortalRetry(fn, { onSkip } = {}) {
    let lastErr;
    for (let i = 1; i <= 6; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (e.status === 401) throw e;
        if ((e.status === 403 || e.status === 404) && onSkip) return onSkip(e);
        if (e.status === 403) throw e;
        const max = e.status === 500 ? 2 : 6;
        if (i >= max) {
          if (onSkip && e.status === 500) return onSkip(e);
          throw e;
        }
        await sleep(Math.min(10000, 1000 * 2 ** (i - 1)));
      }
    }
    throw lastErr;
  }

  async function runJob(job) {
    running = true;
    setUiStatus(`Đang chạy lệnh (${job.direction === 'out' ? 'Đầu ra' : 'Đầu vào'})…`);
    const baseEp = job.direction === 'out' ? '/query/invoices/sold' : '/query/invoices/purchase';
    const posEp = job.direction === 'out' ? '/sco-query/invoices/sold' : '/sco-query/invoices/purchase';
    const chunks = splitDateRange(job.from, job.to);
    const ttxlyList = job.codeMode === 'coma'
      ? [5]
      : job.codeMode === 'khongma'
        ? [6]
        : job.pos ? [5, 6, 8] : [5, 6];
    const skipped = [];

    try {
      const totalSteps = Math.max(1, chunks.length * ttxlyList.length);
      let step = 0;

      for (const [f, t] of chunks) {
        for (const ttxly of ttxlyList) {
          step++;
          let cursor = null;
          let guard = 0;
          const endpoint = ttxly === 8 ? posEp : baseEp;
          const canSkip = ttxly === 8 || (ttxly === 6 && job.codeMode === 'all');
          const search = `tdlap=ge=${gdtStamp(f)};tdlap=le=${gdtStamp(t, true)};ttxly==${ttxly}`;
          do {
            await sleep(GAP_MS);
            const q = new URLSearchParams({ sort: 'tdlap:desc,khmshdon:asc,shdon:desc', size: '50', search });
            if (cursor) q.set('state', cursor);
            const res = await withPortalRetry(
              () => portalFetch(`${endpoint}?${q.toString()}`),
              {
                onSkip: canSkip
                  ? (err) => {
                      skipped.push(`ttxly=${ttxly} (${f}→${t}: ${err.status})`);
                      return { datas: [], state: null };
                    }
                  : undefined,
              },
            );
            const items = res?.datas || res?.data || [];
            if (items.length) {
              await bridge('data', 'POST', { jobId: job.id, direction: job.direction, kind: 'list', items });
            }
            cursor = items.length < 50 ? null : (res?.state || null);
            await bridge('progress', 'POST', {
              jobId: job.id,
              state: 'running',
              pct: Math.min(0.95, step / totalSteps),
              message: `${f} → ${t} (loại ${ttxly})`,
            });
          } while (cursor && ++guard < 2000);
        }
      }

      const doneMsg = skipped.length
        ? `Hoàn tất. Đã bỏ qua ${skipped.length} phần: ${skipped.slice(0, 3).join(', ')}`
        : 'Hoàn tất';
      await bridge('progress', 'POST', { jobId: job.id, state: 'done', pct: 1, message: doneMsg });
      setUiStatus('Hoàn tất lệnh từ eTax');
    } catch (e) {
      await bridge('progress', 'POST', { jobId: job.id, state: 'error', pct: 1, message: e.message }).catch(() => {});
      setUiStatus(`Lỗi: ${e.message}`);
    } finally {
      running = false;
    }
  }

  // ---- Hộp nổi nhỏ góc dưới bên phải
  const box = document.createElement('div');
  box.id = 'etax-bridge-box';
  box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:999999;background:#0f2740;color:#fff;padding:10px 12px;border-radius:10px;font:12px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.28);min-width:230px;max-width:290px';
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:700;margin-bottom:4px';
  title.textContent = 'eTax - Tải hóa đơn hàng loạt';
  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'opacity:.9;margin-bottom:8px';
  statusEl.textContent = 'Đang kết nối eTax Manager…';
  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
  const chkLbl = document.createElement('label');
  chkLbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer';
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = true;
  chk.onchange = () => { autoRun = chk.checked; };
  chkLbl.append(chk, 'Tự chạy');
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.textContent = 'Chạy lệnh từ eTax';
  runBtn.style.cssText = 'background:#16a34a;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;font-weight:600';
  runBtn.onclick = () => tick(true);
  controls.append(chkLbl, runBtn);
  box.append(title, statusEl, controls);
  document.body.appendChild(box);

  function setUiStatus(msg) {
    statusEl.textContent = msg;
  }

  async function tick(manual = false) {
    if (running) return;
    try {
      const prof = await fetchProfile();
      await bridge('hello', 'POST', {
        loggedIn: prof.loggedIn,
        mst: prof.mst,
        user: prof.user,
        page: location.pathname,
      });
      setUiStatus(prof.loggedIn
        ? `Đã kết nối eTax${prof.mst ? ` · MST ${prof.mst}` : ''}`
        : `Đã kết nối eTax · Chưa đăng nhập (${prof.reason || 'không có phiên'})`);

      if (!prof.loggedIn || (!autoRun && !manual)) return;
      const { job } = await bridge('job', 'GET');
      if (job) await runJob(job);
    } catch {
      setUiStatus('Chưa thấy eTax Manager (127.0.0.1:8080)');
    }
  }

  tick();
  setInterval(() => tick(false), POLL_MS);
})();
