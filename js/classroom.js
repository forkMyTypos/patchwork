"use strict";
/* ===== Classroom (optional network feature): teacher broadcasts, students receive, students work privately =====
   Privacy is structural:
   - Nothing connects unless you create or join a classroom, and only to the relay server you set.
   - A teacher transmits ONLY while "Broadcast" is on, and only clsSnapshot(): the open page's text, highlight
     colours and ink, built field by field. No database, other projects, folders, history or handwriting.
   - The classroom server only does sign-in and connection set-up (signalling). Broadcasts and hand-ins travel
     DIRECTLY between browsers over WebRTC data channels, never through the server.
   - A student's channel accepts only teacher broadcasts; the only thing a student can send is an explicit hand-in,
     which the teacher's browser checks (type allow-list, size, rate) before keeping it.
   - Everything a student receives is validated (types, sizes, colours, fonts, data-image only) and rendered by the
     editor's own renderer (text as text, never HTML). Remote image URLs are never fetched. */
const CLS={name:'',roster:[],locked:false,inbox:0,relay:'',role:null,ws:null,code:'',secret:'',status:'off',students:0,teacherOnline:false,broadcast:false,timer:null,lastHash:'',retry:0,rt:null,view:null,snap:null,follow:true};
const CLS_FONTS=['Arial','Georgia','Times New Roman','Courier New','Verdana'];
const CLS_MAX={img:600_000,imgs:1_200_000,text:400_000,points:300_000,msg:1_550_000,handin:5_000_000};
// hand-in: same allow-list as the relay (no executables, no HTML/SVG)
const CLS_TYPES={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',txt:'text/plain',md:'text/markdown',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',odt:'application/vnd.oasis.opendocument.text',json:'application/json'};
const CLS_ADJ=['Blue','Green','Amber','Swift','Quiet','Bright','Silver','Brave','Lucky','Clever'],CLS_ANI=['Tiger','Otter','Falcon','Panda','Fox','Heron','Koala','Lynx','Robin','Whale'];
function clsFallbackName(){const r=n=>crypto.getRandomValues(new Uint32Array(1))[0]%n;return CLS_ADJ[r(10)]+' '+CLS_ANI[r(10)]+' '+(10+r(90));}
function clsTokKey(){return 'pw-cls-'+CLS.code;}
/* the owner's classroom server; when set, the address box is hidden */
const CLS_RELAY='https://patchwork-classroom.northstarcode.workers.dev';
try{CLS.relay=CLS_RELAY||localStorage.getItem('pw-relay')||'';}catch(e){CLS.relay=CLS_RELAY;}
function clsRelayOk(u){try{const x=new URL(u);return x.protocol==='https:'||(x.protocol==='http:'&&/^(localhost|127\.0\.0\.1)$/.test(x.hostname));}catch(e){return false;}}
function clsWsUrl(code){const x=new URL(CLS.relay);x.protocol=x.protocol==='https:'?'wss:':'ws:';x.pathname=x.pathname.replace(/\/$/,'')+'/api/ws';x.search='?code='+encodeURIComponent(code);return x.toString();}
function clsHex(c){if(!c)return null;const h=normalizeHex(c);if(h)return h;const m=String(c).match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);return m?'#'+[m[1],m[2],m[3]].map(n=>(+n).toString(16).padStart(2,'0')).join(''):null;}

/* ---------- teacher: build the broadcast from the open page only ---------- */
const _clsImgCache=new Map();
async function clsImage(src){const h=imgHashOf(src);if(!h)return /^data:image\/(png|jpeg|gif|webp);base64,/.test(src)?src:null;   // hotlinked URLs are never shared
  if(_clsImgCache.has(h))return _clsImgCache.get(h);const r=await db.images.get(h);const u=r&&r.blob?await _blobToDataURL(r.blob):null;_clsImgCache.set(h,u);return u;}
// where the teacher is working, across the page (0-1): the caret if it's on the page, else the middle of what they see
function clsFocusX(){const s=getSelection(),wr=wrap.getBoundingClientRect();let x=null;
  if(s&&s.rangeCount&&noteEd.contains(s.anchorNode)){const r=s.getRangeAt(0).getClientRects()[0]||(s.anchorNode.nodeType===1?s.anchorNode:s.anchorNode.parentElement).getBoundingClientRect();x=r.left-wr.left+wrap.scrollLeft-gutter;}
  if(x==null)x=wrap.scrollLeft+(wr.width-gutter)/2;return +Math.min(1,Math.max(0,x/drawW)).toFixed(4);}
async function clsSnapshot(){const out={v:1,title:projName(pid).slice(0,80),w:Math.round(drawW),ww:Math.round(pageWW||drawW),scroll:+(scrollTop()/drawW).toFixed(4),fx:clsFocusX(),paras:[],marks:{},strokes:[]};let imgBytes=0;
  for(const p of editor.getDoc()){const runs=[];for(const r of p.runs){
    if(r.type==='image'){const u=await clsImage(r.src);if(u&&u.length<=CLS_MAX.img&&imgBytes+u.length<=CLS_MAX.imgs){imgBytes+=u.length;runs.push({img:u,w:r.width||100,bg:clsHex(r.bg)});}else runs.push({text:'[image not shared]',color:'#7a7a92',i:1});continue;}
    if(!r.text)continue;const x={text:r.text};if(r.bold)x.b=1;if(r.italic)x.i=1;if(r.underline)x.u=1;const c=clsHex(r.color);if(c)x.color=c;if(r.size)x.size=r.size;if(r.font&&CLS_FONTS.includes(r.font))x.font=r.font;
    if(r.mark){const ms=getMarkStyle(r.mark);if(ms){x.mk=String(r.mark);out.marks[x.mk]={c:clsHex(ms.color)||'#818cf8',fx:ms.fx||{}};}}runs.push(x);}
    out.paras.push({a:p.align,r:runs});}
  // sent as seen on this page (relative to its width), whatever units/anchor the stroke is stored in
  for(const s of strokes){const U=inkU(s)/drawW,d=inkDy(s)/drawW;out.strokes.push({tool:s.tool,color:clsHex(s.color)||'#ece6da',p:s.pts.map(q=>[+(q.xn*U).toFixed(4),+(q.yn*U+d).toFixed(4),+(q.wn*U).toFixed(5)])});}
  return out;}
async function clsTick(){if(CLS.role!=='teacher'||!CLS.broadcast)return;
  const bw=clsBoardWin(),bp=bw&&bw.currentPid(),pr=bp?await db.projects.get(bp):null;
  if(!pr||pr.shared!==true){if(CLS.lastJson!=='{"t":"clear"}'){CLS.lastJson='{"t":"clear"}';CLS.lastHash='';rtcBroadcast(CLS.lastJson);}return;}   // private projects are never sent
  if(CLS.boardPid!==bp){CLS.boardPid=bp;try{localStorage.setItem('pw-class-pid',String(bp));}catch(e){}clsRender();}
  let body;try{body=await bw.clsSnapshot();}catch(e){console.error(e);return;}const json=JSON.stringify({t:'state',body});const h=contentHash(json);if(h===CLS.lastHash)return;
  if(json.length>CLS_MAX.msg){if(CLS.lastHash!=='big'){toast('This page is too large to broadcast (images?) — students keep the last version','err');CLS.lastHash='big';}return;}
  CLS.lastHash=h;CLS.lastJson=json;rtcBroadcast(json);}
function clsSetHomework(on){CLS.homework=!!on;rtcBroadcast(JSON.stringify({t:'homework',on:CLS.homework}));clsRender();toast(CLS.homework?'Homework mode on: students can hand in files or pages':'Homework mode off','info');}
function clsSetBroadcast(on){CLS.broadcast=!!on;clearInterval(CLS.timer);CLS.lastHash='';if(CLS.broadcast){CLS.timer=setInterval(clsTick,700);clsTick();}else{CLS.lastJson='{"t":"clear"}';rtcBroadcast(CLS.lastJson);}clsRender();}

/* ---------- connections ---------- */
// shown before every create / join: the peer-to-peer link exposes IP addresses to the other side
function clsNotice(){return new Promise(res=>{const m=document.createElement('div');m.className='cls-modal';
  m.innerHTML='<div class="panel cls-notice" role="dialog" aria-modal="true" aria-labelledby="cls-n-t"><div class="panel-h"><div class="panel-t" id="cls-n-t">Direct Connection Notice</div></div><div class="panel-b">'+
    '<p>Teaching Mode uses a direct peer-to-peer connection between the teacher and each student.</p>'+
    '<p>Because of this direct connection, <b>your IP address may be visible to the other person you are directly connected to.</b></p>'+
    '<p>Patchwork does not intentionally store your IP address.</p>'+
    '<div class="hw-row"><button class="fx-primary cls-n-ok">Continue</button><button class="pbtn cls-n-no">Cancel</button></div></div></div>';
  document.body.appendChild(m);const k=e=>{if(e.key==='Escape'){e.stopPropagation();done(false);}};
  const done=v=>{m.remove();removeEventListener('keydown',k,true);res(v);};addEventListener('keydown',k,true);
  m.querySelector('.cls-n-ok').onclick=()=>done(true);m.querySelector('.cls-n-no').onclick=()=>done(false);m.onclick=e=>{if(e.target===m)done(false);};
  m.querySelector('.cls-n-ok').focus();});}
