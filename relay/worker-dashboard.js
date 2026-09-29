// Patchwork classroom relay - SINGLE FILE for pasting into the Cloudflare dashboard editor.
// Same code as relay-core.mjs + ai-board.mjs + worker.mjs (joined: their imports and the helpers' `export` words
// removed, nothing else changed). If you edit those, re-create this file the same way (or deploy with wrangler).
// Patchwork classroom relay core (transport-agnostic; used by the Cloudflare Worker and the local dev server).
// SIGNALLING ONLY: sign-in, roster, kick/lock and the WebRTC connection set-up messages (offer/answer/ICE) between the
// teacher and each student. Classroom data (broadcasts, hand-ins) never passes through here: it travels directly
// between browsers over WebRTC data channels. State lives in memory only.
const LIMITS={
  maxMsgBytes:32_000,      // signalling messages are small (an SDP offer is a few KB)
  maxStudents:100,
  teacherBurst:300,teacherPerSec:60,  // token bucket: teacher signals every student (ICE candidates come in bursts)
  studentBurst:60,studentPerSec:15,
  helloMs:10_000,          // a connection must identify itself quickly
  idleMs:3*3600_000,       // session ends after 3h without teacher activity
  maxLifeMs:12*3600_000,
};
const CODE_ALPHABET='ABCDEFGHJKMNPQRSTVWXYZ23456789';   // no 0/O/1/I/L/U
function newCode(len=10){const out=[];const buf=new Uint8Array(1);while(out.length<len){crypto.getRandomValues(buf);if(buf[0]<240)out.push(CODE_ALPHABET[buf[0]%30]);}return out.join('');}  // rejection sampling: no modulo bias
function validCode(c){return typeof c==='string'&&/^[A-HJ-NP-TV-Z2-9]{10}$/.test(c);}
function newSecret(){const b=crypto.getRandomValues(new Uint8Array(32));return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function sha256(s){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function safeEq(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0;}

const ADJ=['Blue','Green','Amber','Swift','Quiet','Bright','Silver','Brave','Lucky','Clever'],ANI=['Tiger','Otter','Falcon','Panda','Fox','Heron','Koala','Lynx','Robin','Whale'];
function rnd(n){const b=crypto.getRandomValues(new Uint32Array(1));return b[0]%n;}
function fallbackName(){return ADJ[rnd(10)]+' '+ANI[rnd(10)]+' '+(10+rnd(90));}
// a display name, not an identity: printable, short, no markup characters
function cleanName(n){if(typeof n!=='string')return '';return n.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f<>&"'`\\]/g,'').replace(/\s+/g,' ').trim().slice(0,24);}
// Only well-formed WebRTC set-up messages are passed on, rebuilt field by field (nothing else can ride along).
function cleanSignal(d){if(!d||typeof d!=='object')return null;
  if((d.type==='offer'||d.type==='answer')&&typeof d.sdp==='string'&&d.sdp.length<=20000)return{type:d.type,sdp:d.sdp};
  if(d.type==='candidate'){const c=d.candidate;if(c===null)return{type:'candidate',candidate:null};if(!c||typeof c.candidate!=='string'||c.candidate.length>1000)return null;
    return{type:'candidate',candidate:{candidate:c.candidate,sdpMid:typeof c.sdpMid==='string'?c.sdpMid.slice(0,32):null,sdpMLineIndex:Number.isInteger(c.sdpMLineIndex)?c.sdpMLineIndex:null}};}
  return null;}
function newId(){const b=crypto.getRandomValues(new Uint8Array(6));return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');}

// A socket here is anything with send(string) and close(code, reason).
class Session{
  // hooks: verify(idToken) -> {sub,name}|null (Google sign-in), log: {join(sessionId,userId,role)->Promise<rowId>, leave(rowId), end(sessionId)}
  constructor(code,secretHash,now=Date.now(),opt={}){this.code=code;this.secretHash=secretHash;this.sessionId=opt.sessionId||code;this.teacherId=opt.teacherId||null;this.hooks=opt.hooks||{};this.kickedUsers=new Set();this.meta=new Map();this.teacher=null;this.pending=new Map();
    this.people=new Map();   // participant id -> {id,name,token,sock,status:'on'|'retry'|'off',since,kicked,handins,lastHandin}
    this.bySock=new Map();this.locked=false;this.created=now;this.lastTeacher=now;this.ended=false;this.tokens=LIMITS.teacherBurst;this.tokT=now;}
  get students(){return [...this.people.values()].filter(p=>p.sock);}
  expired(now=Date.now()){return this.ended||now-this.lastTeacher>LIMITS.idleMs||now-this.created>LIMITS.maxLifeMs;}
  open(sock,now=Date.now()){if(this.ended){sock.close(4404,'ended');return;}this.pending.set(sock,now);this.meta.set(sock,{row:null});}
  // connection log (Google account ID + times only; no IP, name, email or content). Fire-and-forget: logging problems must not break a class.
  logJoin(sock,userId,role){const lg=this.hooks.log,m=this.meta.get(sock);if(!lg||!m)return;Promise.resolve(lg.join(this.sessionId,userId,role)).then(id=>{m.row=id;if(m.left)lg.leave(id);}).catch(()=>{});}
  logLeave(sock){const lg=this.hooks.log,m=this.meta.get(sock);if(!m)return;this.meta.delete(sock);if(!lg)return;if(m.row!=null)Promise.resolve(lg.leave(m.row)).catch(()=>{});else m.left=true;}
  // roles are decided HERE (teacher = knows the secret), never taken from what a client claims
  async message(sock,raw,now=Date.now()){
    if(this.ended){sock.close(4404,'ended');return;}
    const who=this.bySock.get(sock),limit=LIMITS.maxMsgBytes;
    if(typeof raw!=='string'||raw.length>limit){sock.close(1009,'too big');this.drop(sock);return;}
    let m;try{m=JSON.parse(raw);}catch(e){sock.close(1007,'bad json');this.drop(sock);return;}
    if(!m||typeof m!=='object'||typeof m.t!=='string'){sock.close(1008,'bad message');this.drop(sock);return;}
    if(this.pending.has(sock)){
      if(m.t!=='hello'){sock.close(1008,'hello first');this.drop(sock);return;}
      this.pending.delete(sock);
      if(typeof m.secret==='string'&&m.secret.length===64){
        if(!safeEq(await sha256(m.secret),this.secretHash)){sock.close(4403,'not the teacher');return;}
        if(this.teacher&&this.teacher!==sock)try{this.teacher.close(4409,'replaced');}catch(e){}
        this.teacher=sock;this.lastTeacher=now;this.logJoin(sock,this.teacherId,'teacher');sock.send(JSON.stringify({t:'welcome',role:'teacher'}));this.roster();this.toStudents({t:'teacher',online:true});return;}
      // student: resume with the token we issued, or sign in with Google to join
      let p=null;if(typeof m.resume==='string')for(const q of this.people.values())if(safeEq(q.token,m.resume)){p=q;break;}
      if(!p){if(!this.hooks.verify){sock.close(4401,'sign-in unavailable');return;}const who=await this.hooks.verify(m.idToken).catch(()=>null);if(!who||!who.sub){sock.close(4401,'sign in with Google');return;}
        if(this.kickedUsers.has(who.sub)){sock.close(4403,'removed by the teacher');return;}
        for(const q of this.people.values())if(q.userId===who.sub){p=q;break;}   // same person on another tab/device
        if(!p){if(this.locked){sock.close(4423,'classroom locked');return;}if(this.students.length>=LIMITS.maxStudents){sock.close(4429,'class full');return;}
          p={id:newId(),userId:who.sub,name:cleanName(who.name)||fallbackName(),token:newSecret(),sock:null,status:'on',since:now,kicked:false};this.people.set(p.id,p);}}
      if(p.kicked||this.kickedUsers.has(p.userId)){sock.close(4403,'removed by the teacher');return;}
      if(p.sock&&p.sock!==sock)try{p.sock.close(4409,'replaced');this.bySock.delete(p.sock);}catch(e){}
      p.sock=sock;p.status='on';p.since=now;this.bySock.set(sock,p);this.logJoin(sock,p.userId,'student');
      sock.send(JSON.stringify({t:'welcome',role:'student',id:p.id,name:p.name,token:p.token,teacher:!!this.teacher}));
      this.roster();return;}
    if(sock===this.teacher){this.lastTeacher=now;
      this.tokens=Math.min(LIMITS.teacherBurst,this.tokens+(now-this.tokT)/1000*LIMITS.teacherPerSec);this.tokT=now;
      if(m.t==='ping'){sock.send('{"t":"pong"}');return;}
      if(this.tokens<1){sock.send('{"t":"slow"}');return;}this.tokens-=1;
      if(m.t==='signal'){const p=this.people.get(m.to),d=cleanSignal(m.data);if(p&&p.sock&&!p.kicked&&d)try{p.sock.send(JSON.stringify({t:'signal',data:d}));}catch(e){}return;}
      if(m.t==='kick'){const p=this.people.get(m.id);if(p&&!p.kicked){p.kicked=true;if(p.userId)this.kickedUsers.add(p.userId);p.status='off';if(p.sock){try{p.sock.send('{"t":"kicked"}');p.sock.close(4403,'removed by the teacher');}catch(e){}this.bySock.delete(p.sock);p.sock=null;}this.roster();}return;}
      if(m.t==='lock'){this.locked=!!m.on;this.roster();return;}
      if(m.t==='end'){this.end();return;}
      return;}
    const p=who;
    if(p){if(m.t==='ping'){sock.send('{"t":"pong"}');return;}
      // a student may only send WebRTC set-up messages, and only to the teacher
      if(m.t==='signal'){p.tokens=Math.min(LIMITS.studentBurst,(p.tokens??LIMITS.studentBurst)+(now-(p.tokT||now))/1000*LIMITS.studentPerSec);p.tokT=now;if(p.tokens<1)return;p.tokens-=1;
        const d=cleanSignal(m.data);if(d&&this.teacher)try{this.teacher.send(JSON.stringify({t:'signal',from:p.id,data:d}));}catch(e){}return;}
      // anything else closes the connection
      sock.close(1008,'not allowed');this.drop(sock);return;}
    sock.close(1008,'unknown connection');}
  toStudents(msg,raw){const s=raw?msg:JSON.stringify(msg);for(const p of this.people.values())if(p.sock)try{p.sock.send(s);}catch(e){this.drop(p.sock);}}
  roster(){if(!this.teacher)return;const list=[...this.people.values()].filter(p=>!p.kicked).map(p=>({id:p.id,name:p.name,status:p.status}));try{this.teacher.send(JSON.stringify({t:'roster',list,locked:this.locked}));}catch(e){}}
  drop(sock,now=Date.now()){this.pending.delete(sock);this.logLeave(sock);const p=this.bySock.get(sock);if(p){this.bySock.delete(sock);if(p.sock===sock){p.sock=null;if(!p.kicked){p.status='retry';p.since=now;}}this.roster();}
    if(sock===this.teacher){this.teacher=null;this.toStudents({t:'teacher',online:false});}}
  sweep(now=Date.now()){for(const [s,t] of this.pending)if(now-t>LIMITS.helloMs){try{s.close(1008,'no hello');}catch(e){}this.pending.delete(s);}
    let ch=false;for(const p of this.people.values())if(p.status==='retry'&&now-p.since>30_000){p.status='off';ch=true;}if(ch)this.roster();
    if(this.expired(now)&&!this.ended)this.end();}
  end(){if(!this.ended&&this.hooks.log&&this.hooks.log.end)Promise.resolve(this.hooks.log.end(this.sessionId)).catch(()=>{});for(const s of [...this.meta.keys()])this.logLeave(s);this.ended=true;const all=[...this.students.map(p=>p.sock),...(this.teacher?[this.teacher]:[]),...this.pending.keys()];for(const s of all){try{s.send('{"t":"ended"}');s.close(4404,'ended');}catch(e){}}this.people.clear();this.bySock.clear();this.pending.clear();this.teacher=null;}
}
// Simple fixed-window limiter for session creation / join attempts per client address.
class Limiter{constructor(max,windowMs){this.max=max;this.win=windowMs;this.m=new Map();}
  hit(key,now=Date.now()){let e=this.m.get(key);if(!e||now-e.t>this.win){e={t:now,n:0};this.m.set(key,e);}e.n++;if(this.m.size>10000)for(const [k,v] of this.m)if(now-v.t>this.win)this.m.delete(k);return e.n<=this.max;}}
function originAllowed(origin,allowList){if(!allowList)return true;const list=allowList.split(',').map(s=>s.trim()).filter(Boolean);return !list.length||list.includes(origin);}

// Verify a Google Sign-In ID token (JWT, RS256) against Google's public keys. Returns {sub,name} or null.
let _jwks={keys:null,exp:0};
async function verifyGoogleIdToken(tok,clientId,{now=Date.now(),certsUrl='https://www.googleapis.com/oauth2/v3/certs',fetcher=fetch}={}){
  if(typeof tok!=='string'||tok.length>4096||!clientId)return null;const parts=tok.split('.');if(parts.length!==3)return null;
  const b64=x=>{x=x.replace(/-/g,'+').replace(/_/g,'/');while(x.length%4)x+='=';return x;};const dec=x=>JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64(x)),c=>c.charCodeAt(0))));
  let h,p;try{h=dec(parts[0]);p=dec(parts[1]);}catch(e){return null;}
  if(h.alg!=='RS256'||typeof h.kid!=='string')return null;
  if(!['accounts.google.com','https://accounts.google.com'].includes(p.iss)||p.aud!==clientId||typeof p.sub!=='string'||!/^\d{1,40}$/.test(p.sub))return null;
  const t=Math.floor(now/1000);if(!(p.exp>t-60)||!(p.iat<t+300))return null;
  if(!_jwks.keys||now>_jwks.exp){const r=await fetcher(certsUrl);if(!r.ok)return null;const cc=/max-age=(\d+)/.exec(r.headers.get('cache-control')||'');_jwks={keys:(await r.json()).keys||[],exp:now+Math.min(86400,cc?+cc[1]:3600)*1000};}
  const jwk=_jwks.keys.find(k=>k.kid===h.kid);if(!jwk)return null;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,Uint8Array.from(atob(b64(parts[2])),c=>c.charCodeAt(0)),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  return ok?{sub:p.sub,name:typeof p.name==='string'?p.name:''}:null;}
