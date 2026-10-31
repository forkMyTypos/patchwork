"use strict";
/* ===== view modes (the view button in the top bar): Standard / Two pages / Slides =====
   Standard: one page, scroll down (as before).
   Two pages ('dual'): this window's page on the left, a second page on the right (a frame: ?mini=1&dual=1&pid=N), with a
     divider you drag to resize (double-click: half and half). The top bar's tools work on both pages: one tool at a time
     (pick the pen and you can draw on either), same ink colour and size. Undo / Redo / Patch / Timeline go to the page you
     last worked in (amber line on its header). Each page area has its own header (Projects, file history, page n / N ▾,
     Latest) and its own format / ink bar.
   Slides ('slide'): the page sits in the middle of the window as a card with room around it. Instead of scrolling down you
     slide left / right a card at a time (wheel or swipe, ← →, PgUp / PgDn, the ‹ › buttons, the margin's page buttons). A
     line cut by the card's bottom edge starts the next slide. Drag the card's edges to resize it (double-click an edge: back
     to the default size): that changes the window onto the page, never the page (it keeps its width, like everywhere else).
   Both are off while you're in a class. Kept in this browser only: pw-view, pw-dual {r,pid}, pw-slide {w,h}. */
const IS_DUAL=IS_MINI&&new URLSearchParams(location.search).has('dual');document.documentElement.classList.toggle('dual-in',IS_DUAL);
const VIEW={mode:'std',act:'L',r:.5,pane:null,split:null,head:null,booted:false,user:null,sw:0,sh:0,k:0,minEnd:0,inN:0,sk:null,starts:null,wt:0,wacc:0,wused:false,st:0,ft:0,at:0};
const VIEW_MODES=[['std','Standard','One page. Scroll down as you go.'],['dual','Two pages','Two pages side by side, same tools. Drag the middle to resize.'],['slide','Slides','The page in the middle of the window. Slide left / right instead of scrolling; drag its edges to resize.']];
const VIEW_IC={std:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/>',
  dual:'<rect x="2.5" y="4" width="8.5" height="16" rx="1.5"/><rect x="13" y="4" width="8.5" height="16" rx="1.5"/>',
  slide:'<rect x="6" y="5.5" width="12" height="13" rx="1.5"/><path d="M3.5 9.5L1.5 12l2 2.5M20.5 9.5l2 2.5-2 2.5"/>'};
function viewSvg(k,s){return '<svg width="'+s+'" height="'+s+'" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">'+VIEW_IC[k]+'</svg>';}
function viewLS(k,v){try{if(arguments.length<2)return JSON.parse(localStorage.getItem(k)||'null');localStorage.setItem(k,JSON.stringify(v));}catch(e){return null;}}
function viewInClass(){return typeof CLS!=='undefined'&&!!CLS.role;}

/* ---- the view button and its menu ---- */
function viewBtn(){const b=document.getElementById('view-btn');if(!b)return;const m=VIEW_MODES.find(x=>x[0]===VIEW.mode);
  b.innerHTML=viewSvg(VIEW.mode,16);b.title='View: '+m[1]+' (click to change: Standard, Two pages, Slides)';b.classList.toggle('on',VIEW.mode!=='std');}
let _viewPop=null;
function viewMenu(anchor){if(!_viewPop){_viewPop=document.createElement('div');_viewPop.className='view-pop';document.body.appendChild(_viewPop);
    document.addEventListener('pointerdown',e=>{if(_viewPop.classList.contains('open')&&!_viewPop.contains(e.target)&&!e.target.closest('#view-btn'))_viewPop.classList.remove('open');},true);
    addEventListener('keydown',e=>{if(e.key==='Escape'&&_viewPop.classList.contains('open')){e.preventDefault();e.stopPropagation();_viewPop.classList.remove('open');}},true);}
  if(_viewPop.classList.contains('open')){_viewPop.classList.remove('open');return;}
  _viewPop.innerHTML='';for(const [k,n,d] of VIEW_MODES){const r=document.createElement('button');r.className='vp-row'+(VIEW.mode===k?' on':'');r.dataset.v=k;
    r.innerHTML=viewSvg(k,22)+'<span><b></b><small></small></span>';r.querySelector('b').textContent=n;r.querySelector('small').textContent=d;
    r.onclick=()=>{_viewPop.classList.remove('open');viewSet(k);};_viewPop.appendChild(r);}
  _viewPop.classList.add('open');const a=anchor.getBoundingClientRect(),w=_viewPop.offsetWidth;_viewPop.style.left=Math.max(8,Math.min(a.right-w,innerWidth-w-8))+'px';_viewPop.style.top=(a.bottom+6)+'px';}
