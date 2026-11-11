import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const get=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolPilotSandbox");
const workspace=get("pilotWorkspace"),status=get("pilotStatus"),form=get("pilotRecordForm");
let records=[],grants=[],shared=[],busy=false,allowed=false;
function say(id,message){get(id).textContent=message;}
function node(tag,className,text){
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(text!==undefined)element.textContent=String(text);
  return element;
}
function resetEditor(){
  form.reset();form.elements.recordId.value="";form.elements.kind.disabled=false;
  get("pilotEditorTitle").textContent="Create an example";
  get("pilotDeleteRecord").hidden=true;
  say("pilotEditorStatus","");
}
function clear(){
  records=[];grants=[];shared=[];allowed=false;workspace.hidden=true;
  get("pilotRecordList").replaceChildren();
  get("pilotPreviewResults").replaceChildren();
  get("pilotGrantedList").replaceChildren();
  get("pilotSource").replaceChildren(new Option("My own teaching resources",""));
  resetEditor();
}
const pilotSchool="mcs-manila";
let sessionRevision=0,activeUid=null;
const pickerHost=get("pilotSchoolPicker");
pickerHost.textContent="MCS · private teacher pilot";
async function perform(action,details={}){
  const user=auth.currentUser,revision=sessionRevision;
  if(!allowed||!user||user.uid!==activeUid)
    throw Error("Sign in with your approved MCS teacher account.");
  const result=(await api({schoolId:pilotSchool,action,...details})).data;
  if(revision!==sessionRevision||auth.currentUser?.uid!==user.uid)
    throw Error("Your account changed. Reload the private pilot workspace.");
  return result;
}
function currentSchool(){return allowed?pilotSchool:null;}
async function startPilot(user){
  const revision=++sessionRevision;
  clear();activeUid=user?.uid||null;
  if(!user){
    status.textContent="Sign in with your approved MCS teacher account.";
    return;
  }
  status.textContent="Checking your MCS teacher approval…";
  try{
    const result=(await api({schoolId:pilotSchool,action:"bootstrap"})).data;
    if(revision!==sessionRevision||auth.currentUser?.uid!==user.uid)return;
    allowed=result.schoolId===pilotSchool&&result.role==="teacher";
    workspace.hidden=!allowed;
    pickerHost.textContent="Manila Cathedral School · "+(
      result.accessMode==="verified_legacy_teacher"?"approved legacy teacher":"verified school teacher");
    if(!allowed)throw Error("Teacher approval could not be verified.");
    await loadOverview();
  }catch(error){
    if(revision!==sessionRevision)return;
    workspace.hidden=true;
    status.textContent="Pilot unavailable: "+(error.message||"Verify your teacher access and try again.");
  }
}
function setBusy(value){busy=value;for(const button of workspace.querySelectorAll("button"))button.disabled=value;}

