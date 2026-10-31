"use strict";
/* Patchwork offline: the app's own files are kept in this browser so it opens without a connection, and it can be
   installed as an app (manifest.webmanifest). Network first: online, every file still comes fresh from the server (so
   updates are never held back); offline, the kept copy is used. Only this site's own GET requests are handled; the
   classroom relay, YouTube and pictures from the web go straight to the network as before. Nothing is sent anywhere.
   When a file is added to the app, add it to FILES too. */
const CACHE='patchwork-v1';
const FILES=['./','index.html','manifest.webmanifest','css/patchwork.css',
  'js/vendor/purify.min.js','js/vendor/dexie.min.js','js/vendor/pdfjs/pdf.min.mjs','js/vendor/pdfjs/pdf.worker.min.mjs',
  'js/editor.js','js/app.js','js/images.js','js/pics.js','js/youtube.js','js/patches.js','js/pagelist.js','js/highlights.js','js/marker.js','js/explorer.js',
  'js/timeline.js','js/handwriting-core.js','js/handwriting.js','js/backup.js','js/about.js','js/classroom.js','js/ai-board.js','js/menu.js',
  'fonts/PatchworkSans-Regular.woff2','fonts/PatchworkSans-Bold.woff2','icons/icon.svg','icons/icon-192.png','icons/icon-512.png'];
// keep a copy of each file (one missing file never stops the rest)
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>Promise.all(FILES.map(f=>c.add(f).catch(()=>{})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;
  const nav=r.mode==='navigate',key=nav?'index.html':r;   // every page of the app (pop-ups, patches: index.html?mini=1...) is index.html
  e.respondWith(fetch(r).then(res=>{if(res.ok&&res.type==='basic'){const cp=res.clone();caches.open(CACHE).then(c=>c.put(key,cp)).catch(()=>{});}return res;})
    .catch(()=>caches.match(key,{ignoreSearch:true}).then(m=>m||Response.error())));});
