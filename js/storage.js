/**
 * storage.js — Lớp lưu trữ IndexedDB theo Repository Pattern.
 *
 *   Database            : mở kết nối, tạo schema, chạy giao dịch.
 *   Repository (base)   : CRUD chung cho một object store.
 *   InvoiceRepository   : hóa đơn (upsert có hợp nhất, xóa theo doanh nghiệp…).
 *   LogRepository       : nhật ký thao tác (tự cắt bớt khi quá dài).
 *   SettingsRepository  : cài đặt người dùng (key/value + giá trị mặc định).
 *   FileRepository      : XML/PDF đính kèm hóa đơn.
 *
 * Singleton `repos` được dùng khắp ứng dụng. Mô tả schema chi tiết: /database/schema.md
 */
import { APP, DEFAULT_SETTINGS } from './config.js';

/** Schema: tên store → { keyPath, autoIncrement, indexes: [[tên, keyPath, options]] } */
export const SCHEMA = Object.freeze({
  invoices: { keyPath: 'key', indexes: [['companyTax', 'companyTax'], ['direction', 'direction'], ['date', 'date'], ['syncedAt', 'syncedAt']] },
  companies: { keyPath: 'tax' },
  accounts: { keyPath: 'id' },
  partnerNotes: { keyPath: 'key' },
  files: { keyPath: 'key', indexes: [['invoiceKey', 'invoiceKey'], ['kind', 'kind'], ['companyTax', 'companyTax']] },
  logs: { keyPath: 'id', autoIncrement: true, indexes: [['ts', 'ts'], ['type', 'type'], ['companyTax', 'companyTax']] },
  settings: { keyPath: 'key' },
  syncState: { keyPath: 'key' },
});

/** Bọc IDBRequest thành Promise. */
export const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export class Database {
  constructor(name = APP.dbName, version = APP.dbVersion, schema = SCHEMA) {
    this.name = name;
    this.version = version;
    this.schema = schema;
    this._db = null;
    this._opening = null;
  }

  /** Mở (hoặc tái sử dụng) kết nối. */
  open() {
    if (this._db) return Promise.resolve(this._db);
    if (this._opening) return this._opening;
    this._opening = new Promise((resolve, reject) => {
      const r = indexedDB.open(this.name, this.version);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const [store, def] of Object.entries(this.schema)) {
          const os = db.objectStoreNames.contains(store)
            ? r.transaction.objectStore(store)
            : db.createObjectStore(store, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement });
          for (const [iname, ikey, opts] of def.indexes || []) {
            if (!os.indexNames.contains(iname)) os.createIndex(iname, ikey, opts || {});
          }
        }
      };
      r.onsuccess = () => {
        this._db = r.result;
        this._db.onversionchange = () => { this._db.close(); this._db = null; };
        resolve(this._db);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('CSDL đang bị khóa bởi một tab khác. Hãy đóng các tab eTax Manager khác rồi thử lại.'));
    }).finally(() => { this._opening = null; });
    return this._opening;
  }

  /**
   * Chạy `fn(tx)` trong một giao dịch; resolve khi giao dịch hoàn tất.
   * Lưu ý: bên trong fn chỉ được await các request IndexedDB (nếu không giao dịch sẽ tự đóng).
   */
  async run(stores, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Giao dịch bị hủy'));
      Promise.resolve()
        .then(() => fn(tx))
        .then((r) => { result = r; })
        .catch((e) => { try { tx.abort(); } catch { /* đã kết thúc */ } reject(e); });
    });
  }

  /** Xóa toàn bộ CSDL (dùng khi "đặt lại"). */
  async destroy() {
    if (this._db) { this._db.close(); this._db = null; }
    await new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase(this.name);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      r.onblocked = () => resolve();
    });
  }
}

/** Repository cơ sở: CRUD cho một store. */
export class Repository {
  constructor(db, store) {
    this.db = db;
    this.store = store;
  }