async function viewSet(m,quiet){if(IS_MINI||!VIEW_MODES.some(x=>x[0]===m)||m===VIEW.mode)return;
  if(m!=='std'&&viewInClass()){if(!quiet)toast('Two pages and Slides are off while you are in a class','info');return;}
  if(VIEW.mode==='dual')await dualOff();else if(VIEW.mode==='slide')slideOff();
  VIEW.mode=m;viewLS('pw-view',m);viewBtn();
  if(m==='dual'){dualOn();if(VIEW.booted)await dualLoad();}else if(m==='slide')slideOn();
  dispatchEvent(new Event('resize'));}

/* ---- two pages ---- */
function dualOn(){document.body.classList.add('dual');const s=viewLS('pw-dual')||{};VIEW.r=s.r>=.15&&s.r<=.85?s.r:.5;dualHead(true);
  const pane=document.createElement('div');pane.className='dual-pane';pane.innerHTML='<iframe title="Second page"></iframe>';
  const sp=document.createElement('div');sp.className='dual-split';sp.title='Drag to resize the two pages (double-click: half and half)';
  document.body.append(pane,sp);VIEW.pane=pane;VIEW.split=sp;dualSplitWire(sp);dualPlace();viewAct('L');}
// the second page: the one it showed last time, else the project you opened most recently, else any other, else a new one
async function dualPick(){const ok=id=>id!=null&&id!==pid&&projects.some(x=>x.id===id&&!x.patchOf);const s=viewLS('pw-dual');if(s&&ok(s.pid))return s.pid;
  try{await recentLoad();}catch(e){}for(const [id] of [..._recentT].sort((a,b)=>b[1]-a[1]))if(ok(id))return id;
  const any=userProjects().find(x=>ok(x.id));if(any)return any.id;
  const id=await db.projects.add({name:autoProjName(),created:Date.now(),folder:null});projects=await db.projects.toArray();syncPing('projects');return id;}
async function dualLoad(){if(!VIEW.pane)return;const f=VIEW.pane.querySelector('iframe');if(f.getAttribute('src'))return;const p=await dualPick();if(p==null||!VIEW.pane)return;f.src=location.pathname+'?mini=1&dual=1&pid='+p;}
// the page's own header (Projects, file history, page n / N, Latest) moves out of the top bar to the top of its page area
function dualHead(on){const $=id=>document.getElementById(id),pb=$('proj-btn'),hb=$('hist-btn'),pi=$('page-ind'),nw=$('now');
  if(on){if(!VIEW.head){VIEW.head=document.createElement('div');VIEW.head.id='dual-head';}const sp=document.createElement('div');sp.className='dh-sp';VIEW.head.replaceChildren(pb,hb,sp,pi,nw);$('bar1').after(VIEW.head);return;}
  if(!VIEW.head)return;const ch=$('class-chip');$('brand').after(pb);let a=pb;if(ch&&ch.parentNode===VIEW.head){a.after(ch);a=ch;}a.after(hb);$('bk-status').after(pi);pi.after(nw);VIEW.head.remove();VIEW.head.replaceChildren();}
function dualPlace(){if(!VIEW.pane)return;document.body.style.setProperty('--dr',VIEW.r);const t=document.getElementById('bar1').getBoundingClientRect().bottom+'px';VIEW.pane.style.top=t;VIEW.split.style.top=t;}
function dualSplitWire(sp){sp.addEventListener('pointerdown',e=>{if(e.button)return;e.preventDefault();sp.setPointerCapture(e.pointerId);sp.classList.add('on');const cov=document.createElement('div');cov.className='dual-cover';document.body.appendChild(cov);let raf=0;
    const mv=ev=>{VIEW.r=Math.max(.15,Math.min(.85,ev.clientX/innerWidth));if(!raf)raf=requestAnimationFrame(()=>{raf=0;dualPlace();dispatchEvent(new Event('resize'));});};
    const up=()=>{sp.removeEventListener('pointermove',mv);sp.removeEventListener('pointerup',up);sp.removeEventListener('pointercancel',up);sp.classList.remove('on');cov.remove();dualSave();};
    sp.addEventListener('pointermove',mv);sp.addEventListener('pointerup',up);sp.addEventListener('pointercancel',up);});
  sp.addEventListener('dblclick',()=>{VIEW.r=.5;dualPlace();dispatchEvent(new Event('resize'));dualSave();});}
