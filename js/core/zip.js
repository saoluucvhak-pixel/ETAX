/**
 * zip.js — Đọc/ghi ZIP tối giản, không phụ thuộc thư viện ngoài.
 *
 * - Ghi: phương thức "store" (không nén) hoặc "deflate" (dùng CompressionStream của trình duyệt).
 * - Đọc: hỗ trợ store + deflate (DecompressionStream 'deflate-raw').
 * Dùng cho: .xlsx (Excel), xuất hàng loạt XML/PDF, đọc gói .zip hóa đơn tải từ cổng Thuế.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

async function transform(u8, stream) {
  const out = new Blob([u8]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
export const deflateRaw = (u8) => transform(u8, new CompressionStream('deflate-raw'));
export const inflateRaw = (u8) => transform(u8, new DecompressionStream('deflate-raw'));

/** Chuyển ngày giờ sang định dạng DOS (dùng trong header ZIP). */
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Tạo file ZIP.
 * @param {{name:string, data:Uint8Array|string}[]} files
 * @param {{compress?:boolean}} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function zip(files, { compress = false } = {}) {
  const { time, date } = dosDateTime();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(raw);
    let body = raw;
    let method = 0;
    if (compress && raw.length > 64) {
      const d = await deflateRaw(raw);
      if (d.length < raw.length) { body = d; method = 8; }
    }

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // tên file UTF-8
    lh.setUint16(8, method, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nameBytes, body);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true);
    ch.setUint32(24, raw.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);

    offset += 30 + nameBytes.length + body.length;
  }

  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let pos = 0;
  for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}

/**
 * Đọc ZIP → Map(tên → Uint8Array). Bỏ qua thư mục.
 * @param {ArrayBuffer|Uint8Array} input
 */
export async function unzip(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // Tìm End Of Central Directory từ cuối file
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Tệp không phải ZIP hợp lệ');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();

  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP bị hỏng (central directory)');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = (flags & 0x0800 ? dec : new TextDecoder('latin1')).decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (dv.getUint32(lho, true) !== 0x04034b50) throw new Error('ZIP bị hỏng (local header)');
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const slice = u8.subarray(start, start + csize);
    if (method === 0) out.set(name, slice.slice());
    else if (method === 8) out.set(name, await inflateRaw(slice));
    else throw new Error(`ZIP dùng phương thức nén ${method} chưa được hỗ trợ`);
  }
  return out;
}

export const bytesToText = (u8) => dec.decode(u8);
export const textToBytes = (s) => enc.encode(s);

/** Nhận diện nhanh một buffer có phải ZIP (magic "PK"). */
export const looksLikeZip = (u8) => u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4b;
