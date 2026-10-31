"use strict";
/* ===== marker: a highlighter you swipe across words =====
   Behind the scenes it snaps to the words: a swipe over text makes a real highlight (a mark of the type picked from your
   highlight profile, e.g. Question) on whole words, so it moves with the text and shows up wherever highlights do (Explorer,
   Find & filter, page list, class, backups). It looks like a real marker: a translucent chisel-tip band UNDER the letters,
   drawn on a canvas below the page (#mkink) from where the words are now, slightly uneven, darker where two overlap.
   A swipe down the margin takes whole paragraphs; Shift+swipe takes highlights off; a swipe with no words under it leaves
   marker ink (tool 'hl'). Highlights made with it carry pen:1 (paintMark gives their words the class mk-pen). */
const MK={type:null,trail:null};
const mkcv=document.createElement('canvas');mkcv.id='mkink';stage.insertBefore(mkcv,wrap);const mkx=mkcv.getContext('2d');
function mkType(){const ids=activeTypeIds();let t=MK.type;if(!t){try{t=localStorage.getItem('pw-mk-type');}catch(e){}}if(!ids.includes(t))t=ids[0]||'note';MK.type=t;return t;}
function mkPick(id){MK.type=id;try{localStorage.setItem('pw-mk-type',id);}catch(e){}mkBar();}

/* ---- the bar: your profile's highlight types (keys 1-9) and the profile ---- */
function mkBar(){const bar=document.getElementById('mkbar');if(!bar)return;const ids=activeTypeIds(),cur=mkType(),col=mtype(cur).c;
  const chips=bar.querySelector('.mk-types');chips.innerHTML='';ids.forEach((id,i)=>{const t=mtype(id),b=document.createElement('button');b.className='mk-chip'+(id===cur?' on':'');b.title=t.name+(i<9?' (key '+(i+1)+')':'');
    b.innerHTML='<i></i><span></span>'+(i<9?'<kbd>'+(i+1)+'</kbd>':'');b.querySelector('i').style.background=t.c;b.querySelector('span').textContent=t.name;b.onclick=()=>mkPick(id);chips.appendChild(b);});
  const ps=bar.querySelector('.mk-prof');ps.innerHTML='';PROFILES.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;if(p.id===activeProfileId)o.selected=true;ps.appendChild(o);});ps.onchange=()=>setActiveProfile(ps.value);
  document.documentElement.style.setProperty('--mkc',col);
  const svg="<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M14.5 3.5l6 6-8.5 8.5H6v-6z' fill='#1c1c28' stroke='#fff' stroke-width='1.4' stroke-linejoin='round'/><path d='M6 12v6h6z' fill='"+col+"' stroke='#fff' stroke-width='1'/><path d='M2.5 21.5l3.5-3.5' stroke='"+col+"' stroke-width='3' stroke-linecap='round'/></svg>";
  if(mode==='marker')cv.style.cursor='url("data:image/svg+xml,'+encodeURIComponent(svg)+'") 3 21, crosshair';}
// (before the editor: the marker never types into the page)
addEventListener('keydown',e=>{const t=e.target;if(mode!=='marker'||e.ctrlKey||e.metaKey||e.altKey||/^(INPUT|TEXTAREA|SELECT)$/.test((t&&t.tagName)||'')||(t&&t.isContentEditable&&!noteEd.contains(t)))return;
  const i='123456789'.indexOf(e.key),id=i>=0&&activeTypeIds()[i];if(id){e.preventDefault();e.stopPropagation();mkPick(id);toast('Marker: '+mtype(id).name,'info');}},true);