function dualFrame(){try{return VIEW.pane&&VIEW.pane.querySelector('iframe').contentWindow;}catch(e){return null;}}
function dualSave(){let p=null;try{p=dualFrame().currentPid();}catch(e){}const s=viewLS('pw-dual')||{};viewLS('pw-dual',{r:VIEW.r,pid:p!=null?p:s.pid});}
async function dualOff(){if(!VIEW.pane)return;const w=dualFrame();dualSave();try{if(w&&w.historyFlush)await w.historyFlush();if(w&&w.savePageNow)await w.savePageNow();}catch(e){}
  VIEW.pane.remove();VIEW.split.remove();VIEW.pane=VIEW.split=null;dualHead(false);document.body.classList.remove('dual','dual-l');document.body.style.removeProperty('--dr');VIEW.act='L';}
// which page you last worked in ('L' this window, 'R' the frame)
function viewActive(){return VIEW.act;}
function viewAct(s){VIEW.act=s;document.body.classList.toggle('dual-l',VIEW.mode==='dual'&&s==='L');const w=dualFrame();try{if(w&&w.document)w.document.documentElement.classList.toggle('dual-act',s==='R');}catch(e){}}
function viewMayFocus(){if(IS_DUAL){try{return parent.viewActive()==='R';}catch(e){return true;}}return VIEW.mode!=='dual'||VIEW.act==='L';}
// one tool for both pages: a mode / ink colour / size change in either is passed to the other (called from setMode, setInkColor and the size slider)
function viewCurMode(){return mode;}
function viewInkNow(){return [inkColor,inkSize];}
function viewModeSync(m){if(window._viewQuiet||(IS_DUAL?!VIEW.booted:VIEW.mode!=='dual'))return;try{const w=IS_DUAL?parent:dualFrame();if(w&&typeof w.viewTake==='function')w.viewTake(m,inkColor,inkSize);}catch(e){}}
function viewTake(m,c,s){window._viewQuiet=true;try{if(c&&c!==inkColor)setInkColor(c);if(s&&s!==inkSize){inkSize=s;const el=document.getElementById('size'),v=document.getElementById('sizeval');if(el)el.value=s;if(v)v.textContent=s+' px';}if(m&&m!==mode)setMode(m);}finally{window._viewQuiet=false;}}
if(IS_DUAL)document.addEventListener('pointerdown',()=>{try{parent.viewAct('R');}catch(e){}},true);
else{document.addEventListener('pointerdown',e=>{if(VIEW.mode==='dual'&&!e.target.closest('#bar1,.dual-split,.view-pop'))viewAct('L');},true);
  // Undo / Redo / Patch / Timeline in the top bar act on the page you last worked in
  document.getElementById('bar1').addEventListener('click',e=>{if(VIEW.mode!=='dual'||VIEW.act!=='R')return;const b=e.target.closest('button');if(!b||!['undo','redo','patch-btn','timeline-btn'].includes(b.id))return;
    let t=null;try{t=dualFrame().document.getElementById(b.id);}catch(_){}if(!t)return;e.preventDefault();e.stopImmediatePropagation();t.click();},true);
  addEventListener('beforeunload',()=>{if(VIEW.pane)dualSave();});}

