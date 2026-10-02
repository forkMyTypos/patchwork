"use strict";
/* ===== backup / import + about-legal (shares globals with the main script) ===== */
function _today(){return new Date().toISOString().slice(0,10);}
function _slug(s){return (s||'project').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'project';}
function _download(data,name){const blob=new Blob([JSON.stringify(data)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
// highlighted text points at its mark by id; imported marks get new ids, so rewrite the page to match
function _remapMarkIds(html,map){return String(html||'').replace(/data-mark="(\d+)"/g,(m,id)=>map[id]!=null?'data-mark="'+map[id]+'"':'');}
function _typesFor(ms){const ids=new Set(ms.map(m=>m.type));return [...HT.values()].filter(t=>ids.has(t.id));}
// imported highlight types / profiles are only ever ADDED (an id that already exists here is left alone)
async function _impHandwriting(data){if(!Array.isArray(data.handwriting))return;for(const r of data.handwriting)if(r&&r.ch&&Array.isArray(r.strokes))await db.hw.add({lang:r.lang||'en',ch:String(r.ch).slice(0,4),strokes:r.strokes,frame:r.frame||null,src:r.src||'import',created:r.created||Date.now()});if(typeof HWS!=='undefined')HWS.dict=null;}
async function _impTypes(data){for(const t of (data.htypes||[]))if(t&&t.id&&!HT.has(t.id)){HT.set(t.id,t);await db.htypes.put(t);}for(const p of (data.profiles||[]))if(p&&p.id&&!PROFILES.some(x=>x.id===p.id)){PROFILES.push(p);await db.profiles.put(p);}if(typeof typesChanged==='function')typesChanged();}
function _mexp(m){return{oid:m.id,type:m.type,fields:m.fields||{},hover:m.hover||'',name:m.name||'',tags:m.tags||[],created:m.created,done:!!m.done,doneAt:m.doneAt||null,links:m.links||[],anchor:m.anchor||{kind:'time',yn:0},snippet:m.snippet||''};}
function _sexp(s){const o={t:s.t,tool:s.tool,color:s.color,pts:s.pts,minYn:s.minYn,maxYn:s.maxYn};if(s.u)o.u=1;if(s.a&&typeof s.a.p==='string')o.a={p:s.a.p,top:+s.a.top||0};return o;}
function _simp(s){const o={t:s.t,tool:s.tool,color:s.color,pts:s.pts,minYn:s.minYn,maxYn:s.maxYn};if(s.u===1)o.u=1;if(s.a&&typeof s.a.p==='string'&&/^[a-z0-9]{4,24}$/.test(s.a.p)&&isFinite(s.a.top))o.a={p:s.a.p,top:+s.a.top};return o;}
// one project as a backup object (also what a student hands in as a page)
async function projectExport(id){if(id===pid)await savePageNow();
  const pg=(await db.pages.get(id))||{};
  return{app:'patchwork',type:'patchwork-backup',version:1,scope:'project',exportedAt:new Date().toISOString(),
    project:{name:projName(id)},page:{html:await inlineImagesForExport(pg.html||''),scrollYn:pg.scrollYn||0,gutterW:pg.gutterW||0,ww:cleanWW(pg.ww)||undefined},
    marks:marks.filter(m=>m.pid===id).map(_mexp),htypes:_typesFor(marks.filter(m=>m.pid===id)),strokes:(await db.strokes.where('pid').equals(id).toArray()).filter(s=>!s.del).map(_sexp)};}
async function backupProject(){
  const data=await projectExport(pid);
  _download(data,'patchwork-'+_slug(projName(pid))+'-'+_today()+'.json');
  toast('Backed up this project: \u201c'+projName(pid)+'\u201d','ok');db.info.update('info',{lastBackupAt:Date.now()}).then(()=>{if(typeof updateBkStatus==='function')updateBkStatus();}).catch(()=>{});
}
async function backupAll(){
  await savePageNow();
  const pgs=await db.pages.toArray();const allS=(await db.strokes.toArray()).filter(s=>!s.del);
  const data={app:'patchwork',type:'patchwork-backup',version:1,scope:'all',exportedAt:new Date().toISOString(),
    projects:projects.map(p=>({oid:p.id,name:p.name,created:p.created,folder:p.folder||null})),folders:folders.map(f=>({oid:f.id,name:f.name,parent:f.parent||null})),
    pages:await Promise.all(pgs.map(async pg=>({poid:pg.pid,html:await inlineImagesForExport(pg.html||''),scrollYn:pg.scrollYn||0,gutterW:pg.gutterW||0,ww:cleanWW(pg.ww)||undefined}))),
    marks:marks.map(m=>{const oo=_mexp(m);oo.poid=m.pid;return oo;}),
    strokes:allS.map(s=>{const oo=_sexp(s);oo.poid=s.pid;return oo;}),
    colors:{favorites:COLOR_FAVORITES,recents:COLOR_RECENTS},htypes:[...HT.values()],profiles:PROFILES,handwriting:(await db.hw.toArray()).map(({id,...r})=>r)};
  _download(data,'patchwork-all-'+_today()+'.json');
  toast('Backed up everything ('+projects.length+' project'+(projects.length!==1?'s':'')+')','ok');db.info.update('info',{lastBackupAt:Date.now()}).then(()=>{if(typeof updateBkStatus==='function')updateBkStatus();}).catch(()=>{});
}
function _sani(h){try{return DOMPurify.sanitize(String(h||''));}catch(e){return '';}}
async function importFile(file,opt){
  if(/\.pdf$/i.test(file.name||'')||file.type==='application/pdf')return importPdf(file,opt);
  let data;try{data=JSON.parse(await file.text());}catch(e){toast('Not a valid backup file','err');return;}
  if(!data||data.type!=='patchwork-backup'){toast('That\u2019s not a Patchwork backup','err');return;}
  try{
    await _impTypes(data);await _impHandwriting(data);
    let goTo=null,summary='';
    if(data.scope==='all'){goTo=await _impAll(data);summary=(data.projects?data.projects.length:0)+' projects';}
    else{goTo=await _impProject(data);summary='project \u201c'+((data.project&&data.project.name)||'Imported')+'\u201d';}
    projects=await db.projects.toArray();marks=await db.marks.toArray();await loadFolders();
    if(goTo&&!(opt&&opt.noSwitch))await switchProject(goTo);
    renderProjects();updateBackupLabels();
    toast('Imported '+summary,'ok');return goTo;
  }catch(e){console.error(e);toast('Import failed: '+(e.message||'error'),'err');}
}
async function _impProject(data){
  const np=await db.projects.add({name:((data.project&&data.project.name)||'Imported').slice(0,60),created:Date.now()});
  const map={};
  for(const m of (data.marks||[])){const nid=await db.marks.add({pid:np,type:m.type||'note',name:m.name||'',tags:m.tags||[],created:m.created||Date.now(),done:!!m.done,doneAt:m.doneAt||null,links:[],anchor:m.anchor||{kind:'time',yn:0},snippet:m.snippet||'',fields:m.fields||{},hover:m.hover||''});map[m.oid]=nid;}
  for(const m of (data.marks||[]))if(m.links&&m.links.length&&map[m.oid]){const mm=m.links.map(x=>map[x]).filter(Boolean);if(mm.length)await db.marks.update(map[m.oid],{links:mm});}
  if(data.page){const h=_remapMarkIds(_sani(data.page.html),map);if(h.length<=MAX_CARD_FIELD)await db.pages.put({pid:np,html:h,scrollYn:data.page.scrollYn||0,gutterW:data.page.gutterW||0,ww:cleanWW(data.page.ww)||undefined});}
  for(const s of (data.strokes||[]))await db.strokes.add({pid:np,..._simp(s)});
  return np;
}
async function _impAll(data){
  const pmap={};
  const fmap={};for(const f of (data.folders||[]))fmap[f.oid]=await db.folders.add({name:(f.name||'Folder').slice(0,60),parent:null,created:Date.now()});for(const f of (data.folders||[]))if(f.parent!=null&&fmap[f.parent])await db.folders.update(fmap[f.oid],{parent:fmap[f.parent]});
  for(const p of (data.projects||[])){const nid=await db.projects.add({name:(p.name||'Imported').slice(0,60),created:p.created||Date.now(),folder:p.folder!=null&&fmap[p.folder]?fmap[p.folder]:null});pmap[p.oid]=nid;}
  const map={};
  for(const m of (data.marks||[])){const np=pmap[m.poid];if(np==null)continue;const nid=await db.marks.add({pid:np,type:m.type||'note',name:m.name||'',tags:m.tags||[],created:m.created||Date.now(),done:!!m.done,doneAt:m.doneAt||null,links:[],anchor:m.anchor||{kind:'time',yn:0},snippet:m.snippet||'',fields:m.fields||{},hover:m.hover||''});map[m.oid]=nid;}
  for(const m of (data.marks||[]))if(m.links&&m.links.length&&map[m.oid]){const mm=m.links.map(x=>map[x]).filter(Boolean);if(mm.length)await db.marks.update(map[m.oid],{links:mm});}
  for(const pg of (data.pages||[]))if(pmap[pg.poid]!=null){const h=_remapMarkIds(_sani(pg.html),map);if(h.length<=MAX_CARD_FIELD)await db.pages.put({pid:pmap[pg.poid],html:h,scrollYn:pg.scrollYn||0,gutterW:pg.gutterW||0,ww:cleanWW(pg.ww)||undefined});}
  for(const s of (data.strokes||[])){const np=pmap[s.poid];if(np!=null)await db.strokes.add({pid:np,..._simp(s)});}
  if(data.colors){if(Array.isArray(data.colors.favorites))COLOR_FAVORITES=Array.from(new Set([...COLOR_FAVORITES,...data.colors.favorites])).slice(0,18);if(Array.isArray(data.colors.recents))COLOR_RECENTS=(data.colors.recents||COLOR_RECENTS).slice(0,8);DB_saveColors();}
  return Object.values(pmap)[0];
}
function updateBackupLabels(){const a=document.getElementById('bk-proj');if(a)a.textContent='\u2913 this project ('+projName(pid)+')';const e=document.getElementById('bk-all');if(e)e.textContent='\u2913 everything ('+projects.length+' project'+(projects.length!==1?'s':'')+')';}
document.getElementById('proj-btn').addEventListener('click',()=>setTimeout(updateBackupLabels,0));

// A PDF becomes a new private page: each PDF page is an image you can write beside and draw on. pdf.js (js/vendor/pdfjs,
// Apache-2.0) is loaded only when a PDF is imported and runs in this browser; nothing is uploaded.
const PDF_MAX={bytes:60e6,pages:150,px:1600};
async function importPdf(file,opt){opt=opt||{};
  if(file.size>PDF_MAX.bytes){toast('That PDF is too big (60 MB max)','err');return null;}
  let lib;try{const base=new URL('js/vendor/pdfjs/',document.baseURI);lib=await import(new URL('pdf.min.mjs',base).href);lib.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.mjs',base).href;}catch(e){toast('Couldn\u2019t load the PDF reader','err');return null;}
  let pdf;try{pdf=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,enableXfa:false}).promise;}catch(e){toast(e&&e.name==='PasswordException'?'That PDF is password-protected':'Not a readable PDF','err');return null;}
  const n=Math.min(pdf.numPages,PDF_MAX.pages),paras=[];
  try{for(let i=1;i<=n;i++){toast('Importing PDF page '+i+' of '+n+'\u2026','info');const pg=await pdf.getPage(i),v1=pg.getViewport({scale:1}),vp=pg.getViewport({scale:Math.min(4,PDF_MAX.px/v1.width)});
    const c=document.createElement('canvas');c.width=Math.round(vp.width);c.height=Math.round(vp.height);const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
    await pg.render({canvasContext:x,viewport:vp}).promise;const src=await storeDataURL(c.toDataURL('image/jpeg',0.88));pg.cleanup();
    paras.push({align:'left',runs:[{type:'image',src,width:100,bg:null}]},{align:'left',runs:[{type:'text',text:''}]});}}
  catch(e){toast('Couldn\u2019t read page '+(paras.length/2+1)+' of the PDF','err');}finally{pdf.destroy();}
  if(!paras.length)return null;
  const name=(opt.name||(file.name||'PDF').replace(/\.pdf$/i,'')).slice(0,60);
  const np=await db.projects.add({name,created:Date.now(),folder:opt.noSwitch?null:(curFolder||null)});
  await db.pages.put({pid:np,html:editor.parasToHTML(paras),scrollYn:0,gutterW:0,ww:wsW()});
  projects=await db.projects.toArray();syncPing('projects');
  if(!opt.noSwitch)await switchProject(np);renderProjects();
  toast('Imported \u201c'+name+'\u201d: '+n+' page'+(n>1?'s':'')+(pdf.numPages>n?' (the first '+n+' of '+pdf.numPages+')':''),'ok');return np;}
// Insert ▸ PDF: pick a PDF file and import it as a new page
function openPdfPicker(){const i=document.createElement('input');i.type='file';i.accept='.pdf,application/pdf';i.onchange=()=>{if(i.files[0])importPdf(i.files[0]);};i.click();}