/* ---- the look: a marker band under each line of highlighted words ---- */
function mkRand(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
// a chisel-tip stripe: slanted ends, edges that wander a little (the same every time: seeded), ink a bit heavier at the ends
function mkBand(c,x0,x1,top,h,col,seed){const r=mkRand(seed),y0=top+h*0.08,y1=top+h*0.94,sl=Math.min(6,(y1-y0)*0.32),n=Math.max(2,Math.round((x1-x0)/20)),w=()=>(r()-0.5)*1.5;
  const a0=x0+sl*0.5,a1=x1+sl*0.5+1,b0=x0-sl*0.5-1,b1=x1-sl*0.5;c.fillStyle=col;c.globalAlpha=0.36;c.beginPath();c.moveTo(a0,y0+w());
  for(let i=1;i<=n;i++)c.lineTo(a0+(a1-a0)*i/n,y0+w());c.lineTo(b1,y1+w());for(let i=n-1;i>=0;i--)c.lineTo(b0+(b1-b0)*i/n,y1+w());c.closePath();c.fill();
  c.globalAlpha=0.16;c.lineWidth=2.2;c.strokeStyle=col;c.beginPath();c.moveTo(a0+1,y0+1);c.lineTo(b0+1,y1-1);c.moveTo(a1-1,y0+1);c.lineTo(b1-1,y1-1);c.stroke();   // ink pools where the tip lands and lifts
  c.globalAlpha=0.07;c.fillRect(Math.min(a0,b0)+3,y0+(y1-y0)*(0.3+r()*0.1),Math.max(0,x1-x0-4),1);c.globalAlpha=1;}   // a faint streak along the stroke
function drawMarkerBands(){const Wd=Math.round(W*dpr),Hd=Math.round(H*dpr);if(mkcv.width!==Wd||mkcv.height!==Hd){mkcv.width=Wd;mkcv.height=Hd;mkcv.style.width=W+'px';mkcv.style.height=H+'px';}
  mkx.setTransform(dpr,0,0,dpr,0,0);mkx.clearRect(0,0,W,H);const sr=stage.getBoundingClientRect(),bands=new Map(),nth={};
  for(const s of noteEd.querySelectorAll('.mk-pen')){const id=s.dataset.mark,col=s.style.getPropertyValue('--mk')||'#f59e0b';
    for(const r of s.getClientRects()){if(!r.width||r.bottom<sr.top-30||r.top>sr.bottom+30)continue;const k=id+'|'+Math.round(r.top),o=bands.get(k);   // one band per highlight per line
      if(o){o.x0=Math.min(o.x0,r.left-sr.left);o.x1=Math.max(o.x1,r.right-sr.left);o.h=Math.max(o.h,r.height);}else{nth[id]=(nth[id]||0)+1;bands.set(k,{x0:r.left-sr.left,x1:r.right-sr.left,top:r.top-sr.top,h:r.height,col,seed:(+id||1)*977+nth[id]*131});}}}
  for(const b of bands.values())mkBand(mkx,b.x0-1,b.x1+1,b.top,b.h,b.col,b.seed);
  const T=MK.trail;if(T&&T.pts.length){mkx.globalAlpha=T.erase?0.28:0.36;mkx.strokeStyle=T.erase?'#9ca3af':T.col;mkx.lineWidth=parseFloat(noteEd.style.fontSize||'15')*1.2;mkx.lineCap='butt';mkx.lineJoin='round';   // the swipe, as you make it
    mkx.beginPath();mkx.moveTo(T.pts[0].x-sr.left,T.pts[0].y-sr.top);for(const p of T.pts)mkx.lineTo(p.x-sr.left,p.y-sr.top);if(T.pts.length===1)mkx.lineTo(T.pts[0].x-sr.left+1,T.pts[0].y-sr.top);mkx.stroke();mkx.globalAlpha=1;}}

/* ---- swiping ---- */
cv.addEventListener('pointerdown',e=>{if(mode!=='marker'||(e.button!==undefined&&e.button!==0))return;e.preventDefault();try{cv.setPointerCapture(e.pointerId);}catch(_){}const sr=stage.getBoundingClientRect();
  MK.trail={pts:[{x:e.clientX,y:e.clientY}],pp:[ptFromEvent(e)],erase:e.shiftKey,margin:e.clientX-sr.left<gutter,col:mtype(mkType()).c};drawMarkerBands();});
cv.addEventListener('pointermove',e=>{const T=MK.trail;if(!T||mode!=='marker')return;e.preventDefault();T.pts.push({x:e.clientX,y:e.clientY});T.pp.push(ptFromEvent(e));if(e.shiftKey)T.erase=true;drawMarkerBands();});
const _mkEnd=e=>{const T=MK.trail;if(!T)return;MK.trail=null;try{cv.releasePointerCapture(e.pointerId);}catch(_){}if(e.type==='pointercancel'){drawMarkerBands();return;}mkApply(T);};
cv.addEventListener('pointerup',_mkEnd);cv.addEventListener('pointercancel',_mkEnd);
async function mkApply(T){const xs=T.pts.map(p=>p.x),ys=T.pts.map(p=>p.y),dx=Math.max(...xs)-Math.min(...xs),dy=Math.max(...ys)-Math.min(...ys);
  const range=T.margin&&dy>Math.max(14,dx*1.2)?mkParasRange(Math.min(...ys),Math.max(...ys)):mkWordsRange(T.pts);   // down the margin: whole paragraphs
  drawMarkerBands();if(!range){if(!T.erase&&T.pp.length>1)mkInk(T);return;}
  const s=getSelection();s.removeAllRanges();s.addRange(range);
  if(T.erase)mkErase();else await mkMark(range);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{const g=getSelection();if(g&&g.rangeCount&&noteEd.contains(g.anchorNode))g.removeAllRanges();if(mode==='marker')noteEd.blur();redrawInk();}));}   // (the editor puts its selection back after a change)