/* ---- slides ---- */
function slideOn(){document.body.classList.add('slide');VIEW.user=viewLS('pw-slide');VIEW.k=0;VIEW.sk=null;
  if(!VIEW.grips){VIEW.grips=['n','s','e','w','ne','nw','se','sw'].map(d=>{const g=document.createElement('div');g.className='sl-grip';g.dataset.d=d;g.title='Drag to resize (double-click: the default size)';slideGripWire(g);return g;});
    const nav=(c,t,s,d)=>{const b=document.createElement('button');b.className='sl-nav '+c;b.title=t;b.textContent=s;b.onclick=()=>slideStep(d);return b;};
    VIEW.prev=nav('prev','Previous slide (←, PgUp)','‹',-1);VIEW.next=nav('next','Next slide (→, PgDn)','›',1);
    VIEW.mask=document.createElement('div');VIEW.mask.className='sl-mask';VIEW.size=document.createElement('div');VIEW.size.className='sl-size';}
  stage.append(VIEW.mask,...VIEW.grips,VIEW.prev,VIEW.next,VIEW.size);slideApply();}
function slideOff(){document.body.classList.remove('slide');for(const e of [VIEW.mask,...(VIEW.grips||[]),VIEW.prev,VIEW.next,VIEW.size])if(e)e.remove();
  const s=document.body.style;s.removeProperty('--sw');s.removeProperty('--sh');stage.classList.remove('sl-in-next','sl-in-prev','sl-sizing');VIEW.sw=VIEW.sh=0;VIEW.minEnd=0;}
// the card: your size, or as wide as the page needs (with room around it) and the window's height less some room
function slideDims(){const top=document.getElementById('bar2').getBoundingClientRect().bottom,aw=innerWidth,ah=Math.max(120,innerHeight-top),u=VIEW.user||{};
  const need=(gutter||86)+(pageWW||wsW())+14,px=Math.max(40,aw*.07),py=Math.max(22,ah*.05);
  let w=u.w||Math.min(need,aw-2*px),h=u.h||ah-2*py;w=Math.max(Math.min(320,aw-16),Math.min(aw-16,w));h=Math.max(Math.min(200,ah-16),Math.min(ah-16,h));return{w:Math.round(w),h:Math.round(h)};}
function slideApply(){if(VIEW.mode!=='slide')return false;const d=slideDims(),ch=d.w!==VIEW.sw||d.h!==VIEW.sh;VIEW.sw=d.w;VIEW.sh=d.h;const s=document.body.style;s.setProperty('--sw',d.w+'px');s.setProperty('--sh',d.h+'px');
  const inside=stage.getBoundingClientRect().left<58;VIEW.prev.classList.toggle('in',inside);VIEW.next.classList.toggle('in',inside);return ch;}
// where each slide starts (px down the page): a card height after the last, or the top of the line that the card's bottom edge would cut
function slideStarts(){const key=[noteEd.scrollHeight,H,drawW,VIEW.inN,VIEW.minEnd,Math.round(inkBottomPx())].join('|');if(VIEW.sk===key&&VIEW.starts)return VIEW.starts;
  const off=wrap.scrollTop-wrap.getBoundingClientRect().top,rg=document.createRange(),L=[];
  for(const el of noteEd.children){rg.selectNodeContents(el);for(const b of rg.getClientRects())if(b.height>2)L.push([b.top+off,b.bottom+off]);}
  L.sort((a,b)=>a[0]-b[0]);const lines=[];for(const l of L){const p=lines[lines.length-1];if(p&&l[0]<p[1]-2)p[1]=Math.max(p[1],l[1]);else lines.push([l[0],l[1]]);}
  const end=Math.max(noteEd.scrollHeight,inkBottomPx(),VIEW.minEnd),S=[0];let s=0,i=0;
  while(H>0&&s+H<end&&S.length<5000){const b=s+H;while(i<lines.length&&lines[i][1]<=b+1)i++;let n=b;if(i<lines.length&&lines[i][0]<b&&lines[i][0]-4>s+1)n=Math.floor(lines[i][0]-4);S.push(n);s=n;}   // (a little above the letters: the line's own room)
  VIEW.sk=key;VIEW.starts=S;return S;}
function slideIndex(y){const S=slideStarts();let k=0;for(let i=1;i<S.length&&S[i]<=y;i++)k=i;return k;}
function slidePadMin(){if(VIEW.mode!=='slide'||!H)return 0;const S=slideStarts();return S[S.length-1]+H;}
function slideGo(k,anim){const S=slideStarts();k=Math.max(0,Math.min(S.length-1,k));const d=Math.sign(k-VIEW.k);VIEW.k=k;
  if(Math.abs(wrap.scrollTop-S[k])>=1){updatePad();wrap.scrollTop=S[k];}if(d&&anim!==false)slideAnim(d);redrawInk();}
