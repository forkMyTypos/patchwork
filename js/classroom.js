"use strict";
/* ===== Classroom (optional network feature): teacher broadcasts, students receive, students work privately =====
   Privacy is structural:
   - Nothing connects unless you create or join a classroom, and only to the relay server you set.
   - A teacher transmits ONLY while "Broadcast" is on, and only clsSnapshot(): the open page's text, highlight
     colours and ink, built field by field. No database, other projects, folders, history or handwriting.
   - A student connection has no way to send content: it can only say hello and ping.
   - Everything a student receives is validated (types, sizes, colours, fonts, data-image only) and rendered by the
     editor's own renderer (text as text, never HTML). Remote image URLs are never fetched. */
const CLS={name:'',roster:[],locked:false,inbox:0,relay:'',role:null,ws:null,code:'',secret:'',status:'off',students:0,teacherOnline:false,broadcast:false,timer:null,lastHash:'',retry:0,rt:null,view:null,snap:null,follow:true};
const CLS_FONTS=['Arial','Georgia','Times New Roman','Courier New','Verdana'];
const CLS_MAX={img:600_000,imgs:1_200_000,text:400_000,points:300_000,msg:1_550_000,handin:5_000_000};
// hand-in: same allow-list as the relay (no executables, no HTML/SVG)
const CLS_TYPES={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',txt:'text/plain',md:'text/markdown',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',odt:'application/vnd.oasis.opendocument.text'};
const CLS_ADJ=['Blue','Green','Amber','Swift','Quiet','Bright','Silver','Brave','Lucky','Clever'],CLS_ANI=['Tiger','Otter','Falcon','Panda','Fox','Heron','Koala','Lynx','Robin','Whale'];
function clsFallbackName(){const r=n=>crypto.getRandomValues(new Uint32Array(1))[0]%n;return CLS_ADJ[r(10)]+' '+CLS_ANI[r(10)]+' '+(10+r(90));}
function clsTokKey(){return 'pw-cls-'+CLS.code;}
try{CLS.relay=localStorage.getItem('pw-relay')||'';}catch(e){}
function clsRelayOk(u){try{const x=new URL(u);return x.protocol==='https:'||(x.protocol==='http:'&&/^(localhost|127\.0\.0\.1)$/.test(x.hostname));}catch(e){return false;}}
function clsWsUrl(code){const x=new URL(CLS.relay);x.protocol=x.protocol==='https:'?'wss:':'ws:';x.pathname=x.pathname.replace(/\/$/,'')+'/api/ws';x.search='?code='+encodeURIComponent(code);return x.toString();}
function clsHex(c){if(!c)return null;const h=normalizeHex(c);if(h)return h;const m=String(c).match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);return m?'#'+[m[1],m[2],m[3]].map(n=>(+n).toString(16).padStart(2,'0')).join(''):null;}

/* ---------- teacher: build the broadcast from the open page only ---------- */
const _clsImgCache=new Map();
async function clsImage(src){const h=imgHashOf(src);if(!h)return /^data:image\/(png|jpeg|gif|webp);base64,/.test(src)?src:null;   // hotlinked URLs are never shared
  if(_clsImgCache.has(h))return _clsImgCache.get(h);const r=await db.images.get(h);const u=r&&r.blob?await _blobToDataURL(r.blob):null;_clsImgCache.set(h,u);return u;}
async function clsSnapshot(){const out={v:1,title:projName(pid).slice(0,80),w:Math.round(drawW),scroll:+(scrollTop()/drawW).toFixed(4),paras:[],marks:{},strokes:[]};let imgBytes=0;
  for(const p of editor.getDoc()){const runs=[];for(const r of p.runs){
    if(r.type==='image'){const u=await clsImage(r.src);if(u&&u.length<=CLS_MAX.img&&imgBytes+u.length<=CLS_MAX.imgs){imgBytes+=u.length;runs.push({img:u,w:r.width||100,bg:clsHex(r.bg)});}else runs.push({text:'[image not shared]',color:'#7a7a92',i:1});continue;}
    if(!r.text)continue;const x={text:r.text};if(r.bold)x.b=1;if(r.italic)x.i=1;if(r.underline)x.u=1;const c=clsHex(r.color);if(c)x.color=c;if(r.size)x.size=r.size;if(r.font&&CLS_FONTS.includes(r.font))x.font=r.font;
    if(r.mark){const ms=getMarkStyle(r.mark);if(ms){x.mk=String(r.mark);out.marks[x.mk]={c:clsHex(ms.color)||'#818cf8',fx:ms.fx||{}};}}runs.push(x);}
    out.paras.push({a:p.align,r:runs});}
  for(const s of strokes)out.strokes.push({tool:s.tool,color:clsHex(s.color)||'#ece6da',p:s.pts.map(q=>[+q.xn.toFixed(4),+q.yn.toFixed(4),+q.wn.toFixed(5)])});
  return out;}
