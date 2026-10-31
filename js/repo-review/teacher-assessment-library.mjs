import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs";
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"teacherBlueprints");
const el=id=>document.getElementById(id),status=el("tl-status"),workspace=el("tl-workspace");
const form=el("tl-create"),list=el("tl-list"),shareDialog=el("tl-share-dialog"),
  previewDialog=el("tl-preview-dialog");
let items=[],filter="mine",editing=null,sharing=null,pendingWrite=false;
const say=message=>status.textContent=message;
const picker=createTenantSchoolPicker({
  host:el("tl-school-switcher"),status,
  onBeforeChange:async()=>{
    if(pendingWrite)throw new Error("Finish saving this assessment before switching schools.");
    items=[];editing=null;sharing=null;list.replaceChildren();workspace.hidden=true;
    shareDialog.close?.();previewDialog.close?.();
    form.reset();
  },
  onReady:scope=>{
    if(!scope.current?.roles.includes("teacher")){
      workspace.hidden=true;say("Your role in this school does not include assessment creation.");
      return;
    }
    workspace.hidden=false;
    void refresh();
  }
});
async function perform(action,details={}) {
  const lease=picker.scope.lease();
  const result=(await api({action,schoolId:lease.schoolId,...details})).data;
  picker.scope.assertLease(lease);
  return result;
}
async function write(action,details,success) {
  if(pendingWrite)throw new Error("An assessment operation is still processing.");
  pendingWrite=true;say("Saving within your verified school…");
  for(const button of document.querySelectorAll("button"))button.disabled=true;
  try{
    const result=await perform(action,details);
    say(success);
    await refresh();
    return result;
  }catch(error){
    say(error?.message||"The change was not saved. Check your school access and retry.");
    throw error;
  }finally{
    pendingWrite=false;
    for(const button of document.querySelectorAll("button"))button.disabled=false;
  }
}
function actionButton(text,handler,alternate=false) {
  const button=document.createElement("button");
  button.type="button";button.className="tl-action"+(alternate?" alt":"");
  button.textContent=text;
  button.addEventListener("click",handler);
  return button;
}
function showPreview(item){
  el("tl-preview-heading").textContent=item.title;
  el("tl-preview-meta").textContent="Owner: "+(item.canShare?"You":item.ownerUid.slice(0,8))+" · "+item.visibility;
  el("tl-preview-description").textContent=item.description||"No description provided.";
  el("tl-preview-instructions").textContent=item.instructions||"No instructions provided.";
  const rubric=el("tl-preview-rubric");rubric.replaceChildren();
  if(!item.rubric?.length){
    const li=document.createElement("li");li.textContent="No rubric criteria in this blueprint.";rubric.append(li);
  }else for(const criterion of item.rubric){
    const li=document.createElement("li");li.textContent=criterion.name+" · "+criterion.points+" points";
    rubric.append(li);
  }
  previewDialog.showModal();
}
function render(){
  document.querySelectorAll("[data-filter]").forEach(button=>
    button.setAttribute("aria-pressed",String(button.dataset.filter===filter)));
  list.replaceChildren();
  const uid=picker.scope.current?.uid;
  const visible=items.filter(item=>{
    if(filter==="mine")return item.ownerUid===uid;
    if(filter==="shared")return item.ownerUid!==uid&&item.visibility==="selected_teachers";
    return item.ownerUid!==uid&&item.visibility==="school_teachers";
  });
  if(!visible.length){
    const empty=document.createElement("p");empty.className="tl-muted";
    empty.textContent=filter==="mine"?"You have no private assessments yet.":
      filter==="shared"?"No assessments have been shared specifically with you.":
      "No school-wide shared assessments are available.";
    list.append(empty);
  }
  for(const item of visible){
    const row=document.createElement("article");row.className="tl-row";row.setAttribute("role","listitem");
    const info=document.createElement("div"),heading=document.createElement("h3"),meta=document.createElement("p");
    heading.style.fontWeight="750";heading.textContent=item.title;
    meta.className="tl-muted";meta.textContent=(item.canShare?"Owned by you":"Shared by teacher "+item.ownerUid.slice(0,8))+
      " · "+item.visibility.replaceAll("_"," ")+" · revision "+item.contentRevision;
    info.append(heading,meta);
    const controls=document.createElement("div");controls.className="tl-actions";
    controls.append(actionButton("Preview",()=>showPreview(item),true));
    if(item.canShare){
      controls.append(actionButton("Edit",()=>edit(item),true));
      controls.append(actionButton("Share",()=>void share(item)));
      controls.append(actionButton("Archive",()=>{
        if(!confirm("Archive this draft? Existing independent copies will remain available."))return;
        void write("archive",{resourceId:item.id,expectedRevision:item.contentRevision},"Assessment archived without deleting student records.").catch(()=>{});
      },true));
    }else{
      controls.append(actionButton("Make a copy",()=>void write("copy",{resourceId:item.id},
        "Independent private copy created. The source remains unchanged.").catch(()=>{})));
    }
    row.append(info,controls);list.append(row);
  }
}
function edit(item){
  editing=item;
  form.elements.title.value=item.title;
  form.elements.description.value=item.description||"";
  form.elements.instructions.value=item.instructions||"";
  form.querySelector("h2").textContent="Edit private draft";
  form.querySelector('button[type="submit"]').textContent="Save draft revision";
  form.scrollIntoView({behavior:"smooth",block:"start"});
  form.elements.title.focus();
}
function resetEditor(){
  editing=null;form.reset();
  form.querySelector("h2").textContent="New private blueprint";
  form.querySelector('button[type="submit"]').textContent="Create private assessment";
}
async function refresh(){
  const result=await perform("list");
  items=result.items||[];
  render();
  if(result.truncated)say("Only the first assessment records are shown. Refine the library or request pagination support.");
}
document.querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",()=>{
  filter=button.dataset.filter;render();
}));
el("tl-refresh").addEventListener("click",()=>void refresh().catch(error=>say(error.message)));
form.addEventListener("submit",event=>{
  event.preventDefault();if(!form.reportValidity())return;
  const data=new FormData(form);
  const blueprint={
    title:String(data.get("title")||""),description:String(data.get("description")||""),
    instructions:String(data.get("instructions")||""),rubric:editing?.rubric||[]
  };
  const action=editing?"update":"create",details=editing?{
    resourceId:editing.id,expectedRevision:editing.contentRevision,blueprint
  }:{blueprint};
  void write(action,details,action==="create"?"Private assessment created.":"Assessment draft updated.").then(resetEditor).catch(()=>{});
});
async function share(item){
  sharing=item;el("tl-share-title").textContent=item.title;
  const radios=[...shareDialog.querySelectorAll('input[name="visibility"]')];
  radios.forEach(radio=>radio.checked=radio.value===item.visibility);
  toggleRecipients();
  shareDialog.showModal();
  try{
    const data=await perform("recipients");
    if(sharing?.id!==item.id)return;
    const host=el("tl-recipients");host.replaceChildren();
    for(const teacher of data.teachers||[]){
      const label=document.createElement("label");label.style.cssText="display:flex;gap:.6rem;align-items:center;padding:.55rem 0";
      const check=document.createElement("input");check.type="checkbox";check.value=teacher.uid;
      check.checked=(item.sharedWithUids||[]).includes(teacher.uid);
      const caption=document.createElement("span");caption.textContent=teacher.name;
      label.append(check,caption);host.append(label);
    }
    if(!host.children.length){
      const empty=document.createElement("p");empty.className="tl-muted";
      empty.textContent="There are no other active teachers in this school.";host.append(empty);
    }
    if(data.truncated){
      const warning=document.createElement("p");warning.textContent="Showing the first 100 active teachers.";host.append(warning);
    }
  }catch(error){say(error?.message||"Teacher directory unavailable.");}
}
function toggleRecipients(){
  const chosen=shareDialog.querySelector('input[name="visibility"]:checked')?.value;
  el("tl-recipient-container").hidden=chosen!=="selected_teachers";
}
shareDialog.querySelectorAll('input[name="visibility"]').forEach(radio=>
  radio.addEventListener("change",toggleRecipients));
el("tl-cancel-share").addEventListener("click",()=>shareDialog.close());
el("tl-share-form").addEventListener("submit",event=>{
  event.preventDefault();if(!sharing)return;
  const visibility=shareDialog.querySelector('input[name="visibility"]:checked')?.value;
  const teacherUids=visibility==="selected_teachers"?
    [...el("tl-recipients").querySelectorAll('input:checked')].map(input=>input.value):[];
  if(visibility==="selected_teachers"&&!teacherUids.length){
    say("Select at least one verified school teacher.");return;
  }
  void write("share",{resourceId:sharing.id,visibility,teacherUids},
    "Assessment sharing updated. Recipients receive view and independent copy rights only.")
    .then(()=>{shareDialog.close();sharing=null;}).catch(()=>{});
});
el("tl-preview-close").addEventListener("click",()=>previewDialog.close());
try{
  await picker.load();
  if(!auth.currentUser)say("Sign in before accessing teacher-owned school assessments.");
}catch(error){say(error?.message||"Cannot verify teacher access to your school.");}
