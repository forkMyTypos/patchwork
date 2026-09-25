"use strict";
/* ===== Explorer: look around everything made with the Highlight Factory =====
   Search across highlights, their types, profiles, card fields, tags, links and projects. Read-only; click to jump. */
let explorer=null;
const EX={q:'',types:new Set(),scope:'all',profile:'',status:'any',tag:'',group:'type',sort:'new'};
function ensureExplorer(){if(explorer)return explorer;explorer=document.createElement('div');explorer.id='explorer';explorer.style.display='none';
  explorer.innerHTML='<div class="ex-card"><div class="ex-head"><div class="panel-ic"><svg width="15" height="15" viewBox="0 0 24 24" stroke="#818cf8" stroke-width="2" fill="none" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/></svg></div><div class="panel-t">Explore highlights</div><button class="panel-x" title="Close (Esc)">\u00d7</button></div>'+
  '<div class="ex-top"><input class="pf-in ex-q" placeholder="Search words, card fields, tags, types, projects\u2026"><div class="ex-row ex-opts"></div><div class="ex-row ex-types"></div><div class="ex-row ex-tags"></div><div class="ex-sum"></div></div><div class="ex-res"></div></div>';
  document.body.appendChild(explorer);
  explorer.querySelector('.panel-x').onclick=closeExplorer;explorer.onclick=e=>{if(e.target===explorer)closeExplorer();};
  const q=explorer.querySelector('.ex-q');q.oninput=()=>{EX.q=q.value;renderExplorer();};
  return explorer;}
function openExplorer(){ensureExplorer();explorer.style.display='flex';const q=explorer.querySelector('.ex-q');q.value=EX.q;renderExplorer();setTimeout(()=>q.focus(),30);}
function closeExplorer(){if(explorer)explorer.style.display='none';}
function refreshExplorer(){if(explorer&&explorer.style.display!=='none')renderExplorer();}
function exPool(){return marks.filter(m=>searchable(m)&&!isLegacyAutoStamp(m));}
function exMatch(m,skip){
  if(skip!=='scope'&&EX.scope==='page'&&m.pid!==pid)return false;
  if(skip!=='profile'&&EX.profile){const P=PROFILES.find(p=>p.id===EX.profile);if(P&&!P.types.includes(m.type))return false;}
  if(skip!=='types'&&EX.types.size&&!EX.types.has(m.type))return false;
  if(skip!=='status'){if(EX.status==='open'&&(!ht(m.type).checkable||m.done))return false;if(EX.status==='done'&&!m.done)return false;if(EX.status==='linked'&&!((m.links&&m.links.length)||marks.some(q=>(q.links||[]).includes(m.id))))return false;}
  if(skip!=='tag'&&EX.tag&&!(m.tags||[]).includes(EX.tag))return false;
  if(EX.q.trim()){const words=EX.q.toLowerCase().split(/\s+/).filter(Boolean);const hay=markText(m);if(!words.every(w=>hay.includes(w)))return false;}
  return true;}
