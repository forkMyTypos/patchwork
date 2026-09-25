"use strict";
/* ===== Handwriting: language modules =====
   Each language is a separate module (character sets, dictionary, case folding, hints). The core above knows nothing
   about any language. Thai / Japanese / Korean modules can be registered later without touching the core. */
const HW_MODULES=new Map();
function registerHandwritingModule(m){HW_MODULES.set(m.id,m);}
registerHandwritingModule({id:'en',name:'English',
  sets:[{id:'digits',label:'Numbers',chars:'0123456789'},{id:'upper',label:'Capitals',chars:'ABCDEFGHIJKLMNOPQRSTUVWXYZ'},{id:'lower',label:'Small letters',chars:'abcdefghijklmnopqrstuvwxyz'}],
  fold:c=>c.toLowerCase(),wordRe:/[A-Za-z0-9']+/g,
  // a small built-in word list; your own Patchwork pages and corrections are added as a personal dictionary
  words:'a i about above across act action add after again against age ago agree ahead air all allow almost alone along already also always am among an and animal another answer any anyone anything api app appear apple are area arm around arrive art as ask at away baby back bad bag ball bank bar base be bear beat beautiful because become bed been before begin behind being believe below best better between big bill bird bit black blue board boat body book born both bottom box boy break bring brother brown bug build building busy but buy by call came can car card care carry case cat catch cause center certain chair chance change check child children city class clean clear close cold color come common company complete computer cool copy corner cost could count country course cover cross cup cut dark data date day dead deal dear decide deep design desk did die different dinner do doctor does dog done door down draw dream drink drive drop dry during each early earth easy eat edge egg eight either else end enough enter even evening ever every example eye face fact fall family far farm fast father feel feet few field fight fill final find fine finish fire first fish five fix floor fly follow food foot for force form four free friend from front full fun game garden gave get girl give glass go going gold gone good got great green ground group grow guess had hair half hand happen happy hard has hat have he head hear heart heavy held hello help her here high hill him his hit hold home hope horse hot hour house how however huge human hundred idea if important in inside into is it its job join just keep key kind king know land language large last late later laugh law lay lead learn least leave left leg less let letter level life light like line list listen little live login long look lose lot love low made main make man many map mark market matter may me mean meet member men middle might mile milk mind minute miss moment money month moon more morning most mother move much music must my name near need never new news next nice night nine no nor north not note nothing notice now number of off office often oh old on once one only open or order other our out over own page paper part party pass past pay people perhaps person pick picture piece place plan plant play please point poor possible power press pretty problem pull push put question quick quiet quite rain ran reach read ready real reason red remember rest rice right river road rock room round rule run said same sat save saw say school sea second see seem self sell send sentence serve set seven several shall shape she ship short should show side sign simple since sing sister sit six size sleep slow small smile snow so some something sometimes son song soon sound south space speak special spell spring stand star start state stay step still stop story street strong student study such summer sun sure table take talk tall task teach teacher team tell ten test than thank that the their them then there these they thing think third this those though thought three through time to today together told tomorrow too took top toward town tree true try turn two type under understand until up upon us use usual very voice wait walk wall want war warm was watch water way we wear weather week well went were west what when where which while white who whole why wide will wind window winter wish with without woman women wonder word work world would write wrong yard year yes yet you young your'});

/* ===== Handwriting: the personal model (db.hw, never leaves the device) ===== */
const HWS={lang:'en',samples:[],model:[],learn:true,personal:new Set(),dict:null};
function hwModule(){return HW_MODULES.get(HWS.lang)||HW_MODULES.get('en');}
async function hwLoad(){try{const inf=await db.info.get('info');HWS.learn=!(inf&&inf.hwLearn===false);if(inf&&inf.hwLang&&HW_MODULES.has(inf.hwLang))HWS.lang=inf.hwLang;(inf&&inf.hwWords||[]).forEach(w=>HWS.personal.add(w));
  HWS.samples=await db.hw.where('lang').equals(HWS.lang).toArray();}catch(e){console.error(e);HWS.samples=[];}hwRebuild();}
function hwRebuild(){HWS.model=HWS.samples.map(s=>({id:s.id,ch:s.ch,f:s._f||(s._f=HWCore.prep(s.strokes,s.frame)),s})).filter(x=>x.f);}
async function hwAddSample(ch,strokes,frame,src){const rec={lang:HWS.lang,ch,strokes:strokes.map(s=>s.map(p=>({x:+(+p.x).toFixed(2),y:+(+p.y).toFixed(2),p:p.p!=null?+(+p.p).toFixed(2):undefined,t:p.t}))),frame:frame||null,src:src||'lab',created:Date.now()};
  try{rec.id=await db.hw.add(rec);}catch(e){_quotaToast(e);return null;}HWS.samples.push(rec);hwRebuild();return rec;}
async function hwDeleteSample(id){await db.hw.delete(id);HWS.samples=HWS.samples.filter(s=>s.id!==id);hwRebuild();}
async function hwDict(){if(HWS.dict)return HWS.dict;const m=hwModule();const words=String(m.words).split(/\s+/);
  // personal dictionary: every word you have typed in Patchwork, plus words you taught it
  try{const pgs=await db.pages.toArray();const div=document.createElement('div');for(const pg of pgs){div.innerHTML=DOMPurify.sanitize(pg.html||'');(div.textContent.match(m.wordRe)||[]).forEach(w=>HWS.personal.add(w));}}catch(e){}
  HWS.dict=HWCore.buildDict(words.concat([...HWS.personal]),m.fold);return HWS.dict;}
function hwCounts(){const c={};HWS.samples.forEach(s=>c[s.ch]=(c[s.ch]||0)+1);return c;}

/* ===== Handwriting Lab ===== */
let HL=null;
function hwPad(canvas,kind){const pad={canvas,kind,strokes:[],active:null,onStroke:null,locked:false,marks:[]};const ctx=canvas.getContext('2d');
  pad.size=()=>{const r=canvas.getBoundingClientRect();const dpr=Math.max(1,Math.min(3,window.devicePixelRatio||1));if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);pad.W=r.width;pad.H=r.height;};
  // writing guides: cap line, x-height line, baseline (the frame lets size tell o from O, l from 1)
  pad.frame=()=>kind==='char'?{base:pad.H*0.72,xh:pad.H*0.3}:{base:pad.H*0.7,xh:pad.H*0.22};
  pad.draw=()=>{pad.size();ctx.clearRect(0,0,pad.W,pad.H);const f=pad.frame();ctx.lineWidth=1;
    const line=(y,c,dash)=>{ctx.strokeStyle=c;ctx.setLineDash(dash||[]);ctx.beginPath();ctx.moveTo(8,y);ctx.lineTo(pad.W-8,y);ctx.stroke();ctx.setLineDash([]);};
    line(f.base-f.xh*(kind==='char'?1.8:1.9),'rgba(255,255,255,.06)',[3,5]);line(f.base-f.xh,'rgba(255,255,255,.09)',[4,4]);line(f.base,'rgba(251,191,36,.35)');
    for(const m of pad.marks){ctx.strokeStyle=m.c||'rgba(129,140,248,.8)';ctx.fillStyle=m.c||'rgba(129,140,248,.9)';ctx.lineWidth=1.2;ctx.setLineDash([3,3]);ctx.strokeRect(m.x0-3,m.y0-3,m.x1-m.x0+6,m.y1-m.y0+6);ctx.setLineDash([]);ctx.font='600 12px Arial';ctx.fillText(m.label,m.x0-2,m.y0-7);}
    ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#ece6da';
    for(const s of pad.strokes.concat(pad.active?[pad.active]:[])){if(s.length===1){ctx.beginPath();ctx.arc(s[0].x,s[0].y,1.6,0,7);ctx.fillStyle='#ece6da';ctx.fill();continue;}for(let i=1;i<s.length;i++){ctx.lineWidth=1.2+2.2*((s[i].p!=null?s[i].p:.5));ctx.beginPath();ctx.moveTo(s[i-1].x,s[i-1].y);ctx.lineTo(s[i].x,s[i].y);ctx.stroke();}}};
  let t0=0;const pt=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top,p:(e.pressure>0&&e.pressure<1)?e.pressure:.5,t:Math.round(performance.now()-t0)};};
  canvas.addEventListener('pointerdown',e=>{if(pad.locked)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);if(!pad.strokes.length&&!pad.active)t0=performance.now();pad.active=[pt(e)];pad.marks=[];pad.draw();if(pad.onDown)pad.onDown();});
  canvas.addEventListener('pointermove',e=>{if(!pad.active)return;e.preventDefault();const q=pt(e),l=pad.active[pad.active.length-1];if(Math.hypot(q.x-l.x,q.y-l.y)<0.8)return;pad.active.push(q);pad.draw();});
  const up=()=>{if(!pad.active)return;pad.strokes.push(pad.active);pad.active=null;pad.draw();if(pad.onStroke)pad.onStroke();};canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
  pad.clear=()=>{pad.strokes=[];pad.active=null;pad.marks=[];pad.locked=false;pad.draw();};
  pad.undo=()=>{pad.strokes.pop();pad.marks=[];pad.draw();if(pad.onStroke)pad.onStroke();};
  // show strokes from elsewhere (the page), fitted onto the pad's writing line
  pad.load=(strokes)=>{pad.size();const b=HWCore.bbox(strokes);const f=pad.frame();const sc=Math.min((pad.W-40)/Math.max(1e-6,b.w),(f.xh*2.6)/Math.max(1e-6,b.h));const ox=20-b.x0*sc,oy=(f.base-f.xh*1.8)-b.y0*sc;
    pad.strokes=strokes.map(s=>s.map(p=>({x:p.x*sc+ox,y:p.y*sc+oy,p:p.p!=null?p.p:.5})));pad.marks=[];pad.draw();};
  return pad;}
