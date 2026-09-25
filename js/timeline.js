"use strict";
/* ===== History engine: the page quietly remembers its own evolution =====
   Text: after each pause in editing (or at least once a minute while you keep going) the page is snapshotted as a
   list of paragraph hashes; paragraphs live once in db.paras, images once in db.images, so an edit costs only the
   paragraphs it touched. Ink: strokes are never deleted, only retired (del) or re-born (born) when moved/redone.
   Nothing here ever changes the live page. */
const HIST_IDLE=2500,HIST_MAX=60000;
let _histT=null,_histFirst=0,_histBusy=null,_histEditT=0;
const _histLast=new Map();   // pid -> {paras:[hash], text, imgs}
const _parasKnown=new Set();
// one canonical shape per paragraph, so identical content always hashes identically (live vs. reloaded runs differ in optional keys)
function normPara(p){return{align:p.align||'left',t:p.t||null,runs:(p.runs||[]).map(r=>r.type==='image'?{type:'image',src:r.src,width:r.width||100,bg:r.bg||null}:{type:'text',text:r.text||'',bold:!!r.bold,italic:!!r.italic,underline:!!r.underline,color:r.color||null,size:r.size||null,font:r.font||null,mark:r.mark||null})};}
function paraKey(p){return contentHash(JSON.stringify(p));}
function docPlain(paras){return paras.map(p=>p.runs.filter(r=>r.type==='text').map(r=>r.text).join('')).join('\n');}
function docImgs(paras){let n=0;paras.forEach(p=>p.runs.forEach(r=>{if(r.type==='image')n++;}));return n;}
function clip(s,n){s=String(s).replace(/\s+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'…':s;}
// what changed, in words (also the seed for "what did I delete?" later)
function describeChange(prevText,text,prevImgs,imgs,paraDelta){let a=0;const ml=Math.min(prevText.length,text.length);while(a<ml&&prevText[a]===text[a])a++;let b=0;while(b<ml-a&&prevText[prevText.length-1-b]===text[text.length-1-b])b++;
  const del=prevText.slice(a,prevText.length-b),add=text.slice(a,text.length-b);const sum={add:clip(add,160),del:clip(del,160),nAdd:add.replace(/\s/g,'').length,nDel:del.replace(/\s/g,'').length,img:imgs-prevImgs};
  const parts=[];if(sum.nAdd&&sum.nDel)parts.push('Changed “'+clip(del,40)+'” to “'+clip(add,40)+'”');else if(sum.nAdd)parts.push('Wrote “'+clip(add,60)+'”');else if(sum.nDel)parts.push('Deleted “'+clip(del,60)+'”');
  if(sum.img>0)parts.push('Added '+(sum.img>1?sum.img+' images':'an image'));if(sum.img<0)parts.push('Removed '+(-sum.img>1?(-sum.img)+' images':'an image'));
  if(!parts.length)parts.push(paraDelta>0?'New paragraph':paraDelta<0?'Joined paragraphs':'Formatting / highlights');sum.label=parts.join(' · ');return sum;}
function historyNote(){if(pid==null)return;const now=Date.now();_histEditT=now;if(!_histFirst)_histFirst=now;clearTimeout(_histT);const wait=Math.max(0,Math.min(HIST_IDLE,HIST_MAX-(now-_histFirst)));_histT=setTimeout(()=>{takeSnapshot();},wait);}
async function historyFlush(){if(_histT){clearTimeout(_histT);_histT=null;await takeSnapshot();}else if(_histBusy)await _histBusy;}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')historyFlush();});
async function lastSnapshotOf(p){if(_histLast.has(p))return _histLast.get(p);let rec=null;try{const last=await db.snaps.where('pid').equals(p).last();if(last){const rows=await db.paras.bulkGet(last.paras);const paras=rows.map(r=>r?r.p:{align:'left',runs:[]});last.paras.forEach(h=>_parasKnown.add(h));rec={paras:last.paras,text:docPlain(paras),imgs:docImgs(paras),t:last.t};}}catch(e){console.error(e);}_histLast.set(p,rec);return rec;}
async function takeSnapshot(opts){_histT=null;_histFirst=0;if(!editor||pid==null)return;if(_histBusy){await _histBusy;}
  const p0=pid;_histBusy=(async()=>{try{await internImages();const doc=editor.getDoc().map(normPara);const keys=doc.map(paraKey);const prev=await lastSnapshotOf(p0);
    if(prev&&prev.paras.length===keys.length&&prev.paras.every((k,i)=>k===keys[i]))return;
    if(!prev&&!docPlain(doc).trim()&&!docImgs(doc))return;
    const fresh=[];doc.forEach((p,i)=>{if(!_parasKnown.has(keys[i])){fresh.push({h:keys[i],p});_parasKnown.add(keys[i]);}});if(fresh.length)await db.paras.bulkPut(fresh);
    const text=docPlain(doc),imgs=docImgs(doc);const sum=(prev||!(opts&&opts.label))?describeChange(prev?prev.text:'',text,prev?prev.imgs:0,imgs,keys.length-(prev?prev.paras.length:0)):{label:opts.label,add:clip(text,160),del:'',nAdd:text.replace(/\s/g,'').length,nDel:0,img:imgs};
    const t=Math.max((prev&&prev.t||0)+1,Math.min(Date.now(),_histEditT||Date.now()));await db.snaps.add({pid:p0,t,paras:keys,sum});_histLast.set(p0,{paras:keys,text,imgs,t});
  }catch(e){_quotaToast(e);}})();try{await _histBusy;}finally{_histBusy=null;}}
// On opening a page: record its current state if history doesn't have it yet (first run, or edits made before v4).
function historyStart(){lastSnapshotOf(pid).then(prev=>takeSnapshot({label:prev?'Changed outside history':'History begins'}));}

/* ===== Timeline: travel back through the life of the page =====
   The preview is drawn by the editor's own line renderer and the same ink maths, so it looks like the page did. Read-only. */
let TL=null;
function ensureTimeline(){if(TL)return TL;const el=document.createElement('div');el.id='timeline';el.style.display='none';
  el.innerHTML='<div class="tl-bar"><div class="tl-title"><svg width="15" height="15" viewBox="0 0 24 24" stroke="#fbbf24" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/></svg><b>Timeline</b><span class="tl-proj"></span><span class="tl-badge">looking at the past · read-only</span></div>'+
    '<div class="tl-actions"><button class="fx-link tl-open" title="Copy the page as it was at this moment into a new project (nothing is overwritten)">Open as new project</button><button class="tl-close" title="Back to the present (Esc)">Back to now</button></div></div>'+
    '<div class="tl-stage"><div class="tl-wrap"><div class="tl-pad"><div class="editor tl-ed"></div></div></div><canvas class="tl-ink"></canvas><div class="tl-empty"></div></div>'+
    '<div class="tl-dock"><div class="tl-when"><span class="tl-big"></span><span class="tl-what"></span></div>'+
    '<div class="tl-sl"><button class="tl-step" data-d="-1" title="Previous change (←)">‹</button><div class="tl-track"><canvas class="tl-dens"></canvas><div class="tl-fill"></div><div class="tl-thumb"></div></div><button class="tl-step" data-d="1" title="Next change (→)">›</button></div>'+
    '<div class="tl-ends"><span class="tl-a"></span><div class="tl-rng"></div><span class="tl-b"></span></div></div>';
  document.body.appendChild(el);
  TL={el,wrap:el.querySelector('.tl-wrap'),pad:el.querySelector('.tl-pad'),ed:el.querySelector('.tl-ed'),cv:el.querySelector('.tl-ink'),track:el.querySelector('.tl-track'),dens:el.querySelector('.tl-dens'),thumb:el.querySelector('.tl-thumb'),fill:el.querySelector('.tl-fill'),
    snaps:[],paras:new Map(),strokes:[],events:[],T:0,t0:0,t1:0,range:'all',shownKey:'',raf:0};
  TL.ctx=TL.cv.getContext('2d');
  el.querySelector('.tl-close').onclick=closeTimeline;
  el.querySelector('.tl-open').onclick=tlOpenAsNew;
  el.querySelectorAll('.tl-step').forEach(b=>b.onclick=()=>tlStep(+b.dataset.d));
  const rng=el.querySelector('.tl-rng');[['hour','Hour'],['today','Today'],['week','Week'],['month','Month'],['all','All']].forEach(([k,l])=>{const b=document.createElement('button');b.className='sp-f';b.dataset.k=k;b.textContent=l;b.onclick=()=>{TL.range=k;tlRange();tlDraw();};rng.appendChild(b);});
  let drag=false;const setFromX=x=>{const r=TL.track.getBoundingClientRect();const f=Math.max(0,Math.min(1,(x-r.left)/r.width));TL.T=TL.t0+f*(TL.t1-TL.t0);tlSchedule();};
  TL.track.addEventListener('pointerdown',e=>{drag=true;TL.track.setPointerCapture(e.pointerId);setFromX(e.clientX);});
  TL.track.addEventListener('pointermove',e=>{if(drag)setFromX(e.clientX);else{const r=TL.track.getBoundingClientRect();TL.track.title=fmtFull(TL.t0+(e.clientX-r.left)/r.width*(TL.t1-TL.t0));}});
  const end=()=>{drag=false;};TL.track.addEventListener('pointerup',end);TL.track.addEventListener('pointercancel',end);
  TL.wrap.addEventListener('scroll',()=>tlInk(),{passive:true});
  addEventListener('resize',()=>{if(tlOpen()){tlLayout();tlShow(true);}});
  addEventListener('keydown',e=>{if(!tlOpen())return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeTimeline();}else if(e.key==='ArrowLeft'){e.preventDefault();tlStep(-1);}else if(e.key==='ArrowRight'){e.preventDefault();tlStep(1);}else if(e.key==='Home'){TL.T=TL.t0;tlSchedule();}else if(e.key==='End'){TL.T=TL.t1;tlSchedule();}},true);
  return TL;}
