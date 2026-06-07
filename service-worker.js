// My Life Dashboard — Service Worker
// 改版時把 v 數字 +1，使用者下次連線就會更新快取
const CACHE = 'life-dashboard-v1';

// App 本體（離線也要能開）
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2',
  'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'
];

// 安裝：逐一預快取（單一失敗不影響其他）
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
  );
});

// 啟用：清掉舊版本快取
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // 寫入(POST)不攔截，直接走網路

  const url = new URL(req.url);
  const isAPI = url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com');
  const isNav = req.mode === 'navigate';

  if (isAPI || isNav) {
    // network-first：線上拿最新並更新快取；離線退回上次快取
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || (isNav ? caches.match('./index.html') : Response.error())))
    );
  } else {
    // 靜態資源 cache-first
    e.respondWith(
      caches.match(req).then(r => r || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
  }
});
