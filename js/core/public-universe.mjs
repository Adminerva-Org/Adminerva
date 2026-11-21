/**
 * Public/guest entry portal. A real interactive constellation, not simulated
 * learner activity. Nodes link only to public existing destinations.
 */
import {loadPublicChannel} from './public-content.mjs?v=20261122-1';

const home=document.querySelector('main[data-home-experience="public"],main[data-home-experience="guest"]');
if(home){
  const role=home.dataset.homeExperience;
  const hero=home.querySelector(role==='public'?'.av-public-hero':'.av-guest-motion-hero');
  const old=hero?.querySelector(role==='public'?'.av-public-preview':'.av-motion-art');
  const nodes=role==='public'?
    [
      ['CREATE','Build in Studio','Experiment with code in a real public playground.','guest-playground.html','⌘'],
      ['DISCOVER','Find an opportunity','Explore verified resources and open their official source.','opportunities.html','✳'],
      ['PRACTICE','Test an idea','Try an interactive practice mission.','guest-practice.html','◈'],
      ['PULSE','Explore the story','See verified updates and public discoveries.','pulse.html','◌'],
      ['JOIN','Become part of a school','Explore Adminerva enrollment and school registration.','enroll.html','↗']
    ]:[
      ['STUDIO','Start building','Open the public coding playground and try your own idea.','guest-playground.html','⌘'],
      ['PRACTICE','Try a challenge','Run through an interactive guided coding mission.','guest-practice.html','◈'],
      ['LAYOUT','Design a screen','Experiment with a public XML layout laboratory.','guest-xml-lab.html','▣'],
      ['DISCOVER','Find an opportunity','Explore source-checked courses and other opportunities.','opportunities.html','✳'],
      ['PULSE','Follow Adminerva','Explore recent verified updates and discoveries.','pulse.html','◌']
    ];
  const loc=[[15,28],[84,25],[84,74],[13,75],[52,4]];
  if(hero&&old){
    hero.classList.add('av-universe-hero');
    hero.dataset.universeRole=role;
    const panel=document.createElement('div');
    panel.className='av-universe';
    panel.setAttribute('aria-label','Explore interactive Adminerva destinations');
    panel.setAttribute('role','group');
    const grid=document.createElement('div');grid.className='av-universe-grid';grid.setAttribute('aria-hidden','true');
    const outer=document.createElement('div');outer.className='av-universe-ring av-universe-ring--outer';
    const inner=document.createElement('div');inner.className='av-universe-ring av-universe-ring--inner';
    const halo=document.createElement('div');halo.className='av-universe-halo';halo.setAttribute('aria-hidden','true');
    const core=document.createElement('div');core.className='av-universe-core';
    const owl=document.createElement('img');owl.src='assets/adminerva-owl.png';owl.width=84;owl.height=84;owl.alt='';owl.loading='eager';
    const coreText=document.createElement('span');coreText.textContent='ADMINERVA / EXPLORE';
    core.append(owl,coreText);
    const nodeLayer=document.createElement('div');nodeLayer.className='av-universe-nodes';
    panel.append(grid,outer,inner,halo,core,nodeLayer);
    const spotlight=document.createElement('div');spotlight.className='av-universe-spotlight';
    const eyebrow=document.createElement('span');eyebrow.className='av-universe-spotlight-kicker';
    const title=document.createElement('strong');
    const description=document.createElement('p');
    const action=document.createElement('a');action.className='av-universe-open';
    spotlight.append(eyebrow,title,description,action);
    panel.append(spotlight);
    const foot=document.createElement('div');foot.className='av-universe-bottom';
    const footText=document.createElement('small');footText.textContent='SELECT A SIGNAL • THIS IS AN ILLUSTRATIVE PRODUCT PREVIEW';
    const next=document.createElement('button');next.type='button';next.textContent='Next discovery →';
    foot.append(footText,next);panel.append(foot);
    old.replaceWith(panel);
    const buttons=[];
    let index=0,manualUntil=0;
    function choose(i){
      index=i;
      const [label,name,desc,href]=nodes[i];
      eyebrow.textContent=label+' / INTERACTIVE DESTINATION';
      title.textContent=name;
      description.textContent=desc;
      action.href=href;
      action.textContent='Open '+label.toLowerCase()+' ↗';
      buttons.forEach((button,j)=>button.setAttribute('aria-pressed',String(j===index)));
      panel.dataset.focus=String(i);
    }
    nodes.forEach((item,i)=>{
      const button=document.createElement('button');
      button.type='button';
      button.className='av-universe-node';
      button.style.setProperty('--nx',loc[i][0]+'%');
      button.style.setProperty('--ny',loc[i][1]+'%');
      button.setAttribute('aria-label','Preview '+item[1]);
      button.setAttribute('aria-pressed','false');
      const icon=document.createElement('b');icon.textContent=item[4];icon.setAttribute('aria-hidden','true');
      const text=document.createElement('span');text.textContent=item[0];
      button.append(icon,text);
      button.addEventListener('click',()=>{choose(i);manualUntil=Date.now()+35000;});
      nodeLayer.append(button);buttons.push(button);
    });
    next.addEventListener('click',()=>{choose((index+1)%nodes.length);manualUntil=Date.now()+35000;});
    panel.addEventListener('pointermove',event=>{
      if(event.pointerType==='touch'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      const bounds=panel.getBoundingClientRect();
      panel.style.setProperty('--universe-x',((event.clientX-bounds.left)/bounds.width-.5).toFixed(3));
      panel.style.setProperty('--universe-y',((event.clientY-bounds.top)/bounds.height-.5).toFixed(3));
    },{passive:true});
    panel.addEventListener('pointerleave',()=>{panel.style.setProperty('--universe-x',0);panel.style.setProperty('--universe-y',0);});
    choose(0);
    // The selected daily Codex experience can drive this actual interactive
    // spotlight without changing the site template or fabricating activity.
    loadPublicChannel('experiences',{role}).then(entries=>{
      if(!entries.length||!panel.isConnected)return;
      const featured=entries[Math.floor(Date.now()/86400000)%entries.length];
      panel.dataset.sceneTone=featured.sceneTone||'mint';
      nodes[0]=['TODAY',featured.title,featured.summary,featured.url,'✦'];
      buttons[0].querySelector('span').textContent='TODAY';
      buttons[0].querySelector('b').textContent='✦';
      buttons[0].setAttribute('aria-label','Preview featured experience: '+featured.title);
      if(index===0)choose(0);
    }).catch(()=>{ /* Default public destinations remain available. */ });
    const timer=window.setInterval(()=>{
      if(!panel.isConnected||document.hidden||Date.now()<manualUntil||panel.matches(':hover')||panel.contains(document.activeElement))return;
      if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||
        document.documentElement.dataset.motion==='reduce'||document.documentElement.dataset.adminervaReduceMotion==='true')return;
      choose((index+1)%nodes.length);
    },12500);
    window.addEventListener('pagehide',()=>window.clearInterval(timer),{once:true});
  }
}
