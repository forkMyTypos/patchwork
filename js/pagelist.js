"use strict";
/* ===== page list: everything on this page, from the page counter (n / N ▾) in the top bar =====
   Text by line (each paragraph with something in it), doodles (pen strokes grouped by time: a group spans at most 30 s from
   its first stroke), pictures, videos, patches, highlights and margin notes. Each shows its type, a name numbered in the order
   things were made (Text 3 stays Text 3 when you write above it) and when it was made. Clicking one scrolls to it, flashes
   it and picks it: text gets selected, a doodle is selected for Select & move, a picture or patch is picked. */
const PL={el:null,type:'all',sort:'pos'};
const PL_TYPES=[['all','All'],['text','Text'],['doodle','Doodles'],['pic','Pictures'],['video','Videos'],['patch','Patches'],['mark','Highlights']];
const PL_GROUP=30000;   // one doodle = the strokes drawn within 30 s of its first stroke
const PL_ICON={text:'¶',doodle:'✎',pic:'🖼',video:'▶',patch:'▦'};
function plTime(t){if(!t)return '—';const d=new Date(t),n=new Date();return d.toDateString()===n.toDateString()?fmtTime(t):fmtDay(t)+' '+fmtTime(t);}
// everything on the page: {type, name, snip, t, box (this page's px, scroll included), go}
function plItems(){if(!editor)return[];const out=[],wr=wrap.getBoundingClientRect(),st=scrollTop(),sl=wrap.scrollLeft,rg=document.createRange();
  const boxOf=r=>({x0:r.left-wr.left+sl,y0:r.top-wr.top+st,x1:r.right-wr.left+sl,y1:r.bottom-wr.top+st});
  const num=(list,label)=>{list.slice().sort((a,b)=>(a.t||Infinity)-(b.t||Infinity)||a.box.y0-b.box.y0).forEach((it,i)=>{if(!it.name)it.name=label+' '+(i+1);});return list;};
  // text, by line
  const texts=[];for(const r of editor.paraRects()){if(!r.has)continue;const txt=r.el.textContent.replace(/​/g,'').replace(/\s+/g,' ').trim();rg.selectNodeContents(r.el);
    const b=rg.getBoundingClientRect();texts.push({type:txt?'text':'pic',snip:txt?txt.slice(0,70):'in the text',t:r.t,box:boxOf(b.width?b:r.el.getBoundingClientRect()),i:r.i,len:txt.length});}
  num(texts.filter(x=>x.type==='text'),'Text');
  // doodles: pen and highlighter strokes, grouped by time
  const groups=[];let g=null;for(const s of strokes.filter(s=>s.tool!=='eraser').sort((a,b)=>(a.t||0)-(b.t||0))){if(!g||(s.t||0)-g.t>PL_GROUP){g={type:'doodle',t:s.t||0,strokes:[]};groups.push(g);}g.strokes.push(s);}
  for(const d of groups){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const s of d.strokes){const U=inkU(s),dy=inkDy(s);for(const q of s.pts){const X=gutter+q.xn*U,Y=q.yn*U+dy;x0=Math.min(x0,X);x1=Math.max(x1,X);y0=Math.min(y0,Y);y1=Math.max(y1,Y);}}
    d.box={x0,y0,x1,y1};d.snip=d.strokes.length+' stroke'+(d.strokes.length>1?'s':'');}
  num(groups,'Doodle');
  // pictures, videos, patches (free objects)
  const objs=[];for(const p of (typeof pics!=='undefined'?pics:[])){const el=_picEl.get(p);if(!el)continue;
    objs.push({type:p.patch?'patch':p.yt?'video':'pic',p,t:p.t,box:boxOf(el.getBoundingClientRect()),name:p.patch&&ptName(p)!=='Patch'?ptName(p):'',snip:p.patch?'':p.yt?'YouTube':''});}
  num(objs.filter(x=>x.type==='pic'),'Picture');num(objs.filter(x=>x.type==='video'),'Video');num(objs.filter(x=>x.type==='patch'),'Patch');
  num(texts.filter(x=>x.type==='pic'),'Picture (in line)');
  // highlights and margin notes
  const ms=[];for(const m of pageMarks()){if(isLegacyAutoStamp(m))continue;let box=null;
    if(m.anchor&&m.anchor.kind==='text'){const el=editor.markEl(m.id);if(!el)continue;box=boxOf(el.getBoundingClientRect());}else{const y=(m.anchor&&m.anchor.yn||0)*drawW;box={x0:0,y0:y,x1:gutter,y1:y+14};}
    const ty=mtype(m.type);ms.push({type:'mark',m,t:m.created,box,name:(m.name||m.snippet||ty.name).slice(0,80),snip:ty.name,color:ty.color||ty.c});}
  return out.concat(texts,groups,objs,ms);}