async function clsTick(){if(CLS.role!=='teacher'||!CLS.broadcast||!CLS.ws||CLS.ws.readyState!==1)return;
  let body;try{body=await clsSnapshot();}catch(e){console.error(e);return;}const json=JSON.stringify({t:'state',body});const h=contentHash(json);if(h===CLS.lastHash)return;
  if(json.length>CLS_MAX.msg){if(CLS.lastHash!=='big'){toast('This page is too large to broadcast (images?) — students keep the last version','err');CLS.lastHash='big';}return;}
  CLS.lastHash=h;CLS.ws.send(json);}
function clsSetBroadcast(on){CLS.broadcast=!!on;clearInterval(CLS.timer);CLS.lastHash='';if(CLS.broadcast){CLS.timer=setInterval(clsTick,700);clsTick();}else if(CLS.ws&&CLS.ws.readyState===1)CLS.ws.send('{"t":"clear"}');clsRender();}

/* ---------- connections ---------- */
async function clsCreate(){if(!clsRelayOk(CLS.relay)){toast('Set the classroom server first','err');return;}
  try{const r=await fetch(CLS.relay.replace(/\/$/,'')+'/api/session',{method:'POST'});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();CLS.code=j.code;CLS.secret=j.secret;}catch(e){toast('Could not create a classroom: '+e.message,'err');return;}
  CLS.role='teacher';clsConnect();}
function clsJoin(code,name){CLS.name=String(name||'').trim().slice(0,24)||clsFallbackName();code=String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(!/^[A-HJ-NP-TV-Z2-9]{10}$/.test(code)){toast('That code doesn’t look right (10 letters/numbers)','err');return;}
  if(!clsRelayOk(CLS.relay)){toast('Set the classroom server first','err');return;}CLS.role='student';CLS.code=code;clsConnect();clsOpenView();}
function clsConnect(){clearTimeout(CLS.rt);let ws;try{ws=new WebSocket(clsWsUrl(CLS.code));}catch(e){clsState('off');return;}CLS.ws=ws;clsState(CLS.retry?'retry':'connecting');
  ws.onopen=()=>{let tok='';try{tok=localStorage.getItem(clsTokKey())||'';}catch(e){}ws.send(JSON.stringify(CLS.role==='teacher'?{t:'hello',secret:CLS.secret}:{t:'hello',name:CLS.name,resume:tok||undefined}));};
  ws.onmessage=ev=>{let m;if(typeof ev.data!=='string'||ev.data.length>(CLS.role==='teacher'?7_200_000:CLS_MAX.msg+200))return;try{m=JSON.parse(ev.data);}catch(e){return;}clsOnMessage(m);};
  ws.onclose=ev=>{if(CLS.ws!==ws)return;CLS.ws=null;if(ev.code===4404||ev.code===4403||ev.code===4423||ev.code===4429||ev.code===1008||!CLS.role){clsState('off');if(ev.code===4404&&CLS.role)toast(CLS.role==='student'?'The classroom has ended':'Classroom ended','info');if(ev.code===4429)toast('That classroom is full','err');if(ev.code===4423)toast('That classroom is locked \u2014 ask the teacher','err');if(ev.code===4403)toast(CLS.role==='student'?'You were removed from this classroom':'Not accepted as teacher','err');clsReset(false);return;}
    if(!CLS.welcomed&&CLS.retry>=1){toast(CLS.role==='student'?'Couldn\u2019t join \u2014 check the code (the class may have ended)':'Couldn\u2019t reach the classroom server','err');clsReset(false);return;}
    clsState('retry');CLS.retry=Math.min(CLS.retry+1,5);CLS.rt=setTimeout(clsConnect,Math.min(15000,1000*2**CLS.retry));};}
