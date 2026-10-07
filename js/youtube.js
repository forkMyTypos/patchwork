"use strict";
/* ===== YouTube objects (a guest in Patchwork) =====
   A YouTube video is a free picture record with a `yt` video id (db.pics, pics.js): same drag / resize / delete / undo /
   paragraph anchoring / persistence. It shows the official embedded player (youtube-nocookie.com), loaded only when a
   page has a video the user added. Optional `pin`: kept at a fixed spot on the screen (px,py) while the page scrolls.
   YT mode: one video is the active one; "Timestamp" makes a Patchwork mark (margin timestamp, or a highlight on the
   selected text) carrying vt={v: video id, s: seconds, o: video object id}. A mark's popup shows its video time; clicking
   it seeks that video (the right one, by id), switching page if needed. Player time comes from the embed's own
   postMessage channel (no YouTube API key, no extra script). */
const YT={mode:false,active:null,times:new Map(),ready:new Set()};
const YT_ID=/^[A-Za-z0-9_-]{11}$/;
// watch?v=ID and youtu.be/ID (optional t= / start= in seconds or 1h2m3s); anything else: null
function ytId(u){let x;try{x=new URL(String(u||'').trim());}catch(e){return null;}if(!/^https?:$/.test(x.protocol))return null;
  const h=x.hostname.replace(/^(www|m)\./,'');let id=null;
  if(h==='youtube.com'&&x.pathname==='/watch')id=x.searchParams.get('v');else if(h==='youtu.be')id=x.pathname.slice(1).split('/')[0];
  if(!id||!YT_ID.test(id))return null;let s=0;const t=x.searchParams.get('t')||x.searchParams.get('start');
  if(t){const m=/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);if(m)s=(+m[1]||0)*3600+(+m[2]||0)*60+(+m[3]||0);}return{id,start:s};}
function ytFmt(s){s=Math.max(0,Math.floor(+s||0));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return (h?h+':'+String(m).padStart(2,'0'):String(m))+':'+String(x).padStart(2,'0');}

/* ---- adding ---- */
async function addYouTube(info,at){if(!editor||pid==null||!info)return;const U=inkW,w=Math.min(480,drawW*0.6),h=w*9/16+30;   // 30 = title bar
  const wr=wrap.getBoundingClientRect();let px,py;
  if(at){px=at.clientX-wr.left+wrap.scrollLeft;py=at.clientY-wr.top+wrap.scrollTop;}
  else{const s=getSelection();let r=null;if(s&&s.rangeCount&&noteEd.contains(s.anchorNode))r=s.getRangeAt(0).getClientRects()[0];
    if(r){px=r.left-wr.left+wrap.scrollLeft;py=r.bottom-wr.top+wrap.scrollTop+6;}else{px=gutter+24+wrap.scrollLeft;py=wrap.scrollTop+40;}}
  const p={pid,kind:'pic',src:'',yt:info.id,st:info.start||0,u:1,x:Math.max(0,(px-gutter)/U),y:Math.max(0,py/U),w:w/U,h:h/U,t:Date.now()};picFix(p);p._dy=0;reanchor(p);
  p.id=await db.pics.add(picClean(stripId(p)));pics.push(p);picRecord(p,null);picPick(p);updatePad();updateHint();}
function ytAskUrl(){const v=window.prompt('YouTube video link (youtube.com/watch?v=… or youtu.be/…)');if(v==null)return;const i=ytId(v);
  if(!i){toast('That isn’t a YouTube video link','err');return;}addYouTube(i,null);}

/* ---- the object: title bar + official embedded player ---- */
function ytBuild(el,p){el.classList.add('pic-yt');YT.ready.delete(p.id);
  el.innerHTML='<div class="yt-bar" title="Drag to move"><span class="yt-logo">▶ YouTube</span><span class="yt-t"></span><span class="yt-sp"></span>'+
    '<button class="yt-act" title="Make this the active video (YT mode)">Use</button><button class="yt-stamp" title="Timestamp: link this moment to the selected text, or add it to the margin">⏱ Timestamp</button>'+
    '<button class="yt-pin" title="Pin to the screen (stays put while you scroll)">📌</button></div>'+
    '<div class="yt-box"><iframe allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="YouTube video"></iframe><div class="yt-fail">The video couldn’t load here (offline, or the video can’t be embedded).</div></div>'+
    ['tl','tr','bl','br'].map(c=>'<div class="pic-h '+c+'" data-c="'+c+'" title="Drag to resize"></div>').join('');
  const f=el.querySelector('iframe');f.src='https://www.youtube-nocookie.com/embed/'+p.yt+'?enablejsapi=1&rel=0&playsinline=1'+(p.st?'&start='+(p.st|0):'')+'&origin='+encodeURIComponent(location.origin);
  f.onload=()=>{try{f.contentWindow.postMessage(JSON.stringify({event:'listening',id:String(p.id),channel:'widget'}),'*');}catch(e){}
    setTimeout(()=>{if(!YT.ready.has(p.id))el.classList.add('yt-failed');},12000);};
  el.querySelectorAll('.yt-bar button').forEach(b=>{b.addEventListener('pointerdown',e=>{e.stopPropagation();e.preventDefault();});});   // buttons don't start a drag or lose the text selection
  el.querySelector('.yt-act').onclick=()=>ytActivate(p);el.querySelector('.yt-stamp').onclick=()=>ytStamp(p);el.querySelector('.yt-pin').onclick=()=>ytPin(p);}
