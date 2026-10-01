"use strict";
/* ===== AI board link (EXPERIMENTAL, optional network feature) =====
   Lets an outside program add a Question, Answer or Note to the page that was open when you switched the link on.
   - Off unless you switch it on (menu → AI board link). Needs Google sign-in (the same one as Classroom).
   - Uses the classroom server only to pass commands along; it stores nothing. This tab answers each command.
   - The only commands are createQuestion / createAnswer / createNote with plain text, which become highlights through
     the same path as selecting text and tagging it (addMark + a marked text run), and drawStrokes: a capped doodle of
     plain pen lines, saved as ordinary pen strokes (commitStroke) in free space below everything on the page.
   - The link ends when you switch it off, close or reload the tab. The key you give the AI works only while it's on.
   To remove the feature: delete this file, its <script> tag, the menu line in menu.js, relay/ai-board.mjs
   and the "ai" parts of relay/worker.mjs and relay/dev-server.mjs. */
const AI={on:false,pid:null,boardId:'',key:'',secret:'',ws:null,status:'off',retry:0,rt:null,count:0};
const AI_TYPES={createQuestion:'question',createAnswer:'answer',createNote:'note'};
let aiPanel=null;

function aiUrl(path){return CLS.relay.replace(/\/$/,'')+path;}
function aiWsUrl(){const x=new URL(CLS.relay);x.protocol=x.protocol==='https:'?'wss:':'ws:';x.pathname=x.pathname.replace(/\/$/,'')+'/api/ai/ws';x.search='?board='+encodeURIComponent(AI.boardId);return x.toString();}

async function aiStart(){if(!clsRelayOk(CLS.relay)){toast('No classroom server set','err');return;}
  if(!clsSignedIn()){toast('Sign in with Google first','err');return;}
  if(!isShared(pid)){const p=projects.find(x=>x.id===pid);if(!p||!await setShared(p,true))return;}   // private projects are never linked
  let r;try{r=await fetch(aiUrl('/api/ai/link'),{method:'POST',headers:{Authorization:'Bearer '+CLS.auth.token}});}catch(e){toast('Can’t reach the server','err');return;}
  if(!r.ok){toast(r.status===401?'Sign in with Google again':'The server said no ('+r.status+')','err');return;}
  const j=await r.json().catch(()=>null);if(!j||!/^[A-HJ-NP-TV-Z2-9]{10}$/.test(j.boardId)||!/^[0-9a-f]{64}$/.test(j.secret)||!/^[0-9a-f]{64}$/.test(j.key)){toast('Unexpected answer from the server','err');return;}
  Object.assign(AI,{on:true,pid,boardId:j.boardId,key:j.key,secret:j.secret,retry:0,count:0});aiConnect();aiRender();}

function aiConnect(){if(!AI.on)return;AI.status='retry';let ws;try{ws=new WebSocket(aiWsUrl());}catch(e){aiRetry();return;}AI.ws=ws;
  ws.onopen=()=>ws.send(JSON.stringify({t:'hello',secret:AI.secret}));
  ws.onmessage=async ev=>{if(typeof ev.data!=='string'||ev.data.length>200_000)return;let m;try{m=JSON.parse(ev.data);}catch(e){return;}
    if(m.t==='welcome'){AI.status='on';AI.retry=0;aiRender();return;}
    if(m.t==='cmd'&&Number.isInteger(m.id)){const r=await aiRun(m);if(ws.readyState===1)ws.send(JSON.stringify(Object.assign({t:'ack',id:m.id},r)));}};
  ws.onclose=ev=>{if(AI.ws!==ws)return;AI.ws=null;if(!AI.on)return;
    if(ev.code===4403||ev.code===4001||ev.code===4000){aiStop(ev.code===4000?'Switched off: the link was opened in another tab':'The AI link ended');return;}aiRetry();};}
