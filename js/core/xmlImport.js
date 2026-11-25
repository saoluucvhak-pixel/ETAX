/**
 * xmlImport.js — Nhận XML hóa đơn do TIỆN ÍCH gửi về (chế độ cầu nối).
 *
 * Khác với trang "XML" (nhập tay): hóa đơn đã có từ danh sách cổng Thuế (kèm trạng thái, mã cấp...) nên ở đây chỉ BỔ SUNG
 * chi tiết hàng hóa/thuế suất và tệp XML gốc, KHÔNG ghi đè trạng thái (ví dụ hóa đơn đã hủy) bằng giá trị mặc định của XML.
 * Nếu XML đến trước danh sách thì lưu nguyên bản từ XML.
 */
import { repos } from '../storage.js';
import { parseInvoiceXml } from './xmlparser.js';
import { fromParsedXml } from './normalizer.js';

/**
 * @param {{name?:string, xml:string}[]} files
 * @returns {Promise<{saved:number, problems:string[]}>}
 */
export async function saveBridgeXml(files, { companyTax, direction }) {
  const batch = []; const problems = [];
  for (const f of files || []) {
    const text = String(f.xml || '');
    const p = parseInvoiceXml(text);
    if (!p.invoice || p.errors.length) { problems.push(`XML ${f.name || '?'}: ${p.errors[0] || 'không đọc được'}`); continue; }
    const inv = fromParsedXml(p.invoice, { companyTax, direction });
    const old = await repos.invoices.get(inv.key);
    batch.push(old
      ? { ...old, items: inv.items?.length ? inv.items : old.items, taxBreakdown: inv.taxBreakdown?.length ? inv.taxBreakdown : old.taxBreakdown, paymentMethod: old.paymentMethod || inv.paymentMethod || '', hasXml: true }
      : { ...inv, hasXml: true });
    await repos.files.attach({ invoiceKey: inv.key, companyTax, kind: 'xml', name: f.name || `${inv.series}_${inv.number}.xml`, data: text, mime: 'application/xml' });
  }
  if (batch.length) await repos.invoices.upsertMany(batch);
  return { saved: batch.length, problems };
}