function hwThumb(cv,strokes,o){o=o||{};const dpr=Math.max(1,Math.min(3,window.devicePixelRatio||1)),w=cv.clientWidth||cv.width,h=cv.clientHeight||cv.height;cv.width=w*dpr;cv.height=h*dpr;const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);if(!strokes||!strokes.length)return;
  const b=HWCore.bbox(strokes);const sc=Math.min((w-8)/Math.max(1e-6,b.w),(h-8)/Math.max(1e-6,b.h));const ox=(w-b.w*sc)/2-b.x0*sc,oy=(h-b.h*sc)/2-b.y0*sc;c.lineCap='round';c.lineJoin='round';c.strokeStyle=o.color||'#d8d0bf';c.lineWidth=o.width||1.6;
  for(const s of strokes){c.beginPath();s.forEach((p,i)=>{const x=p.x*sc+ox,y=p.y*sc+oy;if(i)c.lineTo(x,y);else c.moveTo(x,y);});if(s.length===1){c.arc(s[0].x*sc+ox,s[0].y*sc+oy,1,0,7);}c.stroke();}}
// what the recogniser actually compares: resampled, centred, scaled points in writing order
function hwDrawNorm(cv,f){const dpr=Math.max(1,Math.min(3,window.devicePixelRatio||1)),w=cv.clientWidth,h=cv.clientHeight;cv.width=w*dpr;cv.height=h*dpr;const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);
  const S=Math.min(w,h)*0.8,X=x=>w/2+x*S,Y=y=>h/2+y*S;c.strokeStyle='rgba(255,255,255,.08)';c.strokeRect(X(-.5),Y(-.5),S,S);if(!f)return;const P=f.pts;
  for(let i=0;i<P.length;i++){const p=P[i],hue=30+260*i/Math.max(1,P.length-1);c.strokeStyle='hsl('+hue+',80%,62%)';c.fillStyle=c.strokeStyle;
    if(i&&!p.s){c.lineWidth=2;c.beginPath();c.moveTo(X(P[i-1].x),Y(P[i-1].y));c.lineTo(X(p.x),Y(p.y));c.stroke();}
    c.beginPath();c.arc(X(p.x),Y(p.y),p.s?4.5:1.8,0,7);if(p.s){c.lineWidth=1.5;c.stroke();}else c.fill();
    c.globalAlpha=.5;c.lineWidth=1;c.beginPath();c.moveTo(X(p.x),Y(p.y));c.lineTo(X(p.x)+p.dx*7,Y(p.y)+p.dy*7);c.stroke();c.globalAlpha=1;}}
