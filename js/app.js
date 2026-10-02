"use strict";
/* =================== integration: projects + page + ink + time-stamped marks =================== */
// a pop-up editor is this same app in a frame (?mini=1&pid=N), locked out of opening further pop-ups
const IS_MINI=new URLSearchParams(location.search).has('mini');document.documentElement.classList.toggle('mini',IS_MINI);
// the CLASS side of Teaching Mode: a pop-up editor whose projects are always sharable (what it shows is broadcast)
const IS_CLASS=IS_MINI&&new URLSearchParams(location.search).has('class');
const db=new Dexie('patchwork-page');
db.version(3).stores({projects:'++id,created',pages:'pid',strokes:'++id,pid,t',marks:'++id,pid,type,created',meta:'id',info:'id'});
// v4 only ADDS tables (existing data untouched): content-addressed images + paragraphs, page history snapshots, highlight types + profiles
db.version(4).stores({projects:'++id,created',pages:'pid',strokes:'++id,pid,t',marks:'++id,pid,type,created',meta:'id',info:'id',images:'h',paras:'h',snaps:'++id,pid,t',htypes:'id',profiles:'id'});
// v5 adds personal handwriting examples (local only)
db.version(5).stores({projects:'++id,created',pages:'pid',strokes:'++id,pid,t',marks:'++id,pid,type,created',meta:'id',info:'id',images:'h',paras:'h',snaps:'++id,pid,t',htypes:'id',profiles:'id',hw:'++id,lang,ch,src'});
// v6 adds folders (projects get an optional `folder`; none = Home)
db.version(6).stores({projects:'++id,created',pages:'pid',strokes:'++id,pid,t',marks:'++id,pid,type,created',meta:'id',info:'id',images:'h',paras:'h',snaps:'++id,pid,t',htypes:'id',profiles:'id',hw:'++id,lang,ch,src',folders:'++id,parent'});
// v7 adds the classroom inbox (hand-ins received by a teacher; local only)
db.version(7).stores({projects:'++id,created',pages:'pid',strokes:'++id,pid,t',marks:'++id,pid,type,created',meta:'id',info:'id',images:'h',paras:'h',snaps:'++id,pid,t',htypes:'id',profiles:'id',hw:'++id,lang,ch,src',folders:'++id,parent',inbox:'++id,at'});
// v8 adds free pictures (pics.js): placed anywhere on the page like ink
db.version(8).stores({projects:'++id,created',pages:'pid',strokes:'++id,pid,t',marks:'++id,pid,type,created',meta:'id',info:'id',images:'h',paras:'h',snaps:'++id,pid,t',htypes:'id',profiles:'id',hw:'++id,lang,ch,src',folders:'++id,parent',inbox:'++id,at',pics:'++id,pid'});

const GAP_MS=4*60*1000;
const PALETTE=['#ece6da','#f87171','#fb923c','#fbbf24','#4ade80','#22d3ee','#60a5fa','#a78bfa','#f472b6','#1c1c24'];
// Highlight types are user data (db.htypes, see the Highlight Factory). The four built-ins keep their original ids
// ('note','task','question','answer') so every existing mark keeps working unchanged.
const BUILTIN_TYPES=[
  {id:'note',name:'Note',color:'#f59e0b',fx:{bg:true,ul:true},margin:true,checkable:false,links:[],fields:[],builtin:true},
  {id:'task',name:'Task',color:'#4ade80',fx:{bg:true,ul:true},margin:true,checkable:true,links:[],fields:[],builtin:true},
  {id:'question',name:'Question',color:'#818cf8',fx:{bg:true,ul:true},margin:true,checkable:false,links:['answer'],fields:[],builtin:true},
  {id:'answer',name:'Answer',color:'#22d3ee',fx:{bg:true,ul:true},margin:true,checkable:false,links:[],fields:[],builtin:true}];
const HT=new Map(BUILTIN_TYPES.map(t=>[t.id,t]));
const UNKNOWN_TYPE={id:'?',name:'Removed type',color:'#7a7a92',fx:{ul:true},margin:true,links:[],fields:[]};
function ht(id){return HT.get(id)||UNKNOWN_TYPE;}
function hexA(hex,a){const h=normalizeHex(hex)||'#7a7a92';return 'rgba('+parseInt(h.slice(1,3),16)+','+parseInt(h.slice(3,5),16)+','+parseInt(h.slice(5,7),16)+','+a+')';}
function mtype(t){const x=ht(t);return{c:x.color,bg:hexA(x.color,.16),label:(x.name||'?').toUpperCase(),name:x.name||'?',fx:x.fx||{bg:true,ul:true},ht:x};}
// A Highlight Profile is just an ordered list of type ids plus which are hidden; types themselves are shared,
// so switching profile only changes the tools on offer and never reinterprets existing highlights.
let PROFILES=[{id:'default',name:'Default',types:['note','task','question','answer'],hidden:[]}],activeProfileId='default';
function activeProfile(){return PROFILES.find(p=>p.id===activeProfileId)||PROFILES[0];}
function activeTypeIds(){const p=activeProfile();return p?p.types.filter(id=>HT.has(id)&&!(p.hidden||[]).includes(id)):[];}
function showInMargin(m){return !(m.anchor&&m.anchor.kind==='text')||ht(m.type).margin!==false;}

let editor=null;
let projects=[],pid=null;
let marks=[];                 // ALL marks across projects (for cross-project links/search)
let strokes=[],inkRedo=[];    // current project's ink
let W=0,H=0,drawW=0,dpr=1,gutter=70,gutterW=0,pageWW=0;
// page background behind the text: '' plain, 'lined', 'grid', 'dots' (saved with the page)
const PAGE_BGS=['lined','grid','dots'];let pageBg='';const pageBgEl=document.createElement('div');pageBgEl.id='pagebg';
function setPageBg(v){pageBg=PAGE_BGS.includes(v)?v:'';layout();saveMeta();}
// the timestamp margin is never narrower than its tools
const GUT_MIN=76;
const PAGE_REF=1000;   // the page's width in 'sheet' px: 15px text on a 1000-wide page; everything scales from there
// Each page keeps the width it was written at (page.ww, px at real size): its document width. It is ALWAYS shown at real
// size (15px is 15px on every screen): lines wrap at that width everywhere, a narrower window scrolls sideways, a wider one
// shades beyond the page. Nothing is scaled. New pages take the main window's width, remembered per browser.
function cleanWW(v){v=+v;return Number.isFinite(v)&&v>=200&&v<=6000?Math.round(v):0;}
function wsW(){let v=0;try{v=cleanWW(localStorage.getItem('pw-ww'));}catch(e){}return v||cleanWW(innerWidth-98)||800;}
// the page width for a page record: its own, or (first open of an older page / a new page) the workspace width, saved
function pageWidthFor(pg,id){const v=cleanWW(pg&&pg.ww);if(v)return v;const w=wsW();if(pg&&pg.pid!=null)db.pages.update(id,{ww:w}).catch(()=>{});return w;}
let mode='text',inkColor='#ece6da',inkSize=3;const DEFAULT_INK='#ece6da';
let drawing=false,active=null;
let _metaTimer=null,_flashId=null,_flashRAF=0;
let pinHits=[];
let typeOff=new Set();          // highlight types switched off in Find & filter (everything else is shown)
function typeOn(t){return !typeOff.has(t);}
function filterTypes(){const ids=new Set(activeTypeIds());for(const m of pageMarks())if(searchable(m))ids.add(m.type);return [...ids];}
let grabSel=new Set(),grabActive=false,grabMode=null,grabStart=null,grabBox=null,grabMoved=false;

const stage=document.getElementById('stage');
const wrap=document.getElementById('wrap'),pad=document.getElementById('pad');
const noteEd=document.getElementById('note-ed');
const cv=document.getElementById('ink'),ctx=cv.getContext('2d');
const gut=document.getElementById('gut');

function isDraw(m){return m==='pen'||m==='hl'||m==='eraser';}
function scrollTop(){return wrap.scrollTop;}
// the editor handles keys itself, so the browser never scrolls to follow the caret: do it here (held Enter/Backspace)
function keepCaretVisible(){const s=window.getSelection();if(!s||!s.rangeCount)return;let r=s.getRangeAt(0).getClientRects()[0];if(!r||!r.height){const n=s.anchorNode,el=n&&(n.nodeType===1?n:n.parentElement);if(el)r=el.getBoundingClientRect();}if(!r)return;const w=wrap.getBoundingClientRect(),m=48;if(r.bottom>w.bottom-m)wrap.scrollTop+=r.bottom-(w.bottom-m);else if(r.top<w.top+m)wrap.scrollTop=Math.max(0,wrap.scrollTop-((w.top+m)-r.top));
  // sideways too (a page wider than the window): follow the caret right, and back left on a new line
  const mx=40;if(r.right>w.right-mx)wrap.scrollLeft+=r.right-(w.right-mx);else if(r.left<w.left+gutter+mx)wrap.scrollLeft=Math.max(0,wrap.scrollLeft-((w.left+gutter+mx)-r.left));}
function esc(s){const d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML;}
function markById(id){id=typeof id==='string'?+id:id;return marks.find(m=>m.id===id);}
function projName(id){const p=projects.find(x=>x.id===id);return p?p.name:'?';}
function pageMarks(){return marks.filter(m=>m.pid===pid);}
function getMarkStyle(id){const m=markById(id);if(!m)return null;if(!typeOn(m.type))return null;const t=mtype(m.type);return{color:m.done?'#5a5a72':t.c,bg:t.bg,fx:t.fx};}

/* coords */
function ptFromEvent(e){const r=wrap.getBoundingClientRect();const cx=e.clientX-r.left,cy=e.clientY-r.top;const xn=Math.min(1,Math.max(0,(cx-gutter+wrap.scrollLeft)/drawW));const yn=(cy+scrollTop())/drawW;return{cx,cy,xn,yn};}
function sx(xn){return gutter+xn*drawW-wrap.scrollLeft;}
function sy(yn){return yn*drawW-scrollTop();}

/* layout */
function layout(){
  W=stage.clientWidth;H=stage.clientHeight;
  gutter=gutterW>0?Math.max(GUT_MIN,Math.min(340,gutterW)):(W<560?GUT_MIN:86);_paraStampCache=null;
  const fitW=Math.max(40,W-gutter-12);
  if(!IS_MINI&&!(typeof CLS!=='undefined'&&CLS.role)){try{localStorage.setItem('pw-ww',String(Math.round(fitW)));}catch(e){}}
  const k=1;drawW=pageWW||fitW;pad.style.width=(gutter+drawW+12)+'px';if(pageBgEl.parentNode!==pad)pad.prepend(pageBgEl);pageBgEl.className=pageBg?'bg-'+pageBg:'';pageBgEl.style.left=gutter+'px';pageBgEl.style.width=(drawW+12)+'px';wrap.style.overflowX=drawW>fitW+1?'auto':'hidden';
  dpr=Math.max(1,Math.min(3,window.devicePixelRatio||1));
  cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);cv.style.width=W+'px';cv.style.height=H+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  // text size, padding and ink scale with the page (k = 1 at real size), so lines wrap at the same words on every screen
  inkW=PAGE_REF*k;_paraTops=null;noteEd.style.fontSize=(15*k)+'px';noteEd.style.paddingTop=(18*k)+'px';noteEd.style.paddingRight=(12+8*k)+'px';
  noteEd.style.paddingLeft=(gutter+10*k)+'px';gut.style.width=gutter+'px';const _gt=document.getElementById('gut-tools');if(_gt&&_gt.parentNode&&_gt.parentNode.id==='bar2')_gt.style.width=gutter+'px';var _b2=document.getElementById('bar2');if(_b2)_b2.style.paddingLeft=(gutter+10)+'px';
  updatePad();redrawInk();
}
/* ink placement. New strokes (u:1) are stored in page units, the same scale as the text (inkW screen px per unit), so ink and
   text grow and shrink together (class page vs normal view, window size). Older strokes are relative to the page width
   (drawW), as before. A stroke anchored to a paragraph (a={p:id,top}) moves with it when text above re-wraps or changes. */
let inkW=PAGE_REF,_paraTops=null;
function paraTops(){if(_paraTops)return _paraTops;const m=new Map(),wr=wrap.getBoundingClientRect(),st=scrollTop();
  noteEd.querySelectorAll(':scope > .line').forEach(l=>{if(l.dataset.id)m.set(l.dataset.id,l.getBoundingClientRect().top-wr.top+st);});_paraTops=m;return m;}
function inkU(s){return s.u?inkW:drawW;}
function inkDy(s){if(!s.a){reanchor(s);if(!s.a)return 0;}const t=paraTops().get(s.a.p);if(t==null){reanchor(s);return s._dy||0;}s._dy=t-s.a.top*inkU(s);return s._dy;}
// attach a stroke to the paragraph beside its middle, without moving it on screen
function reanchor(s){const tops=paraTops();if(!tops.size||!editor||s.pid!==pid)return;const U=inkU(s),d=s._dy||0,mid=(s.minYn+s.maxYn)/2*U+d;let best=null,bt=-Infinity,first=null,ft=Infinity;
  for(const [id,t] of tops){if(t<=mid+2&&t>bt){bt=t;best=id;}if(t<ft){ft=t;first=id;}}if(best==null){best=first;bt=ft;}
  s.a={p:best,top:(bt-d)/U};s._dy=d;if(s.id!=null&&!s.del)(s.kind==='pic'?db.pics:db.strokes).update(s.id,{a:s.a}).catch(()=>{});}
// a stroke made in screen terms (relative to drawW, as drawn) -> page units, anchored, saved
function inkToUnits(s){const f=drawW/inkW;for(const q of s.pts){q.xn*=f;q.yn*=f;q.wn*=f;}s.minYn*=f;s.maxYn*=f;s.u=1;s._dy=0;}
function addViewStroke(s){inkToUnits(s);reanchor(s);commitStroke(s);saveMeta();}
function inkBottomPx(){let mx=typeof picsBottomPx==='function'?picsBottomPx():0;for(const s of strokes){const b=s.maxYn*inkU(s)+inkDy(s);if(b>mx)mx=b;}return mx;}
function updatePad(){pad.style.minHeight=Math.ceil(Math.max(noteEd.scrollHeight+20,inkBottomPx()+H*0.5,H))+'px';}

