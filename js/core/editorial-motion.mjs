/**
 * Minimal ambient spatial layer. Decorative only: no data collection,
 * identity access, audio autoplay or third-party rendering dependencies.
 */
const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.dataset.motion === 'reduce' ||
  document.documentElement.dataset.adminervaReduceMotion === 'true';
for (const scene of document.querySelectorAll('[data-cine-scene]')) {
  let active = true;
  const control=scene.querySelector('[data-cine-motion-toggle]');
  const reduceSystem=window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.motion==='reduce' ||
    document.documentElement.dataset.adminervaReduceMotion==='true';
  if(control){
    if(reduceSystem){
      control.disabled=true;
      control.textContent='Reduced motion active';
    }else{
      control.addEventListener('click',()=>{
        const paused=scene.dataset.motionPaused!=='true';
        scene.dataset.motionPaused=String(paused);
        control.setAttribute('aria-pressed',String(paused));
        control.textContent=paused?'Resume motion ▶':'Pause motion ⏸';
        if(paused)cancelAnimationFrame(raf);
        else start();
      });
    }
  }
  scene.addEventListener('pointermove',event=>{
    if(reduce()||scene.dataset.motionPaused==='true'||event.pointerType==='touch')return;
    const rect=scene.getBoundingClientRect();
    scene.style.setProperty('--cinex',((event.clientX-rect.left)/rect.width-.5).toFixed(3));
    scene.style.setProperty('--ciney',((event.clientY-rect.top)/rect.height-.5).toFixed(3));
  },{passive:true});
  scene.addEventListener('pointerleave',()=>{
    scene.style.setProperty('--cinex',0);
    scene.style.setProperty('--ciney',0);
  });
  const canvas=scene.querySelector('[data-cine-particles]');
  const ctx=canvas?.getContext('2d',{alpha:true});
  if(!ctx)continue;
  const stars=Array.from({length:44},(_,i)=>({
    x:(i*0.61803398875+0.21)%1,
    y:(i*0.7548776662+0.16)%1,
    r:i%9===0?1.7:i%4===0?1.1:.6,
    drift:(i%6+1)*.000015
  }));
  let width=0,height=0,raf=0,observer;
  const resize=()=>{
    const rect=scene.getBoundingClientRect();
    width=Math.max(1,Math.floor(rect.width));
    height=Math.max(1,Math.floor(rect.height));
    const dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.round(width*dpr);
    canvas.height=Math.round(height*dpr);
    canvas.style.width=width+'px';
    canvas.style.height=height+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
  };
  resize();
  let last=0;
  function paint(t){
    if(!active||scene.dataset.motionPaused==='true')return;
    ctx.clearRect(0,0,width,height);
    for(const star of stars){
      const x=(star.x+(reduce()?0:t*star.drift/1000)%1)*width;
      const y=star.y*height;
      ctx.beginPath();
      ctx.fillStyle=star.r>1?'rgba(182,255,224,.65)':'rgba(170,225,246,.35)';
      ctx.arc(x,y,star.r,0,Math.PI*2);
      ctx.fill();
    }
    if(!reduce()&&!document.hidden)raf=requestAnimationFrame(paint);
  }
  const start=()=>{
    cancelAnimationFrame(raf);
    if(!active||scene.dataset.motionPaused==='true')return;
    resize();
    paint(performance.now());
  };
  if('IntersectionObserver' in window){
    observer=new IntersectionObserver(entries=>{
      if(entries[0]?.isIntersecting){active=true;start();}
      else{active=false;cancelAnimationFrame(raf);}
    },{rootMargin:'90px'});
    observer.observe(scene);
  }else start();
  window.addEventListener('resize',start,{passive:true});
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)start();else cancelAnimationFrame(raf);
  });
  window.addEventListener('pagehide',()=>{
    active=false;
    cancelAnimationFrame(raf);
    observer?.disconnect();
  },{once:true});
}

/** Scroll staging is progressive enhancement: content remains visible without JS. */
const sections=[...document.querySelectorAll('.av-cine-section-heading,.av-atlas-console-grid,.av-signal-console,.av-cine-next')];
if(sections.length&&!reduce()&&'IntersectionObserver' in window){
  for(const section of sections)section.classList.add('av-cine-reveal');
  const reveal=new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(!entry.isIntersecting)continue;
      entry.target.classList.add('av-cine-revealed');
      reveal.unobserve(entry.target);
    }
  },{threshold:.12,rootMargin:'0px 0px -45px 0px'});
  for(const section of sections)reveal.observe(section);
  window.addEventListener('pagehide',()=>reveal.disconnect(),{once:true});
}
