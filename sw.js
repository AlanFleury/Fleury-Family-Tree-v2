// Fleury Family Tree v2: cache the application shell for offline browsing.
// Private family records stay in IndexedDB; they are never placed in CacheStorage.
const CACHE='fleury-family-shell-v5';
const BASE=new URL('./',self.location.href);
const SHELL=['./','./index.html','./config.js','./archive-api.js','./manifest.webmanifest','./icon-192.svg','./icon-512.svg','./fleury-crest.svg','./fleury-parchment.svg'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  for(const path of SHELL){try{await cache.add(new Request(new URL(path,BASE),{cache:'reload'}))}catch(e){}}
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('fleury-family-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin===self.location.origin){
    if(url.pathname.includes('/api/'))return;
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      try{
        const response=await fetch(request);
        if(response.ok&&request.url.startsWith(BASE.href))cache.put(request,response.clone()).catch(()=>{});
        return response;
      }catch(e){
        const cached=await cache.match(request)||await cache.match(new URL('./index.html',BASE).href);
        if(cached)return cached;
        throw e;
      }
    })());
    return;
  }
  // Cache the two read-only script CDNs after a successful online visit.
  if(url.hostname==='cdn.auth0.com'||url.hostname==='cdn.sheetjs.com'){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const cached=await cache.match(request);
      if(cached)return cached;
      const response=await fetch(request);
      if(response.ok||response.type==='opaque')cache.put(request,response.clone()).catch(()=>{});
      return response;
    })());
  }
});
