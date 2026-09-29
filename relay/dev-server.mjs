// Local relay for development/testing (same core as the Cloudflare Worker). Needs: npm i ws
// Run: node relay/dev-server.mjs [port]   then set the classroom server to http://localhost:8787 in Patchwork.
// DEV ONLY: sign-in is simulated with tokens like "dev:<userId>:<name>", and the connection log is kept in memory
// (GET /dev/log shows it). The Cloudflare Worker never accepts dev tokens.
import http from 'node:http';import {WebSocketServer} from 'ws';
import {Session,newCode,newSecret,sha256,validCode,Limiter,cleanName} from './relay-core.mjs';
const sessions=new Map(),createLimit=new Limiter(10,60_000);const port=+process.argv[2]||8787;
const devVerify=async t=>{const m=/^dev:(\d{1,21}):(.{0,40})$/.exec(t||'');return m?{sub:m[1],name:cleanName(m[2])}:null;};
const LOG={sessions:[],participants:[]};let rowId=0;
const log={join:(sid,uid,role)=>{const r={id:++rowId,session_id:sid,user_id:uid,role,joined_at:Date.now(),left_at:null};LOG.participants.push(r);return r.id;},
  leave:id=>{const r=LOG.participants.find(x=>x.id===id);if(r&&!r.left_at)r.left_at=Date.now();},end:sid=>{const s=LOG.sessions.find(x=>x.id===sid);if(s&&!s.ended_at)s.ended_at=Date.now();}};
const srv=http.createServer(async(req,res)=>{const h={'Access-Control-Allow-Origin':req.headers.origin||'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'content-type, authorization'};
  if(req.method==='OPTIONS'){res.writeHead(204,h);return res.end();}
  if(req.url==='/api/config'){res.writeHead(200,{...h,'content-type':'application/json'});return res.end(JSON.stringify({googleClientId:'',devAuth:true}));}
  if(req.url==='/dev/log'){res.writeHead(200,{...h,'content-type':'application/json'});return res.end(JSON.stringify(LOG));}
  if(req.url==='/api/session'&&req.method==='POST'){if(!createLimit.hit(req.socket.remoteAddress)){res.writeHead(429,h);return res.end();}
    const who=await devVerify((req.headers.authorization||'').replace(/^Bearer\s+/,''));if(!who){res.writeHead(401,h);return res.end('sign in');}
    const code=newCode(),secret=newSecret(),sessionId=crypto.randomUUID();LOG.sessions.push({id:sessionId,teacher_id:who.sub,started_at:Date.now(),ended_at:null});
    sessions.set(code,new Session(code,await sha256(secret),Date.now(),{sessionId,teacherId:who.sub,hooks:{verify:devVerify,log}}));
    res.writeHead(200,{...h,'content-type':'application/json'});return res.end(JSON.stringify({code,secret}));}
  res.writeHead(404,h);res.end();});
const wss=new WebSocketServer({noServer:true,maxPayload:7_200_000});
srv.on('upgrade',(req,sock,head)=>{const code=new URL(req.url,'http://x').searchParams.get('code');const s=validCode(code)&&sessions.get(code);
  if(!s||s.expired()){sock.write('HTTP/1.1 404 Not Found\r\n\r\n');sock.destroy();return;}
  wss.handleUpgrade(req,sock,head,ws=>{const so={send:x=>ws.send(x),close:(c,r)=>{try{ws.close(c,r);}catch(e){}}};s.open(so);
    ws.on('message',(d,isBin)=>s.message(so,isBin?null:d.toString()));ws.on('close',()=>s.drop(so));});});
setInterval(()=>{for(const [c,s] of sessions){s.sweep();if(s.ended)sessions.delete(c);}},5000).unref();
srv.listen(port,()=>console.log('classroom relay (dev) on http://localhost:'+port));
