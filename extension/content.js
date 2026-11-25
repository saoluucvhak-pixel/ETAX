/**
 * content.js - Chạy TRONG trang hoadondientu.gdt.gov.vn, sau khi BẠN tự đăng nhập.
 *
 * Việc làm: liệt kê hóa đơn theo kỳ -> tải XML gốc từng hóa đơn -> xuất Excel tổng hợp -> đóng gói ZIP theo thư mục
 * (Mua_vao|Ban_ra / YYYY-MM / KyHieu_SoHD_MST / ...). Mọi thứ xử lý ngay trên máy bạn.
 *
 * Nguyên tắc:
 *  - Không đăng nhập hộ, không xử lý CAPTCHA, không đọc/gửi mật khẩu. Token chỉ dùng tại chỗ trong trang này.
 *  - Gọi API đúng cách chính trang Thuế gọi (cùng địa chỉ, cùng định dạng tham số, cùng bộ header mô tả thao tác:
 *    Action / End-Point / request-id / Accept-Language) và giãn cách ~1 giây giữa các lần gọi.
 *  - Nếu cổng Thuế chặn ("hành vi không hợp lệ", 401/403) thì DỪNG NGAY, giữ nguyên tiến độ và báo rõ. Không thử cách khác để né.
 *
 * Hai chế độ dùng chung một bộ gọi API:
 *  1) Tải file: tự chọn kỳ trong hộp -> ZIP/Excel về thư mục Tải xuống.
 *  2) Nối eTax Manager: eTax tạo "lệnh" trên máy chủ cục bộ 127.0.0.1; tiện ích nhận lệnh (tự chạy nếu bật), tải danh sách + XML gốc
 *     rồi đẩy về eTax qua background.js. Không gửi mật khẩu/token, chỉ dữ liệu hóa đơn.
 */