function _resetJwksCache(){_jwks={keys:null,exp:0};}

// AI board link (EXPERIMENTAL). Lets an external client send one of a tiny, fixed set of commands to ONE open
// Patchwork board. Transport-agnostic; used by the Cloudflare Worker (inside the Classroom Durable Object class,
// as a separate "ai:<boardId>" instance) and by the local dev server.
// - A board link exists only while its owner has it switched on in Patchwork. Creating one needs Google sign-in.
// - Two secrets: the owner's (browser <-> relay) and the key the owner gives the AI (external client -> relay).
//   The relay keeps only their SHA-256 hashes, in memory.
// - Commands are {action, text} with action in AI_ACTIONS; the browser decides how they become board objects.
// - Nothing is stored: no board contents, no command history. The browser only ever sends hello and ack.

const AI_ACTIONS=['createQuestion','createAnswer','createNote'];
const AI_LIMITS={text:2000,body:8000,msg:1000,perMin:30,ackMs:8000,idleMs:10*60_000};

function aiSafeEq(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}

// {action,text} from an untrusted request body, or {error}
function cleanCommand(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return{error:'body must be a JSON object'};
  if(!AI_ACTIONS.includes(body.action))return{error:'unsupported action (use '+AI_ACTIONS.join(', ')+')'};
  if(typeof body.text!=='string')return{error:'text must be a string'};
  const text=body.text.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,' ').replace(/\s+/g,' ').trim();
  if(!text)return{error:'text is empty'};
  if(text.length>AI_LIMITS.text)return{error:'text is longer than '+AI_LIMITS.text+' characters'};
  return{action:body.action,text};
}

