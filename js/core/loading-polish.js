/** Keep initial page navigation calm without hiding explicit task progress. */
(() => {
  const install=()=>{
    const loader=document.getElementById("subtleLoader");
    const text=document.getElementById("subtleLoaderText");
    if(!loader||!text)return;
    const style=document.createElement("style");
    style.id="av-page-load-polish";
    style.textContent='#subtleLoader[data-av-boot="true"]{display:none!important}html:has(body#pageBody.hidden) #subtleLoader{display:none!important}';
    document.head.append(style);
    const sync=()=>{
      // The HTML shell already communicates initial loading. Continue showing
      // the brand loader for real long-running actions, approvals and saves.
      loader.dataset.avBoot=String(/^Opening page[.… ]*$/i.test(text.textContent.trim()));
    };
    const observer=new MutationObserver(sync);
    observer.observe(text,{childList:true,characterData:true,subtree:true});
    sync();
    window.addEventListener("pagehide",()=>observer.disconnect(),{once:true});
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});
  else install();
})();