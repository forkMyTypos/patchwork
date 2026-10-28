"use strict";
/* ===== patches =====
   A patch is a window on the page with a page of its own inside it. On this page it is a db.pics record (kind 'pic', src '',
   patch: the inner page's project id), so it is placed, moved, resized, anchored to a paragraph, undone and backed up like
   a free picture (pics.js). Its page is a project with patchOf = the project it sits on (kept out of the project lists),
   shown live in a frame running this same app (?mini=1&patch=1&pid=N, IS_PATCH in app.js): text, ink, pictures, highlights,
   undo and the Timeline all work inside it, and the frame is the clipping. The record keeps the view: z (zoom), vx,vy (the
   page point, px at real size, at the window's top-left) and fz (zoom in focus mode). Zooming never changes the inner page.
   Focus mode = the same patch filling the window, with its own toolbars. On the page a patch is always ready to type in;
   its bar moves it, ⤡ shows the resize handles (resize mode: a cover over the page inside, so it moves like a picture). */
const PT={focus:null,saved:null,resize:null,active:null,sizing:null,drawing:null,ZMIN:0.25,ZMAX:4,MINW:190,MINH:90,_t:new Map()};
// (the page inside is reached through its functions: its const/let globals aren't properties of its window)
function ptWin(p){const el=_picEl.get(p),f=el&&el.querySelector('iframe');try{return f&&f.contentWindow&&typeof f.contentWindow.patchView==='function'?f.contentWindow:null;}catch(e){return null;}}
function ptByWin(w){return pics.find(p=>p.patch&&ptWin(p)===w)||null;}
function ptPct(z){return Math.round((z||1)*100)+'%';}
function ptName(p){return projName(p.patch)||'Patch';}

/* ---- creating: Insert ▸ Patch, then drag a rectangle (any direction; a click makes a standard size; Esc cancels) ---- */
function ptStartCreate(){if(!editor||pid==null||IS_PATCH)return;if(PT.drawing){PT.drawing();toast('No patch made','info');return;}   // (the Patch button again = cancel)
  if(mode!=='text')setMode('text');picUnpick();
  const ov=document.createElement('div');ov.className='pt-draw';const band=document.createElement('div');band.className='pt-band';ov.appendChild(band);pad.appendChild(ov);
  document.body.classList.add('pt-drawing');toast('Drag a rectangle for the patch · Esc cancels','info');
  let a=null,b=null,last=null;
  const at=(x,y)=>{const wr=wrap.getBoundingClientRect();return{x:x-wr.left+wrap.scrollLeft,y:y-wr.top+wrap.scrollTop};};   // screen -> this page (scroll included)
  const show=()=>{if(!a||!b)return;band.style.display='block';band.style.left=Math.min(a.x,b.x)+'px';band.style.top=Math.min(a.y,b.y)+'px';band.style.width=Math.abs(b.x-a.x)+'px';band.style.height=Math.abs(b.y-a.y)+'px';};
  const onScroll=()=>{if(a&&last){b=at(last.x,last.y);show();}};
  const end=()=>{ov.remove();document.body.classList.remove('pt-drawing');removeEventListener('keydown',key,true);wrap.removeEventListener('scroll',onScroll);PT.drawing=null;ptBtn();};PT.drawing=end;ptBtn();
  const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();end();toast('No patch made','info');}};
  addEventListener('keydown',key,true);wrap.addEventListener('scroll',onScroll,{passive:true});
  ov.addEventListener('pointerdown',e=>{if(e.button!==0){end();return;}e.preventDefault();try{ov.setPointerCapture(e.pointerId);}catch(_){}last={x:e.clientX,y:e.clientY};a=at(e.clientX,e.clientY);b=a;show();});
  ov.addEventListener('pointermove',e=>{if(!a)return;last={x:e.clientX,y:e.clientY};b=at(e.clientX,e.clientY);show();});
  ov.addEventListener('pointerup',e=>{if(!a)return;b=at(e.clientX,e.clientY);const r={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(b.x-a.x),h:Math.abs(b.y-a.y)};end();ptCreate(r);});
  ov.addEventListener('contextmenu',e=>{e.preventDefault();end();});}
