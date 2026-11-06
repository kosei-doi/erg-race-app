// エルゴレースの service worker。アプリのファイルを全部キャッシュして、オフラインで起動できるようにする。
// 版を上げる(VERSION を変える)と、新しいキャッシュに入れ替わり、古いキャッシュは消える。
const VERSION = 'v3';
const CACHE = `erg-race-${VERSION}`;
// bgm/race.mp3 は入れない(ライセンス上、公開版に置かない。ローカルでは sw を登録しないので普通に読める)
const FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'src/audio.js', 'src/boat-view.js', 'src/main.js', 'src/pm5-ble.js', 'src/pm5-parse.js',
  'src/race.js', 'src/sim.js', 'src/store.js', 'src/stroke.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('erg-race-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// キャッシュ優先(クエリ ?mode=auto などは無視して同じファイルを返す)。なければネットワーク。
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      try { return await fetch(e.request); }
      catch (err) {
        if (e.request.mode === 'navigate') { const idx = await c.match('index.html'); if (idx) return idx; }
        throw err;
      }
    }),
  );
});