function mkCaret(x,y){if(document.caretPositionFromPoint){const p=document.caretPositionFromPoint(x,y);return p&&{node:p.offsetNode,offset:p.offset};}if(document.caretRangeFromPoint){const r=document.caretRangeFromPoint(x,y);return r&&{node:r.startContainer,offset:r.startOffset};}return null;}
// the letters the swipe went over (not the blank space beside a line, not pictures or patches on top), widened to whole words
function mkWordsRange(pts){const hits=[],prev=cv.style.pointerEvents;cv.style.pointerEvents='none';
  try{const at=(x,y)=>{const el=document.elementFromPoint(x,y);if(!el||!noteEd.contains(el)||el.closest('.img-run'))return;const c=mkCaret(x,y);if(!c||!c.node||c.node.nodeType!==3||!noteEd.contains(c.node))return;const t=c.node.data;
      for(const o of [c.offset,c.offset-1]){if(o<0||o>=t.length||/[\s​]/.test(t[o]))continue;const r=document.createRange();r.setStart(c.node,o);r.setEnd(c.node,o+1);const b=r.getBoundingClientRect();
        if(x>=b.left-1.5&&x<=b.right+1.5&&y>=b.top-2&&y<=b.bottom+2){hits.push({node:c.node,o});return;}}};
    for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[i+1]||a,n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/3));for(let j=0;j<n;j++)at(a.x+(b.x-a.x)*j/n,a.y+(b.y-a.y)*j/n);}}
  finally{cv.style.pointerEvents=prev;}
  if(!hits.length)return null;const before=(a,b)=>a.node===b.node?a.o<b.o:!!(a.node.compareDocumentPosition(b.node)&Node.DOCUMENT_POSITION_FOLLOWING);
  let s=hits[0],e=hits[0];for(const h of hits){if(before(h,s))s=h;if(before(e,h))e=h;}
  const WD=/[\p{L}\p{N}_'’-]/u;let so=s.o,eo=e.o+1;while(so>0&&WD.test(s.node.data[so-1]))so--;while(eo<e.node.data.length&&WD.test(e.node.data[eo]))eo++;
  const r=document.createRange();r.setStart(s.node,so);r.setEnd(e.node,eo);return r;}
function mkText(el,first){const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n=null,x;while((x=w.nextNode())){if(!x.data.replace(/​/g,'').length)continue;n=x;if(first)break;}return n;}
// a swipe down the margin: the paragraphs beside it, whole
function mkParasRange(y0,y1){const ls=[...noteEd.querySelectorAll(':scope > .line')].filter(l=>{const r=l.getBoundingClientRect();return r.bottom>y0&&r.top<y1&&l.textContent.replace(/​/g,'').trim();});if(!ls.length)return null;
  const a=mkText(ls[0],true),b=mkText(ls[ls.length-1],false);if(!a||!b)return null;const r=document.createRange();r.setStart(a,0);r.setEnd(b,b.data.length);return r;}
async function mkMark(range){const snip=range.toString().replace(/\s+/g,' ').trim();if(!snip)return;
  const m=await addMark({type:mkType(),name:snip.slice(0,80),snippet:snip.slice(0,200),anchor:{kind:'text'},pen:1},false);if(!m)return;
  const s=getSelection();s.removeAllRanges();s.addRange(range);if(!editor.applyMark(m.id)){await deleteMark(m);return;}redrawInk();}
// Shift+swipe: the words lose their highlights (one undo step); a highlight left with no words goes shortly after, unless they come back
function mkErase(){const ids=editor.unmarkSelection();if(!ids.length)return;const after=editor.getHTML(),home=pid;redrawInk();
  setTimeout(async()=>{for(const id of ids){const m=markById(id);if(!m||m.pid!==home)continue;const still=pid===home?!!editor.markEl(id):(((await db.pages.get(home))||{}).html||'').includes('data-mark="'+id+'"');if(!still)hardDeleteMark(m);}},7000);
  toast('Highlight taken off','ok',{label:'Undo',fn:()=>{if(pid===home&&editor.getHTML()===after){editor.undo();redrawInk();}else toast('The page changed since — use Ctrl+Z','info');}});}
// no words under the swipe (a drawing, a picture, empty space): marker ink, as tall as a line of text
function mkInk(T){const wn=parseFloat(noteEd.style.fontSize||'15')*1.2/drawW,pts=T.pp.map(p=>({xn:p.xn,yn:p.yn,wn}));let lo=Infinity,hi=-Infinity;for(const q of pts){lo=Math.min(lo,q.yn);hi=Math.max(hi,q.yn);}
  addViewStroke({kind:'stroke',tool:'hl',color:T.col,t:Date.now(),pts,minYn:lo,maxYn:hi,pid});redrawInk();}