function clsOnMessage(m){if(m.t==='welcome'){CLS.retry=0;CLS.welcomed=true;clsState('on');if(CLS.role==='teacher'){CLS.lastHash='';}else{CLS.teacherOnline=!!m.teacher;if(typeof m.name==='string')CLS.name=m.name;if(typeof m.token==='string'&&/^[0-9a-f]{64}$/.test(m.token))try{localStorage.setItem(clsTokKey(),m.token);}catch(e){}}clsRender();return;}
  if(m.t==='roster'&&CLS.role==='teacher'&&Array.isArray(m.list)){CLS.roster=m.list.slice(0,200).map(p=>({id:String(p.id).slice(0,16),name:String(p.name).slice(0,24),status:['on','retry','off'].includes(p.status)?p.status:'off'}));CLS.students=CLS.roster.filter(p=>p.status==='on').length;CLS.locked=!!m.locked;clsRender();return;}
  if(m.t==='handin'&&CLS.role==='teacher'){clsReceive(m);return;}
  if(m.t==='handin-result'&&CLS.role==='student'){toast(m.ok?'Handed in \u201c'+String(m.name).slice(0,60)+'\u201d':String(m.why||'Hand-in failed').slice(0,120),m.ok?'ok':'err');return;}
  if(m.t==='kicked'){return;}
  if(CLS.role!=='student')return;   // everything below is teacher -> student
  if(m.t==='teacher'){CLS.teacherOnline=!!m.online;clsRender();return;}
  if(m.t==='state'){let snap;try{snap=clsClean(m.body);}catch(e){console.warn('classroom: rejected broadcast',e.message);return;}CLS.snap=snap;CLS.teacherOnline=true;clsDrawView();clsRender();return;}
  if(m.t==='clear'){CLS.snap=null;clsDrawView();return;}
  if(m.t==='ended'){toast('The classroom has ended','info');}}
function clsLeave(){if(CLS.role==='teacher'&&CLS.ws&&CLS.ws.readyState===1)CLS.ws.send('{"t":"end"}');clsReset(true);}
function clsReset(closeView){const ws=CLS.ws;CLS.ws=null;clearTimeout(CLS.rt);clearInterval(CLS.timer);try{if(ws)ws.close(1000,'bye');}catch(e){}
  Object.assign(CLS,{welcomed:false,role:null,code:'',secret:'',broadcast:false,students:0,teacherOnline:false,retry:0,lastHash:''});clsState('off');if(closeView&&CLS.view){CLS.view.remove();CLS.view=null;CLS.snap=null;}clsRender();}
function clsState(s){CLS.status=s;clsRender();}

/* ---------- student: validate everything received ---------- */
function clsClean(b){const fail=w=>{throw new Error(w);};if(!b||typeof b!=='object'||b.v!==1)fail('version');
  const str=(x,n)=>typeof x==='string'?x.slice(0,n):'',num=(x,lo,hi,d)=>(typeof x==='number'&&isFinite(x))?Math.min(hi,Math.max(lo,x)):d,hex=x=>(typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x))?x.toLowerCase():null;
  const out={title:str(b.title,80),w:num(b.w,200,4000,800),scroll:num(b.scroll,0,1e4,0),paras:[],marks:{},strokes:[]};let text=0,imgs=0,points=0;
  if(b.marks&&typeof b.marks==='object')for(const k of Object.keys(b.marks).slice(0,3000)){if(!/^\d{1,12}$/.test(k))continue;const m=b.marks[k]||{},c=hex(m.c)||'#818cf8',fx={};for(const f of ['bg','ul','b','i','s','tc'])if(m.fx&&m.fx[f]===true)fx[f]=true;out.marks[k]={color:c,bg:hexA(c,.16),fx};}
  for(const p of (Array.isArray(b.paras)?b.paras:[]).slice(0,5000)){const runs=[];for(const r of (Array.isArray(p&&p.r)?p.r:[]).slice(0,500)){if(!r||typeof r!=='object')continue;
      if(typeof r.img==='string'){if(r.img.length<=CLS_MAX.img&&imgs+r.img.length<=CLS_MAX.imgs&&/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(r.img)){imgs+=r.img.length;runs.push({type:'image',src:r.img,width:Math.round(num(r.w,10,100,100)),bg:hex(r.bg)});}continue;}
      const t=str(r.text,20000);if(!t||text+t.length>CLS_MAX.text)continue;text+=t.length;
      runs.push({type:'text',text:t,bold:r.b===1,italic:r.i===1,underline:r.u===1,color:hex(r.color),size:r.size==null?null:Math.round(num(r.size,8,96,15)),font:CLS_FONTS.includes(r.font)?r.font:null,mark:(typeof r.mk==='string'&&out.marks[r.mk])?r.mk:null});}
    out.paras.push({align:['left','center','right'].includes(p&&p.a)?p.a:'left',t:null,runs:runs.length?runs:[{type:'text',text:''}]});}
  for(const s of (Array.isArray(b.strokes)?b.strokes:[]).slice(0,8000)){if(!s||!Array.isArray(s.p)||!['pen','hl','eraser'].includes(s.tool))continue;const pts=[];
    for(const q of s.p.slice(0,5000)){if(!Array.isArray(q)||points>=CLS_MAX.points)break;const x=num(q[0],-0.5,1.5,NaN),y=num(q[1],-1,5000,NaN),w=num(q[2],0,0.2,0.004);if(isNaN(x)||isNaN(y))continue;pts.push({xn:x,yn:y,wn:w});points++;}
    if(pts.length)out.strokes.push({tool:s.tool,color:hex(s.color)||'#ece6da',pts});}
  return out;}

