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
function _mexp(m){return{oid:m.id,type:m.type,fields:m.fields||{},name:m.name||'',tags:m.tags||[],created:m.created,done:!!m.done,doneAt:m.doneAt||null,links:m.links||[],anchor:m.anchor||{kind:'time',yn:0},snippet:m.snippet||''};}
function _sexp(s){return{t:s.t,tool:s.tool,color:s.color,pts:s.pts,minYn:s.minYn,maxYn:s.maxYn};}
async function backupProject(){
  await savePageNow();
  const pg=(await db.pages.get(pid))||{};
  const data={app:'patchwork',type:'patchwork-backup',version:1,scope:'project',exportedAt:new Date().toISOString(),
    project:{name:projName(pid)},page:{html:await inlineImagesForExport(pg.html||''),scrollYn:pg.scrollYn||0,gutterW:pg.gutterW||0},
    marks:marks.filter(m=>m.pid===pid).map(_mexp),htypes:_typesFor(marks.filter(m=>m.pid===pid)),strokes:(await db.strokes.where('pid').equals(pid).toArray()).filter(s=>!s.del).map(_sexp)};
  _download(data,'patchwork-'+_slug(projName(pid))+'-'+_today()+'.json');
  toast('Backed up this project: \u201c'+projName(pid)+'\u201d','ok');db.info.update('info',{lastBackupAt:Date.now()}).catch(()=>{});
}
async function backupAll(){
  await savePageNow();
  const pgs=await db.pages.toArray();const allS=(await db.strokes.toArray()).filter(s=>!s.del);
  const data={app:'patchwork',type:'patchwork-backup',version:1,scope:'all',exportedAt:new Date().toISOString(),
    projects:projects.map(p=>({oid:p.id,name:p.name,created:p.created})),
    pages:await Promise.all(pgs.map(async pg=>({poid:pg.pid,html:await inlineImagesForExport(pg.html||''),scrollYn:pg.scrollYn||0,gutterW:pg.gutterW||0}))),
    marks:marks.map(m=>{const oo=_mexp(m);oo.poid=m.pid;return oo;}),
    strokes:allS.map(s=>{const oo=_sexp(s);oo.poid=s.pid;return oo;}),
    colors:{favorites:COLOR_FAVORITES,recents:COLOR_RECENTS},htypes:[...HT.values()],profiles:PROFILES,handwriting:(await db.hw.toArray()).map(({id,...r})=>r)};
  _download(data,'patchwork-all-'+_today()+'.json');
  toast('Backed up everything ('+projects.length+' project'+(projects.length!==1?'s':'')+')','ok');db.info.update('info',{lastBackupAt:Date.now()}).catch(()=>{});
}
function _sani(h){try{return DOMPurify.sanitize(String(h||''));}catch(e){return '';}}
async function importFile(file){
  let data;try{data=JSON.parse(await file.text());}catch(e){toast('Not a valid backup file','err');return;}
  if(!data||data.type!=='patchwork-backup'){toast('That\u2019s not a Patchwork backup','err');return;}
  try{
    await _impTypes(data);await _impHandwriting(data);
    let goTo=null,summary='';
    if(data.scope==='all'){goTo=await _impAll(data);summary=(data.projects?data.projects.length:0)+' projects';}
    else{goTo=await _impProject(data);summary='project \u201c'+((data.project&&data.project.name)||'Imported')+'\u201d';}
    projects=await db.projects.toArray();marks=await db.marks.toArray();
    if(goTo)await switchProject(goTo);
    renderProjects();updateBackupLabels();
    toast('Imported '+summary,'ok');
  }catch(e){console.error(e);toast('Import failed: '+(e.message||'error'),'err');}
}
async function _impProject(data){
  const np=await db.projects.add({name:((data.project&&data.project.name)||'Imported').slice(0,60),created:Date.now()});
  const map={};
  for(const m of (data.marks||[])){const nid=await db.marks.add({pid:np,type:m.type||'note',name:m.name||'',tags:m.tags||[],created:m.created||Date.now(),done:!!m.done,doneAt:m.doneAt||null,links:[],anchor:m.anchor||{kind:'time',yn:0},snippet:m.snippet||'',fields:m.fields||{}});map[m.oid]=nid;}
  for(const m of (data.marks||[]))if(m.links&&m.links.length&&map[m.oid]){const mm=m.links.map(x=>map[x]).filter(Boolean);if(mm.length)await db.marks.update(map[m.oid],{links:mm});}
  if(data.page){const h=_remapMarkIds(_sani(data.page.html),map);if(h.length<=MAX_CARD_FIELD)await db.pages.put({pid:np,html:h,scrollYn:data.page.scrollYn||0,gutterW:data.page.gutterW||0});}
  for(const s of (data.strokes||[]))await db.strokes.add({pid:np,t:s.t,tool:s.tool,color:s.color,pts:s.pts,minYn:s.minYn,maxYn:s.maxYn});
  return np;
}
async function _impAll(data){
  const pmap={};
  for(const p of (data.projects||[])){const nid=await db.projects.add({name:(p.name||'Imported').slice(0,60),created:p.created||Date.now()});pmap[p.oid]=nid;}
  const map={};
  for(const m of (data.marks||[])){const np=pmap[m.poid];if(np==null)continue;const nid=await db.marks.add({pid:np,type:m.type||'note',name:m.name||'',tags:m.tags||[],created:m.created||Date.now(),done:!!m.done,doneAt:m.doneAt||null,links:[],anchor:m.anchor||{kind:'time',yn:0},snippet:m.snippet||'',fields:m.fields||{}});map[m.oid]=nid;}
  for(const m of (data.marks||[]))if(m.links&&m.links.length&&map[m.oid]){const mm=m.links.map(x=>map[x]).filter(Boolean);if(mm.length)await db.marks.update(map[m.oid],{links:mm});}
  for(const pg of (data.pages||[]))if(pmap[pg.poid]!=null){const h=_remapMarkIds(_sani(pg.html),map);if(h.length<=MAX_CARD_FIELD)await db.pages.put({pid:pmap[pg.poid],html:h,scrollYn:pg.scrollYn||0,gutterW:pg.gutterW||0});}
  for(const s of (data.strokes||[])){const np=pmap[s.poid];if(np!=null)await db.strokes.add({pid:np,t:s.t,tool:s.tool,color:s.color,pts:s.pts,minYn:s.minYn,maxYn:s.maxYn});}
  if(data.colors){if(Array.isArray(data.colors.favorites))COLOR_FAVORITES=Array.from(new Set([...COLOR_FAVORITES,...data.colors.favorites])).slice(0,18);if(Array.isArray(data.colors.recents))COLOR_RECENTS=(data.colors.recents||COLOR_RECENTS).slice(0,8);DB_saveColors();}
  return Object.values(pmap)[0];
}
function updateBackupLabels(){const a=document.getElementById('bk-proj');if(a)a.textContent='\u2913 this project ('+projName(pid)+')';const e=document.getElementById('bk-all');if(e)e.textContent='\u2913 everything ('+projects.length+' project'+(projects.length!==1?'s':'')+')';}
document.getElementById('proj-btn').addEventListener('click',()=>setTimeout(updateBackupLabels,0));
