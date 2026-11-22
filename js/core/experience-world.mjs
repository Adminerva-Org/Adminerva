const html=document.documentElement;

export function motionReduced(){
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches||
    html.dataset.motion==='reduce'||html.dataset.adminervaReduceMotion==='true';
}
function node(tag,cls,text){
  const element=document.createElement(tag);
  if(cls)element.className=cls;
  if(text!==undefined)element.textContent=String(text);
  return element;
}
export function mountExperienceMode({key='public',firstEntry=false,defaultMode='full'}={}){
  const storageKey='adminerva:experience-mode:'+key;
  let requested=null;
  try{requested=localStorage.getItem(storageKey);}catch{}
  let mode=requested==='quick'?'quick':defaultMode;
  html.dataset.adminervaExperience=mode;
  const trigger=node('button','avx-view-trigger','View');
  trigger.type='button';
  trigger.setAttribute('aria-haspopup','dialog');
  trigger.setAttribute('aria-label','Change Adminerva experience mode');
  const dialog=document.createElement('dialog');
  dialog.className='avx-mode-dialog';
  dialog.setAttribute('aria-labelledby','avx-mode-title');
  const shell=node('div','avx-mode-shell');
  const copy=node('div','avx-mode-copy');
  copy.innerHTML='<p class="avx-kicker">ADMINERVA / VIEW</p><h2 id="avx-mode-title">Choose how the world moves.</h2><p>Full Experience reveals the spatial journey. Quick Mode keeps the direct operational layout. Your choice stays on this device.</p>';
  const actions=node('div','avx-mode-actions');
  const full=node('button','avx-mode-choice','Full Experience');
  const quick=node('button','avx-mode-choice','Quick Mode');
  const close=node('button','avx-mode-close','Close');
  full.type=quick.type=close.type='button';
  actions.append(full,quick);shell.append(copy,actions,close);dialog.append(shell);document.body.append(trigger,dialog);
  const persist=value=>{try{localStorage.setItem(storageKey,value);}catch{}};
  const sync=()=>{full.setAttribute('aria-pressed',String(mode==='full'));quick.setAttribute('aria-pressed',String(mode==='quick'));trigger.dataset.mode=mode;};
  const setMode=(next,{save=true}={})=>{
    mode=next==='quick'?'quick':'full';html.dataset.adminervaExperience=mode;if(save)persist(mode);sync();
    document.dispatchEvent(new CustomEvent('adminerva:experience-mode-change',{detail:{mode,key}}));
  };
  const open=()=>{if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');};
  const shut=()=>{if(typeof dialog.close==='function'&&dialog.open)dialog.close();else dialog.removeAttribute('open');};
  trigger.addEventListener('click',open);
  full.addEventListener('click',()=>{setMode('full');shut();});
  quick.addEventListener('click',()=>{setMode('quick');shut();});
  close.addEventListener('click',shut);
  dialog.addEventListener('click',event=>{if(event.target===dialog)shut();});
  sync();
  if(firstEntry&&requested===null)queueMicrotask(open);
  return {get mode(){return mode;},setMode,open};
}
export function bindDepth(root){
  if(!root)return;
  root.addEventListener('pointermove',event=>{
    if(motionReduced()||event.pointerType==='touch'||window.matchMedia('(pointer:coarse)').matches)return;
    const rect=root.getBoundingClientRect();
    root.style.setProperty('--avx-px',(((event.clientX-rect.left)/Math.max(rect.width,1))-.5).toFixed(3));
    root.style.setProperty('--avx-py',(((event.clientY-rect.top)/Math.max(rect.height,1))-.5).toFixed(3));
  },{passive:true});
  root.addEventListener('pointerleave',()=>{root.style.setProperty('--avx-px','0');root.style.setProperty('--avx-py','0');},{passive:true});
}
export function scrollToElement(target){
  target?.scrollIntoView({behavior:motionReduced()?'auto':'smooth',block:'start',inline:'nearest'});
}
