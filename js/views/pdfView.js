/**
 * pdfView.js — Trang "PDF":
 *   1) Xuất "bản thể hiện" PDF của danh sách hoặc từng hóa đơn (không thay thế bản gốc có chữ ký số).
 *   2) Đính kèm PDF gốc (do nhà cung cấp gửi) vào hóa đơn: tự ghép theo số hóa đơn/ký hiệu trong tên tệp.
 */
import { h, clear, fmtInt, fmtBytes, fmtDate, readBuffer, downloadBlob, periodRange, speedEtaText } from '../utils.js';
import { state, bus } from '../core/state.js';
import { repos } from '../storage.js';
import { loadInvoices, filterInvoices, saveInvoices } from '../core/invoiceStore.js';
import { dropZone } from '../core/dropzone.js';
import { icon, select, field, toast, withLoading, progressPanel, emptyState } from '../core/ui.js';
import { exportInvoicesPdf, exportInvoiceDetailsPdf, exportInvoiceFilesPdf } from '../export.js';
import { logger } from '../logger.js';
import { go } from '../core/router.js';

const MAX_DETAIL_PAGES = 200;
const MAX_PDF_FILES = 1000;

/** Tìm hóa đơn khớp tên tệp: cần chứa số hóa đơn (chuỗi số đứng riêng) và, nếu có, ký hiệu. */
export function matchInvoice(fileName, invoices) {
  const base = fileName.replace(/\.pdf$/i, '').toUpperCase();
  const nums = new Set((base.match(/\d+/g) || []).map((n) => n.replace(/^0+(?=\d)/, '')));
  const hits = invoices.filter((i) => nums.has(String(i.number)) && (!i.series || base.includes(String(i.series).toUpperCase())));
  return hits.length === 1 ? hits[0] : null;
}

