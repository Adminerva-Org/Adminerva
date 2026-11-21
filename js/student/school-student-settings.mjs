import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";
import {authorizeGithubSession,firebaseGithubLinked,getGithubSession} from "./github-session.mjs?v=f238ef34641f";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolStudentProfile");
const el=id=>document.getElementById(id);
let busy=false,epoch=0,profile=null;

function say(message,error=false){
  el("studentSettingsStatus").textContent=message;
  el("studentSettingsStatus").className="av-settings-status "+(error?"text-rose-700":"text-slate-600");
}
function make(tag,className,text){
  const node=document.createElement(tag);if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);return node;
}
async function call(action,details={}){
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);return result;
}
function setBusy(value){
  busy=value;
  for(const control of document.querySelectorAll("#studentSettingsWorkspace input,#studentSettingsWorkspace button"))
    control.disabled=value;
  const github=el("studentSettingsGithubConnect");if(github)github.disabled=value;
}
function classLabel(item){return [item.section,item.subject,item.term,item.year].filter(Boolean).join(" · ");}
function providerLabel(providerId){
  if(providerId==="google.com")return "Google";
  if(providerId==="github.com")return "GitHub";
  if(providerId==="password")return "Email / password";
  return providerId||"Unknown";
}
function renderAccount(){
  const user=auth.currentUser,providers=[...new Set((user?.providerData||[]).map(item=>providerLabel(item.providerId)))];
  el("studentSettingsAccountEmail").textContent=user?.email||"Unavailable";
  el("studentSettingsProviders").textContent=providers.length?providers.join(" · "):"Primary sign-in";
  el("studentSettingsAccountBadge").textContent=user?.emailVerified===false?"Email verification needed":"Verified sign-in";
  el("studentSettingsAccountBadge").className="av-settings-role-chip";
  el("studentSettingsAccountBadge").dataset.primary=String(user?.emailVerified!==false);
  renderGithub();
}
function renderGithub(){
  const user=auth.currentUser,session=getGithubSession(user?.uid),linked=firebaseGithubLinked(user),
    state=el("studentSettingsGithubState"),detail=el("studentSettingsGithubDetail"),button=el("studentSettingsGithubConnect");
  if(session.active){
    state.textContent="Session active"+(session.username?" · @"+session.username:"");
    state.className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 text-xs font-bold";
    detail.textContent="Private repository access is available in this browser tab. Project Hub and repository evidence can reuse this session.";
    button.textContent="Reconnect GitHub";
  }else if(linked){
    state.textContent="Linked · session authorization needed";
    state.className="rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 text-xs font-bold";
    detail.textContent="GitHub is linked to your Adminerva login, but private repository access needs a fresh browser-session authorization.";
    button.textContent="Authorize GitHub";
  }else{
    state.textContent="Not connected";
    state.className="rounded-full bg-slate-100 text-slate-600 px-2 py-1 text-xs font-bold";
    detail.textContent="Connect GitHub here if a class uses repository evidence or you need access to private repositories.";
    button.textContent="Connect GitHub";
  }
}
async function connectGithub(){
  if(busy)return;
  setBusy(true);say("Connecting GitHub to this browser session…");
  try{
    const session=await authorizeGithubSession();
    renderAccount();render();
    say("GitHub connected"+(session.username?" as @"+session.username:"")+". Repository configuration and historical school evidence were not rewritten.");
  }catch(error){
    renderAccount();
    say(error?.message||"GitHub connection did not finish.",true);
  }finally{setBusy(false);}
}
function repositoryForm(item){
  const form=make("form","av-settings-card");
  form.dataset.offeringId=item.offeringId;
  const heading=make("div","flex flex-col sm:flex-row gap-2 sm:items-start sm:justify-between");
  const identity=make("div","");
  identity.append(make("strong","block",classLabel(item)),
    make("span","block text-xs text-slate-500 mt-1","Offering "+item.offeringId));
  const saved=make("span","av-settings-role-chip",
    item.repository?"Configured":"Not configured");
  heading.append(identity,saved);form.append(heading);
  const grid=make("div","grid sm:grid-cols-2 gap-3 mt-4");
  const repoLabel=make("label","text-sm font-bold","Repository URL");
  const repoInput=document.createElement("input");repoInput.name="repositoryUrl";repoInput.type="url";
  repoInput.required=true;repoInput.maxLength=300;repoInput.className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 bg-white";
  repoInput.placeholder="https://github.com/owner/repository";repoInput.value=item.repositoryUrl||"";
  repoLabel.append(repoInput);
  const userLabel=make("label","text-sm font-bold","GitHub username (optional)");
  const userInput=document.createElement("input");userInput.name="githubUsername";userInput.maxLength=39;
  userInput.className="mt-1 w-full border border-slate-300 rounded-lg p-2.5 bg-white";
  userInput.value=item.githubUsername||getGithubSession().username||"";
  userLabel.append(userInput);grid.append(repoLabel,userLabel);form.append(grid);
  const actions=make("div","mt-3 flex flex-wrap gap-2");
  const save=make("button","av-primary-button","Save repository");
  save.type="submit";actions.append(save);
  if(item.repository){
    const clear=make("button","av-secondary-button text-rose-700","Clear");
    clear.type="button";
    clear.addEventListener("click",()=>void clearRepository(item));
    actions.append(clear);
  }
  form.append(actions);
  form.addEventListener("submit",event=>void saveRepository(event,item));
  return form;
}
function render(){
  const count=profile?.classes?.length||0;
  el("studentSettingsName").textContent=profile?.displayName||"Student";
  el("studentSettingsIdentity").textContent=count+" active course offering"+(count===1?"":"s")+" linked to this verified school account.";
  el("studentSettingsPersonId").textContent=profile?.personId||"—";
  el("studentSettingsClassCount").textContent=String(count);
  renderAccount();
  const host=el("studentSettingsClasses");host.replaceChildren();
  if(!profile?.classes?.length){
    host.append(make("p","av-settings-card av-settings-muted",
      "No active course offering is linked to this school account yet."));
    return;
  }
  for(const item of profile.classes)host.append(repositoryForm(item));
}
async function refresh(){
  const sequence=++epoch;setBusy(true);say("Loading verified school profile…");
  try{
    profile=await call("my_profile");
    if(sequence!==epoch)return;
    render();el("studentSettingsWorkspace").hidden=false;
    say("Student settings loaded. Repository credentials are not stored in the school profile.");
  }catch(error){if(sequence===epoch)say(error?.message||"Student settings could not load.",true);}
  finally{if(sequence===epoch)setBusy(false);}
}
async function saveRepository(event,item){
  event.preventDefault();if(busy)return;
  const form=event.currentTarget,data=new FormData(form);setBusy(true);
  try{
    say("Saving school-scoped repository configuration…");
    await call("save_repository",{offeringId:item.offeringId,
      repositoryUrl:String(data.get("repositoryUrl")||"").trim(),
      githubUsername:String(data.get("githubUsername")||"").trim()});
    await refresh();say("Repository configuration saved for "+classLabel(item)+".");
  }catch(error){say(error?.message||"Repository configuration was not saved.",true);}
  finally{setBusy(false);}
}
async function clearRepository(item){
  if(busy||!confirm("Clear the saved repository for "+classLabel(item)+"? This does not delete the GitHub repository."))return;
  setBusy(true);
  try{
    await call("clear_repository",{offeringId:item.offeringId});
    await refresh();say("Repository configuration cleared.");
  }catch(error){say(error?.message||"Repository configuration was not cleared.",true);}
  finally{setBusy(false);}
}
el("studentSettingsGithubConnect")?.addEventListener("click",()=>void connectGithub());
document.addEventListener("adminerva:github-session",()=>{renderAccount();render();});

