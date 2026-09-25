// Evaluates the handwriting recogniser that ships in ../../js/handwriting-core.js, using synthetic "writers" made from
// Hershey single-stroke fonts (real stroke order and pen lifts) plus per-writer style and per-sample natural variation.
// Usage: npm install && npm run eval
const fs=require('fs'),path=require('path');
const read=f=>fs.readFileSync(path.join(__dirname,'../../js',f),'utf8');
const H=new Function(read('handwriting-core.js')+'\nreturn HWCore;')();
const words=(read('handwriting.js').match(/words:'([a-z' ]+)'\}\);/)||[])[1].split(' ');
const fonts=require('hersheytext/hersheytext.json');
let seed=12345;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};const gauss=()=>{let u=0;while(!u)u=rnd();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*rnd());};
function glyph(font,ch){const g=fonts[font].chars[ch.charCodeAt(0)-33];if(!g||!g.d)return null;const out=[];let cur=null,mode=null;for(const t of g.d.replace(/([ML])/g,' $1 ').trim().split(/\s+/)){if(t==='M'||t==='L'){mode=t;continue;}const [x,y]=t.split(',').map(Number);if(mode==='M'){cur=[{x,y}];out.push(cur);mode='L';}else cur.push({x,y});}return out;}
const writer=(font,slant,xs,wob)=>({font,slant,xs,wob:wob||1});
function write(w,ch){const st=glyph(w.font,ch);if(!st)return null;const rot=gauss()*0.06,sc=1+gauss()*0.07,sh=w.slant+gauss()*0.05,xs=w.xs*(1+gauss()*0.05),fx=[rnd()*6,rnd()*6],amp=0.9*w.wob;
  return st.map(s=>{let pts=[];for(let i=1;i<s.length;i++){const a=s[i-1],b=s[i];const n=Math.max(1,Math.round(Math.hypot(b.x-a.x,b.y-a.y)/(0.4+rnd()*0.8)));for(let k=0;k<n;k++)pts.push({x:a.x+(b.x-a.x)*k/n,y:a.y+(b.y-a.y)*k/n});}pts.push(s[s.length-1]);
    if(rnd()<0.06)pts.reverse();if(pts.length>6&&rnd()<0.08)pts=pts.slice(0,Math.floor(pts.length*(0.85+rnd()*0.1)));
    return pts.map(p=>{let x=p.x+amp*Math.sin(p.y/5+fx[0])+gauss()*0.18,y=p.y+amp*Math.sin(p.x/5+fx[1])+gauss()*0.18;x=(x-sh*(y-22))*xs;const c=Math.cos(rot),s2=Math.sin(rot);return{x:(c*x-s2*y)*sc,y:(s2*x+c*y)*sc};});});}
function writeLine(w,text){let x=0;const out=[];for(const ch of text){if(ch===' '){x+=14+rnd()*6;continue;}const s=write(w,ch);const b=H.bbox(s),dy=(rnd()-0.5)*1.5,sh=x-b.x0;s.forEach(st=>out.push(st.map(p=>({x:p.x+sh,y:p.y+dy}))));x+=b.w+3+rnd()*3;}return out;}
const FRAME={base:22,xh:14},D='0123456789',U='ABCDEFGHIJKLMNOPQRSTUVWXYZ',L='abcdefghijklmnopqrstuvwxyz';
const calibrate=(w,chars,k)=>{const m=[];for(const ch of chars)for(let i=0;i<k;i++){const s=write(w,ch);if(s)m.push({ch,f:H.prep(s,FRAME)});}return m;};
function chars(m,w,set,n){let t=0,a=0,b=0;for(const ch of set)for(let i=0;i<n;i++){const c=H.classify(H.prep(write(w,ch),FRAME),m);t++;if(c[0].ch===ch)a++;if(c.slice(0,3).some(x=>x.ch===ch))b++;}return[a/t,b/t];}
const pct=x=>(100*x).toFixed(1)+'%';
const A=writer('futural',0.12,0.95),B=writer('scripts',0.05,1);
console.log('CHARACTERS (3 calibration examples each, 10 new test samples each)');
for(const [n,set] of [['digits',D],['capitals',U],['small letters',L],['all 62',D+U+L]]){const r=chars(calibrate(A,set,3),A,set,10);console.log('  '+n.padEnd(14),'top-1',pct(r[0]),' top-3',pct(r[1]));}
for(const k of [1,2,3,5]){const r=chars(calibrate(A,D+U+L,k),A,D+U+L,10);console.log('  all 62, '+k+' example'+(k>1?'s':' ')+'  top-1',pct(r[0]));}
console.log('PERSONAL vs SOMEONE ELSE\'S MODEL (small letters)');
console.log('  print writer, own model      ',pct(chars(calibrate(A,L,3),A,L,10)[0]));console.log('  script writer, print model   ',pct(chars(calibrate(A,L,3),B,L,10)[0]));console.log('  script writer, own model     ',pct(chars(calibrate(B,L,3),B,L,10)[0]));
const dict=H.buildDict(words),model=calibrate(A,D+U+L,3);let ok=0,raw=0,ms=0;const N=200;
for(let i=0;i<N;i++){const w=words[Math.floor(rnd()*words.length)];const s=writeLine(A,w);const t0=Date.now();const r=H.recognizeLine(s,model,{dict});ms+=Date.now()-t0;if(r.text.toLowerCase()===w)ok++;if(H.recognizeLine(s,model,{}).text.toLowerCase()===w)raw++;}
console.log('WORDS ('+N+' random dictionary words, print, 3 examples per character)');console.log('  letters only (ignoring case) ',pct(raw/N));console.log('  with dictionary              ',pct(ok/N),' ~'+Math.round(ms/N)+' ms/word');
const st=H.selfTest(model);console.log('SELF-TEST (leave-one-out)',pct(st.accuracy),'| pairs to practise:',st.pairs.slice(0,6).map(p=>p.pair.join('/')).join(' '));
