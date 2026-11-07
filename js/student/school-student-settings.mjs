import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolStudentProfile");
const el=id=>document.getElementById(id);
let busy=false,epoch=0,profile=null;

function say(message,error=false){
  el("studentSettingsStatus").textContent=message;
  el("studentSettingsStatus").className="text-sm "+(error?"text-rose-700":"text-slate-600");
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
}
function classLabel(item){return [item.section,item.subject,item.term,item.year].filter(Boolean).join(" · ");}
function repositoryForm(item){
  const form=make("form","rounded-xl border border-slate-200 p-4");
  form.dataset.offeringId=item.offeringId;
  const heading=make("div","flex flex-col sm:flex-row gap-2 sm:items-start sm:justify-between");
  const identity=make("div","");
  identity.append(make("strong","block",classLabel(item)),
    make("span","block text-xs text-slate-500 mt-1","Offering "+item.offeringId));
  const saved=make("span","text-xs font-bold rounded-full bg-slate-100 px-2 py-1",
    item.repository?"Configured":"Not configured");
  heading.append(identity,saved);form.append(heading);
  const grid=make("div","grid sm:grid-cols-2 gap-3 mt-4");
  const repoLabel=make("label","text-sm font-bold","Repository URL");
  const repoInput=document.createElement("input");repoInput.name="repositoryUrl";repoInput.type="url";
  repoInput.required=true;repoInput.maxLength=300;repoInput.className="mt-1 w-full border rounded-lg p-2.5";
  repoInput.placeholder="https://github.com/owner/repository";repoInput.value=item.repositoryUrl||"";
  repoLabel.append(repoInput);
  const userLabel=make("label","text-sm font-bold","GitHub username (optional)");
  const userInput=document.createElement("input");userInput.name="githubUsername";userInput.maxLength=39;
  userInput.className="mt-1 w-full border rounded-lg p-2.5";userInput.value=item.githubUsername||"";
  userLabel.append(userInput);grid.append(repoLabel,userLabel);form.append(grid);
  const actions=make("div","mt-3 flex flex-wrap gap-2");
  const save=make("button","rounded-lg bg-cyan-800 text-white px-4 py-2 text-sm font-bold","Save repository");
  save.type="submit";actions.append(save);
  if(item.repository){
    const clear=make("button","rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-2 text-sm font-bold","Clear");
    clear.type="button";
    clear.addEventListener("click",()=>void clearRepository(item));
    actions.append(clear);
  }
  form.append(actions);
  form.addEventListener("submit",event=>void saveRepository(event,item));
  return form;
}
function render(){
  el("studentSettingsName").textContent=profile?.displayName||"Student";
  el("studentSettingsIdentity").textContent="Verified person "+(profile?.personId||"—")+" · "+
    (profile?.classes?.length||0)+" active course offering"+((profile?.classes?.length||0)===1?"":"s");
  const host=el("studentSettingsClasses");host.replaceChildren();
  if(!profile?.classes?.length){
    host.append(make("p","rounded-xl border border-dashed p-4 text-sm text-slate-500",
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
