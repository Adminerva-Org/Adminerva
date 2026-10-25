/** Progressive home-page decoration. No navigation, grading, or account state is changed. */
const home = document.querySelector('[data-home-motion]');
if (home) {
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduceMotion = () => Boolean(
    motionQuery?.matches ||
    document.documentElement.dataset.motion === 'reduce' ||
    document.documentElement.dataset.adminervaReduceMotion === 'true'
  );
  const selectors = [
    '.av-home-grid > *',
    '.av-learning-grid > *',
    '.av-setup-steps > li',
    'nav[aria-label="Administration workspaces"] > a',
    'section[aria-label="Administration summary"] > *',
    'main[data-home-motion] > section:not(:first-child):not(.av-guest-motion-hero)'
  ];
  const elements = [...new Set(selectors.flatMap(selector => [...home.querySelectorAll(selector)]))]
    .filter(element => !element.closest('[hidden]'));
  let observer;
  const showAll = () => {
    observer?.disconnect();
    home.classList.remove('av-motion-active');
    elements.forEach(element => {
      element.classList.remove('av-motion-reveal');
      element.classList.add('is-visible');
    });
    home.style.removeProperty('--av-motion-scroll');
  };
  const setupReveal = () => {
    if (reduceMotion() || !('IntersectionObserver' in window)) {
      showAll();
      return;
    }
    home.classList.add('av-motion-active');
    observer?.disconnect();
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, {rootMargin:'0px 0px 18px 0px',threshold:0.05});
    elements.forEach((element,index) => {
      if (element.classList.contains('is-visible')) return;
      element.style.setProperty('--av-motion-index',String(index % 4));
      element.classList.add('av-motion-reveal');
      observer.observe(element);
    });
  };
  setupReveal();
  let scheduled = false;
  const refreshParallax = () => {
    scheduled = false;
    if (reduceMotion() || home.dataset.homeMotion !== 'expressive' || window.innerWidth < 768) {
      home.style.removeProperty('--av-motion-scroll');
      return;
    }
    const shift = -Math.min(22, Math.max(0, window.scrollY) * 0.055);
    home.style.setProperty('--av-motion-scroll',shift.toFixed(1)+'px');
  };
  const scheduleParallax = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(refreshParallax);
  };
  window.addEventListener('scroll',scheduleParallax,{passive:true});
  window.addEventListener('resize',scheduleParallax,{passive:true});
  motionQuery?.addEventListener?.('change',() => {if (reduceMotion()) showAll();scheduleParallax();});
  new MutationObserver(() => {if (reduceMotion()) showAll();scheduleParallax();})
    .observe(document.documentElement,{attributes:true,attributeFilter:['data-motion','data-adminerva-reduce-motion']});
  window.addEventListener('pageshow',scheduleParallax);
  scheduleParallax();
}