export async function mount(host) {
  if (!state.companyTax) {
    host.append(h('section.panel', emptyState({ title: 'Chưa chọn doanh nghiệp', text: 'Chọn doanh nghiệp trước khi xuất hoặc đính kèm PDF.', action: h('button.btn.primary', { onclick: () => go('login') }, 'Đến trang đăng nhập') })));
    return null;
  }
  let all = [];
  const dir = select([['', 'Cả hai chiều'], ['in', 'Đầu vào'], ['out', 'Đầu ra']], '');
  const per = select([['', 'Mọi thời gian'], ['month', 'Tháng này'], ['lastMonth', 'Tháng trước'], ['quarter', 'Quý này'], ['year', 'Năm nay']], '');
  const counted = h('input', { type: 'checkbox', checked: true });
  const info = h('div.muted');
  const matchBox = h('div');
  const storedBox = h('div');

  const pick = () => {
    const [from, to] = per.value ? periodRange(per.value) : [undefined, undefined];
    return filterInvoices(all, { direction: dir.value || undefined, from, to, counted: counted.checked });
  };
  const refreshInfo = () => { info.textContent = `${fmtInt(pick().length)} hóa đơn phù hợp bộ lọc.`; };
  [dir, per, counted].forEach((el) => el.addEventListener('change', refreshInfo));

  function exportList() {
    const rows = pick();
    if (!rows.length) return toast('Không có hóa đơn phù hợp.', 'warn');
    exportInvoicesPdf(rows, { title: 'Danh sách hóa đơn' });
  }
  function exportEach() {
    const rows = pick();
    if (!rows.length) return toast('Không có hóa đơn phù hợp.', 'warn');
    if (rows.length > MAX_DETAIL_PAGES) return toast(`Mỗi lần in tối đa ${MAX_DETAIL_PAGES} hóa đơn (đang chọn ${fmtInt(rows.length)}). Hãy thu hẹp kỳ hoặc chiều.`, 'warn');
    exportInvoiceDetailsPdf(rows);
  }

  // ---- Mỗi hóa đơn một tệp PDF thật (không qua hộp thoại in)
  let filesRunning = false;
  const filesProgress = progressPanel();
  filesProgress.el.hidden = true;
  async function exportFiles() {
    if (filesRunning) return;
    const rows = pick();
    if (!rows.length) return toast('Không có hóa đơn phù hợp.', 'warn');
    if (rows.length > MAX_PDF_FILES) return toast(`Mỗi lần xuất tối đa ${fmtInt(MAX_PDF_FILES)} hóa đơn (đang chọn ${fmtInt(rows.length)}). Hãy thu hẹp kỳ hoặc chiều.`, 'warn');
    filesRunning = true;
    filesProgress.el.hidden = false;
    filesProgress.set(0, 'Đang chuẩn bị…', `0/${fmtInt(rows.length)}`);
    const startedAt = performance.now();
    try {
      const r = await exportInvoiceFilesPdf(rows, {
        onProgress(done, total) {
          const elapsedMs = performance.now() - startedAt;
          const pct = done / total;
          const speed = elapsedMs > 1000 ? done / (elapsedMs / 1000) : null;
          const etaMs = pct > 0.03 && pct < 1 ? Math.round((elapsedMs * (1 - pct)) / pct) : null;
          filesProgress.set(pct, 'Đang tạo PDF…', `${fmtInt(done)}/${fmtInt(total)}`, speedEtaText({ speed, etaMs }));
        },
      });
      filesProgress.done(r.fail ? `Xong — ${fmtInt(r.fail)} tệp lỗi` : 'Đã xuất xong');
      toast(r.fail ? `Đã xuất ${fmtInt(r.ok)}/${fmtInt(r.total)} tệp PDF (${fmtInt(r.fail)} lỗi — xem Nhật ký).` : `Đã xuất ${fmtInt(r.ok)} tệp PDF, mỗi hóa đơn một tệp riêng.`, r.fail ? 'warn' : 'ok');
    } catch (e) {
      filesProgress.fail('Xuất PDF thất bại', e.message);
      toast(e.message, 'bad');
    } finally {
      filesRunning = false;
    }
  }

  // ---- Đính kèm PDF gốc
  async function onPdfs(files) {
    const invs = all;
    const items = files.map((f) => ({ file: f, inv: matchInvoice(f.name, invs) }));
    clear(matchBox);
    const okCount = items.filter((x) => x.inv).length;
    const save = h('button.btn.primary', { type: 'button', disabled: !okCount, onclick: async () => {
      await withLoading('Đang lưu PDF…', async () => {
        const updated = [];
        for (const { file, inv } of items.filter((x) => x.inv)) {
          await repos.files.attach({ invoiceKey: inv.key, companyTax: inv.companyTax, kind: 'pdf', name: file.name, data: new Blob([await readBuffer(file)], { type: 'application/pdf' }), mime: 'application/pdf' });
          updated.push({ ...inv, hasPdf: true });
        }
        await saveInvoices(updated);
        await logger.info('import', `Đính kèm ${updated.length} PDF vào hóa đơn`, { count: updated.length });
      });
      toast(`Đã đính kèm ${fmtInt(okCount)} PDF.`, 'ok');
      clear(matchBox);
      drawStored();
    } }, icon('save', 16), h('span', `Đính kèm ${fmtInt(okCount)} tệp đã ghép được`));
    matchBox.append(h('section.panel',
      h('div.panel-head', h('div', h('h2', 'Kết quả ghép tệp'), h('p', `${fmtInt(okCount)}/${fmtInt(items.length)} tệp ghép được với đúng một hóa đơn`)), save),
      h('ul.file-list', items.map(({ file, inv }) => h(`li${inv ? '' : '.warn'}`, icon(inv ? 'link' : 'alert', 16), h('span.grow', file.name), h('span', { style: { whiteSpace: 'nowrap' } }, inv ? `${inv.series} ${inv.number} — ${fmtDate(inv.date)}` : 'Không ghép được')))),
      okCount < items.length ? h('p.hint', { style: { marginTop: '8px' } }, 'Tên tệp cần chứa số hóa đơn (và tốt nhất cả ký hiệu), ví dụ C24TAA_00001234.pdf. Tệp không ghép được có thể đính kèm thủ công trong chi tiết từng hóa đơn.') : null));
  }

  async function drawStored() {
    const files = (await repos.files.listByKind('pdf')).filter((f) => f.companyTax === state.companyTax);
    clear(storedBox).append(h('section.panel',
      h('div.panel-head', h('div', h('h2', 'PDF đính kèm trên máy'), h('p', files.length ? `${fmtInt(files.length)} tệp — ${fmtBytes(files.reduce((a, f) => a + (f.size || 0), 0))}` : 'Chưa có tệp PDF nào'))),
      files.length ? h('ul.file-list', files.slice(0, 15).map((f) => h('li', icon('pdf', 16), h('span.grow', f.name), h('span.muted', fmtBytes(f.size)),
        h('button.btn.sm', { type: 'button', onclick: () => window.open(URL.createObjectURL(f.data), '_blank') }, 'Mở'),
        h('button.btn.sm', { type: 'button', onclick: () => downloadBlob(f.data, f.name) }, 'Tải về'),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Gỡ đính kèm', onclick: async () => { await repos.files.delete(f.key); const inv = all.find((i) => i.key === f.invoiceKey); if (inv) await saveInvoices([{ ...inv, hasPdf: false }]); drawStored(); } }, icon('trash', 15)))))
        : h('p.muted', 'Kéo thả PDF gốc ở trên để đính kèm.')));
  }

  host.append(
    h('section.panel', h('div.panel-head', h('div', h('h2', 'Xuất bản thể hiện PDF'), h('p', 'Trong hộp thoại in, chọn "Lưu dưới dạng PDF" (bản Electron lưu thẳng vào thư mục lưu)'))),
      h('div.form-grid', field('Chiều hóa đơn', dir), field('Kỳ', per), h('div.field', h('label', 'Tùy chọn'), h('label.check', counted, 'Bỏ hóa đơn hủy / bị thay thế'))),
      h('div.row-gap', { style: { marginTop: '14px', flexWrap: 'wrap' } }, h('button.btn.primary', { type: 'button', onclick: exportList }, icon('pdf', 16), h('span', 'Danh sách (một bảng)')),
        h('button.btn', { type: 'button', onclick: exportEach }, icon('file', 16), h('span', 'Từng hóa đơn (mỗi hóa đơn một trang)')), info),
      h('div.notice.info', { style: { marginTop: '14px' } }, icon('info', 18), h('div', 'Đây là bản thể hiện dựng từ dữ liệu đã lưu, không thay thế hóa đơn gốc có chữ ký số của người bán.'))),
    h('section.panel', h('div.panel-head', h('div', h('h2', 'Mỗi hóa đơn một tệp PDF'), h('p', 'Tạo tệp PDF thật cho từng hóa đơn — không qua hộp thoại in, dùng chung bộ lọc phía trên'))),
      h('div.row-gap', { style: { marginTop: '4px', flexWrap: 'wrap' } }, h('button.btn.primary', { type: 'button', onclick: exportFiles }, icon('pdf', 16), h('span', 'Xuất mỗi hóa đơn một tệp PDF'))),
      h('div', { style: { marginTop: '10px' } }, filesProgress.el),
      !state.settings.saveFolderName ? h('div.notice.warn', { style: { marginTop: '10px' } }, icon('alert', 18), h('div', 'Chưa chọn thư mục lưu (trang Cài đặt) — nếu xuất nhiều hóa đơn cùng lúc, trình duyệt sẽ tải xuống nhiều tệp liên tiếp và có thể hỏi xác nhận. Nên chọn thư mục lưu trước khi xuất số lượng lớn.')) : null),
    h('section.panel', h('div.panel-head', h('div', h('h2', 'Đính kèm PDF gốc'), h('p', 'Ghép tự động theo số hóa đơn trong tên tệp'))), dropZone({ title: 'Kéo tệp PDF vào đây hoặc bấm để chọn', hint: 'Có thể chọn nhiều tệp', accept: '.pdf', onFiles: onPdfs })),
    matchBox, storedBox);
  const reload = async () => { all = await loadInvoices(state.companyTax); refreshInfo(); drawStored(); };
  await reload();
  const offs = [bus.on('invoices:change', reload), bus.on('company:change', reload)];
  return () => offs.forEach((f) => f());
}
