const BRIDGE_BASE = 'http://127.0.0.1:8080/__bridge';
let pairToken = null;

async function getPairToken(force = false) {
  if (pairToken && !force) return pairToken;
  const res = await fetch(`${BRIDGE_BASE}/pair`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Pair HTTP ${res.status}`);
  const data = await res.json();
  pairToken = data.pair;
  return pairToken;
}

async function bridgeRequest(path, method = 'GET', body = null) {
  let token = await getPairToken();
  const doFetch = (t) => fetch(`${BRIDGE_BASE}/${path}`, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${t}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let res = await doFetch(token);
  if (res.status === 401) {
    token = await getPairToken(true);
    res = await doFetch(token);
  }
  if (!res.ok) throw new Error(`Bridge ${path} HTTP ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'bridge') return false;
  bridgeRequest(msg.path, msg.method, msg.body)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
