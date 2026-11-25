/**
 * sw.js — Service worker cho PWA: chạy được khi mất mạng sau lần mở đầu tiên.
 *  - Tệp của ứng dụng (cùng nguồn, GET): ưu tiên tải từ máy chủ cục bộ (luôn thấy bản mới), chỉ dùng cache khi không tải được.
 *  - Lời gọi cổng Thuế (/gdt/…) và cầu nối tiện ích (/__bridge/…): KHÔNG bao giờ cache (dữ liệu nhạy cảm, trạng thái thời gian thực).
 * Khi phát hành bản mới, tăng CACHE để xóa cache cũ.
 */
const CACHE = 'etax-manager-v15';
const CORE = ['./', './index.html', './manifest.json', './css/theme.css', './css/style.css', './css/views.css', './assets/icon.svg', './js/app.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Không cache các đường dẫn động: cổng Thuế (/gdt/) và cầu nối tiện ích (/__bridge/) — bản cache cũ làm trạng thái đồng bộ bị "đứng".
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/gdt/') || url.pathname.startsWith('/__bridge/')) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      throw err;
    }
  }));
});