function ptBtn(){const b=document.getElementById('patch-btn');if(b)b.classList.toggle('on',!!PT.drawing);}
{const b=document.getElementById('patch-btn');if(b)b.addEventListener('click',()=>ptStartCreate());}
// r: the rectangle in this page's px (scroll included)
async function ptCreate(r){if(pid==null)return;const U=inkW;
  if(r.w<8&&r.h<8){r.w=420;r.h=300;}else{r.w=Math.max(PT.MINW,r.w);r.h=Math.max(PT.MINH,r.h);}   // a click = standard size; never a sliver
  r.x=Math.max(gutter,r.x);
  const cid=await db.projects.add({name:'Patch',created:Date.now(),patchOf:pid});
  await db.pages.put({pid:cid,html:'',scrollYn:0,gutterW:0,ww:cleanWW(Math.round(r.w-14))||200});   // its page is as wide as the window (at 100%)
  projects=await db.projects.toArray();
  const p={pid,kind:'pic',src:'',patch:cid,z:1,vx:0,vy:0,u:1,x:(r.x-gutter)/U,y:r.y/U,w:r.w/U,h:r.h/U,t:Date.now()};picFix(p);p._dy=0;reanchor(p);
  p.id=await db.pics.add(picClean(stripId(p)));pics.push(p);picRecord(p,null);picPick(p);updatePad();updateHint();
  toast('Patch made \u2014 click inside to write \u00b7 drag its bar to move \u00b7 \u2922 opens it full size','ok');}

/* ---- the object: a title bar + the frame (built once, so the page inside keeps running) ---- */
function ptBuild(el,p){el.classList.add('pic-pt');
  el.innerHTML='<div class="pt-bar" title="Drag to move \u00b7 double-click to open full size"><button class="pt-back" title="Back to the page (Esc)">\u2190 Back to page</button><span class="pt-ic">\u25a6</span><span class="pt-name"></span><span class="pt-sp"></span>'+
    '<span class="pt-zm"><button class="pt-zo" title="Zoom out (or Ctrl+wheel)">\u2212</button><button class="pt-zv" title="Back to 100%"></button><button class="pt-zi" title="Zoom in (or Ctrl+wheel)">+</button></span><button class="pt-fit" title="Fit everything in the patch into the window">Fit</button>'+
    '<button class="pt-rs" title="Resize: show the handles (you can drag the whole patch too)"><svg width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round"><path d="M21 9L9 21M21 15l-6 6M21 3L3 21"/></svg></button>'+
    '<button class="pt-op" title="Open full size (or double-click the bar)"><svg width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button></div>'+
    '<div class="pt-box"><iframe loading="lazy" title="Patch"></iframe><div class="pt-cover"></div></div>'+
    ['tl','tr','bl','br','t','r','b','l'].map(c=>'<div class="pic-h '+c+'" data-c="'+c+'" title="Drag to resize"></div>').join('');
  el.querySelector('iframe').src=location.pathname+'?mini=1&patch=1&pid='+p.patch+'&z='+(+p.z||1)+'&vx='+(+p.vx||0)+'&vy='+(+p.vy||0);
  p._v={z:+p.z||1,x:+p.vx||0,y:+p.vy||0};
  el.querySelectorAll('.pt-bar button').forEach(b=>b.addEventListener('pointerdown',e=>{e.stopPropagation();e.preventDefault();}));
  el.querySelector('.pt-back').onclick=()=>ptUnfocus();el.querySelector('.pt-zo').onclick=()=>ptZoom(p,1/1.25);el.querySelector('.pt-zi').onclick=()=>ptZoom(p,1.25);
  el.querySelector('.pt-zv').onclick=()=>ptZoom(p,0);el.querySelector('.pt-fit').onclick=()=>ptFit(p);el.querySelector('.pt-rs').onclick=()=>ptResize(p);el.querySelector('.pt-op').onclick=()=>ptFocus(p);
  el.querySelector('.pt-bar').addEventListener('dblclick',e=>{if(!e.target.closest('button'))ptFocus(p);});
  el.querySelector('.pt-bar').addEventListener('wheel',e=>{if(PT.focus===p)e.preventDefault();},{passive:false});
  el.querySelector('.pt-bar').addEventListener('mousedown',e=>{if(PT.focus===p)e.preventDefault();});}   // (the page behind stays put and keeps no focus)