/* ---------- the Teacher View: a read-only floating window (same window system as pop-up editors) ---------- */
function clsOpenView(){if(CLS.view){CLS.view.style.display='flex';return;}const w=document.createElement('div');w.className='panel mini-win cls-view';
  w.innerHTML='<div class="panel-h"><span class="cls-dot"></span><div class="panel-t">Teacher</div><span class="cls-ro">read-only</span><label class="cls-follow" title="Scroll with the teacher"><input type="checkbox" checked> follow</label><button class="panel-x" title="Hide (you stay in the classroom)">×</button></div><div class="cls-scroll"><div class="cls-page"><div class="editor cls-ed"></div><canvas class="cls-ink"></canvas></div><div class="cls-wait">Waiting for the teacher to broadcast…</div></div>';
  w.style.left=Math.max(8,innerWidth*0.5)+'px';w.style.top='70px';w.style.zIndex=++_miniZ;document.body.appendChild(w);makeDraggable(w,w.querySelector('.panel-h'));w.addEventListener('pointerdown',()=>{w.style.zIndex=++_miniZ;},true);
  w.querySelector('.panel-x').onclick=()=>{w.style.display='none';};const fl=w.querySelector('.cls-follow input');fl.onchange=()=>{CLS.follow=fl.checked;clsScroll();};
  const sc=w.querySelector('.cls-scroll');sc.addEventListener('wheel',()=>{CLS.follow=false;fl.checked=false;},{passive:true});sc.addEventListener('touchmove',()=>{CLS.follow=false;fl.checked=false;},{passive:true});
  new ResizeObserver(()=>clsFit()).observe(sc);CLS.view=w;clsDrawView();clsRender();}
// render at the teacher's page width, then scale to fit: text and ink line up exactly as on the teacher's screen
function clsDrawView(){const w=CLS.view;if(!w)return;const s=CLS.snap,ed=w.querySelector('.cls-ed'),cv=w.querySelector('.cls-ink'),page=w.querySelector('.cls-page');w.querySelector('.cls-wait').style.display=s?'none':'';page.style.display=s?'':'none';if(!s)return;
  w.querySelector('.panel-t').textContent='Teacher · '+(s.title||'page');const G=24;page.style.width=(s.w+G+12)+'px';ed.style.paddingLeft=(G+10)+'px';
  editor.renderParas(s.paras,ed,{markStyle:id=>s.marks[id]||null});ed.querySelectorAll('img').forEach(i=>{i.referrerPolicy='no-referrer';});
  let bottom=ed.offsetHeight;for(const k of s.strokes)for(const q of k.pts)bottom=Math.max(bottom,q.yn*s.w+40);const H=Math.min(30000,bottom);page.style.height=H+'px';
  const dpr=Math.min(2,window.devicePixelRatio||1);cv.width=Math.round((s.w+G+12)*dpr);cv.height=Math.round(H*dpr);cv.style.width=(s.w+G+12)+'px';cv.style.height=H+'px';const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,s.w+G+12,H);
  for(const k of s.strokes){c.lineCap='round';c.lineJoin='round';if(k.tool==='eraser'){c.globalCompositeOperation='destination-out';c.strokeStyle='#000';c.fillStyle='#000';c.globalAlpha=1;}else{c.globalCompositeOperation='source-over';c.strokeStyle=k.color;c.fillStyle=k.color;c.globalAlpha=k.tool==='hl'?.3:1;}
    const P=k.pts,X=q=>G+q.xn*s.w,Y=q=>q.yn*s.w;if(P.length===1){c.beginPath();c.arc(X(P[0]),Y(P[0]),Math.max(.5,P[0].wn*s.w/2),0,7);c.fill();}else for(let i=1;i<P.length;i++){c.lineWidth=Math.max(.5,(P[i-1].wn+P[i].wn)/2*s.w);c.beginPath();c.moveTo(X(P[i-1]),Y(P[i-1]));c.lineTo(X(P[i]),Y(P[i]));c.stroke();}}
  c.globalCompositeOperation='source-over';c.globalAlpha=1;clsFit();}