function ensureLab(){if(HL)return HL;const el=document.createElement('div');el.id='hwlab';el.style.display='none';
  el.innerHTML='<div class="hw-bar"><div class="tl-title"><span class="hw-ic">✍</span><b>Handwriting Lab</b><span class="hw-sub">learns <i>your</i> handwriting · works offline · samples stay on this device</span></div><div class="hw-tabs"></div><select class="fx-sel hw-lang" title="Language module"></select><button class="panel-x" title="Close (Esc)">×</button></div><div class="hw-body"></div>';
  document.body.appendChild(el);HL={el,body:el.querySelector('.hw-body'),tab:'char'};
  const tabs=el.querySelector('.hw-tabs');[['cal','Calibrate'],['char','Character'],['word','Words'],['model','My handwriting']].forEach(([k,l])=>{const b=document.createElement('button');b.className='sp-f';b.dataset.k=k;b.textContent=l;b.onclick=()=>hwTab(k);tabs.appendChild(b);});
  const ls=el.querySelector('.hw-lang');for(const m of HW_MODULES.values()){const o=document.createElement('option');o.value=m.id;o.textContent=m.name;ls.appendChild(o);}ls.onchange=async()=>{HWS.lang=ls.value;HWS.dict=null;db.info.update('info',{hwLang:HWS.lang}).catch(()=>{});await hwLoad();hwTab(HL.tab);};
  el.querySelector('.panel-x').onclick=closeLab;
  addEventListener('keydown',e=>{if(e.key==='Escape'&&HL&&HL.el.style.display!=='none'){e.preventDefault();e.stopPropagation();closeLab();}},true);
  addEventListener('resize',()=>{if(HL&&HL.el.style.display!=='none'&&HL.pad)HL.pad.draw();});
  return HL;}
async function openLab(tab,payload){ensureLab();HL.el.style.display='flex';HL.el.querySelector('.hw-lang').value=HWS.lang;await hwLoad();hwTab(tab||(HWS.samples.length?'char':'cal'),payload);}
function closeLab(){if(HL){HL.el.style.display='none';clearTimeout(HL.calT);}}
function hwTab(k,payload){HL.tab=k;clearTimeout(HL.calT);HL.el.querySelectorAll('.hw-tabs .sp-f').forEach(b=>b.classList.toggle('on',b.dataset.k===k));HL.body.innerHTML='';HL.pad=null;({cal:hwCalSetup,char:hwCharTab,word:hwWordTab,model:hwModelTab})[k](payload);}
function hwEmptyModelNote(){return HWS.samples.length?'':'<div class="hw-note">Patchwork doesn’t know your handwriting yet. <button class="fx-link" data-go="cal">Calibrate first</button> — or draw here and save characters one by one.</div>';}
function hwWire(root){root.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>hwTab(b.dataset.go));}

