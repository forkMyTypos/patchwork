"use strict";
/* ===== free pictures =====
   A free picture sits anywhere on the page, like ink (db.pics), above the text and below the ink. Position and size are
   in page units (like new ink, u:1: screen px = units*inkW) and it is anchored to a paragraph (a={p,top}) so it moves with
   the text the way ink does (inkDy/reanchor). Pick it with a click (text tool) or with Select & move; drag to move, the
   corner handle resizes (keeps proportions), its menu turns it into an in-line picture or deletes it. Undo/redo go
   through hostUndo ('pic' token). In-line pictures (part of the text) are still handled by the editor. */
let pics=[],picSel=null,_picU=[],_picR=[],_picDrag=null;
const picLayer=document.createElement('div');picLayer.id='pics';pad.appendChild(picLayer);
const _picEl=new WeakMap();
const PIC_KEYS=['pid','src','x','y','w','h','u','minYn','maxYn','a','t','del','kind'];
function picClean(p){const o={};for(const k of PIC_KEYS)if(p[k]!==undefined)o[k]=p[k];if(p.id!=null)o.id=p.id;return o;}
function picSnap(p){return{x:p.x,y:p.y,w:p.w,h:p.h,minYn:p.minYn,maxYn:p.maxYn,a:p.a?{...p.a}:undefined};}
function picFix(p){p.minYn=p.y;p.maxYn=p.y+p.h;}
async function picsLoad(){pics=(await db.pics.where('pid').equals(pid).toArray()).filter(p=>!p.del);picSel=null;_picU=[];_picR=[];picLayer.textContent='';}
function savePic(p){db.pics.put(picClean(p)).catch(e=>console.error(e));}

/* ---- drawing (DOM images in the page, so they scroll with it) ---- */
function renderPics(){const U=inkW,keep=new Set();
  for(const p of pics){let el=_picEl.get(p);if(!el){el=document.createElement('div');el.className='pic';el.innerHTML='<img alt="" draggable="false"><div class="pic-h" title="Drag to resize"></div>';_picEl.set(p,el);el._pic=p;}
    keep.add(el);if(el.parentNode!==picLayer)picLayer.appendChild(el);const img=el.firstChild,src=picSrc(p);if(src&&img.getAttribute('src')!==src)img.setAttribute('src',src);
    el.style.left=(gutter+p.x*U)+'px';el.style.top=(p.y*U+inkDy(p))+'px';el.style.width=(p.w*U)+'px';el.style.height=(p.h*U)+'px';el.classList.toggle('on',p===picSel);}
  for(const el of [...picLayer.children])if(!keep.has(el))el.remove();picMenuPos();}
const _picAsked=new Set();
function picSrc(p){const h=imgHashOf(p.src);if(!h)return p.src;const u=IMG_URLS.get(h);if(u)return u;if(!_picAsked.has(h)){_picAsked.add(h);loadImages([h]).then(()=>{if(IMG_URLS.has(h))renderPics();});}return null;}   // ask once per picture
function picsBottomPx(){let mx=0;for(const p of pics){const b=(p.y+p.h)*inkW+inkDy(p);if(b>mx)mx=b;}return mx;}

