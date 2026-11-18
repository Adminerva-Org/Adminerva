(() => {
  "use strict";
  const STATE_KEY="__adminervaReleaseFooterState";
  if(globalThis[STATE_KEY]?.mount){globalThis[STATE_KEY].mount();return;}
  const state=globalThis[STATE_KEY]={mount:null,label:""};
  const VERSION_ATTR="data-adminerva-version";
  const FOOTER_ID="adminerva-site-footer";
  function pageLabel(){
    const file=location.pathname.split("/").filter(Boolean).at(-1)||"index.html";
    return (file.replace(/\.html$/i,"")||"home").replace(/-/g," ");
  }
  function scriptBase(){
    const script=[...document.scripts].find(node=>/\/js\/core\/release-footer\.js(?:\?|$)/.test(node.src));
    if(!script?.src)return {build:"live",manifest:new URL("site-release.json",location.href).href};
    const url=new URL(script.src,location.href),raw=url.searchParams.get("v")||"live";
    return {build:raw.length>12?raw.slice(0,12):raw,manifest:new URL("../../site-release.json",url).href};
  }
  function ensureFooterStyle(){
    if(document.querySelector('link[href*="css/adminerva-ui.css"]'))return;
    if(document.getElementById("adminerva-release-footer-style"))return;
    const style=document.createElement("style");
    style.id="adminerva-release-footer-style";
    style.textContent=`
      body.av-with-footer{min-height:100dvh}
      .av-site-footer{box-sizing:border-box;margin-top:auto;padding:.7rem clamp(1rem,2vw,1.5rem);width:100%;display:flex;align-items:center;gap:.8rem 1rem;flex-wrap:wrap;background:#0d1b2d;color:#cbd5e1;border-top:1px solid #26435a;font:500 .78rem/1.45 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
      .av-site-footer .av-footer-brand{font-weight:900;color:#4dd6e8;letter-spacing:.08em}
      .av-site-footer .av-footer-version{color:#bae6fd!important;font-weight:750;text-decoration:none!important;overflow-wrap:anywhere}
      .av-site-footer nav{margin-left:auto;display:flex;align-items:center;flex-wrap:wrap;gap:.35rem .9rem}
      .av-site-footer nav a{color:inherit;text-decoration:underline;text-underline-offset:.2em}
      .av-site-footer a:hover{color:#67e8f9}
      @media(max-width:640px){.av-site-footer{justify-content:center;text-align:center;padding-bottom:max(.8rem,env(safe-area-inset-bottom))}.av-site-footer .av-footer-version{order:3;width:100%}.av-site-footer nav{margin-left:0;justify-content:center}}
    `;
    document.head.append(style);
  }
  function isLegacyGlobalFooter(node){
    if(!(node instanceof HTMLElement)||node.id===FOOTER_ID||node.classList.contains("av-site-footer"))return false;
    if(node.matches("footer.lab-footer"))return true;
    const text=String(node.textContent||"").replace(/\s+/g," ").trim();
    const hrefs=[...node.querySelectorAll("a[href]")].map(link=>link.getAttribute("href")||"");
    const hasPatch=hrefs.some(href=>/patch-notes\.html/.test(href));
    const hasWiki=hrefs.some(href=>/wiki\.html/.test(href));
    const hasPrivacy=hrefs.some(href=>/#privacy/.test(href));
    return /ADMINERVA/i.test(text)&&hasPatch&&hasWiki&&hasPrivacy;
  }
  function ensureFooter(){
    ensureFooterStyle();
    for(const node of [...document.querySelectorAll("body > footer")])if(isLegacyGlobalFooter(node))node.remove();
    const candidates=[...document.querySelectorAll(".av-site-footer,#"+FOOTER_ID)];
    let footer=candidates.find(node=>node.querySelector("["+VERSION_ATTR+"]"))||candidates[0]||null;
    for(const node of candidates)if(node!==footer)node.remove();
    if(!footer){footer=document.createElement("footer");document.body.append(footer);}
    footer.id=FOOTER_ID;
    footer.className="av-site-footer";
    footer.setAttribute("aria-label","Adminerva site information");
    const brand=document.createElement("span");brand.className="av-footer-brand";brand.textContent="ADMINERVA";
    const version=document.createElement("a");version.setAttribute(VERSION_ATTR,"");version.className="av-footer-version";version.hidden=false;
    const nav=document.createElement("nav");nav.setAttribute("aria-label","Footer links");
    for(const [label,href] of [["Help / tutorial","wiki.html"],["Wiki","wiki.html"],["Patch notes","patch-notes.html"],["Privacy","wiki.html#privacy"]]){
      const link=document.createElement("a");link.href=href;link.textContent=label;nav.append(link);
    }
    footer.replaceChildren(brand,version,nav);
    version.textContent=state.label||"Adminerva · release info loading";
    document.body.classList.add("av-with-footer");
    return version;
  }
  async function mount(){
    const base=scriptBase(),page=pageLabel();
    state.label="Adminerva · "+page+" · build "+base.build;
    const versionHost=ensureFooter();
    versionHost.textContent=state.label;
    versionHost.href="patch-notes.html";
    versionHost.title="Open Adminerva release notes";
    try{
      const response=await fetch(base.manifest,{cache:"no-store",credentials:"same-origin"});
      if(!response.ok)throw Error("release unavailable");
      const release=await response.json();
      const version=typeof release?.version==="string"&&/^\d+\.\d+\.\d+$/.test(release.version)?release.version:"unknown";
      state.label="Adminerva v"+version+" · "+page+" · build "+base.build;
      versionHost.textContent=state.label;
      versionHost.href="patch-notes.html?version="+encodeURIComponent(version);
      versionHost.title="Current site release "+version+" · page "+page+" · build "+base.build;
      document.documentElement.dataset.adminervaRelease=version;
      document.documentElement.dataset.adminervaPageBuild=base.build;
    }catch{
      state.label="Adminerva · release unavailable · "+page+" · build "+base.build;
      versionHost.textContent=state.label;
    }
  }
  state.mount=()=>void mount();
  const repair=()=>{
    if(!document.body)return;
    const footer=document.getElementById(FOOTER_ID),version=footer?.querySelector("["+VERSION_ATTR+"]");
    if(!footer||!version||!String(version.textContent||"").trim()){
      const host=ensureFooter();
      host.textContent=state.label||"Adminerva · release info loading";
    }
  };
  if("MutationObserver" in window){
    const observer=new MutationObserver(()=>queueMicrotask(repair));
    const startObserver=()=>{if(document.body)observer.observe(document.body,{childList:true,subtree:false});};
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",startObserver,{once:true});else startObserver();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void mount(),{once:true});
  else void mount();
  window.addEventListener("load",repair,{once:true});
})();