function tlOpen(){return TL&&TL.el.style.display!=='none';}
function fmtFull(t){return new Date(t).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'});}
async function openTimeline(){ensureTimeline();await historyFlush();await savePageNow();hideTagbar();closePopup();
  const p0=pid;TL.pid=p0;TL.el.querySelector('.tl-proj').textContent=projName(p0);
  TL.snaps=await db.snaps.where('pid').equals(p0).sortBy('t');
  const need=new Set();TL.snaps.forEach(s=>s.paras.forEach(h=>{if(!TL.paras.has(h))need.add(h);}));
  if(need.size){const ks=[...need];const rows=await db.paras.bulkGet(ks);rows.forEach((r,i)=>{if(r)TL.paras.set(ks[i],r.p);});}
  const imgs=new Set();for(const p of TL.paras.values())p.runs.forEach(r=>{const h=r.type==='image'&&imgHashOf(r.src);if(h)imgs.add(h);});await loadImages([...imgs]);
  TL.strokes=await db.strokes.where('pid').equals(p0).toArray();
  // every moment something changed
  const ev=[];TL.snaps.forEach(s=>ev.push({t:s.t,k:'text',label:(s.sum&&s.sum.label)||'Edited'}));TL.strokes.forEach(s=>{ev.push({t:s.born||s.t,k:'ink',label:s.born?'Moved / restored a drawing':(s.tool==='eraser'?'Erased ink':s.tool==='hl'?'Highlighter stroke':'Drew a stroke')});if(s.del)ev.push({t:s.del,k:'ink',label:'Removed a drawing'});});
  TL.events=ev.sort((a,b)=>a.t-b.t);
  TL.first=TL.events.length?TL.events[0].t:Date.now();
  TL.el.style.display='flex';tlLayout();TL.range=(Date.now()-TL.first<3600e3)?'all':(Date.now()-TL.first<86400e3?'today':'all');tlRange();TL.T=TL.t1;tlShow(true);}
function closeTimeline(){if(TL)TL.el.style.display='none';cancelAnimationFrame(TL&&TL.raf);}
function tlRange(){const now=Date.now(),start=new Date();start.setHours(0,0,0,0);const r={hour:now-3600e3,today:start.getTime(),week:now-7*864e5,month:now-30*864e5,all:TL.first}[TL.range];
  TL.t1=now;TL.t0=Math.min(Math.max(r,TL.first-60e3),now-60e3);if(TL.T<TL.t0)TL.T=TL.t0;if(TL.T>TL.t1)TL.T=TL.t1;
  TL.el.querySelectorAll('.tl-rng .sp-f').forEach(b=>b.classList.toggle('on',b.dataset.k===TL.range));
  const lab=t=>{const d=new Date(t);return (dayLabel(t)==='Today'?'':dayLabel(t)+' ')+d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});};TL.el.querySelector('.tl-a').textContent=lab(TL.t0);TL.el.querySelector('.tl-b').textContent='now';tlDensity();}