/* ink */
function styleFor(s){ctx.lineCap='round';ctx.lineJoin='round';if(s.tool==='eraser'){ctx.globalCompositeOperation='destination-out';ctx.strokeStyle='#000';ctx.fillStyle='#000';ctx.globalAlpha=1;}else if(s.tool==='hl'){ctx.globalCompositeOperation='source-over';ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.globalAlpha=.30;}else{ctx.globalCompositeOperation='source-over';ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.globalAlpha=1;}}
function drawStroke(s){const U=inkU(s),d=inkDy(s),st=scrollTop(),sl=wrap.scrollLeft,X=q=>gutter+q.xn*U-sl,Y=q=>q.yn*U+d-st,top=s.minYn*U+d-st,bot=s.maxYn*U+d-st;if(bot<-14||top>H+14)return;styleFor(s);const p=s.pts;if(p.length===1){const a=p[0];ctx.beginPath();ctx.arc(X(a),Y(a),Math.max(.5,a.wn*U/2),0,7);ctx.fill();}else for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];ctx.lineWidth=Math.max(.5,(a.wn+b.wn)/2*U);ctx.beginPath();ctx.moveTo(X(a),Y(a));ctx.lineTo(X(b),Y(b));ctx.stroke();}ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;}

/* gutter ledger (current project's marks) */
function fmtTime(t){return new Date(t).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});}
function fmtDay(t){return new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'});}
function fmtAbs(t){return new Date(t).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
function clipText(txt,maxW){ctx.font='10px Arial';if(ctx.measureText(txt).width<=maxW)return txt;let s=txt;while(s.length&&ctx.measureText(s+'\u2026').width>maxW)s=s.slice(0,-1);return s+'\u2026';}
function textMarkY(){const map={},wr=wrap.getBoundingClientRect();noteEd.querySelectorAll('[data-mark]').forEach(el=>{const id=+el.dataset.mark;if(map[id]==null){const r=el.getBoundingClientRect();map[id]=r.top-wr.top;}});return map;}
// World-space (page) positions of stamped paragraphs; recomputed only after the editor re-renders or the layout changes.
let _paraStampCache=null;
new ResizeObserver(()=>{_paraTops=null;if(typeof redrawInk==='function'&&editor)redrawInk();}).observe(noteEd);
if(document.fonts)document.fonts.addEventListener('loadingdone',()=>{_paraTops=null;_paraStampCache=null;if(editor)layout();});   // the bundled font arrived: re-measure
function onEditorRender(){_paraStampCache=null;_paraTops=null;cancelAnimationFrame(_hintRAF);_hintRAF=requestAnimationFrame(()=>redrawInk());}   // ink anchored to paragraphs follows the text (redrawInk also updates the hint)
let _hintRAF=0;
function updateHint(hasText){if(hasText===undefined)hasText=editor&&editor.getPlainText&&editor.getPlainText().trim();document.getElementById('hint').style.display=(strokes.length||hasText||pageMarks().length||noteEd.querySelector('.img-run')||(typeof pics!=='undefined'&&pics.length))?'none':'';}
function paraStamps(){if(_paraStampCache)return _paraStampCache;const out=[];if(editor&&editor.paraRects){const wr=wrap.getBoundingClientRect(),st=scrollTop();for(const r of editor.paraRects()){if(!r.t||!r.has)continue;const b=r.el.getBoundingClientRect();out.push({t:r.t,y:(b.top-wr.top)+st+Math.min(12,b.height/2),kind:'text'});}}return (_paraStampCache=out);}
function dayLabel(t){const d=new Date(t),n=new Date();const k=x=>x.getFullYear()+'-'+x.getMonth()+'-'+x.getDate();if(k(d)===k(n))return 'Today';const y=new Date(n);y.setDate(n.getDate()-1);if(k(d)===k(y))return 'Yesterday';return fmtDay(t);}
// Session stamps: one per burst of work (a gap of GAP_MS or a new day starts a new stamp), for text and ink alike.
function sessionStamps(){const raw=paraStamps().slice();for(const s of strokes)raw.push({t:s.born||s.t,y:s.minYn*inkU(s)+inkDy(s)+6,kind:'ink'});raw.sort((a,b)=>a.y-b.y);const out=[];let lastT=null,lastDay='';for(const r of raw){const day=new Date(r.t).toDateString();if(lastT!=null&&Math.abs(r.t-lastT)<GAP_MS&&day===lastDay)continue;out.push({...r,newDay:day!==lastDay});lastT=r.t;lastDay=day;}return out;}
function isLegacyAutoStamp(m){return m.anchor&&m.anchor.kind==='time'&&m.auto&&!searchable(m);}
function drawGutter(){
  ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
  // the page is narrower than the window: shade what lies beyond its right edge
  const pe=sx(1)+12;if(pe<W-1){ctx.fillStyle='rgba(0,0,0,.32)';ctx.fillRect(pe,0,W-pe,H);ctx.strokeStyle='#2a2233';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(Math.round(pe)+.5,0);ctx.lineTo(Math.round(pe)+.5,H);ctx.stroke();}
  ctx.fillStyle='rgba(16,13,22,.86)';ctx.fillRect(0,0,gutter,H);
  ctx.strokeStyle='#2a2233';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(gutter-.5,0);ctx.lineTo(gutter-.5,H);ctx.stroke();
  const st=scrollTop(),tY=textMarkY(),labels=[];pinHits=[];
  // 1) session stamps (time labels)
  for(const sp of sessionStamps()){const y=sp.y-st;if(y<-30||y>H+30)continue;labels.push({y,prio:1,kind:'stamp',sp});}
  // 2) marks: user timestamps + highlights (dots), legacy auto stamps are represented by paragraph times now
  for(const m of pageMarks()){if(isLegacyAutoStamp(m))continue;if(searchable(m)&&!typeOn(m.type))continue;if(!showInMargin(m))continue;let y;if(m.anchor&&m.anchor.kind==='time')y=m.anchor.yn*drawW-st;else{const ty=tY[m.id];if(ty==null)continue;y=ty;}if(y<-30||y>H+30)continue;pinHits.push({m,y});
    const t=mtype(m.type),col=m.done?'#5a5a72':t.c,named=(m.name&&m.name.trim())||m.type!=='note'||m.done;
    ctx.strokeStyle='#3a3145';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(gutter-1,y);ctx.lineTo(gutter+7,y);ctx.stroke();
    ctx.beginPath();ctx.arc(gutter-7,y,3.6,0,7);if(named){ctx.fillStyle=col;ctx.globalAlpha=m.done?.6:1;ctx.fill();}else{ctx.strokeStyle=col;ctx.lineWidth=1.4;ctx.globalAlpha=.8;ctx.stroke();}ctx.globalAlpha=1;
    if(m.id===_flashId){const pulse=0.45+0.45*Math.sin(performance.now()/110);ctx.strokeStyle=col;ctx.globalAlpha=pulse;ctx.lineWidth=2;ctx.beginPath();ctx.arc(gutter-7,y,8,0,7);ctx.stroke();ctx.globalAlpha=1;}
    if(m.anchor&&m.anchor.kind==='time')labels.push({y,prio:2,kind:'mark',m,col});else if(m.name&&gutter>=110)labels.push({y,prio:0,kind:'hl',m,col});}
  // 3) labels, de-collided: user timestamps beat session stamps beat highlight names
  labels.sort((a,b)=>a.y-b.y||b.prio-a.prio);const drawn=[];const right=gutter-16;
  for(const L of labels){if(L.y<-8)continue;if(drawn.some(d=>Math.abs(d.y-L.y)<(d.day||L.newDay?26:15)&&d.prio>=L.prio))continue;const day=L.kind==='stamp'&&L.sp.newDay;drawn.push({y:L.y,prio:L.prio,day});
    ctx.textBaseline='middle';ctx.textAlign='right';
    if(L.kind==='stamp'){if(day){ctx.font='600 9px Arial';ctx.fillStyle='#7a6a45';ctx.fillText(dayLabel(L.sp.t).toUpperCase(),right,L.y-11);}ctx.font='10.5px Arial';ctx.fillStyle=L.sp.kind==='ink'?'#8a7f9a':'#9a8a6a';ctx.fillText((L.sp.kind==='ink'?'✎ ':'')+fmtTime(L.sp.t),right,L.y+(day?2:0));}
    else if(L.kind==='mark'){const m=L.m;ctx.font='10.5px Arial';ctx.fillStyle=m.done?'#6a6a82':'#c9b88a';ctx.fillText((m.done?'✓ ':'')+fmtTime(m.created),right,L.y+(m.name&&gutter>=110?-5:0));if(m.name&&gutter>=110){ctx.font='10px Arial';ctx.fillStyle=L.col;ctx.fillText(clipText(m.name,gutter-26),right,L.y+8);}}
    else{ctx.font='10px Arial';ctx.fillStyle=L.col;ctx.fillText(clipText(L.m.name,gutter-26),right,L.y);}
    ctx.textAlign='left';}
  drawPages();
}
// pages: one page = one screen height of this window; faint breaks + a Page n / N readout
function drawPages(){if(!H)return;const st=scrollTop(),total=Math.max(1,Math.ceil((contentBottomPx()+1)/H)),cur=Math.min(total,Math.floor((st+H*0.5)/H)+1);
  ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';for(let k=1;k<total+1;k++){const y=k*H-st;if(y<-2||y>H+2)continue;ctx.strokeStyle='rgba(255,255,255,.09)';ctx.setLineDash([6,6]);ctx.beginPath();ctx.moveTo(gutter,y+.5);ctx.lineTo(W,y+.5);ctx.stroke();ctx.setLineDash([]);ctx.font='600 9px Arial';ctx.fillStyle='#5a5a72';ctx.textAlign='right';ctx.fillText('PAGE '+(k+1),W-18,y+12);}ctx.restore();
  const pi=document.getElementById('page-ind');if(pi)pi.textContent='Page '+cur+' / '+total;}
function buildFilterBar(){const fb=document.getElementById('filterbar');if(!fb)return;fb.innerHTML='';
  const mk=(t,label)=>{const c=document.createElement('div');c.className='fchip';c.dataset.t=t;c.setAttribute('role','button');
    c.innerHTML=(t==='all'?'':'<span class="fdot" style="background:'+mtype(t).c+'"></span>')+'<span class="flabel">'+label+'</span><span class="fcnt" data-c="'+t+'">0</span>'+(t==='all'?'':'<span class="fcaret">\u203a</span>');
    c.onclick=e=>{if(e.target.classList.contains('fcaret')){pinFly(t,c);return;}if(t==='all'){typeOff.clear();}else{if(typeOff.has(t))typeOff.delete(t);else typeOff.add(t);if(filterTypes().every(x=>typeOff.has(x)))typeOff.clear();}applyFilter();};
    if(t!=='all'){c.onmouseenter=()=>showFly(t,c);c.onmouseleave=()=>scheduleHideFly();}
    fb.appendChild(c);};
  mk('all','All');filterTypes().forEach(t=>mk(t,mtype(t).name));updateFilter();}
let _flyEl=null,_flyHideT=null,_flyPinned=false,_flyType=null,_flyAnchor=null;
function ensureFly(){if(_flyEl)return _flyEl;_flyEl=document.createElement('div');_flyEl.id='side-fly';document.body.appendChild(_flyEl);_flyEl.onmouseenter=()=>clearTimeout(_flyHideT);_flyEl.onmouseleave=()=>{if(!_flyPinned)scheduleHideFly();};return _flyEl;}
function showFly(t,a){clearTimeout(_flyHideT);_flyPinned=false;renderFly(t,a);}
function pinFly(t,a){_flyPinned=true;renderFly(t,a);}
function scheduleHideFly(){clearTimeout(_flyHideT);_flyHideT=setTimeout(()=>{if(_flyEl&&!_flyPinned)_flyEl.classList.remove('open');},220);}
function hideFly(){_flyPinned=false;if(_flyEl)_flyEl.classList.remove('open');}
function renderFly(t,a){ensureFly();_flyType=t;_flyAnchor=a;const items=pageMarks().filter(m=>m.type===t&&searchable(m)).sort((x,y)=>y.created-x.created);_flyEl.innerHTML='';
  if(!items.length)_flyEl.innerHTML='<div class="sr-empty" style="padding:14px;font-size:12px">No '+esc(mtype(t).name)+' highlights yet</div>';
  else items.forEach(m=>{const it=document.createElement('div');it.className='sr';const mt=mtype(t);it.innerHTML='<span class="sr-b" style="background:'+mt.bg+';color:'+mt.c+'">'+mt.label+'</span><div class="sr-main"><div class="sr-name'+(m.done?' done':'')+'">'+esc(m.name||m.snippet||fmtAbs(m.created))+'</div><div class="sr-meta">'+fmtTime(m.created)+'</div></div>';it.onclick=()=>{hideFly();jumpToMark(m);};_flyEl.appendChild(it);});
  const r=a.getBoundingClientRect();_flyEl.style.left=Math.min(r.right+6,window.innerWidth-250)+'px';_flyEl.style.top=Math.max(6,Math.min(r.top,window.innerHeight-270))+'px';_flyEl.classList.add('open');}
function renderSideResults(q){const w=document.getElementById('side-results');if(!w)return;w.innerHTML='';const ql=(q||'').trim().toLowerCase();if(!ql)return;
  const res=marks.filter(searchable).filter(m=>markText(m).includes(ql)).sort((a,b)=>b.created-a.created).slice(0,60);
  if(!res.length){w.innerHTML='<div class="sr-empty" style="padding:14px;font-size:12px">No matches</div>';return;}
  res.forEach(m=>{const t=mtype(m.type);const it=document.createElement('div');it.className='sr';const pj=m.pid!==pid?' \u00b7 '+esc(projName(m.pid)):'';it.innerHTML='<span class="sr-b" style="background:'+t.bg+';color:'+t.c+'">'+t.label+'</span><div class="sr-main"><div class="sr-name'+(m.done?' done':'')+'">'+esc(m.name||m.snippet||'(untitled)')+'</div><div class="sr-meta">'+fmtTime(m.created)+pj+'</div></div>';it.onclick=()=>{toggleSide(false);jumpToMark(m);};w.appendChild(it);});}
function refreshSideLive(){const sd=document.getElementById('side');if(!sd||!sd.classList.contains('open'))return;const q=document.getElementById('side-q');if(q&&q.value.trim())renderSideResults(q.value);if(_flyEl&&_flyEl.classList.contains('open')&&_flyType&&_flyAnchor)renderFly(_flyType,_flyAnchor);}
function toggleSide(open){const sd=document.getElementById('side'),sc=document.getElementById('side-scrim');const will=open===undefined?!sd.classList.contains('open'):open;sd.classList.toggle('open',will);sc.classList.toggle('open',will);if(will){buildFilterBar();const q=document.getElementById('side-q');renderSideResults(q.value);}else{hideFly();}}
function applyFilter(){if(editor)editor.refresh();redrawInk();}
function updateFilter(){const fb=document.getElementById('filterbar');if(!fb||!fb.children.length)return;const counts={};let total=0;for(const m of pageMarks())if(searchable(m)){counts[m.type]=(counts[m.type]||0)+1;total++;}const ae=fb.querySelector('[data-c="all"]');if(ae)ae.textContent=total;fb.querySelectorAll('.fcnt').forEach(e=>{if(e.dataset.c!=='all')e.textContent=counts[e.dataset.c]||0;});fb.querySelectorAll('.fchip').forEach(c=>{const t=c.dataset.t;if(t==='all'){c.classList.toggle('on',typeOff.size===0);c.classList.remove('off');}else{const on=typeOn(t);c.classList.toggle('on',on);c.classList.toggle('off',!on);}});}
function redrawInk(){
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  for(const s of strokes)drawStroke(s);drawGutter();if(typeof renderPics==='function')renderPics();if(typeof updateFilter==='function')updateFilter();if(typeof refreshSideLive==='function')refreshSideLive();if(mode==='grab'&&grabSel.size)drawGrabOverlay();
  const hasText=editor&&editor.getPlainText&&editor.getPlainText().trim();
  updateHint(hasText);
}
function flashPin(id){_flashId=id;const start=performance.now();cancelAnimationFrame(_flashRAF);const tick=()=>{redrawInk();if(performance.now()-start<1000)_flashRAF=requestAnimationFrame(tick);else{_flashId=null;redrawInk();}};_flashRAF=requestAnimationFrame(tick);}

/* ink persistence + undo */
function stripId(o){const{id,...rest}=o;return rest;}
async function persistStroke(s){try{const id=await db.strokes.add(stripId(s));s.id=id;}catch(e){console.error(e);}}
function retireStroke(s,t){if(s.id!=null)db.strokes.update(s.id,{del:t||Date.now()}).catch(()=>{});}
function commitStroke(s){inkRedo=[];_uTokens.push('ink');_rTokens=[];strokes.push(s);persistStroke(s);updatePad();}
let _uTokens=[],_rTokens=[];
function onEditStep(){_uTokens.push('text');_rTokens=[];if(typeof schedulePrune==='function')schedulePrune();}
function hostUndo(){if(!_uTokens.length)return;const tk=_uTokens.pop();_rTokens.push(tk);if(tk==='ink')inkUndo();else if(tk==='pic')picUndo();else if(editor)editor.undo();}
function hostRedo(){if(!_rTokens.length)return;const tk=_rTokens.pop();_uTokens.push(tk);if(tk==='ink')inkRedoFn();else if(tk==='pic')picRedo();else if(editor)editor.redo();}
function inkUndo(){if(!strokes.length)return;const s=strokes.pop();inkRedo.push(s);retireStroke(s);redrawInk();updatePad();}
function inkRedoFn(){if(!inkRedo.length)return;const s=inkRedo.pop();s.born=Date.now();strokes.push(s);persistStroke(s);redrawInk();updatePad();}

/* stroke input */
function widthFor(pr){const eff=(pr>0&&pr<1)?pr:0.5;const base=mode==='eraser'?inkSize*3:mode==='hl'?inkSize*2.2:inkSize;const mul=mode==='pen'?(0.55+0.9*eff):1;return base*mul/drawW;}
cv.addEventListener('pointerdown',e=>{if(mode==='grab'){grabDown(e);return;}if(!isDraw(mode))return;if(e.button!==undefined&&e.button!==0)return;e.preventDefault();cv.setPointerCapture(e.pointerId);drawing=true;const p=ptFromEvent(e);active={kind:'stroke',tool:mode,color:inkColor,t:Date.now(),pts:[{xn:p.xn,yn:p.yn,wn:widthFor(e.pressure)}],minYn:p.yn,maxYn:p.yn};styleFor(active);const a=active.pts[0];ctx.beginPath();ctx.arc(sx(a.xn),sy(a.yn),Math.max(.5,a.wn*drawW/2),0,7);ctx.fill();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;});
cv.addEventListener('pointermove',e=>{if(mode==='grab'){grabMove(e);return;}if(!drawing||!active)return;e.preventDefault();const p=ptFromEvent(e),pts=active.pts,prev=pts[pts.length-1],np={xn:p.xn,yn:p.yn,wn:widthFor(e.pressure)};pts.push(np);if(p.yn<active.minYn)active.minYn=p.yn;if(p.yn>active.maxYn)active.maxYn=p.yn;styleFor(active);ctx.lineWidth=Math.max(.5,(prev.wn+np.wn)/2*drawW);ctx.beginPath();ctx.moveTo(sx(prev.xn),sy(prev.yn));ctx.lineTo(sx(np.xn),sy(np.yn));ctx.stroke();ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;});
function endStroke(){if(!active)return;const s=active;active=null;drawing=false;s.pid=pid;addViewStroke(s);redrawInk();}
cv.addEventListener('pointerup',e=>{if(mode==='grab'){grabUp(e);return;}if(drawing)endStroke();});
cv.addEventListener('pointercancel',e=>{if(mode==='grab'){grabUp(e);return;}if(drawing)endStroke();});
cv.addEventListener('wheel',e=>{if(isDraw(mode)||mode==='hand'){e.preventDefault();wrap.scrollTop+=e.deltaY;wrap.scrollLeft+=e.deltaX;}},{passive:false});
// hand tool: drag the page around (for a page wider or taller than the window, with a mouse)
let _pan=null;
cv.addEventListener('pointerdown',e=>{if(mode!=='hand'||(e.button!==undefined&&e.button!==0))return;e.preventDefault();cv.setPointerCapture(e.pointerId);_pan={x:e.clientX,y:e.clientY,l:wrap.scrollLeft,t:wrap.scrollTop};cv.classList.add('panning');});
cv.addEventListener('pointermove',e=>{if(!_pan)return;wrap.scrollLeft=_pan.l-(e.clientX-_pan.x);wrap.scrollTop=_pan.t-(e.clientY-_pan.y);});
const _panEnd=()=>{if(!_pan)return;_pan=null;cv.classList.remove('panning');saveMeta();};cv.addEventListener('pointerup',_panEnd);cv.addEventListener('pointercancel',_panEnd);
wrap.addEventListener('scroll',()=>{redrawInk();hideTagbar();saveMeta();},{passive:true});

/* marks CRUD */
async function addMark(obj,open){const m=Object.assign({pid,type:'note',name:'',tags:[],created:Date.now(),done:false,doneAt:null,links:[],anchor:{kind:'time',yn:0}},obj);try{const id=await db.marks.add(stripId(m));m.id=id;}catch(e){console.error(e);return null;}marks.push(m);syncPing('marks');redrawInk();flashPin(m.id);if(open)openMarkPopup(m);return m;}
let _saveTimers={};
function saveMark(m){clearTimeout(_saveTimers[m.id]);_saveTimers[m.id]=setTimeout(()=>{db.marks.update(m.id,{type:m.type,name:m.name,tags:m.tags,done:m.done,doneAt:m.doneAt,links:m.links,anchor:m.anchor,snippet:m.snippet||'',created:m.created,fields:m.fields||{},hover:m.hover||'',hoverSrc:m.hoverSrc||null}).then(()=>syncPing('marks')).catch(e=>console.error(e));},300);}
async function hardDeleteMark(m){await db.marks.delete(m.id);syncPing('marks');if(m.anchor&&m.anchor.kind==='text'&&editor)editor.clearMarkRuns(m.id);for(const q of marks)if(q.links&&q.links.includes(m.id)){q.links=q.links.filter(x=>x!==m.id);saveMark(q);}marks=marks.filter(x=>x!==m);redrawInk();}
let _mkCleanT=null,_mkCleanId=null;
function softDeleteMark(m){const isText=m.anchor&&m.anchor.kind==='text';const qedits=[];for(const q of marks)if(q!==m&&q.links&&q.links.includes(m.id)){qedits.push(q);q.links=q.links.filter(x=>x!==m.id);saveMark(q);}const snap=JSON.parse(JSON.stringify(m));db.marks.delete(m.id).then(()=>syncPing('marks')).catch(()=>{});marks=marks.filter(x=>x!==m);if(isText&&editor)editor.refresh();redrawInk();if(isText){clearTimeout(_mkCleanT);_mkCleanId=m.id;_mkCleanT=setTimeout(()=>{if(editor&&_mkCleanId!=null)editor.clearMarkRuns(_mkCleanId);_mkCleanId=null;},6400);}toast('Deleted','ok',{label:'Undo',fn:()=>{if(isText){clearTimeout(_mkCleanT);_mkCleanId=null;}db.marks.put(snap).catch(()=>{});marks.push(snap);for(const q of qedits)if(!q.links.includes(snap.id)){q.links.push(snap.id);saveMark(q);}if(isText&&editor)editor.refresh();redrawInk();}});}
async function deleteMark(m){return hardDeleteMark(m);}

/* projects core */
function _quotaToast(e){if(e&&(e.name==='QuotaExceededError'||/quota/i.test((e.name||'')+(e.message||'')))){toast('Storage is full — back up, then remove some images so saving can continue','err');}else if(e){console.error(e);}}
async function savePageNow(){if(!editor||pid==null)return;try{if(typeof internImages==='function')await internImages();await db.pages.put({pid,html:editor.getHTML(),scrollYn:scrollTop()/drawW,gutterW,ww:pageWW||undefined,bg:pageBg||undefined});}catch(e){_quotaToast(e);}}
function saveMeta(){clearTimeout(_metaTimer);_metaTimer=setTimeout(async()=>{try{if(editor&&pid!=null&&typeof internImages==='function')await internImages();if(editor&&pid!=null)await db.pages.put({pid,html:editor.getHTML(),scrollYn:scrollTop()/drawW,gutterW,ww:pageWW||undefined,bg:pageBg||undefined});if(!IS_MINI)await db.meta.put({id:'meta',activePid:pid});}catch(e){_quotaToast(e);}},500);}
function markDirty(){saveMeta();if(typeof historyNote==='function')historyNote();}
function contentBottomPx(){let mx=0;const wr=wrap.getBoundingClientRect();const er=noteEd.getBoundingClientRect();mx=Math.max(mx,(er.bottom-wr.top)+scrollTop());for(const s of strokes)mx=Math.max(mx,s.maxYn*inkU(s)+inkDy(s));for(const m of pageMarks())if(m.anchor&&m.anchor.kind==='time')mx=Math.max(mx,m.anchor.yn*drawW);return mx;}
function lineRanges(){const wr=wrap.getBoundingClientRect();const out=[];noteEd.querySelectorAll(':scope > *').forEach(el=>{const txt=(el.textContent||'').trim();const hasImg=el.querySelector&&el.querySelector('img');if(!txt&&!hasImg)return;const r=el.getBoundingClientRect();out.push([(r.top-wr.top)+scrollTop(),(r.bottom-wr.top)+scrollTop()]);});return out;}
let _pruneT=null;function schedulePrune(){clearTimeout(_pruneT);_pruneT=setTimeout(pruneOrphanTimestamps,600);}
function pruneOrphanTimestamps(){if(!editor)return false;const ranges=lineRanges();const emptyDoc=ranges.length===0&&strokes.length===0;const band=22;const now=Date.now();const toDel=[];for(const m of pageMarks()){if(!(m.anchor&&m.anchor.kind==='time'&&!searchable(m)))continue;if(now-m.created<8000)continue;if(!m.auto&&!emptyDoc)continue;const py=m.anchor.yn*drawW;let cov=false;for(const r of ranges){if(py>=r[0]-band&&py<=r[1]+band){cov=true;break;}}if(!cov)for(const s of strokes){if(py>=s.minYn*drawW-band&&py<=s.maxYn*drawW+band){cov=true;break;}}if(!cov)toDel.push(m);}if(!toDel.length)return false;for(const m of toDel){const i=marks.indexOf(m);if(i>=0)marks.splice(i,1);if(m.id!=null)db.marks.delete(m.id).catch(()=>{});}redrawInk();if(typeof refreshSideLive==='function')refreshSideLive();return true;}
function distToSeg(px,py,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1,l2=dx*dx+dy*dy;if(l2===0)return Math.hypot(px-x1,py-y1);let t=((px-x1)*dx+(py-y1)*dy)/l2;t=Math.max(0,Math.min(1,t));return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));}
function strokeHit(s,px,py){const p=s.pts,U=inkU(s),d=inkDy(s),st=scrollTop(),sl=wrap.scrollLeft;for(let i=0;i<p.length;i++){const w=(p[i].wn||0.005)*U/2+8;const ax=gutter+p[i].xn*U-sl,ay=p[i].yn*U+d-st;if(i===0){if(Math.hypot(ax-px,ay-py)<=w)return true;continue;}const bx=gutter+p[i-1].xn*U-sl,by=p[i-1].yn*U+d-st;if(distToSeg(px,py,bx,by,ax,ay)<=w)return true;}return false;}
function strokeBBox(s){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;const U=inkU(s),d=inkDy(s),st=scrollTop(),sl=wrap.scrollLeft;for(const pt of s.pts){const X=gutter+pt.xn*U-sl,Y=pt.yn*U+d-st;if(X<x0)x0=X;if(X>x1)x1=X;if(Y<y0)y0=Y;if(Y>y1)y1=Y;}return{x0,y0,x1,y1};}
function drawGrabOverlay(){ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';for(const s of grabSel){const bb=strokeBBox(s);ctx.strokeStyle='#818cf8';ctx.lineWidth=1.2;ctx.setLineDash([4,3]);ctx.strokeRect(bb.x0-3,bb.y0-3,(bb.x1-bb.x0)+6,(bb.y1-bb.y0)+6);}if(grabMode==='box'&&grabBox){const x0=Math.min(grabBox.x0,grabBox.x1),y0=Math.min(grabBox.y0,grabBox.y1),w=Math.abs(grabBox.x1-grabBox.x0),h=Math.abs(grabBox.y1-grabBox.y0);ctx.fillStyle='rgba(129,140,248,.12)';ctx.fillRect(x0,y0,w,h);ctx.strokeStyle='#818cf8';ctx.setLineDash([4,3]);ctx.lineWidth=1.2;ctx.strokeRect(x0,y0,w,h);}ctx.setLineDash([]);ctx.restore();}
function grabDown(e){if(e.button!==undefined&&e.button!==0)return;e.preventDefault();if(editor&&editor.hasPickedImage())editor.unpickImage();try{cv.setPointerCapture(e.pointerId);}catch(_){}const p=ptFromEvent(e),px=p.cx,py=p.cy;grabActive=true;grabMoved=false;grabStart={px,py};if(grabSel.size){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const s of grabSel){const bb=strokeBBox(s);if(bb.x0<x0)x0=bb.x0;if(bb.y0<y0)y0=bb.y0;if(bb.x1>x1)x1=bb.x1;if(bb.y1>y1)y1=bb.y1;}if(px>=x0-8&&px<=x1+8&&py>=y0-8&&py<=y1+8){grabMode='move';redrawInk();drawGrabOverlay();return;}}let hit=null;for(let i=strokes.length-1;i>=0;i--){if(strokeHit(strokes[i],px,py)){hit=strokes[i];break;}}if(hit){if(!grabSel.has(hit)){if(!e.shiftKey)grabSel.clear();grabSel.add(hit);}grabMode='move';}else{const pa=typeof picAt==='function'&&picAt(e.clientX,e.clientY);if(pa){grabActive=false;grabSel.clear();try{cv.releasePointerCapture(e.pointerId);}catch(_){}redrawInk();picStartDrag(pa.p,e,pa.handle);return;}
    const im=imageAt(e.clientX,e.clientY);if(im){grabActive=false;grabSel.clear();try{cv.releasePointerCapture(e.pointerId);}catch(_){}redrawInk();editor.pickImage(im,e.clientX,e.clientY);return;}   // no ink here, but a picture: pick it (menu + drag)
    if(!e.shiftKey)grabSel.clear();grabMode='box';grabBox={x0:px,y0:py,x1:px,y1:py};}redrawInk();drawGrabOverlay();}
