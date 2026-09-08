const CACHE="tennis-edge-v2-2-autofill";
const ASSETS=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icon-192.svg","./icon-512.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  const u=new URL(e.request.url);
  if(u.hostname.includes("livetennisapi.com")||u.hostname.includes("raw.githubusercontent.com")){e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));return}
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp})));
});
