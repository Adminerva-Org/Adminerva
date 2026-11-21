import {loadPublicChannel} from './public-content.mjs?v=20261122-1';
import {loadPublicReleases} from './patch-history.mjs?v=1.4.19';

/**
 * Full Experience mode.
 * Public/guest: replaces the stacked landing page with a four-scene journey.
 * Authenticated role homes: adds a one-viewport command stage, then hands back
 * to the existing operational dashboard. No private data is read here.
 */
const home=document.querySelector('main[data-home-experience]');
if(home){
  const role=home.dataset.homeExperience;
  const publicLike=role==='public'||role==='guest';
  const reduce=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches||
    document.documentElement.dataset.motion==='reduce'||
    document.documentElement.dataset.adminervaReduceMotion==='true';
  const storageKey='adminerva:experience-mode:'+role;
  const readMode=()=>{try{return localStorage.getItem(storageKey);}catch{return null;}};
  const saveMode=value=>{try{localStorage.setItem(storageKey,value);}catch{/* Private browsing/storage denial: session still works. */}};
  const requested=readMode();
  const initial=requested==='quick'?'quick':'full';
  document.documentElement.dataset.adminervaExperience=initial;

  const el=(tag,cls,text)=>{
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!==undefined)n.textContent=String(text);
    return n;
  };
  const link=(href,label,cls='avfx-primary')=>{
    const a=el('a',cls,label);a.href=href;return a;
  };
  const modeSwitch=el('div','avfx-mode-switch');
  modeSwitch.setAttribute('aria-label','Homepage experience mode');
  const fullButton=el('button',null,'Full experience');
  const quickButton=el('button',null,'Quick mode');
  fullButton.type=quickButton.type='button';
  modeSwitch.append(fullButton,quickButton);
  document.body.append(modeSwitch);
  function applyMode(mode,{focus=false}={}){
    document.documentElement.dataset.adminervaExperience=mode;
    saveMode(mode);
    fullButton.setAttribute('aria-pressed',String(mode==='full'));
    quickButton.setAttribute('aria-pressed',String(mode==='quick'));
    if(mode==='quick'&&publicLike){
      const target=home.querySelector(':scope > :not(.avfx-journey)');
      target?.scrollIntoView({behavior:reduce()?'auto':'smooth',block:'start'});
    }else if(mode==='full'&&publicLike){
      journey?.scrollTo({left:0,top:0,behavior:'auto'});
    }
    if(focus)(mode==='full'?fullButton:quickButton).focus();
  }
  fullButton.addEventListener('click',()=>applyMode('full',{focus:true}));
  quickButton.addEventListener('click',()=>applyMode('quick',{focus:true}));
  applyMode(initial);

  const paths={
    public:[
      ['CREATE','Build something','Open the public coding playground.','guest-playground.html','⌘'],
      ['DISCOVER','Find your next opportunity','Explore source-checked opportunities.','opportunities.html','✳'],
      ['PRACTICE','Test an idea','Try a guided practice mission.','guest-practice.html','◈'],
      ['PULSE','See what is changing','Explore verified releases and public stories.','pulse.html','◌'],
      ['JOIN','Enter a school workspace','Start enrollment or sign in.','enroll.html','↗']
    ],
    guest:[
      ['STUDIO','Start building','Open a public coding workspace.','guest-playground.html','⌘'],
      ['PRACTICE','Try a mission','Explore a guided coding challenge.','guest-practice.html','◈'],
      ['LAYOUT','Design a screen','Experiment with XML layouts.','guest-xml-lab.html','▣'],
      ['DISCOVER','Find an opportunity','Explore source-checked external opportunities.','opportunities.html','✳'],
      ['PULSE','Follow Adminerva','See verified releases and discoveries.','pulse.html','◌']
    ]
  };
  const roleActions={
    student:{
      kicker:'STUDENT / LEARNING CONTROL',
      title:'Your school day, <em>ready to move.</em>',
      summary:'Choose the next place you need. The operational dashboard remains directly below this stage.',
      actions:[
        ['01','Open classroom','Assignments, class stream and teacher directions','student-classroom.html?v=20261115-stream3'],
        ['02','Continue projects','Your project and repository workspace','student-dashboard.html'],
        ['03','Practice a skill','Short guided missions and feedback','student-practice.html']
      ]
    },
    teacher:{
      kicker:'TEACHER / TEACHING CONTROL',
      title:'Prepare. Review. <em>Move the class forward.</em>',
      summary:'Enter the teaching workflow from one visual command surface, then continue into the full operational dashboard.',
      actions:[
        ['01','Assessment Studio','Create, deploy and manage assessments','assessment-studio.html'],
        ['02','Review & Grade','Inspect submissions and evidence','repofetch.html'],
        ['03','Class Record','Review and publish verified results','class-record.html']
      ]
    },
    admin:{
      kicker:'SCHOOL ADMIN / OPERATIONS CONTROL',
      title:'See the school. <em>Act on what matters.</em>',
      summary:'A visual entrypoint to the canonical administration workflows. Real counts and alerts remain in the dashboard below.',
      actions:[
        ['01','People & access','Students, staff, roles and account concerns','people-access.html'],
        ['02','Enrollment','Registration, placement and student lifecycle','school-enrollment.html'],
        ['03','Academic structure','Programs, sections and school configuration','school-academic-structure.html']
      ]
    },
    platform:{
      kicker:'SYSTEM ADMIN / PLATFORM CONTROL',
      title:'One platform. <em>Every school stays distinct.</em>',
      summary:'Enter platform-level school operations without mixing them with school-admin authority.',
      actions:[
        ['01','System users','Review platform-level identities and access','system-users.html'],
        ['02','Support reports','Review platform-level issues requiring attention','issues.html'],
        ['03','Release history','Inspect verified public product releases','patch-notes.html']
      ]
    }
  };

  let journey=null;
  if(publicLike){
    const config=paths[role];
    journey=el('div','avfx-journey');
    journey.setAttribute('aria-label',role==='public'?'Adminerva full experience':'Adminerva guest full experience');
    const scenes=[];

    const makeScene=(number,tone)=>{
      const s=el('section','avfx-scene');
      s.dataset.avfxScene=String(number);
      s.dataset.tone=tone;
      s.setAttribute('aria-label','Experience chapter '+String(number+1));
      scenes.push(s);journey.append(s);return s;
    };

    // Scene 1 — identity
    const intro=makeScene(0,'sky');
    const introGrid=el('div','avfx-scene-grid');
    const introCopy=el('div','avfx-copy');
    introCopy.innerHTML=role==='public'
      ?'<p class="avfx-kicker">ADMINERVA / SCHOOL OPERATING SYSTEM</p><h1>One school day. <em>Connected.</em></h1><p>Move through learning, teaching and school operations as one connected experience—not a collection of disconnected portals.</p>'
      :'<p class="avfx-kicker">ADMINERVA / OPEN EXPERIENCE</p><h1>Don\'t read about it. <em>Try it.</em></h1><p>Move through public tools, experiments and discoveries before you ever sign in.</p>';
    const introActions=el('div','avfx-actions');
    const enter=el('button','avfx-primary','Enter the experience ↓');enter.type='button';
    const qlink=link(role==='public'?'login.html?continue=1':'guest-playground.html',role==='public'?'Open workspace ↗':'Start building ↗','avfx-secondary');
    introActions.append(enter,qlink);introCopy.append(introActions);
    const fine=el('p','avfx-fine','Motion is optional. Switch to Quick mode at any time. No private school activity is shown here.');
    introCopy.append(fine);
    const introOrbit=buildOrbit(config,0);
    introGrid.append(introCopy,introOrbit);intro.append(introGrid);

    // Scene 2 — pathways
    const pathsScene=makeScene(1,'mint');
    const pathGrid=el('div','avfx-scene-grid');
    const pathCopy=el('div','avfx-copy');
    pathCopy.innerHTML='<p class="avfx-kicker">02 / CHOOSE A PATH</p><h2>Follow what <em>pulls you in.</em></h2><p>Every signal is a working destination. Select one to preview it, then enter when you are ready.</p>';
    const pathOrbit=buildOrbit(config,1);
    pathGrid.append(pathCopy,pathOrbit);pathsScene.append(pathGrid);

    // Scene 3 — current signals
    const signalScene=makeScene(2,'violet');
    const signalGrid=el('div','avfx-scene-grid');
    const signalCopy=el('div','avfx-copy');
    signalCopy.innerHTML='<p class="avfx-kicker">03 / CURRENT SIGNALS</p><h2>Adminerva keeps <em>moving.</em></h2><p>Published releases, approved discoveries and source-checked opportunities become part of the experience instead of another list of links.</p>';
    const stack=el('div','avfx-signal-stack');stack.setAttribute('aria-live','polite');
    const controls=el('div','avfx-signal-controls');
    const prev=el('button',null,'←'),next=el('button',null,'→');prev.type=next.type='button';
    prev.setAttribute('aria-label','Previous signal');next.setAttribute('aria-label','Next signal');
    controls.append(prev,next);stack.append(controls);
    signalGrid.append(signalCopy,stack);signalScene.append(signalGrid);

    // Scene 4 — choose how to enter
    const final=makeScene(3,'amber');
    const finalGrid=el('div','avfx-scene-grid');
    const finalCopy=el('div','avfx-copy');
    finalCopy.innerHTML=role==='public'
      ?'<p class="avfx-kicker">04 / ENTER ADMINERVA</p><h2>Choose how you <em>arrive.</em></h2><p>Explore openly, enter your existing workspace, or begin enrollment. The full School OS remains role- and school-scoped after sign-in.</p>'
      :'<p class="avfx-kicker">04 / KEEP EXPLORING</p><h2>Make the next click <em>do something.</em></h2><p>Build, practice, discover or move into the signed-in school experience when you are ready.</p>';
    const choices=el('div','avfx-choice-grid');
    const choiceData=role==='public'?
      [
        ['WORKSPACE','Sign in','Continue to your authorized school workspace.','login.html?continue=1'],
        ['ENROLL','Join a school','Start the public enrollment workflow.','enroll.html'],
        ['EXPLORE','Guest mode','Try public tools without a school login.','guest-home.html'],
        ['DISCOVER','Opportunity Hunter','Explore external source-checked opportunities.','opportunities.html']
      ]:[
        ['BUILD','Studio','Try a public coding project.','guest-playground.html'],
        ['PRACTICE','Practice Lab','Work through a guided mission.','guest-practice.html'],
        ['DISCOVER','Opportunity Hunter','Explore verified external opportunities.','opportunities.html'],
        ['WORKSPACE','Sign in','Return to an authorized school workspace.','login.html?continue=1']
      ];
    for(const [k,t,d,h] of choiceData){
      const a=link(h,'','avfx-choice');a.replaceChildren(el('small',null,k),el('strong',null,t),el('p',null,d));choices.append(a);
    }
    finalGrid.append(finalCopy,choices);final.append(finalGrid);
    final.append(el('div','avfx-final-mark','A'));

    home.prepend(journey);

    // shared scene UI
    const indexNav=el('nav','avfx-scene-index');indexNav.setAttribute('aria-label','Experience chapters');
    const progress=el('div','avfx-scene-progress');progress.append(el('i'));
    const sectionNav=el('div','avfx-section-nav');
    const backQuick=el('button',null,'Quick mode');backQuick.type='button';backQuick.addEventListener('click',()=>applyMode('quick'));
    sectionNav.append(backQuick);intro.append(sectionNav);
    scenes.forEach((scene,i)=>{
      const b=el('button',null,String(i+1).padStart(2,'0'));b.type='button';b.setAttribute('aria-label','Go to chapter '+(i+1));
      b.addEventListener('click',()=>goTo(i));indexNav.append(b);
    });
    journey.append(indexNav,progress);
    enter.addEventListener('click',()=>goTo(1));

    let current=0;
    function isHorizontal(){return window.matchMedia('(max-height:620px) and (orientation:landscape) and (pointer:coarse)').matches;}
    function goTo(i){
      current=Math.max(0,Math.min(scenes.length-1,i));
      scenes[current].scrollIntoView({behavior:reduce()?'auto':'smooth',block:'start',inline:'start'});
      sync();
    }
    function sync(){
      const rect=journey.getBoundingClientRect();
      const horizontal=isHorizontal();
      const value=horizontal?journey.scrollLeft:journey.scrollTop;
      const size=horizontal?journey.clientWidth:journey.clientHeight;
      const i=Math.max(0,Math.min(scenes.length-1,Math.round(value/Math.max(1,size))));
      current=i;
      [...indexNav.children].forEach((b,j)=>j===i?b.setAttribute('aria-current','step'):b.removeAttribute('aria-current'));
      progress.firstElementChild?.style.setProperty('--avfx-progress',((i/(scenes.length-1))*100)+'%');
    }
    journey.addEventListener('scroll',()=>requestAnimationFrame(sync),{passive:true});
    window.addEventListener('resize',sync,{passive:true});
    journey.addEventListener('keydown',event=>{
      if(event.target.closest('input,textarea,select'))return;
      const forward=['ArrowDown','ArrowRight','PageDown'];
      const backward=['ArrowUp','ArrowLeft','PageUp'];
      if(forward.includes(event.key)){event.preventDefault();goTo(current+1);}
      if(backward.includes(event.key)){event.preventDefault();goTo(current-1);}
      if(event.key==='Home'){event.preventDefault();goTo(0);}
      if(event.key==='End'){event.preventDefault();goTo(scenes.length-1);}
    });
    journey.tabIndex=-1;
    sync();

    // Public signal stack.
    let signals=[],signalIndex=0;
    const renderSignals=()=>{
      [...stack.querySelectorAll('.avfx-signal-card')].forEach(n=>n.remove());
      const visible=signals.length?signals:[{kicker:'NO PUBLIC SIGNAL YET',title:'The channel is quiet.',summary:'The experience does not invent releases or opportunities when nothing is published.',url:'pulse.html',action:'Open Pulse ↗'}];
      visible.slice(0,3).forEach((item,i)=>{
        const card=el('article','avfx-signal-card');card.dataset.active=String(i===signalIndex);
        card.dataset.pos=i===signalIndex?'front':i===((signalIndex+1)%visible.length)?'middle':'back';
        card.append(el('p','avfx-kicker',item.kicker),el('h3',null,item.title),el('p',null,item.summary),link(item.url,item.action,''));
        stack.insertBefore(card,controls);
      });
    };
    const stepSignal=amount=>{
      if(!signals.length)return;
      signalIndex=(signalIndex+amount+Math.min(signals.length,3))%Math.min(signals.length,3);
      renderSignals();
    };
    prev.addEventListener('click',()=>stepSignal(-1));next.addEventListener('click',()=>stepSignal(1));
    Promise.allSettled([loadPublicReleases(),loadPublicChannel('experiences',{role}),loadPublicChannel('opportunities',{role:'all'})]).then(([r,e,o])=>{
      if(r.status==='fulfilled'&&r.value[0])signals.push({kicker:'VERIFIED RELEASE / '+r.value[0].version,title:r.value[0].title,summary:r.value[0].summary,url:'patch-notes.html?version='+encodeURIComponent(r.value[0].version),action:'Open release ↗'});
      if(e.status==='fulfilled'&&e.value[0])signals.push({kicker:'TODAY / '+e.value[0].label,title:e.value[0].title,summary:e.value[0].summary,url:e.value[0].url,action:'Try it ↗'});
      if(o.status==='fulfilled'&&o.value[0])signals.push({kicker:'OPPORTUNITY / '+o.value[0].category,title:o.value[0].title,summary:o.value[0].provider+' · '+o.value[0].location,url:'opportunities.html',action:'Explore opportunity ↗'});
      renderSignals();
    }).catch(renderSignals);
    renderSignals();

    // pointer depth
    journey.addEventListener('pointermove',event=>{
      if(reduce()||event.pointerType==='touch')return;
      const target=event.target.closest('.avfx-orbit');
      if(!target)return;
      const r=target.getBoundingClientRect();
      target.style.setProperty('--avfx-x',((event.clientX-r.left)/r.width-.5).toFixed(3));
      target.style.setProperty('--avfx-y',((event.clientY-r.top)/r.height-.5).toFixed(3));
    },{passive:true});
  }else if(roleActions[role]){
    const cfg=roleActions[role];
    const stage=el('section','avfx-role-stage');
    stage.setAttribute('aria-label',role+' immersive home entry');
    const grid=el('div','avfx-role-stage-grid');
    const copy=el('div','avfx-copy');
    copy.innerHTML='<p class="avfx-kicker">'+cfg.kicker+'</p><h1>'+cfg.title+'</h1><p>'+cfg.summary+'</p>';
    const quicks=el('div','avfx-actions');
    const dashboard=el('button','avfx-primary','Continue to dashboard ↓');dashboard.type='button';
    quicks.append(dashboard);copy.append(quicks);
    const consoleEl=el('div','avfx-role-console');
    consoleEl.append(el('div','avfx-role-console-ring'));
    const core=el('div','avfx-role-console-core');
    const img=document.createElement('img');img.src='assets/adminerva-owl.png';img.alt='';img.width=80;img.height=80;
    core.append(img,el('strong',null,role.toUpperCase()+' / HOME'));consoleEl.append(core);
    const loc=[[18,27],[82,27],[50,82]];
    cfg.actions.forEach(([n,t,d,h],i)=>{
      const a=link(h,'','avfx-role-action');a.style.setProperty('--rx',loc[i][0]+'%');a.style.setProperty('--ry',loc[i][1]+'%');
      a.replaceChildren(el('small',null,n),el('strong',null,t),el('span',null,d));consoleEl.append(a);
    });
    const enter=el('button','avfx-role-enter','↓ Continue into operational dashboard');enter.type='button';
    stage.append(grid,enter);grid.append(copy,consoleEl);home.prepend(stage);
    const scrollDashboard=()=>{
      const target=[...home.children].find(n=>n!==stage&&
        !((role==='student'||role==='teacher')&&n.classList?.contains('av-home-hero')));
      target?.scrollIntoView({behavior:reduce()?'auto':'smooth',block:'start'});
    };
    dashboard.addEventListener('click',scrollDashboard);enter.addEventListener('click',scrollDashboard);
  }

  function buildOrbit(items,seed){
    const orbit=el('div','avfx-orbit');
    orbit.append(el('div','avfx-orbit-ring avfx-orbit-ring--one'),el('div','avfx-orbit-ring avfx-orbit-ring--two'),el('div','avfx-orbit-ring avfx-orbit-ring--three'));
    const core=el('div','avfx-orbit-core');
    const img=document.createElement('img');img.src='assets/adminerva-owl.png';img.width=84;img.height=84;img.alt='';
    core.append(img,el('span',null,'ADMINERVA / '+(seed?'PATHS':'ENTER')));orbit.append(core);
    const inspector=el('div','avfx-inspector');
    const k=el('small'),t=el('strong'),d=el('p'),a=el('a');inspector.append(k,t,d,a);orbit.append(inspector);
    const positions=[[16,28],[83,25],[84,74],[15,75],[51,6]];
    const buttons=[];
    const choose=i=>{
      const item=items[i];k.textContent=item[0]+' / DESTINATION';t.textContent=item[1];d.textContent=item[2];a.href=item[3];a.textContent='Open '+item[0].toLowerCase()+' ↗';
      buttons.forEach((b,j)=>b.setAttribute('aria-pressed',String(j===i)));
    };
    items.forEach((item,i)=>{
      const b=el('button','avfx-orbit-node');b.type='button';b.style.setProperty('--fx',positions[i][0]+'%');b.style.setProperty('--fy',positions[i][1]+'%');
      b.setAttribute('aria-label','Preview '+item[1]);b.setAttribute('aria-pressed','false');
      b.append(el('b',null,item[4]),el('span',null,item[0]));b.addEventListener('click',()=>choose(i));orbit.append(b);buttons.push(b);
    });
    choose(seed%items.length);
    return orbit;
  }
}
