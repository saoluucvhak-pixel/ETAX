import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  splitDateRange,
  parseDate,
  isValidTaxCode,
  escapeHtml,
  speedEtaText,
  pool,
  toCsv,
} from '../js/utils.js';
import { APP, DEFAULT_SETTINGS } from '../js/config.js';
import { state } from '../js/core/state.js';
import { GdtClient } from '../js/api.js';
import * as syncEngine from '../js/core/syncEngine.js';
import * as backup from '../js/core/backup.js';
import { zip, unzip } from '../js/core/zip.js';
import * as syncSession from '../js/core/syncSession.js';
import { invoiceHtml } from '../js/export.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('utils: parseDate, isValidTaxCode, escapeHtml, splitDateRange, speedEtaText', () => {
  assert.equal(parseDate('31/05/2024'), '2024-05-31');
  assert.equal(parseDate('2024-05-31T10:20:30'), '2024-05-31');
  assert.equal(parseDate('invalid'), '');

  assert.equal(isValidTaxCode('0123456789'), true);
  assert.equal(isValidTaxCode('0123456789-001'), true);
  assert.equal(isValidTaxCode('012345678901'), true);
  assert.equal(isValidTaxCode('12345'), false);

  assert.equal(escapeHtml('<script>"a"&\'b\'</script>'), '&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/script&gt;');

  const chunks = splitDateRange('2024-01-01', '2024-03-05', 31);
  assert.deepEqual(chunks, [
    ['2024-01-01', '2024-01-31'],
    ['2024-02-01', '2024-02-29'],
    ['2024-03-01', '2024-03-05'],
  ]);

  assert.equal(speedEtaText({ speed: 12.4, etaMs: 40000 }), '12 hóa đơn/giây · còn khoảng 40 giây');
  assert.equal(speedEtaText({}), '');
});

test('pool: handles limit <= 0 safely without skipping items', async () => {
  const out = await pool([1, 2, 3], 0, async (x) => x * 2);
  assert.deepEqual(out, [2, 4, 6]);
});

test('config: DEFAULT_SETTINGS includes configurable detailConcurrency and apiGapMs', () => {
  assert.equal(DEFAULT_SETTINGS.detailConcurrency, 2);
  assert.equal(DEFAULT_SETTINGS.apiGapMs, 250);
});

test('GdtClient._throttle serializes concurrent callers and respects state.settings.apiGapMs', async () => {
  const prevGap = state.settings.apiGapMs;
  state.settings.apiGapMs = 60;
  try {
    const client = new GdtClient();
    const times = [];
    await Promise.all([1, 2, 3].map(async () => {
      await client._throttle();
      times.push(Date.now());
    }));
    times.sort((a, b) => a - b);
    const gap1 = times[1] - times[0];
    const gap2 = times[2] - times[1];
    assert.ok(gap1 >= 45, `Expected gap1 >= 45ms, got ${gap1}ms`);
    assert.ok(gap2 >= 45, `Expected gap2 >= 45ms, got ${gap2}ms`);
  } finally {
    state.settings.apiGapMs = prevGap;
  }
});

test('syncEngine exports checkpointSync helper', () => {
  assert.equal(typeof syncEngine.checkpointSync, 'function');
});

test('server.mjs: handles malformed URLs with 400 and blocks internal dirs with 403', async () => {
  const port = 18923;
  const proc = spawn(process.execPath, ['server/server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server start timeout')), 5000);
      proc.stdout.on('data', (d) => {
        if (String(d).includes(String(port))) {
          clearTimeout(timer);
          resolve();
        }
      });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Server exited early with code ${code}`));
      });
    });

    const reqStatus = (reqPath) => new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}${reqPath}`, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.setTimeout(2000, () => req.destroy(new Error('Request timeout')));
      req.on('error', reject);
    });

    assert.equal(await reqStatus('/server/server.mjs'), 403);
    assert.equal(await reqStatus('/%ZZ'), 400);
  } finally {
    proc.kill('SIGTERM');
  }
});

test('backup: computeBackupSha256 & validateBackupPayload enforce fail-closed integrity', async () => {
  assert.equal(typeof backup.computeBackupSha256, 'function');
  assert.equal(typeof backup.validateBackupPayload, 'function');

  const stores = { invoices: [{ key: 'k1', total: 1000 }], settings: [] };
  const sha256 = await backup.computeBackupSha256(stores);
  assert.match(sha256, /^[0-9a-f]{64}$/);

  await assert.doesNotReject(() => backup.validateBackupPayload({ app: 'etax-manager', schemaVersion: 1, stores, sha256 }));
  await assert.rejects(() => backup.validateBackupPayload({ app: 'etax-manager', schemaVersion: 1, stores: { invoices: 'bad' }, sha256 }), /không hợp lệ/i);
  await assert.rejects(() => backup.validateBackupPayload({ app: 'etax-manager', schemaVersion: 1, stores, sha256: '0'.repeat(64) }), /toàn vẹn|SHA-256/i);
});