function clsFit(){const w=CLS.view,s=CLS.snap;if(!w||!s)return;const sc=w.querySelector('.cls-scroll'),page=w.querySelector('.cls-page');const k=Math.min(1,(sc.clientWidth-4)/(s.w+36));page.style.transform='scale('+k+')';page.style.marginBottom=(-(1-k)*page.offsetHeight)+'px';CLS.k=k;clsScroll();}
function clsScroll(){const w=CLS.view,s=CLS.snap;if(!w||!s||!CLS.follow)return;w.querySelector('.cls-scroll').scrollTop=s.scroll*s.w*(CLS.k||1);}

/* ---------- panel ---------- */
let clsPanel=null;
function openClassroom(){if(!clsPanel){clsPanel=document.createElement('div');clsPanel.className='panel cls-panel';document.body.appendChild(clsPanel);}clsPanel.style.display='flex';clsPanel.style.left=Math.max(8,Math.min(360,innerWidth-380))+'px';clsPanel.style.top='70px';clsPanel.style.right='auto';clsRender(true);}
function clsRender(full){if(CLS.view){const d=CLS.view.querySelector('.cls-dot');d.className='cls-dot '+(CLS.status==='on'&&CLS.teacherOnline?'on':CLS.status==='off'?'off':'retry');d.title=CLS.status==='on'?(CLS.teacherOnline?'Receiving the teacher':'Connected — teacher offline'):CLS.status==='off'?'Disconnected':'Reconnecting…';}
  if(!clsPanel||clsPanel.style.display==='none')return;const dot=t=>'<span class="cls-dot '+(CLS.status==='on'?'on':CLS.status==='off'?'off':'retry')+'"></span>'+t;
  const st=CLS.status==='on'?'Connected':CLS.status==='off'?'Disconnected':'Reconnecting…';let h='<div class="panel-h"><div class="panel-t">Classroom</div><button class="panel-x">×</button></div><div class="panel-b">';
  if(!CLS.role){h+='<div class="pf"><div class="pf-l">Classroom server</div><input class="pf-in cls-relay" placeholder="https://your-relay.workers.dev" value="'+esc(CLS.relay)+'"><div class="hw-hint">Only used when you create or join a classroom.</div></div>'+
      '<div class="pf"><div class="pf-l">Teach</div><button class="fx-primary cls-create">Create a classroom</button></div>'+
      '<div class="pf"><div class="pf-l">Learn</div><input class="pf-in cls-code" placeholder="Classroom code" maxlength="14" style="text-transform:uppercase;letter-spacing:.12em"><div class="hw-row" style="margin-top:6px"><input class="pf-in cls-name" placeholder="Your name (optional)" maxlength="24" style="flex:1"><button class="fx-primary cls-join">Join</button></div><div class="hw-hint">Just a display name for this class. No account.</div></div>';}
  else if(CLS.role==='teacher'){h+='<div class="pf"><div class="pf-l">Classroom code — give this to your students</div><div class="cls-code-big">'+esc(CLS.code.slice(0,5)+' '+CLS.code.slice(5))+'</div></div><div class="cls-status">'+dot(st)+' · '+CLS.students+' student'+(CLS.students!==1?'s':'')+'</div>'+
      '<div class="cls-roster">'+(CLS.roster.length?CLS.roster.map(p=>'<div class="cls-person"><span class="cls-dot '+p.status+'"></span><span class="cls-pname">'+esc(p.name)+'</span><span class="hw-hint">'+(p.status==='retry'?'reconnecting':p.status==='off'?'disconnected':'')+'</span><button class="pr-tool cls-kick" data-id="'+esc(p.id)+'" title="Remove from the classroom">\u00d7</button></div>').join(''):'<div class="hw-hint">No students yet.</div>')+'</div>'+
      '<label class="pf-row"><input type="checkbox" class="pf-cb cls-lock"'+(CLS.locked?' checked':'')+'> Lock classroom (no new students)</label>'+
      '<button class="pbtn cls-inbox">\ud83d\udce5 Inbox'+(CLS.inbox?' ('+CLS.inbox+' new)':'')+'</button>'+
      '<label class="pf-row cls-bc"><input type="checkbox" class="pf-cb cls-bcast"'+(CLS.broadcast?' checked':'')+'> <b>Broadcast</b>&nbsp;this page'+(CLS.broadcast?' — students see “'+esc(projName(pid))+'”':' (off: nothing is sent)')+'</label>'+
      '<button class="fx-link danger cls-end">End classroom</button>';}
  else{h+='<div class="cls-status">'+dot(st+(CLS.status==='on'?(CLS.teacherOnline?' · receiving the teacher':' · teacher offline'):''))+'</div><div class="hw-hint">You are \u201c'+esc(CLS.name)+'\u201d</div><div class="hw-row"><button class="fx-primary cls-show">Show teacher view</button><button class="pbtn cls-hand">\ud83d\udce4 Hand in a file\u2026</button><input type="file" class="cls-file" hidden accept="'+Object.keys(CLS_TYPES).map(e=>'.'+e).join(',')+'"><button class="fx-link danger cls-leave">Leave classroom</button></div>';}
  h+='<div class="hw-hint cls-privacy">Teacher \u2192 students only. Students never send their pages. A hand-in goes only to the teacher, is never shown to other students, and the server doesn\u2019t keep it.</div></div>';
  clsPanel.innerHTML=h;makeDraggable(clsPanel,clsPanel.querySelector('.panel-h'));const q=x=>clsPanel.querySelector(x);q('.panel-x').onclick=()=>clsPanel.style.display='none';
  if(q('.cls-relay'))q('.cls-relay').onchange=e=>{const v=e.target.value.trim();if(v&&!clsRelayOk(v)){toast('Use an https:// address','err');return;}CLS.relay=v;try{localStorage.setItem('pw-relay',v);}catch(_){}};
  if(q('.cls-create'))q('.cls-create').onclick=()=>{const r=q('.cls-relay');if(r){r.dispatchEvent(new Event('change'));}clsCreate();};
  if(q('.cls-join')){const go=()=>{const r=q('.cls-relay');if(r)r.dispatchEvent(new Event('change'));clsJoin(q('.cls-code').value,q('.cls-name').value);};q('.cls-join').onclick=go;q('.cls-code').onkeydown=e=>{if(e.key==='Enter')go();};}
  if(q('.cls-bcast'))q('.cls-bcast').onchange=e=>clsSetBroadcast(e.target.checked);
  if(q('.cls-end'))q('.cls-end').onclick=e=>{const b=e.currentTarget;if(!b.classList.contains('armed')){b.classList.add('armed');b.textContent='Click again to end for everyone';return;}clsLeave();};
  clsPanel.querySelectorAll('.cls-kick').forEach(b=>b.onclick=()=>{if(!b.classList.contains('armed')){b.classList.add('armed');b.textContent='remove?';setTimeout(()=>{if(b.isConnected){b.classList.remove('armed');b.textContent='\u00d7';}},2500);return;}if(CLS.ws&&CLS.ws.readyState===1)CLS.ws.send(JSON.stringify({t:'kick',id:b.dataset.id}));});
  if(q('.cls-lock'))q('.cls-lock').onchange=e=>{if(CLS.ws&&CLS.ws.readyState===1)CLS.ws.send(JSON.stringify({t:'lock',on:e.target.checked}));};
  if(q('.cls-inbox'))q('.cls-inbox').onclick=openInbox;
  if(q('.cls-hand')){const fi=q('.cls-file');q('.cls-hand').onclick=()=>fi.click();fi.onchange=()=>{const f=fi.files[0];fi.value='';if(f)clsHandIn(f);};}
  if(q('.cls-show'))q('.cls-show').onclick=clsOpenView;if(q('.cls-leave'))q('.cls-leave').onclick=clsLeave;}