// the picture under a screen point (the ink layer sits on top of the page, so look underneath it)
function imageAt(x,y){for(const el of document.elementsFromPoint(x,y)){const w=el.closest&&el.closest('.img-run');if(w&&noteEd.contains(w))return w;}return null;}
function grabMove(e){if(!grabActive)return;e.preventDefault();const p=ptFromEvent(e),px=p.cx,py=p.cy;grabMoved=true;if(grabMode==='move'){for(const s of grabSel){const U=inkU(s),dxn=(px-grabStart.px)/U,dyn=(py-grabStart.py)/U;for(const pt of s.pts){pt.xn+=dxn;pt.yn+=dyn;}s.minYn+=dyn;s.maxYn+=dyn;}grabStart={px,py};}else if(grabMode==='box'){grabBox.x1=px;grabBox.y1=py;const x0=Math.min(grabBox.x0,px),x1=Math.max(grabBox.x0,px),y0=Math.min(grabBox.y0,py),y1=Math.max(grabBox.y0,py);grabSel.clear();for(const s of strokes){const bb=strokeBBox(s);if(bb.x1>=x0&&bb.x0<=x1&&bb.y1>=y0&&bb.y0<=y1)grabSel.add(s);}}redrawInk();drawGrabOverlay();}
function grabUp(e){if(!grabActive)return;grabActive=false;try{cv.releasePointerCapture(e.pointerId);}catch(_){}if(grabMode==='move'&&grabMoved){const now=Date.now();for(const s of grabSel){retireStroke(s,now);s.born=now;inkDy(s);reanchor(s);persistStroke(s);}saveMeta();schedulePrune();}grabMode=null;grabBox=null;redrawInk();drawGrabOverlay();}

