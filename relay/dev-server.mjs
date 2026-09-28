// Local relay for development/testing (same core as the Cloudflare Worker). Needs: npm i ws
// Run: node relay/dev-server.mjs [port]   then set the classroom server to http://localhost:8787 in Patchwork.
import http from 'node:http';import {WebSocketServer} from 'ws';
import {Session,newCode,newSecret,sha256,validCode,Limiter} from './relay-core.mjs';
const sessions=new Map(),createLimit=new Limiter(10,60_000);const port=+process.argv[2]||8787;
const srv=http.createServer(async(req,res)=>{const h={'Access-Control-Allow-Origin':req.headers.origin||'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'content-type'};
  if(req.method==='OPTIONS'){res.writeHead(204,h);return res.end();}
  if(req.url==='/api/session'&&req.method==='POST'){if(!createLimit.hit(req.socket.remoteAddress)){res.writeHead(429,h);return res.end();}
    const code=newCode(),secret=newSecret();sessions.set(code,new Session(code,await sha256(secret)));res.writeHead(200,{...h,'content-type':'application/json'});return res.end(JSON.stringify({code,secret}));}
  res.writeHead(404,h);res.end();});
const wss=new WebSocketServer({noServer:true,maxPayload:1_700_000});
srv.on('upgrade',(req,sock,head)=>{const code=new URL(req.url,'http://x').searchParams.get('code');const s=validCode(code)&&sessions.get(code);
  if(!s||s.expired()){sock.write('HTTP/1.1 404 Not Found\r\n\r\n');sock.destroy();return;}
  wss.handleUpgrade(req,sock,head,ws=>{const so={send:x=>ws.send(x),close:(c,r)=>{try{ws.close(c,r);}catch(e){}}};s.open(so);
    ws.on('message',(d,isBin)=>s.message(so,isBin?null:d.toString()));ws.on('close',()=>s.drop(so));});});
setInterval(()=>{for(const [c,s] of sessions){s.sweep();if(s.ended)sessions.delete(c);}},5000).unref();
srv.listen(port,()=>console.log('classroom relay on http://localhost:'+port));