function tlLayout(){const st=TL.el.querySelector('.tl-stage');TL.W=st.clientWidth;TL.H=st.clientHeight;TL.gutter=gutter;TL.drawW=Math.max(40,TL.W-TL.gutter-12);TL.dpr=Math.max(1,Math.min(3,window.devicePixelRatio||1));
  TL.cv.width=Math.round(TL.W*TL.dpr);TL.cv.height=Math.round(TL.H*TL.dpr);TL.cv.style.width=TL.W+'px';TL.cv.style.height=TL.H+'px';TL.ed.style.paddingLeft=(TL.gutter+10)+'px';
  const r=TL.track.getBoundingClientRect();TL.dens.width=Math.round(r.width*TL.dpr);TL.dens.height=Math.round(r.height*TL.dpr);tlDensity();}
// event markers, compressed into a density strip so thousands of events stay calm
function tlDensity(){const c=TL.dens,x=c.getContext('2d'),w=c.width,h=c.height;if(!w)return;x.clearRect(0,0,w,h);const span=TL.t1-TL.t0;if(span<=0)return;
  // day boundaries
  x.fillStyle='rgba(255,255,255,.07)';const d=new Date(TL.t0);d.setHours(24,0,0,0);for(let t=d.getTime();t<TL.t1;t+=864e5){const px=(t-TL.t0)/span*w;x.fillRect(px,0,Math.max(1,TL.dpr),h);}
  const bins=Math.max(1,Math.floor(w/(3*TL.dpr)));const tb=new Array(bins).fill(0),ib=new Array(bins).fill(0);for(const e of TL.events){if(e.t<TL.t0||e.t>TL.t1)continue;const i=Math.min(bins-1,Math.floor((e.t-TL.t0)/span*bins));if(e.k==='ink')ib[i]++;else tb[i]++;}
  const bw=w/bins;for(let i=0;i<bins;i++){const n=tb[i]+ib[i];if(!n)continue;const hh=Math.min(h*.8,(3+Math.log2(1+n)*4)*TL.dpr);x.fillStyle=tb[i]?'rgba(251,191,36,.75)':'rgba(167,139,250,.75)';x.fillRect(i*bw+bw*.2,(h-hh)/2,Math.max(TL.dpr,bw*.6),hh);}}