/* ---------- hand-ins: student -> teacher only (a separate channel from the broadcast) ---------- */
function clsExt(n){const m=/\.([a-z0-9]{1,5})$/i.exec(n||'');return m?m[1].toLowerCase():'';}
function clsSize(n){return n>1e6?(n/1e6).toFixed(1)+' MB':Math.max(1,Math.round(n/1e3))+' KB';}
async function clsHandIn(f){if(CLS.role!=='student'||!CLS.ws||CLS.ws.readyState!==1){toast('Not connected to the classroom','err');return;}
  const ext=clsExt(f.name);if(!CLS_TYPES[ext]){toast('That file type can\u2019t be handed in','err');return;}if(f.size>CLS_MAX.handin){toast('File too large (max 5 MB)','err');return;}
  // explicit confirmation: the student sees exactly what will be sent, and to whom
  if(!confirm('Hand in \u201c'+f.name+'\u201d ('+clsSize(f.size)+') to the teacher?\n\nOnly the teacher receives it.'))return;
  const data=(await _blobToDataURL(f)).split(',')[1]||'';CLS.ws.send(JSON.stringify({t:'handin',file:{name:f.name.slice(0,120),type:CLS_TYPES[ext],data}}));toast('Sending\u2026','info');}
async function clsReceive(m){const f=m.file||{},ext=clsExt(f.name);if(!CLS_TYPES[ext]||f.type!==CLS_TYPES[ext]||typeof f.data!=='string'||!/^[A-Za-z0-9+/=]+$/.test(f.data))return;
  let blob;try{const bin=atob(f.data);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);if(u.length>CLS_MAX.handin)return;blob=new Blob([u],{type:'application/octet-stream'});}catch(e){return;}
  const rec={at:Date.now(),code:CLS.code,from:String(m.from&&m.from.name||'?').slice(0,24),name:String(f.name).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,120),ext,size:blob.size,blob};
  try{await db.inbox.add(rec);}catch(e){_quotaToast(e);return;}CLS.inbox++;toast('\ud83d\udce5 '+rec.from+' handed in \u201c'+rec.name+'\u201d','ok');clsRender();renderInbox();}
