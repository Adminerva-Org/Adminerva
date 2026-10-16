// A static website cannot hot-swap application code safely. Detect published
// releases and offer an explicit reload, respecting unsaved work.
const KEY="Adminerva_Current_Site_Release";
export function shouldOfferSiteUpdate(running,published){
  return typeof running==="string" && typeof published==="string" &&
    running.length>0 && published.length>0 && running!==published;
}
export async function checkSiteRelease(){
  const response=await fetch("site-release.json?check="+Date.now(),{cache:"no-store"});
  if(!response.ok)throw Error("Release manifest unavailable");
  const data=await response.json();
  if(typeof data.version!=="string")throw Error("Invalid release manifest");
  return data;
}
export function mountSiteUpdates(){
  let current=null;
  let alertBox=null;
  async function check(){
    if(document.visibilityState==="hidden")return;
    let release;
    try { release=await checkSiteRelease() }
    catch(error){ console.debug("Update check skipped:",error);return; }
    if(!current){current=release.version;return}
    if(!shouldOfferSiteUpdate(current,release.version))return;
    if(alertBox)return;
    alertBox=document.createElement("aside");
    alertBox.setAttribute("role","status");
    alertBox.className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm z-[400] p-4 bg-slate-900 text-white border border-cyan-400 rounded-xl shadow-2xl";
    const title=document.createElement("strong");
    title.textContent="Adminerva update available";
    const body=document.createElement("p");
    body.className="text-xs text-slate-200 my-2";
    body.textContent="A newer website version is ready. Save your work before reloading. "+String(release.notes||"");
    const action=document.createElement("button");
    action.type="button";action.className="bg-cyan-500 text-slate-950 px-4 py-2 rounded font-bold text-xs mr-2";
    action.textContent="Reload updated site";
    action.addEventListener("click",()=>{
      if(!confirm("Save your edits or cloud backup before reloading. Continue?"))return;
      current=release.version;
      // A new query URL bypasses cached HTML. JavaScript modules are then
      // revalidated according to the website's normal cache policy.
      const url=new URL(window.location.href);
      url.searchParams.set("av_release",release.version);
      window.location.assign(url.toString());
    });
    const later=document.createElement("button");
    later.type="button";later.className="text-xs underline px-2 py-2";
    later.textContent="Later";later.addEventListener("click",()=>{
      alertBox.remove();alertBox=null;
      current=release.version;
    });
    alertBox.append(title,body,action,later);
    document.body.append(alertBox);
  }
  void check();
  setInterval(()=>void check(),5*60*1000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")void check()});
}
