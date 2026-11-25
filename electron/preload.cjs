/**
 * preload.cjs — Cầu nối an toàn giữa giao diện và tiến trình chính của Electron.
 * Chỉ mở đúng 5 hàm; giao diện không truy cập được Node.js hay hệ thống tệp trực tiếp.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('etaxDesktop', {
  pickFolder: () => ipcRenderer.invoke('etax:pickFolder'),
  clearFolder: () => ipcRenderer.invoke('etax:clearFolder'),
  saveFile: (o) => ipcRenderer.invoke('etax:saveFile', o),
  request: (o) => ipcRenderer.invoke('etax:request', o),
  printPdf: (o) => ipcRenderer.invoke('etax:printPdf', o),
});