let _lastHTML=null;
function checkText(){if(!editor)return;const html=editor.getHTML();if(html!==_lastHTML){const first=_lastHTML===null;_lastHTML=html;updatePad();if(!first){if(typeof schedulePrune==='function')schedulePrune();}saveMeta();}}
async function switchProject(npid){
  if(npid===pid&&editor)return;
  if(editor&&projectOpenElsewhere(npid)){toast('That project is open in another editor window \u2014 close it there first','err');return;}
  if((IS_CLASS||(typeof clsMainIsClass==='function'&&clsMainIsClass()))&&editor&&!isShared(npid)){const p=projects.find(x=>x.id===npid);if(!p||!await setShared(p,true))return;}   // the CLASS side only opens sharable projects
  if(typeof historyFlush==='function')await historyFlush();
  if(editor&&pid!=null)await savePageNow();
  pid=npid;
  const pg=(await db.pages.get(pid))||{};
  strokes=(await db.strokes.where('pid').equals(pid).toArray()).filter(s=>!s.del);inkRedo=[];
  if(typeof picsLoad==='function')await picsLoad();
  gutterW=pg.gutterW||0;pageWW=pageWidthFor(pg,pid);pageBg=PAGE_BGS.includes(pg.bg)?pg.bg:'';
  if(typeof extBeforePageLoad==='function')await extBeforePageLoad(pg);
  if(editor){editor.setHTML(pg.html||'');_lastHTML=editor.getHTML();}
  layout();if(typeof extAfterPageLoad==='function')extAfterPageLoad();
  const pr=projects.find(x=>x.id===pid);document.getElementById('proj-name').textContent=pr?pr.name:'';
  if(!IS_MINI)db.meta.put({id:'meta',activePid:pid});syncPing('switch');
  requestAnimationFrame(()=>{wrap.scrollTop=(pg.scrollYn||0)*drawW;redrawInk();});setTimeout(pruneOrphanTimestamps,500);
  setMode('text');
}
async function newProject(name){const id=await db.projects.add(Object.assign({name:(name||'Untitled').slice(0,60),created:Date.now(),folder:curFolder||null},IS_CLASS||(typeof clsMainIsClass==='function'&&clsMainIsClass())?{shared:true}:{}));projects=await db.projects.toArray();await switchProject(id);renderProjects();}
function renameProject(p,name){p.name=(name||p.name).slice(0,60);db.projects.update(p.id,{name:p.name}).then(()=>syncPing('projects'));projNamesChanged();}
// a project's name shows in several places (toolbar, pop-up editor titles, panels): refresh them all
function projNamesChanged(){const pr=projects.find(x=>x.id===pid);document.getElementById('proj-name').textContent=pr?pr.name:'';renderProjects();miniTitles();if(typeof updateBackupLabels==='function')updateBackupLabels();if(typeof aiRender==='function')aiRender();if(typeof clsRender==='function')clsRender();}
async function deleteProject(p){
  if(projects.length<=1){toast('Keep at least one project','err');return;}
  const others=projects.filter(x=>x.id!==p.id);
  const snapProj={id:p.id,name:p.name,created:p.created};
  const snapPage=(await db.pages.get(p.id))||null;
  const snapStrokes=await db.strokes.where('pid').equals(p.id).toArray();const snapPics=await db.pics.where('pid').equals(p.id).toArray();
  const snapMarks=marks.filter(m=>m.pid===p.id).map(m=>JSON.parse(JSON.stringify(m)));
  const snapHist=await db.snaps.where('pid').equals(p.id).toArray();
  const gone=snapMarks.map(m=>m.id);const qedits=[];
  for(const q of marks)if(q.pid!==p.id&&q.links&&q.links.some(id=>gone.includes(id))){const removed=q.links.filter(id=>gone.includes(id));qedits.push({q,removed});q.links=q.links.filter(id=>!gone.includes(id));saveMark(q);}
  await db.pages.delete(p.id);await db.strokes.where('pid').equals(p.id).delete();await db.pics.where('pid').equals(p.id).delete();await db.marks.where('pid').equals(p.id).delete();await db.snaps.where('pid').equals(p.id).delete();await db.projects.delete(p.id);
  marks=marks.filter(m=>m.pid!==p.id);projects=projects.filter(x=>x.id!==p.id);
  if(pid===p.id)await switchProject(others[0].id);
  renderProjects();if(typeof updateBackupLabels==='function')updateBackupLabels();
  toast('Project deleted','ok',{label:'Undo',fn:async()=>{
    await db.projects.put(snapProj);if(snapPage)await db.pages.put(snapPage);
    for(const m of snapMarks)await db.marks.put(m);
    if(snapHist.length)await db.snaps.bulkPut(snapHist);
    for(const sk of snapStrokes){const c=Object.assign({},sk);delete c.id;c.pid=snapProj.id;await db.strokes.add(c);}
    for(const pk of snapPics){const c=Object.assign({},pk);delete c.id;c.pid=snapProj.id;await db.pics.add(c);}
    for(const {q,removed} of qedits)for(const id of removed)if(!q.links.includes(id)){q.links.push(id);saveMark(q);}
    projects=await db.projects.toArray();marks=await db.marks.toArray();
    await switchProject(snapProj.id);renderProjects();if(typeof updateBackupLabels==='function')updateBackupLabels();
  }});
}

/* draggable panels */
function makeDraggable(panel,handle){let sx0,sy0,l0,t0,on=false;handle.addEventListener('pointerdown',e=>{if(e.target.closest('.panel-x')||e.target.closest('input')||e.target.closest('button'))return;on=true;handle.classList.add('drag');const r=panel.getBoundingClientRect();panel.style.left=r.left+'px';panel.style.top=r.top+'px';panel.style.right='auto';sx0=e.clientX;sy0=e.clientY;l0=r.left;t0=r.top;handle.setPointerCapture(e.pointerId);});handle.addEventListener('pointermove',e=>{if(!on)return;panel.style.left=Math.max(4,Math.min(window.innerWidth-60,l0+e.clientX-sx0))+'px';panel.style.top=Math.max(4,Math.min(window.innerHeight-60,t0+e.clientY-sy0))+'px';});const end=()=>{on=false;handle.classList.remove('drag');};handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);}
function typeIcon(t){const c=mtype(t).c;if(!['note','task','question','answer'].includes(t))return '<svg width="15" height="15" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.5" fill="'+c+'"/></svg>';const m={note:'<path d="M6 4h12v16l-6-3-6 3z"/>',task:'<path d="M5 12l4 4L19 6"/>',question:'<path d="M9 9a3 3 0 1 1 4 2.8c-1 .5-1 1-1 2.2"/><circle cx="12" cy="18" r="1"/>',answer:'<path d="M21 12a9 9 0 1 1-9-9"/><path d="M9 12l2 2 5-5"/>'}[t]||'';return '<svg width="15" height="15" viewBox="0 0 24 24" stroke="'+c+'" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">'+m+'</svg>';}