/* ---- the list ---- */
function plOpen(anchor){if(!PL.el){PL.el=document.createElement('div');PL.el.className='pl-pop';PL.el.innerHTML='<div class="pl-head"><input class="pl-q" type="search" placeholder="Find on this page…"><button class="pl-sort" title="Order"></button></div><div class="pl-chips"></div><div class="pl-list"></div>';
    document.body.appendChild(PL.el);PL.el.querySelector('.pl-q').oninput=()=>plRender();PL.el.querySelector('.pl-sort').onclick=()=>{PL.sort=PL.sort==='pos'?'time':'pos';plRender();};
    document.addEventListener('pointerdown',e=>{if(PL.el.classList.contains('open')&&!PL.el.contains(e.target)&&!e.target.closest('#page-ind'))plClose();},true);
    addEventListener('keydown',e=>{if(e.key==='Escape'&&PL.el.classList.contains('open')){e.preventDefault();e.stopPropagation();plClose();}},true);}
  if(PL.el.classList.contains('open')){plClose();return;}
  PL.items=plItems();PL.type='all';PL.el.classList.add('open');const r=anchor.getBoundingClientRect(),w=PL.el.offsetWidth;PL.el.style.left=Math.max(8,Math.min(r.right-w,innerWidth-w-8))+'px';PL.el.style.top=(r.bottom+6)+'px';
  const q=PL.el.querySelector('.pl-q');q.value='';plRender();q.focus();}
function plClose(){if(PL.el)PL.el.classList.remove('open');}
function plRender(){const q=PL.el.querySelector('.pl-q').value.trim().toLowerCase(),all=PL.items||[];
  const hit=it=>!q||(it.name+' '+(it.snip||'')).toLowerCase().includes(q),cnt={};for(const it of all)if(hit(it)){cnt[it.type]=(cnt[it.type]||0)+1;cnt.all=(cnt.all||0)+1;}
  const chips=PL.el.querySelector('.pl-chips');chips.innerHTML='';for(const [k,l] of PL_TYPES){if(k!=='all'&&!cnt[k]&&PL.type!==k)continue;const b=document.createElement('button');b.className='pl-chip'+(PL.type===k?' on':'');b.textContent=l+' '+(cnt[k]||0);b.onclick=()=>{PL.type=k;plRender();};chips.appendChild(b);}
  PL.el.querySelector('.pl-sort').textContent=PL.sort==='pos'?'Top to bottom':'Newest first';
  const list=PL.el.querySelector('.pl-list');list.innerHTML='';
  const rows=all.filter(it=>hit(it)&&(PL.type==='all'||it.type===PL.type)).sort(PL.sort==='pos'?(a,b)=>a.box.y0-b.box.y0||a.box.x0-b.box.x0:(a,b)=>(b.t||0)-(a.t||0));
  for(const it of rows.slice(0,1500)){const row=document.createElement('div');row.className='pl-row';
    const ic=document.createElement('span');ic.className='pl-ic';if(it.type==='mark'){ic.innerHTML='<i></i>';ic.firstChild.style.background=it.color||'#f59e0b';}else ic.textContent=PL_ICON[it.type];
    const nm=document.createElement('span');nm.className='pl-nm';nm.textContent=it.name;if(it.snip&&it.snip!==it.name){const s=document.createElement('i');s.textContent=it.snip;nm.appendChild(s);}
    const tm=document.createElement('span');tm.className='pl-tm';tm.textContent=plTime(it.t);row.append(ic,nm,tm);row.title=it.name+(it.snip?' — '+it.snip:'');row.onclick=()=>{plClose();plGo(it);};list.appendChild(row);}
  if(!rows.length){const e=document.createElement('div');e.className='pl-empty';e.textContent=all.length?'Nothing matches.':'Nothing on this page yet.';list.appendChild(e);}}

/* ---- going to one: scroll there, flash it, pick it ---- */
function plGo(it){if(it.type==='mark'){jumpToMark(it.m);return;}const b=it.box;
  wrap.scrollTop=Math.max(0,b.y0-H*0.3);if(b.x0-gutter<wrap.scrollLeft||b.x1>wrap.scrollLeft+wrap.clientWidth)wrap.scrollLeft=Math.max(0,b.x0-gutter-40);
  const f=document.createElement('div');f.className='pl-flash';f.style.left=(b.x0-4)+'px';f.style.top=(b.y0-4)+'px';f.style.width=(b.x1-b.x0+8)+'px';f.style.height=(b.y1-b.y0+8)+'px';pad.appendChild(f);setTimeout(()=>f.remove(),1500);
  if(it.type==='doodle'){setMode('grab');grabSel.clear();for(const s of it.strokes)grabSel.add(s);redrawInk();return;}
  if(it.p){if(mode!=='text')setMode('text');picPick(it.p);return;}
  if(it.type==='text'){if(mode!=='text')setMode('text');noteEd.focus({preventScroll:true});editor.selectMatch({p:it.i,o:0,len:it.len});}}
{const pi=document.getElementById('page-ind');if(pi){pi.title='Where you are on this page — click for a list of everything on it';pi.addEventListener('click',()=>plOpen(pi));}}
