/**
 * dropzone.js — Vùng kéo-thả tệp (kèm bấm để chọn tệp) dùng cho các trang XML, PDF, Excel.
 */
import { h, pickFiles } from '../utils.js';
import { icon } from './ui.js';

/**
 * @param {{title:string, hint?:string, accept?:string, multiple?:boolean, onFiles:(files:File[])=>void}} o
 */
export function dropZone({ title, hint, accept = '', multiple = true, onFiles }) {
  const exts = accept.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.startsWith('.'));
  const ok = (f) => !exts.length || exts.some((e) => f.name.toLowerCase().endsWith(e));
  const pick = async () => { const files = await pickFiles({ accept, multiple }); if (files.length) onFiles(files); };
  const el = h('div.drop-zone', { tabindex: 0, role: 'button', 'aria-label': title, onclick: pick, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } } },
    icon('upload', 28), h('div', h('b', title)), hint && h('div', hint));
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('over');
    const files = [...(e.dataTransfer?.files || [])].filter(ok);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  });
  return el;
}