/* --- Character tab: draw, inspect, normalise, compare, save --- */
function hwCharTab(){const b=HL.body;b.innerHTML=hwEmptyModelNote()+'<div class="hw-grid3"><div class="hw-col"><div class="hw-h">Draw one character</div><canvas class="hw-pad char"></canvas><div class="hw-row"><button class="pbtn hw-undo">Undo stroke</button><button class="pbtn hw-clear">Clear</button></div>'+
  '<div class="hw-row hw-save"><span>This is</span><input class="pf-in hw-ch" maxlength="1" placeholder="a"><button class="fx-primary hw-savebtn">Save as example</button></div><div class="hw-hint">Saved examples become your personal model. Several per character is best.</div></div>'+
  '<div class="hw-col"><div class="hw-h">What the recogniser sees</div><canvas class="hw-norm"></canvas><div class="hw-legend">resampled points in writing order (warm → cool) · rings = pen down · ticks = direction</div><div class="hw-stats"></div></div>'+
  '<div class="hw-col"><div class="hw-h">Matches</div><div class="hw-best"></div><div class="hw-matches"></div><div class="hw-h small">Closest saved example</div><canvas class="hw-near"></canvas></div></div>';hwWire(b);
  const pad=HL.pad=hwPad(b.querySelector('.hw-pad'),'char');pad.draw();const chIn=b.querySelector('.hw-ch');
  const run=()=>{const f=pad.strokes.length?HWCore.prep(pad.strokes,pad.frame()):null;hwDrawNorm(b.querySelector('.hw-norm'),f);
    // raw stroke inspector
    const st=b.querySelector('.hw-stats');if(!pad.strokes.length){st.innerHTML='';b.querySelector('.hw-matches').innerHTML='';b.querySelector('.hw-best').innerHTML='';hwThumb(b.querySelector('.hw-near'),null);return;}
    const len=s=>s.reduce((a,p,i)=>i?a+Math.hypot(p.x-s[i-1].x,p.y-s[i-1].y):0,0);const ps=pad.strokes.flat().map(p=>p.p);const dur=(pad.strokes[pad.strokes.length-1].slice(-1)[0].t||0);const bb=HWCore.bbox(pad.strokes);
    st.innerHTML='<table>'+[['strokes (pen lifts)',pad.strokes.length],['points per stroke',pad.strokes.map(s=>s.length).join(' · ')],['stroke length (px)',pad.strokes.map(s=>Math.round(len(s))).join(' · ')],['time',dur+' ms'],['pressure',Math.min(...ps).toFixed(2)+' – '+Math.max(...ps).toFixed(2)],['box',Math.round(bb.w)+' × '+Math.round(bb.h)+' px'],['aspect (log w/h)',f.aspect.toFixed(2)],['vs. writing line',f.frame?'top '+f.frame.top.toFixed(2)+' · bottom '+f.frame.bot.toFixed(2)+' x-heights':'—'],['normalised points',f.pts.length]].map(r=>'<tr><td>'+r[0]+'</td><td>'+esc(String(r[1]))+'</td></tr>').join('')+'</table>';
    const c=HWCore.classify(f,HWS.model);const mt=b.querySelector('.hw-matches'),best=b.querySelector('.hw-best');
    if(!c.length){mt.innerHTML='<div class="hw-hint">No saved examples to compare with yet.</div>';best.innerHTML='';hwThumb(b.querySelector('.hw-near'),null);return;}
    const tier=c.confidence>0.6?['high','Confident']:c.confidence>0.25?['mid','Not sure']:['low','Patchwork isn’t confident about this'];
    best.innerHTML='<span class="hw-bigch">'+esc(c[0].ch)+'</span><span class="hw-tier '+tier[0]+'">'+tier[1]+' · '+Math.round(c.confidence*100)+'%</span>';
    mt.innerHTML=c.slice(0,8).map(x=>'<div class="hw-m"><span class="hw-mch">'+esc(x.ch)+'</span><span class="hw-mbar"><i style="width:'+Math.round(x.sim*100)+'%"></i></span><span class="hw-mpc">'+Math.round(x.sim*100)+'%</span><span class="hw-mn">'+x.samples+'×</span></div>').join('');
    hwThumb(b.querySelector('.hw-near'),c[0].best.s.strokes);if(!chIn.value)chIn.placeholder=c[0].ch;};
  let rt=null;pad.onStroke=()=>{clearTimeout(rt);rt=setTimeout(run,120);};
  b.querySelector('.hw-undo').onclick=()=>pad.undo();b.querySelector('.hw-clear').onclick=()=>{pad.clear();run();};
  const save=async()=>{const ch=(chIn.value||'').trim();if(!pad.strokes.length){toast('Draw a character first','info');return;}if(!ch){toast('Type which character it is','info');chIn.focus();return;}
    await hwAddSample(ch,pad.strokes,pad.frame(),'lab');toast('Saved as “'+ch+'” ('+(hwCounts()[ch]||1)+' example'+((hwCounts()[ch]||1)>1?'s':'')+')','ok');chIn.value='';pad.clear();run();};
  b.querySelector('.hw-savebtn').onclick=save;chIn.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();save();}};run();}