function tlSchedule(){cancelAnimationFrame(TL.raf);TL.raf=requestAnimationFrame(()=>tlShow(false));}
function tlSnapAt(T){let lo=0,hi=TL.snaps.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(TL.snaps[m].t<=T){ans=m;lo=m+1;}else hi=m-1;}return ans;}
function tlStrokesAt(T){return TL.strokes.filter(s=>(s.born||s.t)<=T&&(!s.del||s.del>T));}
function tlShow(force){const T=TL.T,si=tlSnapAt(T),vis=tlStrokesAt(T);const key=si+':'+vis.map(s=>s.id).join(',');
  // readout + thumb
  const f=(T-TL.t0)/Math.max(1,TL.t1-TL.t0);TL.thumb.style.left=(f*100)+'%';TL.fill.style.width=(f*100)+'%';
  const atNow=TL.t1-T<1500;TL.el.querySelector('.tl-big').textContent=atNow?'Now':fmtFull(T);
  let last=null;for(const e of TL.events){if(e.t<=T)last=e;else break;}
  TL.el.querySelector('.tl-what').textContent=last?(fmtTime(last.t)+' · '+last.label):'Before this page had anything on it';
  TL.el.classList.toggle('is-now',atNow);
  if(!force&&key===TL.shownKey){return;}TL.shownKey=key;
  const paras=si>=0?TL.snaps[si].paras.map(h=>TL.paras.get(h)||{align:'left',runs:[{type:'text',text:''}]}):[];
  editor.renderParas(paras,TL.ed);TL.vis=vis;
  const emp=TL.el.querySelector('.tl-empty');emp.style.display=(!paras.some(p=>p.runs.some(r=>r.type==='image'||(r.text&&r.text.trim())))&&!vis.length)?'':'none';emp.textContent=TL.snaps.length<=1&&TL.strokes.length===0?'History starts now — keep working and come back here to travel through it.':'The page was empty at this moment.';
  let mx=0;for(const s of vis)mx=Math.max(mx,s.maxYn*TL.drawW);TL.pad.style.minHeight=Math.ceil(Math.max(TL.ed.scrollHeight+20,mx+TL.H*.5,TL.H))+'px';
  tlInk();}
