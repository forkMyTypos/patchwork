// Patchwork classroom relay core (transport-agnostic; used by the Cloudflare Worker and the local dev server).
// The relay is deliberately dumb: it forwards what the TEACHER connection sends to STUDENT connections.
// It never receives student work (students may only say hello/ping) and keeps state in memory only.
export const LIMITS={
  maxMsgBytes:1_600_000,   // one teacher snapshot
  maxStudents:100,
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

// A socket here is anything with send(string) and close(code, reason).
export class Session{
  constructor(code,secretHash,now=Date.now()){this.code=code;this.secretHash=secretHash;this.teacher=null;this.students=new Set();this.pending=new Map();
    this.state=null;this.seq=0;this.created=now;this.lastTeacher=now;this.ended=false;this.tokens=LIMITS.teacherBurst;this.tokT=now;}
  expired(now=Date.now()){return this.ended||now-this.lastTeacher>LIMITS.idleMs||now-this.created>LIMITS.maxLifeMs;}
  open(sock,now=Date.now()){if(this.ended){sock.close(4404,'ended');return;}this.pending.set(sock,now);}
  // role is decided HERE from the secret, never from what a client claims
  async message(sock,raw,now=Date.now()){
    if(this.ended){sock.close(4404,'ended');return;}
    if(typeof raw!=='string'||raw.length>LIMITS.maxMsgBytes){sock.close(1009,'too big');this.drop(sock);return;}
    let m;try{m=JSON.parse(raw);}catch(e){sock.close(1007,'bad json');this.drop(sock);return;}
    if(!m||typeof m!=='object'||typeof m.t!=='string'){sock.close(1008,'bad message');this.drop(sock);return;}
    if(this.pending.has(sock)){
      if(m.t!=='hello'){sock.close(1008,'hello first');this.drop(sock);return;}
      this.pending.delete(sock);
      if(typeof m.secret==='string'&&m.secret.length===64){
        if(!safeEq(await sha256(m.secret),this.secretHash)){sock.close(4403,'not the teacher');return;}
        if(this.teacher&&this.teacher!==sock)try{this.teacher.close(4409,'replaced');}catch(e){}
        this.teacher=sock;this.lastTeacher=now;sock.send(JSON.stringify({t:'welcome',role:'teacher',students:this.students.size}));this.toStudents({t:'teacher',online:true});return;}
      if(this.students.size>=LIMITS.maxStudents){sock.close(4429,'class full');return;}
      this.students.add(sock);sock.send(JSON.stringify({t:'welcome',role:'student',teacher:!!this.teacher}));
      if(this.state)sock.send(this.state);this.count();return;}
    if(sock===this.teacher){this.lastTeacher=now;
      // rate limit (token bucket)
      this.tokens=Math.min(LIMITS.teacherBurst,this.tokens+(now-this.tokT)/1000*LIMITS.teacherPerSec);this.tokT=now;
      if(m.t==='ping'){sock.send('{"t":"pong"}');return;}
      if(this.tokens<1){sock.send('{"t":"slow"}');return;}this.tokens-=1;
      if(m.t==='state'){if(!m.body||typeof m.body!=='object'){sock.send('{"t":"rejected"}');return;}
        this.seq++;this.state=JSON.stringify({t:'state',seq:this.seq,body:m.body});this.toStudents(this.state,true);return;}
      if(m.t==='clear'){this.state=null;this.seq++;this.toStudents({t:'clear',seq:this.seq});return;}
      if(m.t==='end'){this.end();return;}
      return;}
    if(this.students.has(sock)){
      // students can't send anything but a keep-alive: there is no path for student data to reach anyone
      if(m.t==='ping'){sock.send('{"t":"pong"}');return;}
      sock.close(1008,'students cannot send');this.drop(sock);return;}
    sock.close(1008,'unknown connection');}
  toStudents(msg,raw){const s=raw?msg:JSON.stringify(msg);for(const st of this.students){try{st.send(s);}catch(e){this.drop(st);}}}
  count(){if(this.teacher)try{this.teacher.send(JSON.stringify({t:'count',students:this.students.size}));}catch(e){}}
  drop(sock){this.pending.delete(sock);if(this.students.delete(sock))this.count();if(sock===this.teacher){this.teacher=null;this.toStudents({t:'teacher',online:false});}}
  sweep(now=Date.now()){for(const [s,t] of this.pending)if(now-t>LIMITS.helloMs){try{s.close(1008,'no hello');}catch(e){}this.pending.delete(s);}if(this.expired(now)&&!this.ended)this.end();}
  end(){this.ended=true;this.state=null;const all=[...this.students,...(this.teacher?[this.teacher]:[]),...this.pending.keys()];for(const s of all){try{s.send('{"t":"ended"}');s.close(4404,'ended');}catch(e){}}this.students.clear();this.pending.clear();this.teacher=null;}
}
// Simple fixed-window limiter for session creation / join attempts per client address.
export class Limiter{constructor(max,windowMs){this.max=max;this.win=windowMs;this.m=new Map();}
  hit(key,now=Date.now()){let e=this.m.get(key);if(!e||now-e.t>this.win){e={t:now,n:0};this.m.set(key,e);}e.n++;if(this.m.size>10000)for(const [k,v] of this.m)if(now-v.t>this.win)this.m.delete(k);return e.n<=this.max;}}
export function originAllowed(origin,allowList){if(!allowList)return true;const list=allowList.split(',').map(s=>s.trim()).filter(Boolean);return !list.length||list.includes(origin);}