/* --- Calibration: natural writing, several samples each, targeted practice --- */
function hwCalSetup(payload){if(payload&&payload.queue)return hwCalRun(payload.queue,payload.title);const m=hwModule();const cnt=hwCounts();const b=HL.body;
  b.innerHTML='<div class="hw-cal-setup"><div class="hw-h">Handwriting calibration — '+esc(m.name)+'</div><p class="hw-p">Patchwork will show one character at a time. <b>Write it naturally, exactly as you normally write it</b> — not like a font. Writing each one a few times teaches Patchwork how <i>your</i> letters vary.</p><div class="hw-sets"></div>'+
  '<div class="hw-row"><span>Examples of each</span><select class="fx-sel hw-k">'+[1,2,3,4,5].map(n=>'<option'+(n===3?' selected':'')+'>'+n+'</option>').join('')+'</select></div><div class="hw-row"><button class="fx-primary hw-go">Start</button><span class="hw-hint">Only characters that still need examples are asked for. Writing pauses for a second? That counts as done.</span></div></div>';
  const sets=b.querySelector('.hw-sets');m.sets.forEach((s,i)=>{const have=[...s.chars].reduce((a,ch)=>a+(cnt[ch]?1:0),0);const l=document.createElement('label');l.className='hw-set';l.innerHTML='<input type="checkbox" class="pf-cb" '+(i<3?'checked':'')+' value="'+s.id+'"> <b>'+esc(s.label)+'</b> <span class="hw-chars">'+esc([...s.chars].join(' '))+'</span><span class="hw-have">'+have+'/'+s.chars.length+' learned</span>';sets.appendChild(l);});
  b.querySelector('.hw-go').onclick=()=>{const k=+b.querySelector('.hw-k').value;const chosen=[...sets.querySelectorAll('input:checked')].map(i=>m.sets.find(s=>s.id===i.value));const q=[];const c2=hwCounts();
    chosen.forEach(s=>[...s.chars].forEach(ch=>{for(let i=(c2[ch]||0);i<k;i++)q.push(ch);}));if(!q.length){toast('Those are all learned — raise “examples of each” to add more','info');return;}hwCalRun(q,'Calibration');};}
function hwCalRun(queue,title){const b=HL.body;let i=0;const done=[];
  b.innerHTML='<div class="hw-cal"><div class="hw-cal-top"><span class="hw-cal-title">'+esc(title)+'</span><span class="hw-cal-count"></span><div class="hw-prog"><i></i></div></div><div class="hw-cal-main"><div class="hw-target"><div class="hw-tch"></div><div class="hw-tp"></div><div class="hw-tprev"></div></div><div class="hw-cal-padwrap"><canvas class="hw-pad char big"></canvas><div class="hw-row"><button class="pbtn hw-undo">Undo stroke</button><button class="pbtn hw-back">Redo previous</button><button class="pbtn hw-skip">Skip</button><button class="fx-primary hw-next">Next ›</button><button class="fx-link hw-stop">Finish</button></div></div></div></div>';
  const pad=HL.pad=hwPad(b.querySelector('.hw-pad'),'char');pad.draw();
  const show=()=>{if(i>=queue.length){hwCalDone(done.length);return;}const ch=queue[i];const nth=queue.slice(0,i+1).filter(x=>x===ch).length,tot=queue.filter(x=>x===ch).length;
    b.querySelector('.hw-tch').textContent=ch;b.querySelector('.hw-tp').innerHTML='Write “<b>'+esc(ch)+'</b>” naturally, exactly as you normally write it.'+(tot>1?'<br><span class="hw-hint">example '+nth+' of '+tot+'</span>':'');
    b.querySelector('.hw-cal-count').textContent=(i+1)+' / '+queue.length;b.querySelector('.hw-prog i').style.width=(100*i/queue.length)+'%';
    const prev=b.querySelector('.hw-tprev');prev.innerHTML='';HWS.samples.filter(s=>s.ch===ch).slice(-5).forEach(s=>{const c=document.createElement('canvas');c.className='hw-mini';prev.appendChild(c);hwThumb(c,s.strokes);});pad.clear();};
  const accept=async()=>{clearTimeout(HL.calT);if(!pad.strokes.length)return;const rec=await hwAddSample(queue[i],pad.strokes,pad.frame(),'calibration');if(rec)done.push(rec);i++;show();};
  pad.onStroke=()=>{clearTimeout(HL.calT);HL.calT=setTimeout(accept,1100);};pad.onDown=()=>clearTimeout(HL.calT);
  b.querySelector('.hw-next').onclick=accept;b.querySelector('.hw-undo').onclick=()=>{clearTimeout(HL.calT);pad.undo();};b.querySelector('.hw-skip').onclick=()=>{clearTimeout(HL.calT);i++;show();};
  b.querySelector('.hw-back').onclick=async()=>{clearTimeout(HL.calT);const last=done.pop();if(!last)return;await hwDeleteSample(last.id);i=Math.max(0,queue.lastIndexOf(last.ch,i-1));show();};
  b.querySelector('.hw-stop').onclick=()=>hwCalDone(done.length);show();}
