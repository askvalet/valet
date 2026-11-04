// Valet's service worker, kept small on purpose. It caches one thing: a page that says Valet can't be reached. The page
// itself, its data and anything behind sign-in always come from the server, so an update shows on the next load, a
// signed-out visitor never sees what the last person saw, and nothing private is left on the device.
// Its other job is push: show what the server sent, and open Valet where the notification points.
// VERSION is the build's: a new build is a new worker, which takes over at once.
const VERSION = '__VERSION__', CACHE = `valet-${VERSION}`, OFFLINE = '/offline.html';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll([OFFLINE])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('valet-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Only page loads, and only when the server can't answer them: no network, or a proxy saying Valet is down.
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).then(r => [502, 503, 504].includes(r.status) ? offline(r) : r, () => offline()));
});
const offline = fallback => caches.match(OFFLINE, { cacheName: CACHE }).then(r => r ?? fallback ?? Response.error());

self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Valet', {
    body: m.body, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png',
    data: { url: typeof m.url === 'string' && m.url.startsWith('/') && !m.url.startsWith('//') ? m.url : '/' },
    requireInteraction: !!m.urgent,
  }));
});

// An open Valet goes to the place; otherwise a new one opens there.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url ?? '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    const open = list.find(c => new URL(c.url).origin === self.location.origin);
    if (!open) return self.clients.openWindow(url);
    await open.focus();
    return open.url === url ? open : open.navigate(url).catch(() => open.postMessage({ type: 'valet-go', url }));
  }));
});

// The browser renewed its subscription: tell Valet, which swaps the old one for it (with the same sign-in the page has).
self.addEventListener('pushsubscriptionchange', e => {
  const old = e.oldSubscription;
  e.waitUntil((e.newSubscription ? Promise.resolve(e.newSubscription) : self.registration.pushManager.subscribe(old.options))
    .then(sub => fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub, replaces: old?.endpoint, hello: false }) })));
});