async function clsCreate(){if(!clsRelayOk(CLS.relay)){toast('Set the classroom server first','err');return;}
  if(!clsSignedIn()){toast('Sign in with Google first','err');return;}
  if(!await clsNotice())return;const mode=await clsModeChoose();if(!mode)return;
  try{const r=await fetch(CLS.relay.replace(/\/$/,'')+'/api/session',{method:'POST',headers:{Authorization:'Bearer '+CLS.auth.token}});if(r.status===401){clsSignOut();throw new Error('please sign in again');}if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();CLS.code=j.code;CLS.secret=j.secret;}catch(e){toast('Could not create a classroom: '+e.message,'err');return;}
  CLS.role='teacher';CLS.homework=false;clsConnect();await clsViewStart(mode);clsSetBroadcast(true);}
async function clsJoin(code){if(!clsSignedIn()){toast('Sign in with Google first','err');return;}CLS.name=CLS.auth.name||'';code=String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(!/^[A-HJ-NP-TV-Z2-9]{10}$/.test(code)){toast('That code doesn’t look right (10 letters/numbers)','err');return;}
  if(!clsRelayOk(CLS.relay)){toast('Set the classroom server first','err');return;}if(!await clsNotice())return;const mode=await clsModeChoose();if(!mode)return;CLS.role='student';CLS.homework=false;CLS.code=code;clsConnect();clsViewStart(mode);}
function clsConnect(){clearTimeout(CLS.rt);let ws;try{ws=new WebSocket(clsWsUrl(CLS.code));}catch(e){clsState('off');return;}CLS.ws=ws;clsState(CLS.retry?'retry':'connecting');
  ws.onopen=()=>{let tok='';try{tok=localStorage.getItem(clsTokKey())||'';}catch(e){}ws.send(JSON.stringify(CLS.role==='teacher'?{t:'hello',secret:CLS.secret}:{t:'hello',idToken:tok?undefined:(CLS.auth&&CLS.auth.token),resume:tok||undefined}));};
  ws.onmessage=ev=>{let m;if(typeof ev.data!=='string'||ev.data.length>(CLS.role==='teacher'?7_200_000:CLS_MAX.msg+200))return;try{m=JSON.parse(ev.data);}catch(e){return;}clsOnMessage(m);};
  ws.onclose=ev=>{if(CLS.ws!==ws)return;CLS.ws=null;if(ev.code===4401){toast('Please sign in with Google again','err');clsSignOut();}if(ev.code===4404||ev.code===4401||ev.code===4403||ev.code===4423||ev.code===4429||ev.code===1008||!CLS.role){clsState('off');if(ev.code===4404&&CLS.role)toast(CLS.role==='student'?'The classroom has ended':'Classroom ended','info');if(ev.code===4429)toast('That classroom is full','err');if(ev.code===4423)toast('That classroom is locked \u2014 ask the teacher','err');if(ev.code===4403)toast(CLS.role==='student'?'You were removed from this classroom':'Not accepted as teacher','err');clsReset(false);return;}
    if(!CLS.welcomed&&CLS.retry>=1){toast(CLS.role==='student'?'Couldn\u2019t join \u2014 check the code (the class may have ended)':'Couldn\u2019t reach the classroom server','err');clsReset(false);return;}
    clsState('retry');CLS.retry=Math.min(CLS.retry+1,5);CLS.rt=setTimeout(clsConnect,Math.min(15000,1000*2**CLS.retry));};}
function clsOnMessage(m){if(m.t==='welcome'){CLS.retry=0;CLS.welcomed=true;clsState('on');if(CLS.role==='teacher'){CLS.lastHash='';}else{CLS.teacherOnline=!!m.teacher;if(typeof m.name==='string')CLS.name=m.name;if(typeof m.token==='string'&&/^[0-9a-f]{64}$/.test(m.token))try{localStorage.setItem(clsTokKey(),m.token);}catch(e){}}clsRender();return;}
  if(m.t==='roster'&&CLS.role==='teacher'&&Array.isArray(m.list)){CLS.roster=m.list.slice(0,200).map(p=>({id:String(p.id).slice(0,16),name:String(p.name).slice(0,24),status:['on','retry','off'].includes(p.status)?p.status:'off'}));CLS.students=CLS.roster.filter(p=>p.status==='on').length;CLS.locked=!!m.locked;rtcSync();clsRender();return;}
  if(m.t==='signal'&&m.data){rtcSignal(m.from,m.data);return;}
  if(CLS.role!=='student')return;
  if(m.t==='teacher'){CLS.teacherOnline=!!m.online;if(!m.online)rtcClose();clsRender();return;}
  if(m.t==='ended'){toast('The classroom has ended','info');}}
async function clsLeave(){if(CLS.role==='student'&&(CLS.snap||(CLS.mine&&CLS.mine.length))){const c=await clsAsk('Leave the classroom?','<p>The class page and your marks on it disappear when you leave.</p><p>You can keep a <b>private copy</b> of them in your projects first. Nothing is sent to anyone.</p>',[['save','Save a copy, then leave','fx-primary'],['leave','Leave without saving','pbtn'],['','Stay','pbtn']]);
    if(!c)return;if(c==='save'&&!await clsSaveCopy(null,null,false))return;}
  CLS.leaving=true;if(CLS.role==='teacher'&&CLS.ws&&CLS.ws.readyState===1)CLS.ws.send('{"t":"end"}');clsReset(true);CLS.leaving=false;}
function clsReset(closeView){
  // the class ended (or you were removed) while you had the page: offer to keep a copy of it
  if(CLS.role==='student'&&!CLS.leaving&&(CLS.snap||(CLS.mine&&CLS.mine.length))){const sn=CLS.snap,mi=CLS.mine;setTimeout(()=>toast('The class page has closed. Keep a private copy of it?','info',{label:'Save a copy',fn:()=>clsSaveCopy(sn,mi,false)}),700);}
  rtcClose();const ws=CLS.ws;CLS.ws=null;clearTimeout(CLS.rt);clearInterval(CLS.timer);try{if(ws)ws.close(1000,'bye');}catch(e){}
  Object.assign(CLS,{welcomed:false,role:null,code:'',secret:'',broadcast:false,students:0,teacherOnline:false,retry:0,lastHash:''});clsState('off');clsViewEnd();CLS.homework=false;clsRender();}
function clsState(s){CLS.status=s;clsRender();}

/* ---------- student: validate everything received ---------- */
function clsClean(b){const fail=w=>{throw new Error(w);};if(!b||typeof b!=='object'||b.v!==1)fail('version');
  const str=(x,n)=>typeof x==='string'?x.slice(0,n):'',num=(x,lo,hi,d)=>(typeof x==='number'&&isFinite(x))?Math.min(hi,Math.max(lo,x)):d,hex=x=>(typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x))?x.toLowerCase():null;
  const out={title:str(b.title,80),w:num(b.w,200,4000,800),ww:Math.round(num(b.ww,200,6000,PAGE_REF)),scroll:num(b.scroll,0,1e4,0),fx:num(b.fx,0,1,0),paras:[],marks:{},strokes:[]};let text=0,imgs=0,points=0;
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

/* ---------- Teaching Mode: two editor spaces side by side, exactly 50:50 ----------
   PRIVATE = this window: your own projects, never sent. CLASS = the pane. For the teacher it is a full editor whose open
   project (always sharable) is what students see; for a student it is the teacher's live page, which they can draw on
   here without anything being sent. Swapping sides changes only the layout. */
let clsPrivLabel=null,clsChip=null;
/* Two viewing modes, switchable any time:
   'default' - a big CLASS area plus private pop-up editors. Teacher: this window IS the class (sharable, broadcast);
               student: the teacher's page fills the window. Private work happens in pop-up editors.
   'split'   - PRIVATE | CLASS side by side at exactly 50:50 (swappable). */
function clsLayout(){const b=document.body,on=!!CLS.role,split=on&&CLS.mode==='split';b.classList.toggle('cls-split',split);
  let sw=false;try{sw=localStorage.getItem('pw-cls-swap')==='1';}catch(e){}b.classList.toggle('cls-swap',split&&sw);
  b.classList.toggle('cls-default',on&&CLS.mode==='default');b.classList.toggle('cls-teaching',on);
  if(split&&!clsPrivLabel){clsPrivLabel=document.createElement('div');clsPrivLabel.className='cls-strip cls-strip-private';clsPrivLabel.innerHTML='<b>PRIVATE</b><span class="cls-strip-hint">only you see this side</span>';b.insertBefore(clsPrivLabel,b.firstChild);}
  // teacher, default mode: a "Class-Sharing" chip next to the project name; it also opens the class menu
  const chipOn=on&&CLS.role==='teacher'&&CLS.mode==='default';
  if(chipOn&&!clsChip){clsChip=document.createElement('button');clsChip.id='class-chip';clsChip.title='This window is the class: what it shows is shared with your students. Click for classroom controls';
    clsChip.innerHTML='<span class="cls-dot on"></span>🔓 Class-Sharing ▾';clsChip.onclick=e=>{e.stopPropagation();clsMenu(!clsMenuOpen(),clsChip);};
    const pb=document.getElementById('proj-btn');pb.parentNode.insertBefore(clsChip,pb.nextSibling);}
  if(clsChip)clsChip.style.display=chipOn?'':'none';
  const tabs=document.getElementById('mini-tabs'),slot=CLS.pane&&CLS.pane.querySelector('.cls-strip-tabs');
  if(tabs){if(on&&CLS.role==='student'&&CLS.mode==='default'&&slot){if(tabs.parentNode!==slot)slot.appendChild(tabs);}else{const tb=document.getElementById('timeline-btn');if(tabs.previousElementSibling!==tb)tb.parentNode.insertBefore(tabs,tb.nextSibling);}}
  document.querySelectorAll('.mini-win:not(.cls-pane)').forEach(w=>clsMarkMini(w));if(typeof renderMiniTabs==='function')renderMiniTabs();
  dispatchEvent(new Event('resize'));}