function renderExplorer(){const ex=explorer;if(!ex)return;const pool=exPool();
  // options row
  const opts=ex.querySelector('.ex-opts');opts.innerHTML='';
  const seg=(items,key)=>{const g=document.createElement('div');g.className='ex-seg';items.forEach(([v,l])=>{const b=document.createElement('button');b.className='sp-f'+(EX[key]===v?' on':'');b.textContent=l;b.onclick=()=>{EX[key]=v;renderExplorer();};g.appendChild(b);});opts.appendChild(g);};
  seg([['all','All projects'],['page','This project']],'scope');
  seg([['any','Any'],['open','Open'],['done','Done'],['linked','Linked']],'status');
  const ps=document.createElement('select');ps.className='fx-sel ex-sel';ps.innerHTML='<option value="">Any profile</option>'+PROFILES.map(p=>'<option value="'+esc(p.id)+'"'+(EX.profile===p.id?' selected':'')+'>'+esc(p.name)+'</option>').join('');ps.onchange=()=>{EX.profile=ps.value;renderExplorer();};opts.appendChild(ps);
  const gs=document.createElement('select');gs.className='fx-sel ex-sel';[['type','Group by type'],['project','Group by project'],['tag','Group by tag'],['day','Group by day'],['none','No grouping']].forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;if(EX.group===v)o.selected=true;gs.appendChild(o);});gs.onchange=()=>{EX.group=gs.value;renderExplorer();};opts.appendChild(gs);
  const so=document.createElement('button');so.className='sp-f';so.textContent=EX.sort==='new'?'Newest first':'Oldest first';so.onclick=()=>{EX.sort=EX.sort==='new'?'old':'new';renderExplorer();};opts.appendChild(so);
  // type chips with live counts (counts ignore the type filter itself)
  const tr=ex.querySelector('.ex-types');tr.innerHTML='';const tc={};pool.filter(m=>exMatch(m,'types')).forEach(m=>tc[m.type]=(tc[m.type]||0)+1);
  const typeIds=[...new Set([...activeTypeIds(),...pool.map(m=>m.type)])].filter(t=>tc[t]||EX.types.has(t)||activeTypeIds().includes(t));
  typeIds.forEach(t=>{const T=mtype(t);const c=document.createElement('button');c.className='ex-chip'+(EX.types.has(t)?' on':'');c.innerHTML='<span class="fdot" style="background:'+T.c+'"></span>'+esc(T.name)+'<span class="fcnt">'+(tc[t]||0)+'</span>';c.onclick=()=>{if(EX.types.has(t))EX.types.delete(t);else EX.types.add(t);renderExplorer();};tr.appendChild(c);});
  if(EX.types.size){const clr=document.createElement('button');clr.className='fx-link';clr.textContent='clear';clr.onclick=()=>{EX.types.clear();renderExplorer();};tr.appendChild(clr);}
  // tags
  const tg=ex.querySelector('.ex-tags');tg.innerHTML='';const tcount={};pool.filter(m=>exMatch(m,'tag')).forEach(m=>(m.tags||[]).forEach(x=>tcount[x]=(tcount[x]||0)+1));const tags=Object.keys(tcount).sort((a,b)=>tcount[b]-tcount[a]).slice(0,24);
  if(tags.length||EX.tag){tg.innerHTML='<span class="pf-l" style="margin-right:4px">Tags</span>';(EX.tag&&!tags.includes(EX.tag)?[EX.tag,...tags]:tags).forEach(x=>{const c=document.createElement('button');c.className='chip ex-tag'+(EX.tag===x?' on':'');c.textContent='#'+x+' '+(tcount[x]||0);c.onclick=()=>{EX.tag=EX.tag===x?'':x;renderExplorer();};tg.appendChild(c);});}
  // results
  const res=pool.filter(m=>exMatch(m)).sort((a,b)=>EX.sort==='new'?b.created-a.created:a.created-b.created);
  const nTypes=new Set(res.map(m=>m.type)).size,nProj=new Set(res.map(m=>m.pid)).size;
  ex.querySelector('.ex-sum').textContent=res.length+' highlight'+(res.length!==1?'s':'')+' \u00b7 '+nTypes+' type'+(nTypes!==1?'s':'')+' \u00b7 '+nProj+' project'+(nProj!==1?'s':'')+(pool.length!==res.length?'  (of '+pool.length+')':'');
  const box=ex.querySelector('.ex-res');box.innerHTML='';
  if(!res.length){box.innerHTML='<div class="sr-empty">'+(pool.length?'Nothing matches \u2014 loosen a filter.':'No highlights yet. Select some text on the page and pick a type.')+'</div>';return;}
  const keyOf=m=>EX.group==='type'?m.type:EX.group==='project'?String(m.pid):EX.group==='tag'?((m.tags&&m.tags[0])||''):EX.group==='day'?new Date(m.created).toDateString():'';
  const groups=new Map();res.forEach(m=>{const ks=EX.group==='tag'?((m.tags&&m.tags.length)?m.tags:['']):[keyOf(m)];ks.forEach(k=>{if(!groups.has(k))groups.set(k,[]);groups.get(k).push(m);});});
  const title=k=>EX.group==='type'?'<span class="fdot" style="background:'+mtype(k).c+'"></span>'+esc(mtype(k).name):EX.group==='project'?esc(projName(+k)):EX.group==='tag'?(k?'#'+esc(k):'untagged'):EX.group==='day'?esc(dayLabel(new Date(k).getTime())+' \u00b7 '+new Date(k).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'})):'';
  const hl=(txt)=>{let h=esc(txt);const words=EX.q.toLowerCase().split(/\s+/).filter(w=>w.length>1);words.forEach(w=>{h=h.replace(new RegExp('('+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig'),'<mark>$1</mark>');});return h;};
  let shown=0;
  for(const [k,items] of groups){if(shown>400)break;
    if(EX.group!=='none'){const gh=document.createElement('div');gh.className='ex-gh';gh.innerHTML=title(k)+'<span class="fcnt">'+items.length+'</span>';box.appendChild(gh);}
    const grid=document.createElement('div');grid.className='ex-grid';box.appendChild(grid);
    for(const m of items){if(++shown>400)break;const T=mtype(m.type),H=ht(m.type);const card=document.createElement('div');card.className='ex-item';card.style.setProperty('--c',T.c);
      const text=m.snippet||m.name||'(untitled)';
      let h='<div class="ex-it-top"><span class="sr-b" style="background:'+T.bg+';color:'+T.c+'">'+esc(T.label)+'</span>'+(H.checkable?'<span class="ex-st'+(m.done?' done':'')+'">'+(m.done?'\u2713 done':'open')+'</span>':'')+'<span class="ex-when">'+esc(fmtAbs(m.created))+'</span></div>';
      h+='<div class="ex-snip'+(m.done?' done':'')+'">'+hl(text)+'</div>';
      if(m.name&&m.snippet&&m.name.trim()!==m.snippet.trim().slice(0,80))h+='<div class="ex-name">'+hl(m.name)+'</div>';
      const fl=(H.fields||[]).filter(f=>m.fields&&m.fields[f.id]&&m.fields[f.id].trim());
      if(fl.length)h+='<dl class="ex-fields">'+fl.map(f=>'<dt>'+esc(f.label)+'</dt><dd>'+hl(m.fields[f.id])+'</dd>').join('')+'</dl>';
      const meta=[];if(m.pid!==pid||EX.scope==='all')meta.push('<span class="sr-proj">\u25a0 '+esc(projName(m.pid))+'</span>');(m.tags||[]).forEach(x=>meta.push('<span class="ex-mtag">#'+esc(x)+'</span>'));
      h+='<div class="ex-meta">'+meta.join('')+'</div>';card.innerHTML=h;
      const links=[...(m.links||[]).map(id=>({m:markById(id),dir:'\u2192'})),...marks.filter(q=>(q.links||[]).includes(m.id)).map(q=>({m:q,dir:'\u2190'}))].filter(x=>x.m);
      if(links.length){const lw=document.createElement('div');lw.className='ex-links';links.slice(0,6).forEach(({m:o,dir})=>{const c=document.createElement('span');c.className='chip link';c.innerHTML=dir+' <span class="fdot" style="background:'+mtype(o.type).c+'"></span>'+esc((o.snippet||o.name||'(untitled)').slice(0,40));c.onclick=e=>{e.stopPropagation();closeExplorer();jumpToMark(o);};lw.appendChild(c);});card.appendChild(lw);}
      card.onclick=()=>{closeExplorer();jumpToMark(m);};grid.appendChild(card);}}
  if(shown>400){const more=document.createElement('div');more.className='sr-empty';more.textContent='Showing the first 400 \u2014 narrow the search to see the rest.';box.appendChild(more);}}
document.getElementById('side-explore').addEventListener('click',()=>{toggleSide(false);openExplorer();});
document.getElementById('explore-btn').addEventListener('click',()=>{if(explorer&&explorer.style.display!=='none')closeExplorer();else openExplorer();});
addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='f'){e.preventDefault();openExplorer();return;}if(e.key==='Escape'&&explorer&&explorer.style.display!=='none')closeExplorer();},true);