function aiRetry(){AI.status='retry';aiRender();clearTimeout(AI.rt);if(++AI.retry>8){aiStop('Lost the connection to the server');return;}AI.rt=setTimeout(aiConnect,Math.min(15000,500*2**AI.retry));}
function aiStop(msg){const ws=AI.ws;AI.on=false;AI.ws=null;clearTimeout(AI.rt);if(ws){try{if(ws.readyState===1)ws.send(JSON.stringify({t:'bye'}));ws.close();}catch(e){}}
  Object.assign(AI,{status:'off',boardId:'',key:'',secret:''});if(msg)toast(msg,'info');aiRender();}

// one command -> one highlight, via the same records a human tag creates. Returns {ok} or {ok:false,error}.
async function aiRun(c){if(c.action==='drawStrokes')return aiDraw(c);const type=AI_TYPES[c.action];
  if(!type||!HT.has(type))return{ok:false,error:'unsupported action'};
  const text=typeof c.text==='string'?c.text.replace(/\s+/g,' ').trim():'';
  if(!text||text.length>2000)return{ok:false,error:'bad text'};
  if(pid!==AI.pid)return{ok:false,error:'this board is not the open page right now'};
  if(!isShared(AI.pid))return{ok:false,error:'this board is private'};
  if(!editor)return{ok:false,error:'the board is not ready'};
  const snip=text.slice(0,200);
  const m=await addMark({type,name:snip.slice(0,80),snippet:snip,anchor:{kind:'text'}},false);
  if(!m)return{ok:false,error:'could not save'};
  editor.appendMarked(text,m.id);redrawInk();flashPin(m.id);
  const el=editor.markEl(m.id);if(el){const wr=wrap.getBoundingClientRect(),r=el.getBoundingClientRect();wrap.scrollTo({top:Math.max(0,scrollTop()+(r.top-wr.top)-H*0.35),behavior:'smooth'});el.classList.add('mark-flash');setTimeout(()=>el.classList.remove('mark-flash'),1100);}
  AI.count++;aiRender();return{ok:true};}

// a doodle: points on a 0-1000 canvas, placed half a page wide in free space below the page's text and ink
function aiDraw(c){if(pid!==AI.pid)return{ok:false,error:'this board is not the open page right now'};if(!isShared(AI.pid))return{ok:false,error:'this board is private'};
  const L=c.strokes;if(!Array.isArray(L)||!L.length||L.length>50)return{ok:false,error:'bad strokes'};
  let total=0;const ok=n=>Number.isFinite(n)&&n>=0&&n<=1000;
  for(const st of L){if(!st||!Array.isArray(st.points)||!st.points.length||st.points.length>500)return{ok:false,error:'bad strokes'};total+=st.points.length;
    if(!st.points.every(p=>Array.isArray(p)&&p.length===2&&ok(p[0])&&ok(p[1])))return{ok:false,error:'bad points'};}
  if(total>5000)return{ok:false,error:'too many points'};
  const box=0.5,x0=0.04,y0=(Math.max(noteEd.scrollHeight,inkBottomPx())+24)/drawW,t=Date.now();
  for(const st of L){const color=normalizeHex(st.color)||'#e0e0ea',wn=Math.min(40,Math.max(1,+st.width||4))/1000*box;
    const pts=st.points.map(p=>({xn:x0+p[0]/1000*box,yn:y0+p[1]/1000*box,wn}));
    let minYn=Infinity,maxYn=-Infinity;for(const p of pts){if(p.yn<minYn)minYn=p.yn;if(p.yn>maxYn)maxYn=p.yn;}
    addViewStroke({kind:'stroke',tool:'pen',color,t,pts,minYn,maxYn,pid});}
  redrawInk();updatePad();wrap.scrollTo({top:Math.max(0,y0*drawW-H*0.2),behavior:'smooth'});
  AI.count++;aiRender();return{ok:true};}

