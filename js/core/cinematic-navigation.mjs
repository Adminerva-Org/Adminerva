/** Full/quick scene navigation for Opportunity Hunter and Pulse. */
const main=document.querySelector('main.av-cine');
if(main){
  const chapters=[...main.querySelectorAll('[data-cine-chapter]')];
  const page=main.id||'editorial';
  const key='adminerva:experience-mode:'+page;
  const readMode=()=>{try{return localStorage.getItem(key);}catch{return null;}};
  const saveMode=value=>{try{localStorage.setItem(key,value);}catch{/* Storage can be unavailable; mode still works for this page view. */}};
  const reduce=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches||
    document.documentElement.dataset.motion==='reduce'||
    document.documentElement.dataset.adminervaReduceMotion==='true';
  const current=readMode()==='quick'?'quick':'full';
  document.documentElement.dataset.adminervaExperience=current;

  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
  const switcher=el('div','avfx-mode-switch');switcher.setAttribute('aria-label','Page experience mode');
  const full=el('button',null,'Full experience'),quick=el('button',null,'Quick mode');
  full.type=quick.type='button';switcher.append(full,quick);document.body.append(switcher);
  const nav=el('nav','avfx-scene-index avfx-cine-index');nav.setAttribute('aria-label','Page chapters');
  const progress=el('div','avfx-scene-progress avfx-cine-progress');progress.append(el('i'));
  main.append(nav,progress);

  let active=0;
  const horizontal=()=>window.matchMedia('(max-height:620px) and (orientation:landscape) and (pointer:coarse)').matches;
  function apply(mode){
    document.documentElement.dataset.adminervaExperience=mode;
    saveMode(mode);
    full.setAttribute('aria-pressed',String(mode==='full'));
    quick.setAttribute('aria-pressed',String(mode==='quick'));
    sync();
  }
  function go(i){
    active=Math.max(0,Math.min(chapters.length-1,i));
    chapters[active]?.scrollIntoView({behavior:reduce()?'auto':'smooth',block:'start',inline:'start'});
    sync();
  }
  function sync(){
    const fullMode=document.documentElement.dataset.adminervaExperience==='full';
    const h=horizontal();
    const pos=h?main.scrollLeft:main.scrollTop;
    const size=h?main.clientWidth:main.clientHeight;
    if(fullMode&&size>0)active=Math.max(0,Math.min(chapters.length-1,Math.round(pos/size)));
    [...nav.children].forEach((b,i)=>i===active?b.setAttribute('aria-current','step'):b.removeAttribute('aria-current'));
    progress.firstElementChild?.style.setProperty('--avfx-progress',chapters.length>1?((active/(chapters.length-1))*100)+'%':'100%');
  }
  chapters.forEach((chapter,i)=>{
    const b=el('button',null,String(i+1).padStart(2,'0'));b.type='button';b.setAttribute('aria-label','Go to chapter '+(i+1));b.addEventListener('click',()=>go(i));nav.append(b);
  });
  full.addEventListener('click',()=>apply('full'));
  quick.addEventListener('click',()=>apply('quick'));
  main.addEventListener('scroll',()=>requestAnimationFrame(sync),{passive:true});
  main.addEventListener('keydown',event=>{
    if(document.documentElement.dataset.adminervaExperience!=='full'||event.target.closest('input,textarea,select'))return;
    if(['ArrowDown','ArrowRight','PageDown'].includes(event.key)){event.preventDefault();go(active+1);}
    if(['ArrowUp','ArrowLeft','PageUp'].includes(event.key)){event.preventDefault();go(active-1);}
    if(event.key==='Home'){event.preventDefault();go(0);}
    if(event.key==='End'){event.preventDefault();go(chapters.length-1);}
  });
  main.tabIndex=-1;
  window.addEventListener('resize',sync,{passive:true});
  apply(current);
}