function slideAnim(d){stage.classList.remove('sl-in-next','sl-in-prev');void stage.offsetWidth;stage.classList.add(d>0?'sl-in-next':'sl-in-prev');clearTimeout(VIEW.at);VIEW.at=setTimeout(()=>stage.classList.remove('sl-in-next','sl-in-prev'),320);}
// next / previous (pageStep comes here too); past the last slide: a new blank one
function slideStep(d){if(VIEW.mode!=='slide')return false;if(drawing||!H)return true;let S=slideStarts();const k=slideIndex(wrap.scrollTop+1);
  if(d<0&&k===0)return true;if(d>0&&k>=S.length-1){VIEW.minEnd=S[S.length-1]+H+2;S=slideStarts();}slideGo(k+d);return true;}
// the page counter, and a cover over the line the bottom edge cuts (it is on the next slide); called from drawPages
function slideInd(){if(VIEW.mode!=='slide'||!H)return false;const S=slideStarts(),st=wrap.scrollTop,k=slideIndex(st+1);
  const pi=document.getElementById('page-ind');if(pi)pi.textContent=(k+1)+' / '+S.length;
  const nx=S[k+1],cut=nx!=null&&nx<st+H-1?nx-st:-1;VIEW.mask.style.display=cut>0?'block':'none';if(cut>0)VIEW.mask.style.top=cut+'px';VIEW.prev.disabled=k===0;return true;}
// the caret (where you type), px down the page; null when you aren't typing
function slideCaretY(){if(document.activeElement!==noteEd)return null;const s=getSelection();if(!s.rangeCount||!noteEd.contains(s.focusNode))return null;
  const r=document.createRange();try{r.setStart(s.focusNode,s.focusOffset);}catch(e){return null;}let b=r.getClientRects()[0];
  if(!b||!b.height){const el=s.focusNode.nodeType===1?s.focusNode:s.focusNode.parentElement;b=el&&el.getBoundingClientRect();}if(!b)return null;return b.top+b.height/2-wrap.getBoundingClientRect().top+wrap.scrollTop;}
// after any scroll (a jump to a highlight, Latest, the caret running off the card): settle on the slide with the caret / the spot it went to
function slideSnap(instant){if(VIEW.mode!=='slide'||!H)return;const st=wrap.scrollTop,S=slideStarts(),c=slideCaretY();
  const k=c!=null&&c>=st&&c<=st+H?slideIndex(c):slideIndex(st+H*.35);if(Math.abs(st-S[k])<1){VIEW.k=k;return;}slideGo(k,!instant);}
function slideWheel(dx,dy,dm,shift){if(VIEW.mode!=='slide')return false;const ax=Math.abs(dx),ay=Math.abs(dy),f=dm===1?30:dm===2?H:1,wide=wrap.scrollWidth>wrap.clientWidth+1;
  if(shift||(wide&&ax>ay)){wrap.scrollLeft+=(shift?(dy||dx):dx)*f;return true;}   // a page wider than the card pans sideways
  const now=performance.now();if(now-VIEW.wt>200){VIEW.wacc=0;VIEW.wused=false;}VIEW.wt=now;if(VIEW.wused)return true;   // one slide per flick
  VIEW.wacc+=(ax>ay?dx:dy)*f;if(Math.abs(VIEW.wacc)>=40){VIEW.wused=true;slideStep(Math.sign(VIEW.wacc));}return true;}
