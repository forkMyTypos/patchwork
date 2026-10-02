"use strict";
/* ===== main menu: opened from the logo; a full-height drawer that will grow over time ===== */
let menuEl=null;
function ensureMenu(){if(menuEl)return menuEl;menuEl=document.createElement('div');menuEl.id='main-menu';
  menuEl.innerHTML='<div class="mm-scrim"></div><aside class="mm-panel"><div class="panel-h"><div class="panel-t">Patchwork</div><button class="panel-x" title="Close (Esc)">×</button></div>'+
    '<div class="mm-items"><label class="mm-item"><span>Light mode</span><input type="checkbox" class="pf-cb mm-light"></label>'+
    '<button class="mm-item mm-keys">Keyboard shortcuts<span class="hw-hint">?</span></button>'+
    '<button class="mm-item mm-find">Find &amp; replace<span class="hw-hint">Ctrl+H</span></button>'+
    '<button class="mm-item mm-print">Print / Save as PDF<span class="hw-hint">Ctrl+P</span></button>'+
    '<div class="mm-item mm-bgrow"><span>Page background</span><span class="mm-bgs">'+[['','Plain'],['lined','Lined'],['grid','Grid'],['dots','Dots']].map(([v,l])=>'<button class="mm-bg" data-bg="'+v+'">'+l+'</button>').join('')+'</span></div>'+(IS_MINI?'':'<button class="mm-item mm-class">Classroom<span class="hw-hint">optional</span></button><button class="mm-item mm-ai">AI board link<span class="hw-hint">experimental</span></button>')+'</div>'+
    '<div class="mm-bottom"><button class="mm-item mm-about">About &amp; legal</button></div></aside>';
  document.body.appendChild(menuEl);
  const close=()=>menuEl.classList.remove('open');menuEl.querySelector('.mm-scrim').onclick=close;menuEl.querySelector('.panel-x').onclick=close;
  const lt=menuEl.querySelector('.mm-light');lt.checked=document.documentElement.classList.contains('light');lt.onchange=()=>setTheme(lt.checked?'light':'dark');
  menuEl.querySelector('.mm-about').onclick=()=>{close();openAbout();};
  menuEl.querySelector('.mm-keys').onclick=()=>{close();openShortcuts();};
  menuEl.querySelector('.mm-find').onclick=()=>{close();openFindReplace();};
  menuEl.querySelector('.mm-print').onclick=()=>{close();setTimeout(printPage,150);};
  menuEl.querySelectorAll('.mm-bg').forEach(b=>b.onclick=()=>{setPageBg(b.dataset.bg);menuBgSync();});
  const mc=menuEl.querySelector('.mm-class');if(mc)mc.onclick=()=>{close();openClassroom();};
  const ma=menuEl.querySelector('.mm-ai');if(ma)ma.onclick=()=>{close();openAiLink();};
  addEventListener('keydown',e=>{if(e.key==='Escape'&&menuEl.classList.contains('open'))close();});return menuEl;}
function menuBgSync(){if(menuEl)menuEl.querySelectorAll('.mm-bg').forEach(b=>b.classList.toggle('on',b.dataset.bg===pageBg));}
function openMenu(){ensureMenu().classList.add('open');menuBgSync();}
// light mode = the dark theme inverted (pictures inverted back); remembered per browser
function setTheme(t){document.documentElement.classList.toggle('light',t==='light');try{localStorage.setItem('pw-theme',t);}catch(e){}}
const _logo=document.querySelector('#brand .mark');_logo.title='Menu';_logo.addEventListener('click',openMenu);
