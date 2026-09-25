"use strict";
/* ===== highlight types + profiles: storage ===== */
async function loadHighlightTypes(){
  try{
    let rows=await db.htypes.toArray();
    if(!rows.length){rows=BUILTIN_TYPES.map(t=>Object.assign({},t,{created:0}));await db.htypes.bulkPut(rows);}
    HT.clear();rows.forEach(t=>HT.set(t.id,t));
    let profs=await db.profiles.toArray();
    if(!profs.length){profs=[{id:'default',name:'Default',types:['note','task','question','answer'],hidden:[],order:0}];await db.profiles.bulkPut(profs);}
    PROFILES=profs.sort((a,b)=>(a.order||0)-(b.order||0));
    const inf=await db.info.get('info');activeProfileId=(inf&&inf.activeProfile&&PROFILES.some(p=>p.id===inf.activeProfile))?inf.activeProfile:PROFILES[0].id;
  }catch(e){console.error('highlight types',e);}
  buildTagbar();
}
function newId(prefix){return prefix+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
function saveType(t){HT.set(t.id,t);db.htypes.put(t).catch(_quotaToast);typesChanged();}
function saveProfiles(){PROFILES.forEach((p,i)=>p.order=i);db.profiles.bulkPut(PROFILES).catch(_quotaToast);}
function typeUsage(id){let n=0;for(const m of marks)if(m.type===id)n++;return n;}
let _typesT=null;
function typesChanged(){buildTagbar();clearTimeout(_typesT);_typesT=setTimeout(()=>{if(editor)editor.refresh();const sd=document.getElementById('side');if(sd&&sd.classList.contains('open'))buildFilterBar();redrawInk();if(popup&&popup.style.display!=='none'&&popupMark)buildPopupBody(popupMark);if(typeof refreshExplorer==='function')refreshExplorer();},60);}
function setActiveProfile(id){activeProfileId=id;db.info.update('info',{activeProfile:id}).catch(()=>{});typesChanged();}

/* ===== the Highlight Factory: a small workshop for the tools you mark your page with ===== */
let factory=null,fxOpenId=null,fxApplyNext=false;
const FX_KEYS=[['bg','Background'],['ul','Underline'],['tc','Text colour'],['b','Bold'],['i','Italic'],['s','Strike']];
function ensureFactory(){if(factory)return factory;factory=document.createElement('div');factory.className='panel factory';factory.style.display='none';
  factory.innerHTML='<div class="panel-h"><div class="panel-ic"><svg width="15" height="15" viewBox="0 0 24 24" stroke="#fbbf24" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M5 20V10l4 3V10l4 3V6h3l1 14"/></svg></div><div class="panel-t">Highlight Factory</div><button class="panel-x">×</button></div><div class="panel-b" id="fx-body"></div>';
  document.body.appendChild(factory);factory.querySelector('.panel-x').onclick=closeFactory;makeDraggable(factory,factory.querySelector('.panel-h'));return factory;}
function openFactory(o){o=o||{};ensureFactory();fxApplyNext=!!o.applyToSelection;if(o.create){const t=createType();fxOpenId=t.id;}else if(o.focus)fxOpenId=o.focus;
  if(factory.style.display==='none'){factory.style.display='flex';factory.style.left=Math.max(8,Math.min(window.innerWidth-470,window.innerWidth-490))+'px';factory.style.top='64px';factory.style.right='auto';}
  renderFactory();if(o.create)setTimeout(()=>{const n=factory.querySelector('.fx-name');if(n){n.focus();n.select();}},40);}
function closeFactory(){if(factory)factory.style.display='none';fxApplyNext=false;}
function createType(){const used=new Set([...HT.values()].map(t=>t.color));const color=COLOR_PALETTE.slice(4).find(c=>!used.has(c))||'#60a5fa';
  const t={id:newId('ht_'),name:'New type',color,fx:{bg:true,ul:true},margin:true,checkable:false,links:[],fields:[],created:Date.now()};
  saveType(t);const p=activeProfile();p.types.push(t.id);saveProfiles();return t;}
function renderFactory(){if(!factory||factory.style.display==='none')return;const body=factory.querySelector('#fx-body');const keepScroll=body.scrollTop;body.innerHTML='';const P=activeProfile();
  // profile row
  const pr=document.createElement('div');pr.className='fx-prof';
  const sel=document.createElement('select');sel.className='fx-sel';PROFILES.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;if(p.id===P.id)o.selected=true;sel.appendChild(o);});sel.onchange=()=>{setActiveProfile(sel.value);fxOpenId=null;renderFactory();toast('Profile: '+activeProfile().name,'info');};
  const btn=(txt,title,fn,cls)=>{const b=document.createElement('button');b.className='fx-ib'+(cls?' '+cls:'');b.textContent=txt;b.title=title;b.onclick=fn;return b;};
  pr.innerHTML='<span class="pf-l">Profile</span>';pr.appendChild(sel);
  pr.appendChild(btn('✎','Rename profile',()=>{const n=(prompt('Rename profile',P.name)||'').trim();if(n){P.name=n.slice(0,40);saveProfiles();renderFactory();}}));
  pr.appendChild(btn('⧉','Duplicate profile (copies its types, so you can change them freely)',()=>{const n=(prompt('Name for the copy',P.name+' — copy')||'').trim();if(!n)return;const idmap={};const types=P.types.map(id=>{const o=HT.get(id);if(!o)return null;const c=JSON.parse(JSON.stringify(o));c.id=newId('ht_');c.builtin=false;c.created=Date.now();c.copiedFrom=o.id;idmap[o.id]=c.id;return c;}).filter(Boolean);types.forEach(c=>{c.links=(c.links||[]).map(x=>idmap[x]||x);saveType(c);});const np={id:newId('pf_'),name:n.slice(0,40),types:types.map(c=>c.id),hidden:(P.hidden||[]).map(x=>idmap[x]).filter(Boolean)};PROFILES.push(np);saveProfiles();setActiveProfile(np.id);renderFactory();toast('Duplicated — the original is unchanged','ok');}));
  pr.appendChild(btn('+','New empty profile',()=>{const n=(prompt('New profile name','')||'').trim();if(!n)return;const np={id:newId('pf_'),name:n.slice(0,40),types:[],hidden:[]};PROFILES.push(np);saveProfiles();setActiveProfile(np.id);renderFactory();}));
  const del=btn('🗑','Delete profile (its types stay available)',()=>{if(PROFILES.length<=1){toast('Keep at least one profile','err');return;}if(!del.classList.contains('armed')){del.classList.add('armed');del.textContent='✓?';setTimeout(()=>{del.classList.remove('armed');del.textContent='🗑';},2500);return;}PROFILES=PROFILES.filter(x=>x!==P);db.profiles.delete(P.id).catch(()=>{});saveProfiles();setActiveProfile(PROFILES[0].id);renderFactory();toast('Profile deleted — highlights are untouched','ok');});pr.appendChild(del);
  body.appendChild(pr);
  const hint=document.createElement('div');hint.className='fx-hint';hint.textContent='Select text on the page and these appear in the selection bar, in this order. Drag ⠇⠇ to reorder.';body.appendChild(hint);
  // active / hidden / library
  const vis=P.types.filter(id=>HT.has(id)&&!(P.hidden||[]).includes(id)),hid=P.types.filter(id=>HT.has(id)&&(P.hidden||[]).includes(id)),lib=[...HT.keys()].filter(id=>!P.types.includes(id));
  const sec=(label)=>{const d=document.createElement('div');d.className='fx-sec';d.textContent=label;body.appendChild(d);};
  const list=document.createElement('div');list.className='fx-list';body.appendChild(list);
  if(!vis.length){const e=document.createElement('div');e.className='fx-empty';e.textContent='No highlight types on the selection bar yet.';list.appendChild(e);}
  vis.forEach(id=>list.appendChild(typeRow(id,'on')));enableReorder(list);
  const add=document.createElement('button');add.className='pbtn fx-add';add.textContent='+ New highlight type';add.onclick=()=>openFactory({create:true});body.appendChild(add);
  if(hid.length){sec('Hidden — kept, and their highlights still show');const hl=document.createElement('div');hl.className='fx-list';hid.forEach(id=>hl.appendChild(typeRow(id,'hidden')));body.appendChild(hl);}
  if(lib.length){sec('Not in this profile');const ll=document.createElement('div');ll.className='fx-list';lib.forEach(id=>ll.appendChild(typeRow(id,'lib')));body.appendChild(ll);}
  body.scrollTop=keepScroll;}