function slideGripWire(g){g.addEventListener('pointerdown',e=>{if(e.button)return;e.preventDefault();e.stopPropagation();g.setPointerCapture(e.pointerId);
    const d=g.dataset.d,top=document.getElementById('bar2').getBoundingClientRect().bottom,cx=innerWidth/2,cy=top+(innerHeight-top)/2,u={w:VIEW.sw,h:VIEW.sh};stage.classList.add('sl-sizing');let raf=0;
    const mv=ev=>{if(/[ew]/.test(d))u.w=Math.round(Math.abs(ev.clientX-cx)*2);if(/[ns]/.test(d))u.h=Math.round(Math.abs(ev.clientY-cy)*2);
      if(!raf)raf=requestAnimationFrame(()=>{raf=0;VIEW.user={w:u.w,h:u.h};slideApply();dispatchEvent(new Event('resize'));VIEW.size.textContent=VIEW.sw+' × '+VIEW.sh;});};
    const up=()=>{g.removeEventListener('pointermove',mv);g.removeEventListener('pointerup',up);g.removeEventListener('pointercancel',up);stage.classList.remove('sl-sizing');VIEW.user={w:VIEW.sw,h:VIEW.sh};viewLS('pw-slide',VIEW.user);slideSnap(true);};
    g.addEventListener('pointermove',mv);g.addEventListener('pointerup',up);g.addEventListener('pointercancel',up);});
  g.addEventListener('dblclick',()=>{VIEW.user=null;viewLS('pw-slide',null);slideApply();dispatchEvent(new Event('resize'));});}
if(!IS_MINI){
  stage.addEventListener('wheel',e=>{if(VIEW.mode!=='slide'||e.ctrlKey||e.metaKey)return;e.preventDefault();e.stopPropagation();slideWheel(e.deltaX,e.deltaY,e.deltaMode,e.shiftKey);},{capture:true,passive:false});
  wrap.addEventListener('scroll',()=>{if(VIEW.mode!=='slide')return;clearTimeout(VIEW.st);VIEW.st=setTimeout(()=>slideSnap(),110);},{passive:true});
  noteEd.addEventListener('input',()=>{VIEW.inN++;});
  // typing / clicking / arrow keys take you to the slide with the caret
  document.addEventListener('selectionchange',()=>{if(VIEW.mode!=='slide')return;clearTimeout(VIEW.ft);VIEW.ft=setTimeout(()=>{const c=slideCaretY();if(c==null)return;const k=slideIndex(c);if(k!==VIEW.k||Math.abs(wrap.scrollTop-slideStarts()[k])>=1)slideGo(k);},60);});
  addEventListener('keydown',e=>{if(VIEW.mode!=='slide'||e.ctrlKey||e.metaKey||e.altKey)return;const t=e.target,typing=/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||'')||t.isContentEditable;if(typing)return;
    const d={ArrowRight:1,ArrowLeft:-1,PageDown:1,PageUp:-1}[e.key];if(d){e.preventDefault();slideStep(d);}},true);
  // touch: swipe left / right (or up / down) for the next / previous slide
  let _tx=null;stage.addEventListener('touchstart',e=>{_tx=VIEW.mode==='slide'&&e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;},{passive:true});
  stage.addEventListener('touchend',e=>{if(!_tx||VIEW.mode!=='slide'||isDraw(mode)||mode==='marker')return;const t=e.changedTouches[0],dx=t.clientX-_tx.x,dy=t.clientY-_tx.y;_tx=null;
    if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.3)slideStep(dx<0?1:-1);else if(Math.abs(dy)>70&&Math.abs(dy)>Math.abs(dx)*1.3)slideStep(dy<0?1:-1);},{passive:true});
  // after the app's own resize handler: keep the second page / the card in place (and nothing but Standard while in a class)
  addEventListener('resize',()=>{if(VIEW.mode!=='std'&&viewInClass()){viewSet('std',true);toast('Back to the Standard view while you are in a class','info');return;}
    if(VIEW.mode==='dual')dualPlace();if(VIEW.mode==='slide'){if(slideApply())layout();VIEW.sk=null;slideSnap(true);}});
  const m=viewLS('pw-view');if(m==='dual'||m==='slide'){VIEW.mode=m;if(m==='dual')dualOn();else slideOn();}
  viewBtn();document.getElementById('view-btn').addEventListener('click',e=>viewMenu(e.currentTarget));}
// called by the app: once it has opened its first page / after every page it opens
function viewBoot(){VIEW.booted=true;if(IS_DUAL){try{const p=parent,[c,s]=p.viewInkNow();viewTake(p.viewCurMode(),c,s);p.viewAct(p.viewActive());}catch(e){}return;}if(VIEW.mode==='dual')dualLoad();}
function viewPageLoaded(){VIEW.minEnd=0;VIEW.sk=null;if(VIEW.mode==='slide'&&slideApply())layout();}
