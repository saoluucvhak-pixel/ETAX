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
} from '../js/utils.js';
import { DEFAULT_SETTINGS } from '../js/config.js';
import { state } from '../js/core/state.js';
import { GdtClient } from '../js/api.js';
import * as syncEngine from '../js/core/syncEngine.js';

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