function typeRow(id,where){const t=HT.get(id),P=activeProfile();const wrapEl=document.createElement('div');wrapEl.className='fx-item'+(fxOpenId===id?' open':'');wrapEl.dataset.id=id;
  const row=document.createElement('div');row.className='fx-row '+where;
  row.innerHTML=(where==='on'?'<span class="fx-grip" title="Drag to reorder">⠇⠇</span>':'<span class="fx-grip off"></span>')+'<span class="fx-dot" style="background:'+t.color+'"></span><span class="fx-nm"></span><span class="fx-sample"></span><span class="fx-cnt" title="highlights using this type"></span>';
  row.querySelector('.fx-nm').textContent=t.name;row.querySelector('.fx-cnt').textContent=typeUsage(id);
  const sm=row.querySelector('.fx-sample');sm.textContent='Abc';paintSample(sm,t);
  const act=document.createElement('button');act.className='fx-ib';
  if(where==='on'){act.textContent='◉';act.title='Hide from the selection bar';act.onclick=e=>{e.stopPropagation();P.hidden=[...(P.hidden||[]),id];saveProfiles();typesChanged();renderFactory();};}
  else if(where==='hidden'){act.textContent='○';act.title='Show on the selection bar again';act.onclick=e=>{e.stopPropagation();P.hidden=(P.hidden||[]).filter(x=>x!==id);saveProfiles();typesChanged();renderFactory();};}
  else{act.textContent='+';act.title='Add to this profile';act.onclick=e=>{e.stopPropagation();P.types.push(id);saveProfiles();typesChanged();renderFactory();};}
  row.appendChild(act);row.onclick=e=>{if(e.target.closest('.fx-grip'))return;fxOpenId=fxOpenId===id?null:id;renderFactory();};
  wrapEl.appendChild(row);if(fxOpenId===id)wrapEl.appendChild(typeEditor(t,where));return wrapEl;}