/* mark popup */
let popup=null,popupMark=null;
function ensurePopup(){if(popup)return popup;popup=document.createElement('div');popup.className='panel';popup.style.display='none';popup.innerHTML='<div class="panel-h"><div class="panel-ic"></div><div class="panel-t"></div><button class="panel-x">\u00d7</button></div><div class="panel-b"></div><div class="panel-f"><button class="pok">OK</button><span class="psave"></span><button class="pdel">Delete</button></div>';document.body.appendChild(popup);popup.querySelector('.panel-x').onclick=closePopup;popup.querySelector('.pdel').onclick=()=>{if(!popupMark)return;const m=popupMark;closePopup();softDeleteMark(m);};popup.querySelector('.pok').onclick=closePopup;makeDraggable(popup,popup.querySelector('.panel-h'));return popup;}
function closePopup(){if(popup)popup.style.display='none';popupMark=null;}
function flagSaved(){const e=popup&&popup.querySelector('.psave');if(e){e.textContent='saved';clearTimeout(e._t);e._t=setTimeout(()=>e.textContent='',1200);}}
function openMarkPopup(m){
  ensurePopup();popupMark=m;
  popup.querySelector('.panel-ic').innerHTML=typeIcon(m.type);
  popup.querySelector('.panel-t').textContent=mtype(m.type).name;
  buildPopupBody(m);popup.style.display='flex';
  let py=120;const hit=pinHits.find(h=>h.m===m);const bar=document.getElementById('bar1').offsetHeight+document.getElementById('bar2').offsetHeight;
  if(hit)py=bar+hit.y;py=Math.max(60,Math.min(window.innerHeight-360,py));
  popup.style.left=Math.min(gutter+16,window.innerWidth-346)+'px';popup.style.top=py+'px';popup.style.right='auto';
  setTimeout(()=>{const ni=popup.querySelector('.pf-in');if(ni&&!m.name)ni.focus();},30);
}
function buildPopupBody(m){
  const b=popup.querySelector('.panel-b');b.innerHTML='';
  const nf=document.createElement('div');nf.className='pf';nf.innerHTML='<div class="pf-l">Name</div>';
  const ni=document.createElement('input');ni.className='pf-in';ni.placeholder='Name\u2026';ni.value=m.name||'';
  ni.oninput=()=>{m.name=ni.value;saveMark(m);redrawInk();flagSaved();};nf.appendChild(ni);b.appendChild(nf);
  const tf=document.createElement('div');tf.className='pf';tf.innerHTML='<div class="pf-l">Type</div>';
  const seg=document.createElement('div');seg.className='seg wrap';
  const types=activeTypeIds().slice();if(!types.includes(m.type))types.unshift(m.type);
  types.forEach(t=>{const bt=document.createElement('button');bt.className=(m.type===t?'on':'');bt.innerHTML='<span class="tb-dot" style="width:8px;height:8px;border-radius:50%;background:'+mtype(t).c+'"></span>'+esc(mtype(t).name);bt.onclick=()=>{m.type=t;saveMark(m);redrawInk();if(editor&&m.anchor&&m.anchor.kind==='text')editor.refresh();openMarkPopup(m);};seg.appendChild(bt);});
  tf.appendChild(seg);b.appendChild(tf);
  const T=ht(m.type);
  // the type's card fields (defined in the Highlight Factory)
  (T.fields||[]).forEach(f=>{const ff=document.createElement('div');ff.className='pf';ff.innerHTML='<div class="pf-l">'+esc(f.label)+'</div>';const ta=document.createElement('textarea');ta.className='pf-in pf-ta';ta.rows=2;ta.placeholder=f.label+'…';ta.value=(m.fields&&m.fields[f.id])||'';ta.oninput=()=>{m.fields=m.fields||{};m.fields[f.id]=ta.value;saveMark(m);flagSaved();};ff.appendChild(ta);b.appendChild(ff);});
  const gf=document.createElement('div');gf.className='pf';gf.innerHTML='<div class="pf-l">Tags</div>';
  const gw=document.createElement('div');gw.className='chips';
  const gi=document.createElement('input');gi.className='tagin';gi.placeholder='add tag ↵';gi.maxLength=32;
  function renderTags(){gw.innerHTML='';(m.tags||[]).forEach(tg=>{const c=document.createElement('span');c.className='chip';c.innerHTML=esc(tg)+' <b>×</b>';c.querySelector('b').onclick=()=>{m.tags=m.tags.filter(x=>x!==tg);saveMark(m);renderTags();flagSaved();};gw.appendChild(c);});gw.appendChild(gi);}
  gi.onkeydown=e=>{if(e.key!=='Enter')return;e.preventDefault();const v=gi.value.trim().toLowerCase().slice(0,32);if(!v)return;m.tags=m.tags||[];if(!m.tags.includes(v))m.tags.push(v);gi.value='';saveMark(m);renderTags();gi.focus();flagSaved();};
  gf.appendChild(gw);b.appendChild(gf);renderTags();
  if(T.hover){const hf=document.createElement('div');hf.className='pf';hf.innerHTML='<div class="pf-l">Own hover text — optional; otherwise the type’s hover text shows</div>';const ht2=document.createElement('textarea');ht2.className='pf-in pf-ta';ht2.rows=3;ht2.placeholder='Write something…';ht2.value=m.hover||'';ht2.oninput=()=>{m.hover=ht2.value;m.hoverSrc=null;saveMark(m);flagSaved();};hf.appendChild(ht2);
    if(m.hoverSrc){const src=document.createElement('div');src.className='pf-time';src.textContent='from “'+projName(m.hoverSrc)+'”';hf.appendChild(src);}
    const pk=document.createElement('button');pk.className='pbtn';pk.textContent='⎘ pick text from another project';pk.onclick=()=>openTextPicker((txt,from)=>{m.hover=txt;m.hoverSrc=from;saveMark(m);buildPopupBody(m);flagSaved();});hf.appendChild(pk);b.appendChild(hf);}
  const wf=document.createElement('div');wf.className='pf';wf.innerHTML='<div class="pf-l">Time added</div><div class="pf-time">'+fmtAbs(m.created)+'</div>';b.appendChild(wf);
  if(T.checkable){
    const cf=document.createElement('div');cf.className='pf';
    const row=document.createElement('label');row.className='pf-row';
    const cb=document.createElement('input');cb.type='checkbox';cb.className='pf-cb';cb.checked=!!m.done;
    cb.onchange=()=>{m.done=cb.checked;m.doneAt=cb.checked?Date.now():null;saveMark(m);redrawInk();buildPopupBody(m);flagSaved();};
    row.appendChild(cb);row.appendChild(document.createTextNode(' Completed'));cf.appendChild(row);
    if(m.done&&m.doneAt){const w2=document.createElement('div');w2.className='pf-time';w2.style.marginTop='4px';w2.textContent='Completed: '+fmtAbs(m.doneAt);cf.appendChild(w2);}
    b.appendChild(cf);
  }
  // outgoing links: allowed when this type "links to" other types (Question -> Answer by default)
  const lt=(T.links||[]).filter(x=>HT.has(x));
  if(lt.length||(m.links&&m.links.length)){
    const names=lt.map(x=>mtype(x).name.toLowerCase());
    const qf=document.createElement('div');qf.className='pf';qf.innerHTML='<div class="pf-l">Links'+(names.length?' → '+esc(names.join(' / ')):'')+'</div>';
    const lw=document.createElement('div');lw.className='chips';
    (m.links||[]).forEach(id=>{const a=markById(id);const c=document.createElement('span');c.className='chip link';const lbl=a?(a.name||a.snippet||'(untitled)')+(a.pid!==m.pid?' · '+projName(a.pid):''):'(deleted)';c.innerHTML=(a?'<span class="tb-dot" style="width:7px;height:7px;border-radius:50%;background:'+mtype(a.type).c+'"></span>':'')+esc(lbl)+' <b>×</b>';c.onclick=e=>{if(e.target.tagName==='B')return;if(a)jumpToMark(a);};c.querySelector('b').onclick=e=>{e.stopPropagation();m.links=m.links.filter(x=>x!==id);saveMark(m);buildPopupBody(m);flagSaved();};lw.appendChild(c);});
    qf.appendChild(lw);
    if(lt.length){const add=document.createElement('button');add.className='pbtn';add.textContent='+ link '+(names.length===1?'a'+(/^[aeiou]/.test(names[0])?'n ':' ')+names[0]:'…');add.onclick=()=>openPicker(m.id,id=>{m.links=m.links||[];if(!m.links.includes(id))m.links.push(id);saveMark(m);buildPopupBody(m);flagSaved();},{types:lt});qf.appendChild(add);}
    b.appendChild(qf);
  }
  // incoming links
  const from=marks.filter(q=>q!==m&&(q.links||[]).includes(m.id));
  const targeted=[...HT.values()].some(x=>(x.links||[]).includes(m.type));
  if(from.length||targeted){
    const af=document.createElement('div');af.className='pf';af.innerHTML='<div class="pf-l">Linked from</div>';
    const lw=document.createElement('div');lw.className='chips';
    if(!from.length)lw.innerHTML='<span class="pf-time">not linked yet — link it from a '+esc([...HT.values()].filter(x=>(x.links||[]).includes(m.type)).map(x=>x.name.toLowerCase()).join(' / '))+'</span>';
    from.forEach(q=>{const c=document.createElement('span');c.className='chip link';c.innerHTML='<span class="tb-dot" style="width:7px;height:7px;border-radius:50%;background:'+mtype(q.type).c+'"></span>'+esc((q.name||'(untitled '+mtype(q.type).name.toLowerCase()+')')+(q.pid!==m.pid?' · '+projName(q.pid):''));c.onclick=()=>jumpToMark(q);lw.appendChild(c);});
    af.appendChild(lw);b.appendChild(af);
  }
  if(m.anchor&&m.anchor.kind==='time'){
    const mf=document.createElement('div');mf.className='pf';
    const mb=document.createElement('button');mb.className='pbtn';mb.textContent='\u2398 merge into another timestamp';
    mb.onclick=()=>openPicker(m.id,id=>mergeMarks(m,markById(id)),'timesame');
    mf.appendChild(mb);b.appendChild(mf);
  }
}
function mergeMarks(src,tgt){
  if(!tgt||tgt===src)return;
  tgt.name=tgt.name||src.name;
  tgt.tags=Array.from(new Set([...(tgt.tags||[]),...(src.tags||[])]));
  tgt.links=Array.from(new Set([...(tgt.links||[]),...(src.links||[])]));
  if(src.done&&!tgt.done){tgt.done=true;tgt.doneAt=src.doneAt||Date.now();}
  tgt.created=Math.min(tgt.created,src.created);
  for(const q of marks)if(q.links&&q.links.includes(src.id)){q.links=q.links.map(x=>x===src.id?tgt.id:x).filter((v,i,a)=>a.indexOf(v)===i);saveMark(q);}
  saveMark(tgt);deleteMark(src).then(()=>{redrawInk();openMarkPopup(tgt);toast('Merged','ok');});
}

/* picker (cross-project) */
let picker=null;
function openPicker(excludeId,onPick,filter){
  if(!picker){picker=document.createElement('div');picker.className='panel';picker.style.width='330px';picker.innerHTML='<div class="panel-h"><div class="panel-ic">'+typeIcon('answer')+'</div><div class="panel-t">Link</div><button class="panel-x">\u00d7</button></div><div class="panel-b"><input class="pf-in" id="pick-q" placeholder="Search marks\u2026"><div class="pk-list" id="pick-list"></div></div>';document.body.appendChild(picker);picker.querySelector('.panel-x').onclick=()=>picker.style.display='none';makeDraggable(picker,picker.querySelector('.panel-h'));}
  picker._exclude=excludeId;picker._onPick=onPick;picker._filter=filter;
  picker.querySelector('.panel-t').textContent=filter==='timesame'?'Merge into\u2026':'Link'+(filter&&filter.types?' \u2192 '+filter.types.map(x=>mtype(x).name).join(' / '):'');
  picker.style.display='flex';picker.style.left=Math.min((window.innerWidth-330)/2,window.innerWidth-340)+'px';picker.style.top='16vh';picker.style.right='auto';
  const q=picker.querySelector('#pick-q');q.value='';renderPicker('');q.oninput=()=>renderPicker(q.value);setTimeout(()=>q.focus(),20);
}
function renderPicker(q){
  const list=picker.querySelector('#pick-list');list.innerHTML='';const ql=q.toLowerCase();const f=picker._filter;const src=markById(picker._exclude);
  let cands=marks.filter(x=>x.id!==picker._exclude);
  if(f==='timesame')cands=cands.filter(x=>x.anchor&&x.anchor.kind==='time'&&x.pid===(src?src.pid:pid));
  else if(f&&f.types)cands=cands.filter(x=>f.types.includes(x.type));
  else cands=cands.filter(x=>(x.name&&x.name.trim())||x.type!=='note'||(x.snippet&&x.snippet.trim()));
  cands=cands.filter(x=>!ql||markText(x).includes(ql)).sort((a,b)=>b.created-a.created).slice(0,80);
  if(!cands.length){list.innerHTML='<div class="sr-empty" style="padding:18px">no matches</div>';return;}
  cands.forEach(x=>{const it=document.createElement('div');it.className='sr';const t=mtype(x.type);const pj=x.pid!==pid?' \u00b7 '+esc(projName(x.pid)):'';it.innerHTML='<span class="sr-b" style="background:'+t.bg+';color:'+t.c+'">'+t.label+'</span><div class="sr-main"><div class="sr-name">'+esc(x.name||x.snippet||fmtAbs(x.created))+'</div><div class="sr-meta">'+fmtTime(x.created)+'<span class="sr-proj">'+pj+'</span></div></div>';it.onclick=()=>{picker._onPick(x.id);picker.style.display='none';};list.appendChild(it);});
}

/* selection tag bar */
const tagbar=document.createElement('div');tagbar.id='tagbar';
// the selection bar is a window onto the active Highlight Profile
function buildTagbar(){tagbar.innerHTML='';activeTypeIds().forEach(t=>{const b=document.createElement('button');b.innerHTML='<span class="tb-dot" style="background:'+mtype(t).c+'"></span>'+esc(mtype(t).name);b.onmousedown=e=>e.preventDefault();b.onclick=()=>tagSelection(t);tagbar.appendChild(b);});const plus=document.createElement('button');plus.className='tb-plus';plus.title='New highlight type (Highlight Factory)';plus.textContent='+';plus.onmousedown=e=>e.preventDefault();plus.onclick=()=>{hideTagbar();if(typeof openFactory==='function')openFactory({create:true,applyToSelection:true});};tagbar.appendChild(plus);}
buildTagbar();
document.body.appendChild(tagbar);
function hideTagbar(){tagbar.classList.remove('show');}
function updateTagbar(){
  if(mode!=='text'||document.activeElement!==noteEd){hideTagbar();return;}
  const s=window.getSelection();if(!s||s.isCollapsed||!s.rangeCount){hideTagbar();return;}
  const r=s.getRangeAt(0);if(!noteEd.contains(r.commonAncestorContainer)){hideTagbar();return;}
  const rect=r.getBoundingClientRect();if(!rect||(!rect.width&&!rect.height)){hideTagbar();return;}
  tagbar.classList.add('show');const tw=tagbar.offsetWidth||300;
  tagbar.style.left=Math.max(6,Math.min(rect.left,window.innerWidth-tw-6))+'px';
  // above the selection, unless that would cover the toolbars (then just below it)
  const _top=stage.getBoundingClientRect().top,_above=rect.top-tagbar.offsetHeight-8;tagbar.style.top=(_above>=_top+4?_above:rect.bottom+8)+'px';
}
async function tagSelection(type){
  if(!editor.hasSelection()){toast('Select some text first','info');return;}
  const snip=editor.selText().slice(0,200);
  const m=await addMark({type,name:snip.slice(0,80),snippet:snip,anchor:{kind:'text'}},false);
  if(!m)return;
  if(editor.applyMark(m.id)){hideTagbar();redrawInk();flashPin(m.id);openMarkPopup(m);}else{await deleteMark(m);toast('Couldn\u2019t tag \u2014 try selecting again','err');}
}
document.addEventListener('selectionchange',()=>requestAnimationFrame(updateTagbar));