function switchTab(tab){
  for(const button of document.querySelectorAll("[data-pilot-tab]")){
    const active=button.dataset.pilotTab===tab;
    button.setAttribute("aria-selected",String(active));
    button.setAttribute("aria-controls","pilot-"+button.dataset.pilotTab);
    button.tabIndex=active?0:-1;
    button.className="rounded-lg px-4 py-2.5 text-sm font-bold "+(active?"bg-indigo-900 text-white":"border border-slate-300 bg-white");
  }
  for(const name of ["preview","simulation","sandbox","tour"])get("pilot-"+name).hidden=name!==tab;
}
const pilotTabs=[...document.querySelectorAll("[data-pilot-tab]")];
pilotTabs.forEach(button=>{
  button.addEventListener("click",()=>switchTab(button.dataset.pilotTab));
  button.addEventListener("keydown",event=>{
    const index=pilotTabs.indexOf(button);
    const next=event.key==="ArrowRight"?(index+1)%pilotTabs.length:
      event.key==="ArrowLeft"?(index+pilotTabs.length-1)%pilotTabs.length:
      event.key==="Home"?0:event.key==="End"?pilotTabs.length-1:-1;
    if(next<0)return;
    event.preventDefault();
    switchTab(pilotTabs[next].dataset.pilotTab);
    pilotTabs[next].focus();
  });
});
switchTab("preview");
function renderRecords(){
  const list=get("pilotRecordList");
  list.replaceChildren();
  say("pilotSandboxCount",records.length+" private example"+(records.length===1?"":"s"));
  if(!records.length){list.append(node("p","text-sm text-slate-500 rounded-lg border border-dashed border-slate-300 p-4","No test records yet. Create your first private example."));return;}
  for(const record of records){
    const button=node("button","w-full text-left rounded-xl border border-slate-200 p-4 hover:border-indigo-400 focus-visible:outline-2 focus-visible:outline-indigo-700");
    button.type="button";
    const kind=node("span","text-xs font-extrabold text-indigo-700 uppercase",record.kind.replaceAll("_"," "));
    const title=node("strong","block text-slate-900 mt-1",record.title);
    const detail=node("span","block text-xs text-slate-500 mt-1","Private · Updated "+(record.updatedAt||"recently"));
    button.append(kind,title,detail);
    button.addEventListener("click",()=>editRecord(record));
    list.append(button);
  }
}
function editRecord(record){
  form.elements.recordId.value=record.id;form.elements.kind.value=record.kind;
  form.elements.kind.disabled=Boolean(record.payload);
  form.elements.title.value=record.title;form.elements.details.value=record.details||"";
  get("pilotEditorTitle").textContent="Edit private example";
  get("pilotDeleteRecord").hidden=false;
  say("pilotEditorStatus","Editing a copy owned by your account only.");
  switchTab("sandbox");
  form.elements.title.focus();
}
function renderGrants(){
  const source=get("pilotSource"),prior=source.value;
  source.replaceChildren(new Option("My own teaching resources",""));
  for(const grant of shared){
    source.add(new Option(grant.ownerLabel+" · expires "+grant.expiresAt.slice(0,10),grant.ownerUid));
  }
  if(shared.some(g=>g.ownerUid===prior))source.value=prior;
  const granted=get("pilotGrantedList");granted.replaceChildren();
  if(!grants.length){granted.append(node("p","text-sm text-slate-500","You have not granted another teacher preview access."));return;}
  for(const grant of grants){
    const row=node("div","flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3");
    const textBox=node("div","min-w-0");
    textBox.append(node("strong","block text-sm text-slate-900 break-words",grant.viewerEmail),
      node("span","block text-xs text-slate-500 mt-1","Expires "+grant.expiresAt.slice(0,10)));
    const revoke=node("button","rounded-lg border border-red-300 bg-white text-red-800 font-bold text-sm px-3 py-2","Revoke");
    revoke.type="button";
    revoke.addEventListener("click",()=>void revokeGrant(grant));
    row.append(textBox,revoke);granted.append(row);
  }
}
async function loadOverview(){
  const school=currentSchool();
  status.textContent="Loading your private pilot records and preview permissions…";
  try{
    const result=await perform("overview");
    if(school!==currentSchool())return;
    records=result.records||[];
    grants=result.grantedByMe||[];
    shared=result.sharedWithMe||[];
    renderRecords();renderGrants();
    document.dispatchEvent(new CustomEvent("adminerva:pilot-overview",{detail:{records:records.slice(),schoolId:school}}));
    status.textContent="Verified school ready · your sandbox contains "+records.length+" private test record"+(records.length===1?"":"s")+".";
  }catch(error){
    status.textContent="Pilot sandbox could not load: "+(error.message||"Try refreshing the page.");
  }
}
form.addEventListener("submit",async event=>{
  event.preventDefault();if(busy)return;
  const inputs=form.elements,kind=inputs.kind.value,title=inputs.title.value,details=inputs.details.value;
  const recordId=inputs.recordId.value||undefined;
  const expectedVersion=recordId?records.find(row=>row.id===recordId)?.version:undefined;
  setBusy(true);say("pilotEditorStatus","Saving your private example…");
  try{
    await perform("save_record",{recordId,expectedVersion,kind,title,details});
    resetEditor();await loadOverview();say("pilotEditorStatus","Example saved to your account's private sandbox.");
  }catch(error){say("pilotEditorStatus","Save failed: "+(error.message||"Try again."));}
  finally{setBusy(false);}
});
get("pilotNewRecord").addEventListener("click",()=>{resetEditor();form.elements.title.focus();});
get("pilotDeleteRecord").addEventListener("click",async()=>{
  const recordId=form.elements.recordId.value;
  if(busy||!recordId||!confirm("Delete this private pilot example? Official school records will not be affected."))return;
  setBusy(true);
  try{await perform("delete_record",{recordId});resetEditor();await loadOverview();say("pilotEditorStatus","Private example deleted.");}
  catch(error){say("pilotEditorStatus","Delete failed: "+(error.message||"Try again."));}
  finally{setBusy(false);}
});
async function revokeGrant(grant){
  if(busy||!confirm("Revoke this teacher's read-only preview access?"))return;
  setBusy(true);say("pilotGrantStatus","Revoking preview access…");
  try{await perform("revoke_preview",{viewerUid:grant.viewerUid});await loadOverview();say("pilotGrantStatus","Preview access revoked.");}
  catch(error){say("pilotGrantStatus","Could not revoke: "+(error.message||"Try again."));}
  finally{setBusy(false);}
}
get("pilotGrantForm").addEventListener("submit",async event=>{
  event.preventDefault();if(busy)return;
  const inputs=event.currentTarget.elements;
  setBusy(true);say("pilotGrantStatus","Verifying recipient and creating an expiring preview grant…");
  try{
    const result=await perform("grant_preview",{viewerEmail:inputs.email.value,ownerLabel:inputs.label.value});
    inputs.email.value="";await loadOverview();
    say("pilotGrantStatus","Preview granted through "+result.expiresAt.slice(0,10)+". No edit rights were added.");
  }catch(error){say("pilotGrantStatus","Grant failed: "+(error.message||"Try again."));}
  finally{setBusy(false);}
});
get("pilotLoadPreview").addEventListener("click",async()=>{
  if(busy)return;
  const ownerUid=get("pilotSource").value||auth.currentUser?.uid;
  setBusy(true);say("pilotPreviewStatus","Loading authorized teacher resource summaries…");
  get("pilotPreviewResults").replaceChildren();
  try{
    const result=await perform("preview_dashboard",{ownerUid});
    for(const [kind,items] of Object.entries(result.preview||{})){
      if(!["schedules","assessmentBlueprints","assessments","planning"].includes(kind))continue;
      const card=node("article","rounded-xl border border-slate-200 bg-slate-50 p-4");
      const title=node("h3","font-extrabold text-slate-900",{
        schedules:"Schedules",assessmentBlueprints:"Assessment blueprints",
        assessments:"Deployed assessments",planning:"Lesson plans & presentations"
      }[kind]||kind);
      card.append(title,node("p","text-xs text-slate-500 mt-1",items.length+" summary item"+(items.length===1?"":"s")+" · no student data"));
      const list=node("ul","mt-3 space-y-2");
      for(const item of items.slice(0,30)){
        const li=node("li","text-sm border-t border-slate-200 pt-2");
        li.append(node("strong","block break-words",item.label));
        li.append(node("span","text-xs text-slate-500",(item.schoolYear||item.status||item.visibility||"Teacher-owned resource")));
        list.append(li);
      }
      if(!items.length)list.append(node("li","text-sm text-slate-500","No V4 resources to preview here."));
      card.append(list);get("pilotPreviewResults").append(card);
    }
    document.dispatchEvent(new CustomEvent("adminerva:pilot-preview",{detail:result}));
    say("pilotPreviewStatus","Read-only preview loaded. Your account cannot edit these teacher-owned records.");
  }catch(error){say("pilotPreviewStatus","Preview unavailable: "+(error.message||"Ask the owner to grant access."));}
  finally{setBusy(false);}
});
onAuthStateChanged(auth,user=>{void startPilot(user);});
export {perform,loadOverview,switchTab};