function paintSample(el,t){el.className=el.className.replace(/\bmk\S*/g,'').trim();el.style.cssText='';const ms={color:t.color,bg:hexA(t.color,.16),fx:t.fx||{}};el.classList.add('mk');el.style.setProperty('--mk',ms.color);el.style.setProperty('--mkbg',ms.bg);for(const k of ['bg','ul','b','i','s','tc'])if(ms.fx[k])el.classList.add('mk-'+k);}
function typeEditor(t,where){const ed=document.createElement('div');ed.className='fx-ed';const P=activeProfile();
  const field=(label)=>{const f=document.createElement('div');f.className='pf';f.innerHTML='<div class="pf-l">'+label+'</div>';ed.appendChild(f);return f;};
  // name
  const fn=field('Name');const ni=document.createElement('input');ni.className='pf-in fx-name';ni.maxLength=40;ni.value=t.name;ni.oninput=()=>{t.name=ni.value.trim()||'Untitled';saveType(t);const nm=ed.parentNode&&ed.parentNode.querySelector('.fx-nm');if(nm)nm.textContent=t.name;};ni.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();ni.blur();}};fn.appendChild(ni);
  // colour
  const fc=field('Dot colour');const sw=document.createElement('div');sw.className='fx-sw';
  COLOR_PALETTE.slice(4).concat(COLOR_FAVORITES).filter((v,i,a)=>a.indexOf(v)===i).slice(0,18).forEach(c=>{const b=document.createElement('button');b.className='fx-swb'+(c===t.color?' on':'');b.style.background=c;b.title=c;b.onclick=()=>{t.color=c;saveType(t);renderFactory();};sw.appendChild(b);});
  const ci=document.createElement('input');ci.type='color';ci.className='fx-ci';ci.value=normalizeHex(t.color)||'#60a5fa';ci.title='Any colour';ci.onchange=()=>{t.color=ci.value;saveType(t);renderFactory();};sw.appendChild(ci);fc.appendChild(sw);
  // text effect
  const fe=field('What it does to the text');const chips=document.createElement('div');chips.className='fx-fx';t.fx=t.fx||{};
  FX_KEYS.forEach(([k,lb])=>{const b=document.createElement('button');b.className='sp-f'+(t.fx[k]?' on':'');b.textContent=lb;b.onclick=()=>{t.fx[k]=!t.fx[k];saveType(t);b.classList.toggle('on',!!t.fx[k]);paintSample(prev,t);const rs=ed.parentNode&&ed.parentNode.querySelector('.fx-sample');if(rs)paintSample(rs,t);};chips.appendChild(b);});
  fe.appendChild(chips);const prev=document.createElement('div');prev.className='fx-prev';prev.textContent='The quick brown fox';paintSample(prev,t);const pw=document.createElement('div');pw.className='fx-prevwrap';pw.appendChild(document.createTextNode('Preview: '));pw.appendChild(prev);fe.appendChild(pw);
  // behaviour
  const fb=field('Behaviour');const tog=(label,key,help)=>{const l=document.createElement('label');l.className='pf-row';l.title=help||'';const c=document.createElement('input');c.type='checkbox';c.className='pf-cb';c.checked=key==='margin'?t.margin!==false:!!t[key];c.onchange=()=>{t[key]=c.checked;saveType(t);};l.appendChild(c);l.appendChild(document.createTextNode(' '+label));fb.appendChild(l);};
  tog('Show in the margin','margin','Turn off for word-level highlighting (verbs, nouns…) so the margin stays calm');tog('Can be ticked off (like a task)','checkable');
  // links
  const fl=field('Can link to');const lk=document.createElement('div');lk.className='fx-fx';t.links=t.links||[];
  [...HT.values()].forEach(o=>{const b=document.createElement('button');b.className='sp-f'+(t.links.includes(o.id)?' on':'');b.innerHTML='<span class="tb-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:'+o.color+';margin-right:5px"></span>'+esc(o.name);b.onclick=()=>{if(t.links.includes(o.id))t.links=t.links.filter(x=>x!==o.id);else t.links=[...t.links,o.id];saveType(t);b.classList.toggle('on',t.links.includes(o.id));};lk.appendChild(b);});
  fl.appendChild(lk);
  // card fields
  const ff=field('Card fields — shown when you click one of these highlights');t.fields=t.fields||[];const fl2=document.createElement('div');fl2.className='fx-fields';
  const drawFields=()=>{fl2.innerHTML='';t.fields.forEach((f,i)=>{const r=document.createElement('div');r.className='fx-frow';const inp=document.createElement('input');inp.className='pf-in';inp.value=f.label;inp.maxLength=40;inp.oninput=()=>{f.label=inp.value.trim()||'Field';saveType(t);};const x=document.createElement('button');x.className='fx-ib';x.textContent='×';x.title='Remove field (values already typed are kept)';x.onclick=()=>{t.fields.splice(i,1);saveType(t);drawFields();};r.appendChild(inp);r.appendChild(x);fl2.appendChild(r);});};
  drawFields();ff.appendChild(fl2);const af=document.createElement('button');af.className='pbtn';af.textContent='+ field';af.onclick=()=>{t.fields.push({id:newId('f_'),label:'Field '+(t.fields.length+1)});saveType(t);drawFields();const ins=fl2.querySelectorAll('input');if(ins.length){ins[ins.length-1].focus();ins[ins.length-1].select();}};ff.appendChild(af);
  // footer
  const ft=document.createElement('div');ft.className='fx-foot';const used=typeUsage(t.id);
  if(fxApplyNext){const ap=document.createElement('button');ap.className='fx-primary';ap.textContent='Highlight my selection';ap.onclick=()=>{fxApplyNext=false;tagSelection(t.id);renderFactory();};ft.appendChild(ap);}
  if(where!=='lib'){const rm=document.createElement('button');rm.className='fx-link';rm.textContent='Remove from profile';rm.title='The type stays available under “Not in this profile”';rm.onclick=()=>{P.types=P.types.filter(x=>x!==t.id);P.hidden=(P.hidden||[]).filter(x=>x!==t.id);saveProfiles();fxOpenId=null;typesChanged();renderFactory();};ft.appendChild(rm);}
  if(used){const mg=document.createElement('select');mg.className='fx-sel';mg.innerHTML='<option value="">Merge '+used+' highlight'+(used>1?'s':'')+' into…</option>';[...HT.values()].filter(o=>o.id!==t.id).forEach(o=>{const op=document.createElement('option');op.value=o.id;op.textContent=o.name;mg.appendChild(op);});mg.onchange=async()=>{const to=mg.value;if(!to)return;for(const m of marks)if(m.type===t.id){m.type=to;await db.marks.update(m.id,{type:to});}removeTypeEverywhere(t.id);toast('Merged into '+ht(to).name,'ok');};ft.appendChild(mg);}
  else{const dl=document.createElement('button');dl.className='fx-link danger';dl.textContent='Delete type';dl.onclick=()=>{if(!dl.classList.contains('armed')){dl.classList.add('armed');dl.textContent='Click again to delete';setTimeout(()=>{dl.classList.remove('armed');dl.textContent='Delete type';},2500);return;}removeTypeEverywhere(t.id);};ft.appendChild(dl);}
  ed.appendChild(ft);return ed;}