function hwCalDone(n){clearTimeout(HL.calT);toast('Learned '+n+' new example'+(n!==1?'s':''),'ok');hwTab('model',{check:true});}

/* --- Words: segmentation + dictionary + candidates + corrections --- */
async function hwWordTab(payload){const b=HL.body;b.innerHTML=hwEmptyModelNote()+'<div class="hw-word"><div class="hw-h">Print a word or a short sentence <span class="hw-hint">(separate letters work best for now — joined-up writing comes later)</span></div><div class="hw-src"></div><canvas class="hw-pad word"></canvas>'+
  '<div class="hw-row"><button class="fx-primary hw-rec">✨ Recognise</button><button class="pbtn hw-undo">Undo stroke</button><button class="pbtn hw-clear">Clear</button><label class="pf-row hw-auto"><input type="checkbox" class="pf-cb" checked> recognise as I write</label></div>'+
  '<div class="hw-result"></div></div>';hwWire(b);
  const pad=HL.pad=hwPad(b.querySelector('.hw-pad'),'word');pad.draw();const auto=b.querySelector('.hw-auto input');let rt=null;
  if(payload&&payload.strokes){pad.load(payload.strokes);b.querySelector('.hw-src').innerHTML='<span class="hw-badge">From your page · the handwriting there is untouched</span>';}
  const res=b.querySelector('.hw-result');
  const run=async()=>{if(!pad.strokes.length){res.innerHTML='';pad.marks=[];pad.draw();return;}if(!HWS.model.length){res.innerHTML='<div class="hw-note">Calibrate first so Patchwork has your letters to compare with.</div>';return;}
    res.innerHTML='<div class="hw-hint">Recognising…</div>';await new Promise(r=>setTimeout(r,16));const dict=await hwDict();const t0=performance.now();
    const r=HWCore.recognizeLine(pad.strokes,HWS.model,{dict,fold:hwModule().fold});const ms=Math.round(performance.now()-t0);HL.last={r,strokes:pad.strokes.map(s=>s.slice()),frameH:r.seg.lineH,base:r.seg.base};
    // show how the writing was split into letters
    pad.marks=[];r.tokens.forEach(t=>t.list[0].parts.forEach((pt,j)=>{const bb=pt.g.m.b;pad.marks.push({x0:bb.x0,y0:bb.y0,x1:bb.x1,y1:bb.y1,label:t.list[0].text[j]||pt.c.ch});}));pad.draw();
    /* tiers chosen from measured data: above 0.30 almost only right answers, below 0.12 mostly wrong ones */
    const tier=r.confidence>0.3?['high','Confident']:r.confidence>0.12?['mid','Did you mean…']:['low','Patchwork isn’t confident about this'];
    res.innerHTML='<div class="hw-out"><span class="hw-tier '+tier[0]+'">'+tier[1]+' · '+Math.round(r.confidence*100)+'%</span><span class="hw-ms">'+ms+' ms · on this device</span></div>'+
      '<input class="pf-in hw-text" spellcheck="false"><div class="hw-alts"></div><div class="hw-row"><button class="fx-primary hw-copy">Copy text</button><button class="pbtn hw-teach" disabled>Teach Patchwork this correction</button>'+(tier[0]==='low'?'<button class="pbtn hw-again">Try again</button>':'')+'</div><div class="hw-hint hw-teachnote"></div>';
    const ti=res.querySelector('.hw-text');ti.value=r.text;const alts=res.querySelector('.hw-alts');
    r.tokens.forEach((t,k)=>{if(t.list.length<2)return;const g=document.createElement('div');g.className='hw-altg';t.list.slice(0,5).forEach((c,ci)=>{const x=document.createElement('button');x.className='sp-f'+(ci===0?' on':'');x.innerHTML=esc(c.text)+(c.dict?'':' <span class="hw-nd" title="not in the dictionary">?</span>')+'<span class="hw-pp">'+Math.round(c.p*100)+'%</span>';x.onclick=()=>{const words=ti.value.split(' ');words[k]=c.text;ti.value=words.join(' ');g.querySelectorAll('.sp-f').forEach(y=>y.classList.toggle('on',y===x));ti.dispatchEvent(new Event('input'));};g.appendChild(x);});alts.appendChild(g);});
    const teach=res.querySelector('.hw-teach'),note=res.querySelector('.hw-teachnote');
    ti.oninput=()=>{const changed=ti.value.trim()!==r.text;teach.disabled=!changed||!HWS.learn;note.textContent=!HWS.learn&&changed?'Learning from corrections is switched off (My handwriting).':'';};
    res.querySelector('.hw-copy').onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(ti.value).then(()=>toast('Copied','ok'),()=>{ti.select();document.execCommand('copy');toast('Copied','ok');});};
    const again=res.querySelector('.hw-again');if(again)again.onclick=()=>{pad.clear();res.innerHTML='';};
    teach.onclick=async()=>{const n=await hwTeach(r,ti.value.trim(),pad);note.textContent=n.msg;teach.disabled=true;if(n.saved)toast(n.msg,'ok');};};
  HL.runWords=run;pad.onStroke=()=>{clearTimeout(rt);if(auto.checked)rt=setTimeout(run,700);};pad.onDown=()=>clearTimeout(rt);
  b.querySelector('.hw-rec').onclick=run;b.querySelector('.hw-undo').onclick=()=>pad.undo();b.querySelector('.hw-clear').onclick=()=>{pad.clear();res.innerHTML='';b.querySelector('.hw-src').innerHTML='';};
  if(payload&&payload.strokes)run();}
