// GitHub Pages cache cleanup worker.
// It clears old Fleury archive caches once, then unregisters itself.
// It does not intercept or rewrite application requests.
const CLEANUP='fleury-archive-cleanup-v6';
self.addEventListener('install',event=>event.waitUntil(caches.open(CLEANUP).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CLEANUP).map(k=>caches.delete(k))))
    .then(()=>self.registration.unregister())
    .then(()=>self.clients.matchAll({type:'window'}))
    .then(clients=>clients.forEach(c=>c.navigate(c.url)))
));