// every render: the name, the zoom shown, and the view if it changed here (undo, Back to page)
function ptRender(el,p){const z=PT.focus===p?(p.fz||1):(+p.z||1);el.querySelector('.pt-name').textContent=ptName(p);el.querySelector('.pt-zv').textContent=ptPct(z);
  if(PT.resize===p&&picSel!==p)PT.resize=null;el.classList.toggle('pt-resize',PT.resize===p);el.classList.toggle('pt-active',PT.active===p&&picSel!==p);
  el.classList.toggle('focus',PT.focus===p);if(PT.focus===p)return;
  const s=PT.sizing;if(s&&s.p===p){const f=el.querySelector('iframe'),U=inkW;f.style.width=s.w+'px';f.style.height=s.h+'px';f.style.left=((s.x-p.x)*U)+'px';f.style.top=((s.y-p.y)*U)+'px';return;}   // resizing: the page inside stays put (and isn't re-laid out) until you let go
  const v=p._v||{},w=ptWin(p);if(w&&(Math.abs((v.z||1)-(+p.z||1))>1e-3||Math.abs((v.x||0)-(+p.vx||0))>0.5||Math.abs((v.y||0)-(+p.vy||0))>0.5)){p._v={z:+p.z||1,x:+p.vx||0,y:+p.vy||0};w.patchSetView(p._v.z,p._v.x,p._v.y);}}
// the page inside reports its view (scroll, zoom, ready)
function ptChanged(w,v,kind){const p=ptByWin(w);if(!p||!v)return;
  if(kind==='active'||kind==='idle'){if(kind==='active'){if(picSel)picUnpick();PT.active=p;}else if(PT.active===p)PT.active=null;const el=_picEl.get(p);if(el)ptRender(el,p);return;}   // you're working in it (or not)
  if(kind==='ready'){if(PT.focus===p){w.patchFocus(true);w.patchSetView(p.fz||1,p.vx||0,p.vy||0);try{w.focus();}catch(e){}}else{p._v=null;renderPics();}return;}
  if(PT.focus===p){p.fz=v.z;}else{p.z=v.z;p.vx=v.x;p.vy=v.y;p._v={z:v.z,x:v.x,y:v.y};}
  const el=_picEl.get(p);if(el)el.querySelector('.pt-zv').textContent=ptPct(v.z);if(picSel===p)picMenuPos();
  clearTimeout(PT._t.get(p));PT._t.set(p,setTimeout(()=>{if(pics.includes(p))savePic(p);},400));}

/* ---- zoom and Fit (in the page inside, so the frame is just a window on it) ---- */
function ptZoom(p,f){const w=ptWin(p);if(!w)return;const z=f?w.patchView().z*f:1;w.patchZoomAt(Math.max(PT.ZMIN,Math.min(PT.ZMAX,z)));}
function ptFit(p){const w=ptWin(p);if(w)w.patchFit();}
// a plain wheel over a patch you aren't working in scrolls this page
function ptWheel(dx,dy,m){const f=m===1?16:m===2?wrap.clientHeight:1;wrap.scrollBy(dx*f,dy*f);}
// ⤡: resize mode (handles; the page inside is covered, so the whole patch drags like a picture); again, Esc or a click elsewhere ends it
function ptResize(p){if(PT.resize===p){PT.resize=null;renderPics();return;}PT.resize=p;picPick(p);}
function ptSizeStart(p){const f=_picEl.get(p).querySelector('iframe'),r=f.getBoundingClientRect();PT.sizing={p,w:r.width,h:r.height,x:p.x,y:p.y};}
function ptSizeEnd(p){if(!PT.sizing||PT.sizing.p!==p)return;PT.sizing=null;const f=_picEl.get(p).querySelector('iframe');f.style.width=f.style.height=f.style.left=f.style.top='';}
// Ctrl+wheel (or a pinch) over a patch on the page zooms it around the pointer
picLayer.addEventListener('wheel',e=>{const d=e.target.closest&&e.target.closest('.pic-pt');if(!d||!(e.ctrlKey||e.metaKey)||PT.focus)return;const p=d._pic,w=ptWin(p);if(!w)return;e.preventDefault();
  const fr=d.querySelector('iframe').getBoundingClientRect();w.patchZoomAt(w.patchView().z*Math.exp(-e.deltaY*(e.deltaMode?0.05:0.0025)),e.clientX-fr.left,e.clientY-fr.top);},{passive:false});