(() => {
  'use strict';
  if (window.__etaxDl) return;
  window.__etaxDl = true;

  // ------------------------------------------------------------------ Cấu hình
  const ROUTE = '/tra-cuu/tra-cuu-hoa-don'; // màn hình tra cứu của cổng; header End-Point phải khớp màn hình đang mở
  const PAGE_SIZE = 15; // đúng cỡ trang mà trang Thuế dùng
  const MAX_DAYS = 31; // cổng chỉ cho tra cứu tối đa ~1 tháng mỗi lần
  const GAP_MS = 1000; // giãn cách giữa các lần gọi
  const JITTER_MS = 400;
  const PART_LIMIT = 200; // số hóa đơn tối đa trong 1 gói ZIP (giữ RAM thấp)
  const MAX_JOB_DAYS = 1100; // lệnh từ eTax dài hơn ~3 năm thì từ chối (chống lệnh bất thường khi tự chạy)
  const AUTO_KEY = 'etax_dl_autorun';
  const DIRS = {
    in: { path: 'purchase', label: 'hóa đơn mua vào', folder: 'Mua_vao', name: 'Mua vào' },
    out: { path: 'sold', label: 'hóa đơn bán ra', folder: 'Ban_ra', name: 'Bán ra' },
    // Hóa đơn khởi tạo từ máy tính tiền: cùng cách gọi nhưng dưới /api/sco-query, không lọc "kết quả kiểm tra" (đo trên cổng thật 20/09/2026)
    in_pos: { path: 'purchase', api: 'sco-query', pos: true, label: 'hóa đơn máy tính tiền mua vào', folder: 'Mua_vao_may_tinh_tien', name: 'Mua vào (máy tính tiền)' },
    out_pos: { path: 'sold', api: 'sco-query', pos: true, label: 'hóa đơn máy tính tiền bán ra', folder: 'Ban_ra_may_tinh_tien', name: 'Bán ra (máy tính tiền)' },
  };
  const TTHAI = { 1: 'Hóa đơn mới', 2: 'Hóa đơn thay thế', 3: 'Hóa đơn điều chỉnh', 4: 'Đã bị thay thế', 5: 'Đã bị điều chỉnh', 6: 'Đã bị hủy' };
  const TTXLY = { 5: 'Đã cấp mã hóa đơn', 6: 'Đã nhận - không mã', 8: 'Đã nhận - khởi tạo từ máy tính tiền' };

  // ------------------------------------------------------------------ Tiện ích
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pace = () => sleep(GAP_MS + Math.random() * JITTER_MS);
  const pad = (n) => String(n).padStart(2, '0');
  const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const portalDate = (iso, end) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}T${end ? '23:59:59' : '00:00:00'}`; };
  const isBlocked = (t) => /hành vi không hợp lệ|yêu cầu đã bị chặn|request rejected|this page can'?t be displayed/i.test(t || '');
  const safe = (s) => String(s ?? '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^\.+/, '') || '_';
  const dateParts = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
  const dmy = (v) => { const d = dateParts(v); return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : String(v || '').slice(0, 10); };
  const ym = (v) => { const d = dateParts(v); return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}` : 'khong-ro-thang'; };
  const keyOf = (it) => `${it.nbmst}|${it.khhdon}|${it.shdon}|${it.khmshdon}`;

  function chunks(from, to) {
    const out = []; let cur = new Date(`${from}T00:00:00`); const end = new Date(`${to}T00:00:00`);
    while (cur <= end) {
      const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
      const cap = new Date(cur.getTime() + (MAX_DAYS - 1) * 86400000);
      const stop = new Date(Math.min(end.getTime(), monthEnd.getTime(), cap.getTime()));
      out.push([isoLocal(cur), isoLocal(stop)]); cur = new Date(stop.getTime() + 86400000);
    }
    return out;
  }

  class Stop extends Error {}
  // Stop.busy = true đánh dấu riêng loại "hết ngân sách thử lại vì cổng Thuế báo bận (429/5xx)" — khác các loại Stop khác
  // (bị chặn chống bot, hết phiên, rời màn hình, lệnh bị hủy) vì loại này an toàn để BỎ QUA phần đang làm rồi làm tiếp phần
  // khác, không cần dừng toàn bộ lượt đồng bộ như các loại Stop kia (những loại đó ảnh hưởng mọi lượt gọi còn lại thật sự).
  function busyStop(message) { const e = new Stop(message); e.busy = true; return e; }

  // ------------------------------------------------------------------ Phiên đăng nhập (chỉ đọc tại chỗ)
  const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/;
  const decodeJwt = (t) => { try { return JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return null; } };
  function collect(v, out, depth = 0) {
    if (depth > 4 || v == null) return;
    if (typeof v === 'string') { const s = v.replace(/^Bearer\s+/i, ''); if (JWT.test(s)) out.push(s); else if (/^[\[{]/.test(v.trim())) { try { collect(JSON.parse(v), out, depth + 1); } catch { /* không phải JSON */ } } return; }
    if (typeof v === 'object') for (const x of Object.values(v)) collect(x, out, depth + 1);
  }
  function findToken() {
    const cands = [];
    for (const st of [localStorage, sessionStorage]) { try { for (let i = 0; i < st.length; i++) collect(st.getItem(st.key(i)), cands); } catch { /* bỏ qua */ } }
    try { for (const p of document.cookie.split(';')) collect(p.split('=').slice(1).join('='), cands); } catch { /* bỏ qua */ }
    const now = Date.now() / 1000;
    for (const t of cands) { const p = decodeJwt(t); if (p && !(p.exp && p.exp < now)) return t; }
    return null;
  }

  // ------------------------------------------------------------------ Lưu tạm (IndexedDB, dự phòng bằng RAM)
  const mem = { jobs: new Map(), files: new Map() };
  let dbp = null;
  const openDb = () => dbp || (dbp = new Promise((res) => {
    try {
      const r = indexedDB.open('etax_hd_dl_v1', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('jobs'); r.result.createObjectStore('files'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  }));
  async function store(name, mode, fn, fallback) {
    const d = await openDb();
    if (!d) return fallback(mem[name]);
    return new Promise((res, rej) => {
      const t = d.transaction(name, mode); const rq = fn(t.objectStore(name));
      t.oncomplete = () => res(rq?.result); t.onerror = t.onabort = () => rej(t.error);
    });
  }
  const dbGet = (n, k) => store(n, 'readonly', (o) => o.get(k), (m) => m.get(k));
  const dbPut = (n, k, v) => store(n, 'readwrite', (o) => o.put(v, k), (m) => m.set(k, v));
  const dbClear = (n) => store(n, 'readwrite', (o) => o.clear(), (m) => m.clear());

  // ------------------------------------------------------------------ Gọi API cổng Thuế (giống trang Thuế)
  let paused = false; let cancelled = false; let beat = null; // beat(msg?): báo "còn sống" về eTax (chỉ có khi chạy qua eTax Manager)
  async function gate() { let last = Date.now(); while (paused && !cancelled) { await sleep(300); if (beat && Date.now() - last > 10000) { last = Date.now(); beat(); } } if (cancelled) throw new Stop('Đã dừng theo yêu cầu. Tiến độ được giữ lại, bấm "Tiếp tục" để làm tiếp.'); }
  const headers = (label, token) => ({
    Accept: 'application/json, text/plain, */*',
    Action: encodeURIComponent(label), // mô tả thao tác, ví dụ "Tìm kiếm (hóa đơn mua vào)"
    'Accept-Language': 'vi',
    'request-id': crypto.randomUUID(),
    'End-Point': location.pathname,
    Authorization: `Bearer ${token}`,
  });

  const BUSY_ATTEMPTS = 6; // 429/502/503/504: cổng Thuế thật sự giới hạn tần suất hoặc tạm nghẽn (khác bị chặn) — chờ rồi thử lại là có ích, nên chịu được đợt bận dài hơn trước khi dừng tay
  // Riêng đúng mã 500 (Internal Server Error — máy chủ lỗi ngay khi xử lý đúng yêu cầu đó, không phải kiểu "tạm nghẽn"
  // như 502/503/504): đã xác nhận thực tế 22/09/2026 — cùng 1 hóa đơn "Không mã" vẫn lỗi 500 y hệt dù thử tay nhiều
  // lần, không tự khỏi dù đợi. Nên chỉ thử vài lần cho chắc rồi bỏ qua ngay, tránh phí thời gian chờ vô ích khi có
  // nhiều hóa đơn cùng cảnh lỗi vĩnh viễn phía cổng Thuế. Không áp dụng ngưỡng thấp này cho 502/503/504 vì đó vẫn là
  // tín hiệu "tạm nghẽn" thật sự, khác bản chất với 500.
  const BUSY_ATTEMPTS_5XX = 2;
  // Lệnh từ eTax Manager (viaEtax=true) KHÔNG có nút "Tiếp tục" trong hộp tiện ích (nút đó chỉ hiện khi đang chạy,
  // biến mất ngay khi lỗi) — phải chỉ đúng chỗ làm tiếp thật: nút "Bắt đầu đồng bộ" trong eTax Manager.
  const ETAX_RETRY = 'tiến độ đã liệt kê được giữ lại, bấm "Bắt đầu đồng bộ" trong eTax Manager để làm tiếp.';
  async function call(url, label, binary = false, viaEtax = false) {
    for (let attempt = 1; attempt <= BUSY_ATTEMPTS; attempt++) {
      await gate();
      const token = findToken();
      if (!token) throw new Stop(viaEtax ? `Không thấy phiên đăng nhập (có thể đã hết hạn). Hãy đăng nhập lại trên trang Thuế — ${ETAX_RETRY}` : 'Không thấy phiên đăng nhập (có thể đã hết hạn). Hãy đăng nhập lại trên trang này rồi bấm "Tiếp tục".');
      if (location.pathname !== ROUTE) throw new Stop(viaEtax ? `Bạn đã rời màn hình Tra cứu hóa đơn. Hãy quay lại màn hình đó — ${ETAX_RETRY}` : 'Bạn đã rời màn hình Tra cứu hóa đơn. Hãy quay lại màn hình đó rồi bấm "Tiếp tục".');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), binary ? 90000 : 45000);
      let r, buf;
      try {
        r = await fetch(url, { headers: headers(label, token), credentials: 'same-origin', signal: ctrl.signal });
        buf = await r.arrayBuffer();
      } catch (err) {
        if (err.name === 'AbortError') {
          const text = `Hết thời gian chờ cổng Thuế, thử lại lần ${attempt}/${BUSY_ATTEMPTS}…`;
          setMsg(text, '', 'ok'); beat?.(viaEtax ? text : undefined);
          if (attempt >= BUSY_ATTEMPTS) break;
          await sleep(Math.min(2500 * attempt, 20000)); continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
      const head = buf.byteLength < 8192 ? new TextDecoder().decode(buf) : '';
      if (isBlocked(head)) throw new Stop('Cổng Thuế đã chặn yêu cầu (chống truy cập tự động). Tiện ích DỪNG và giữ tiến độ, không thử cách khác. Hãy chờ một lúc, hoặc dùng nút xuất Excel/XML thủ công của trang Thuế.');
      if (r.status === 401 || r.status === 403) throw new Stop(viaEtax ? `Phiên đăng nhập hết hạn hoặc bị từ chối. Hãy đăng nhập lại trên trang Thuế — ${ETAX_RETRY}` : 'Phiên đăng nhập hết hạn hoặc bị từ chối. Hãy đăng nhập lại trên trang này rồi bấm "Tiếp tục".');
      if (r.status === 429 || r.status >= 500) {
        // Báo "còn sống" ngay cả khi đang thử lại — trước đây suốt lúc chạy qua eTax Manager KHÔNG có tín hiệu nào gửi về
        // cho tới khi một trang tải THÀNH CÔNG; nếu cổng Thuế bận nhiều lần liên tiếp, máy chủ cục bộ chờ quá 60 giây
        // không thấy gì thì tưởng nhầm là mất kết nối và báo lỗi oan, dù tiện ích vẫn đang chạy bình thường.
        // Đúng mã 500 dùng ngưỡng thấp hơn (xem BUSY_ATTEMPTS_5XX) — cùng nhánh xử lý, chỉ khác số lần kiên nhẫn;
        // 502/503/504 vẫn coi như "tạm nghẽn" giống 429, giữ nguyên ngưỡng cũ.
        const limit = r.status === 500 ? BUSY_ATTEMPTS_5XX : BUSY_ATTEMPTS;
        const text = `Cổng Thuế đang bận, thử lại lần ${attempt}/${limit}…`;
        setMsg(text, '', 'ok'); beat?.(viaEtax ? text : undefined);
        if (attempt >= limit) break; // hết ngân sách thử lại cho đúng loại lỗi này — dừng thử ngay, không đợi thêm vô ích
        await sleep(Math.min(2500 * attempt, 20000)); continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (binary) return buf;
      try { return JSON.parse(new TextDecoder().decode(buf)); } catch { throw new Stop('Cổng Thuế trả về dữ liệu không phải JSON (có thể đang bảo trì).'); }
    }
    throw busyStop(viaEtax ? `Cổng Thuế đang quá tải, thử lại sau. ${ETAX_RETRY[0].toUpperCase()}${ETAX_RETRY.slice(1)}` : 'Cổng Thuế đang quá tải, thử lại sau. Tiến độ được giữ lại, bấm "Tiếp tục" để làm tiếp.');
  }

  // ------------------------------------------------------------------ Excel tối giản (xlsx tạo bằng JSZip)
  const esc = (s) => {
    let t = String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    if (/^[=+\-@\t\r]/.test(t) && !/^-\d+(\.\d+)?$/.test(t)) t = `'${t}`;
    return t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  };
  const colName = (i) => { let s = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  async function makeXlsx(head, rows, widths, sumCols) {
    const cell = (v, ri, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      if (v === '' || v == null) return '';
      if (ri === 0) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${esc(v)}</t></is></c>`;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="2"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    };
    const all = [head, ...rows];
    let xml = all.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci)).join('')}</row>`).join('');
    if (rows.length) { // dòng tổng cộng
      const tr = all.length + 1;
      xml += `<row r="${tr}"><c r="A${tr}" t="inlineStr" s="1"><is><t>Tổng cộng</t></is></c>${sumCols.map((ci) => `<c r="${colName(ci)}${tr}" s="2"><f>SUM(${colName(ci)}2:${colName(ci)}${all.length})</f></c>`).join('')}</row>`;
    }
    const z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    z.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tong hop" sheetId="1" r:id="rId1"/></sheets></workbook>');
    z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    z.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    z.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${xml}</sheetData></worksheet>`);
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function excelRows(items) {
    const head = ['STT', 'Ký hiệu mẫu số', 'Ký hiệu hóa đơn', 'Số hóa đơn', 'Ngày lập', 'MST bên bán', 'Tên bên bán', 'MST bên mua', 'Tên bên mua', 'Tiền chưa thuế', 'Tiền thuế', 'Tổng thanh toán', 'Đơn vị tiền tệ', 'Trạng thái hóa đơn', 'Kết quả kiểm tra', 'Mã của cơ quan thuế', 'Ghi chú'];
    const rows = items.map((it, i) => [i + 1, String(it.khmshdon ?? ''), it.khhdon, String(it.shdon ?? ''), dmy(it.tdlap), it.nbmst, it.nbten, it.nmmst, it.nmten, it.tgtcthue, it.tgtthue, it.tgtttbso, it.dvtte, TTHAI[it.tthai] ?? String(it.tthai ?? ''), TTXLY[it.ttxly] ?? String(it.ttxly ?? ''), it.mhdon, it.gchu]);
    return { head, rows, widths: [6, 12, 14, 12, 12, 16, 40, 16, 40, 16, 14, 16, 10, 20, 26, 40, 30], sumCols: [9, 10, 11] };
  }

  const slim = (it) => ({ khmshdon: it.khmshdon, khhdon: it.khhdon, shdon: it.shdon, tdlap: it.tdlap, nbmst: it.nbmst, nbten: it.nbten, nmmst: it.nmmst, nmten: it.nmten, tgtcthue: it.tgtcthue, tgtthue: it.tgtthue, tgtttbso: it.tgtttbso, dvtte: it.dvtte, tthai: it.tthai, ttxly: it.ttxly, mhdon: it.mhdon, gchu: it.gchu });

  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.style.display = 'none';
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
  }

  // ------------------------------------------------------------------ Giao diện (Shadow DOM để không đụng CSS của trang)
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    .box{font:13px/1.45 "Segoe UI",Arial,sans-serif;color:#1c2640;background:#fff;border:1px solid #b3bdb3;border-radius:10px;box-shadow:0 8px 24px rgba(20,30,70,.25);width:330px;overflow:hidden}
    .head{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#1a2350;color:#fff;cursor:pointer;font-weight:600}
    .dot{width:9px;height:9px;border-radius:50%;background:#b3bdb3}.dot.ok{background:#56b58d}.dot.bad{background:#e4675e}
    .body{padding:12px;display:grid;gap:9px}.body[hidden]{display:none}
    label{display:grid;gap:3px;font-weight:600;font-size:12px}
    select,input[type=date]{font:inherit;padding:5px 6px;border:1px solid #b3bdb3;border-radius:6px}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .chk{display:flex;gap:6px;align-items:center;font-weight:400}.chk.off{opacity:.55}
    .msg{color:#4a5570;overflow-wrap:anywhere;min-height:18px}.err{color:#b42f27;font-weight:600}
    .row{display:flex;flex-wrap:wrap;gap:6px}
    button{font:inherit;border:1px solid #2b3a8c;background:#2b3a8c;color:#fff;border-radius:6px;padding:6px 10px;cursor:pointer}
    button.ghost{background:#fff;color:#2b3a8c}button:disabled{opacity:.5;cursor:not-allowed}
    .bar{height:6px;background:#dde2ea;border-radius:3px;overflow:hidden}.bar i{display:block;height:100%;background:#2b3a8c;width:0}
    .hint{font-size:11px;color:#6b7590}
  </style>
  <div class="box"><div class="head"><span class="dot"></span><span>eTax - Tải hóa đơn hàng loạt</span></div>
  <div class="body">
    <div class="two">
      <label>Loại hóa đơn<select id="dir"><option value="in">Mua vào</option><option value="out">Bán ra</option><option value="in_pos">Mua vào - máy tính tiền</option><option value="out_pos">Bán ra - máy tính tiền</option></select></label>
      <label>Kết quả kiểm tra<select id="code"><option value="5">Đã cấp mã</option><option value="6">Không mã</option><option value="">Tất cả (thử nghiệm)</option></select></label>
    </div>
    <div class="two"><label>Từ ngày<input type="date" id="from"></label><label>Đến ngày<input type="date" id="to"></label></div>
    <div>
      <label class="chk"><input type="checkbox" id="xml" checked> XML gốc, đóng gói ZIP theo thư mục</label>
      <label class="chk"><input type="checkbox" id="xls" checked> Excel tổng hợp</label>
      <label class="chk off"><input type="checkbox" disabled> PDF / HTML thể hiện hóa đơn (sắp có)</label>
    </div>
    <label class="chk"><input type="checkbox" id="auto" checked> Tự chạy khi eTax Manager ra lệnh</label>
    <div class="hint eline"></div>
    <div class="msg"></div><div class="bar" hidden><i></i></div>
    <div class="row"></div>
    <div class="hint">Chỉ chạy khi bạn đang mở Tra cứu hóa đơn và đã đăng nhập. Giãn cách ~1 giây/lần gọi; nếu bị chặn sẽ tự dừng.</div>
  </div></div>`;
  const $ = (s) => root.querySelector(s);
  const dot = $('.dot'); const msg = $('.msg'); const bar = $('.bar'); const fill = $('.bar i'); const row = $('.row'); const body = $('.body');
  const ui = { dir: $('#dir'), code: $('#code'), from: $('#from'), to: $('#to'), xml: $('#xml'), xls: $('#xls'), auto: $('#auto'), eline: $('.eline') };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* bỏ qua */ } };
  ui.auto.checked = lsGet(AUTO_KEY) !== '0';
  ui.auto.addEventListener('change', () => lsSet(AUTO_KEY, ui.auto.checked ? '1' : '0'));
  $('.head').addEventListener('click', () => { body.hidden = !body.hidden; });
  document.documentElement.append(host);
  { const t = new Date(); ui.to.value = isoLocal(t); ui.from.value = isoLocal(new Date(t.getFullYear(), t.getMonth(), 1)); }
  ui.dir.addEventListener('change', () => { ui.code.value = ui.dir.value === 'in' ? '5' : ''; ui.code.disabled = !!DIRS[ui.dir.value]?.pos; });

  const setMsg = (text, cls = '', tone = '') => { msg.textContent = text; msg.className = `msg ${cls}`; dot.className = `dot ${tone}`; };
  const setBar = (p) => { bar.hidden = p == null; if (p != null) fill.style.width = `${Math.round(p * 100)}%`; };
  const mkBtn = (label, onClick, ghost) => { const b = document.createElement('button'); b.textContent = label; if (ghost) b.className = 'ghost'; b.addEventListener('click', onClick); return b; };

  // ------------------------------------------------------------------ Quy trình
  let running = false; let saved = null;

  async function saveJob(job) { await dbPut('jobs', 'cur', job); saved = job; }

  /** Liệt kê hóa đơn theo kỳ (chia ≤31 ngày, phân trang bằng state). Dùng chung cho tải file và nối eTax.
   * onCodeBusy(code, err): CHỈ dùng ở chế độ bridge (eTax ra lệnh) — khi một mã lọc (vd "Không mã") liên tục bị cổng Thuế
   * báo bận, hết ngân sách thử lại (Stop.busy), thì BỎ QUA riêng mã đó (giữ nguyên phần đã liệt kê được của các mã khác)
   * rồi làm tiếp, thay vì để lỗi lan ra làm mất luôn kết quả của các mã đã chạy tốt. Không truyền callback này (chế độ thủ
   * công) thì hành vi giữ y hệt trước đây: lỗi bận vẫn dừng toàn bộ, không đổi. */
  async function listRange({ dirKey, from, to, codes, onPage, viaEtax = false, onCodeBusy }) {
    const dir = DIRS[dirKey]; const parts = chunks(from, to); const total = parts.length * codes.length; let step = 0;
    for (const code of codes) {
      const codeStartStep = step; // mốc step lúc bắt đầu mã này — dùng để nhảy đúng sang mã kế tiếp nếu mã này bị bỏ qua
      try {
        for (const [f, t] of parts) {
          let cursor = null; let guard = 0;
          const search = `tdlap=ge=${portalDate(f)};tdlap=le=${portalDate(t, true)}${code ? `;ttxly==${code}` : ''}`;
          do {
            const url = `${location.origin}/api/${dir.api || 'query'}/invoices/${dir.path}?sort=tdlap:desc&size=${PAGE_SIZE}${cursor ? `&state=${cursor}` : ''}&search=${search}`;
            const page = await call(url, `Tìm kiếm (${dir.label})`, false, viaEtax);
            const items = page.datas || [];
            await onPage(items, { f, t, step, total, code });
            cursor = items.length < PAGE_SIZE ? null : (page.state || null);
            await pace();
          } while (cursor && ++guard < 5000);
          step++;
        }
      } catch (e) {
        if (e instanceof Stop && e.busy && onCodeBusy) { step = codeStartStep + parts.length; await onCodeBusy(code, e); continue; }
        throw e;
      }
    }
  }

  const xmlUrl = (it, dir) => `${location.origin}/api/${dir?.api || 'query'}/invoices/export-xml?nbmst=${encodeURIComponent(it.nbmst)}&khhdon=${encodeURIComponent(it.khhdon)}&shdon=${encodeURIComponent(it.shdon)}&khmshdon=${encodeURIComponent(it.khmshdon)}`;

  /** Lấy nội dung XML hóa đơn từ gói cổng trả về (thường là ZIP có XML + HTML). */
  async function xmlFromZip(buf) {
    const u8 = new Uint8Array(buf);
    if (!(u8[0] === 0x50 && u8[1] === 0x4b)) return { name: 'invoice.xml', text: new TextDecoder().decode(u8) };
    const z = await JSZip.loadAsync(buf); let first = null;
    for (const [name, f] of Object.entries(z.files)) {
      if (f.dir || !/\.xml$/i.test(name)) continue;
      const text = await f.async('string');
      if (/<DLHDon/.test(text)) return { name, text };
      first = first || { name, text };
    }
    return first;
  }

  async function listPhase(job) {
    const dir = DIRS[job.dir]; const seen = new Set(); job.items = [];
    await listRange({
      dirKey: job.dir, from: job.from, to: job.to, codes: [dir.pos ? '' : (job.code || '')],
      onPage: async (items, { f, t, step, total }) => {
        for (const it of items) { const k = keyOf(it); if (!seen.has(k)) { seen.add(k); job.items.push({ key: k, ...slim(it) }); } }
        setMsg(`${dir.name} ${f} → ${t}: đã liệt kê ${job.items.length} hóa đơn`, '', 'ok');
        setBar((step + 0.5) / total);
      },
    });
    await saveJob(job);
  }

  async function xmlPhase(job) {
    const dir = DIRS[job.dir]; const total = job.items.length; let n = Object.keys(job.xmlDone).length; let sinceSave = 0;
    for (const it of job.items) {
      if (job.xmlDone[it.key]) continue;
      try {
        const buf = await call(xmlUrl(it, dir), `Xuất xml (${dir.label})`, true);
        await dbPut('files', `${job.id}:${it.key}`, buf);
        job.xmlDone[it.key] = 1; delete job.xmlFail[it.key];
      } catch (e) {
        // Cổng Thuế báo bận dai dẳng (Stop.busy) cho riêng hóa đơn này thì chỉ ghi nhận lỗi rồi tải tiếp hóa đơn kế,
        // giống hệt cách xử lý ở chế độ bridge — không dừng cả lượt vì các hóa đơn khác vẫn tải tốt.
        if (e instanceof Stop && !e.busy) { await saveJob(job); throw e; }
        job.xmlFail[it.key] = e.message;
      }
      n++; if (++sinceSave >= 10) { sinceSave = 0; await saveJob(job); }
      setMsg(`Tải XML ${n}/${total} (${Object.keys(job.xmlFail).length} lỗi)`, '', 'ok'); setBar(n / total);
      await pace();
    }
    await saveJob(job);
  }

  async function buildPhase(job) {
    const dir = DIRS[job.dir]; const stamp = `${dir.folder}_${job.from}_${job.to}`;
    setMsg('Đang tạo file kết quả…', '', 'ok');
    if (job.wantExcel) {
      const { head, rows, widths, sumCols } = excelRows(job.items);
      saveBlob(await makeXlsx(head, rows, widths, sumCols), `TongHop_${stamp}.xlsx`);
      await sleep(400);
    }
    if (job.wantXml) {
      const have = job.items.filter((it) => job.xmlDone[it.key]);
      const partsN = Math.max(1, Math.ceil(have.length / PART_LIMIT));
      for (let p = 0; p < have.length; p += PART_LIMIT) {
        const zip = new JSZip(); const slice = have.slice(p, p + PART_LIMIT);
        for (const it of slice) {
          const buf = await dbGet('files', `${job.id}:${it.key}`); if (!buf) continue;
          const base = `${dir.folder}/${ym(it.tdlap)}/${safe(it.khhdon)}_${safe(it.shdon)}_${safe(it.nbmst)}`;
          const u8 = new Uint8Array(buf);
          if (u8[0] === 0x50 && u8[1] === 0x4b) { // file ZIP do cổng trả về: giải ra, giữ nguyên tên bên trong
            const inner = await JSZip.loadAsync(buf);
            for (const [name, f] of Object.entries(inner.files)) {
              if (f.dir) continue;
              const clean = name.split('/').filter((s) => s && s !== '..' && s !== '.').map(safe).join('/');
              if (clean) zip.file(`${base}/${clean}`, await f.async('uint8array'));
            }
          } else zip.file(`${base}/${safe(it.khhdon)}_${safe(it.shdon)}.xml`, u8);
        }
        const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        saveBlob(blob, partsN > 1 ? `${stamp}_phan${p / PART_LIMIT + 1}.zip` : `${stamp}.zip`);
        setMsg(`Đã tạo gói ZIP ${Math.floor(p / PART_LIMIT) + 1}/${partsN}`, '', 'ok');
        await sleep(600);
      }
      // Ghi rõ đúng hóa đơn nào bị lỗi khi tải XML (MST/ký hiệu/số) ra 1 file riêng — trước đây chỉ báo SỐ LƯỢNG lỗi,
      // không biết là hóa đơn nào, tra lại rất khó. Bấm "Tiếp tục" tải lại được thì hóa đơn đó tự rời khỏi danh sách này
      // (xem xmlPhase: xóa job.xmlFail[key] khi tải thành công).
      const fails = Object.keys(job.xmlFail);
      if (fails.length) {
        const byKey = new Map(job.items.map((it) => [it.key, it]));
        const lines = fails.map((k) => { const it = byKey.get(k) || {}; return `MST: ${it.nbmst || ''} | Ký hiệu: ${it.khhdon || ''} | Số: ${it.shdon || ''} | Ngày lập: ${dmy(it.tdlap)} | Người bán: ${it.nbten || ''} | Lỗi: ${job.xmlFail[k]}`; });
        saveBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `DanhSachLoi_${stamp}.txt`);
        await sleep(300);
      }
    }
  }

  async function run(job) {
    running = true; paused = false; cancelled = false; renderButtons();
    try {
      if (job.phase === 'list') { await listPhase(job); job.phase = job.wantXml ? 'xml' : 'build'; await saveJob(job); }
      if (job.phase === 'xml') { await xmlPhase(job); job.phase = 'build'; await saveJob(job); }
      if (job.phase === 'build') { await buildPhase(job); job.phase = 'done'; await saveJob(job); }
      const fails = Object.keys(job.xmlFail).length;
      setBar(1); setMsg(`Xong: ${job.items.length} hóa đơn${job.wantXml ? `, ${Object.keys(job.xmlDone).length} XML` : ''}${fails ? `, ${fails} XML lỗi — xem file DanhSachLoi_*.txt (bấm "Tiếp tục" để thử lại)` : ''}. Kiểm tra thư mục Tải xuống.`, '', 'ok');
    } catch (e) {
      const text = e instanceof Stop ? e.message : `Lỗi: ${e.message}`;
      setMsg(text, 'err', 'bad'); try { await saveJob(job); } catch { /* bỏ qua */ }
    }
    running = false; renderButtons();
  }

  // ------------------------------------------------------------------ Nối eTax Manager (qua background.js -> 127.0.0.1)
  const bridge = (method, path, body) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage({ type: 'bridge', method, path, body }, (r) => resolve(r || { ok: false, error: chrome.runtime.lastError?.message || 'Không có phản hồi' })); } catch (e) { resolve({ ok: false, error: e.message }); }
  });
  const mstOf = (payload) => { const c = [payload?.sub, payload?.username, payload?.mst, payload?.preferred_username, payload?.user_name].map((x) => String(x || '')); return c.find((x) => /^\d{10}(-\d{3})?$|^\d{12}$/.test(x)) || ''; };
  const ran = new Set(); // các lệnh đã chạy: không chạy lại
  const etax = { connected: false, job: null };
  const jobGone = async (job) => { const cur = await bridge('GET', 'job'); return !cur.ok || cur.json?.job?.id !== job.id; };

  /** Chạy một lệnh của eTax Manager: liệt kê -> (tùy chọn) tải XML gốc từng hóa đơn; đẩy dữ liệu về eTax ngay khi có. */
  async function runEtax(job) {
    running = true; paused = false; cancelled = false; renderButtons();
    let lastPct = 0;
    const report = (state, message, pct = lastPct) => { lastPct = pct; return bridge('POST', 'progress', { jobId: job.id, state, message, pct }); };
    beat = (msg) => report('running', msg || 'Đang tạm dừng trên trang Thuế…');
    const dir = DIRS[job.direction];
    try {
      const isoDay = /^\d{4}-\d{2}-\d{2}$/;
      if (!dir || !isoDay.test(job.from || '') || !isoDay.test(job.to || '') || job.from > job.to) throw new Stop('Lệnh từ eTax Manager không hợp lệ (chiều hoặc khoảng ngày).');
      if ((new Date(job.to) - new Date(job.from)) / 86400000 > MAX_JOB_DAYS) throw new Stop('Khoảng ngày quá dài (tối đa khoảng 3 năm mỗi lệnh). Hãy chia nhỏ trong eTax Manager.');
      // Mua vào bắt buộc chọn "kết quả kiểm tra" trên cổng, nên "tất cả" = lần lượt đã cấp mã (5) rồi không mã (6); bán ra thì không lọc.
      const codes = job.codeMode === 'coma' ? ['5'] : job.codeMode === 'khongma' ? ['6'] : (job.direction === 'in' ? ['5', '6'] : ['']);
      const listW = job.xml ? 0.3 : 1; const seen = new Set(); const listed = []; const skipped = []; // skipped: các mã lọc bị bỏ qua do cổng Thuế báo bận dai dẳng
      // Nhãn hiển thị cho từng mã lọc "kết quả kiểm tra", để tiến độ ghi rõ đang chạy loại nào (Đã cấp mã / Không mã) —
      // thay vì gộp chung 1 dòng mơ hồ, giúp thấy ngay loại nào đang chạy/loại nào gặp lỗi khi theo dõi.
      const CODE_LABEL = { 5: 'Đã cấp mã', 6: 'Không mã' };
      // Lượt 1: hóa đơn điện tử thường; lượt 2 (nếu eTax tick "máy tính tiền"): hóa đơn khởi tạo từ máy tính tiền (không lọc mã/không mã)
      const passes = [{ dk: job.direction, codes }].concat(job.pos ? [{ dk: `${job.direction}_pos`, codes: [''] }] : []);
      for (let pi = 0; pi < passes.length; pi++) {
        const { dk, codes: pcodes } = passes[pi]; const pdir = DIRS[dk];
        await listRange({
          dirKey: dk, from: job.from, to: job.to, codes: pcodes, viaEtax: true,
          onPage: async (items, { f, t, step, total, code }) => {
            if (await jobGone(job)) throw new Stop('Lệnh đồng bộ đã bị hủy trong eTax Manager.');
            const fresh = items.filter((it) => { const k = keyOf(it); if (seen.has(k)) return false; seen.add(k); listed.push({ key: k, dk, nbmst: it.nbmst, khhdon: it.khhdon, shdon: it.shdon, khmshdon: it.khmshdon }); return true; });
            if (fresh.length) { const sent = await bridge('POST', 'data', { jobId: job.id, direction: job.direction, kind: 'list', items: fresh }); if (!sent.ok) throw new Stop(sent.error || 'Không gửi được dữ liệu về eTax Manager.'); }
            const pct = ((pi + (step + 0.5) / total) / passes.length) * listW;
            const label = CODE_LABEL[code] ? ` — ${CODE_LABEL[code]}` : '';
            const text = `${pdir.name}${label} ${f} → ${t}: đã liệt kê ${listed.length} hóa đơn`;
            setMsg(text, '', 'ok'); setBar(pct); await report('running', text, pct);
          },
          // Riêng chế độ bridge (eTax ra lệnh): 1 mã lọc bận dai dẳng (vd "Không mã") thì bỏ qua đúng mã đó, giữ lại kết
          // quả của các mã/lượt khác đã liệt kê tốt, không để lan ra làm mất trắng toàn bộ lệnh đồng bộ.
          onCodeBusy: async (code, e) => {
            const label = CODE_LABEL[code] ? ` — ${CODE_LABEL[code]}` : '';
            skipped.push(`${pdir.name}${label}`);
            const text = `${pdir.name}${label}: bỏ qua do cổng Thuế liên tục báo bận (đã thử ${BUSY_ATTEMPTS} lần) — giữ lại phần đã liệt kê được`;
            setMsg(text, '', 'bad'); await report('running', text);
          },
        });
      }
      let xmlOk = 0; let xmlFail = 0;
      if (job.xml) {
        for (let i = 0; i < listed.length; i++) {
          const it = listed[i];
          if (i % 10 === 0 && (await jobGone(job))) throw new Stop('Lệnh đồng bộ đã bị hủy trong eTax Manager.');
          try {
            const idir = DIRS[it.dk] || dir; const x = await xmlFromZip(await call(xmlUrl(it, idir), `Xuất xml (${idir.label})`, true, true));
            if (!x) throw new Error('không thấy XML trong gói');
            const sent = await bridge('POST', 'data', { jobId: job.id, direction: job.direction, kind: 'xml', items: [{ key: it.key, name: `${safe(it.khhdon)}_${safe(it.shdon)}.xml`, xml: x.text }] });
            if (!sent.ok) throw new Stop(sent.error || 'Không gửi được dữ liệu về eTax Manager.');
            xmlOk++;
          } catch (e) {
            // Lỗi "hết ngân sách thử lại vì cổng Thuế báo bận" (Stop.busy) chỉ bỏ qua đúng hóa đơn này rồi tải tiếp hóa đơn
            // kế — không dừng cả lượt, vì các hóa đơn khác vẫn đang tải tốt (khác các loại Stop khác, những loại đó vẫn
            // dừng toàn bộ như cũ vì ảnh hưởng mọi hóa đơn còn lại thật sự).
            if (e instanceof Stop && !e.busy) throw e;
            xmlFail++;
            // Gửi rõ MST/ký hiệu/số hóa đơn bị lỗi về eTax Manager — trước đây chỉ đếm số lượng (xmlFail), không biết
            // đúng hóa đơn nào, không tra lại được. Không chặn cả lượt nếu gửi thất bại (chỉ là dữ liệu báo cáo thêm).
            await bridge('POST', 'data', { jobId: job.id, direction: job.direction, kind: 'xmlFail', items: [{ key: it.key, nbmst: it.nbmst, khhdon: it.khhdon, shdon: it.shdon, khmshdon: it.khmshdon, message: e.message }] });
          }
          const pct = listW + (1 - listW) * ((i + 1) / listed.length); const text = `${dir.name}: tải XML ${i + 1}/${listed.length}${xmlFail ? ` (${xmlFail} lỗi)` : ''}`;
          setMsg(text, '', 'ok'); setBar(pct); await report('running', text, pct);
          await pace();
        }
      }
      const done = `Hoàn tất: ${listed.length} hóa đơn${job.xml ? `, ${xmlOk} XML${xmlFail ? `, ${xmlFail} XML lỗi` : ''}` : ''}${skipped.length ? `. Đã bỏ qua (cổng bận): ${skipped.join(', ')}` : ''}`;
      setBar(1); setMsg(`Xong (eTax): ${done.replace('Hoàn tất: ', '')}.`, '', skipped.length ? 'bad' : 'ok'); await report('done', done, 1);
    } catch (e) {
      const text = e instanceof Stop ? e.message : `Lỗi: ${e.message}`;
      setMsg(text, 'err', 'bad'); setBar(null); await report('error', text, 0);
    }
    beat = null; running = false; renderButtons();
  }

  function newJob() {
    const from = ui.from.value; const to = ui.to.value;
    if (!from || !to || from > to) { setMsg('Chọn đủ khoảng ngày (Từ ngày ≤ Đến ngày).', 'err', 'bad'); return null; }
    if (!ui.xml.checked && !ui.xls.checked) { setMsg('Chọn ít nhất XML hoặc Excel.', 'err', 'bad'); return null; }
    return { id: `j${Date.now()}`, dir: ui.dir.value, from, to, code: ui.code.value, wantXml: ui.xml.checked, wantExcel: ui.xls.checked, phase: 'list', items: [], xmlDone: {}, xmlFail: {} };
  }

  async function clearTemp() { await dbClear('jobs'); await dbClear('files'); saved = null; setBar(null); setMsg('Đã xóa dữ liệu tạm.', '', 'ok'); renderButtons(); }

  function renderButtons() {
    const btns = [];
    const onRoute = location.pathname === ROUTE;
    if (running) {
      btns.push(mkBtn(paused ? 'Tiếp tục' : 'Tạm dừng', () => { paused = !paused; setMsg(paused ? 'Đang tạm dừng…' : 'Đang chạy…', '', 'ok'); renderButtons(); }, true));
      btns.push(mkBtn('Dừng', () => { cancelled = true; }, true));
    } else {
      const start = mkBtn(saved && saved.phase !== 'done' ? 'Bắt đầu mới (bỏ việc dở)' : 'Bắt đầu', async () => {
        const job = newJob(); if (!job) return;
        await dbClear('files'); await saveJob(job); setBar(0); run(job);
      });
      start.disabled = !onRoute; btns.push(start);
      if (etax.job && !ui.auto.checked) { const b = mkBtn('Chạy lệnh từ eTax', () => { ran.add(etax.job.id); runEtax(etax.job); }); b.disabled = !onRoute; btns.unshift(b); }
      if (saved && saved.phase !== 'done') { const b = mkBtn(`Tiếp tục việc dở (${Object.keys(saved.xmlDone).length}/${saved.items.length || '?'})`, () => run(saved), true); b.disabled = !onRoute; btns.push(b); }
      if (saved && saved.phase === 'done') { const b = mkBtn('Tải lại kết quả', () => { const j = saved; j.phase = 'build'; run(j); }, true); b.disabled = !onRoute; btns.push(b); }
      if (saved) btns.push(mkBtn('Xóa dữ liệu tạm', clearTemp, true));
    }
    row.replaceChildren(...btns);
  }

  // ------------------------------------------------------------------ Theo dõi trạng thái trang
  async function tick() {
    if (running) return;
    const onRoute = location.pathname === ROUTE; const token = findToken(); const payload = token ? decodeJwt(token) : null;
    const hello = await bridge('POST', 'hello', { loggedIn: !!token, user: String(payload?.username || payload?.sub || ''), mst: mstOf(payload), page: location.pathname });
    if (running) return;
    etax.connected = !!hello.ok; etax.job = null;
    ui.eline.textContent = etax.connected ? 'eTax Manager: đã kết nối.' : 'eTax Manager: chưa kết nối (mở Chay-eTax.bat nếu muốn nối). Vẫn tải file bình thường.';
    if (etax.connected && token && onRoute) {
      const j = (await bridge('GET', 'job')).json?.job;
      if (running) return; // trong lúc chờ phản hồi thì việc khác đã bắt đầu
      if (j && !ran.has(j.id)) { etax.job = j; if (ui.auto.checked) { ran.add(j.id); runEtax(j); return; } }
    }
    if (!token) setMsg('Chưa thấy phiên đăng nhập. Hãy đăng nhập trang Thuế (tự nhập mật khẩu và mã xác thực).', '', 'bad');
    else if (!onRoute) setMsg(etax.connected ? 'Đã đăng nhập. Hãy mở Tra cứu → Tra cứu hóa đơn; eTax Manager sẽ đồng bộ tại đó.' : 'Đã đăng nhập. Hãy mở menu Tra cứu → Tra cứu hóa đơn để bắt đầu.', '', 'bad');
    else if (etax.job) setMsg(`Lệnh từ eTax Manager: ${etax.job.direction === 'out' ? 'BÁN RA' : 'MUA VÀO'} ${etax.job.from} → ${etax.job.to}${etax.job.xml ? ' (kèm XML)' : ''}. Bấm "Chạy lệnh từ eTax" để bắt đầu.`, '', 'ok');
    // "quá tải"/"bận" bổ sung vào đây: trước đây thiếu 2 từ khóa này nên thông báo lỗi "Cổng Thuế đang quá tải…" bị
    // tick() tự xóa (ghi đè lại "Sẵn sàng…") chỉ sau 2.5 giây — khiến hộp tiện ích trông như chưa từng lỗi, dù thật ra vừa lỗi.
    else if (!/Xong|Đã dừng|Lỗi|chặn|hết hạn|Đã xóa|hủy|quá tải|đang bận/.test(msg.textContent)) setMsg(etax.connected ? 'Sẵn sàng. Đồng bộ từ eTax Manager, hoặc chọn kỳ ở đây để tải file.' : 'Sẵn sàng. Chọn loại hóa đơn và khoảng ngày rồi bấm Bắt đầu.', '', 'ok');
    renderButtons();
  }
  dbGet('jobs', 'cur').then((j) => { saved = j || null; tick(); }).catch(() => tick());
  setInterval(tick, 2500);
})();