  get(key) { return this.db.run(this.store, 'readonly', (tx) => req(tx.objectStore(this.store).get(key))); }
  getAll() { return this.db.run(this.store, 'readonly', (tx) => req(tx.objectStore(this.store).getAll())); }
  count() { return this.db.run(this.store, 'readonly', (tx) => req(tx.objectStore(this.store).count())); }
  put(value) { return this.db.run(this.store, 'readwrite', (tx) => req(tx.objectStore(this.store).put(value))); }
  delete(key) { return this.db.run(this.store, 'readwrite', (tx) => req(tx.objectStore(this.store).delete(key))); }
  clear() { return this.db.run(this.store, 'readwrite', (tx) => req(tx.objectStore(this.store).clear())); }

  getAllByIndex(index, value) {
    return this.db.run(this.store, 'readonly', (tx) => req(tx.objectStore(this.store).index(index).getAll(value)));
  }

  /** Ghi hàng loạt theo lô để không giữ một giao dịch quá lớn. */
  async bulkPut(list, chunkSize = 500) {
    for (let i = 0; i < list.length; i += chunkSize) {
      const part = list.slice(i, i + chunkSize);
      await this.db.run(this.store, 'readwrite', (tx) => {
        const os = tx.objectStore(this.store);
        return Promise.all(part.map((v) => req(os.put(v))));
      });
    }
    return list.length;
  }

  async bulkDelete(keys, chunkSize = 500) {
    for (let i = 0; i < keys.length; i += chunkSize) {
      const part = keys.slice(i, i + chunkSize);
      await this.db.run(this.store, 'readwrite', (tx) => {
        const os = tx.objectStore(this.store);
        return Promise.all(part.map((k) => req(os.delete(k))));
      });
    }
  }

  /** Xóa mọi bản ghi có index = value. Trả về số bản ghi đã xóa. */
  deleteByIndex(index, value) {
    return this.db.run(this.store, 'readwrite', async (tx) => {
      const os = tx.objectStore(this.store);
      const keys = await req(os.index(index).getAllKeys(value));
      await Promise.all(keys.map((k) => req(os.delete(k))));
      return keys.length;
    });
  }
}

/** Hóa đơn. Bản ghi có khóa `key` (xem normalizer.makeInvoiceKey). */
export class InvoiceRepository extends Repository {
  constructor(db) { super(db, 'invoices'); }

  listByCompany(tax) { return this.getAllByIndex('companyTax', tax); }

  /**
   * Thêm/cập nhật hàng loạt nhưng KHÔNG làm mất dữ liệu chi tiết đã có:
   * bản tóm tắt từ danh sách không được ghi đè `items`/`hasXml` nếu bản cũ đã có.
   * @returns {{added:number, updated:number}}
   */
  async upsertMany(list, chunkSize = 300) {
    let added = 0;
    let updated = 0;
    for (let i = 0; i < list.length; i += chunkSize) {
      const part = list.slice(i, i + chunkSize);
      await this.db.run('invoices', 'readwrite', async (tx) => {
        const os = tx.objectStore('invoices');
        const olds = await Promise.all(part.map((v) => req(os.get(v.key))));
        await Promise.all(part.map((v, idx) => {
          const old = olds[idx];
          if (old) {
            updated++;
            const merged = { ...old, ...v };
            if (old.items?.length && !v.items?.length) merged.items = old.items;
            if (old.taxBreakdown?.length && !v.taxBreakdown?.length) merged.taxBreakdown = old.taxBreakdown;
            merged.hasXml = old.hasXml || v.hasXml || false;
            merged.hasPdf = old.hasPdf || v.hasPdf || false;
            merged.note = old.note || v.note || '';
            merged.tags = old.tags || v.tags || [];
            return req(os.put(merged));
          }
          added++;
          return req(os.put(v));
        }));
      });
    }
    return { added, updated };
  }