/* search helpers */
function markText(m){const T=ht(m.type);const fv=m.fields?Object.keys(m.fields).map(k=>{const v=m.fields[k];if(!v||!String(v).trim())return '';const f=(T.fields||[]).find(x=>x.id===k);return (f?f.label+' ':'')+v;}).join(' '):'';return ((m.name||'')+' '+(m.snippet||'')+' '+(m.tags||[]).join(' ')+' '+T.name+' '+fv+' '+projPath(m.pid)).toLowerCase();}
function searchable(m){return (m.name&&m.name.trim())||(m.tags&&m.tags.length)||m.type!=='note'||(m.anchor&&m.anchor.kind==='text')||m.done;}
async function jumpToMark(m){
  if(m.pid!==pid){await switchProject(m.pid);await new Promise(r=>requestAnimationFrame(r));}
  if(m.anchor&&m.anchor.kind==='time'){wrap.scrollTo({top:Math.max(0,m.anchor.yn*drawW-H*0.35),behavior:'smooth'});flashPin(m.id);setTimeout(()=>openMarkPopup(m),280);}
  else{const el=editor.markEl(m.id);if(el){const wr=wrap.getBoundingClientRect(),r=el.getBoundingClientRect();wrap.scrollTo({top:Math.max(0,scrollTop()+(r.top-wr.top)-H*0.35),behavior:'smooth'});el.classList.add('mark-flash');setTimeout(()=>el.classList.remove('mark-flash'),1100);}setTimeout(()=>openMarkPopup(m),280);}
}

/* projects panel */
let projPanel=null;
function ensureProjects(){if(projPanel)return projPanel;projPanel=document.createElement('div');projPanel.className='panel proj-panel';projPanel.style.display='none';
  projPanel.innerHTML='<div class="panel-h"><div class="panel-ic"><svg width="15" height="15" viewBox="0 0 24 24" stroke="#818cf8" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div><div class="panel-t">Projects</div><button class="panel-x">\u00d7</button></div><div class="panel-b"><div id="proj-crumb"></div><div id="proj-list"></div><div class="proj-new"><input class="pf-in" id="proj-new-in" placeholder="New project name\u2026" maxlength="60"><button id="proj-new-go" title="New project here">+</button></div><div style="margin-top:10px;padding-top:10px;border-top:1px solid #20202e;display:flex;flex-direction:column;gap:7px;"><div class="pf-l">Backup &amp; restore</div><div style="display:flex;gap:6px;flex-wrap:wrap;"><button class="pbtn" id="bk-proj">⤓ this project</button><button class="pbtn" id="bk-all">⤓ everything</button><button class="pbtn" id="bk-imp">⤑ import…</button></div><div class="pf-time">Importing always adds — it never overwrites what you have.</div><input type="file" id="bk-file" accept=".json,application/json,.pdf,application/pdf" style="display:none"></div></div>';
  document.body.appendChild(projPanel);
  projPanel.querySelector('.panel-x').onclick=()=>projPanel.style.display='none';
  const ni=projPanel.querySelector('#proj-new-in');const go=()=>{const v=ni.value.trim();if(!v)return;ni.value='';newProject(v);};
  projPanel.querySelector('#proj-new-go').onclick=go;ni.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();go();}};
  projPanel.querySelector('#bk-proj').onclick=()=>backupProject();projPanel.querySelector('#bk-all').onclick=()=>backupAll();const _bf=projPanel.querySelector('#bk-file');projPanel.querySelector('#bk-imp').onclick=()=>_bf.click();_bf.onchange=()=>{if(_bf.files[0]){importFile(_bf.files[0]);_bf.value='';}};makeDraggable(projPanel,projPanel.querySelector('.panel-h'));return projPanel;}
/* ===== folders: a light hierarchy around projects (organisation only; they don't own pages or the editor) ===== */
let folders=[],curFolder=null;   // curFolder: folder shown in the Projects panel (null = Home)
async function loadFolders(){try{folders=await db.folders.toArray();}catch(e){folders=[];}if(curFolder!=null&&!folders.some(f=>f.id===curFolder))curFolder=null;}
function folderById(id){return folders.find(f=>f.id===id);}
function folderPath(id){const out=[];let f=folderById(id),g=0;while(f&&g++<100){out.unshift(f);f=folderById(f.parent);}return out;}
function projPath(id){const p=projects.find(x=>x.id===id);if(!p)return '?';const fp=folderPath(p.folder).map(f=>f.name);return fp.length?fp.join(' / ')+' / '+p.name:p.name;}
function folderInside(id,anc){return folderPath(id).some(f=>f.id===anc);}
function folderCount(id){let n=projects.filter(p=>(p.folder||null)===id).length;for(const f of folders)if((f.parent||null)===id)n+=1+folderCount(f.id);return n;}
async function newFolder(name){await db.folders.add({name:name.slice(0,60),parent:curFolder,created:Date.now()});await loadFolders();syncPing('projects');renderProjects();}
async function moveItem(kind,id,to){to=to||null;if(kind==='folder'){if(id===to||(to!=null&&folderInside(to,id))){toast('A folder can’t go inside itself','err');return;}await db.folders.update(id,{parent:to});}else await db.projects.update(id,{folder:to});
  projects=await db.projects.toArray();await loadFolders();syncPing('projects');renderProjects();toast('Moved to '+(to?folderPath(to).map(f=>f.name).join(' / '):'Home'),'ok');}
// deleting a folder never deletes pages: whatever it held moves up to its parent (with undo)
async function deleteFolder(f){const kids=folders.filter(x=>(x.parent||null)===f.id).map(x=>x.id),pages=projects.filter(p=>(p.folder||null)===f.id).map(p=>p.id),up=f.parent||null,snap={...f};
  for(const k of kids)await db.folders.update(k,{parent:up});for(const p of pages)await db.projects.update(p,{folder:up});await db.folders.delete(f.id);
  projects=await db.projects.toArray();await loadFolders();syncPing('projects');renderProjects();
  toast('Folder “'+f.name+'” removed'+(kids.length+pages.length?' — its '+(kids.length+pages.length)+' item'+(kids.length+pages.length>1?'s':'')+' moved up':''),'ok',{label:'Undo',fn:async()=>{await db.folders.put(snap);for(const k of kids)await db.folders.update(k,{parent:snap.id});for(const p of pages)await db.projects.update(p,{folder:snap.id});projects=await db.projects.toArray();await loadFolders();syncPing('projects');renderProjects();}});}
function moveSelect(kind,id,cur,onDone){const sel=document.createElement('select');sel.className='fx-sel pr-move';const opt=(v,l,dis)=>{const o=document.createElement('option');o.value=v;o.textContent=l;if(dis)o.disabled=true;sel.appendChild(o);};
  opt('','Move to…',true);sel.value='';opt('home','Home',cur==null);
  const walk=(parent,depth)=>folders.filter(f=>(f.parent||null)===parent).sort((a,b)=>a.name.localeCompare(b.name)).forEach(f=>{const bad=kind==='folder'&&(f.id===id||folderInside(f.id,id));opt(f.id,'  '.repeat(depth)+'📁 '+f.name,bad||f.id===cur);if(!bad)walk(f.id,depth+1);});walk(null,1);
  sel.onchange=()=>{moveItem(kind,id,sel.value==='home'?null:+sel.value);};sel.onblur=()=>onDone&&onDone();return sel;}
// drag a project or folder onto a folder row, a breadcrumb item or the back row
let _drag=null;
function dragSource(row,kind,id){row.draggable=true;row.addEventListener('dragstart',e=>{_drag={kind,id};e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',kind+':'+id);}catch(_){}row.classList.add('dragging');});row.addEventListener('dragend',()=>{_drag=null;row.classList.remove('dragging');});}
function dropTarget(el,folderId){el.addEventListener('dragover',e=>{if(!_drag||(_drag.kind==='folder'&&(_drag.id===folderId||(folderId!=null&&folderInside(folderId,_drag.id)))))return;e.preventDefault();el.classList.add('drop');});el.addEventListener('dragleave',()=>el.classList.remove('drop'));el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('drop');const d=_drag;_drag=null;if(d)moveItem(d.kind,d.id,folderId);});}
/* project privacy: every project is private unless its owner makes it sharable. Private projects can never be
   broadcast to a classroom, sent over the AI board link or shared in any other way. */
function isShared(id){const p=projects.find(x=>x.id===id);return !!(p&&p.shared===true);}
function shareWarn(p){return new Promise(res=>{const m=document.createElement('div');m.className='cls-modal';
  m.innerHTML='<div class="panel cls-notice" role="dialog" aria-modal="true" aria-labelledby="sh-t"><div class="panel-h"><div class="panel-t" id="sh-t"></div></div><div class="panel-b">'+
    '<p>Private projects can never be broadcast to a classroom, sent to an AI or shared in any other way.</p>'+
    '<p>If you make this project <b>sharable</b>, it can be broadcast to your students and used by the AI board link, but only when you switch those on. <b>Everything on it (text, drawings, images, highlights) may then be seen by others.</b></p>'+
    '<p>You can make it private again at any time, which stops any sharing straight away.</p>'+
    '<div class="hw-row"><button class="fx-primary sh-ok">Make sharable</button><button class="pbtn sh-no">Keep private</button></div></div></div>';
  m.querySelector('.panel-t').textContent='Make \u201c'+p.name+'\u201d sharable?';document.body.appendChild(m);
  const k=e=>{if(e.key==='Escape'){e.stopPropagation();done(false);}};const done=v=>{m.remove();removeEventListener('keydown',k,true);res(v);};addEventListener('keydown',k,true);
  m.querySelector('.sh-ok').onclick=()=>done(true);m.querySelector('.sh-no').onclick=()=>done(false);m.onclick=e=>{if(e.target===m)done(false);};m.querySelector('.sh-no').focus();});}
async function setShared(p,on){if(on&&!await shareWarn(p))return false;p.shared=!!on;await db.projects.update(p.id,{shared:!!on});syncPing('projects');
  if(!on)document.dispatchEvent(new CustomEvent('pw-private',{detail:p.id}));document.dispatchEvent(new Event('pw-share-change'));renderProjects();toast('\u201c'+p.name+'\u201d is now '+(on?'sharable':'private'),'ok');return true;}
// right-click (or long-press) menu for project and folder rows
let _ctx=null;
function ctxMenu(x,y,items){if(!_ctx){_ctx=document.createElement('div');_ctx.className='panel ctx-menu';_ctx.style.display='none';document.body.appendChild(_ctx);
    document.addEventListener('pointerdown',e=>{if(_ctx.style.display!=='none'&&!_ctx.contains(e.target))_ctx.style.display='none';},true);
    addEventListener('keydown',e=>{if(e.key==='Escape')_ctx.style.display='none';});}
  _ctx.innerHTML='';items.forEach(it=>{if(!it){const h=document.createElement('div');h.className='ctx-sep';_ctx.appendChild(h);return;}
    const b=document.createElement('button');b.className='ctx-item'+(it.danger?' danger':'');b.textContent=it.label;b.onclick=e=>{e.stopPropagation();_ctx.style.display='none';it.fn();};_ctx.appendChild(b);});
  _ctx.style.display='flex';const w=_ctx.offsetWidth,h=_ctx.offsetHeight;_ctx.style.left=Math.max(4,Math.min(x,innerWidth-w-4))+'px';_ctx.style.top=Math.max(4,Math.min(y,innerHeight-h-4))+'px';_ctx.style.right='auto';}
function onRowMenu(row,items){row.addEventListener('contextmenu',e=>{e.preventDefault();ctxMenu(e.clientX,e.clientY,items());});
  let t=null;row.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;const x=e.clientX,y=e.clientY;t=setTimeout(()=>{t=null;row._longPress=true;ctxMenu(x,y,items());},550);});
  const stop=()=>{clearTimeout(t);t=null;};row.addEventListener('pointerup',stop);row.addEventListener('pointercancel',stop);row.addEventListener('pointermove',e=>{if(t&&e.pointerType==='touch')stop();});}
function renderProjects(){
  if(!projPanel)return;const list=projPanel.querySelector('#proj-list');list.innerHTML='';
  const crumb=projPanel.querySelector('#proj-crumb');crumb.innerHTML='';const cs=[{id:null,name:'Home'},...folderPath(curFolder)];
  cs.forEach((c,i)=>{if(i){const s=document.createElement('span');s.className='pc-sep';s.textContent='/';crumb.appendChild(s);}const b=document.createElement('button');b.className='pc-item'+(i===cs.length-1?' cur':'');b.textContent=c.name;b.onclick=()=>{curFolder=c.id;renderProjects();};dropTarget(b,c.id);crumb.appendChild(b);});const nf=document.createElement('button');nf.className='pc-new';nf.title='New folder here';nf.textContent='\ud83d\udcc1+';nf.onclick=()=>{const ni=projPanel.querySelector('#proj-new-in');const v=ni.value.trim()||'New folder';ni.value='';newFolder(v);};crumb.appendChild(nf);
  const rename=(row,nm,cur,save)=>e=>{e.stopPropagation();const inp=document.createElement('input');inp.className='pf-in';inp.value=cur;inp.style.flex='1';row.replaceChild(inp,nm);inp.focus();inp.onclick=ev=>ev.stopPropagation();inp.onblur=()=>save(inp.value.trim());inp.onkeydown=ev=>{if(ev.key==='Enter')inp.blur();};};
  const mover=(row,kind,id,cur)=>e=>{e.stopPropagation();const s=moveSelect(kind,id,cur,()=>renderProjects());row.appendChild(s);s.focus();s.onclick=ev=>ev.stopPropagation();};
  if(curFolder!=null){const up=document.createElement('div');up.className='proj-row pr-up';up.textContent='← '+(folderPath(curFolder).length>1?folderPath(curFolder).slice(-2)[0].name:'Home');up.onclick=()=>{curFolder=folderById(curFolder).parent||null;renderProjects();};dropTarget(up,folderById(curFolder).parent||null);list.appendChild(up);}
  folders.filter(f=>(f.parent||null)===curFolder).sort((a,b)=>a.name.localeCompare(b.name)).forEach(f=>{const row=document.createElement('div');row.className='proj-row pr-folder';
    const nm=document.createElement('div');nm.className='pr-name';nm.textContent='📁 '+f.name;const cn=document.createElement('span');cn.className='pr-cnt';cn.textContent=folderCount(f.id);cn.title='items inside (folders and projects)';
    const ren=rename(row,nm,f.name,v=>{if(v)db.folders.update(f.id,{name:v.slice(0,60)}).then(loadFolders).then(()=>{syncPing('projects');renderProjects();});else renderProjects();});
    onRowMenu(row,()=>[{label:'Rename',fn:()=>ren(new Event('x'))},{label:'Move to…',fn:()=>mover(row,'folder',f.id,f.parent||null)(new Event('x'))},null,{label:'Delete folder (its contents move up)',danger:true,fn:()=>deleteFolder(f)}]);
    row.onclick=()=>{if(row._longPress){row._longPress=false;return;}curFolder=f.id;renderProjects();};dragSource(row,'folder',f.id);dropTarget(row,f.id);[nm,cn].forEach(x=>row.appendChild(x));list.appendChild(row);});
  projects.filter(p=>(p.folder||null)===curFolder).forEach(p=>{const shared=p.shared===true;
    const row=document.createElement('div');row.className='proj-row'+(p.id===pid?' cur':'');
    const nm=document.createElement('div');nm.className='pr-name';nm.textContent=p.name;
    const lk=document.createElement('button');lk.className='pr-lock'+(shared?' open':'');lk.textContent=shared?'\ud83d\udd13':'\ud83d\udd12';
    lk.title=shared?'Sharable: can be broadcast or used by the AI link. Click to make private':'Private: never shared. Click to make sharable';lk.onclick=e=>{e.stopPropagation();setShared(p,!shared);};
    const ren=rename(row,nm,p.name,v=>renameProject(p,v));
    row.onclick=e=>{if(row._longPress){row._longPress=false;return;}if(e.target.closest('.pr-lock,select,input'))return;switchProject(p.id).then(renderProjects);projPanel.style.display='none';};
    onRowMenu(row,()=>[{label:shared?'\ud83d\udd12 Make private':'\ud83d\udd13 Make sharable\u2026',fn:()=>setShared(p,!shared)},null,{label:'Rename',fn:()=>ren(new Event('x'))},{label:'Move to…',fn:()=>mover(row,'project',p.id,p.folder||null)(new Event('x'))},null,{label:'Delete',danger:true,fn:()=>deleteProject(p)}]);
    dragSource(row,'project',p.id);[nm,lk].forEach(x=>row.appendChild(x));list.appendChild(row);});
  if(!list.children.length||(curFolder!=null&&list.children.length===1)){const e=document.createElement('div');e.className='sr-empty';e.style.padding='14px';e.textContent='Empty folder — add a project or folder below, or move one here.';list.appendChild(e);}
}
function openProjects(){ensureProjects();renderProjects();projPanel.style.display='flex';projPanel.style.left=Math.min(70,window.innerWidth-340)+'px';projPanel.style.top='70px';projPanel.style.right='auto';}