// pop-up editors are private while teaching: locked icon, red light
function clsMarkMini(w){const on=!!CLS.role;w.classList.toggle('cls-private',on);let b=w.querySelector('.mini-priv');
  if(on&&!b){b=document.createElement('span');b.className='mini-priv';b.innerHTML='<span class="cls-dot off"></span>🔒 Private';const h=w.querySelector('.panel-h');h.insertBefore(b,h.querySelector('.panel-t'));}
  if(b)b.style.display=on?'':'none';}
function onMiniOpen(w){clsMarkMini(w);}
// keep both page areas the same size in 50:50: the student's CLASS toolbar is as tall as the PRIVATE side's toolbars
function clsEqualise(){const t=CLS.view&&CLS.view.querySelector('.cls-tools');if(!t)return;if(CLS.mode!=='split'||!clsPrivLabel){t.style.height='';if(CLS.snap)clsFit();return;}
  t.style.height=Math.max(0,stage.getBoundingClientRect().top-clsPrivLabel.getBoundingClientRect().bottom)+'px';if(CLS.snap)clsFit();}
addEventListener('resize',()=>{if(CLS.role)requestAnimationFrame(clsEqualise);});
function clsSwap(){const on=document.body.classList.toggle('cls-swap');try{localStorage.setItem('pw-cls-swap',on?'1':'0');}catch(e){}dispatchEvent(new Event('resize'));}
// the class menu: one floating panel holding the classroom controls, opened from the CLASS strip or the chip
function clsMenuEl(){if(!CLS.menuEl){const m=document.createElement('div');m.className='cls-menu';document.body.appendChild(m);CLS.menuEl=m;
    document.addEventListener('pointerdown',e=>{if(clsMenuOpen()&&!e.target.closest('.cls-menu,.cls-menu-btn,#class-chip,.cls-modal'))clsMenu(false);},true);}return CLS.menuEl;}
function clsMenuOpen(){return !!(CLS.menuEl&&CLS.menuEl.style.display==='flex');}
function clsMenu(open,anchor){const m=clsMenuEl();if(!open){m.style.display='none';return;}if(clsPanel&&clsPanel.parentNode!==m){clsPanel.classList.add('docked');clsPanel.style.display='flex';m.appendChild(clsPanel);}
  m.style.display='flex';clsRender();const a=(anchor||(CLS.pane&&CLS.pane.querySelector('.cls-menu-btn'))||clsChip);if(a){const r=a.getBoundingClientRect();m.style.top=(r.bottom+6)+'px';
    m.style.left=Math.max(6,Math.min(r.left,innerWidth-m.offsetWidth-6))+'px';}}
// the teacher's class project: the one used last time, or a new one (never the given private one)
async function clsClassProject(avoid){let id=null;try{id=+localStorage.getItem('pw-class-pid')||null;}catch(e){}
  const p=id?await db.projects.get(id):null;
  if(!p||p.shared!==true||id===avoid||projectOpenElsewhere(id)){id=await db.projects.add({name:'Class '+new Date().toISOString().slice(0,10),created:Date.now(),folder:null,shared:true});projects=await db.projects.toArray();syncPing('projects');renderProjects();}
  try{localStorage.setItem('pw-class-pid',String(id));}catch(e){}return id;}
// where the broadcast comes from: this window in default mode, the CLASS pane's editor in 50:50
function clsBoardWin(){if(CLS.role==='teacher'&&CLS.mode==='default')return pid!=null?window:null;
  const f=CLS.pane&&CLS.pane.querySelector('iframe');const w=f&&f.contentWindow;try{return w&&typeof w.currentPid==='function'&&typeof w.clsSnapshot==='function'&&w.currentPid()!=null?w:null;}catch(e){return null;}}
function clsMainIsClass(){return CLS.role==='teacher'&&CLS.mode==='default'&&!CLS.switching;}
async function clsSaveMini(w){const f=w&&w.querySelector('iframe');if(!f)return;const cw=f.contentWindow;try{if(cw.historyFlush)await cw.historyFlush();if(cw.savePageNow)await cw.savePageNow();}catch(e){}}
async function clsCloseMiniFor(id){for(const w of document.querySelectorAll('.mini-win:not(.cls-pane)')){let p=null;try{p=w.querySelector('iframe').contentWindow.currentPid();}catch(e){}if(p===id){await clsSaveMini(w);w.remove();}}if(typeof renderMiniTabs==='function')renderMiniTabs();}
// start (or switch to) a viewing mode
async function clsViewStart(mode){CLS.switching=true;try{
  const was=CLS.mode;CLS.mode=mode;try{localStorage.setItem('pw-cls-mode',mode);}catch(e){}
  if(CLS.role==='teacher'){
    if(mode==='default'){let X=null;
      if(CLS.pane){const f=CLS.pane.querySelector('iframe');try{X=f.contentWindow.currentPid();}catch(e){}await clsPaneClose(true);}   // the 50:50 class side's project
      if(X==null||!isShared(X))X=isShared(pid)?pid:await clsClassProject(pid);
      const prev=pid;if(prev!==X){if(!isShared(prev))CLS.privPid=prev;await clsCloseMiniFor(X);await switchProject(X);if(CLS.privPid===prev)openMiniEditor(prev);}
      try{localStorage.setItem('pw-class-pid',String(X));}catch(e){}CLS.boardPid=X;}
    else{let X=was==='default'?pid:null;
      if(X!=null){let P=CLS.privPid&&CLS.privPid!==X&&projects.find(p=>p.id===CLS.privPid)?CLS.privPid:(projects.find(p=>p.shared!==true&&p.id!==X)||{}).id;
        if(P==null)P=await db.projects.add({name:'My notes',created:Date.now(),folder:null});projects=await db.projects.toArray();
        await clsCloseMiniFor(P);await switchProject(P);await clsCloseMiniFor(X);try{localStorage.setItem('pw-class-pid',String(X));}catch(e){}}
      await clsPaneOpen();}}
  else await clsPaneOpen();
  }finally{CLS.switching=false;}
  // the create/join panel now lives in the class menu (closed)
  if(clsPanel&&clsPanel.parentNode!==clsMenuEl()){clsPanel.classList.add('docked');clsPanel.style.display='flex';clsMenuEl().appendChild(clsPanel);}
  clsLayout();clsRender();}
async function clsViewEnd(){const teacherDefault=CLS.mode==='default'&&CLS.boardPid!=null;await clsPaneClose();
  if(CLS.privPid&&pid!==CLS.privPid&&projects.find(p=>p.id===CLS.privPid)){const P=CLS.privPid;CLS.privPid=null;await clsCloseMiniFor(P);await switchProject(P);}
  CLS.mode=null;clsMenu(false);if(clsPanel&&clsPanel.parentNode===CLS.menuEl){clsPanel.classList.remove('docked');clsPanel.style.display='none';document.body.appendChild(clsPanel);}clsLayout();}
