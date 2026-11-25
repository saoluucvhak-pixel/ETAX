/**
 * xlsx.js — Ghi và đọc file Excel (.xlsx) không cần thư viện ngoài.
 *
 * Ghi: writeXlsx(sheets) → Blob
 *   sheet = { name, title?, subtitle?, columns:[{header, key|value, width, type}], rows:[...], totals?:[keys] }
 *   type: 'text' | 'number' | 'money' | 'date' | 'percent'
 * Đọc: readXlsx(buffer) → [{ name, rows: any[][] }]  (ngày được trả về dạng ISO "YYYY-MM-DD")
 */
import { zip, unzip, bytesToText } from './zip.js';
import { isoToExcelSerial, excelSerialToISO } from '../utils.js';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** 0 → A, 25 → Z, 26 → AA */
export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** "AB12" → 27 (chỉ số cột, bắt đầu từ 0) */
export function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  let n = 0;
  for (const ch of m ? m[1] : 'A') n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Chỉ số kiểu (cellXfs) trong styles.xml bên dưới
const S = { default: 0, header: 1, money: 2, date: 3, title: 4, totalMoney: 5, totalText: 6, wrap: 7, number: 8, percent: 9, subtitle: 10 };

const STYLES_XML = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts>
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF2B3A8C"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF5B6778"/><name val="Calibri"/></font>
</fonts>
<fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF2B3A8C"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEAEDF5"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF3ECD8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFDDE2EA"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="27">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="166" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="166" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="166" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="166" fontId="0" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref, value, type, style) {
  if (value == null || value === '') return style ? `<c r="${ref}" s="${style}"/>` : '';
  if (type === 'date') {
    const n = isoToExcelSerial(value);
    return n == null ? `<c r="${ref}" s="${style && style !== S.date ? style : S.wrap}" t="inlineStr"><is><t>${esc(value)}</t></is></c>` : `<c r="${ref}" s="${style || S.date}"><v>${n}</v></c>`;
  }
  if (typeof value === 'number' || type === 'money' || type === 'number' || type === 'percent') {
    const n = Number(value);
    if (Number.isFinite(n)) return `<c r="${ref}" s="${style || S.default}"><v>${n}</v></c>`;
  }
  return `<c r="${ref}" s="${style || S.default}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

/** Tô màu cả dòng: rowTone(row) trả về 'ok' | 'warn' | 'bad' | 'gold' (xanh / vàng / đỏ / vàng đất). */
const TONE_INDEX = { ok: 0, warn: 1, bad: 2, gold: 3 };
const TYPE_OFFSET = { text: 0, wrap: 0, money: 1, date: 2, number: 3, percent: 1 };
const toneStyle = (tone, type) => 11 + TONE_INDEX[tone] * 4 + (TYPE_OFFSET[type] ?? 0);

const STYLE_BY_TYPE = { money: S.money, number: S.number, percent: S.percent, date: S.date, text: S.default, wrap: S.wrap };

function sheetXml(sheet) {
  const cols = sheet.columns;
  const rows = [];
  let r = 1;
  const push = (cells, attrs = '') => { rows.push(`<row r="${r}"${attrs}>${cells.join('')}</row>`); r++; };

  if (sheet.title) push([cellXml(`A${r}`, sheet.title, 'text', S.title)], ' ht="22" customHeight="1"');
  for (const line of [].concat(sheet.subtitle || [])) push([cellXml(`A${r}`, line, 'text', S.subtitle)]);
  if (sheet.title || sheet.subtitle) r++; // dòng trống

  const headerRow = r;
  push(cols.map((c, i) => cellXml(`${colName(i)}${r}`, c.header, 'text', S.header)), ' ht="30" customHeight="1"');

  const first = r;
  const sums = cols.map(() => 0);
  for (const row of sheet.rows) {
    const tone = sheet.rowTone?.(row);
    const cells = cols.map((c, i) => {
      const v = typeof c.value === 'function' ? c.value(row) : row[c.key];
      const t = c.type || (typeof v === 'number' ? 'number' : 'text');
      if (sheet.totals?.includes(c.key ?? c.header) && Number.isFinite(Number(v))) sums[i] += Number(v);
      return cellXml(`${colName(i)}${r}`, v, t, tone ? toneStyle(tone, t) : (STYLE_BY_TYPE[t] ?? S.default));
    });
    push(cells);
  }
  const last = r - 1;

  if (sheet.totals?.length) {
    push(cols.map((c, i) => {
      const ref = `${colName(i)}${r}`;
      if (sheet.totals.includes(c.key ?? c.header)) return `<c r="${ref}" s="${S.totalMoney}"><f>SUBTOTAL(9,${colName(i)}${first}:${colName(i)}${last})</f><v>${sums[i]}</v></c>`;
      return i === 0 ? cellXml(ref, 'Tổng cộng', 'text', S.totalText) : `<c r="${ref}" s="${S.totalText}"/>`;
    }));
  }

  const colsXml = `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 16}" customWidth="1"/>`).join('')}</cols>`;
  const view = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
  const filter = sheet.rows.length ? `<autoFilter ref="A${headerRow}:${colName(cols.length - 1)}${last}"/>` : '';
  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}<sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${rows.join('')}</sheetData>${filter}</worksheet>`;
}

const safeSheetName = (n, used) => {
  let base = String(n || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
  used.add(name.toLowerCase());
  return name;
};

/** Tạo workbook .xlsx từ mô tả sheet. */
export async function writeXlsx(sheets) {
  const used = new Set();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  const files = [
    { name: '[Content_Types].xml', data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES_XML },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  const bytes = await zip(files, { compress: true });
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------------------------------------------------------------- Đọc

const parseXml = (text) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML trong file Excel không hợp lệ');
  return doc;
};
const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];

const DATE_BUILTIN = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Đọc .xlsx → mảng sheet { name, rows } (ô trống = ''). */
export async function readXlsx(buffer) {
  const files = await unzip(buffer);
  const text = (p) => (files.has(p) ? bytesToText(files.get(p)) : null);
  const wb = text('xl/workbook.xml');
  if (!wb) throw new Error('Không phải file .xlsx hợp lệ (thiếu workbook.xml)');

  // Quan hệ id → đường dẫn sheet
  const rels = new Map();
  for (const rel of tags(parseXml(text('xl/_rels/workbook.xml.rels')), 'Relationship')) {
    let target = rel.getAttribute('Target');
    target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    rels.set(rel.getAttribute('Id'), target);
  }

  // Chuỗi dùng chung
  const shared = [];
  const ss = text('xl/sharedStrings.xml');
  if (ss) for (const si of tags(parseXml(ss), 'si')) shared.push(tags(si, 't').map((t) => t.textContent).join(''));

  // Nhận diện ô ngày qua styles
  const dateStyle = new Set();
  const st = text('xl/styles.xml');
  if (st) {
    const sdoc = parseXml(st);
    const custom = new Map(tags(sdoc, 'numFmt').map((n) => [Number(n.getAttribute('numFmtId')), n.getAttribute('formatCode')]));
    const cellXfs = tags(sdoc, 'cellXfs')[0];
    if (cellXfs) {
      [...cellXfs.children].forEach((xf, i) => {
        const id = Number(xf.getAttribute('numFmtId'));
        const code = custom.get(id);
        if (DATE_BUILTIN.has(id) || (code && /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && !/^[#0,.\s]+$/.test(code))) dateStyle.add(i);
      });
    }
  }

  const result = [];
  for (const sh of tags(parseXml(wb), 'sheet')) {
    const rid = sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sh.getAttribute('r:id');
    const path = rels.get(rid);
    const xml = path && text(path);
    if (!xml) continue;
    const rows = [];
    for (const row of tags(parseXml(xml), 'row')) {
      const idx = Number(row.getAttribute('r')) - 1;
      const arr = [];
      for (const c of tags(row, 'c')) {
        const ci = colIndex(c.getAttribute('r') || 'A');
        const t = c.getAttribute('t');
        const v = tags(c, 'v')[0]?.textContent;
        let val = '';
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = tags(c, 't').map((x) => x.textContent).join('');
        else if (t === 'str' || t === 'e') val = v ?? '';
        else if (t === 'b') val = v === '1';
        else if (v != null && v !== '') {
          const n = Number(v);
          val = dateStyle.has(Number(c.getAttribute('s'))) ? excelSerialToISO(n) : n;
        }
        arr[ci] = val;
      }
      for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = '';
      rows[idx >= 0 ? idx : rows.length] = arr;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    result.push({ name: sh.getAttribute('name'), rows });
  }
  return result;
}