/* gutter interaction */
let _pinDrag=null,_pinMoved=false,_suppressGut=false;
gut.addEventListener('pointerdown',e=>{if(e.target.closest('#gut-tools')||e.target.closest('#gut-grip'))return;const r=wrap.getBoundingClientRect();const cy=e.clientY-r.top;let best=null,bd=15;for(const h of pinHits){const d=Math.abs(h.y-cy);if(d<bd){bd=d;best=h.m;}}if(!best||!(best.anchor&&best.anchor.kind==='time'))return;_pinDrag={m:best,startY:e.clientY};_pinMoved=false;try{gut.setPointerCapture(e.pointerId);}catch(_){}});
gut.addEventListener('pointermove',e=>{if(!_pinDrag){const r=wrap.getBoundingClientRect();const cy=e.clientY-r.top;let near=false;for(const h of pinHits){if(Math.abs(h.y-cy)<15&&h.m.anchor&&h.m.anchor.kind==='time'){near=true;break;}}gut.style.cursor=near?'grab':'';return;}if(!_pinMoved&&Math.abs(e.clientY-_pinDrag.startY)<4)return;_pinMoved=true;e.preventDefault();gut.style.cursor='grabbing';const r=wrap.getBoundingClientRect();const yn=((e.clientY-r.top)+scrollTop())/drawW;_pinDrag.m.anchor.yn=Math.max(0,yn);redrawInk();});
gut.addEventListener('pointerup',e=>{if(!_pinDrag)return;const m=_pinDrag.m,moved=_pinMoved;_pinDrag=null;gut.style.cursor='';try{gut.releasePointerCapture(e.pointerId);}catch(_){}if(moved){saveMark(m);_suppressGut=true;redrawInk();if(typeof refreshSideLive==='function')refreshSideLive();}});
gut.addEventListener('pointercancel',()=>{_pinDrag=null;gut.style.cursor='';});
gut.addEventListener('click',e=>{if(_suppressGut){_suppressGut=false;return;}if(e.target.closest('#gut-add')||e.target.closest('#gut-grip')||e.target.closest('#gut-find')||e.target.closest('#gut-tools'))return;const r=wrap.getBoundingClientRect();const cy=e.clientY-r.top;let best=null,bd=15;for(const h of pinHits){const d=Math.abs(h.y-cy);if(d<bd){bd=d;best=h.m;}}if(best)openMarkPopup(best);});
document.getElementById('gut-add').addEventListener('click',()=>{const bottom=contentBottomPx();const yn=(bottom+30)/drawW;addMark({type:'note',name:'',anchor:{kind:'time',yn},auto:false},true);wrap.scrollTo({top:Math.max(0,bottom+30-H*0.55),behavior:'smooth'});});
(function(){const grip=document.getElementById('gut-grip');let on=false;grip.addEventListener('pointerdown',e=>{on=true;grip.setPointerCapture(e.pointerId);e.preventDefault();});grip.addEventListener('pointermove',e=>{if(!on)return;const r=stage.getBoundingClientRect();gutterW=Math.max(GUT_MIN,Math.min(340,e.clientX-r.left));layout();});const end=()=>{if(on){on=false;saveMeta();}};grip.addEventListener('pointerup',end);grip.addEventListener('pointercancel',end);})();

/* modes */
function setMode(m){if(mode!==m&&editor&&editor.hasPickedImage&&editor.hasPickedImage())editor.unpickImage();mode=m;document.querySelectorAll('.mbtn[data-mode]').forEach(b=>b.classList.toggle('on',b.dataset.mode===m));const tb=document.getElementById('note-tb'),inkbar=document.getElementById('inkbar'),hm=document.getElementById('handmsg');hideTagbar();if(m==='text'){tb.style.display='flex';inkbar.style.display='none';hm.style.display='none';cv.style.pointerEvents='none';requestAnimationFrame(()=>noteEd.focus());}else if(m==='hand'){document.querySelectorAll('.img-pop').forEach(x=>x.classList.remove('visible'));tb.style.display='none';inkbar.style.display='none';hm.style.display='inline';cv.style.pointerEvents='auto';noteEd.blur();}else{document.querySelectorAll('.img-pop').forEach(x=>x.classList.remove('visible'));tb.style.display='none';inkbar.style.display='flex';hm.style.display='none';cv.style.pointerEvents='auto';noteEd.blur();}cv.classList.toggle('pan',m==='hand');cv.classList.toggle('m-pen',m==='pen');cv.classList.toggle('m-hl',m==='hl');if(m!=='grab')grabSel.clear();}
document.querySelectorAll('.mbtn[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));

/* ink controls */
function buildSwatches(){const btn=document.getElementById('ink-color');if(btn)btn.onclick=e=>{e.stopPropagation();openInkColorPop(btn);};}
let _inkCP=null;
function _inkCPEl(){if(_inkCP)return _inkCP;_inkCP=document.createElement('div');_inkCP.className='color-pop';_inkCP.id='ink-cp';document.body.appendChild(_inkCP);document.addEventListener('mousedown',e=>{if(_inkCP.classList.contains('open')&&!_inkCP.contains(e.target)&&!(e.target.closest&&e.target.closest('#ink-color')))closeInkCP();});return _inkCP;}
function closeInkCP(){if(_inkCP)_inkCP.classList.remove('open');}
function pickInk(hex){hex=normalizeHex(hex);if(!hex)return;setInkColor(hex);pushRecentColor(hex);renderInkCP();}
function renderInkCP(){if(!_inkCP)return;const cur=inkColor;let h='';
  h+='<div class="cp-row cp-current"><span class="cp-cur-sw" style="background:'+cur+'"></span><span>Current color</span><span class="cp-cur-hex">'+esc(cur)+'</span></div>';
  h+='<button class="cp-row" data-def="1" title="Reset to default"><span class="cp-cur-sw" style="background:'+DEFAULT_INK+'"></span><span>Default color</span></button>';
  h+='<div class="cp-divider"></div><div class="cp-label">Favorites</div><div class="cp-fav-grid">';
  COLOR_FAVORITES.forEach(c=>{h+='<button class="cp-fav" data-hex="'+c+'" style="background:'+c+'" title="'+c+'"><span class="cp-x" data-rm="'+c+'">\u00d7</span></button>';});
  h+='<button class="cp-fav-add" data-add="1" title="Add current to favorites">+</button></div>';
  if(COLOR_RECENTS.length){h+='<div class="cp-label">Recent</div><div class="cp-grid">';COLOR_RECENTS.forEach(c=>{h+='<button class="cp-sw" data-hex="'+c+'" style="background:'+c+'" title="'+c+'"><span class="cp-star" data-fav="'+c+'">\u2605</span></button>';});h+='</div>';}
  h+='<div class="cp-label">Palette</div><div class="cp-grid">';COLOR_PALETTE.forEach(c=>{h+='<button class="cp-sw" data-hex="'+c+'" style="background:'+c+'" title="'+c+'"></button>';});h+='</div>';
  _inkCP.innerHTML=h;
  _inkCP.querySelectorAll('[data-hex]').forEach(b=>b.onclick=e=>{if(e.target.dataset.rm){removeFavoriteColor(e.target.dataset.rm);renderInkCP();return;}if(e.target.dataset.fav){addFavoriteColor(e.target.dataset.fav);renderInkCP();return;}pickInk(b.dataset.hex);});
  const def=_inkCP.querySelector('[data-def]');if(def)def.onclick=()=>pickInk(DEFAULT_INK);
  const add=_inkCP.querySelector('[data-add]');if(add)add.onclick=()=>{if(addFavoriteColor(inkColor))renderInkCP();};}
function openInkColorPop(anchor){_inkCPEl();renderInkCP();_inkCP.classList.add('open');const r=anchor.getBoundingClientRect();const w=200;_inkCP.style.left=Math.max(6,Math.min(r.left,window.innerWidth-w-6))+'px';_inkCP.style.top='0px';const ph=_inkCP.offsetHeight||320;let top=r.bottom+6;if(top+ph>window.innerHeight-6)top=Math.max(6,r.top-ph-6);_inkCP.style.top=top+'px';}

function setInkColor(hex){hex=normalizeHex(hex)||hex;inkColor=hex;const sw=document.querySelector('#ink-color .icb-sw');if(sw)sw.style.background=hex;if(mode==='eraser')setMode('pen');}

document.getElementById('size').addEventListener('input',e=>{inkSize=+e.target.value;document.getElementById('sizeval').textContent=inkSize+' px';});

/* actions + keyboard */
document.getElementById('undo').addEventListener('click',()=>hostUndo());
document.getElementById('redo').addEventListener('click',()=>hostRedo());
document.getElementById('clearink').addEventListener('click',async()=>{if(!strokes.length){toast('No ink to clear','info');return;}
  if(await clsAsk('Clear all ink on this page?','<p>This removes every pen stroke on this page. Text and pictures stay.</p><p>The Timeline still shows the ink as it was.</p>',[['ok','Clear ink','fx-primary'],['','Cancel','pbtn']])!=='ok')return;const _now=Date.now();strokes=[];inkRedo=[];db.strokes.where('pid').equals(pid).modify(s=>{if(!s.del)s.del=_now;});redrawInk();updatePad();refreshSideLive();toast('Ink cleared','ok');});
document.getElementById('now').addEventListener('click',()=>wrap.scrollTo({top:Math.max(0,contentBottomPx()-H*0.6),behavior:'smooth'}));
document.getElementById('gut-find').addEventListener('click',()=>{toggleSide(true);setTimeout(()=>{const q=document.getElementById('side-q');if(q)q.focus();},70);});
document.getElementById('m-grab').addEventListener('click',()=>redrawInk());
document.getElementById('side-x').addEventListener('click',()=>toggleSide(false));
document.getElementById('side-scrim').addEventListener('click',()=>toggleSide(false));
document.getElementById('side-q').addEventListener('input',e=>renderSideResults(e.target.value));
document.getElementById('proj-btn').addEventListener('click',openProjects);
addEventListener('keydown',e=>{
if(mode==='grab'&&editor&&editor.hasPickedImage()&&!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)&&!e.target.isContentEditable){if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();editor.deletePicked();return;}if(e.key==='Escape'){editor.unpickImage();return;}}
if(mode==='grab'&&(e.key==='Delete'||e.key==='Backspace')&&grabSel.size&&!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)&&!e.target.isContentEditable){e.preventDefault();for(const s of [...grabSel]){const i=strokes.indexOf(s);if(i>=0)strokes.splice(i,1);retireStroke(s);}grabSel.clear();redrawInk();schedulePrune();return;}
  if(e.key==='Escape'){const _sd=document.getElementById('side');if(_sd&&_sd.classList.contains('open')){toggleSide(false);return;}if(picker&&picker.style.display!=='none'){picker.style.display='none';return;}if(projPanel&&projPanel.style.display!=='none'){projPanel.style.display='none';return;}if(popup&&popup.style.display!=='none'){closePopup();return;}hideTagbar();return;}
  const tag=(e.target&&e.target.tagName)||'';
  // full-screen views (Lab, Timeline, Explorer) own the keyboard: never undo or switch tools on the hidden page
  if(['hwlab','explorer'].some(id=>{const el=document.getElementById(id);return el&&el.style.display!=='none';}))return;
  if(document.activeElement===noteEd)return;
  if((e.ctrlKey||e.metaKey)&&!e.altKey){const k=e.key.toLowerCase();if(k==='z'&&!e.shiftKey){e.preventDefault();hostUndo();return;}if((k==='z'&&e.shiftKey)||k==='y'){e.preventDefault();hostRedo();return;}}
  if(e.ctrlKey||e.metaKey||e.altKey)return;if(tag==='INPUT'||tag==='TEXTAREA')return;
  const mm={t:'text',p:'pen',h:'hand',g:'grab'}[e.key.toLowerCase()];if(mm)setMode(mm);
});
addEventListener('resize',()=>{const yn=scrollTop()/drawW;layout();wrap.scrollTop=yn*drawW;redrawInk();});