let inboxEl=null;
function openInbox(){if(!inboxEl){inboxEl=document.createElement('div');inboxEl.className='panel cls-inbox-panel';inboxEl.innerHTML='<div class="panel-h"><div class="panel-t">\ud83d\udce5 Classroom inbox</div><button class="panel-x">\u00d7</button></div><div class="panel-b"><div class="inbox-list"></div><div class="hw-hint">Hand-ins are saved only in this browser. Nothing opens by itself: download a file to look at it.</div></div>';document.body.appendChild(inboxEl);inboxEl.querySelector('.panel-x').onclick=()=>inboxEl.style.display='none';makeDraggable(inboxEl,inboxEl.querySelector('.panel-h'));}
  CLS.inbox=0;clsRender();inboxEl.style.display='flex';inboxEl.style.left=Math.max(8,innerWidth-440)+'px';inboxEl.style.top='80px';inboxEl.style.right='auto';renderInbox();}
async function renderInbox(){if(!inboxEl||inboxEl.style.display==='none')return;const list=inboxEl.querySelector('.inbox-list');const rows=(await db.inbox.orderBy('at').reverse().toArray());
  list.innerHTML=rows.length?'':'<div class="sr-empty" style="padding:18px">Nothing handed in yet.</div>';
  rows.forEach(r=>{const d=document.createElement('div');d.className='inbox-row';d.innerHTML='<div class="inbox-main"><b></b><span class="inbox-file"></span><span class="hw-hint"></span></div><button class="pbtn inbox-dl">Download</button><button class="pr-tool inbox-rm" title="Delete">\ud83d\uddd1</button>';
    d.querySelector('b').textContent=r.from;d.querySelector('.inbox-file').textContent=r.name;d.querySelector('.hw-hint').textContent=clsSize(r.size)+' \u00b7 '+fmtAbs(r.at);
    d.querySelector('.inbox-dl').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(r.blob);a.download=r.name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);};
    const rm=d.querySelector('.inbox-rm');rm.onclick=async()=>{if(!rm.classList.contains('armed')){rm.classList.add('armed');rm.textContent='\u2713?';return;}await db.inbox.delete(r.id);renderInbox();};list.appendChild(d);});}
