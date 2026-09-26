const CACHE="tennis-edge-v3-0-sportscore-8";
const ASSETS=["./","./index.html","./styles.css","./app.js","./decider.js","./sportscore.js","./decider-app.js","./odds-auto.js","./manifest.webmanifest","./icon-192.svg","./icon-512.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const u=new URL(e.request.url);
  if(u.hostname.includes("livetennisapi.com")||u.hostname.includes("raw.githubusercontent.com")){e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));return}
  const shell=u.origin===self.location.origin && (u.pathname.endsWith("/") || /\.(?:html|js|css|webmanifest)$/.test(u.pathname));
  if(shell){e.respondWith(fetch(e.request).then(resp=>{if(resp.ok){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return resp}).catch(()=>caches.match(e.request)));return}
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp})));
});