function removeTypeEverywhere(id){if(typeUsage(id)){toast('Still used by highlights — merge them first','err');return;}HT.delete(id);db.htypes.delete(id).catch(()=>{});PROFILES.forEach(p=>{p.types=p.types.filter(x=>x!==id);p.hidden=(p.hidden||[]).filter(x=>x!==id);});for(const t of HT.values())if((t.links||[]).includes(id)){t.links=t.links.filter(x=>x!==id);db.htypes.put(t).catch(()=>{});}saveProfiles();fxOpenId=null;typesChanged();renderFactory();}
// pointer-based drag reorder (works with mouse and touch)
function enableReorder(list){list.querySelectorAll('.fx-grip:not(.off)').forEach(g=>{g.onpointerdown=e=>{e.preventDefault();const item=g.closest('.fx-item');const items=[...list.children];item.classList.add('dragging');g.setPointerCapture(e.pointerId);
  const move=ev=>{const others=[...list.querySelectorAll('.fx-item:not(.dragging)')];let before=null;for(const o of others){const r=o.getBoundingClientRect();if(ev.clientY<r.top+r.height/2){before=o;break;}}list.insertBefore(item,before);};
  const up=()=>{g.removeEventListener('pointermove',move);g.removeEventListener('pointerup',up);g.removeEventListener('pointercancel',up);item.classList.remove('dragging');const P=activeProfile();const order=[...list.querySelectorAll('.fx-item')].map(x=>x.dataset.id);P.types=[...order,...P.types.filter(x=>!order.includes(x))];saveProfiles();typesChanged();};
  g.addEventListener('pointermove',move);g.addEventListener('pointerup',up);g.addEventListener('pointercancel',up);};});}
document.getElementById('factory-btn').addEventListener('click',()=>{if(factory&&factory.style.display!=='none')closeFactory();else openFactory();});
addEventListener('keydown',e=>{if(e.key==='Escape'&&factory&&factory.style.display!=='none'&&!e.defaultPrevented)closeFactory();});
