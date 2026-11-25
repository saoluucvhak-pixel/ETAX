/**
 * companies.js — Quản lý nhiều doanh nghiệp và nhiều tài khoản.
 *
 *  - Doanh nghiệp (store `companies`, khóa = MST): mỗi MST có dữ liệu hóa đơn riêng.
 *  - Tài khoản (store `accounts`): chỉ nhớ TÊN ĐĂNG NHẬP để điền nhanh. Mật khẩu KHÔNG bao giờ được lưu.
 */
import { repos } from '../storage.js';
import { state, setCompany } from './state.js';
import { saveSettings } from './settings.js';
import { clearCompanyData } from './invoiceStore.js';
import { uid } from '../utils.js';

export async function listCompanies() {
  const rows = await repos.companies.getAll();
  return rows.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
}

/** Thêm mới hoặc cập nhật tên doanh nghiệp theo MST. */
export async function upsertCompany({ tax, name = '' }) {
  const old = await repos.companies.get(tax);
  const row = { tax, name: name || old?.name || '', createdAt: old?.createdAt || Date.now(), lastUsedAt: Date.now() };
  await repos.companies.put(row);
  return row;
}

/** Chọn doanh nghiệp đang làm việc và nhớ cho lần mở sau. */
export async function activateCompany(tax) {
  if (!tax) return;
  const old = await repos.companies.get(tax);
  if (old) await repos.companies.put({ ...old, lastUsedAt: Date.now() });
  setCompany(tax);
  await saveSettings({ lastCompany: tax });
}

/** Xóa doanh nghiệp cùng toàn bộ hóa đơn/đính kèm của nó. */
export async function removeCompany(tax) {
  await clearCompanyData(tax);
  await repos.companies.delete(tax);
  if (state.companyTax === tax) {
    const rest = await listCompanies();
    if (rest[0]) await activateCompany(rest[0].tax); else setCompany('');
  }
}

export const listAccounts = async () => (await repos.accounts.getAll()).sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0));

/** Nhớ tên đăng nhập (không lưu mật khẩu). */
export async function rememberAccount({ username, taxCode = '', companyName = '', mode = 'gdt' }) {
  const all = await repos.accounts.getAll();
  const old = all.find((a) => a.username === username && a.mode === mode);
  const row = { id: old?.id || uid(), username, taxCode, companyName, mode, lastLoginAt: Date.now() };
  await repos.accounts.put(row);
  return row;
}

export const removeAccount = (id) => repos.accounts.delete(id);
