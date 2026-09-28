// Cloudflare Worker + Durable Object wrapper around relay-core.mjs.
// One Durable Object per classroom code. State lives in memory only (nothing is written to storage).
import {Session,LIMITS,newCode,newSecret,sha256,validCode,Limiter,originAllowed} from './relay-core.mjs';
const createLimit=new Limiter(10,60_000),joinLimit=new Limiter(60,60_000);
function cors(env,origin){return{'Access-Control-Allow-Origin':originAllowed(origin,env.ALLOWED_ORIGINS)?(origin||'*'):'null','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type','Vary':'Origin'};}
export default{
  async fetch(req,env){const url=new URL(req.url),origin=req.headers.get('Origin')||'',ip=req.headers.get('CF-Connecting-IP')||'?';
    if(req.method==='OPTIONS')return new Response(null,{headers:cors(env,origin)});
    if(!originAllowed(origin,env.ALLOWED_ORIGINS))return new Response('origin not allowed',{status:403});
    if(url.pathname==='/api/session'&&req.method==='POST'){
      if(!createLimit.hit(ip))return new Response('slow down',{status:429,headers:cors(env,origin)});
      const code=newCode(),secret=newSecret();const stub=env.CLASSROOM.get(env.CLASSROOM.idFromName(code));
      const r=await stub.fetch('https://do/init',{method:'POST',body:JSON.stringify({code,secretHash:await sha256(secret)})});
      if(!r.ok)return new Response('try again',{status:503,headers:cors(env,origin)});
      return new Response(JSON.stringify({code,secret}),{headers:{'content-type':'application/json','cache-control':'no-store',...cors(env,origin)}});}
    if(url.pathname==='/api/ws'){const code=url.searchParams.get('code');
      if(req.headers.get('Upgrade')!=='websocket')return new Response('expected websocket',{status:426});
      if(!validCode(code))return new Response('bad code',{status:400});
      if(!joinLimit.hit(ip))return new Response('slow down',{status:429});
      return env.CLASSROOM.get(env.CLASSROOM.idFromName(code)).fetch(req);}
    return new Response('Patchwork classroom relay',{status:404});}
};
export class Classroom{
  constructor(state,env){this.ctx=state;this.session=null;}
  async fetch(req){const url=new URL(req.url);
    if(url.pathname==='/init'){if(this.session&&!this.session.expired())return new Response('exists',{status:409});const {code,secretHash}=await req.json();this.session=new Session(code,secretHash);await this.ctx.storage.setAlarm(Date.now()+60_000);return new Response('ok');}
    if(!this.session||this.session.expired())return new Response('no such classroom',{status:404});
    const pair=new WebSocketPair();const [client,server]=Object.values(pair);server.accept();const s=this.session;
    const sock={send:x=>server.send(x),close:(c,r)=>{try{server.close(c,r);}catch(e){}}};s.open(sock);
    server.addEventListener('message',ev=>{s.message(sock,typeof ev.data==='string'?ev.data:null);});
    server.addEventListener('close',()=>s.drop(sock));server.addEventListener('error',()=>s.drop(sock));
    return new Response(null,{status:101,webSocket:client});}
  async alarm(){if(!this.session)return;this.session.sweep();if(this.session.ended){this.session=null;return;}await this.ctx.storage.setAlarm(Date.now()+60_000);}
}