/* ---- focus mode: the same patch fills the window; Back to page (or Esc) puts it and its view back ---- */
function ptFocus(p){if(PT.focus===p)return;if(PT.focus)ptUnfocus();const el=_picEl.get(p),w=ptWin(p);if(!el)return;
  PT.saved={z:+p.z||1,x:+p.vx||0,y:+p.vy||0};
  if(!p.fz){const fr=el.getBoundingClientRect(),zr=Math.min(innerWidth/Math.max(1,fr.width),(innerHeight-90)/Math.max(1,fr.height));p.fz=Math.max(PT.ZMIN,Math.min(2,Math.max(1,(+p.z||1)*zr)));}   // first time: bigger, up to 200%
  if(picSel===p)picUnpick();PT.focus=p;document.body.classList.add('pt-focus');el.classList.add('focus');renderPics();
  if(w){w.patchFocus(true);w.patchSetView(p.fz,PT.saved.x,PT.saved.y);try{w.focus();}catch(e){}}}
function ptUnfocus(){const p=PT.focus;if(!p)return;PT.focus=null;const el=_picEl.get(p),w=ptWin(p),s=PT.saved||{z:1,x:0,y:0};PT.saved=null;
  document.body.classList.remove('pt-focus');if(el)el.classList.remove('focus');
  p.z=s.z;p.vx=s.x;p.vy=s.y;p._v={z:s.z,x:s.x,y:s.y};if(w){w.patchFocus(false);w.patchSetView(s.z,s.x,s.y);}savePic(p);
  try{window.focus();}catch(e){}if(pics.includes(p))picPick(p);else renderPics();}
// Esc inside a patch: leave focus mode, or stop working in it on the page
function ptEsc(w){const p=ptByWin(w);if(!p)return;if(PT.focus===p)ptUnfocus();else{if(picSel===p)picUnpick();try{window.focus();}catch(e){}}}
// in focus mode the page behind takes no keys: Esc goes back, anything else goes to the patch
addEventListener('keydown',e=>{if(!PT.focus||document.querySelector('.cls-modal'))return;e.stopPropagation();if(e.key==='Escape'){e.preventDefault();ptUnfocus();}else{const w=ptWin(PT.focus);if(w)try{w.focus();}catch(_){}}},true);
function ptRename(p){const v=window.prompt('Name this patch',ptName(p));if(v==null||!v.trim())return;const c=projects.find(x=>x.id===p.patch);if(c)renameProject(c,v.trim());renderPics();}
// a patch's page asked for elsewhere (Explorer, a link): open the page it's on, then the patch
async function ptOpenChild(c){if(c.patchOf!==pid){if(!projects.find(x=>x.id===c.patchOf))return;await switchProject(c.patchOf);}
  const p=pics.find(q=>q.patch===c.id);if(!p)return;const el=_picEl.get(p);if(el){const r=el.getBoundingClientRect(),wr=wrap.getBoundingClientRect();if(r.top<wr.top||r.bottom>wr.bottom)wrap.scrollTop+=r.top-wr.top-60;}
  ptFocus(p);}   // (a frame that hasn't loaded yet opens in focus mode when it's ready)

