/**
 * main.cjs — Tiến trình chính Electron.
 *  - Phục vụ giao diện qua giao thức app:// (ổn định hơn file:// với ES module, IndexedDB).
 *  - Gọi cổng Thuế từ tiến trình chính (không bị CORS), CHỈ tới tên miền được phép.
 *  - Lưu tệp vào "Thư mục lưu" người dùng chọn; xuất PDF thật bằng printToPDF.
 */
const { app, BrowserWindow, dialog, ipcMain, protocol, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const ALLOWED_HOSTS = new Set(['hoadondientu.gdt.gov.vn']);
const CONFIG = () => path.join(app.getPath('userData'), 'etax-config.json');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); } catch { return {}; } };
const writeConfig = (c) => fs.writeFileSync(CONFIG(), JSON.stringify(c));

/** Tên tệp an toàn: bỏ đường dẫn và ký tự cấm. */
const safeName = (n) => path.basename(String(n || 'file')).replace(/[\\/:*?"<>|]+/g, '_');

/** Chọn nơi ghi: thư mục lưu đã chọn, nếu chưa có thì hỏi hộp thoại "Lưu thành". */
async function resolveTarget(win, name) {
  const dir = readConfig().saveDir;
  if (dir && fs.existsSync(dir)) return path.join(dir, safeName(name));
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), safeName(name)) });
  return r.canceled ? null : r.filePath;
}

let ipcDone = false;
function registerIpc(getWin) {
  if (ipcDone) return;
  ipcDone = true;
  ipcMain.handle('etax:pickFolder', async () => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    writeConfig({ ...readConfig(), saveDir: r.filePaths[0] });
    return { path: r.filePaths[0] };
  });
  ipcMain.handle('etax:clearFolder', () => { const c = readConfig(); delete c.saveDir; writeConfig(c); return true; });

  ipcMain.handle('etax:saveFile', async (_e, { name, dataBase64 }) => {
    if (typeof dataBase64 !== 'string') throw new Error('Dữ liệu tệp không hợp lệ');
    const target = await resolveTarget(getWin(), name);
    if (!target) return null;
    fs.writeFileSync(target, Buffer.from(dataBase64, 'base64'));
    return { path: target };
  });

  ipcMain.handle('etax:request', async (_e, { method = 'GET', url, headers = {}, body = null, timeoutMs = 45000 }) => {
    const safeMethod = String(method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'HEAD'].includes(safeMethod)) throw new Error(`Phương thức HTTP không được phép: ${safeMethod}`);
    const u = new URL(url);
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error(`Không được phép gọi tới ${u.hostname}`);
    const safeTimeout = Math.max(1000, Math.min(120000, Number(timeoutMs) || 45000));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), safeTimeout);
    try {
      const res = await net.fetch(url, { method: safeMethod, headers, body: body ?? undefined, signal: ctrl.signal });
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: Object.fromEntries(res.headers.entries()), bodyBase64: buf.toString('base64') };
    } finally { clearTimeout(timer); }
  });

  ipcMain.handle('etax:printPdf', async (_e, { html, name, landscape }) => {
    if (typeof html !== 'string') throw new Error('Nội dung HTML không hợp lệ');
    const target = await resolveTarget(getWin(), name);
    if (!target) return null;
    const hidden = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
      await hidden.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await hidden.webContents.printToPDF({ landscape: !!landscape, printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
      fs.writeFileSync(target, pdf);
      return { path: target };
    } finally { hidden.destroy(); }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600, backgroundColor: '#edf0ec', title: 'eTax Manager',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  registerIpc(() => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]);
  // Liên kết ngoài mở bằng trình duyệt hệ thống, không mở cửa sổ mới trong ứng dụng.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL('app://etax/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname);
    const file = path.resolve(ROOT, `.${rel}`);
    if (!file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