const settingsLinks=[...document.querySelectorAll('#studentSettingsWorkspace .av-settings-nav a[href^="#"]')];
function setCurrentSettingsLink(id){
  for(const link of settingsLinks)link.toggleAttribute("aria-current",link.hash==="#"+id);
}
for(const link of settingsLinks)link.addEventListener("click",()=>setCurrentSettingsLink(link.hash.slice(1)));
if("IntersectionObserver" in window){
  const observer=new IntersectionObserver(entries=>{
    const visible=entries.filter(entry=>entry.isIntersecting)
      .sort((a,b)=>Math.abs(a.boundingClientRect.top)-Math.abs(b.boundingClientRect.top))[0];
    if(visible)setCurrentSettingsLink(visible.target.id);
  },{rootMargin:"-18% 0px -68% 0px",threshold:0});
  for(const link of settingsLinks){
    const section=document.querySelector(link.hash);if(section)observer.observe(section);
  }
}
if(location.hash&&document.querySelector(location.hash))setCurrentSettingsLink(location.hash.slice(1));

const picker=createTenantSchoolPicker({
  host:el("studentSettingsSchoolSwitcher"),status:el("studentSettingsStatus"),
  onBeforeChange:async()=>{
    if(busy)throw new Error("Finish the current save before switching schools.");
    ++epoch;profile=null;el("studentSettingsWorkspace").hidden=true;
  },
  onReady:scope=>{if(scope.current)void refresh();}
});
try{
  await picker.load();
  if(!auth.currentUser)say("Sign in with a verified school student account.",true);
}catch(error){say(error?.message||"Unable to load verified school Student Settings.",true);}