// A correction becomes new personal examples: each letter the recogniser got wrong is saved as the letter you meant.
async function hwTeach(r,fixed,pad){const want=fixed.replace(/\s+/g,'');const parts=r.tokens.flatMap(t=>t.list[0].parts);const got=r.tokens.map(t=>t.list[0].text).join('');
  const m=hwModule();(fixed.match(m.wordRe)||[]).forEach(w=>HWS.personal.add(w));db.info.update('info',{hwWords:[...HWS.personal].filter(w=>!(String(m.words).includes(' '+w+' '))).slice(-2000)}).catch(()=>{});HWS.dict=null;
  if(want.length!==parts.length)return{saved:0,msg:'Remembered the word'+(fixed.includes(' ')?'s':'')+', but the letter count differs from what Patchwork split the writing into ('+parts.length+'), so no letter shapes were learned.'};
  let n=0;const frame={base:r.seg.base,xh:r.seg.lineH};for(let k=0;k<parts.length;k++){if(want[k]===got[k])continue;const strokes=parts[k].g.m.idx.map(i=>pad.strokes[i]).filter(Boolean);if(!strokes.length)continue;await hwAddSample(want[k],strokes,frame,'correction');n++;}
  return{saved:n,msg:n?'Learned '+n+' corrected letter'+(n>1?'s':'')+' as new examples of your handwriting.':'Nothing new to learn — the letters already matched.'};}

/* --- My handwriting: the personal model, self-test, adaptive practice, privacy --- */
function hwModelTab(payload){const b=HL.body;const m=hwModule();const cnt=hwCounts();const total=HWS.samples.length;const corr=HWS.samples.filter(s=>s.src==='correction').length;
  b.innerHTML='<div class="hw-model"><div class="hw-row hw-modeltop"><div><div class="hw-h">'+esc(m.name)+' — your personal model</div><div class="hw-hint">'+total+' examples of '+Object.keys(cnt).length+' characters'+(corr?' · '+corr+' learned from corrections':'')+'. They live only in this browser (and in “Back up everything”).</div></div>'+
  '<label class="pf-row"><input type="checkbox" class="pf-cb hw-learn"'+(HWS.learn?' checked':'')+'> Learn from my corrections</label></div><div class="hw-check"></div><div class="hw-chargrid"></div><div class="hw-row"><button class="fx-link danger hw-wipe">Delete all my '+esc(m.name)+' handwriting examples</button></div></div>';
  b.querySelector('.hw-learn').onchange=e=>{HWS.learn=e.target.checked;db.info.update('info',{hwLearn:HWS.learn}).catch(()=>{});};
  const grid=b.querySelector('.hw-chargrid');m.sets.forEach(s=>{const h=document.createElement('div');h.className='hw-h small';h.textContent=s.label;grid.appendChild(h);const row=document.createElement('div');row.className='hw-cells';
    [...s.chars].forEach(ch=>{const own=HWS.samples.filter(x=>x.ch===ch);const c=document.createElement('div');c.className='hw-cell'+(own.length?'':' empty');c.innerHTML='<span class="hw-cch">'+esc(ch)+'</span><canvas></canvas><span class="hw-cn">'+own.length+'</span>';row.appendChild(c);if(own.length)requestAnimationFrame(()=>hwThumb(c.querySelector('canvas'),own[own.length-1].strokes));
      c.onclick=()=>hwShowChar(ch,c);});grid.appendChild(row);});
  const extra=[...new Set(HWS.samples.map(s=>s.ch))].filter(ch=>!m.sets.some(s=>s.chars.includes(ch)));if(extra.length){const h=document.createElement('div');h.className='hw-h small';h.textContent='Other';grid.appendChild(h);const row=document.createElement('div');row.className='hw-cells';extra.forEach(ch=>{const c=document.createElement('div');c.className='hw-cell';c.innerHTML='<span class="hw-cch">'+esc(ch)+'</span><canvas></canvas><span class="hw-cn">'+(cnt[ch]||0)+'</span>';row.appendChild(c);c.onclick=()=>hwShowChar(ch,c);});grid.appendChild(row);}
  const wipe=b.querySelector('.hw-wipe');wipe.onclick=async()=>{if(!wipe.classList.contains('armed')){wipe.classList.add('armed');wipe.textContent='Click again to delete '+total+' examples';setTimeout(()=>{wipe.classList.remove('armed');},3000);return;}await db.hw.where('lang').equals(HWS.lang).delete();HWS.samples=[];hwRebuild();hwModelTab();toast('Handwriting examples deleted','ok');};
  hwRenderCheck(b.querySelector('.hw-check'),payload&&payload.check);}
