// Cloudflare Worker + Durable Object wrapper around relay-core.mjs.
// One Durable Object per classroom code; classroom content lives in memory only.
// Teaching-mode connection log (D1): Google account ID + join/leave times, deleted after 90 days. No IPs, names or content.
import {Session,newCode,newSecret,sha256,validCode,Limiter,originAllowed,verifyGoogleIdToken} from './relay-core.mjs';
const createLimit=new Limiter(10,60_000),joinLimit=new Limiter(60,60_000);
const RETENTION_MS=90*24*3600_000;
function cors(env,origin){return{'Access-Control-Allow-Origin':originAllowed(origin,env.ALLOWED_ORIGINS)?(origin||'*'):'null','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'content-type, authorization','Vary':'Origin'};}
const json=(o,h,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json','cache-control':'no-store',...h}});
export default{
  async fetch(req,env){const url=new URL(req.url),origin=req.headers.get('Origin')||'',ip=req.headers.get('CF-Connecting-IP')||'';
    if(req.method==='OPTIONS')return new Response(null,{headers:cors(env,origin)});
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
  constructor(state,env){this.ctx=state;this.env=env;this.session=null;}
  async fetch(req){const url=new URL(req.url),env=this.env;
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
  async alarm(){if(!this.session)return;this.session.sweep();if(this.session.ended){this.session=null;return;}await this.ctx.storage.setAlarm(Date.now()+60_000);}
}
