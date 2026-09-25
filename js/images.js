"use strict";
/* ===== image store: pictures live once, as Blobs, in IndexedDB (never uploaded) =====
   Page HTML refers to them as pw-img:<hash>. Identical images are stored once, so history snapshots stay tiny. */
const IMG_URLS=new Map();          // hash -> object URL
const IMG_PENDING=new Set();
const BLANK_GIF='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
function _cyrb53(str,seed){let h1=0xdeadbeef^seed,h2=0x41c6ce57^seed;for(let i=0,ch;i<str.length;i++){ch=str.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return (4294967296*(2097151&h2)+(h1>>>0)).toString(16).padStart(14,'0');}
function contentHash(str){return _cyrb53(str,1)+_cyrb53(str,7)+str.length.toString(36);}
function imgHashOf(src){const m=/^pw-img:([0-9a-z]+)$/.exec(src||'');return m?m[1]:null;}
function resolveImg(src){const h=imgHashOf(src);if(!h)return src;const u=IMG_URLS.get(h);if(u)return u;loadImages([h]).then(()=>{if(editor)editor.refresh();});return BLANK_GIF;}
async function loadImages(hashes){const need=hashes.filter(h=>!IMG_URLS.has(h)&&!IMG_PENDING.has(h));if(!need.length)return;need.forEach(h=>IMG_PENDING.add(h));try{const rows=await db.images.bulkGet(need);rows.forEach((r,i)=>{if(r&&r.blob)IMG_URLS.set(need[i],URL.createObjectURL(r.blob));});}catch(e){console.error(e);}finally{need.forEach(h=>IMG_PENDING.delete(h));}}
function imageRefsIn(str){const out=new Set();String(str||'').replace(/pw-img:([0-9a-z]+)/g,(_,h)=>{out.add(h);return _;});return [...out];}
async function storeDataURL(url){const h=contentHash(url);if(!IMG_URLS.has(h)){const blob=await (await fetch(url)).blob();if(!(await db.images.get(h)))await db.images.put({h,blob,type:blob.type,size:blob.size,created:Date.now()});IMG_URLS.set(h,URL.createObjectURL(blob));}return 'pw-img:'+h;}
let _interning=null;
// Move every inline data: image in the live page into the store (also migrates pages saved before v4).
async function internImages(){if(!editor)return 0;if(_interning)return _interning;_interning=(async()=>{const found=[];editor.mapImageSrc(src=>{if(/^data:image\//i.test(src))found.push(src);return null;});if(!found.length)return 0;const map={};for(const u of found){try{map[u]=await storeDataURL(u);}catch(e){_quotaToast(e);}}editor.mapImageSrc(src=>map[src]||null);return found.length;})();try{return await _interning;}finally{_interning=null;}}
function _blobToDataURL(b){return new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(b);});}
// Backups stay self-contained: swap pw-img refs back to data: URLs.

async function inlineImagesForExport(html){const hs=imageRefsIn(html);if(!hs.length)return html;const rows=await db.images.bulkGet(hs);const map={};for(let i=0;i<hs.length;i++)if(rows[i]&&rows[i].blob)map[hs[i]]=await _blobToDataURL(rows[i].blob);return String(html).replace(/pw-img:([0-9a-z]+)/g,(m,h)=>map[h]||m);}