async function clsPaneOpen(){const teacher=CLS.role==='teacher';
  if(CLS.pane){CLS.pane.classList.toggle('cls-full',CLS.mode==='default');clsLayout();return;}
  const w=document.createElement('div');w.className='cls-pane'+(teacher?' mini-win cls-teach':' cls-learn')+(CLS.mode==='default'?' cls-full':'');
  w.innerHTML='<div class="cls-strip cls-strip-class"><span class="cls-dot"></span><b>CLASS</b><span class="cls-strip-hint"></span><span class="cls-strip-tabs"></span><button class="cls-strip-btn cls-priv-btn" title="Open a private pop-up editor">🔒 + Private</button><button class="cls-strip-btn cls-swap-btn" title="Swap sides (changes only the layout)">⇄</button><button class="cls-strip-btn cls-menu-btn" title="Classroom controls">Class ▾</button></div><div class="cls-body"></div>';
  document.body.appendChild(w);CLS.pane=w;
  w.querySelector('.cls-swap-btn').onclick=clsSwap;w.querySelector('.cls-menu-btn').onclick=e=>{e.stopPropagation();clsMenu(!clsMenuOpen(),e.currentTarget);};
  w.querySelector('.cls-priv-btn').onclick=e=>{e.stopPropagation();openMiniMenu(e.currentTarget,true);};
  const body=w.querySelector('.cls-body');
  if(teacher){w.querySelector('.cls-strip-hint').textContent='your students see this side';CLS.boardPid=await clsClassProject(pid);
    const f=document.createElement('iframe');f.src=location.pathname+'?mini=1&class=1&pid='+CLS.boardPid;body.appendChild(f);}
  else{w.querySelector('.cls-strip-hint').textContent='waiting for your teacher…';
    body.innerHTML='<div class="cls-tools"><button class="cls-tool on" data-t="" title="Scroll the page">✋ Scroll</button><button class="cls-tool" data-t="pen" title="Draw on the class page (only on this device)">✏️ Pen</button>'+
      ['#f87171','#fbbf24','#60a5fa'].map(c=>'<button class="cls-col" data-c="'+c+'" style="background:'+c+'" title="Pen colour"></button>').join('')+
      '<button class="cls-tool" data-t="erase" title="Erase your own marks">Eraser</button><button class="cls-tool cls-clear-mine" title="Remove all your marks">Clear mine</button><button class="cls-tool cls-save-copy" title="Keep this page and your marks as a private project you can edit">\ud83d\udcbe Save a copy</button>'+
      '<label class="cls-follow" title="Keep your view on the teacher’s place"><input type="checkbox" checked> autofocus</label><button class="cls-tool cls-focus" title="Jump to the teacher’s place now" style="display:none">Focus</button></div>'+
      '<div class="cls-scroll"><div class="cls-page"><div class="editor cls-ed"></div><canvas class="cls-ink"></canvas><canvas class="cls-mine"></canvas></div><div class="cls-wait">Waiting for the teacher to broadcast…<br><span class="hw-hint">Anything you draw on this side stays on this device.</span></div></div>';
    CLS.view=w;CLS.mine=[];CLS.tool='';CLS.penColor='#f87171';clsMineWire(w);w.querySelector('.cls-save-copy').onclick=()=>clsSaveCopy();
    const fl=w.querySelector('.cls-follow input'),fb=w.querySelector('.cls-focus');const setF=on=>{CLS.follow=on;fl.checked=on;fb.style.display=on?'none':'';if(on)clsScroll();};
    fl.onchange=()=>setF(fl.checked);fb.onclick=()=>clsScroll(true);
    const sc=w.querySelector('.cls-scroll');sc.addEventListener('wheel',()=>setF(false),{passive:true});sc.addEventListener('touchmove',()=>{if(!CLS.tool)setF(false);},{passive:true});
    new ResizeObserver(()=>clsFit()).observe(sc);clsDrawView();}
  clsLayout();clsRender();}
// a small question dialog: resolves with the chosen button's value ('' = cancel)
function clsAsk(title,html,buttons){return new Promise(res=>{const m=document.createElement('div');m.className='cls-modal';
  m.innerHTML='<div class="panel cls-notice" role="dialog" aria-modal="true"><div class="panel-h"><div class="panel-t"></div></div><div class="panel-b">'+html+'<div class="hw-row"></div></div></div>';
  m.querySelector('.panel-t').textContent=title;const row=m.querySelector('.hw-row');
  const k=e=>{if(e.key==='Escape'){e.stopPropagation();done('');}};const done=v=>{m.remove();removeEventListener('keydown',k,true);res(v);};addEventListener('keydown',k,true);
  buttons.forEach(([v,l,c])=>{const b=document.createElement('button');b.className=c;b.textContent=l;b.onclick=()=>done(v);row.appendChild(b);});
  m.onclick=e=>{if(e.target===m)done('');};document.body.appendChild(m);row.querySelector('button').focus();});}
// student: keep the class page as it is now + your own marks, as a NEW PRIVATE project in this browser.
// The teacher's original is not changed and nothing is sent. Highlights come back as real highlights (type matched by colour).
async function clsSaveCopy(snap,mine,ask){const s=snap||CLS.snap;mine=mine||CLS.mine||[];
  if(!s){toast('Nothing from your teacher to copy yet','err');return null;}
  if(ask!==false&&await clsAsk('Save a copy of the class page','<p>This saves the teacher\u2019s page <b>as it is right now</b>, together with <b>your own marks</b>, as a new <b>private</b> project in this browser.</p><p>The teacher\u2019s original is not changed, and nothing is sent to anyone. Your copy is yours to edit: type answers, draw, highlight.</p><p>To give it to your teacher, use <b>Hand in a page</b> when they open homework.</p>',[['ok','Save a copy','fx-primary'],['','Cancel','pbtn']])!=='ok')return null;
  const when=new Date(),name=('Class copy \u2013 '+(s.title||'page')+' \u2013 '+when.toLocaleDateString()).slice(0,60);
  const np=await db.projects.add({name,created:Date.now(),folder:null});
  const byColor={};for(const t of HT.values()){const c=(normalizeHex(t.color)||'').toLowerCase();if(c&&!byColor[c])byColor[c]=t.id;}
  const text={};for(const p of s.paras)for(const r of p.runs)if(r.mark&&r.type==='text')text[r.mark]=(text[r.mark]||'')+r.text;
  const idMap={};for(const k of Object.keys(text)){const st=s.marks[k]||{},snip=text[k].trim().slice(0,200);
    idMap[k]=await db.marks.add({pid:np,type:byColor[(st.color||'').toLowerCase()]||'note',name:snip.slice(0,80),snippet:snip,tags:[],created:Date.now(),done:false,doneAt:null,links:[],anchor:{kind:'text'}});}
  const paras=s.paras.map(p=>({align:p.align,t:null,runs:p.runs.map(r=>r.type==='text'?{...r,mark:r.mark?idMap[r.mark]||null:null}:{...r})}));
  await db.pages.put({pid:np,html:editor.parasToHTML(paras),scrollYn:0,gutterW:0,ww:s.ww});
  const f=s.ww/PAGE_REF,t=Date.now(),add=async(tool,color,pts)=>{if(!pts.length)return;let lo=Infinity,hi=-Infinity;for(const q of pts){lo=Math.min(lo,q.yn);hi=Math.max(hi,q.yn);}await db.strokes.add({pid:np,kind:'stroke',tool,color,t,pts,minYn:lo,maxYn:hi,u:1});};   // view-relative -> page units (the page's own width)
  for(const k of s.strokes)await add(k.tool,k.color,k.pts.map(q=>({xn:q.xn*f,yn:q.yn*f,wn:q.wn*f})));
  const G=24;for(const m of mine)await add('pen',m.color,m.pts.map(([x,y])=>({xn:(x-G)/s.w*f,yn:y/s.w*f,wn:3/s.w*f})));   // your marks, as ink you can edit
  projects=await db.projects.toArray();marks=await db.marks.toArray();syncPing('projects');syncPing('marks');renderProjects();
  if(CLS.role&&CLS.mode==='default')openMiniEditor(np);else if(!projectOpenElsewhere(np))await switchProject(np);
  toast('Saved \u201c'+name+'\u201d to your projects (private, only on this device)','ok');return np;}
async function clsPaneClose(keepRole){const w=CLS.pane;if(!w)return;CLS.pane=null;await clsSaveMini(w);
  w.remove();CLS.view=null;CLS.snap=null;CLS.mine=[];if(!keepRole)CLS.boardPid=null;clsLayout();}
// choose a viewing mode when creating or joining
function clsViewSwitch(){return '<div class="pf-row cls-vs">View <button class="cls-tool'+(CLS.mode==='default'?' on':'')+'" data-m="default">Default</button><button class="cls-tool'+(CLS.mode==='split'?' on':'')+'" data-m="split">50:50</button></div>';}
function clsModeChoose(){return new Promise(res=>{let last='default';try{last=localStorage.getItem('pw-cls-mode')||'default';}catch(e){}
  const m=document.createElement('div');m.className='cls-modal';
  const tile=(mode,title,desc,pic)=>'<button class="cls-mode'+(mode===last?' sel':'')+'" data-m="'+mode+'"><div class="cls-mode-pic">'+pic+'</div><b>'+title+'</b><span>'+desc+'</span></button>';
  m.innerHTML='<div class="panel cls-notice" role="dialog" aria-modal="true" aria-labelledby="cm-t"><div class="panel-h"><div class="panel-t" id="cm-t">How would you like to see the class?</div></div><div class="panel-b"><div class="cls-modes">'+
    tile('default','Default','A big class area, with private pop-up editors on top.','<div class="cm-green cm-big">CLASS<small>sharing</small></div><div class="cm-red cm-pop">PRIVATE</div>')+
    tile('split','50:50','Class and private side by side, half each.','<div class="cm-green cm-half">CLASS<small>sharing</small></div><div class="cm-red cm-half">PRIVATE</div>')+
    '</div><p class="hw-hint">You can switch at any time from the Class menu.</p><div class="hw-row"><button class="fx-primary cm-ok">Continue</button><button class="pbtn cm-no">Cancel</button></div></div></div>';
  document.body.appendChild(m);let pick=last;
  m.querySelectorAll('.cls-mode').forEach(b=>{b.onclick=()=>{pick=b.dataset.m;m.querySelectorAll('.cls-mode').forEach(x=>x.classList.toggle('sel',x===b));};b.ondblclick=()=>done(pick);});
  const k=e=>{if(e.key==='Escape'){e.stopPropagation();done(null);}};const done=v=>{m.remove();removeEventListener('keydown',k,true);res(v);};addEventListener('keydown',k,true);
  m.querySelector('.cm-ok').onclick=()=>done(pick);m.querySelector('.cm-no').onclick=()=>done(null);m.onclick=e=>{if(e.target===m)done(null);};m.querySelector('.cm-ok').focus();});}