function ytFrame(p){const el=_picEl.get(p);return el&&el.querySelector('iframe');}
function ytCmd(p,func,args){const f=ytFrame(p);if(!f||!f.contentWindow)return;try{f.contentWindow.postMessage(JSON.stringify({event:'command',func,args:args||[]}),'*');}catch(e){}}
// the embed reports its state to us: keep each video's current time (by which iframe sent it)
addEventListener('message',e=>{if(!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin))return;let d;try{d=typeof e.data==='string'?JSON.parse(e.data):e.data;}catch(_){return;}if(!d||typeof d!=='object')return;
  const p=pics.find(q=>q.yt&&ytFrame(q)&&ytFrame(q).contentWindow===e.source);if(!p)return;
  if(!YT.ready.has(p.id)){YT.ready.add(p.id);const el=_picEl.get(p);if(el)el.classList.remove('yt-failed');if(p._seek!=null){const s=p._seek;p._seek=null;ytCmd(p,'seekTo',[s,true]);ytCmd(p,'playVideo');}}
  const t=d.info&&typeof d.info.currentTime==='number'?d.info.currentTime:null;if(t!=null){YT.times.set(p.id,t);const el=_picEl.get(p),tt=el&&el.querySelector('.yt-t');if(tt)tt.textContent=ytFmt(t);}});

/* ---- YT mode: an active video ---- */
function ytVideos(){return pics.filter(p=>p.yt);}
function ytSync(){const b=document.getElementById('yt-mode');const has=ytVideos().length>0;if(b){b.style.display=has?'':'none';b.classList.toggle('on',YT.mode);}
  if(!has&&YT.mode)YT.mode=false;if(YT.active&&!pics.includes(YT.active))YT.active=null;if(YT.mode&&!YT.active)YT.active=ytVideos()[0]||null;
  document.body.classList.toggle('yt-mode',YT.mode);for(const p of ytVideos()){const el=_picEl.get(p);if(el)el.classList.toggle('yt-on',YT.mode&&YT.active===p);}}
function ytToggleMode(){YT.mode=!YT.mode;ytSync();if(YT.mode)toast('YT mode: ⏱ Timestamp on the active video links that moment to your selected text (or the margin)','info');}
function ytActivate(p){YT.active=p;if(!YT.mode)YT.mode=true;ytSync();}

/* ---- timestamps: a Patchwork mark that points at a moment in a video ---- */
async function ytStamp(p){ytActivate(p);if(!YT.ready.has(p.id))toast('Start the video first, so Patchwork knows where it is','info');const s=Math.floor(YT.times.get(p.id)||p.st||0);
  const vt={v:p.yt,s,o:p.id};
  const ds=getSelection(),live=ds&&ds.rangeCount&&!ds.isCollapsed&&noteEd.contains(ds.anchorNode);   // only text selected right now
  if(live&&editor.hasSelection()){const snip=editor.selText().slice(0,200);const m=await addMark({type:'note',name:snip.slice(0,80),snippet:snip,anchor:{kind:'text'},vt},false);   // the selected text gets the video moment
    if(!m)return;if(editor.applyMark(m.id)){redrawInk();flashPin(m.id);toast('Linked to the video at '+ytFmt(s),'ok');}else{await deleteMark(m);toast('Couldn’t link — try selecting again','err');}return;}
  const el=_picEl.get(p),top=el?parseFloat(el.style.top)||0:scrollTop();   // a margin timestamp beside the video
  const m=await addMark({type:'note',name:'▶ '+ytFmt(s),anchor:{kind:'time',yn:(p.pin?scrollTop()+p.py:top)/drawW},vt},false);if(m){redrawInk();flashPin(m.id);toast('Timestamp '+ytFmt(s)+' added to the margin','ok');}}
// link an existing mark to the active video's current moment (from the mark's popup)
function ytLinkMark(m){const p=YT.active;if(!p)return false;m.vt={v:p.yt,s:Math.floor(YT.times.get(p.id)||p.st||0),o:p.id};saveMark(m);return true;}
// jump: the video with that id (the same object if it still exists), on this page or another, seeks to the moment
async function ytJump(vt){if(!vt||!YT_ID.test(vt.v||''))return;let p=pics.find(q=>q.yt===vt.v&&q.id===vt.o)||pics.find(q=>q.yt===vt.v);
  if(!p){const rec=(await db.pics.toArray()).find(q=>!q.del&&q.yt===vt.v&&(q.id===vt.o))||(await db.pics.toArray()).find(q=>!q.del&&q.yt===vt.v);
    if(!rec){toast('That video isn’t on any page any more','err');return;}await switchProject(rec.pid);p=pics.find(q=>q.id===rec.id);if(!p)return;}
  ytActivate(p);const el=_picEl.get(p);
  if(el&&!p.pin){const r=el.getBoundingClientRect(),w=wrap.getBoundingClientRect();if(r.top<w.top||r.bottom>w.bottom)wrap.scrollTop+=r.top-w.top-60;}
  if(YT.ready.has(p.id)){ytCmd(p,'seekTo',[vt.s,true]);ytCmd(p,'playVideo');}else p._seek=vt.s;}

/* ---- pin: keep a video at a fixed spot on the screen ---- */
function ytPin(p){const el=_picEl.get(p);if(!el)return;const b=picSnap(p),U=inkW;
  if(!p.pin){p.pin=true;p.px=parseFloat(el.style.left)-wrap.scrollLeft;p.py=parseFloat(el.style.top)-wrap.scrollTop;}
  else{const left=wrap.scrollLeft+p.px,top=wrap.scrollTop+p.py;p.pin=false;p.x=Math.max(0,(left-gutter)/U);p.y=Math.max(0,top/U);picFix(p);p._dy=0;delete p.a;reanchor(p);}
  savePic(p);picRecord(p,b);renderPics();updatePad();}