  /** Xóa toàn bộ hóa đơn (và file đính kèm) của một doanh nghiệp. */
  async deleteByCompany(tax) {
    const n = await this.deleteByIndex('companyTax', tax);
    await repos.files.deleteByIndex('companyTax', tax);
    return n;
  }
}

/** Nhật ký thao tác. */
export class LogRepository extends Repository {
  constructor(db) { super(db, 'logs'); this.maxRows = 5000; }

  async add(entry) {
    const id = await this.put(entry);
    if (Math.random() < 0.02) this.trim().catch(() => {}); // thỉnh thoảng dọn bớt
    return id;
  }

  /** Lấy log mới nhất trước. */
  list({ limit = 1000, type, companyTax } = {}) {
    return this.db.run('logs', 'readonly', (tx) => new Promise((resolve, reject) => {
      const out = [];
      const r = tx.objectStore('logs').index('ts').openCursor(null, 'prev');
      r.onsuccess = () => {
        const c = r.result;
        if (!c || out.length >= limit) return resolve(out);
        const v = c.value;
        if ((!type || v.type === type) && (!companyTax || !v.companyTax || v.companyTax === companyTax)) out.push(v);
        c.continue();
      };
      r.onerror = () => reject(r.error);
    }));
  }

  async trim() {
    const total = await this.count();
    if (total <= this.maxRows) return;
    const excess = total - this.maxRows;
    await this.db.run('logs', 'readwrite', (tx) => new Promise((resolve, reject) => {
      let n = 0;
      const r = tx.objectStore('logs').index('ts').openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c || n >= excess) return resolve();
        c.delete(); n++; c.continue();
      };
      r.onerror = () => reject(r.error);
    }));
  }
}

/** Cài đặt: lưu từng cặp key/value, hợp nhất với giá trị mặc định khi đọc. */
export class SettingsRepository extends Repository {
  constructor(db) { super(db, 'settings'); }

  async all() {
    const rows = await this.getAll();
    const out = { ...DEFAULT_SETTINGS };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async getValue(key) {
    const row = await this.get(key);
    return row ? row.value : DEFAULT_SETTINGS[key];
  }

  setValue(key, value) { return this.put({ key, value }); }

  async setMany(obj) { await this.bulkPut(Object.entries(obj).map(([key, value]) => ({ key, value }))); }
}

/** File đính kèm (XML text / PDF blob). key = `${invoiceKey}#${kind}` */
export class FileRepository extends Repository {
  constructor(db) { super(db, 'files'); }

  static makeKey(invoiceKey, kind) { return `${invoiceKey}#${kind}`; }

  async attach({ invoiceKey, companyTax, kind, name, data, mime }) {
    const size = typeof data === 'string' ? new Blob([data]).size : data.size;
    await this.put({ key: FileRepository.makeKey(invoiceKey, kind), invoiceKey, companyTax, kind, name, mime, size, data, createdAt: Date.now() });
  }

  find(invoiceKey, kind) { return this.get(FileRepository.makeKey(invoiceKey, kind)); }
  listByKind(kind) { return this.getAllByIndex('kind', kind); }
}

/** Trạng thái đồng bộ theo (doanh nghiệp, chiều hóa đơn). */
export class SyncStateRepository extends Repository {
  constructor(db) { super(db, 'syncState'); }
  static makeKey(tax, direction) { return `${tax}|${direction}`; }
  forCompany(tax) { return Promise.all(['in', 'out'].map((d) => this.get(SyncStateRepository.makeKey(tax, d)))); }
}

// ---------------------------------------------------------------- Singleton

export const database = new Database();

export const repos = {
  invoices: new InvoiceRepository(database),
  companies: new Repository(database, 'companies'),
  accounts: new Repository(database, 'accounts'),
  partnerNotes: new Repository(database, 'partnerNotes'),
  files: new FileRepository(database),
  logs: new LogRepository(database),
  settings: new SettingsRepository(database),
  syncState: new SyncStateRepository(database),
};

/** Dung lượng ước tính đang dùng (nếu trình duyệt hỗ trợ). */
export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}