class AiBoard{
  constructor(boardId,ownerHash,keyHash,now=Date.now()){this.boardId=boardId;this.ownerHash=ownerHash;this.keyHash=keyHash;
    this.browser=null;this.pending=new Map();this.seq=0;this.hits=[];this.lastSeen=now;this.closed=false;}
  // browser side: first message must be {t:'hello',secret}
  open(sock){sock.authed=false;}
  async message(sock,raw){if(typeof raw!=='string'||raw.length>AI_LIMITS.msg){sock.close(4400,'bad message');return;}
    let m;try{m=JSON.parse(raw);}catch(e){sock.close(4400,'bad message');return;}
    if(!sock.authed){
      if(!m||m.t!=='hello'||typeof m.secret!=='string'||!aiSafeEq(await sha256(m.secret),this.ownerHash)){sock.close(4403,'not the board owner');return;}
      if(this.browser&&this.browser!==sock)this.browser.close(4000,'replaced by a newer tab');
      sock.authed=true;this.browser=sock;this.lastSeen=Date.now();sock.send(JSON.stringify({t:'welcome',boardId:this.boardId}));return;}
    if(m&&m.t==='ack'&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);
      p({ok:m.ok===true,error:m.ok===true?undefined:String(m.error||'the board refused the command').slice(0,120)});return;}
    if(m&&m.t==='bye'){this.close();return;}
  }
  drop(sock){if(this.browser===sock){this.browser=null;this.lastSeen=Date.now();for(const [,p] of this.pending)p({ok:false,error:'the board went offline'});this.pending.clear();}}
  // external side: returns {status, body}
  async command(key,cmd,now=Date.now()){
    if(typeof key!=='string'||!aiSafeEq(await sha256(key),this.keyHash))return{status:403,body:{ok:false,error:'wrong key for this board'}};
    if(!this.browser)return{status:409,body:{ok:false,error:'the board is not open right now'}};
    this.hits=this.hits.filter(t=>now-t<60_000);if(this.hits.length>=AI_LIMITS.perMin)return{status:429,body:{ok:false,error:'slow down'}};this.hits.push(now);
    const id=++this.seq;const res=await new Promise(done=>{this.pending.set(id,done);
      try{this.browser.send(JSON.stringify({t:'cmd',id,action:cmd.action,text:cmd.text}));}catch(e){this.pending.delete(id);done({ok:false,error:'the board went offline'});return;}
      setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);done({ok:false,timeout:true,error:'the board did not answer'});}},AI_LIMITS.ackMs);});
    if(res.ok)return{status:200,body:{ok:true,boardId:this.boardId,action:cmd.action}};
    return{status:res.timeout?504:422,body:{ok:false,error:res.error}};}
  close(){this.closed=true;if(this.browser)this.browser.close(4001,'link closed');this.browser=null;}
  expired(now=Date.now()){return this.closed||(!this.browser&&now-this.lastSeen>AI_LIMITS.idleMs);}
}
// fresh ids for a new link: the plain secrets go back to the owner once; the relay keeps only the hashes
async function aiCredentials(newCode,newSecret){const boardId=newCode(),secret=newSecret(),key=newSecret();
  return{boardId,secret,key,ownerHash:await sha256(secret),keyHash:await sha256(key)};}

