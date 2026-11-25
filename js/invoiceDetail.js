/**
 * invoiceDetail.js — Ngăn kéo "Chi tiết hóa đơn":
 * thông tin chung · người bán/người mua · hàng hóa · thuế · thanh toán · đính kèm XML/PDF · ghi chú.
 */
import { h, clear, fmtMoney, fmtDate, fmtDateTime, fmtBytes, pickFiles, downloadBlob, readText, sanitizeFileName } from './utils.js';
import { INVOICE_STATUS, TAX_RATE_LABEL, DIRECTION_LABEL, PROCESSING_STATUS } from './config.js';
import { repos } from './storage.js';
import { icon, openDrawer, statusBadge, directionBadge, toast, withLoading } from './core/ui.js';
import { updateInvoice } from './core/invoiceStore.js';
import { canFetchRemote as canSync, getClient, loadInvoiceDetail } from './core/syncEngine.js';
import { prettyXml, parseInvoiceXml } from './core/xmlparser.js';
import { exportInvoiceDetailsPdf, exportInvoicesExcel } from './export.js';
import { logger } from './logger.js';

const kv = (rows) => h('dl.kv-list', rows.filter(([, v]) => v !== undefined && v !== null && v !== '').flatMap(([k, v]) => [h('dt', k), h('dd', v)]));

function party(title, name, tax, address) {
  return h('div.party', h('h3', title), h('b', name || '(Không rõ tên)'), h('div.muted', tax ? `MST: ${tax}` : 'Không có MST'), address && h('div.muted', address));
}

