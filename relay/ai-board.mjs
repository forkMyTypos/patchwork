// AI board link (EXPERIMENTAL). Lets an external client send one of a tiny, fixed set of commands to ONE open
// Patchwork board. Transport-agnostic; used by the Cloudflare Worker (inside the Classroom Durable Object class,
// as a separate "ai:<boardId>" instance) and by the local dev server.
// - A board link exists only while its owner has it switched on in Patchwork. Creating one needs Google sign-in.
// - Two secrets: the owner's (browser <-> relay) and the key the owner gives the AI (external client -> relay).
//   The relay keeps only their SHA-256 hashes, in memory.
// - Commands are {action, text} with action in AI_ACTIONS; the browser decides how they become board objects.
// - Nothing is stored: no board contents, no command history. The browser only ever sends hello and ack.
import {sha256} from './relay-core.mjs';

export const AI_ACTIONS=['createQuestion','createAnswer','createNote'];
export const AI_LIMITS={text:2000,body:8000,msg:1000,perMin:30,ackMs:8000,idleMs:10*60_000};

function aiSafeEq(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}

// {action,text} from an untrusted request body, or {error}
export function cleanCommand(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return{error:'body must be a JSON object'};
  if(!AI_ACTIONS.includes(body.action))return{error:'unsupported action (use '+AI_ACTIONS.join(', ')+')'};
  if(typeof body.text!=='string')return{error:'text must be a string'};
  const text=body.text.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,' ').replace(/\s+/g,' ').trim();
  if(!text)return{error:'text is empty'};
  if(text.length>AI_LIMITS.text)return{error:'text is longer than '+AI_LIMITS.text+' characters'};
  return{action:body.action,text};
}

export class AiBoard{
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
export async function aiCredentials(newCode,newSecret){const boardId=newCode(),secret=newSecret(),key=newSecret();
  return{boardId,secret,key,ownerHash:await sha256(secret),keyHash:await sha256(key)};}
