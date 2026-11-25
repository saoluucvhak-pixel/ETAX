/**
 * qr.js — Bộ tạo mã QR (Model 2, Byte mode, ECC Level M, Version 1–10) không phụ thuộc thư viện ngoài.
 * Dùng để vẽ mã QR chuẩn trên bản thể hiện hóa đơn điện tử (HTML/SVG và jsPDF).
 */

// GF(256) với đa thức nguyên thủy x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    EXP[i + 255] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
}

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

function rsGenerator(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    const root = EXP[i];
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], root);
    }
    g = next;
  }
  return g;
}

function rsEncode(data, eccLen) {
  const gen = rsGenerator(eccLen);
  const res = new Uint8Array(data.length + eccLen);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], factor);
      }
    }
  }
  return res.slice(data.length);
}

// Bảng thông số ECC Level M cho Version 1..10: [dataBytes, eccPerBlock, [[count, dataPerBlock], ...]]
const VERSIONS_M = [
  null,
  [16, 10, [[1, 16]]],
  [28, 16, [[1, 28]]],
  [44, 26, [[1, 44]]],
  [64, 18, [[2, 32]]],
  [86, 24, [[2, 43]]],
  [108, 16, [[4, 27]]],
  [124, 18, [[4, 31]]],
  [154, 22, [[2, 38], [2, 39]]],
  [182, 22, [[3, 36], [2, 37]]],
  [216, 26, [[4, 43], [1, 44]]],
];

const ALIGN_CENTERS = [
  null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

function bchFormatInfo(mask) {
  // ECC Level M = 00 -> data = (0b00 << 3) | mask = mask
  let d = mask << 10;
  const g = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if ((d >> i) & 1) d ^= g << (i - 10);
  }
  return ((mask << 10) | d) ^ 0b101010000010010;
}

function bchVersionInfo(ver) {
  let d = ver << 12;
  const g = 0b1111100100101;
  for (let i = 17; i >= 12; i--) {
    if ((d >> i) & 1) d ^= g << (i - 12);
  }
  return (ver << 12) | d;
}

function encodeBytes(bytes) {
  let ver = 1;
  while (ver <= 10) {
    const cap = VERSIONS_M[ver][0];
    const headerBytes = ver <= 9 ? 2 : 3; // 4-bit mode + 8/16-bit len + 4-bit terminator
    if (bytes.length + headerBytes <= cap) break;
    ver++;
  }
  if (ver > 10) {
    bytes = bytes.slice(0, VERSIONS_M[10][0] - 3);
    ver = 10;
  }
  const [dataCap, eccLen, groups] = VERSIONS_M[ver];
  const bits = [];
  const pushBits = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };

  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);
  const maxBits = dataCap * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(dataCap);
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data[i >> 3] = v;
  }
  const pads = [0xec, 0x11];
  for (let i = bits.length >> 3, p = 0; i < dataCap; i++, p++) data[i] = pads[p & 1];

  const blocks = [];
  let offset = 0;
  for (const [count, len] of groups) {
    for (let i = 0; i < count; i++) {
      const slice = data.slice(offset, offset + len);
      offset += len;
      blocks.push({ data: slice, ecc: rsEncode(slice, eccLen) });
    }
  }

  const out = [];
  const maxDataLen = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxDataLen; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) out.push(b.ecc[i]);
  return { ver, codewords: out };
}

