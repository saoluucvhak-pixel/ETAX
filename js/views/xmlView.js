/**
 * xmlView.js — Trang "XML": nhập tệp XML hóa đơn (hoặc ZIP chứa XML), kiểm tra cấu trúc/tổng tiền/chữ ký,
 * lưu vào CSDL kèm tệp gốc; xuất lại các XML đã lưu thành ZIP.
 */
import { h, clear, fmtInt, fmtBytes, fmtDate, fmtMoney, readBuffer, downloadBlob, todayISO } from '../utils.js';
import { state, bus } from '../core/state.js';
import { repos } from '../storage.js';
import { parseInvoiceXml, prettyXml } from '../core/xmlparser.js';
import { fromParsedXml } from '../core/normalizer.js';
import { unzip, zip, looksLikeZip, bytesToText, textToBytes } from '../core/zip.js';
import { saveInvoices, loadInvoices } from '../core/invoiceStore.js';
import { dropZone } from '../core/dropzone.js';
import { icon, select, field, toast, withLoading, progressPanel, emptyState, openModal } from '../core/ui.js';
import { saveFile } from '../core/platform.js';
import { logger } from '../logger.js';
import { go } from '../core/router.js';

/** Đọc các tệp thả vào → [{name, text}] (giải nén ZIP nếu cần). */
async function collectXml(files) {
  const out = [];
  for (const f of files) {
    const buf = new Uint8Array(await readBuffer(f));
    if (looksLikeZip(buf)) {
      const entries = await unzip(buf);
      for (const [name, data] of entries) if (/\.xml$/i.test(name)) out.push({ name: name.split('/').pop(), text: bytesToText(data) });
    } else out.push({ name: f.name, text: bytesToText(buf) });
  }
  return out;
}

