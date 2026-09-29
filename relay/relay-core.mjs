// Patchwork classroom relay core (transport-agnostic; used by the Cloudflare Worker and the local dev server).
// The relay is deliberately dumb: it forwards what the TEACHER connection sends to STUDENT connections.
// It never receives student work (students may only say hello/ping) and keeps state in memory only.
export const LIMITS={
  maxMsgBytes:1_600_000,   // one teacher snapshot
  maxStudents:100,
  maxStudentMsgBytes:7_100_000,  // a hand-in (5 MB file as base64)
  teacherBurst:8,teacherPerSec:4,   // token bucket for teacher messages
  helloMs:10_000,          // a connection must identify itself quickly
  idleMs:3*3600_000,       // session ends after 3h without teacher activity
  maxLifeMs:12*3600_000,
};
const CODE_ALPHABET='ABCDEFGHJKMNPQRSTVWXYZ23456789';   // no 0/O/1/I/L/U
export function newCode(len=10){const out=[];const buf=new Uint8Array(1);while(out.length<len){crypto.getRandomValues(buf);if(buf[0]<240)out.push(CODE_ALPHABET[buf[0]%30]);}return out.join('');}  // rejection sampling: no modulo bias
export function validCode(c){return typeof c==='string'&&/^[A-HJ-NP-TV-Z2-9]{10}$/.test(c);}
export function newSecret(){const b=crypto.getRandomValues(new Uint8Array(32));return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function sha256(s){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function safeEq(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0;}

// Hand-ins (student -> teacher only): forwarded straight to the teacher's connection, never stored, never broadcast.
export const HANDIN={maxBytes:5_000_000,perStudent:20,gapMs:5_000,
  types:{pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',txt:'text/plain',md:'text/markdown',
    docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',odt:'application/vnd.oasis.opendocument.text'}};
const ADJ=['Blue','Green','Amber','Swift','Quiet','Bright','Silver','Brave','Lucky','Clever'],ANI=['Tiger','Otter','Falcon','Panda','Fox','Heron','Koala','Lynx','Robin','Whale'];
function rnd(n){const b=crypto.getRandomValues(new Uint32Array(1));return b[0]%n;}
export function fallbackName(){return ADJ[rnd(10)]+' '+ANI[rnd(10)]+' '+(10+rnd(90));}
// a display name, not an identity: printable, short, no markup characters
export function cleanName(n){if(typeof n!=='string')return '';return n.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f<>&"'`\\]/g,'').replace(/\s+/g,' ').trim().slice(0,24);}
function newId(){const b=crypto.getRandomValues(new Uint8Array(6));return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');}
function extOf(n){const m=/\.([a-z0-9]{1,5})$/i.exec(n||'');return m?m[1].toLowerCase():'';}

// A socket here is anything with send(string) and close(code, reason).
export class Session{
  // hooks: verify(idToken) -> {sub,name}|null (Google sign-in), log: {join(sessionId,userId,role)->Promise<rowId>, leave(rowId), end(sessionId)}
  constructor(code,secretHash,now=Date.now(),opt={}){this.code=code;this.secretHash=secretHash;this.sessionId=opt.sessionId||code;this.teacherId=opt.teacherId||null;this.hooks=opt.hooks||{};this.kickedUsers=new Set();this.meta=new Map();this.teacher=null;this.pending=new Map();
    this.people=new Map();   // participant id -> {id,name,token,sock,status:'on'|'retry'|'off',since,kicked,handins,lastHandin}
    this.bySock=new Map();this.locked=false;this.state=null;this.seq=0;this.created=now;this.lastTeacher=now;this.ended=false;this.tokens=LIMITS.teacherBurst;this.tokT=now;}
  get students(){return [...this.people.values()].filter(p=>p.sock);}
  expired(now=Date.now()){return this.ended||now-this.lastTeacher>LIMITS.idleMs||now-this.created>LIMITS.maxLifeMs;}
  open(sock,now=Date.now()){if(this.ended){sock.close(4404,'ended');return;}this.pending.set(sock,now);this.meta.set(sock,{row:null});}
  // connection log (Google account ID + times only; no IP, name, email or content). Fire-and-forget: logging problems must not break a class.
  logJoin(sock,userId,role){const lg=this.hooks.log,m=this.meta.get(sock);if(!lg||!m)return;Promise.resolve(lg.join(this.sessionId,userId,role)).then(id=>{m.row=id;if(m.left)lg.leave(id);}).catch(()=>{});}
  logLeave(sock){const lg=this.hooks.log,m=this.meta.get(sock);if(!m)return;this.meta.delete(sock);if(!lg)return;if(m.row!=null)Promise.resolve(lg.leave(m.row)).catch(()=>{});else m.left=true;}
  // roles are decided HERE (teacher = knows the secret), never taken from what a client claims
  async message(sock,raw,now=Date.now()){
    if(this.ended){sock.close(4404,'ended');return;}
    const who=this.bySock.get(sock),limit=who?LIMITS.maxStudentMsgBytes:LIMITS.maxMsgBytes;
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
          p={id:newId(),userId:who.sub,name:cleanName(who.name)||fallbackName(),token:newSecret(),sock:null,status:'on',since:now,kicked:false,handins:0,lastHandin:0};this.people.set(p.id,p);}}
      if(p.kicked||this.kickedUsers.has(p.userId)){sock.close(4403,'removed by the teacher');return;}
      if(p.sock&&p.sock!==sock)try{p.sock.close(4409,'replaced');this.bySock.delete(p.sock);}catch(e){}
      p.sock=sock;p.status='on';p.since=now;this.bySock.set(sock,p);this.logJoin(sock,p.userId,'student');
      sock.send(JSON.stringify({t:'welcome',role:'student',id:p.id,name:p.name,token:p.token,teacher:!!this.teacher}));
      if(this.state)sock.send(this.state);this.roster();return;}
    if(sock===this.teacher){this.lastTeacher=now;
      this.tokens=Math.min(LIMITS.teacherBurst,this.tokens+(now-this.tokT)/1000*LIMITS.teacherPerSec);this.tokT=now;
      if(m.t==='ping'){sock.send('{"t":"pong"}');return;}
      if(this.tokens<1){sock.send('{"t":"slow"}');return;}this.tokens-=1;
      if(m.t==='state'){if(!m.body||typeof m.body!=='object'){sock.send('{"t":"rejected"}');return;}
        this.seq++;this.state=JSON.stringify({t:'state',seq:this.seq,body:m.body});this.toStudents(this.state,true);return;}
      if(m.t==='clear'){this.state=null;this.seq++;this.toStudents({t:'clear',seq:this.seq});return;}
      if(m.t==='kick'){const p=this.people.get(m.id);if(p&&!p.kicked){p.kicked=true;if(p.userId)this.kickedUsers.add(p.userId);p.status='off';if(p.sock){try{p.sock.send('{"t":"kicked"}');p.sock.close(4403,'removed by the teacher');}catch(e){}this.bySock.delete(p.sock);p.sock=null;}this.roster();}return;}
      if(m.t==='lock'){this.locked=!!m.on;this.roster();return;}
      if(m.t==='end'){this.end();return;}
      return;}
    const p=who;
    if(p){if(m.t==='ping'){sock.send('{"t":"pong"}');return;}
      if(m.t==='handin'){const f=m.file||{},ext=extOf(f.name),reply=(ok,why)=>sock.send(JSON.stringify({t:'handin-result',ok,why,name:typeof f.name==='string'?f.name.slice(0,120):''}));
        if(!this.teacher)return reply(false,'The teacher is offline — try again later');
        if(!HANDIN.types[ext]||f.type!==HANDIN.types[ext])return reply(false,'That file type can’t be handed in');
        if(typeof f.data!=='string'||!/^[A-Za-z0-9+/=]+$/.test(f.data)||f.data.length*0.75>HANDIN.maxBytes+3)return reply(false,'File too large (max 5 MB)');
        if(p.handins>=HANDIN.perStudent)return reply(false,'Hand-in limit reached for this class');
        if(now-p.lastHandin<HANDIN.gapMs)return reply(false,'Please wait a few seconds between hand-ins');
        p.handins++;p.lastHandin=now;
        this.teacher.send(JSON.stringify({t:'handin',from:{id:p.id,name:p.name},file:{name:f.name.slice(0,120),type:f.type,size:Math.round(f.data.length*0.75),data:f.data},at:now}));
        return reply(true);}
      // there is no other path for student data: anything else closes the connection
      sock.close(1008,'not allowed');this.drop(sock);return;}
    sock.close(1008,'unknown connection');}
  toStudents(msg,raw){const s=raw?msg:JSON.stringify(msg);for(const p of this.people.values())if(p.sock)try{p.sock.send(s);}catch(e){this.drop(p.sock);}}
  roster(){if(!this.teacher)return;const list=[...this.people.values()].filter(p=>!p.kicked).map(p=>({id:p.id,name:p.name,status:p.status}));try{this.teacher.send(JSON.stringify({t:'roster',list,locked:this.locked}));}catch(e){}}
  drop(sock,now=Date.now()){this.pending.delete(sock);this.logLeave(sock);const p=this.bySock.get(sock);if(p){this.bySock.delete(sock);if(p.sock===sock){p.sock=null;if(!p.kicked){p.status='retry';p.since=now;}}this.roster();}
    if(sock===this.teacher){this.teacher=null;this.toStudents({t:'teacher',online:false});}}
  sweep(now=Date.now()){for(const [s,t] of this.pending)if(now-t>LIMITS.helloMs){try{s.close(1008,'no hello');}catch(e){}this.pending.delete(s);}
    let ch=false;for(const p of this.people.values())if(p.status==='retry'&&now-p.since>30_000){p.status='off';ch=true;}if(ch)this.roster();
    if(this.expired(now)&&!this.ended)this.end();}
  end(){if(!this.ended&&this.hooks.log&&this.hooks.log.end)Promise.resolve(this.hooks.log.end(this.sessionId)).catch(()=>{});for(const s of [...this.meta.keys()])this.logLeave(s);this.ended=true;this.state=null;const all=[...this.students.map(p=>p.sock),...(this.teacher?[this.teacher]:[]),...this.pending.keys()];for(const s of all){try{s.send('{"t":"ended"}');s.close(4404,'ended');}catch(e){}}this.people.clear();this.bySock.clear();this.pending.clear();this.teacher=null;}
}
// Simple fixed-window limiter for session creation / join attempts per client address.
export class Limiter{constructor(max,windowMs){this.max=max;this.win=windowMs;this.m=new Map();}
  hit(key,now=Date.now()){let e=this.m.get(key);if(!e||now-e.t>this.win){e={t:now,n:0};this.m.set(key,e);}e.n++;if(this.m.size>10000)for(const [k,v] of this.m)if(now-v.t>this.win)this.m.delete(k);return e.n<=this.max;}}
export function originAllowed(origin,allowList){if(!allowList)return true;const list=allowList.split(',').map(s=>s.trim()).filter(Boolean);return !list.length||list.includes(origin);}

// Verify a Google Sign-In ID token (JWT, RS256) against Google's public keys. Returns {sub,name} or null.
let _jwks={keys:null,exp:0};
export async function verifyGoogleIdToken(tok,clientId,{now=Date.now(),certsUrl='https://www.googleapis.com/oauth2/v3/certs',fetcher=fetch}={}){
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
export function _resetJwksCache(){_jwks={keys:null,exp:0};}