/* ---- moving things in: drop a free picture, or ink moved with Select & move, on a patch's window (Undo in the message) ---- */
function ptUnder(x,y,not){for(const el of document.elementsFromPoint(x,y)){const b=el.closest&&el.closest('.pt-box'),d=b&&b.closest('.pic');if(d&&d._pic&&d._pic!==not&&picLayer.contains(d)&&!d.classList.contains('focus'))return d._pic;}return null;}
function ptDropHint(p){for(const el of picLayer.querySelectorAll('.pic-pt.pt-drop'))if(el._pic!==p)el.classList.remove('pt-drop');const el=p&&_picEl.get(p);if(el)el.classList.add('pt-drop');}
// this page's px (scroll included) -> the patch's page (px at real size), through its window as you see it
function ptMap(p){const fr=_picEl.get(p).querySelector('iframe').getBoundingClientRect(),wr=wrap.getBoundingClientRect(),bx=fr.left-wr.left+wrap.scrollLeft,by=fr.top-wr.top+wrap.scrollTop,z=+p.z||1,vx=+p.vx||0,vy=+p.vy||0;
  return{x:x=>vx+(x-bx)/z,y:y=>vy+(y-by)/z,z};}
async function ptTakePic(q,p,orig){const m=ptMap(p),U=inkW,R=PAGE_REF,b=picClean(Object.assign({},q,orig)),home=pid;   // (b: where it was before the drag)
  ptDropHint(null);
  q.x=Math.max(0,m.x(gutter+q.x*U)/R);q.y=m.y(q.y*U+inkDy(q))/R;q.w*=U/m.z/R;q.h*=U/m.z/R;q.pid=p.patch;delete q.a;q._dy=0;picFix(q);
  await db.pics.put(picClean(q));if(picSel===q)picUnpick();pics=pics.filter(x=>x!==q);renderPics();updatePad();updateHint();const w=ptWin(p);if(w)await w.patchReload();
  toast('Moved into the patch \u201c'+ptName(p)+'\u201d','ok',{label:'Undo',fn:async()=>{await db.pics.put(b);if(pid===home){pics.push(await db.pics.get(b.id));renderPics();updatePad();}const w2=ptWin(p);if(w2)await w2.patchReload();}});}
async function ptTakeInk(list,p){const m=ptMap(p),R=PAGE_REF,now=Date.now(),home=pid,olds=[],news=[];ptDropHint(null);
  for(const s of list){const U=inkU(s),d=inkDy(s),c={pid:p.patch,tool:s.tool,color:s.color,u:1,t:s.t,born:now,minYn:m.y(s.minYn*U+d)/R,maxYn:m.y(s.maxYn*U+d)/R,
      pts:s.pts.map(q=>({xn:m.x(gutter+q.xn*U)/R,yn:m.y(q.yn*U+d)/R,wn:q.wn*U/m.z/R}))};
    retireStroke(s,now);const i=strokes.indexOf(s);if(i>=0)strokes.splice(i,1);if(s.id!=null)olds.push(s.id);news.push(await db.strokes.add(c));}
  redrawInk();updatePad();updateHint();saveMeta();const w=ptWin(p);if(w)await w.patchReload();
  toast('Moved into the patch \u201c'+ptName(p)+'\u201d','ok',{label:'Undo',fn:async()=>{for(const id of news)await db.strokes.update(id,{del:Date.now()});for(const id of olds)await db.strokes.update(id,{del:undefined});   // (back where it was before the drag)
    if(pid===home){strokes=(await db.strokes.where('pid').equals(pid).toArray()).filter(s=>!s.del);redrawInk();updatePad();}const w2=ptWin(p);if(w2)await w2.patchReload();}});}

/* ---- deleting: never silently; with things inside, choose what happens to them ---- */
async function ptHasContent(cid){const pg=await db.pages.get(cid),d=document.createElement('div');d.innerHTML=DOMPurify.sanitize((pg&&pg.html)||'');
  if(d.textContent.replace(/​/g,'').trim()||d.querySelector('img'))return true;
  return (await db.strokes.where('pid').equals(cid).filter(s=>!s.del).count())>0||(await db.pics.where('pid').equals(cid).filter(q=>!q.del).count())>0||marks.some(m=>m.pid===cid);}
