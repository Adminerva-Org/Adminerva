const routes=[
  {file:"owner-schools.html",label:"School Registry"},
  {file:"system-users.html",label:"Platform Users"},
  {file:"platform-logs.html",label:"User Action & System Logs"},
  {file:"admin-analytics.html",label:"Monitoring & Maintenance"},
  {file:"patch-notes.html",label:"Releases"}
];
function renderPlatformWorkflow(){
  if(document.querySelector("[data-platform-admin-workflow]"))return;
  const anchor=document.getElementById("adminerva-nav");if(!anchor)return;
  const current=location.pathname.split("/").pop()||"owner-schools.html";
  const shell=document.createElement("div");shell.className="paw-shell";shell.dataset.platformAdminWorkflow="";
  const nav=document.createElement("nav");nav.className="paw-nav";nav.setAttribute("aria-label","Platform administration");
  const title=document.createElement("div");title.className="paw-title";
  const name=document.createElement("span");name.textContent="Platform administration";
  const boundary=document.createElement("span");boundary.className="paw-boundary";boundary.textContent="System scope";
  title.append(name,boundary);
  const list=document.createElement("div");list.className="paw-list";
  for(const route of routes){
    const link=document.createElement("a");link.className="paw-link";link.href=route.file;link.textContent=route.label;
    if(route.file===current)link.setAttribute("aria-current","page");
    list.append(link);
  }
  nav.append(title,list);shell.append(nav);anchor.insertAdjacentElement("afterend",shell);
  list.querySelector('[aria-current="page"]')?.scrollIntoView({block:"nearest",inline:"center"});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",renderPlatformWorkflow,{once:true});else renderPlatformWorkflow();