(() => {
  "use strict";
  const VERSION_ATTR="data-adminerva-version";
  function pageLabel(){
    const file=location.pathname.split("/").filter(Boolean).at(-1)||"index.html";
    return (file.replace(/\.html$/i,"")||"home").replace(/-/g," ");
  }
  function scriptBase(){
    const script=[...document.scripts].find(node=>/\/js\/core\/release-footer\.js(?:\?|$)/.test(node.src));
    if(!script?.src)return {build:"live",manifest:new URL("site-release.json",location.href).href};
    const url=new URL(script.src,location.href),raw=url.searchParams.get("v")||"live";
    return {
      build:raw.length>12?raw.slice(0,12):raw,
      manifest:new URL("../../site-release.json",url).href
    };
  }
  function ensureFooter(){
    let footer=document.querySelector(".av-site-footer");
    if(!footer){
      footer=document.createElement("footer");
      footer.className="av-site-footer";
      footer.id="adminerva-site-footer";
      footer.setAttribute("aria-label","Adminerva site information");
      const brand=document.createElement("span");
      brand.className="av-footer-brand";brand.textContent="ADMINERVA";
      const nav=document.createElement("nav");nav.setAttribute("aria-label","Footer links");
      for(const [label,href] of [["Help / tutorial","wiki.html"],["Wiki","wiki.html"],["Patch notes","patch-notes.html"],["Privacy","wiki.html#privacy"]]){
        const link=document.createElement("a");link.href=href;link.textContent=label;nav.append(link);
      }
      footer.append(brand,nav);document.body.append(footer);
    }
    document.body.classList.add("av-with-footer");
    let version=footer.querySelector("["+VERSION_ATTR+"]");
    if(!version){
      version=document.createElement("a");
      version.setAttribute(VERSION_ATTR,"");
      version.className="av-footer-version";
      const nav=footer.querySelector("nav");
      nav?footer.insertBefore(version,nav):footer.append(version);
    }
    return version;
  }
  async function mount(){
    const versionHost=ensureFooter(),base=scriptBase(),page=pageLabel();
    versionHost.textContent="Adminerva · "+page+" · build "+base.build;
    versionHost.href="patch-notes.html";
    versionHost.title="Open Adminerva release notes";
    try{
      const response=await fetch(base.manifest,{cache:"no-store",credentials:"same-origin"});
      if(!response.ok)throw Error("release unavailable");
      const release=await response.json();
      const version=typeof release?.version==="string"&&/^\d+\.\d+\.\d+$/.test(release.version)?release.version:"unknown";
      versionHost.textContent="Adminerva v"+version+" · "+page+" · build "+base.build;
      versionHost.href="patch-notes.html?version="+encodeURIComponent(version);
      versionHost.title="Current site release "+version+" · page "+page+" · build "+base.build;
      document.documentElement.dataset.adminervaRelease=version;
      document.documentElement.dataset.adminervaPageBuild=base.build;
    }catch{
      versionHost.textContent="Adminerva · release unavailable · "+page+" · build "+base.build;
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void mount(),{once:true});
  else void mount();
})();