document.addEventListener('pw-private',()=>{if(CLS.role==='teacher')clsTick();});
// student: your own marks on the class page (page pixels at the teacher's width); drawn locally, never sent
function clsMineWire(w){const cv=w.querySelector('.cls-mine'),page=w.querySelector('.cls-page');let cur=null;
  w.querySelectorAll('.cls-tool[data-t]').forEach(b=>b.onclick=()=>{CLS.tool=b.dataset.t;w.classList.toggle('drawing',!!CLS.tool);w.querySelectorAll('.cls-tool[data-t]').forEach(x=>x.classList.toggle('on',x===b));});
  w.querySelectorAll('.cls-col').forEach(b=>b.onclick=()=>{CLS.penColor=b.dataset.c;w.querySelector('.cls-tool[data-t="pen"]').click();});
  w.querySelector('.cls-clear-mine').onclick=()=>{CLS.mine=[];clsDrawMine();};
  const pt=e=>{const r=page.getBoundingClientRect(),k=CLS.k||1;return[(e.clientX-r.left)/k,(e.clientY-r.top)/k];};
  const erase=p=>{const n=CLS.mine.length;CLS.mine=CLS.mine.filter(s=>!s.pts.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<14));if(CLS.mine.length!==n)clsDrawMine();};
  cv.addEventListener('pointerdown',e=>{if(!CLS.tool||!CLS.snap)return;e.preventDefault();cv.setPointerCapture(e.pointerId);const p=pt(e);
    if(CLS.tool==='erase'){cur={erase:true};erase(p);return;}cur={color:CLS.penColor,pts:[p]};CLS.mine.push(cur);clsDrawMine();});
  cv.addEventListener('pointermove',e=>{if(!cur)return;const p=pt(e);if(cur.erase){erase(p);return;}if(cur.pts.length<4000){cur.pts.push(p);clsDrawMine();}});
  cv.addEventListener('pointerup',()=>{if(CLS.snap&&CLS.mine.some(m=>m.pts.some(q=>q[1]>page.offsetHeight-300)))clsDrawView();});
  const up=()=>{cur=null;};cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);}
function clsDrawMine(){const w=CLS.view;if(!w)return;const ink=w.querySelector('.cls-ink'),cv=w.querySelector('.cls-mine');
  cv.width=ink.width;cv.height=ink.height;cv.style.width=ink.style.width;cv.style.height=ink.style.height;const dpr=Math.min(2,window.devicePixelRatio||1);const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);
  c.lineCap='round';c.lineJoin='round';c.lineWidth=3;for(const s of CLS.mine||[]){c.strokeStyle=s.color;c.fillStyle=s.color;const P=s.pts;
    if(P.length===1){c.beginPath();c.arc(P[0][0],P[0][1],1.6,0,7);c.fill();continue;}c.beginPath();c.moveTo(P[0][0],P[0][1]);for(let i=1;i<P.length;i++)c.lineTo(P[i][0],P[i][1]);c.stroke();}}
// render at the teacher's page width, then scale to fit: text and ink line up exactly as on the teacher's screen
function clsDrawView(){const w=CLS.view;if(!w)return;const s=CLS.snap,ed=w.querySelector('.cls-ed'),cv=w.querySelector('.cls-ink'),page=w.querySelector('.cls-page');w.querySelector('.cls-wait').style.display=s?'none':'';page.style.display=s?'':'none';if(!s){ed.textContent='';cv.width=cv.width;w.querySelector('.cls-strip-hint').textContent='waiting for your teacher…';return;}
  w.querySelector('.cls-strip-hint').textContent='from your teacher · '+(s.title||'page');const G=24,kt=s.w/s.ww;page.style.width=(s.w+G+12)+'px';ed.style.fontSize=(15*kt)+'px';ed.style.paddingLeft=(G+10*kt)+'px';ed.style.paddingRight=(12+8*kt)+'px';ed.style.paddingTop=(18*kt)+'px';
  editor.renderParas(s.paras,ed,{markStyle:id=>s.marks[id]||null});ed.querySelectorAll('img').forEach(i=>{i.referrerPolicy='no-referrer';});
  let bottom=ed.offsetHeight;for(const k of s.strokes)for(const q of k.pts)bottom=Math.max(bottom,q.yn*s.w+40);for(const m of CLS.mine||[])for(const q of m.pts)bottom=Math.max(bottom,q[1]+400);const H=Math.min(30000,Math.max(bottom,s.w*1.4));page.style.height=H+'px';
  const dpr=Math.min(2,window.devicePixelRatio||1);cv.width=Math.round((s.w+G+12)*dpr);cv.height=Math.round(H*dpr);cv.style.width=(s.w+G+12)+'px';cv.style.height=H+'px';const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,s.w+G+12,H);
  for(const k of s.strokes){c.lineCap='round';c.lineJoin='round';if(k.tool==='eraser'){c.globalCompositeOperation='destination-out';c.strokeStyle='#000';c.fillStyle='#000';c.globalAlpha=1;}else{c.globalCompositeOperation='source-over';c.strokeStyle=k.color;c.fillStyle=k.color;c.globalAlpha=k.tool==='hl'?.3:1;}
    const P=k.pts,X=q=>G+q.xn*s.w,Y=q=>q.yn*s.w;if(P.length===1){c.beginPath();c.arc(X(P[0]),Y(P[0]),Math.max(.5,P[0].wn*s.w/2),0,7);c.fill();}else for(let i=1;i<P.length;i++){c.lineWidth=Math.max(.5,(P[i-1].wn+P[i].wn)/2*s.w);c.beginPath();c.moveTo(X(P[i-1]),Y(P[i-1]));c.lineTo(X(P[i]),Y(P[i]));c.stroke();}}
  c.globalCompositeOperation='source-over';c.globalAlpha=1;clsDrawMine();clsFit();}
function clsFit(){const w=CLS.view,s=CLS.snap;if(!w||!s)return;const sc=w.querySelector('.cls-scroll'),page=w.querySelector('.cls-page');const k=1;   // real size on every screen: a page wider than this window scrolls sideways
  page.style.transform='scale('+k+')';page.style.marginBottom=(-(1-k)*page.offsetHeight)+'px';CLS.k=k;clsScroll();}
function clsScroll(force){const w=CLS.view,s=CLS.snap;if(!w||!s||(!CLS.follow&&!force))return;const sc=w.querySelector('.cls-scroll');sc.scrollTop=s.scroll*s.w*(CLS.k||1);
  const x=24+s.fx*s.w;if(x<sc.scrollLeft+40||x>sc.scrollLeft+sc.clientWidth-40)sc.scrollLeft=Math.max(0,x-sc.clientWidth/2);}   // keep where the teacher is working in view

/* ---------- panel ---------- */
let clsPanel=null;
function openClassroom(){if(CLS.role&&CLS.mode){clsMenu(true);return;}if(!clsPanel){clsPanel=document.createElement('div');clsPanel.className='panel cls-panel';document.body.appendChild(clsPanel);}clsPanel.style.display='flex';clsPanel.style.left=Math.max(8,Math.min(360,innerWidth-380))+'px';clsPanel.style.top='70px';clsPanel.style.right='auto';clsRender(true);}
let clsPill=null;
function clsMinimise(){clsPanel.style.display='none';clsRender();}
function clsPillSync(){const show=!!CLS.role&&!CLS.pane&&(!clsPanel||clsPanel.style.display==='none');
  if(show&&!clsPill){clsPill=document.createElement('button');clsPill.className='cls-pill';clsPill.title='Open the classroom panel';clsPill.onclick=openClassroom;document.body.appendChild(clsPill);}
  if(!clsPill)return;clsPill.style.display=show?'flex':'none';
  if(show)clsPill.innerHTML='<span class="cls-dot '+(CLS.status==='on'?'on':CLS.status==='off'?'off':'retry')+'"></span>Classroom'+(CLS.role==='teacher'?' \u00b7 '+CLS.students+' student'+(CLS.students!==1?'s':''):'');}
