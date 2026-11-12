import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs";
import {buildExternalPersonalizationPackage,parseExternalPersonalizationResponse} from "./services/external-personalization.mjs";
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"teacherBlueprints");
const scopedAssessmentApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAssessments");
const schoolAcademicsApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
const el=id=>document.getElementById(id),status=el("tl-status"),workspace=el("tl-workspace");
const form=el("tl-create"),list=el("tl-list"),shareDialog=el("tl-share-dialog"),
  previewDialog=el("tl-preview-dialog"),personalizationDialog=el("tl-personalization-dialog");
let items=[],deployments=[],filter="mine",editing=null,sharing=null,deploying=null,deployRequestKey=null,
  lifecycleTask=null,lifecycleAction=null,pendingWrite=false,personalizing=null,personalizationState=null;
const say=message=>status.textContent=message;
const picker=createTenantSchoolPicker({
  host:el("tl-school-switcher"),status,
  onBeforeChange:async()=>{
    if(pendingWrite)throw new Error("Finish saving this assessment before switching schools.");
    items=[];deployments=[];editing=null;sharing=null;deploying=null;deployRequestKey=null;
    lifecycleTask=null;lifecycleAction=null;list.replaceChildren();workspace.hidden=true;
    shareDialog.close?.();previewDialog.close?.();personalizationDialog.close?.();
    el("tl-deploy-dialog").close?.();el("tl-lifecycle-dialog").close?.();
    form.reset();togglePersonalizationFields();
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
async function performScoped(api,action,details={}){
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);
  return result;
}
function parseRubric(text){
  const lines=String(text||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(lines.length>20)throw new Error("Maximum 20 rubric criteria are supported.");
  return lines.map((line,index)=>{
    const position=line.lastIndexOf("|");
    if(position<1)throw new Error("Rubric line "+(index+1)+" must use Criterion | points.");
    const name=line.slice(0,position).trim(),value=line.slice(position+1).trim();
    const points=Number(value);
    if(!name||name.length>160||!value||!Number.isFinite(points)||points<=0||points>100)
      throw new Error("Rubric line "+(index+1)+" needs a name and 1–100 points.");
    return {name,points};
  });
}
function localDateInput(date){
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
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
const personalized=item=>item?.personalization?.enabled===true;
function togglePersonalizationFields(){
  const active=form.elements.personalizationMode?.value==="personalized";
  el("tl-personalization-fields").hidden=!active;
  if(form.elements.variantTarget)form.elements.variantTarget.required=active;
}
async function sha256Text(value){
  const bytes=new TextEncoder().encode(String(value||""));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
function renderPersonalizationState(){
  if(!personalizing||!personalizationState)return;
  const data=personalizationState,count=Number(data.count||0),target=Number(data.variantTarget||0),
    remaining=Math.max(0,target-count);
  el("tl-personalization-status").textContent=
    (data.ready?"Active pool":"Private draft pool")+" · "+count+" of "+target+
    " variants"+(remaining?" · "+remaining+" remaining":" · target reached")+".";
  const host=el("tl-personalization-samples");host.replaceChildren();
  for(const sample of data.samples||[]){
    const article=document.createElement("article");article.className="rounded-lg border border-violet-200 bg-white p-3";
    const title=document.createElement("strong");title.textContent=sample.scenarioTitle||sample.variantId;
    const summary=document.createElement("p");summary.className="text-xs text-slate-600 mt-1";
    summary.textContent=sample.summary||"Saved personalized scenario.";
    article.append(title,summary);host.append(article);
  }
  if(!host.children.length){
    const empty=document.createElement("p");empty.className="text-xs text-violet-800";
    empty.textContent="No personalized variants imported for this blueprint revision yet.";host.append(empty);
  }
  el("tl-personalization-copy").disabled=remaining===0;
  el("tl-personalization-import").disabled=remaining===0;
  el("tl-personalization-activate").disabled=data.ready||remaining>0;
}
async function loadPersonalization(item){
  personalizing=item;personalizationState=null;
  el("tl-personalization-title").textContent=item.title+" · private to your teacher account";
  el("tl-personalization-status").textContent="Loading private pool status…";
  el("tl-personalization-response").value="";
  personalizationDialog.showModal();
  try{
    personalizationState=await perform("personalization_status",{resourceId:item.id});
    if(personalizing?.id===item.id)renderPersonalizationState();
  }catch(error){
    el("tl-personalization-status").textContent=error?.message||"Personalization pool unavailable.";
  }
}
function openLifecycle(task,action){
  lifecycleTask=task;lifecycleAction=action;
  const dialog=el("tl-lifecycle-dialog"),form=el("tl-lifecycle-form"),
    deadlineField=el("tl-lifecycle-deadline-field");
  form.reset();deadlineField.hidden=action!=="reopen";
  const labels={
    close:["Close assessment","Stops new first submissions. Existing teacher-requested revisions can still be resubmitted."],
    reopen:["Reopen assessment","Allows new submissions again. If the prior deadline passed, set a new deadline."],
    archive:["Archive assessment","Removes the task from active student assignment lists while preserving submissions and grades."],
    restore_archive:["Restore archived assessment","Restores the task to its prior active/closed lifecycle state."],
    cancel:["Cancel assessment","Allowed only when no Studio/GitHub submission or grade history exists."]
  };
  el("tl-lifecycle-heading").textContent=labels[action]?.[0]||"Update deployment";
  el("tl-lifecycle-help").textContent=labels[action]?.[1]||"";
  el("tl-lifecycle-task").textContent=task.title+" · current state: "+(task.lifecycle||"active");
  if(action==="reopen"&&task.dueAt&&task.dueAt<=Date.now()){
    const next=new Date(Date.now()+24*60*60*1000);
    form.elements.newDueAt.value=localDateInput(next);
    form.elements.newDueAt.required=true;
  }else form.elements.newDueAt.required=false;
  dialog.showModal();
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
  el("tl-preview-personalization").textContent=personalized(item)
    ?"Personalized Studio assessment · target "+item.personalization.variantTarget+
      " private variants. Private prompts/evaluator notes are not included in shared previews."
    :"Standard assessment · one task for the class.";
  previewDialog.showModal();
}
function render(){
  document.querySelectorAll("[data-filter]").forEach(button=>
    button.setAttribute("aria-pressed",String(button.dataset.filter===filter)));
  list.replaceChildren();
  const uid=picker.scope.current?.uid;
  if(filter==="deployed"){
    if(!deployments.length){
      const empty=document.createElement("p");empty.className="tl-muted";
      empty.textContent="No class assessment deployments yet.";
      list.append(empty);
    }
    for(const task of deployments){
      const lifecycle=task.lifecycle||"active";
      const row=document.createElement("article");row.className="tl-row";
      const text=document.createElement("div"),heading=document.createElement("h3"),meta=document.createElement("p");
      heading.style.fontWeight="750";heading.textContent=task.title;
      meta.className="tl-muted";
      const handedOver=task.ownerUid&&task.reviewerUid&&task.ownerUid!==task.reviewerUid;
      meta.textContent=task.submissionSource+" · "+lifecycle+" · revision "+(task.revision||1)+" · due "+(task.dueAt?
        new Date(task.dueAt).toLocaleString():"not scheduled")+
        (handedOver?" · review responsibility handed over; original blueprint ownership unchanged":"");
      text.append(heading,meta);
      const controls=document.createElement("div");controls.className="tl-actions";
      if(lifecycle!=="cancelled"){
        const gradebook=document.createElement("a");gradebook.className="tl-action alt";
        gradebook.href="school-gradebook.html?task="+encodeURIComponent(task.taskId);
        gradebook.textContent="Review & Grade";controls.append(gradebook);
      }
      if(lifecycle==="active"){
        controls.append(actionButton("Close",()=>openLifecycle(task,"close"),true));
        controls.append(actionButton("Archive",()=>openLifecycle(task,"archive"),true));
        controls.append(actionButton("Cancel",()=>openLifecycle(task,"cancel"),true));
      }else if(lifecycle==="closed"){
        controls.append(actionButton("Reopen",()=>openLifecycle(task,"reopen")));
        controls.append(actionButton("Archive",()=>openLifecycle(task,"archive"),true));
        controls.append(actionButton("Cancel",()=>openLifecycle(task,"cancel"),true));
      }else if(lifecycle==="archived"){
        controls.append(actionButton("Restore",()=>openLifecycle(task,"restore_archive"),true));
      }
      row.append(text,controls);list.append(row);
    }
    return;
  }
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
      " · "+(personalized(item)?"personalized Studio":"standard")+
      " · "+item.visibility.replaceAll("_"," ")+" · revision "+item.contentRevision;
    info.append(heading,meta);
    const controls=document.createElement("div");controls.className="tl-actions";
    controls.append(actionButton("Preview",()=>showPreview(item),true));
    if(item.canShare){
      controls.append(actionButton("Edit",()=>edit(item),true));
      controls.append(actionButton("Share",()=>void share(item)));
      if(personalized(item))controls.append(actionButton("Personalization",()=>void loadPersonalization(item)));
      controls.append(actionButton("Deploy",()=>void prepareDeployment(item),true));
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
  form.elements.personalizationMode.value=personalized(item)?"personalized":"standard";
  form.elements.variantTarget.value=String(item.personalization?.variantTarget||30);
  form.elements.variationGuidance.value=item.personalization?.variationGuidance||"";
  togglePersonalizationFields();
  form.elements.rubric.value=(item.rubric||[]).map(criterion=>criterion.name+" | "+criterion.points).join("\n");
  form.querySelector("h2").textContent="Edit private draft";
  form.querySelector('button[type="submit"]').textContent="Save draft revision";
  form.scrollIntoView({behavior:"smooth",block:"start"});
  form.elements.title.focus();
}
function resetEditor(){
  editing=null;form.reset();togglePersonalizationFields();
  form.querySelector("h2").textContent="New private blueprint";
  form.querySelector('button[type="submit"]').textContent="Create private assessment";
}
async function refresh(){
  const [result,deployed]=await Promise.all([
    perform("list"),performScoped(scopedAssessmentApi,"list_teacher")
  ]);
  items=result.items||[];
  deployments=deployed.assessments||[];
  render();
  if(result.truncated)say("Only the first assessment records are shown. Pagination is required for more.");
}
document.querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",()=>{
  filter=button.dataset.filter;render();
}));
el("tl-refresh").addEventListener("click",()=>void refresh().catch(error=>say(error.message)));
form.addEventListener("submit",event=>{
  event.preventDefault();if(!form.reportValidity())return;
  const data=new FormData(form);
  let criteria;
  try{criteria=parseRubric(data.get("rubric"));}
  catch(error){say(error.message);form.elements.rubric.focus();return;}
  const isPersonalized=String(data.get("personalizationMode")||"standard")==="personalized";
  const blueprint={
    title:String(data.get("title")||""),description:String(data.get("description")||""),
    instructions:String(data.get("instructions")||""),rubric:criteria,
    personalization:isPersonalized?{
      enabled:true,mode:"ai_blueprint_pool_v1",
      variantTarget:Number(data.get("variantTarget")||30),
      variationGuidance:String(data.get("variationGuidance")||"")
    }:{enabled:false,mode:"standard"}
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
async function prepareDeployment(item){
  if(personalized(item)){
    try{
      const pool=await perform("personalization_status",{resourceId:item.id});
      if(!pool.ready){
        say("Complete and activate the private personalization pool before deployment.");
        await loadPersonalization(item);return;
      }
    }catch(error){say(error?.message||"Personalization readiness could not be verified.");return;}
  }
  deploying=item;deployRequestKey=crypto.randomUUID();
  el("tl-deploy-title").textContent=item.title;
  const form=el("tl-deploy-form");
  form.reset();
  form.elements.submissionSource.disabled=personalized(item);
  form.elements.submissionSource.value=personalized(item)?"studio":"studio";
  const now=new Date(),tomorrow=new Date(now.getTime()+24*60*60*1000);
  form.elements.opensAt.value=localDateInput(now);
  form.elements.dueAt.value=localDateInput(tomorrow);
  const select=el("tl-deploy-offering");
  select.replaceChildren();
  const placeholder=document.createElement("option");
  placeholder.value="";placeholder.textContent="Loading your assigned classes…";
  select.append(placeholder);
  el("tl-deploy-dialog").showModal();
  try{
    const offerings=(await performScoped(schoolAcademicsApi,"list_offerings")).offerings||[];
    if(deploying?.id!==item.id)return;
    select.replaceChildren();
    const initial=document.createElement("option");
    initial.value="";initial.textContent=offerings.length?"Choose your assigned class":"No active course offerings assigned";
    initial.selected=true;initial.disabled=true;select.append(initial);
    for(const offering of offerings.filter(row=>row.status==="active")){
      const option=document.createElement("option");
      option.value=offering.offeringId;
      option.textContent=offering.sectionId+" · "+offering.subjectId+" · "+offering.yearId+" / "+offering.termId;
      select.append(option);
    }
    if(select.options.length===1)say("Your school administrator must assign you a class offering before deployment.");
  }catch(error){say(error.message||"Could not load assigned classes.");}
}
el("tl-lifecycle-cancel").addEventListener("click",()=>{
  lifecycleTask=null;lifecycleAction=null;el("tl-lifecycle-dialog").close();
});
el("tl-lifecycle-form").addEventListener("submit",event=>{
  event.preventDefault();if(!lifecycleTask||!lifecycleAction||pendingWrite)return;
  const form=event.currentTarget;if(!form.reportValidity())return;
  const values=new FormData(form),details={
    taskId:lifecycleTask.taskId,expectedRevision:lifecycleTask.revision||1,
    reason:String(values.get("reason")||"")
  };
  if(lifecycleAction==="reopen"){
    const raw=String(values.get("newDueAt")||"");
    if(raw){
      const due=new Date(raw);
      if(!Number.isFinite(due.getTime())){say("Choose a valid reopened deadline.");return;}
      details.newDueAt=due.toISOString();
    }
  }
  const action=lifecycleAction,task=lifecycleTask;
  void (async()=>{
    pendingWrite=true;
    [...form.elements].forEach(control=>control.disabled=true);
    try{
      say("Saving audited assessment lifecycle change…");
      const result=await performScoped(scopedAssessmentApi,action,details);
      el("tl-lifecycle-dialog").close();lifecycleTask=null;lifecycleAction=null;
      await refresh();
      say(task.title+" is now "+result.lifecycle+".");
    }catch(error){say(error?.message||"Assessment lifecycle change could not be saved.");}
    finally{pendingWrite=false;[...form.elements].forEach(control=>control.disabled=false);}
  })();
});
el("tl-cancel-deploy").addEventListener("click",()=>{
  el("tl-deploy-form").elements.submissionSource.disabled=false;
  el("tl-deploy-dialog").close();
});
el("tl-deploy-form").addEventListener("input",()=>{deployRequestKey=crypto.randomUUID();});
el("tl-deploy-form").addEventListener("submit",event=>{
  event.preventDefault();if(!deploying||pendingWrite)return;
  const form=event.currentTarget;
  if(!form.reportValidity())return;
  const fields=new FormData(form);
  const key=deployRequestKey||crypto.randomUUID();
  const opensAt=new Date(String(fields.get("opensAt")||""));
  const dueAt=new Date(String(fields.get("dueAt")||""));
  if(!Number.isFinite(opensAt.getTime())||!Number.isFinite(dueAt.getTime())||dueAt<=opensAt){
    say("Choose a valid opening time and later deadline.");return;
  }
  void (async()=>{
    pendingWrite=true;
    const buttons=[...form.querySelectorAll("button")];
    buttons.forEach(button=>button.disabled=true);
    say("Checking your course assignment and deploying a frozen assessment…");
    try{
      const task=await performScoped(scopedAssessmentApi,"deploy",{
        blueprintId:deploying.id,offeringId:String(fields.get("offeringId")||""),
        submissionSource:personalized(deploying)?"studio":String(fields.get("submissionSource")||""),
        opensAt:opensAt.toISOString(),dueAt:dueAt.toISOString(),requestKey:key
      });
      say(task.alreadyExisted?"This assessment was already deployed. No duplicate created.":
        "Assessment deployed to your assigned school class. Students can view the task after its start time.");
      el("tl-deploy-dialog").close();deploying=null;deployRequestKey=null;
      await refresh();
    }catch(error){say(error.message||"Deployment could not be completed. Retry the same request safely.");}
    finally{pendingWrite=false;buttons.forEach(button=>button.disabled=false);}
  })();
});
form.elements.personalizationMode.addEventListener("change",togglePersonalizationFields);
el("tl-personalization-close").addEventListener("click",()=>{personalizing=null;personalizationState=null;personalizationDialog.close();});
el("tl-personalization-copy").addEventListener("click",()=>void (async()=>{
  if(!personalizing||!personalizationState)return;
  const count=Number(personalizationState.count||0),target=Number(personalizationState.variantTarget||0),
    missing=Math.max(0,target-count);
  if(!missing){say("The private pool already meets its target.");return;}
  const batchCount=Math.min(15,missing),batchIndex=Math.floor(count/15)+1,totalBatches=Math.ceil(target/15);
  try{
    const packageText=buildExternalPersonalizationPackage({
      assessment:{
        title:personalizing.title,assessmentFormat:"studio_code",assessmentMode:"personalized",
        maxScore:(personalizing.rubric||[]).reduce((sum,row)=>sum+Number(row.points||0),0),
        taskContext:personalizing.instructions||personalizing.description||"",
        evalCriteria:(personalizing.rubric||[]).map(row=>row.name+" | "+row.points).join("\n")
      },
      guidance:personalizing.personalization?.variationGuidance||"",
      count:batchCount,batchIndex,totalBatches,
      existingScenarios:personalizationState.scenarioRegistry||[]
    });
    await navigator.clipboard.writeText(packageText);
    el("tl-personalization-status").textContent=
      "External AI package copied · batch "+batchIndex+" of "+totalBatches+" · "+batchCount+" variants.";
  }catch(error){el("tl-personalization-status").textContent="Package not copied: "+(error?.message||"unknown error");}
})());
el("tl-personalization-import").addEventListener("click",()=>void (async()=>{
  if(!personalizing||!personalizationState||pendingWrite)return;
  const missing=Math.max(0,Number(personalizationState.variantTarget||0)-Number(personalizationState.count||0)),
    expectedCount=Math.min(15,missing);
  if(!expectedCount){el("tl-personalization-status").textContent="The pool already meets its target.";return;}
  try{
    const variants=await parseExternalPersonalizationResponse(el("tl-personalization-response").value,{
      expectedCount,hashPrompt:sha256Text,existingScenarios:personalizationState.scenarioRegistry||[]
    });
    pendingWrite=true;el("tl-personalization-import").disabled=true;
    const result=await perform("personalization_import",{
      resourceId:personalizing.id,expectedRevision:personalizing.contentRevision,variants
    });
    personalizationState=await perform("personalization_status",{resourceId:personalizing.id});
    el("tl-personalization-response").value="";renderPersonalizationState();
    say("Imported "+variants.length+" private personalized variants. "+result.count+" saved for this blueprint revision.");
  }catch(error){
    el("tl-personalization-status").textContent="Import failed: "+(error?.message||"unknown error");
  }finally{pendingWrite=false;renderPersonalizationState();}
})());
el("tl-personalization-activate").addEventListener("click",()=>void (async()=>{
  if(!personalizing||!personalizationState||pendingWrite)return;
  try{
    pendingWrite=true;el("tl-personalization-activate").disabled=true;
    await perform("personalization_activate",{
      resourceId:personalizing.id,expectedRevision:personalizing.contentRevision
    });
    personalizationState=await perform("personalization_status",{resourceId:personalizing.id});
    renderPersonalizationState();say("Private personalization pool activated. This blueprint can now be deployed to Adminerva Studio.");
  }catch(error){el("tl-personalization-status").textContent="Activation failed: "+(error?.message||"unknown error");}
  finally{pendingWrite=false;renderPersonalizationState();}
})());
el("tl-preview-close").addEventListener("click",()=>previewDialog.close());
try{
  await picker.load();
  if(!auth.currentUser)say("Sign in before accessing teacher-owned school assessments.");
}catch(error){say(error?.message||"Cannot verify teacher access to your school.");}