test('toCsv: neutralizes CSV formula injection while preserving negative numbers', () => {
  const csv = toCsv(
    [{ header: 'Name', key: 'name' }, { header: 'Amount', key: 'amount' }],
    [
      { name: '=CMD()', amount: -500 },
      { name: '+1+1', amount: '-123.45' },
      { name: '@SUM(A1)', amount: 100 },
    ],
  );
  assert.ok(csv.includes("'=CMD()"));
  assert.ok(csv.includes("'+1+1"));
  assert.ok(csv.includes("'@SUM(A1)"));
  assert.ok(csv.includes(',-500\r\n'));
  assert.ok(csv.includes(',-123.45\r\n'));
});

test('zip/unzip: roundtrip and fail-closed on truncated central directory', async () => {
  const archive = await zip([{ name: 'a.txt', data: 'hello' }], { compress: false });
  const files = await unzip(archive);
  assert.equal(new TextDecoder().decode(files.get('a.txt')), 'hello');

  const truncated = archive.slice(0, archive.length - 10);
  await assert.rejects(() => unzip(truncated), /ZIP/i);
});

test('syncSession: preserves pct when onProgress receives pct: undefined', async () => {
  let resolveRun;
  syncSession.start(async ({ onProgress }) => {
    onProgress({ pct: 0.65, message: 'Đang tải', count: 10 });
    onProgress({ pct: undefined, message: 'Thử lại lần 1…' });
    await new Promise((r) => { resolveRun = r; });
    return { fetched: 10, added: 10, updated: 0 };
  });
  await new Promise((r) => setTimeout(r, 20));
  const snap = syncSession.getSnapshot();
  assert.equal(snap.pct, 0.65);
  assert.equal(snap.message, 'Thử lại lần 1…');
  resolveRun();
  await new Promise((r) => setTimeout(r, 20));
});

test('electron/bridgeServer: allows app://etax and extension pairing, blocks untrusted web origin', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { createBridgeServer } = require('../electron/bridgeServer.cjs');

  const srv = createBridgeServer({ port: 18925 });
  await new Promise((r) => srv.listen(18925, '127.0.0.1', r));
  try {
    const rApp = await fetch('http://127.0.0.1:18925/__bridge/status', { headers: { Origin: 'app://etax' } });
    assert.equal(rApp.status, 200);
    assert.equal(rApp.headers.get('access-control-allow-origin'), 'app://etax');

    const rEvil = await fetch('http://127.0.0.1:18925/__bridge/status', { headers: { Origin: 'https://evil.example' } });
    assert.equal(rEvil.status, 403);

    const rPair = await fetch('http://127.0.0.1:18925/__bridge/pair', { headers: { Origin: 'chrome-extension://abcdef' } });
    assert.equal(rPair.status, 200);
    const { pair } = await rPair.json();
    assert.match(pair, /^[0-9a-f]{32}$/);

    const rBadAuth = await fetch('http://127.0.0.1:18925/__bridge/hello', {
      method: 'POST',
      headers: { Origin: 'chrome-extension://abcdef', Authorization: 'Bearer wrong', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(rBadAuth.status, 401);

    const rOk = await fetch('http://127.0.0.1:18925/__bridge/hello', {
      method: 'POST',
      headers: { Origin: 'chrome-extension://abcdef', Authorization: `Bearer ${pair}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ loggedIn: true, mst: '0123456789' }),
    });
    assert.equal(rOk.status, 200);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('extension/manifest.json: valid MV3 manifest targeting gdt portal and 127.0.0.1:8080 bridge', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(path.join(ROOT, 'extension', 'manifest.json'), 'utf8');
  const mf = JSON.parse(raw);
  assert.equal(mf.manifest_version, 3);
  assert.equal(mf.background?.service_worker, 'background.js');
  assert.ok(mf.host_permissions.includes('https://hoadondientu.gdt.gov.vn/*'));
  assert.ok(mf.host_permissions.includes('http://127.0.0.1:8080/*'));
  assert.deepEqual(mf.content_scripts?.[0]?.js, ['hook.js']);
  assert.equal(mf.content_scripts?.[0]?.world, 'MAIN');
  assert.deepEqual(mf.content_scripts?.[1]?.js, ['content.js']);

  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(APP.version, pkg.version);
  assert.equal(mf.version, pkg.version);
});

test('export/invoiceHtml: renders official GDT form layout and escapes HTML', () => {
  const html = invoiceHtml({
    template: '1',
    series: 'C26TAA',
    number: '123',
    date: '2026-11-25',
    sellerName: 'Công ty <ABC>',
    sellerTax: '0123456789',
    buyerName: 'Khách hàng XYZ',
    buyerTax: '0987654321',
    net: 1000000,
    vat: 100000,
    total: 1100000,
    totalInWords: 'Một triệu một trăm nghìn đồng',
    hasSignature: true,
    items: [{ stt: 1, name: 'Dịch vụ A', unit: 'Lần', qty: 1, price: 1000000, amount: 1000000, rate: '10', tax: 100000 }],
  });
  assert.ok(html.includes('Ngày 25 tháng 11 năm 2026'));
  assert.ok(html.includes('0000123'));
  assert.ok(html.includes('Signature Valid'));
  assert.ok(html.includes('(6) = (4)x(5)'));
  assert.ok(html.includes('Công ty &lt;ABC&gt;'));
  assert.ok(!html.includes('Công ty <ABC>'));
});