function buildMatrix(ver, codewords) {
  const size = 17 + 4 * ver;
  const mat = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  const fixed = Array.from({ length: size }, () => new Uint8Array(size));

  const setFixed = (r, c, v) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      mat[r][c] = v;
      fixed[r][c] = 1;
    }
  };

  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inBox = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark = inBox && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFixed(r0 + dr, c0 + dc, dark ? 1 : 0);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  const centers = ALIGN_CENTERS[ver];
  for (const r of centers) {
    for (const c of centers) {
      if (fixed[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          setFixed(r + dr, c + dc, dark ? 1 : 0);
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    setFixed(6, i, i % 2 === 0 ? 1 : 0);
    setFixed(i, 6, i % 2 === 0 ? 1 : 0);
  }
  setFixed(size - 8, 8, 1);

  // Reserve format info
  for (let i = 0; i < 9; i++) {
    if (!fixed[8][i]) setFixed(8, i, 0);
    if (!fixed[i][8]) setFixed(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (!fixed[8][size - 1 - i]) setFixed(8, size - 1 - i, 0);
    if (!fixed[size - 1 - i][8]) setFixed(size - 1 - i, 8, 0);
  }

  if (ver >= 7) {
    const vInfo = bchVersionInfo(ver);
    for (let i = 0; i < 18; i++) {
      const bit = (vInfo >> i) & 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      setFixed(r, c, bit);
      setFixed(c, r, bit);
    }
  }

  // Place data bits
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let dir = -1;
  for (let c = size - 1; c >= 1; c -= 2) {
    if (c === 6) c = 5;
    for (let i = 0; i < size; i++) {
      const r = dir === -1 ? size - 1 - i : i;
      for (let dc = 0; dc < 2; dc++) {
        const col = c - dc;
        if (fixed[r][col]) continue;
        const bit = bitIdx < totalBits ? (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1 : 0;
        mat[r][col] = bit;
        bitIdx++;
      }
    }
    dir = -dir;
  }

  // Evaluate 8 masks
  const maskFn = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  let bestMask = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const fn = maskFn[m];
    let score = 0;
    for (let r = 0; r < size; r++) {
      let run = 1;
      let prev = mat[r][0] ^ (!fixed[r][0] && fn(r, 0) ? 1 : 0);
      for (let c = 1; c < size; c++) {
        const cur = mat[r][c] ^ (!fixed[r][c] && fn(r, c) ? 1 : 0);
        if (cur === prev) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          prev = cur;
          run = 1;
        }
      }
    }
    for (let c = 0; c < size; c++) {
      let run = 1;
      let prev = mat[0][c] ^ (!fixed[0][c] && fn(0, c) ? 1 : 0);
      for (let r = 1; r < size; r++) {
        const cur = mat[r][c] ^ (!fixed[r][c] && fn(r, c) ? 1 : 0);
        if (cur === prev) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          prev = cur;
          run = 1;
        }
      }
    }
    if (score < bestScore) {
      bestScore = score;
      bestMask = m;
    }
  }

  const fn = maskFn[bestMask];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!fixed[r][c] && fn(r, c)) mat[r][c] ^= 1;
    }
  }

  // Write format info
  const fmt = bchFormatInfo(bestMask);
  const fCoords1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> i) & 1;
    mat[fCoords1[i][0]][fCoords1[i][1]] = bit;
    if (i < 7) mat[size - 1 - i][8] = bit;
    else mat[8][size - 15 + i] = bit;
  }

  return mat;
}

/** Tạo ma trận QR (mảng 2 chiều 0/1) cho chuỗi văn bản UTF-8. */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const { ver, codewords } = encodeBytes(bytes);
  return buildMatrix(ver, codewords);
}

/** Tạo chuỗi SVG sắc nét cho mã QR (có quiet zone 2 ô). */
export function qrSvg(text, sizePx = 72) {
  const m = qrMatrix(text);
  const n = m.length;
  const pad = 2;
  const total = n + pad * 2;
  let paths = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) paths += `M${c + pad},${r + pad}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${paths}" fill="#111"/></svg>`;
}

/** Chuỗi dữ liệu QR chuẩn tra cứu hóa đơn trên Cổng HĐĐT Tổng cục Thuế. */
export function invoiceQrPayload(inv) {
  if (inv?.qrCode) return inv.qrCode;
  const p = new URLSearchParams();
  if (inv?.sellerTax) p.set('nbmst', inv.sellerTax);
  if (inv?.template) p.set('khmshdon', inv.template);
  if (inv?.series) p.set('khhdon', inv.series);
  if (inv?.number != null && inv?.number !== '') p.set('shdon', String(inv.number));
  if (inv?.invoiceCode) p.set('mhdon', inv.invoiceCode);
  return `https://hoadondientu.gdt.gov.vn/?${p.toString()}`;
}
