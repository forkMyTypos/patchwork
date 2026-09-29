// Cloudflare Worker + Durable Object wrapper around relay-core.mjs.
// One Durable Object per classroom code; classroom content lives in memory only.
// Teaching-mode connection log (D1): Google account ID + join/leave times, deleted after 90 days. No IPs, names or content.
import {Session,newCode,newSecret,sha256,validCode,Limiter,originAllowed,verifyGoogleIdToken} from './relay-core.mjs';
import {AiBoard,cleanCommand,aiCredentials,AI_LIMITS} from './ai-board.mjs';   // experimental AI board link
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