function openAiLink(){if(!aiPanel){aiPanel=document.createElement('div');aiPanel.className='panel cls-panel';document.body.appendChild(aiPanel);}
  aiPanel.style.display='flex';aiPanel.style.left=Math.max(8,Math.min(400,innerWidth-380))+'px';aiPanel.style.top='90px';aiPanel.style.right='auto';aiRender();}
function aiRender(){if(!aiPanel||aiPanel.style.display==='none')return;
  let h='<div class="panel-h"><div class="panel-t">AI board link <span class="hw-hint">experimental</span></div><button class="panel-x">×</button></div><div class="panel-b">'+
    '<div class="hw-hint">Lets an outside program add a <b>Question</b>, <b>Answer</b>, <b>Note</b> or a small <b>doodle</b> to this page while this tab is open. Nothing else: it can’t read your page or change what’s already there.</div>';
  if(!AI.on){h+='<div class="pf"><div class="pf-l">1. Sign in with Google</div><div class="ai-auth"></div></div>'+
      (clsSignedIn()?'<div class="pf"><div class="pf-l">2. Switch on for “'+esc(projName(pid))+'”</div><button class="fx-primary ai-start">Switch on</button>'+(isShared(pid)?'':'<div class="hw-hint">This project is private. Switching on asks you to make it sharable first.</div>')+'</div>':'');}
  else{const st=AI.status==='on'?'Listening':'Connecting…';
    const curl="curl -X POST "+aiUrl('/api/ai/board')+" \\\n  -H 'Authorization: Bearer "+AI.key+"' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"boardId\":\""+AI.boardId+"\",\"action\":\"createQuestion\",\"text\":\"Why does WebRTC need signalling?\"}'";
    h+='<div class="cls-status"><span class="cls-dot '+(AI.status==='on'?'on':'retry')+'"></span>'+st+' on “'+esc(projName(AI.pid))+'”'+(AI.count?' · '+AI.count+' added':'')+'</div>'+
      '<div class="pf"><div class="pf-l">Board ID</div><input class="pf-in" readonly value="'+esc(AI.boardId)+'"></div>'+
      '<div class="pf"><div class="pf-l">Key (give this to the AI; it works only while the link is on)</div><div class="hw-row" style="margin-top:0"><input class="pf-in ai-key" readonly value="'+esc(AI.key)+'" style="flex:1"><button class="pbtn ai-copy" data-v="key">Copy</button></div></div>'+
      '<div class="pf"><div class="pf-l">Try it</div><textarea class="pf-in ai-curl" readonly rows="5" style="font:11px ui-monospace,Menlo,Consolas,monospace;white-space:pre">'+esc(curl)+'</textarea><div class="hw-row"><button class="pbtn ai-copy" data-v="curl">Copy command</button></div></div>'+
      '<button class="fx-link danger ai-stop">Switch off</button>';}
  aiPanel.innerHTML=h+'</div>';makeDraggable(aiPanel,aiPanel.querySelector('.panel-h'));const q=x=>aiPanel.querySelector(x);
  q('.panel-x').onclick=()=>aiPanel.style.display='none';
  if(q('.ai-auth'))clsAuthUI(q('.ai-auth'));
  if(q('.ai-start'))q('.ai-start').onclick=aiStart;
  if(q('.ai-stop'))q('.ai-stop').onclick=()=>aiStop();
  aiPanel.querySelectorAll('.ai-copy').forEach(b=>b.onclick=()=>{const v=b.dataset.v==='key'?AI.key:q('.ai-curl').value;
    (navigator.clipboard?navigator.clipboard.writeText(v):Promise.reject()).then(()=>toast('Copied','info'),()=>{const i=b.dataset.v==='key'?q('.ai-key'):q('.ai-curl');i.select();toast('Press Ctrl+C to copy','info');});});}
document.addEventListener('pw-auth',aiRender);
document.addEventListener('pw-private',e=>{if(AI.on&&e.detail===AI.pid)aiStop('AI link switched off: that project is now private');});
addEventListener('pagehide',()=>{if(AI.on)aiStop();});
