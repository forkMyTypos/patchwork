"use strict";
/* ===== Handwriting recognition core (language-agnostic, offline, pure functions) =====
   Input is Patchwork stroke geometry: an array of strokes, each an array of {x,y} in any units, in writing order.
   Level 1-3 of the plan: normalise -> resample -> compare with the user's own samples (sequence DTW + order-free
   point cloud) -> ranked candidates. Level 4: segment print writing into characters and rescore with a dictionary.
   No network, no model files: the "model" is the user's own samples. */
const HWCore=(()=>{
  const N=40;                       // points per normalised glyph
  const hyp=Math.hypot;
  function strokeLen(s){let L=0;for(let i=1;i<s.length;i++)L+=hyp(s[i].x-s[i-1].x,s[i].y-s[i-1].y);return L;}
  function smooth(s){if(s.length<3)return s;const o=[s[0]];for(let i=1;i<s.length-1;i++)o.push({x:(s[i-1].x+2*s[i].x+s[i+1].x)/4,y:(s[i-1].y+2*s[i].y+s[i+1].y)/4});o.push(s[s.length-1]);return o;}
  // n points evenly spaced along the stroke (the $1-recogniser resampling step)
  function resample(s,n){const L=strokeLen(s);if(s.length<2||L===0)return Array.from({length:n},()=>({x:s[0].x,y:s[0].y}));
    const step=L/(n-1),out=[{x:s[0].x,y:s[0].y}];let acc=0,prev={x:s[0].x,y:s[0].y};
    for(let i=1;i<s.length&&out.length<n;i++){const cur=s[i];let d=hyp(cur.x-prev.x,cur.y-prev.y);
      while(acc+d>=step&&out.length<n&&d>0){const t=(step-acc)/d;const q={x:prev.x+t*(cur.x-prev.x),y:prev.y+t*(cur.y-prev.y)};out.push(q);prev=q;acc=0;d=hyp(cur.x-prev.x,cur.y-prev.y);}
      acc+=d;prev=cur;}
    while(out.length<n)out.push({x:s[s.length-1].x,y:s[s.length-1].y});return out;}
  function bbox(strokes){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const s of strokes)for(const p of s){if(p.x<x0)x0=p.x;if(p.x>x1)x1=p.x;if(p.y<y0)y0=p.y;if(p.y>y1)y1=p.y;}return{x0,y0,x1,y1,w:x1-x0,h:y1-y0};}
  function clean(strokes){return (strokes||[]).map(s=>(s||[]).filter(p=>p&&isFinite(p.x)&&isFinite(p.y)).map(p=>({x:+p.x,y:+p.y}))).filter(s=>s.length);}
  /* Normalise a glyph. frame (optional) = {base,xh}: the writing line in the same units, so size/position relative to
     the line can tell o from O or l from 1. Returns the feature record the matchers use. */
  function prep(strokes,frame){strokes=clean(strokes);if(!strokes.length)return null;const b=bbox(strokes);const size=Math.max(b.w,b.h,1e-6);
    const cx=(b.x0+b.x1)/2,cy=(b.y0+b.y1)/2;const lens=strokes.map(strokeLen),total=lens.reduce((a,c)=>a+c,0)||1;
    const pts=[];strokes.forEach((s,si)=>{const dot=lens[si]<size*0.06;const n=dot?2:Math.max(3,Math.round(N*lens[si]/total));const r=resample(smooth(s),n);
      for(let j=0;j<r.length;j++){const a=r[Math.max(0,j-1)],c=r[Math.min(r.length-1,j+1)];let dx=c.x-a.x,dy=c.y-a.y;const l=hyp(dx,dy);if(l>0){dx/=l;dy/=l;}else{dx=0;dy=0;}
        pts.push({x:(r[j].x-cx)/size,y:(r[j].y-cy)/size,dx,dy,s:j===0?1:0});}});
    const f={pts,n:strokes.length,aspect:Math.log((b.w+size*0.05)/(b.h+size*0.05)),box:b};
    if(frame&&frame.xh>0)f.frame={top:(frame.base-b.y0)/frame.xh,bot:(frame.base-b.y1)/frame.xh};
    return f;}
  // sequence distance: dynamic time warping over (position, direction, pen-up) with a Sakoe-Chiba band
  function dtw(a,b){const A=a.pts,B=b.pts,n=A.length,m=B.length,band=Math.max(Math.abs(n-m),Math.ceil(Math.max(n,m)*0.3));const W=m+1;
    const D=new Float64Array((n+1)*W).fill(Infinity);D[0]=0;
    for(let i=1;i<=n;i++){const p=A[i-1],j0=Math.max(1,i-band),j1=Math.min(m,i+band);for(let j=j0;j<=j1;j++){const q=B[j-1];
      const c=hyp(p.x-q.x,p.y-q.y)+0.22*(1-(p.dx*q.dx+p.dy*q.dy))/2+(p.s!==q.s?0.04:0);
      const k=i*W+j;D[k]=c+Math.min(D[k-W],D[k-1],D[k-W-1]);}}
    return D[n*W+m]/(n+m);}
  // order-free distance (greedy point-cloud match, like the $P recogniser): forgives a different stroke order
  function cloud1(A,B){const used=new Uint8Array(B.length);let sum=0;for(let i=0;i<A.length;i++){let best=Infinity,bi=-1;for(let j=0;j<B.length;j++){if(used[j])continue;const d=hyp(A[i].x-B[j].x,A[i].y-B[j].y);if(d<best){best=d;bi=j;}}if(bi>=0){used[bi]=1;sum+=best*(1-0.5*i/A.length);}else sum+=0.5;}return sum/A.length;}
  function cloud(a,b){return (cloud1(a.pts,b.pts)+cloud1(b.pts,a.pts))/2;}
  const W8={dtw:0.6,cloud:0.4,aspect:0.05,strokes:0.02,frame:0.07};
  function distance(a,b,o){let d=W8.dtw*dtw(a,b)+W8.cloud*cloud(a,b)+W8.aspect*Math.abs(a.aspect-b.aspect)+W8.strokes*Math.min(3,Math.abs(a.n-b.n));
    if(a.frame&&b.frame)d+=(o&&o.frameWeight!=null?o.frameWeight:W8.frame)*(Math.min(1.5,Math.abs(a.frame.top-b.frame.top))+Math.min(1.5,Math.abs(a.frame.bot-b.frame.bot)));
    return d;}
  const SIM=0.16,TEMP=0.018;
  function similarity(d){return Math.max(0,Math.min(1,Math.exp(-d/SIM)));}
  /* Classify one glyph against the personal model: model = [{ch, f}] (prepared samples).
     Returns every known character ranked, with distance, similarity (0..1) and probability (sums to 1). */
  function coarse(f){if(!f.c){const P=f.pts,c=[];for(let i=0;i<12;i++){const p=P[Math.floor(i*(P.length-1)/11)];c.push(p);}f.c=c;}return f.c;}
  function cheap(a,b){const A=coarse(a),B=coarse(b);let s=0;for(const p of A){let m=Infinity;for(const q of B){const d=(p.x-q.x)*(p.x-q.x)+(p.y-q.y)*(p.y-q.y);if(d<m)m=d;}s+=Math.sqrt(m);}return s/A.length+0.05*Math.abs(a.aspect-b.aspect);}
  function classify(f,model,o){if(!f||!model.length)return[];const per=new Map();const K=(o&&o.keep)||0;let pool=model.filter(s=>s.f);
    if(pool.length>40){const ranked=pool.map(s=>({s,c:cheap(f,s.f)})).sort((x,y)=>x.c-y.c);const keep=new Set(ranked.slice(0,Math.max(36,K*3)).map(x=>x.s));pool=pool.filter(s=>keep.has(s));}
    for(const s of pool){const d=distance(f,s.f,o);let r=per.get(s.ch);if(!r){r={ch:s.ch,ds:[]};per.set(s.ch,r);}r.ds.push({d,s});}
    const out=[];for(const r of per.values()){r.ds.sort((x,y)=>x.d-y.d);const d=r.ds.length>1?0.7*r.ds[0].d+0.3*r.ds[1].d:r.ds[0].d;out.push({ch:r.ch,d,best:r.ds[0].s,samples:r.ds.length});}
    out.sort((x,y)=>x.d-y.d);const d0=out[0].d;let z=0;for(const c of out){c.p=Math.exp(-(c.d-d0)/TEMP);z+=c.p;}for(const c of out){c.p/=z;c.sim=similarity(c.d);}
    // overall confidence: how sure among known shapes x how much it looks like any known shape at all
    const conf=out[0].p*Math.min(1,similarity(d0)/0.55);out.forEach(c=>c.confidence=c.p*Math.min(1,similarity(d0)/0.55));out.confidence=conf;return out;}
  /* Level 4: split print handwriting into "atoms" (strokes that clearly overlap, or small marks like the dot of an i,
     belong together), find the writing line, and split words at large gaps. Atoms may still be pieces of a letter;
     recognizeLine decides how to join them (segmentation by recognition). Joined-up cursive is out of scope for now. */
  function segment(strokes){strokes=clean(strokes);if(!strokes.length)return{atoms:[],words:[],lineH:0};const items=strokes.map((s,i)=>({i,s,b:bbox([s])}));
    const hs=items.map(it=>Math.max(it.b.h,it.b.w*0.5)).sort((a,b)=>a-b);const big=hs.filter(h=>h>0.35*hs[hs.length-1]);const lineH=Math.max(1e-6,big.length?big[Math.floor(big.length/2)]:hs[hs.length-1]);
    const parent=items.map((_,i)=>i);const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));const join=(a,b)=>{parent[find(a)]=find(b);};
    for(let a=0;a<items.length;a++)for(let b=a+1;b<items.length;b++){const A=items[a].b,B=items[b].b;const ov=Math.min(A.x1,B.x1)-Math.max(A.x0,B.x0);const nar=Math.max(1e-6,Math.min(A.w,B.w));
      const small=x=>x.w<0.4*lineH&&x.h<0.4*lineH;
      if(ov>0.6*nar&&ov>0.25*lineH)join(a,b);                                   // clearly on top of each other
      else if((small(A)||small(B))&&ov>-0.1*lineH&&Math.abs(b-a)<=2)join(a,b);  // i-dots, t-bars, accents
    }
    const gm=new Map();items.forEach((it,i)=>{const r=find(i);if(!gm.has(r))gm.set(r,[]);gm.get(r).push(it);});
    const atoms=[...gm.values()].map(g=>{g.sort((x,y)=>x.i-y.i);const sts=g.map(x=>x.s);return{strokes:sts,idx:g.map(x=>x.i),b:bbox(sts)};}).sort((x,y)=>(x.b.x0+x.b.x1)-(y.b.x0+y.b.x1));
    const bots=atoms.filter(a=>a.b.h>0.3*lineH).map(a=>a.b.y1).sort((a,b)=>a-b);const base=bots.length?bots[Math.floor(bots.length/2)]:atoms[0].b.y1;
    // word breaks: a gap much wider than the usual gap between pieces
    const gaps=[];for(let k=1;k<atoms.length;k++){let right=-Infinity;for(let q=0;q<k;q++)right=Math.max(right,atoms[q].b.x1);gaps.push(atoms[k].b.x0-right);}
    const pos=gaps.filter(g=>g>0).sort((a,b)=>a-b);const medGap=pos.length?pos[Math.floor(pos.length/2)]:0;
    const words=[];let cur=[];atoms.forEach((a,k)=>{if(k>0&&gaps[k-1]>Math.max(0.5*lineH,medGap*2.5)&&cur.length){words.push(cur);cur=[];}cur.push(a);});if(cur.length)words.push(cur);
    return{atoms,words,lineH,base};}
  // joined pieces keep the order they were WRITTEN in (stroke order is part of a person's handwriting)
  function mergeAtoms(list){const pairs=[];list.forEach(a=>a.strokes.forEach((s,j)=>pairs.push({s,i:a.idx[j]})));pairs.sort((x,y)=>x.i-y.i);const strokes=pairs.map(x=>x.s);return{strokes,idx:pairs.map(x=>x.i),b:bbox(strokes)};}
  /* Many capitals are the same shape as their small letter (o/O, s/S, x/X, w/W...). For dictionary words, decide
     capitalisation from size: a first letter clearly taller than the rest is a capital; all tall = ALL CAPS. */
  function caseLike(c){const s=c.s,parts=c.parts;if(s.length<2)return s===s.toLowerCase()?s:s.toUpperCase()===s&&/^[a-z]$/i.test(s)&&parts[0]&&parts[0].c.ch===s?s:s;
    const h=parts.map(x=>x.g.m.b.h),rest=h.slice(1).sort((a,b)=>a-b),med=rest[Math.floor(rest.length/2)]||h[0];
    const low=s.toLowerCase(),allUp=s===s.toUpperCase()&&/[A-Z]/.test(s);if(allUp&&Math.min(...h)>0.8*Math.max(...h))return s;
    const firstBig=h[0]>1.2*med||/[A-Z]/.test(s[0])&&parts[0].c.p>0.9&&!'CKOPSUVWXZ'.includes(s[0]);
    return (firstBig&&/[A-Z]/.test(s[0]))?s[0]+low.slice(1):low;}
  /* Recognise a line of print writing. For each word: a beam search over (how many atoms make the next character,
     which character) scored by shape distance, with a soft dictionary prior. Returns candidates per word + the text. */
  function recognizeLine(strokes,model,opts){opts=opts||{};const seg=segment(strokes);if(!seg.atoms.length)return{tokens:[],text:'',confidence:0,seg};
    const fold=opts.fold||(c=>c.toLowerCase());const dict=opts.dict||null;const T=TEMP*2.2,B=opts.dictBonus!=null?opts.dictBonus:4,PFX=opts.prefixPenalty!=null?opts.prefixPenalty:1.4,D0=opts.d0!=null?opts.d0:(dict?0.08:0),CT=opts.candTemp||1.5;
    const xh=seg.lineH;const frame={base:seg.base,xh};const cache=new Map();   // most letters in running text are x-height lettersconst cache=new Map();
    const glyphAt=(atoms,i,k)=>{const key=atoms[i].idx[0]+':'+k;let g=cache.get(key);if(g)return g;const m=mergeAtoms(atoms.slice(i,i+k));
      if(k>1&&m.b.w>1.7*seg.lineH){g={bad:true};cache.set(key,g);return g;}
      const f=prep(m.strokes,frame);g={m,f,cands:classify(f,model,{frameWeight:0.05,keep:10})};cache.set(key,g);return g;};
    const tokens=seg.words.map(atoms=>{const n=atoms.length;let beam=[{i:0,s:'',sc:0,parts:[]}];const done=[];let guard=0;
      while(beam.length&&guard++<200){const next=[];for(const st of beam){if(st.i>=n){done.push(st);continue;}
        for(let k=1;k<=Math.min(4,n-st.i);k++){const g=glyphAt(atoms,st.i,k);if(g.bad)break;const cs=g.cands.slice(0,6);
          for(const c of cs){const s=st.s+c.ch;let sc=st.sc+(D0-c.d)/T;/* a good match adds evidence, a poor one costs */if(dict&&!dict.prefix.has(fold(s)))sc-=PFX;next.push({i:st.i+k,s,sc,parts:st.parts.concat([{g,c,k}])});}}}
        next.sort((a,b)=>b.sc-a.sc);const seen=new Set();beam=[];for(const x of next){const key=x.i+'|'+x.s;if(seen.has(key))continue;seen.add(key);beam.push(x);if(beam.length>=120)break;}}
      done.forEach(d=>{d.inDict=!!(dict&&dict.set.has(fold(d.s)));d.total=d.sc+(d.inDict?B:0);});
      done.sort((a,b)=>b.total-a.total);const uniq=[];const seen=new Set();for(const d of done){if(seen.has(d.s))continue;seen.add(d.s);uniq.push(d);if(uniq.length>=8)break;}
      if(!uniq.length)return{list:[{text:'?',p:0,confidence:0,parts:[]}]};
      const m=uniq[0].total;let z=0;uniq.forEach(c=>{c.p=Math.exp((c.total-m)/CT);z+=c.p;});
      const look=uniq[0].parts.reduce((a,x)=>a+Math.min(1,similarity(x.c.d)/0.55),0)/Math.max(1,uniq[0].parts.length);
      const list=uniq.map(c=>({text:c.inDict?caseLike(c):c.s,p:c.p/z,confidence:(c.p/z)*look,dict:c.inDict,parts:c.parts}));return{list};});
    const text=tokens.map(t=>t.list[0].text).join(' ');const conf=Math.min(...tokens.map(t=>t.list[0].confidence));   /* a line is only as certain as its weakest word */
    return{tokens,text,confidence:conf,seg};}
  /* Adaptive calibration support: classify every sample against all the others (leave-one-out) and report which
     characters get confused for this writer, so calibration can ask for exactly those. */
  function selfTest(model,opts){const res={n:0,ok:0,confusions:new Map(),weak:new Map()};
    for(let i=0;i<model.length;i++){const s=model[i];if(!s.f)continue;const rest=model.filter((_,j)=>j!==i);if(!rest.some(r=>r.ch===s.ch))continue;const c=classify(s.f,rest,opts);if(!c.length)continue;res.n++;
      if(c[0].ch===s.ch){res.ok++;const second=c[1];if(second&&second.d-c[0].d<0.012){const k=[s.ch,second.ch].sort().join('\u0000');res.weak.set(k,(res.weak.get(k)||0)+1);}}
      else{const k=[s.ch,c[0].ch].sort().join('\u0000');res.confusions.set(k,(res.confusions.get(k)||0)+1);}}
    const pairs=[...res.confusions.entries()].map(([k,n])=>({pair:k.split('\u0000'),n,kind:'confused'})).concat([...res.weak.entries()].map(([k,n])=>({pair:k.split('\u0000'),n,kind:'close'}))).sort((a,b)=>(b.kind==='confused')-(a.kind==='confused')||b.n-a.n);
    return{n:res.n,accuracy:res.n?res.ok/res.n:0,pairs};}
  function buildDict(words,fold){fold=fold||(w=>w.toLowerCase());const set=new Set(),prefix=new Set();for(let w of words){w=fold(String(w||'').trim());if(!w||w.length>24||set.has(w))continue;set.add(w);for(let i=1;i<=w.length;i++)prefix.add(w.slice(0,i));}return{set,prefix,size:set.size};}
  return{N,prep,distance,dtw,cloud,classify,segment,recognizeLine,selfTest,buildDict,similarity,bbox,W8};
})();