function hwRenderCheck(box,auto){const go=()=>{box.innerHTML='<div class="hw-hint">Testing every example against the others…</div>';setTimeout(()=>{const r=HWCore.selfTest(HWS.model);
    if(!r.n){box.innerHTML='<div class="hw-note">Write at least two examples of some characters, then Patchwork can test how well it tells them apart.</div>';return;}
    const pairs=r.pairs.slice(0,6);box.innerHTML='<div class="hw-checkres"><div><span class="hw-big">'+Math.round(r.accuracy*100)+'%</span> of your examples are recognised from your other examples.</div>'+(pairs.length?'<div class="hw-p">Patchwork needs more information to tell these apart in your writing:</div><div class="hw-pairs">'+pairs.map(p=>'<span class="hw-pair'+(p.kind==='confused'?' bad':'')+'">'+esc(p.pair.join(' / '))+'</span>').join('')+'</div><button class="fx-primary hw-practise">Practise these</button>':'<div class="hw-p">No characters are being confused. 🎉</div>')+'<button class="fx-link hw-recheck">Test again</button></div>';
    const pr=box.querySelector('.hw-practise');if(pr)pr.onclick=()=>{const q=[];pairs.slice(0,4).forEach(p=>{for(let k=0;k<3;k++)p.pair.forEach(ch=>q.push(ch));});hwTab('cal',{queue:q,title:'Targeted practice: '+pairs.slice(0,4).map(p=>p.pair.join(' ')).join(' · ')});};
    box.querySelector('.hw-recheck').onclick=go;},20);};
  if(auto&&HWS.model.length)go();else box.innerHTML=HWS.model.length?'<button class="pbtn hw-run">Check my handwriting model</button> <span class="hw-hint">finds characters that look alike in your writing and asks for more of exactly those</span>':'';const rb=box.querySelector('.hw-run');if(rb)rb.onclick=go;}
function hwShowChar(ch,cell){const own=HWS.samples.filter(s=>s.ch===ch);let pop=document.getElementById('hw-charpop');if(pop)pop.remove();pop=document.createElement('div');pop.id='hw-charpop';
  pop.innerHTML='<div class="hw-row"><b class="hw-cch">'+esc(ch)+'</b><span class="hw-hint">'+own.length+' example'+(own.length!==1?'s':'')+'</span><button class="pbtn hw-more">+ write more</button><button class="panel-x">×</button></div><div class="hw-samps"></div>';
  const sp=pop.querySelector('.hw-samps');own.forEach(s=>{const d=document.createElement('div');d.className='hw-samp';d.innerHTML='<canvas></canvas><span>'+esc(s.src||'')+'</span><button title="Delete this example">×</button>';sp.appendChild(d);requestAnimationFrame(()=>hwThumb(d.querySelector('canvas'),s.strokes));d.querySelector('button').onclick=async()=>{await hwDeleteSample(s.id);d.remove();};});
  pop.querySelector('.panel-x').onclick=()=>{pop.remove();hwModelTab();};pop.querySelector('.hw-more').onclick=()=>{pop.remove();hwTab('cal',{queue:[ch,ch,ch],title:'More examples of “'+ch+'”'});};
  cell.closest('.hw-model').appendChild(pop);pop.scrollIntoView({block:'nearest'});}

/* --- from the page: recognise selected ink without changing it --- */
function hwFromSelection(){if(mode!=='grab'||!grabSel.size){toast('Choose the arrow tool and select some handwriting first','info');return;}
  const sel=[...grabSel].filter(s=>s.tool==='pen').sort((a,b)=>(a.t-b.t)||((a.id||0)-(b.id||0)));if(!sel.length){toast('Select pen strokes (highlighter/eraser strokes are ignored)','info');return;}
  const strokes=sel.map(s=>s.pts.map(p=>({x:p.xn*1000,y:p.yn*1000,p:.5})));openLab('word',{strokes});}
document.getElementById('hw-lab-btn').addEventListener('click',()=>openLab());
document.getElementById('ink-recognize').addEventListener('click',hwFromSelection);