/* ---- adding: pasted / dropped / inserted pictures ---- */
// at: {clientX,clientY,w?} where to put the top-left corner (screen), or null = at the caret / top of what you see
async function addFreePicture(src,at){if(!editor||pid==null)return;
  if(/^data:image\//.test(src)){try{src=await storeDataURL(src);}catch(e){toast('Couldn’t store that picture','err');return;}}
  const im=new Image();await new Promise(r=>{im.onload=im.onerror=r;im.src=/^pw-img:/.test(src)?picSrc({src})||'':src;setTimeout(r,4000);});
  let nw=im.naturalWidth||300,nh=im.naturalHeight||200;const wpx=at&&at.w?at.w:Math.max(24,Math.min(nw,drawW*0.6));let w=wpx,h=nh*wpx/nw;
  if(!(at&&at.w)&&h>H*0.7){h=H*0.7;w=h*nw/nh;}
  const wr=wrap.getBoundingClientRect();let px,py;
  if(at){px=at.clientX-wr.left+wrap.scrollLeft;py=at.clientY-wr.top+wrap.scrollTop;}
  else{const s=getSelection();let r=null;if(s&&s.rangeCount&&noteEd.contains(s.anchorNode))r=s.getRangeAt(0).getClientRects()[0];
    if(r){px=r.left-wr.left+wrap.scrollLeft;py=r.bottom-wr.top+wrap.scrollTop+6;}else{px=gutter+24+wrap.scrollLeft;py=wrap.scrollTop+40;}}
  const U=inkW,p={pid,kind:'pic',src,u:1,x:Math.max(0,(px-gutter)/U),y:Math.max(0,py/U),w:w/U,h:h/U,t:Date.now()};picFix(p);p._dy=0;reanchor(p);
  p.id=await db.pics.add(picClean(stripId(p)));pics.push(p);picRecord(p,null);picPick(p);updatePad();updateHint();}

/* ---- undo ---- */
function picRecord(p,before){_picU.push({p,before,after:p.del?null:picSnap(p)});_picR=[];_uTokens.push('pic');_rTokens=[];}
function picApply(p,st){if(!st){p.del=Date.now();pics=pics.filter(q=>q!==p);if(picSel===p)picUnpick();}else{Object.assign(p,st);delete p.del;if(!pics.includes(p))pics.push(p);}savePic(p);renderPics();updatePad();updateHint();}
function picUndo(){const a=_picU.pop();if(!a)return;_picR.push(a);picApply(a.p,a.before);}
function picRedo(){const a=_picR.pop();if(!a)return;_picU.push(a);picApply(a.p,a.after);}

/* ---- picking, moving, resizing ---- */
let picMenu=null;
function picPick(p){picSel=p;if(document.activeElement===noteEd)noteEd.blur();if(editor&&editor.hasPickedImage())editor.unpickImage();renderPics();}
function picUnpick(){if(!picSel)return;picSel=null;renderPics();}
function picMenuPos(){if(!picSel){if(picMenu)picMenu.style.display='none';return;}const el=_picEl.get(picSel);if(!el)return;
  if(!picMenu){picMenu=document.createElement('div');picMenu.className='pic-menu';picMenu.innerHTML='<button class="pm-inline" title="Make it part of the text, where it is">In line</button><button class="pm-del" title="Delete (Del)">Delete</button>';
    picMenu.addEventListener('pointerdown',e=>e.stopPropagation());picMenu.querySelector('.pm-del').onclick=()=>picDelete();picMenu.querySelector('.pm-inline').onclick=()=>picToInline();}
  if(picMenu.parentNode!==document.body)document.body.appendChild(picMenu);const r=el.getBoundingClientRect(),vt=wrap.getBoundingClientRect().top;
  if(r.bottom<vt||r.top>innerHeight){picMenu.style.display='none';return;}picMenu.style.display='flex';picMenu.style.left=Math.max(4,r.left)+'px';picMenu.style.top=(r.top-34<vt+4?Math.max(vt+4,r.top+6):r.top-34)+'px';}
function picDelete(){const p=picSel;if(!p)return;const b=picSnap(p);picUnpick();p.del=Date.now();pics=pics.filter(q=>q!==p);savePic(p);picRecord(p,b);renderPics();updatePad();updateHint();}
function picAt(x,y){for(const el of document.elementsFromPoint(x,y)){const d=el.closest&&el.closest('.pic');if(d&&d._pic&&picLayer.contains(d))return{p:d._pic,handle:!!(el.closest('.pic-h'))};}return null;}
function picStartDrag(p,e,handle){picPick(p);_picDrag={p,x:e.clientX,y:e.clientY,orig:picSnap(p),handle,moved:false};document.body.classList.add('pic-dragging');}
picLayer.addEventListener('pointerdown',e=>{const d=e.target.closest('.pic');if(!d||!d._pic||(e.button!==undefined&&e.button!==0))return;e.preventDefault();e.stopPropagation();picStartDrag(d._pic,e,!!e.target.closest('.pic-h'));});
document.addEventListener('pointermove',e=>{const g=_picDrag;if(!g)return;const U=inkW,dx=(e.clientX-g.x)/U,dy=(e.clientY-g.y)/U;if(!g.moved&&Math.hypot(e.clientX-g.x,e.clientY-g.y)<3)return;g.moved=true;const p=g.p,o=g.orig;
  if(g.handle){const w=Math.max(16/U,o.w+dx);p.w=w;p.h=w*o.h/o.w;}else{p.x=Math.max(0,o.x+dx);p.y=o.y+dy;}picFix(p);renderPics();});
document.addEventListener('pointerup',()=>{const g=_picDrag;if(!g)return;_picDrag=null;document.body.classList.remove('pic-dragging');if(!g.moved)return;const p=g.p;p._dy=inkDy(p);reanchor(p);savePic(p);picRecord(p,g.orig);renderPics();updatePad();});
// a press anywhere else unpicks; Del removes the picked picture, Esc unpicks
document.addEventListener('pointerdown',e=>{if(picSel&&!(e.target.closest&&(e.target.closest('.pic')||e.target.closest('.pic-menu'))))picUnpick();},true);
addEventListener('keydown',e=>{if(!picSel||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable)return;
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();picDelete();}else if(e.key==='Escape')picUnpick();});

/* ---- converting: free <-> in line ---- */
function picToInline(){const p=picSel;if(!p||!editor)return;const el=_picEl.get(p),r=el.getBoundingClientRect();
  let pi=-1;noteEd.querySelectorAll(':scope > .line').forEach((l,i)=>{if(l.getBoundingClientRect().top<=r.top+4)pi=i;});   // goes on its own line under the paragraph it sits beside
  const pct=Math.max(10,Math.min(100,Math.round(p.w*inkW/Math.max(40,drawW-20)*100)));
  const b=picSnap(p);picUnpick();p.del=Date.now();pics=pics.filter(q=>q!==p);savePic(p);picRecord(p,b);renderPics();editor.insertImageLine(pi,p.src,pct);}
// the editor's picture menu: an in-line picture becomes free, same place and size
function inlineToFree(src,rect){addFreePicture(src,{clientX:rect.left,clientY:rect.top,w:rect.width});}