async function ptDelete(p){const w=ptWin(p);try{if(w)await w.savePageNow();}catch(e){}
  if(!await ptHasContent(p.patch)){picSel=p;picDelete(true);return;}
  const v=await ptAsk(p);if(!v)return;
  if(v==='all'){picSel=p;picDelete(true);toast('Patch deleted','ok',{label:'Undo',fn:()=>hostUndo()});}
  else if(v==='page')await ptUnpack(p);else if(v==='keep')await ptKeep(p);}
function ptAsk(p){return new Promise(res=>{const m=document.createElement('div');m.className='cls-modal';
  m.innerHTML='<div class="panel cls-notice pt-ask" role="dialog" aria-modal="true"><div class="panel-h"><div class="panel-t"></div></div><div class="panel-b">'+
    '<p>This patch has things in it. What should happen to them?</p>'+
    '<div class="pt-opts"><button class="pbtn pt-o-page"><b>Put them onto this page</b><span>Text goes into the page where the patch is; drawings and pictures stay where you see them.</span></button>'+
    '<button class="pbtn pt-o-keep"><b>Keep them as a separate project</b><span>The patch goes; its page appears in Projects.</span></button>'+
    '<button class="pbtn pt-o-all"><b>Delete the patch and everything in it</b><span>You can undo this until you reload.</span></button></div>'+
    '<div class="hw-row"><button class="pbtn pt-o-no">Cancel</button></div></div></div>';
  m.querySelector('.panel-t').textContent='Delete the patch “'+ptName(p)+'”?';document.body.appendChild(m);
  const k=e=>{if(e.key==='Escape'){e.stopPropagation();done(null);}};const done=v=>{m.remove();removeEventListener('keydown',k,true);res(v);};addEventListener('keydown',k,true);
  m.querySelector('.pt-o-page').onclick=()=>done('page');m.querySelector('.pt-o-keep').onclick=()=>done('keep');m.querySelector('.pt-o-all').onclick=()=>done('all');
  m.querySelector('.pt-o-no').onclick=()=>done(null);m.onclick=e=>{if(e.target===m)done(null);};m.querySelector('.pt-o-no').focus();});}
// remove the patch record for good (its contents went somewhere else)
async function ptDrop(p){if(picSel===p)picUnpick();pics=pics.filter(q=>q!==p);await db.pics.delete(p.id);renderPics();}
async function ptKeep(p){const c=projects.find(x=>x.id===p.patch),par=projects.find(x=>x.id===pid);if(!c)return;
  delete c.patchOf;c.folder=(par&&par.folder)||null;await db.projects.put(c);await ptDrop(p);
  projects=await db.projects.toArray();syncPing('projects');renderProjects();updatePad();toast('Kept as the project “'+c.name+'” (in Projects)','ok');}
