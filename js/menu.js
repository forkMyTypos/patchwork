"use strict";
/* ===== main menu: opened from the logo; a full-height drawer that will grow over time ===== */
let menuEl=null;
function ensureMenu(){if(menuEl)return menuEl;menuEl=document.createElement('div');menuEl.id='main-menu';
  menuEl.innerHTML='<div class="mm-scrim"></div><aside class="mm-panel"><div class="panel-h"><div class="panel-t">Patchwork</div><button class="panel-x" title="Close (Esc)">×</button></div>'+
    '<div class="mm-items"><label class="mm-item"><span>Light mode</span><input type="checkbox" class="pf-cb mm-light"></label></div>'+
    '<div class="mm-bottom"><button class="mm-item mm-about">About &amp; legal</button></div></aside>';
  document.body.appendChild(menuEl);
  const close=()=>menuEl.classList.remove('open');menuEl.querySelector('.mm-scrim').onclick=close;menuEl.querySelector('.panel-x').onclick=close;
  const lt=menuEl.querySelector('.mm-light');lt.checked=document.documentElement.classList.contains('light');lt.onchange=()=>setTheme(lt.checked?'light':'dark');
  menuEl.querySelector('.mm-about').onclick=()=>{close();openAbout();};
  addEventListener('keydown',e=>{if(e.key==='Escape'&&menuEl.classList.contains('open'))close();});return menuEl;}
function openMenu(){ensureMenu().classList.add('open');}
// light mode = the dark theme inverted (pictures inverted back); remembered per browser
function setTheme(t){document.documentElement.classList.toggle('light',t==='light');try{localStorage.setItem('pw-theme',t);}catch(e){}}
const _logo=document.querySelector('#brand .mark');_logo.title='Menu';_logo.addEventListener('click',openMenu);