function tlInk(){if(!TL||!TL.vis)return;const c=TL.ctx,st=TL.wrap.scrollTop,dW=TL.drawW,g=TL.gutter;c.setTransform(TL.dpr,0,0,TL.dpr,0,0);c.clearRect(0,0,TL.W,TL.H);
  const X=xn=>g+xn*dW,Y=yn=>yn*dW-st;
  for(const s of TL.vis){const top=s.minYn*dW-st,bot=s.maxYn*dW-st;if(bot<-14||top>TL.H+14)continue;c.lineCap='round';c.lineJoin='round';
    if(s.tool==='eraser'){c.globalCompositeOperation='destination-out';c.strokeStyle='#000';c.fillStyle='#000';c.globalAlpha=1;}else{c.globalCompositeOperation='source-over';c.strokeStyle=s.color;c.fillStyle=s.color;c.globalAlpha=s.tool==='hl'?.30:1;}
    const p=s.pts;if(p.length===1){c.beginPath();c.arc(X(p[0].xn),Y(p[0].yn),Math.max(.5,p[0].wn*dW/2),0,7);c.fill();}else for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];c.lineWidth=Math.max(.5,(a.wn+b.wn)/2*dW);c.beginPath();c.moveTo(X(a.xn),Y(a.yn));c.lineTo(X(b.xn),Y(b.yn));c.stroke();}}
  c.globalCompositeOperation='source-over';c.globalAlpha=1;
  // the margin as it was: session stamps from the historical paragraphs and strokes
  c.fillStyle='rgba(16,13,22,.86)';c.fillRect(0,0,g,TL.H);c.strokeStyle='#2a2233';c.lineWidth=1;c.beginPath();c.moveTo(g+.5,0);c.lineTo(g+.5,TL.H);c.stroke();
  const wr=TL.wrap.getBoundingClientRect(),raw=[];TL.ed.querySelectorAll(':scope > .line').forEach(le=>{const t=+le.dataset.t;if(!t||!le.textContent.replace(/​/g,'').trim()&&!le.querySelector('img'))return;const b=le.getBoundingClientRect();raw.push({t,y:(b.top-wr.top)+Math.min(12,b.height/2)});});
  for(const s of TL.vis)raw.push({t:s.born||s.t,y:s.minYn*dW-st+6,ink:true});raw.sort((a,b)=>a.y-b.y);let lastT=null,lastDay='',lastY=-99;
  for(const r of raw){const day=new Date(r.t).toDateString();if(lastT!=null&&Math.abs(r.t-lastT)<GAP_MS&&day===lastDay)continue;const nd=day!==lastDay;lastT=r.t;lastDay=day;if(r.y<-20||r.y>TL.H+20||r.y-lastY<(nd?26:15))continue;lastY=r.y;
    c.textBaseline='middle';c.textAlign='right';if(nd){c.font='600 9px Arial';c.fillStyle='#7a6a45';c.fillText(dayLabel(r.t).toUpperCase(),g-16,r.y-11);}c.font='10.5px Arial';c.fillStyle=r.ink?'#8a7f9a':'#9a8a6a';c.fillText((r.ink?'✎ ':'')+fmtTime(r.t),g-16,r.y+(nd?2:0));}
  c.textAlign='left';}
function tlStep(d){const ts=[...new Set(TL.events.map(e=>e.t))];if(!ts.length)return;let T;if(d<0){T=null;for(const t of ts)if(t<TL.T-500)T=t;if(T==null)T=TL.t0;}else{T=ts.find(t=>t>TL.T+500);if(T==null)T=TL.t1;}
  if(T<TL.t0){TL.range='all';tlRange();}TL.T=Math.max(TL.t0,Math.min(TL.t1,T));tlShow(false);}
async function tlOpenAsNew(){const T=TL.T,si=tlSnapAt(T);const paras=si>=0?TL.snaps[si].paras.map(h=>JSON.parse(JSON.stringify(TL.paras.get(h)||{align:'left',runs:[]}))):[];
  paras.forEach(p=>p.runs.forEach(r=>{if(r.mark)r.mark=null;}));   // highlights belong to the original page
  const name=(projName(TL.pid)+' · '+new Date(T).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})).slice(0,60);
  const np=await db.projects.add({name,created:Date.now()});await db.pages.put({pid:np,html:editor.parasToHTML(paras),scrollYn:0,gutterW:0});
  for(const s of tlStrokesAt(T))await db.strokes.add({pid:np,t:s.t,tool:s.tool,color:s.color,pts:s.pts,minYn:s.minYn,maxYn:s.maxYn});
  projects=await db.projects.toArray();closeTimeline();await switchProject(np);renderProjects();toast('Opened “'+name+'” — the original is untouched','ok');}
document.getElementById('timeline-btn').addEventListener('click',()=>{if(tlOpen())closeTimeline();else openTimeline();});
addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='h'){e.preventDefault();if(tlOpen())closeTimeline();else openTimeline();}},true);
