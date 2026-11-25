(() => {
  if (window.__etaxPortalHooked) return;
  window.__etaxPortalHooked = true;

  const notify = (token, url) => {
    if (!token || !/^Bearer\s+/i.test(token)) return;
    let apiBase = '';
    try {
      const u = new URL(url, location.origin);
      if (u.port === '30000') apiBase = `${u.origin}`;
      else if (u.pathname.startsWith('/api/')) apiBase = `${u.origin}/api`;
    } catch { /* bỏ qua */ }
    window.postMessage({ type: '__etax_portal_auth', token: token.replace(/^Bearer\s+/i, '').trim(), apiBase }, location.origin);
  };

  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__etaxUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (String(name).toLowerCase() === 'authorization') notify(value, this.__etaxUrl || '');
    return origSetHeader.call(this, name, value);
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const h = init?.headers;
      if (h) {
        const auth = typeof h.get === 'function' ? h.get('authorization') : (h.Authorization || h.authorization);
        if (auth) notify(auth, url);
      }
    } catch { /* bỏ qua */ }
    return origFetch.apply(this, arguments);
  };
})();
