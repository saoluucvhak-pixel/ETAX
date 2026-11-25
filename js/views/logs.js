/**
 * logs.js — Trang "Nhật ký": đăng nhập, đồng bộ, tìm kiếm, xuất/nhập, sao lưu và lỗi kèm thời gian thực hiện.
 * Cập nhật trực tiếp khi có dòng nhật ký mới.
 */
import { h, clear, fmtDateTime, debounce, normalizeText, toCsv, fmtInt } from '../utils.js';
import { repos } from '../storage.js';
import { state } from '../core/state.js';
import { logger, LOG_TYPES } from '../logger.js';
import { icon, select, menuButton, confirmDialog, toast } from '../core/ui.js';
import { deliverBlob } from '../export.js';

const LEVELS = [['', 'Mọi mức'], ['info', 'Thông tin'], ['warn', 'Cảnh báo'], ['error', 'Lỗi']];
const LEVEL_TEXT = { info: '', warn: 'Cảnh báo', error: 'Lỗi' };
const LIMIT = 1000;

export async function mount(host) {
  let rows = [];
  let onlyCompany = false;
  const type = select([['', 'Mọi loại'], ...Object.entries(LOG_TYPES)], '');
  const level = select(LEVELS, '');
  const search = h('input', { type: 'search', placeholder: 'Tìm trong nhật ký…' });
  const scope = h('input', { type: 'checkbox' });
  const listEl = h('div.log-list');
  const count = h('span.muted');

  const visible = () => {
    const needle = normalizeText(search.value);
    return rows.filter((r) => (!type.value || r.type === type.value) && (!level.value || r.level === level.value)
      && (!onlyCompany || !r.companyTax || r.companyTax === state.companyTax)
      && (!needle || normalizeText(`${r.message} ${JSON.stringify(r.meta || {})}`).includes(needle)));
  };

  function meta(r) {
    const parts = Object.entries(r.meta || {}).filter(([, v]) => v !== '' && v != null && typeof v !== 'object').slice(0, 6).map(([k, v]) => `${k}: ${v}`);
    return parts.join(' — ');
  }

  function draw() {
    const list = visible();
    count.textContent = `${fmtInt(list.length)} / ${fmtInt(rows.length)} dòng`;
    clear(listEl);
    if (!list.length) return listEl.append(h('div.empty', h('h3', 'Chưa có dòng nhật ký phù hợp')));
    const frag = document.createDocumentFragment();
    for (const r of list.slice(0, 500)) {
      frag.append(h(`div.log-row.lv-${r.level}`, h('div.ts', fmtDateTime(r.ts)), h('div', h(`span.badge.tone-${r.level === 'error' ? 'bad' : r.level === 'warn' ? 'warn' : 'muted'}`, LOG_TYPES[r.type] || r.type)),
        h('div.msg', `${LEVEL_TEXT[r.level] ? `${LEVEL_TEXT[r.level]}: ` : ''}${r.message}`, meta(r) && h('small', meta(r))), h('div.dur', r.durationMs != null ? `${(r.durationMs / 1000).toFixed(2)}s` : '')));
    }
    listEl.append(frag);
    if (list.length > 500) listEl.append(h('div.muted', { style: { padding: '10px 14px' } }, `Đang hiện 500 dòng mới nhất trong ${fmtInt(list.length)} dòng phù hợp. Thu hẹp bộ lọc để xem thêm.`));
  }

  async function load() { rows = await repos.logs.list({ limit: LIMIT }); draw(); }

  const exportFile = async (kind) => {
    const list = visible();
    if (!list.length) return toast('Không có dòng nhật ký để xuất.', 'warn');
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    if (kind === 'csv') {
      const csv = toCsv([{ header: 'Thời gian', value: (r) => fmtDateTime(r.ts) }, { header: 'Mức', key: 'level' }, { header: 'Loại', value: (r) => LOG_TYPES[r.type] || r.type }, { header: 'Nội dung', key: 'message' }, { header: 'Chi tiết', value: meta }, { header: 'MST', key: 'companyTax' }, { header: 'Thời gian chạy (ms)', key: 'durationMs' }], list);
      await deliverBlob(`NhatKy_${stamp}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'Nhật ký CSV', { rows: list.length });
    } else await deliverBlob(`NhatKy_${stamp}.json`, new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }), 'Nhật ký JSON', { rows: list.length });
  };

  const clearAll = async () => {
    if (!(await confirmDialog({ title: 'Xóa toàn bộ nhật ký?', message: 'Chỉ xóa lịch sử thao tác, không ảnh hưởng dữ liệu hóa đơn.', confirmLabel: 'Xóa nhật ký', danger: true }))) return;
    await repos.logs.clear();
    rows = [];
    draw();
    toast('Đã xóa nhật ký.', 'ok');
  };

  [type, level].forEach((el) => el.addEventListener('change', draw));
  search.addEventListener('input', debounce(draw, 150));
  scope.addEventListener('change', () => { onlyCompany = scope.checked; draw(); });

  host.append(
    h('div.toolbar', search, type, level, h('label.check', scope, 'Chỉ doanh nghiệp đang chọn'), h('span.spacer'), count,
      h('button.btn', { type: 'button', onclick: load }, icon('refresh', 16), h('span', 'Tải lại')),
      menuButton('Xuất', [{ label: 'CSV', icon: 'file', onClick: () => exportFile('csv') }, { label: 'JSON', icon: 'code', onClick: () => exportFile('json') }]),
      h('button.btn.danger', { type: 'button', onclick: clearAll }, icon('trash', 16), h('span', 'Xóa nhật ký'))),
    h('section.panel.flush', listEl));
  await load();
  const off = logger.subscribe((entry) => { rows.unshift(entry); if (rows.length > LIMIT) rows.pop(); draw(); });
  return off;
}