function clsRender(full){clsPillSync();if(CLS.pane&&CLS.role==='teacher'){const d=CLS.pane.querySelector('.cls-strip-class .cls-dot');d.className='cls-dot '+(CLS.status==='on'?'on':CLS.status==='off'?'off':'retry');d.title=CLS.status==='on'?'Connected':'Reconnecting\u2026';}if(CLS.view){const d=CLS.view.querySelector('.cls-dot');const direct=rtcOpen(CLS.peer);d.className='cls-dot '+(CLS.status==='on'&&direct?'on':CLS.status==='off'?'off':'retry');d.title=direct?'Connected directly to the teacher':CLS.status==='on'?(!CLS.teacherOnline?'Teacher offline':CLS.rtcFailed?'Couldn’t connect directly to the teacher (network blocks it)':'Connecting directly to the teacher…'):CLS.status==='off'?'Disconnected':'Reconnecting…';}
  if(!clsPanel||clsPanel.style.display==='none')return;const dot=t=>'<span class="cls-dot '+(CLS.status==='on'?'on':CLS.status==='off'?'off':'retry')+'"></span>'+t;
  const st=CLS.status==='on'?'Connected':CLS.status==='off'?'Disconnected':'Reconnecting…';let h='<div class="panel-h"><div class="panel-t">Classroom</div>'+(CLS.role?'<button class="panel-x cls-min" title="Minimise (you stay in the classroom)">\u2013</button>':'<button class="panel-x">×</button>')+'</div><div class="panel-b">';
  if(!CLS.role){h+=(CLS_RELAY?'':'<div class="pf"><div class="pf-l">Classroom server</div><input class="pf-in cls-relay" placeholder="https://your-relay.workers.dev" value="'+esc(CLS.relay)+'"><div class="hw-hint">Only used when you create or join a classroom.</div></div>')+
      '<div class="pf cls-sec"><div class="pf-l">1. Sign in with Google</div><div class="cls-ic-row"><svg class="cls-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg><div class="cls-auth"></div></div></div>'+
      (!clsSignedIn()?'<div class="hw-hint">2. Then create a classroom (teacher) or join one with a code (student).</div>':
      '<div class="pf cls-sec"><div class="pf-l">Teach</div><div class="cls-ic-row"><svg class="cls-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="13" height="9" rx="1"/><path d="M12 8h6"/><circle cx="5" cy="9" r="2.5"/><path d="M1.5 21v-3.5a3.5 3.5 0 0 1 7 0V21"/><path d="M8 14l3-2"/></svg><div><button class="fx-primary cls-create">Create a classroom</button><div class="hw-hint">You get a code to give your students.</div></div></div></div>'+
      '<div class="pf cls-sec"><div class="pf-l">Learn</div><div class="cls-ic-row"><svg class="cls-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/><path d="M22 9v6"/></svg><div style="flex:1"><input class="pf-in cls-code" placeholder="Classroom code" maxlength="14" style="text-transform:uppercase;letter-spacing:.12em;width:100%"><div class="hw-row" style="margin-top:6px"><button class="fx-primary cls-join">Join</button></div></div></div></div>');}
  else if(CLS.role==='teacher'){h+='<div class="pf"><div class="pf-l">Classroom code — give this to your students</div><div class="cls-code-big">'+esc(CLS.code.slice(0,5)+' '+CLS.code.slice(5))+'</div></div><div class="cls-status">'+dot(st)+' · '+CLS.students+' student'+(CLS.students!==1?'s':'')+'</div>'+
      '<div class="cls-roster">'+(CLS.roster.length?CLS.roster.map(p=>'<div class="cls-person"><span class="cls-dot '+p.status+'"></span><span class="cls-pname">'+esc(p.name)+'</span><span class="hw-hint">'+(p.status==='retry'?'reconnecting':p.status==='off'?'disconnected':rtcLabel(p.id))+'</span><button class="pr-tool cls-kick" data-id="'+esc(p.id)+'" title="Remove from the classroom">\u00d7</button></div>').join(''):'<div class="hw-hint">No students yet.</div>')+'</div>'+
      clsViewSwitch()+
      '<label class="pf-row"><input type="checkbox" class="pf-cb cls-lock"'+(CLS.locked?' checked':'')+'> Lock classroom (no new students)</label>'+
      '<label class="pf-row cls-bc"><input type="checkbox" class="pf-cb cls-bcast"'+(CLS.broadcast?' checked':'')+'> <b>Broadcast</b>&nbsp;the CLASS side'+(CLS.broadcast?' — students see \u201c'+esc(projName(CLS.boardPid))+'\u201d':' (paused: nothing is sent)')+'</label>'+
      '<label class="pf-row"><input type="checkbox" class="pf-cb cls-hw"'+(CLS.homework?' checked':'')+'> <b>Homework mode</b>&nbsp;(students may hand in files or pages)</label>'+
      '<button class="pbtn cls-inbox">\ud83d\udce5 Inbox'+(CLS.inbox?' ('+CLS.inbox+' new)':'')+'</button>'+
      '<button class="fx-link danger cls-end">End classroom</button>';}
  else{h+='<div class="cls-status">'+dot(st+(CLS.status==='on'?(!CLS.teacherOnline?' · teacher offline':rtcOpen(CLS.peer)?' · connected directly to the teacher':CLS.rtcFailed?' · couldn’t connect directly (network blocks it)':' · connecting to the teacher…'):''))+'</div><div class="hw-hint">You are \u201c'+esc(CLS.name)+'\u201d</div>'+clsViewSwitch()+
      (CLS.homework?'<div class="pf"><div class="pf-l">Homework is open</div><div class="hw-row" style="margin-top:0"><button class="pbtn cls-hand">\ud83d\udce4 Hand in a file\u2026</button><button class="pbtn cls-hand-page">\ud83d\udce4 Hand in a page\u2026</button><input type="file" class="cls-file" hidden accept="'+Object.keys(CLS_TYPES).map(e=>'.'+e).join(',')+'"></div></div>':'<div class="hw-hint">Hand-ins open when your teacher starts homework mode.</div>')+
      '<div class="hw-row"><button class="fx-link danger cls-leave">Leave classroom</button></div>';}
  h+='<div class="hw-hint cls-privacy">Teacher \u2192 students only. Students send nothing unless the teacher opens homework and they choose to hand something in. Class content and hand-ins go directly between your browsers (WebRTC), never through the server, so participants can see each other\u2019s IP address. <b>Teaching mode is not anonymous:</b> signing in with Google is required, and the classroom server records your Google account ID and join/leave times for 90 days (no IP addresses, names, emails or class content).</div></div>';
  clsPanel.innerHTML=h;makeDraggable(clsPanel,clsPanel.querySelector('.panel-h'));const q=x=>clsPanel.querySelector(x);q('.panel-x').onclick=CLS.role?clsMinimise:()=>clsPanel.style.display='none';
  if(q('.cls-relay'))q('.cls-relay').onchange=e=>{const v=e.target.value.trim();if(v&&!clsRelayOk(v)){toast('Use an https:// address','err');return;}const was=CLS.relay;CLS.relay=v;try{localStorage.setItem('pw-relay',v);}catch(_){}if(v!==was&&q('.cls-auth'))clsAuthUI(q('.cls-auth'));};
  if(q('.cls-create'))q('.cls-create').onclick=()=>{const r=q('.cls-relay');if(r){r.dispatchEvent(new Event('change'));}clsCreate();};
  if(q('.cls-join')){const go=()=>{const r=q('.cls-relay');if(r)r.dispatchEvent(new Event('change'));clsJoin(q('.cls-code').value);};q('.cls-join').onclick=go;q('.cls-code').onkeydown=e=>{if(e.key==='Enter')go();};}
  if(q('.cls-bcast'))q('.cls-bcast').onchange=e=>clsSetBroadcast(e.target.checked);
  if(q('.cls-hw'))q('.cls-hw').onchange=e=>clsSetHomework(e.target.checked);
  clsPanel.querySelectorAll('.cls-vs button').forEach(b=>b.onclick=()=>{if(b.dataset.m!==CLS.mode){clsMenu(false);clsViewStart(b.dataset.m);}});
  if(q('.cls-hand-page'))q('.cls-hand-page').onclick=clsHandInPage;
  if(q('.cls-end'))q('.cls-end').onclick=e=>{const b=e.currentTarget;if(!b.classList.contains('armed')){b.classList.add('armed');b.textContent='Click again to end for everyone';return;}clsLeave();};
  clsPanel.querySelectorAll('.cls-kick').forEach(b=>b.onclick=()=>{if(!b.classList.contains('armed')){b.classList.add('armed');b.textContent='remove?';setTimeout(()=>{if(b.isConnected){b.classList.remove('armed');b.textContent='\u00d7';}},2500);return;}if(CLS.ws&&CLS.ws.readyState===1)CLS.ws.send(JSON.stringify({t:'kick',id:b.dataset.id}));});
  if(q('.cls-lock'))q('.cls-lock').onchange=e=>{if(CLS.ws&&CLS.ws.readyState===1)CLS.ws.send(JSON.stringify({t:'lock',on:e.target.checked}));};
  if(q('.cls-inbox'))q('.cls-inbox').onclick=openInbox;
  if(q('.cls-hand')){const fi=q('.cls-file');q('.cls-hand').onclick=()=>fi.click();fi.onchange=()=>{const f=fi.files[0];fi.value='';if(f)clsHandIn(f);};}
  if(q('.cls-auth'))clsAuthUI(q('.cls-auth'));
  if(q('.cls-leave'))q('.cls-leave').onclick=clsLeave;}

/* ---------- hand-ins: student -> teacher only (a separate channel from the broadcast) ---------- */
function clsExt(n){const m=/\.([a-z0-9]{1,5})$/i.exec(n||'');return m?m[1].toLowerCase():'';}
function clsSize(n){return n>1e6?(n/1e6).toFixed(1)+' MB':Math.max(1,Math.round(n/1e3))+' KB';}
async function clsHandIn(f){if(CLS.role!=='student'){toast('Not in a classroom','err');return;}
  const ext=clsExt(f.name);if(!CLS_TYPES[ext]){toast('That file type can\u2019t be handed in','err');return;}if(f.size>CLS_MAX.handin){toast('File too large (max 5 MB)','err');return;}
  // explicit confirmation: the student sees exactly what will be sent, and to whom
  if(!confirm('Hand in \u201c'+f.name+'\u201d ('+clsSize(f.size)+') to the teacher?\n\nOnly the teacher receives it.'))return;
  if(!rtcOpen(CLS.peer)){toast('Not connected directly to the teacher yet','err');return;}const data=(await _blobToDataURL(f)).split(',')[1]||'';toast('Sending\u2026','info');rtcSend(CLS.peer,JSON.stringify({t:'handin',file:{name:f.name.slice(0,120),type:CLS_TYPES[ext],data}}));}