function itemsTable(inv) {
  const items = inv.items || [];
  return h('div.table-wrap', h('table.tbl',
    h('thead', h('tr', ['STT', 'Hàng hóa, dịch vụ', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Thuế suất', 'Tiền thuế'].map((c, i) => h(`th${i >= 3 ? '.r' : ''}`, c)))),
    h('tbody', items.map((it, i) => h('tr', h('td', it.stt ?? i + 1), h('td', { style: { whiteSpace: 'normal', minWidth: '200px' } }, it.name), h('td', it.unit),
      h('td.r', it.qty ? fmtMoney(it.qty) : ''), h('td.r', it.price ? fmtMoney(it.price) : ''), h('td.r', fmtMoney(it.amount)), h('td.r', TAX_RATE_LABEL[it.rate] || it.rate || ''), h('td.r', fmtMoney(it.tax))))),
    h('tfoot', h('tr', h('td', { colSpan: 5 }, 'Cộng'), h('td.r', fmtMoney(items.reduce((a, x) => a + (x.amount || 0), 0))), h('td'), h('td.r', fmtMoney(items.reduce((a, x) => a + (x.tax || 0), 0)))))));
}

function taxTable(inv) {
  const rows = inv.taxBreakdown || [];
  return h('div.table-wrap', h('table.tbl',
    h('thead', h('tr', h('th', 'Thuế suất'), h('th.r', 'Tiền chưa thuế'), h('th.r', 'Tiền thuế'))),
    h('tbody', rows.map((r) => h('tr', h('td', TAX_RATE_LABEL[r.rate] || r.rate), h('td.r', fmtMoney(r.base)), h('td.r', fmtMoney(r.tax))))),
    h('tfoot', h('tr', h('td', 'Tổng'), h('td.r', fmtMoney(inv.net)), h('td.r', fmtMoney(inv.vat))))));
}

/**
 * Mở ngăn kéo chi tiết.
 * @param {object} inv
 * @param {{onChange?:Function}} [opts]
 */
export function openInvoiceDrawer(inv, { onChange } = {}) {
  let current = inv;
  const body = h('div', { style: { display: 'contents' } });
  const drawer = openDrawer({
    title: `Hóa đơn ${inv.series ? `${inv.series} ` : ''}số ${inv.number}`,
    subtitle: `${fmtDate(inv.date)} — ${DIRECTION_LABEL[inv.direction] || ''}`,
    body,
    width: 720,
    actions: [
      h('button.btn.sm', { type: 'button', onclick: () => exportInvoiceDetailsPdf([current]) }, icon('pdf', 15), h('span', 'PDF')),
      h('button.btn.sm', { type: 'button', onclick: () => exportInvoicesExcel([current], { label: `HoaDon_${sanitizeFileName(current.number)}` }) }, icon('sheet', 15), h('span', 'Excel')),
    ],
  });

  async function refresh(next) {
    if (next) current = next;
    const files = { xml: await repos.files.find(current.key, 'xml'), pdf: await repos.files.find(current.key, 'pdf') };
    clear(body).append(...sections(files));
  }

  function sections(files) {
    const i = current;
    const status = INVOICE_STATUS[i.status];
    const out = [];
    out.push(h('div.inv-hero', h('div.inv-amount', `${fmtMoney(i.total)} ${i.currency && i.currency !== 'VND' ? i.currency : 'đ'}`), statusBadge(i), directionBadge(i.direction), i.codeStatus && h(`span.badge.tone-${i.codeStatus === 'coma' ? 'ok' : 'muted'}`, i.codeStatus === 'coma' ? 'Có mã CQT' : 'Không mã')));
    if (i.status === 6 || i.status === 4) out.push(h('div.notice.warn', icon('alert', 18), h('div', `Hóa đơn này ${status.label.toLowerCase()} nên không được tính vào doanh số và thuế trong báo cáo.`)));

    out.push(h('section', h('h3.section-title', 'Thông tin chung'), kv([
      ['Ký hiệu mẫu số', i.template], ['Ký hiệu hóa đơn', i.series], ['Số hóa đơn', i.number], ['Ngày lập', fmtDate(i.date)],
      ['Trạng thái', status?.label], ['Trạng thái xử lý', PROCESSING_STATUS[i.processing]], ['Mã của cơ quan thuế', i.invoiceCode && h('span.mono', i.invoiceCode)],
      ['Loại tiền', i.currency], ['Tỷ giá', i.currency !== 'VND' ? i.exchangeRate : ''], ['Nguồn dữ liệu', { gdt: 'Cổng Thuế', xml: 'Tệp XML', excel: 'Tệp Excel', demo: 'Dữ liệu mẫu' }[i.source] || i.source], ['Cập nhật lần cuối', fmtDateTime(i.syncedAt)],
    ])));

    out.push(h('section', h('h3.section-title', 'Bên bán và bên mua'), h('div.inv-parties', party('Người bán', i.sellerName, i.sellerTax, i.sellerAddress), party('Người mua', i.buyerName, i.buyerTax, i.buyerAddress))));

    out.push(h('section', h('h3.section-title', 'Hàng hóa, dịch vụ'), i.items?.length ? itemsTable(i) : h('div.notice.info', icon('info', 18),
      h('div', h('div', 'Chưa có danh sách hàng hóa (bản đồng bộ danh sách chỉ có tổng tiền).'),
        canSync() && h('button.btn.sm.primary', { type: 'button', style: { marginTop: '8px' }, onclick: loadItems }, icon('download', 15), h('span', 'Tải chi tiết từ cổng Thuế'))))));

    out.push(h('section', h('h3.section-title', 'Thuế'), i.taxBreakdown?.length ? taxTable(i) : h('p.muted', 'Chưa có bảng thuế theo thuế suất.')));
    out.push(h('section', h('h3.section-title', 'Thanh toán'), kv([['Hình thức thanh toán', i.paymentMethod], ['Tiền chưa thuế', fmtMoney(i.net)], ['Tiền thuế GTGT', fmtMoney(i.vat)], ['Tổng thanh toán', h('b', fmtMoney(i.total))], ['Bằng chữ', i.totalInWords]])));
    out.push(h('section', h('h3.section-title', 'Tệp đính kèm'), h('div', { style: { display: 'grid', gap: '8px' } }, attachXml(files.xml), attachPdf(files.pdf))));
    out.push(h('section', h('h3.section-title', 'Ghi chú của bạn'), noteEditor()));
    return out;
  }

  // ---- Hàng hóa từ cổng
  async function loadItems() {
    try {
      const merged = await withLoading('Đang tải chi tiết hóa đơn…', () => loadInvoiceDetail(current));
      toast('Đã tải chi tiết hàng hóa.', 'ok');
      onChange?.(merged);
      refresh(merged);
    } catch (e) { toast(e.message, 'bad'); }
  }

  // ---- XML
  function attachXml(file) {
    const row = h('div.attach-row', icon('code', 20), h('div.grow', h('b', 'XML hóa đơn'), h('div.muted', file ? `${file.name} — ${fmtBytes(file.size)}` : 'Chưa đính kèm')));
    const add = (label, fn, ic) => row.append(h('button.btn.sm', { type: 'button', onclick: fn }, icon(ic, 15), h('span', label)));
    if (file) {
      add('Xem', () => viewXml(file), 'eye');
      add('Tải về', () => downloadBlob(new Blob([file.data], { type: 'application/xml' }), file.name), 'download');
    } else {
      if (canSync()) add('Tải từ cổng', fetchXml, 'download');
      add('Chọn tệp…', pickXml, 'upload');
    }
    return row;
  }

  async function saveXml(text, name) {
    const parsed = parseInvoiceXml(text);
    if (parsed.errors.length && !parsed.invoice?.number) throw new Error(parsed.errors[0]);
    await repos.files.attach({ invoiceKey: current.key, companyTax: current.companyTax, kind: 'xml', name, data: text, mime: 'application/xml' });
    const next = { ...current, hasXml: true };
    await updateInvoice(next);
    await logger.info('import', `Đính kèm XML cho hóa đơn ${current.number}`, { key: current.key });
    onChange?.(next);
    refresh(next);
  }

  async function fetchXml() {
    try {
      const text = await withLoading('Đang tải XML từ cổng Thuế…', () => getClient().xml(current));
      await saveXml(text, `${sanitizeFileName(`${current.series}-${current.number}`)}.xml`);
      toast('Đã tải và lưu XML.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function pickXml() {
    const [file] = await pickFiles({ accept: '.xml,text/xml', multiple: false });
    if (!file) return;
    try { await saveXml(await readText(file), file.name); toast('Đã đính kèm XML.', 'ok'); } catch (e) { toast(`XML không hợp lệ: ${e.message}`, 'bad'); }
  }

  function viewXml(file) {
    const pre = h('pre.xml-view', prettyXml(file.data));
    const wrap = h('div', { style: { gridColumn: '1 / -1' } }, pre);
    body.querySelector('.xml-view')?.parentElement.remove();
    body.append(wrap);
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- PDF
  function attachPdf(file) {
    const row = h('div.attach-row', icon('pdf', 20), h('div.grow', h('b', 'PDF hóa đơn'), h('div.muted', file ? `${file.name} — ${fmtBytes(file.size)}` : 'Chưa đính kèm (cổng Thuế không cung cấp PDF qua API này)')));
    if (file) {
      row.append(h('button.btn.sm', { type: 'button', onclick: () => window.open(URL.createObjectURL(file.data), '_blank') }, icon('eye', 15), h('span', 'Mở')),
        h('button.btn.sm', { type: 'button', onclick: () => downloadBlob(file.data, file.name) }, icon('download', 15), h('span', 'Tải về')));
    } else {
      row.append(h('button.btn.sm', { type: 'button', onclick: pickPdf }, icon('upload', 15), h('span', 'Chọn tệp…')));
    }
    return row;
  }

  async function pickPdf() {
    const [file] = await pickFiles({ accept: '.pdf,application/pdf', multiple: false });
    if (!file) return;
    await repos.files.attach({ invoiceKey: current.key, companyTax: current.companyTax, kind: 'pdf', name: file.name, data: file, mime: 'application/pdf' });
    const next = { ...current, hasPdf: true };
    await updateInvoice(next);
    onChange?.(next);
    toast('Đã đính kèm PDF.', 'ok');
    refresh(next);
  }

  // ---- Ghi chú
  function noteEditor() {
    const note = h('textarea.note-area', { placeholder: 'Ví dụ: đã đối chiếu với sổ ngày 12/05, chờ NCC xuất lại hóa đơn…' }, current.note || '');
    note.value = current.note || '';
    const tags = h('input', { type: 'text', placeholder: 'Nhãn, ngăn cách bằng dấu phẩy', value: (current.tags || []).join(', ') });
    return h('div', { style: { display: 'grid', gap: '8px' } }, note, tags,
      h('div', h('button.btn.sm.primary', {
        type: 'button', onclick: async () => {
          const next = { ...current, note: note.value.trim(), tags: tags.value.split(',').map((s) => s.trim()).filter(Boolean) };
          await updateInvoice(next);
          current = next;
          onChange?.(next);
          toast('Đã lưu ghi chú.', 'ok');
        },
      }, icon('save', 15), h('span', 'Lưu ghi chú'))));
  }

  refresh();
  return drawer;
}
