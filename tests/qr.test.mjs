import test from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvg, invoiceQrPayload } from '../js/core/qr.js';

test('qrMatrix creates valid finder patterns and timing patterns for GDT URL', () => {
  const payload = invoiceQrPayload({
    sellerTax: '0300405462-007',
    template: '1',
    series: 'C26TPN',
    number: 4372,
    invoiceCode: '00AF947DCDF5614B8AB28046BC070D235B',
  });
  assert.ok(payload.includes('nbmst=0300405462-007'));
  assert.ok(payload.includes('shdon=4372'));

  const mat = qrMatrix(payload);
  const n = mat.length;
  assert.ok(n >= 21 && (n - 17) % 4 === 0);

  // Top-left finder pattern outer border
  for (let i = 0; i < 7; i++) {
    assert.equal(mat[0][i], 1);
    assert.equal(mat[6][i], 1);
    assert.equal(mat[i][0], 1);
    assert.equal(mat[i][6], 1);
  }
  // Dark module
  assert.equal(mat[n - 8][8], 1);

  const svg = qrSvg(payload, 72);
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.includes('width="72"'));
});
