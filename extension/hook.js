(() => {
  if (window.__etaxPortalHooked) return;
  window.__etaxPortalHooked = true;

  const notify = (rawToken, url) => {
    if (!rawToken || typeof rawToken !== 'string') return;
    const token = rawToken.replace(/^Bearer\s+/i, '').trim();
    if (!token || token.length < 10) return;
    let apiBase = '';
    try {
      const u = new URL(url, location.origin);
      if (u.port === '30000') apiBase = u.origin;
      else if (u.pathname.startsWith('/api/')) apiBase = `${u.origin}/api`;
    } catch { /* bỏ qua */ }
    window.postMessage({ type: '__etax_portal_auth', token, apiBase }, location.origin);
  };

  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__etaxUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    const k = String(name).toLowerCase();
    if (k === 'authorization' || k === 'x-auth-token' || k === 'token') {
      notify(value, this.__etaxUrl || '');
    }
    return origSetHeader.call(this, name, value);
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const h = init?.headers || input?.headers;
      if (h) {
        const get = (k) => (typeof h.get === 'function' ? h.get(k) : (h[k] || h[k.toLowerCase()]));
        const auth = get('Authorization') || get('X-Auth-Token') || get('Token');
        if (auth) notify(auth, url);
      }
    } catch { /* bỏ qua */ }
    return origFetch.apply(this, arguments);
  };
})();