// Cloudflare Worker + Durable Object wrapper around relay-core.mjs.
// One Durable Object per classroom code; classroom content lives in memory only.
// Teaching-mode connection log (D1): Google account ID + join/leave times, deleted after 90 days. No IPs, names or content.
const createLimit=new Limiter(10,60_000),joinLimit=new Limiter(60,60_000),aiLimit=new Limiter(120,60_000);
const RETENTION_MS=90*24*3600_000;
function cors(env,origin){return{'Access-Control-Allow-Origin':originAllowed(origin,env.ALLOWED_ORIGINS)?(origin||'*'):'null','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'content-type, authorization','Vary':'Origin'};}
const json=(o,h,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json','cache-control':'no-store',...h}});
export default{
  async fetch(req,env){const url=new URL(req.url),origin=req.headers.get('Origin')||'',ip=req.headers.get('CF-Connecting-IP')||'';
    if(req.method==='OPTIONS')return new Response(null,{headers:cors(env,origin)});
    // AI board command: called by external clients (no Origin), authorised by the board's key
    if(url.pathname==='/api/ai/board'&&req.method==='POST'){const h=cors(env,origin);
      if(origin&&!originAllowed(origin,env.ALLOWED_ORIGINS))return json({ok:false,error:'origin not allowed'},h,403);
      if(!aiLimit.hit(ip))return json({ok:false,error:'slow down'},h,429);
      const key=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'');
      const raw=await req.text();if(raw.length>AI_LIMITS.body)return json({ok:false,error:'request too large'},h,413);
      let body;try{body=JSON.parse(raw);}catch(e){return json({ok:false,error:'body must be JSON'},h,400);}
      if(!body||!validCode(body.boardId))return json({ok:false,error:'boardId is missing or malformed'},h,400);
      const cmd=cleanCommand(body);if(cmd.error)return json({ok:false,error:cmd.error},h,400);
      if(!key)return json({ok:false,error:'missing Authorization: Bearer <board key>'},h,401);
      const r=await env.CLASSROOM.get(env.CLASSROOM.idFromName('ai:'+body.boardId)).fetch('https://do/ai/cmd',{method:'POST',body:JSON.stringify({key,cmd})});
      return json(await r.json(),h,r.status);}
    if(!originAllowed(origin,env.ALLOWED_ORIGINS))return new Response('origin not allowed',{status:403});
    if(url.pathname==='/api/config')return json({googleClientId:env.GOOGLE_CLIENT_ID||''},cors(env,origin));
    if(url.pathname==='/api/session'&&req.method==='POST'){
      if(!createLimit.hit(ip))return new Response('slow down',{status:429,headers:cors(env,origin)});
      const who=await verifyGoogleIdToken((req.headers.get('Authorization')||'').replace(/^Bearer\s+/,''),env.GOOGLE_CLIENT_ID).catch(()=>null);
      if(!who)return new Response('sign in with Google',{status:401,headers:cors(env,origin)});
      const code=newCode(),secret=newSecret(),sessionId=crypto.randomUUID();const stub=env.CLASSROOM.get(env.CLASSROOM.idFromName(code));
      const r=await stub.fetch('https://do/init',{method:'POST',body:JSON.stringify({code,secretHash:await sha256(secret),sessionId,teacherId:who.sub})});
      if(!r.ok)return new Response('try again',{status:503,headers:cors(env,origin)});
      return json({code,secret},cors(env,origin));}
    if(url.pathname==='/api/ai/link'&&req.method==='POST'){
      if(!createLimit.hit(ip))return new Response('slow down',{status:429,headers:cors(env,origin)});
      const who=await verifyGoogleIdToken((req.headers.get('Authorization')||'').replace(/^Bearer\s+/,''),env.GOOGLE_CLIENT_ID).catch(()=>null);
      if(!who)return new Response('sign in with Google',{status:401,headers:cors(env,origin)});
      const c=await aiCredentials(newCode,newSecret);
      const r=await env.CLASSROOM.get(env.CLASSROOM.idFromName('ai:'+c.boardId)).fetch('https://do/ai/init',{method:'POST',body:JSON.stringify({boardId:c.boardId,ownerHash:c.ownerHash,keyHash:c.keyHash})});
      if(!r.ok)return new Response('try again',{status:503,headers:cors(env,origin)});
      return json({boardId:c.boardId,secret:c.secret,key:c.key},cors(env,origin));}
    if(url.pathname==='/api/ai/ws'){const id=url.searchParams.get('board');
      if(req.headers.get('Upgrade')!=='websocket')return new Response('expected websocket',{status:426});
      if(!validCode(id))return new Response('bad board id',{status:400});
      if(!joinLimit.hit(ip))return new Response('slow down',{status:429});
      return env.CLASSROOM.get(env.CLASSROOM.idFromName('ai:'+id)).fetch(req);}
    if(url.pathname==='/api/ws'){const code=url.searchParams.get('code');
      if(req.headers.get('Upgrade')!=='websocket')return new Response('expected websocket',{status:426});
      if(!validCode(code))return new Response('bad code',{status:400});
      if(!joinLimit.hit(ip))return new Response('slow down',{status:429});
      return env.CLASSROOM.get(env.CLASSROOM.idFromName(code)).fetch(req);}
    return new Response('Patchwork classroom relay',{status:404});},
  // daily: delete teaching-session records older than 90 days
  async scheduled(ev,env){const cut=Date.now()-RETENTION_MS;await env.DB.batch([env.DB.prepare('DELETE FROM participants WHERE joined_at < ?').bind(cut),env.DB.prepare('DELETE FROM sessions WHERE started_at < ?').bind(cut)]);}
};
function d1Log(env){return{
  join:async(sid,uid,role)=>{const r=await env.DB.prepare('INSERT INTO participants (session_id,user_id,role,joined_at) VALUES (?,?,?,?)').bind(sid,uid||'',role,Date.now()).run();return r.meta.last_row_id;},
  leave:rid=>env.DB.prepare('UPDATE participants SET left_at=? WHERE id=? AND left_at IS NULL').bind(Date.now(),rid).run(),
  end:sid=>env.DB.prepare('UPDATE sessions SET ended_at=? WHERE id=? AND ended_at IS NULL').bind(Date.now(),sid).run()};}
export class Classroom{
  constructor(state,env){this.ctx=state;this.env=env;this.session=null;this.ai=null;}
  async fetch(req){const url=new URL(req.url),env=this.env;
    if(url.pathname.startsWith('/ai/')||url.pathname==='/api/ai/ws')return this.aiFetch(req,url);
    if(url.pathname==='/init'){if(this.session&&!this.session.expired())return new Response('exists',{status:409});const {code,secretHash,sessionId,teacherId}=await req.json();
      await env.DB.prepare('INSERT INTO sessions (id,teacher_id,started_at) VALUES (?,?,?)').bind(sessionId,teacherId,Date.now()).run();
      this.session=new Session(code,secretHash,Date.now(),{sessionId,teacherId,hooks:{verify:t=>verifyGoogleIdToken(t,env.GOOGLE_CLIENT_ID),log:d1Log(env)}});
      await this.ctx.storage.setAlarm(Date.now()+60_000);return new Response('ok');}
    if(!this.session||this.session.expired())return new Response('no such classroom',{status:404});
    const pair=new WebSocketPair();const [client,server]=Object.values(pair);server.accept();const s=this.session;
    const sock={send:x=>server.send(x),close:(c,r)=>{try{server.close(c,r);}catch(e){}}};s.open(sock);
    server.addEventListener('message',ev=>{s.message(sock,typeof ev.data==='string'?ev.data:null);});
    server.addEventListener('close',()=>s.drop(sock));server.addEventListener('error',()=>s.drop(sock));
    return new Response(null,{status:101,webSocket:client});}
  // experimental AI board link: this object is an "ai:<boardId>" instance, separate from any classroom
  async aiFetch(req,url){
    if(url.pathname==='/ai/init'){if(this.ai&&!this.ai.expired())return new Response('exists',{status:409});const {boardId,ownerHash,keyHash}=await req.json();
      this.ai=new AiBoard(boardId,ownerHash,keyHash);await this.ctx.storage.setAlarm(Date.now()+60_000);return new Response('ok');}
    const live=this.ai&&!this.ai.expired();
    if(url.pathname==='/ai/cmd'){if(!live)return json({ok:false,error:'no such board (not open, or the link was switched off)'},{},404);
      const {key,cmd}=await req.json();const r=await this.ai.command(key,cmd);return json(r.body,{},r.status);}
    if(!live)return new Response('no such board',{status:404});
    const pair=new WebSocketPair();const [client,server]=Object.values(pair);server.accept();const a=this.ai;
    const sock={send:x=>server.send(x),close:(c,r)=>{try{server.close(c,r);}catch(e){}}};a.open(sock);
    server.addEventListener('message',ev=>{a.message(sock,typeof ev.data==='string'?ev.data:null);});
    server.addEventListener('close',()=>a.drop(sock));server.addEventListener('error',()=>a.drop(sock));
    return new Response(null,{status:101,webSocket:client});}
  async alarm(){if(this.ai){if(this.ai.expired())this.ai=null;else await this.ctx.storage.setAlarm(Date.now()+60_000);}
    if(!this.session)return;this.session.sweep();if(this.session.ended){this.session=null;return;}await this.ctx.storage.setAlarm(Date.now()+60_000);}
}
