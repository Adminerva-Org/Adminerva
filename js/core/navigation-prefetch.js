/**
 * Intent-based same-origin page prefetch.
 * Fetch only public HTML shells, never authenticated data or student-specific URLs.
 * Saves bandwidth by waiting for deliberate mouse/keyboard navigation intent.
 */
(() => {
  const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  if(connection?.saveData||/^(slow-2g|2g)$/.test(String(connection?.effectiveType||"")))return;
  const visited=new Set(),scheduled=new WeakMap();
  const MAX_PREFETCH=5;
  function targetFor(anchor){
    if(!anchor||anchor.hasAttribute("download")||anchor.target&&anchor.target!=="_self")return null;
    try{
      const url=new URL(anchor.href,location.href);
      if(url.origin!==location.origin||url.search||url.pathname===location.pathname||
        !/\.html$/i.test(url.pathname))return null;
      return url.origin+url.pathname;
    }catch{return null;}
  }
  function schedule(anchor){
    if(!anchor||visited.size>=MAX_PREFETCH||scheduled.has(anchor))return;
    const url=targetFor(anchor);
    if(!url||visited.has(url))return;
    const timer=setTimeout(()=>{
      scheduled.delete(anchor);
      if(visited.has(url)||visited.size>=MAX_PREFETCH)return;
      visited.add(url);
      const link=document.createElement("link");
      link.rel="prefetch";link.as="document";link.href=url;
      document.head.append(link);
    },125);
    scheduled.set(anchor,timer);
  }
  document.addEventListener("pointerover",event=>{
    if(event.pointerType&&event.pointerType!=="mouse"&&event.pointerType!=="pen")return;
    schedule(event.target.closest?.("a[href]"));
  },{passive:true});
  document.addEventListener("pointerout",event=>{
    const anchor=event.target.closest?.("a[href]"),timer=scheduled.get(anchor);
    if(!timer||anchor.contains(event.relatedTarget))return;
    clearTimeout(timer);scheduled.delete(anchor);
  },{passive:true});
  document.addEventListener("focusin",event=>schedule(event.target.closest?.("a[href]")));
  document.addEventListener("focusout",event=>{
    const anchor=event.target.closest?.("a[href]"),timer=scheduled.get(anchor);
    if(timer){clearTimeout(timer);scheduled.delete(anchor);}
  });
})();