// Put what's in it onto this page. Text goes in after the paragraph beside the patch (paragraph ids kept, so ink and pictures
// anchored to it come along). With no text, ink, pictures and margin notes land where they were seen (zoom included).
async function ptUnpack(p){const cid=p.patch,w=ptWin(p),el=_picEl.get(p);if(!el)return;try{if(w)await w.savePageNow();}catch(e){}
  const it=w?w.patchItems():{tops:{},strokes:[],pics:[]},pg=(await db.pages.get(cid))||{},cw=cleanWW(pg.ww)||400;
  const d=document.createElement('div');d.innerHTML=DOMPurify.sanitize(pg.html||'');const hasText=!!(d.textContent.replace(/​/g,'').trim()||d.querySelector('img'));
  const wr=wrap.getBoundingClientRect(),fr=el.querySelector('iframe').getBoundingClientRect(),bx=fr.left-wr.left+wrap.scrollLeft,by=fr.top-wr.top+wrap.scrollTop;   // the window's top-left, in this page's px
  const z=+p.z||1,vx=+p.vx||0,vy=+p.vy||0,U=inkW,R=PAGE_REF;
  const ss=(await db.strokes.where('pid').equals(cid).toArray()).filter(s=>!s.del),ps=(await db.pics.where('pid').equals(cid).toArray()).filter(q=>!q.del),ms=marks.filter(m=>m.pid===cid);
  const dyOf=(arr,id)=>{const o=arr.find(x=>x.id===id);return o?o.dy:0;};
  for(const s of ss)if(!s.u){const f=cw/R;for(const q of s.pts){q.xn*=f;q.yn*=f;q.wn*=f;}s.minYn*=f;s.maxYn*=f;s.u=1;}   // (older strokes: relative to the page width)
  let T0=null,C0=18;
  if(hasText){const lines=[...noteEd.querySelectorAll(':scope > .line')],top=el.getBoundingClientRect().top;let pi=-1;lines.forEach((l,i)=>{if(l.getBoundingClientRect().top<=top+4)pi=i;});
    const first=d.querySelector('.line[data-id]');editor.insertParasHTML(pi,pg.html||'');_paraTops=null;
    if(first){C0=it.tops[first.dataset.id]!=null?it.tops[first.dataset.id]:18;const t=paraTops().get(first.dataset.id);if(t!=null)T0=t;}}
  const X=x=>(bx+(x-vx)*z-gutter)/U,Y=y=>(by+(y-vy)*z)/U;   // the page inside (px at real size) -> this page (units), as seen
  for(const s of ss){s.pid=pid;if(!hasText){const dy=dyOf(it.strokes,s.id);for(const q of s.pts){q.xn=X(q.xn*R);q.yn=Y(q.yn*R+dy);q.wn*=z*R/U;}s.minYn=Y(s.minYn*R+dy);s.maxYn=Y(s.maxYn*R+dy);delete s.a;s._dy=0;}await db.strokes.put(stripUnder(s));}
  for(const q of ps){q.pid=pid;if(q.pin){q.pin=false;q.x=(bx-gutter)/U;q.y=by/U;delete q.a;}else if(!hasText){const dy=dyOf(it.pics,q.id);q.x=X(q.x*R);q.y=Y(q.y*R+dy);q.w*=z*R/U;q.h*=z*R/U;delete q.a;}picFix(q);await db.pics.put(picClean(q));}
  for(const m of ms){m.pid=pid;if(m.anchor&&m.anchor.kind==='time'){const y=(m.anchor.yn||0)*cw;m.anchor={...m.anchor,yn:Math.max(0,(hasText&&T0!=null?T0+(y-C0):by+(y-vy)*z)/drawW)};}await db.marks.update(m.id,{pid,anchor:m.anchor});}
  await db.pages.delete(cid);await db.snaps.where('pid').equals(cid).delete();await db.projects.delete(cid);await ptDrop(p);
  projects=await db.projects.toArray();marks=await db.marks.toArray();strokes=(await db.strokes.where('pid').equals(pid).toArray()).filter(s=>!s.del);await picsLoad();
  for(const s of strokes)if(!s.a)reanchor(s);for(const q of pics)if(!q.a)reanchor(q);
  syncPing('marks');redrawInk();updatePad();updateHint();saveMeta();toast('The patch’s contents are on this page now','ok');}
function stripUnder(s){const o={};for(const k in s)if(k[0]!=='_')o[k]=s[k];return o;}

// the pages inside the patches save what was just typed (before a backup)
async function ptFlush(){for(const p of pics)if(p.patch){const w=ptWin(p);if(w)try{await w.savePageNow();}catch(e){}}}

/* ---- tidying: a patch's page whose patch is gone (deleted, or the page it was on deleted) goes on the next start ---- */
async function ptPurge(){if(IS_MINI)return;const kids=projects.filter(p=>p.patchOf);if(!kids.length)return;
  const live=new Set((await db.pics.toArray()).filter(q=>q.patch&&!q.del).map(q=>q.patch));let n=0;
  for(const c of kids)if(!live.has(c.id)){await db.pages.delete(c.id);await db.strokes.where('pid').equals(c.id).delete();await db.pics.where('pid').equals(c.id).delete();await db.marks.where('pid').equals(c.id).delete();await db.snaps.where('pid').equals(c.id).delete();await db.projects.delete(c.id);n++;}
  if(n)projects=await db.projects.toArray();}