function clsHandInPage(){if(CLS.role!=='student'||!CLS.homework){toast('Hand-ins are closed','err');return;}
  const m=document.createElement('div');m.className='cls-modal';m.innerHTML='<div class="panel cls-notice" role="dialog" aria-modal="true"><div class="panel-h"><div class="panel-t">Hand in a page</div></div><div class="panel-b"><p>Pick one of your projects. Only the teacher receives it. Private projects must be made sharable first.</p><div class="mini-list"></div><div class="hw-row"><button class="pbtn hp-no">Cancel</button></div></div></div>';
  const list=m.querySelector('.mini-list');projects.forEach(p=>{const b=document.createElement('button');b.className='mini-pick';b.textContent=(p.shared===true?'\ud83d\udd13 ':'\ud83d\udd12 ')+p.name;
    b.onclick=async()=>{m.remove();if(p.shared!==true&&!await setShared(p,true))return;let data;try{data=await projectExport(p.id);}catch(e){toast('Could not read that page','err');return;}
      await clsHandIn(new File([JSON.stringify(data)],_slug(p.name)+'.patchwork.json',{type:'application/json'}));};list.appendChild(b);});
  m.querySelector('.hp-no').onclick=()=>m.remove();m.onclick=e=>{if(e.target===m)m.remove();};document.body.appendChild(m);}
async function clsReceive(m,peer){const f=m.file||{},ext=clsExt(f.name);const who=CLS.roster.find(p=>p.id===peer.id);m={...m,from:{name:who?who.name:'?'}};if(!CLS_TYPES[ext]||f.type!==CLS_TYPES[ext]||typeof f.data!=='string'||!/^[A-Za-z0-9+/=]+$/.test(f.data))return;
  let blob;try{const bin=atob(f.data);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);if(u.length>CLS_MAX.handin)return;blob=new Blob([u],{type:'application/octet-stream'});}catch(e){return;}
  const rec={at:Date.now(),code:CLS.code,cls:String(CLS.boardPid!=null?projName(CLS.boardPid):'').slice(0,40),from:String(m.from&&m.from.name||'?').slice(0,24),name:String(f.name).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,120),ext,size:blob.size,blob};
  try{await db.inbox.add(rec);}catch(e){_quotaToast(e);return;}toast('\ud83d\udce5 '+rec.from+' handed in \u201c'+rec.name+'\u201d','ok');openInbox();}
// one folder per class for handed-in pages: "Hand-ins · <class page> · <date>" (created when first needed)
async function clsHandinFolder(r){const d=new Date(r.at),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const name=('Hand-ins \u00b7 '+(r.cls||('class '+(r.code||'').slice(0,5)))+' \u00b7 '+day).slice(0,60);
  let f=folders.find(x=>x.name===name&&(x.parent||null)===null);if(!f){await db.folders.add({name,parent:null,created:Date.now()});await loadFolders();f=folders.find(x=>x.name===name&&(x.parent||null)===null);}
  return f.id;}
let inboxEl=null;
function openInbox(){if(!inboxEl){inboxEl=document.createElement('div');inboxEl.className='panel cls-inbox-panel';inboxEl.innerHTML='<div class="panel-h"><div class="panel-t">\ud83d\udce5 Classroom inbox</div><button class="panel-x">\u00d7</button></div><div class="panel-b"><div class="inbox-list"></div><div class="hw-hint">Hand-ins are saved only in this browser. Nothing opens by itself: download a file to look at it, or open a handed-in page as a new private project.</div></div>';document.body.appendChild(inboxEl);inboxEl.querySelector('.panel-x').onclick=()=>inboxEl.style.display='none';makeDraggable(inboxEl,inboxEl.querySelector('.panel-h'));}
  CLS.inbox=0;clsRender();inboxEl.style.display='flex';inboxEl.style.left=Math.max(8,innerWidth-440)+'px';inboxEl.style.top='80px';inboxEl.style.right='auto';renderInbox();}
async function renderInbox(){if(!inboxEl||inboxEl.style.display==='none')return;const list=inboxEl.querySelector('.inbox-list');const rows=(await db.inbox.orderBy('at').reverse().toArray());
  list.innerHTML=rows.length?'':'<div class="sr-empty" style="padding:18px">Nothing handed in yet.</div>';
  rows.forEach(r=>{const d=document.createElement('div');d.className='inbox-row';d.innerHTML='<div class="inbox-main"><b></b><span class="inbox-file"></span><span class="hw-hint"></span></div><button class="pbtn inbox-dl">Download</button><button class="pr-tool inbox-rm" title="Delete">\ud83d\uddd1</button>';
    d.querySelector('b').textContent=r.from;d.querySelector('.inbox-file').textContent=r.name;d.querySelector('.hw-hint').textContent=clsSize(r.size)+' \u00b7 '+fmtAbs(r.at);
    d.querySelector('.inbox-dl').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(r.blob);a.download=r.name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);};
    if(r.ext==='json'||r.ext==='pdf'){const b=document.createElement('button');b.className='pbtn';b.textContent='Open as page';b.title='Adds it as a new private project (nothing you have is changed)';b.onclick=async()=>{let txt='';try{const d=JSON.parse(await r.blob.text());if(d&&d.project)d.project.name=(r.from+' \u2013 '+(d.project.name||'page')).slice(0,60);txt=JSON.stringify(d);}catch(e){txt=await r.blob.text();}const inClass=clsMainIsClass();const id=r.ext==='pdf'?await importPdf(new File([r.blob],r.name,{type:'application/pdf'}),{noSwitch:true,name:r.from+' \u2013 '+r.name.replace(/\.pdf$/i,'')}):await importFile(new File([txt],r.name,{type:'application/json'}),{noSwitch:true});if(!id)return;
      const fid=await clsHandinFolder(r);await db.projects.update(id,{folder:fid});projects=await db.projects.toArray();syncPing('projects');renderProjects();
      if(inClass)openMiniEditor(id);else await switchProject(id);toast('Opened in the folder \u201c'+(folderById(fid)||{}).name+'\u201d','ok');};d.insertBefore(b,d.querySelector('.inbox-dl'));}
    const rm=d.querySelector('.inbox-rm');rm.onclick=async()=>{if(!rm.classList.contains('armed')){rm.classList.add('armed');rm.textContent='\u2713?';return;}await db.inbox.delete(r.id);renderInbox();};list.appendChild(d);});}

