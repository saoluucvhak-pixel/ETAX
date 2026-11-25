/**
 * excelBulk.js — Khung "Nhập tệp Excel tải từ cổng Thuế (nhiều tệp một lượt)" trên trang Excel.
 * Cách dùng: trên trang cổng Thuế xuất Excel (mua vào, bán ra, máy tính tiền), kéo TẤT CẢ các tệp vào đây một lần;
 * ứng dụng tự nhận chiều theo MST doanh nghiệp, hiện kỳ và số hóa đơn từng tệp, rồi nhập. Nhập lại nhiều lần không nhân đôi.
 */
import { h, clear, fmtInt, fmtDate, readBuffer, readText, parseCsv } from '../utils.js';
import { state } from '../core/state.js';
import { readXlsx } from '../core/xlsx.js';
import { parsePortalFiles, invoicesOf, refresh } from '../core/portalExcel.js';
import { saveInvoices } from '../core/invoiceStore.js';
import { dropZone } from '../core/dropzone.js';
import { icon, select, toast, withLoading } from '../core/ui.js';
import { logger } from '../logger.js';
import { go } from '../core/router.js';

export function bulkPanel() {
  const box = h('div');
  let entries = [];

  async function onFiles(files) {
    try {
      const list = await withLoading('Đang đọc các tệp…', async () => {
        const out = [];
        for (const f of files) out.push({ fileName: f.name, sheets: /\.csv$/i.test(f.name) ? [{ name: 'CSV', rows: parseCsv(await readText(f)) }] : (await readXlsx(await readBuffer(f))).filter((s) => s.rows.length) });
        return out;
      });
      entries = parsePortalFiles(list, state.companyTax);
      draw();
    } catch (e) { toast(`Không đọc được tệp: ${e.message}. Chỉ hỗ trợ .xlsx và .csv.`, 'bad'); }
  }

  function draw() {
    clear(box);
    if (!entries.length) return;
    const good = entries.filter((e) => e.ok && e.count);
    const total = good.reduce((a, e) => a + e.count, 0);
    const rows = entries.map((e) => {
      const dir = e.ok ? select([['in', 'Đầu vào (mua vào)'], ['out', 'Đầu ra (bán ra)']], e.direction, { onchange: (ev) => { refresh(e, state.companyTax, ev.target.value); draw(); } }) : null;
      return h('tr', h('td', { style: { whiteSpace: 'normal', minWidth: '180px' } }, e.fileName, e.sheet !== 'sheet 1' && e.sheet !== 'Sheet1' ? h('span.muted', ` — ${e.sheet}`) : null),
        h('td', e.ok ? dir : h('span.badge.tone-bad', 'Không đọc được')),
        h('td.r', e.ok ? fmtInt(e.count) : ''), h('td', e.ok && e.from ? `${fmtDate(e.from)} → ${fmtDate(e.to)}` : ''),
        h('td', { style: { whiteSpace: 'normal' } }, e.ok ? (e.sure ? h('span.badge.tone-ok', 'Chiều tự nhận theo MST') : h('span.badge.tone-warn', 'Không so được MST — hãy kiểm tra chiều')) : e.reason));
    });
    const btn = h('button.btn.primary', { type: 'button', disabled: !total, onclick: doImport }, icon('save', 16), h('span', `Nhập ${fmtInt(total)} hóa đơn vào máy`));
    box.append(h('div', { style: { display: 'grid', gap: '10px', marginTop: '14px' } },
      h('div.table-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Tệp'), h('th', 'Chiều'), h('th.r', 'Số hóa đơn'), h('th', 'Kỳ'), h('th', 'Ghi chú'))), h('tbody', rows))),
      h('div.row-gap', { style: { flexWrap: 'wrap' } }, btn, h('span.hint', 'Nhập lại cùng hóa đơn chỉ cập nhật, không tạo bản trùng. Hóa đơn hủy / bị thay thế được nhận đúng trạng thái.'))));
  }

  async function doImport() {
    const all = entries.filter((e) => e.ok).flatMap((e) => invoicesOf(e, state.companyTax, e.direction));
    if (!all.length) return;
    try {
      const r = await withLoading('Đang lưu hóa đơn…', () => saveInvoices(all));
      const inn = all.filter((i) => i.direction === 'in').length;
      toast(`Đã nhập ${fmtInt(all.length)} hóa đơn (mua vào ${fmtInt(inn)}, bán ra ${fmtInt(all.length - inn)}; mới ${fmtInt(r.added)}, cập nhật ${fmtInt(r.updated)}).`, 'ok', { action: { label: 'Đối chiếu', onClick: () => go('reconcile') } });
      await logger.info('import', `Nhập ${entries.length} tệp Excel từ cổng Thuế: ${all.length} hóa đơn`, { files: entries.length, added: r.added, updated: r.updated });
      entries = []; draw();
    } catch (e) { toast(e.message, 'bad'); }
  }

  return h('section.panel', h('div.panel-head', h('div', h('h2', 'Nhập nhiều tệp Excel tải từ cổng Thuế'), h('p', 'Trên trang cổng Thuế xuất Excel mua vào, bán ra (và máy tính tiền nếu có), rồi kéo TẤT CẢ các tệp vào đây một lượt'))),
    dropZone({ title: 'Kéo nhiều tệp .xlsx vào đây hoặc bấm để chọn', hint: 'Tự nhận mua vào / bán ra theo mã số thuế doanh nghiệp, tự hiện kỳ và số hóa đơn từng tệp', accept: '.xlsx,.csv', multiple: true, onFiles }), box);
}