export async function mount(host) {
  if (!state.companyTax) {
    host.append(h('section.panel', emptyState({ title: 'Chưa chọn doanh nghiệp', text: 'Chọn hoặc tạo doanh nghiệp (đăng nhập, dữ liệu mẫu hoặc ngoại tuyến) trước khi nhập XML.', action: h('button.btn.primary', { onclick: () => go('login') }, 'Đến trang đăng nhập') })));
    return null;
  }
  let parsed = []; // {name, text, invoice, errors, warnings}
  const dirSel = select([['auto', 'Tự nhận theo MST doanh nghiệp'], ['in', 'Đầu vào (mua vào)'], ['out', 'Đầu ra (bán ra)']], 'auto');
  const resultBox = h('div');
  const storedBox = h('div');
  const progress = progressPanel();
  progress.el.hidden = true;

  async function onFiles(files) {
    const items = await withLoading('Đang đọc và kiểm tra XML…', () => collectXml(files));
    if (!items.length) return toast('Không tìm thấy tệp .xml nào trong các tệp đã chọn.', 'warn');
    parsed = items.map((it) => ({ ...it, ...parseInvoiceXml(it.text) }));
    drawResult();
  }

  const badge = (p) => (p.errors.length ? h('span.badge.tone-bad', 'Lỗi') : p.warnings.length ? h('span.badge.tone-warn', `${p.warnings.length} cảnh báo`) : h('span.badge.tone-ok', 'Hợp lệ'));

  function drawResult() {
    clear(resultBox);
    if (!parsed.length) return;
    const good = parsed.filter((p) => p.invoice && !p.errors.length);
    const rows = parsed.map((p) => h('tr', { style: { cursor: 'pointer' }, onclick: () => showFile(p) },
      h('td', p.name), h('td', p.invoice ? `${p.invoice.series || ''} ${p.invoice.number || ''}` : ''), h('td', p.invoice ? fmtDate(p.invoice.date) : ''),
      h('td', { style: { maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.invoice?.sellerName || ''), h('td.r', p.invoice ? fmtMoney(p.invoice.total) : ''), h('td', badge(p))));
    const save = h('button.btn.primary', { type: 'button', disabled: !good.length, onclick: () => saveAll(good) }, icon('save', 16), h('span', `Lưu ${fmtInt(good.length)} hóa đơn hợp lệ vào máy`));
    resultBox.append(h('section.panel',
      h('div.panel-head', h('div', h('h2', 'Kết quả kiểm tra'), h('p', `${fmtInt(parsed.length)} tệp — ${fmtInt(good.length)} đọc được — ${fmtInt(parsed.length - good.length)} lỗi`)), save),
      h('div.table-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Tệp'), h('th', 'Ký hiệu / số'), h('th', 'Ngày'), h('th', 'Người bán'), h('th.r', 'Tổng tiền'), h('th', 'Kiểm tra'))), h('tbody', rows))),
      h('p.hint', { style: { marginTop: '8px' } }, 'Bấm vào một dòng để xem chi tiết cảnh báo và nội dung XML.')));
  }

  function showFile(p) {
    const list = [...p.errors.map((m) => ({ m, tone: 'bad' })), ...p.warnings.map((m) => ({ m, tone: 'warn' }))];
    openModal({
      title: p.name, size: 'lg',
      body: h('div', { style: { display: 'grid', gap: '12px' } },
        list.length ? h('ul.file-list', list.map((x) => h(`li.${x.tone === 'bad' ? 'err' : 'warn'}`, icon('alert', 16), h('span.grow', { style: { whiteSpace: 'normal' } }, x.m)))) : h('div.notice.info', icon('check', 18), h('div', 'Không phát hiện vấn đề.')),
        h('pre.xml-view', prettyXml(p.text))),
    });
  }

  async function saveAll(good) {
    const direction = dirSel.value === 'auto' ? undefined : dirSel.value;
    progress.el.hidden = false;
    try {
      const invs = good.map((p) => ({ p, inv: fromParsedXml(p.invoice, { companyTax: state.companyTax, direction }) }));
      const existing = new Set((await loadInvoices(state.companyTax)).map((i) => i.key));
      const dup = invs.filter((x) => existing.has(x.inv.key)).length;
      let n = 0;
      for (const { p, inv } of invs) {
        inv.hasXml = true;
        await repos.files.attach({ invoiceKey: inv.key, companyTax: state.companyTax, kind: 'xml', name: p.name, data: p.text, mime: 'application/xml' });
        n++;
        if (n % 20 === 0) progress.set(n / invs.length, 'Đang lưu…', `${n}/${invs.length}`);
      }
      const r = await saveInvoices(invs.map((x) => x.inv));
      progress.done('Đã lưu');
      toast(`Đã lưu ${fmtInt(invs.length)} hóa đơn từ XML (mới ${fmtInt(r.added)}, cập nhật ${fmtInt(r.updated)}${dup ? `, trùng ${fmtInt(dup)}` : ''}).`, 'ok');
      await logger.info('import', `Nhập ${invs.length} hóa đơn từ XML`, { added: r.added, updated: r.updated });
      parsed = [];
      drawResult();
      drawStored();
    } catch (e) { progress.fail('Lưu thất bại'); toast(e.message, 'bad'); }
  }

  async function drawStored() {
    const files = (await repos.files.listByKind('xml')).filter((f) => f.companyTax === state.companyTax);
    const size = files.reduce((a, f) => a + (f.size || 0), 0);
    clear(storedBox).append(h('section.panel',
      h('div.panel-head', h('div', h('h2', 'XML đã lưu trên máy'), h('p', files.length ? `${fmtInt(files.length)} tệp — ${fmtBytes(size)}` : 'Chưa có tệp XML nào')),
        h('button.btn', { type: 'button', disabled: !files.length, onclick: () => exportZip(files) }, icon('download', 16), h('span', 'Xuất tất cả thành ZIP'))),
      files.length ? h('ul.file-list', files.slice(0, 12).map((f) => h('li', icon('code', 16), h('span.grow', f.name), h('span.muted', fmtBytes(f.size)),
        h('button.btn.sm', { type: 'button', onclick: () => downloadBlob(new Blob([f.data], { type: 'application/xml' }), f.name) }, 'Tải về')))) : h('p.muted', 'Nhập XML ở trên, hoặc mở chi tiết hóa đơn để tải XML từ cổng Thuế.'),
      files.length > 12 ? h('p.hint', { style: { marginTop: '8px' } }, `Chỉ hiện 12 tệp đầu. Xuất ZIP để lấy đủ ${fmtInt(files.length)} tệp.`) : null));
  }

  async function exportZip(files) {
    try {
      const used = new Set();
      const entries = files.map((f) => { let name = f.name; for (let i = 2; used.has(name); i++) name = f.name.replace(/(\.xml)?$/i, `_${i}.xml`); used.add(name); return { name, data: textToBytes(f.data) }; });
      const bytes = await withLoading('Đang nén…', () => zip(entries, { compress: true }));
      const r = await saveFile(`XML_${state.companyTax}_${todayISO().replaceAll('-', '')}.zip`, new Blob([bytes], { type: 'application/zip' }));
      toast(r.where === 'download' ? 'Đã tải ZIP xuống.' : `Đã lưu ${r.path}`, 'ok');
      await logger.info('export', `Xuất ZIP ${files.length} tệp XML`, { count: files.length });
    } catch (e) { toast(e.message, 'bad'); }
  }

  host.append(
    h('section.panel', h('div.panel-head', h('div', h('h2', 'Nhập XML hóa đơn'), h('p', 'Kéo thả nhiều tệp .xml hoặc một tệp .zip chứa nhiều XML'))),
      h('div', { style: { display: 'grid', gap: '14px' } }, dropZone({ title: 'Kéo tệp XML/ZIP vào đây hoặc bấm để chọn', hint: 'Chuẩn hóa đơn theo Nghị định 123/2020 và Thông tư 78/2021', accept: '.xml,.zip', onFiles }),
        h('div.form-grid', field('Chiều hóa đơn', dirSel, 'Chọn "Tự nhận" nếu MST doanh nghiệp trùng người bán/người mua trong XML.')), progress.el)),
    resultBox, storedBox);
  await drawStored();
  const off = bus.on('company:change', () => { parsed = []; drawResult(); drawStored(); });
  return off;
}