/* ---------- Google sign-in (teaching mode only; Google's script loads only when this panel needs it) ---------- */
CLS.auth=null;CLS.cfg=null;CLS.cfgFor='';
function clsSignedIn(){return !!(CLS.auth&&CLS.auth.exp*1000>Date.now()+60_000);}
function clsSignOut(){CLS.auth=null;try{if(window.google&&google.accounts)google.accounts.id.disableAutoSelect();}catch(e){}clsRender();document.dispatchEvent(new Event('pw-auth'));}
function clsSetToken(tok){try{const p=JSON.parse(decodeURIComponent(escape(atob(tok.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))));CLS.auth={token:tok,name:String(p.name||'').slice(0,40),exp:+p.exp||0};}catch(e){CLS.auth=null;}clsRender();document.dispatchEvent(new Event('pw-auth'));}
async function clsConfig(){if(!clsRelayOk(CLS.relay))return null;if(CLS.cfg&&CLS.cfgFor===CLS.relay)return CLS.cfg;try{const r=await fetch(CLS.relay.replace(/\/$/,'')+'/api/config');CLS.cfg=r.ok?await r.json():null;CLS.cfgFor=CLS.relay;}catch(e){CLS.cfg=null;}return CLS.cfg;}
let _gisP=null;function clsLoadGoogle(){if(!_gisP)_gisP=new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://accounts.google.com/gsi/client';sc.async=true;sc.onload=res;sc.onerror=()=>{_gisP=null;rej(new Error('Google sign-in could not load'));};document.head.appendChild(sc);});return _gisP;}
async function clsAuthUI(box){if(clsSignedIn()){box.innerHTML='<div class="hw-row" style="margin-top:0"><span>Signed in as <b></b></span><button class="fx-link cls-out">Sign out</button></div>';box.querySelector('b').textContent=CLS.auth.name||'Google user';box.querySelector('.cls-out').onclick=clsSignOut;return;}
  if(!clsRelayOk(CLS.relay)){box.innerHTML='<div class="hw-hint">Set the classroom server first.</div>';return;}
  box.innerHTML='<div class="hw-hint">Checking the classroom server…</div>';const cfg=await clsConfig();if(!box.isConnected)return;
  if(cfg&&cfg.devAuth){box.innerHTML='<div class="hw-row" style="margin-top:0"><input class="pf-in cls-devid" placeholder="dev user id (digits)" style="flex:1"><button class="pbtn cls-devgo">Dev sign-in</button></div><div class="hw-hint">Local test server only.</div>';
    box.querySelector('.cls-devgo').onclick=()=>{const id=(box.querySelector('.cls-devid').value.match(/\d+/)||['1'])[0];const name='Dev '+id;CLS.auth={token:'dev:'+id+':'+name,name,exp:Math.floor(Date.now()/1000)+3600};clsRender();document.dispatchEvent(new Event('pw-auth'));};return;}
  if(!cfg||!cfg.googleClientId){box.innerHTML='<div class="hw-hint">This classroom server isn’t set up for Google sign-in.</div>';return;}
  box.innerHTML='<div class="cls-gbtn"></div>';try{await clsLoadGoogle();google.accounts.id.initialize({client_id:cfg.googleClientId,callback:r=>clsSetToken(r.credential),auto_select:false,cancel_on_tap_outside:true});google.accounts.id.renderButton(box.querySelector('.cls-gbtn'),{theme:'filled_black',size:'medium',text:'signin_with'});}
  catch(e){box.innerHTML='<div class="hw-hint">'+esc(e.message)+'</div>';}}

/* ---------- WebRTC: the actual classroom data goes browser to browser ---------- */
// Only a public STUN server (to discover the route); no TURN relay, so data never passes through a server.
const RTC_CFG={iceServers:[{urls:'stun:stun.cloudflare.com:3478'}]};
const RTC_CHUNK=16000,RTC_MAX_IN={student:1_700_000,teacher:7_200_000};
CLS.peers=new Map();CLS.peer=null;CLS.lastJson='';CLS.rtcFailed=false;
function rtcOpen(p){return !!(p&&p.dc&&p.dc.readyState==='open');}
function rtcLabel(id){const p=CLS.peers.get(id);return !p?'':rtcOpen(p)?'direct':p.failed?'can’t connect directly':'connecting…';}
function rtcSignalOut(data,to){if(CLS.ws&&CLS.ws.readyState===1)CLS.ws.send(JSON.stringify(to?{t:'signal',to,data}:{t:'signal',data}));}
// big messages are split into chunks; the sender waits while the channel's buffer is full (backpressure)
async function rtcSend(p,json){if(!rtcOpen(p))return;const id=Math.random().toString(36).slice(2,10),n=Math.max(1,Math.ceil(json.length/RTC_CHUNK));
  for(let i=0;i<n;i++){while(p.dc&&p.dc.readyState==='open'&&p.dc.bufferedAmount>1_000_000)await new Promise(r=>setTimeout(r,30));if(!rtcOpen(p))return;p.dc.send(id+'|'+i+'|'+n+'|'+json.slice(i*RTC_CHUNK,(i+1)*RTC_CHUNK));}}
function rtcReceiver(p,max,onMsg){const parts=new Map();return ev=>{if(typeof ev.data!=='string')return;const m=/^([a-z0-9]{1,10})\|(\d{1,4})\|(\d{1,4})\|/.exec(ev.data);if(!m)return;const hd=m[0],id=m[1],i=+m[2],n=+m[3];
  if(n<1||i>=n||(n-1)*RTC_CHUNK>max)return;let e=parts.get(id);if(!e){if(parts.size>8)parts.clear();e={n,got:0,a:new Array(n)};parts.set(id,e);}if(e.n!==n||e.a[i]!=null)return;e.a[i]=ev.data.slice(hd.length);e.got++;
  if(e.got===n){parts.delete(id);const json=e.a.join('');if(json.length>max)return;let msg;try{msg=JSON.parse(json);}catch(err){return;}onMsg(msg);}};}
function rtcBroadcast(json){for(const p of CLS.peers.values())if(rtcOpen(p))rtcSend(p,json);}
function rtcNewPc(p,to){const pc=new RTCPeerConnection(RTC_CFG);p.pc=pc;
  pc.onicecandidate=e=>rtcSignalOut({type:'candidate',candidate:e.candidate?e.candidate.toJSON():null},to);
  pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed'){p.failed=true;if(CLS.role==='student')CLS.rtcFailed=true;clsRender();if(CLS.role==='teacher')setTimeout(rtcSync,5200);}if(pc.connectionState==='connected'){p.failed=false;CLS.rtcFailed=false;clsRender();}};return pc;}
// teacher: one direct connection per signed-in student, following the roster (removed students are cut off)
function rtcSync(){if(CLS.role!=='teacher')return;const live=new Set(CLS.roster.filter(p=>p.status==='on').map(p=>p.id));
  for(const [id,p] of CLS.peers)if(!live.has(id)){try{p.pc.close();}catch(e){}CLS.peers.delete(id);}
  for(const id of live){const p=CLS.peers.get(id);if(!p||(p.failed&&p.tries<3&&Date.now()-p.at>5000))rtcOffer(id,p?p.tries+1:1);}}
async function rtcOffer(id,tries){const old=CLS.peers.get(id);if(old)try{old.pc.close();}catch(e){}
  const p={id,tries,at:Date.now(),failed:false,pc:null,dc:null,handins:old?old.handins:0,lastHandin:old?old.lastHandin:0};CLS.peers.set(id,p);const pc=rtcNewPc(p,id);
  const dc=pc.createDataChannel('patchwork',{ordered:true});p.dc=dc;
  dc.onopen=()=>{clsRender();if(CLS.lastJson)rtcSend(p,CLS.lastJson);rtcSend(p,JSON.stringify({t:'homework',on:!!CLS.homework}));};dc.onclose=()=>clsRender();
  // the only thing a teacher accepts from a student is a hand-in
  dc.onmessage=rtcReceiver(p,RTC_MAX_IN.teacher,m=>{if(m&&m.t==='handin')rtcHandIn(p,m);});
  try{await pc.setLocalDescription(await pc.createOffer());rtcSignalOut({type:'offer',sdp:pc.localDescription.sdp},id);}catch(e){p.failed=true;}clsRender();}
async function rtcSignal(from,d){try{
  if(CLS.role==='teacher'){const p=CLS.peers.get(from);if(!p||!p.pc)return;if(d.type==='answer')await p.pc.setRemoteDescription({type:'answer',sdp:d.sdp});else if(d.type==='candidate')await p.pc.addIceCandidate(d.candidate||null);return;}
  if(CLS.role!=='student')return;
  // student: accept the teacher's offer (a new offer replaces the old connection)
  if(d.type==='offer'){rtcClose();const p={pc:null,dc:null,failed:false};CLS.peer=p;const pc=rtcNewPc(p,null);
    pc.ondatachannel=e=>{const dc=e.channel;p.dc=dc;dc.onopen=()=>clsRender();dc.onclose=()=>clsRender();
      // the only things a student accepts: the teacher's broadcast, and the result of their own hand-in
      dc.onmessage=rtcReceiver(p,RTC_MAX_IN.student,m=>{if(!m)return;
        if(m.t==='state'){let snap;try{snap=clsClean(m.body);}catch(err){console.warn('classroom: rejected broadcast',err.message);return;}CLS.snap=snap;clsDrawView();clsRender();}
        else if(m.t==='clear'){CLS.snap=null;clsDrawView();}
        else if(m.t==='homework'){const on=m.on===true;if(on!==!!CLS.homework){CLS.homework=on;clsRender();toast(on?'Your teacher opened homework: you can hand in files or pages (Class \u25be)':'Homework hand-in closed','info');}}
        else if(m.t==='handin-result')toast(m.ok?'Handed in “'+String(m.name).slice(0,60)+'”':String(m.why||'Hand-in failed').slice(0,120),m.ok?'ok':'err');});};
    await pc.setRemoteDescription({type:'offer',sdp:d.sdp});await pc.setLocalDescription(await pc.createAnswer());rtcSignalOut({type:'answer',sdp:pc.localDescription.sdp});}
  else if(d.type==='candidate'&&CLS.peer&&CLS.peer.pc)await CLS.peer.pc.addIceCandidate(d.candidate||null);
}catch(e){console.warn('classroom: connection set-up',e.message);}}
function rtcClose(){if(CLS.peer){try{CLS.peer.pc.close();}catch(e){}CLS.peer=null;}for(const p of CLS.peers.values())try{p.pc.close();}catch(e){}CLS.peers.clear();}
// hand-ins now arrive directly, so the teacher's browser enforces the rules (types, size, count, spacing)
const HANDIN_RULES={perStudent:20,gapMs:5000};
function rtcHandIn(p,m){const f=m.file||{},ext=clsExt(f.name),reply=(ok,why)=>rtcSend(p,JSON.stringify({t:'handin-result',ok,why,name:String(f.name||'').slice(0,120)}));
  if(!CLS.homework){reply(false,'Hand-ins are closed (homework mode is off)');return;}
  if(!CLS_TYPES[ext]||f.type!==CLS_TYPES[ext])return reply(false,'That file type can’t be handed in');
  if(typeof f.data!=='string'||f.data.length*0.75>CLS_MAX.handin+3)return reply(false,'File too large (max 5 MB)');
  if(p.handins>=HANDIN_RULES.perStudent)return reply(false,'Hand-in limit reached for this class');
  if(Date.now()-p.lastHandin<HANDIN_RULES.gapMs)return reply(false,'Please wait a few seconds between hand-ins');
  p.handins++;p.lastHandin=Date.now();clsReceive(m,p);reply(true);}