/* boot: after every script file has loaded */
addEventListener('DOMContentLoaded',async function(){
  try{await db.open();}catch(e){toast('Storage failed \u2014 Patchwork needs IndexedDB','err');return;}
  if(!await db.info.get('info'))await db.info.add({id:'info'});
  try{if(navigator.storage&&navigator.storage.persist){const granted=await navigator.storage.persist();const persisted=navigator.storage.persisted?await navigator.storage.persisted():granted;const inf=await db.info.get('info');void inf;}}catch(_){}
  if(!IS_MINI)try{const _bc=new BroadcastChannel('patchwork-app');let _others=false;_bc.onmessage=ev=>{if(ev.data==='ping'){_bc.postMessage('pong');}else if(ev.data==='pong'&&!_others){_others=true;toast('Patchwork is open in another tab — editing the same project in two tabs can overwrite changes','err');}};_bc.postMessage('ping');}catch(_){}
  await DB_loadColors();
  if(typeof extBoot==='function')await extBoot();
  projects=await db.projects.toArray();await loadFolders();
  if(!projects.length){
    const id=await db.projects.add({name:'Main',created:Date.now()});projects=await db.projects.toArray();
    const legacy=await db.meta.get('meta');
    if(legacy&&legacy.html!==undefined)await db.pages.put({pid:id,html:legacy.html||'',scrollYn:legacy.scrollYn||0,gutterW:legacy.gutterW||0});
    await db.strokes.toCollection().modify(s=>{if(s.pid==null)s.pid=id;});
    await db.marks.toCollection().modify(m=>{if(m.pid==null)m.pid=id;});
  }
  marks=await db.marks.toArray();
  updateBkStatus();setInterval(updateBkStatus,10*60e3);
  const meta=await db.meta.get('meta');
  let active=(meta&&meta.activePid&&projects.find(p=>p.id===meta.activePid))?meta.activePid:projects[0].id;
  if(IS_MINI){const q=+new URLSearchParams(location.search).get('pid');if(projects.find(p=>p.id===q))active=q;}
  buildSwatches();setInkColor('#ece6da');buildFilterBar();
  editor=makeEditor('note-ed','note-tb','note-status','note-valign');
  pid=active;const pg=(await db.pages.get(pid))||{};
  strokes=(await db.strokes.where('pid').equals(pid).toArray()).filter(s=>!s.del);
  if(typeof picsLoad==='function')await picsLoad();
  gutterW=pg.gutterW||0;pageWW=pageWidthFor(pg,pid);pageBg=PAGE_BGS.includes(pg.bg)?pg.bg:'';
  if(typeof extBeforePageLoad==='function')await extBeforePageLoad(pg);
  editor.setHTML(pg.html||'');_lastHTML=editor.getHTML();
  document.getElementById('proj-name').textContent=projName(pid);
  layout();redrawInk();updatePad();setMode('text');if(typeof extAfterPageLoad==='function')extAfterPageLoad();
  requestAnimationFrame(()=>{wrap.scrollTop=(pg.scrollYn||0)*drawW;redrawInk();});
  setInterval(checkText,1500);
  noteEd.addEventListener('blur',()=>{checkText();saveMeta();schedulePrune();});
  addEventListener('beforeunload',()=>{checkText();if(typeof historyFlush==='function')historyFlush();if(editor&&pid!=null)db.pages.put({pid,html:editor.getHTML(),scrollYn:scrollTop()/drawW,gutterW,ww:pageWW||undefined,bg:pageBg||undefined});if(!IS_MINI)db.meta.put({id:'meta',activePid:pid});});
});
/* ===== extension lifecycle (called from the main script) ===== */
async function extBoot(){const gt=document.getElementById('gut-tools'),b2=document.getElementById('bar2');if(gt&&b2)b2.appendChild(gt);await loadHighlightTypes();}
async function extBeforePageLoad(pg){await loadImages(imageRefsIn(pg&&pg.html));}
function extAfterPageLoad(){
  internImages().then(n=>{if(n)saveMeta();});
  requestAnimationFrame(()=>{adoptLegacyStamps();if(typeof historyStart==='function')historyStart();});
}
// Pages from before paragraph times: give each paragraph the time of the old automatic margin stamp beside it.
function adoptLegacyStamps(){if(!editor||!editor.paraRects)return;const olds=pageMarks().filter(isLegacyAutoStamp);if(!olds.length)return;const wr=wrap.getBoundingClientRect(),st=scrollTop(),band=26;const map={};
  for(const r of editor.paraRects()){if(r.t||!r.has)continue;const b=r.el.getBoundingClientRect(),top=(b.top-wr.top)+st,bot=top+b.height;let best=null;for(const m of olds){const y=m.anchor.yn*drawW;if(y>=top-band&&y<=bot+band&&(best==null||m.created<best))best=m.created;}if(best)map[r.i]=best;}
  // paragraphs below a stamp (same session) inherit it too, so the margin shows the session, not a hole
  let carry=null;for(const r of editor.paraRects()){if(map[r.i])carry=map[r.i];else if(!r.t&&r.has&&carry)map[r.i]=carry;}
  if(Object.keys(map).length&&editor.stampParas((i)=>map[i]||null))redrawInk();}

/* ===== pop-up editors: work on 2-3 projects side by side =====
   Each window runs this same app in a frame, locked to its own project. Windows tell each other when highlights,
   types or projects change (BroadcastChannel), and a project can only be open in one window at a time. */
function currentPid(){return pid;}
function editorWindows(){const top=IS_MINI?window.parent:window;const w=[top];top.document.querySelectorAll('.mini-win iframe').forEach(f=>{if(f.contentWindow)w.push(f.contentWindow);});return w;}
function projectOpenElsewhere(n){try{return editorWindows().some(w=>w!==window&&typeof w.currentPid==='function'&&w.currentPid()===n);}catch(e){return false;}}
const _sync=(()=>{try{return new BroadcastChannel('patchwork-sync');}catch(e){return null;}})();let _syncT=null,_syncTypes=false;
function syncPing(kind){if(_sync)_sync.postMessage(kind);}
if(_sync)_sync.onmessage=ev=>{if(ev.data==='types')_syncTypes=true;clearTimeout(_syncT);_syncT=setTimeout(async()=>{try{if(_syncTypes&&typeof loadHighlightTypes==='function'){_syncTypes=false;await loadHighlightTypes();}marks=await db.marks.toArray();projects=await db.projects.toArray();await loadFolders();
  if(typeof typesChanged==='function')typesChanged();else{if(editor)editor.refresh();redrawInk();}projNamesChanged();}catch(e){console.error(e);}},250);};
function miniTitles(){setTimeout(renderMiniTabs,0);document.querySelectorAll('.mini-win').forEach(w=>{try{const p=w.querySelector('iframe').contentWindow.currentPid();w.dataset.pid=p;w.querySelector('.panel-t').textContent=projName(p);}catch(e){}});}
let _miniN=0,_miniZ=8100,_miniMenu=null;
// no name typed: new-project-<date>, then new-project-<date>-2, -3 ...
function autoProjName(){const d=new Date(),base='new-project-'+d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');const have=new Set(projects.map(p=>p.name));if(!have.has(base))return base;let i=2;while(have.has(base+'-'+i))i++;return base+'-'+i;}
// backup status (top bar): when this browser last downloaded a backup; click = back up everything now
async function updateBkStatus(){const el=document.getElementById('bk-status');if(!el||IS_MINI)return;let t=0;try{const i=await db.info.get('info');t=(i&&i.lastBackupAt)||0;}catch(e){}
  const d=t?Math.floor((Date.now()-t)/864e5):null;el.textContent=d==null?'Not backed up':d===0?'Backed up today':d===1?'Backed up yesterday':'Backed up '+d+' days ago';
  el.className='bk-chip '+(d==null||d>30?'bad':d>7?'warn':'ok');el.title=(d==null?'Your notes live only in this browser. ':'')+'Click to download a backup of everything';}
document.getElementById('bk-status').addEventListener('click',()=>backupAll());
// files dropped on the page: pictures go in where they're dropped, a PDF becomes a new page
stage.addEventListener('dragover',e=>{if(e.dataTransfer&&[...e.dataTransfer.types].includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
stage.addEventListener('drop',e=>{const fs=e.dataTransfer&&[...e.dataTransfer.files];if(!fs||!fs.length)return;e.preventDefault();const pe=cv.style.pointerEvents;cv.style.pointerEvents='none';
  const t=editor.dropTarget(e.clientX,e.clientY);   // look up the drop spot now, under the ink layer
  for(const f of fs){if(/^image\//.test(f.type)){if(mode!=='text')setMode('text');const r=new FileReader(),at={clientX:e.clientX,clientY:e.clientY};r.onload=()=>typeof addFreePicture==='function'?addFreePicture(r.result,at):editor.insertImageAt(t,r.result);r.readAsDataURL(f);}else if(f.type==='application/pdf'||/\.pdf$/i.test(f.name))importPdf(f);}
  setTimeout(()=>{cv.style.pointerEvents=pe;},0);});
function openMiniMenu(anchor){if(IS_MINI)return;if(!_miniMenu){_miniMenu=document.createElement('div');_miniMenu.className='panel mini-menu';document.body.appendChild(_miniMenu);document.addEventListener('mousedown',e=>{if(_miniMenu.style.display!=='none'&&!_miniMenu.contains(e.target)&&!e.target.closest('#mini-btn'))_miniMenu.style.display='none';});}
  const busy=new Set(editorWindows().map(w=>{try{return w.currentPid();}catch(e){return null;}}));
  _miniMenu.innerHTML='<div class="panel-h"><div class="panel-t">Open beside this page</div></div><div class="panel-b"><div class="mini-list"></div><div class="proj-new"><input class="pf-in" placeholder="New project\u2026" maxlength="60"><button title="Create">+</button></div></div>';
  const list=_miniMenu.querySelector('.mini-list');projects.forEach(p=>{const b=document.createElement('button');b.className='mini-pick';b.textContent=p.name;if(busy.has(p.id)){b.disabled=true;b.title='Already open';}b.onclick=()=>{_miniMenu.style.display='none';openMiniEditor(p.id);};list.appendChild(b);});
  const ni=_miniMenu.querySelector('input'),go=async()=>{const v=ni.value.trim()||autoProjName();const id=await db.projects.add({name:v.slice(0,60),created:Date.now()});projects=await db.projects.toArray();syncPing('projects');_miniMenu.style.display='none';openMiniEditor(id);};
  _miniMenu.querySelector('.proj-new button').onclick=go;ni.onkeydown=e=>{if(e.key==='Enter')go();};
  const r=anchor.getBoundingClientRect();_miniMenu.style.display='flex';_miniMenu.style.left=Math.min(r.left,innerWidth-280)+'px';_miniMenu.style.top=(r.bottom+6)+'px';_miniMenu.style.right='auto';}
function openMiniEditor(p){if(IS_MINI||projectOpenElsewhere(p)||p===pid)return;const w=document.createElement('div');w.className='panel mini-win';w.dataset.pid=p;const k=_miniN++%4;
  w.innerHTML='<div class="panel-h"><div class="panel-ic">\u29c9</div><div class="panel-t"></div><button class="panel-x mini-min" title="Minimise (it stays open: bring it back from its tab)">\u2013</button><button class="panel-x mini-close" title="Close (saves first)">\u00d7</button></div><iframe></iframe>';
  w.querySelector('.panel-t').textContent=projName(p);w.querySelector('iframe').src=location.pathname+'?mini=1&pid='+p;
  w.style.left=(Math.max(8,innerWidth*0.52)-k*28)+'px';w.style.top=(70+k*28)+'px';w.style.zIndex=++_miniZ;document.body.appendChild(w);makeDraggable(w,w.querySelector('.panel-h'));
  w.addEventListener('pointerdown',()=>{w.style.zIndex=++_miniZ;},true);
  w.querySelector('.mini-close').onclick=async()=>{const cw=w.querySelector('iframe').contentWindow;try{if(cw.historyFlush)await cw.historyFlush();if(cw.savePageNow)await cw.savePageNow();}catch(e){}w.remove();renderMiniTabs();};
  w.querySelector('.mini-min').onclick=()=>{w.style.display='none';renderMiniTabs();};
  if(typeof onMiniOpen==='function')onMiniOpen(w);renderMiniTabs();}
// tabs for open pop-up editors (after the timeline button): a sideways-scrolling strip; click to bring one forward
function renderMiniTabs(){const box=document.getElementById('mini-tabs');if(!box)return;const track=box.querySelector('.mt-track');track.innerHTML='';
  const wins=[...document.querySelectorAll('.mini-win:not(.cls-pane)')];box.style.display=wins.length?'':'none';
  wins.forEach(w=>{const b=document.createElement('button');b.className='mt-tab'+(w.classList.contains('cls-private')?' priv':'')+(w.style.display==='none'?' min':'');
    let name='?';try{name=projName(w.querySelector('iframe').contentWindow.currentPid());}catch(e){name=(w.querySelector('.panel-t')||{}).textContent||'?';}
    b.innerHTML=(w.classList.contains('cls-private')?'<span class="cls-dot off"></span>\ud83d\udd12 ':'')+'<span class="mt-name"></span>';b.querySelector('.mt-name').textContent=name;b.title='Bring “'+name+'” forward';
    b.onclick=()=>{w.style.display='flex';w.style.zIndex=++_miniZ;renderMiniTabs();};track.appendChild(b);});
  requestAnimationFrame(()=>{const over=track.scrollWidth>track.clientWidth+1;box.classList.toggle('over',over);});}
(function(){const box=document.getElementById('mini-tabs');if(!box)return;const track=box.querySelector('.mt-track');
  box.querySelector('.mt-l').onclick=()=>track.scrollBy({left:-160,behavior:'smooth'});box.querySelector('.mt-r').onclick=()=>track.scrollBy({left:160,behavior:'smooth'});
  track.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){track.scrollLeft+=e.deltaY;e.preventDefault();}},{passive:false});})();
document.getElementById('mini-btn').addEventListener('click',e=>openMiniMenu(e.currentTarget));
