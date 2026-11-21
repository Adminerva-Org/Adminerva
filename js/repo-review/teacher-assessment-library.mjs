import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs";
import {buildExternalPersonalizationPackage,parseExternalPersonalizationResponse} from "./services/external-personalization.mjs";
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"teacherBlueprints");
const scopedAssessmentApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAssessments");
const schoolAcademicsApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
const migrationApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAssessmentMigration");
const el=id=>document.getElementById(id),status=el("tl-status"),workspace=el("tl-workspace");
const form=el("tl-create"),list=el("tl-list"),shareDialog=el("tl-share-dialog"),
  previewDialog=el("tl-preview-dialog"),personalizationDialog=el("tl-personalization-dialog"),legacyDialog=el("tl-legacy-dialog"),editorDialog=el("tl-editor-dialog");
const requestedFilter=new URL(location.href).searchParams.get("view");
let items=[],deployments=[],legacyDeploymentHistory=[],legacyDeploymentWarning="",filter=["mine","shared","school","deployed"].includes(requestedFilter)?requestedFilter:"mine",editing=null,sharing=null,deploying=null,
  lifecycleTask=null,lifecycleAction=null,deploymentSettingsTask=null,pendingWrite=false,personalizing=null,personalizationState=null,shareEpoch=0,deployEpoch=0,deployReady=false,recipientsReady=false;
const say=message=>status.textContent=message;
const picker=createTenantSchoolPicker({
  host:el("tl-school-switcher"),status,
  onBeforeChange:async()=>{
    if(pendingWrite)throw new Error("Finish saving this assessment before switching schools.");
    ++shareEpoch;++deployEpoch;deployReady=false;recipientsReady=false;items=[];deployments=[];legacyDeploymentHistory=[];legacyDeploymentWarning="";editing=null;sharing=null;deploying=null;
    deployOfferings=[];deploySelectedOfferings.clear();deploySucceededOfferings.clear();deployRequestKeys.clear();
    deployVariantReview=null;deployVariantLoading=false;personalizingOfferings=[];
    lifecycleTask=null;lifecycleAction=null;deploymentSettingsTask=null;personalizing=null;personalizationState=null;list.replaceChildren();workspace.hidden=true;
    shareDialog.close?.();previewDialog.close?.();personalizationDialog.close?.();legacyDialog?.close?.();editorDialog?.close?.();
    el("tl-deploy-dialog").close?.();el("tl-lifecycle-dialog").close?.();el("tl-deployment-settings-dialog").close?.();
    form.reset();togglePersonalizationFields();
  },
  onReady:scope=>{
    if(!scope.current?.roles.includes("teacher")){
      workspace.hidden=true;say("Your role in this school does not include assessment creation.");
      return;
    }
    workspace.hidden=false;
    void (async()=>{
      const migration=await migrateOwnedLegacyAssessments();
      await refresh();
      if(migration.failed) say("Assessment Studio loaded, but "+migration.failed+" older Computer Programming assessment"+(migration.failed===1?" could":"s could")+" not be consolidated. Refresh once; if it persists, the assessment needs data repair.");
      else if(migration.migrated) say("Consolidated "+migration.migrated+" existing Computer Programming assessment"+(migration.migrated===1?"":"s")+" into My Assessments.");
    })();
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
async function refreshAfterWrite(message){
  try{await refresh();say(message);}
  catch{say(message+" The list could not refresh. Use Refresh before making another change.");}
}
async function write(action,details,success) {
  if(pendingWrite)throw new Error("An assessment operation is still processing.");
  pendingWrite=true;say("Saving within your verified school…");
  const controls=[...workspace.querySelectorAll("button")].filter(button=>!button.disabled);
  controls.forEach(button=>button.disabled=true);
  try{
    const result=await perform(action,details);
    await refreshAfterWrite(success);
    return result;
  }catch(error){
    say(error?.message||"The change was not saved. Check your school access and retry.");
    throw error;
  }finally{
    pendingWrite=false;
    controls.forEach(button=>button.disabled=false);
  }
}
function sourceLabel(source){
  return ({text:"Written response",link:"Submission link",studio:"Adminerva Studio",github:"GitHub / repository evidence"})[source]||source||"Assessment response";
}
function studioProfileLabel(profile){
  return ({
    auto:"Auto project setup",
    "java-console":"Java Console",
    "java-desktop":"Java Desktop",
    "java-database":"Java + Database",
    "java-desktop-database":"Java Desktop + Database",
    web:"Web",
    "python-console":"Python Console"
  })[String(profile||"auto")]||"Auto project setup";
}
function actionButton(text,handler,alternate=false) {
  const button=document.createElement("button");
  button.type="button";button.className="tl-action"+(alternate?" alt":"");
  button.textContent=text;
  button.addEventListener("click",handler);
  return button;
}
const personalized=item=>item?.personalization?.enabled===true;
function toggleStudioProjectProfile(){
  const active=form.elements.defaultSubmissionSource?.value==="studio";
  const wrap=el("tl-studio-project-profile-wrap");
  if(wrap)wrap.hidden=!active;
  if(form.elements.studioProjectProfile)form.elements.studioProjectProfile.disabled=!active;
}
function toggleManualOpening(){
  const deployForm=el("tl-deploy-form"),control=deployForm.elements.manualOpenRequired;
  const isStudio=deployForm.elements.submissionSource.value==="studio";
  el("tl-manual-exam-option").hidden=!isStudio;
  control.disabled=!isStudio;
  if(!isStudio)control.checked=false;
}
function togglePersonalizationFields(){
  const active=form.elements.personalizationMode?.value==="personalized";
  el("tl-personalization-fields").hidden=!active;
  // Variant capacity is calculated after class selection, not authored into the blueprint form.
}
async function sha256Text(value){
  const bytes=new TextEncoder().encode(String(value||""));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
function renderPersonalizationState(){
  if(!personalizing||!personalizationState)return;
  const data=personalizationState,count=Number(data.count||0),target=Number(data.variantTarget||0),
    scoped=personalizingOfferings.length>0&&data.calculated===true,
    remaining=scoped?Math.max(0,target-count):0,
    existing=deployments.filter(task=>task.blueprintId===personalizing?.id).length;
  el("tl-personalization-status").textContent=scoped
    ?(data.ready?"Ready to deploy":"Private pool not ready")+" · "+count+" saved variants · "+target+
      " required for selected classes"+(remaining?" · "+remaining+" additional variants needed":data.poolActivated?" · no new variants needed":" · activate the existing pool")
    :count+" private variants already saved"+(existing?" · "+existing+" previous deployment(s) remain valid":"")+".";
  el("tl-personalization-roster-note").textContent=scoped
    ?"Current enrollment: "+Number(data.roster?.totalStudents||0)+" student(s) across "+personalizingOfferings.length+
      " class(es). Largest class: "+Number(data.roster?.largestClass||0)+
      ". Variants are unique within each class deployment; a minimum pool of 10 is supported."
    :(personalizing?.legacyImport?.assessmentId
        ?"The original Repository Management variants and completed student work remain in the historical assessment. They were not copied into this school pool. Open the historical assessment to review them; choose new classes in Deploy only if you are preparing a new assessment deployment."
        :"Choose classes and dates in Deploy first. Adminerva will calculate the necessary variant count. Existing student assignments and submitted work are not reset.");
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
  el("tl-personalization-copy").disabled=!scoped||remaining===0;
  el("tl-personalization-import").disabled=!scoped||remaining===0;
  el("tl-personalization-activate").disabled=!scoped||data.ready||remaining>0;
}
let personalizingOfferings=[];
async function loadPersonalization(item,offeringIds=[],initialState=null){
  personalizing=item;personalizingOfferings=[...offeringIds];personalizationState=null;
  for(const id of ["tl-personalization-copy","tl-personalization-import","tl-personalization-activate"])el(id).disabled=true;
  el("tl-personalization-title").textContent=item.title+" · private to your teacher account";
  el("tl-personalization-status").textContent="Loading private pool status…";
  el("tl-personalization-response").value="";
  personalizationDialog.showModal();
  try{
    const state=initialState||await perform("personalization_status",{
      resourceId:item.id,...(personalizingOfferings.length?{offeringIds:personalizingOfferings}:{})
    });
    if(personalizing!==item||!personalizationDialog.open)return;
    personalizationState=state;renderPersonalizationState();syncDeploymentPersonalizationReview();
  }catch(error){
    if(personalizing===item&&personalizationDialog.open)el("tl-personalization-status").textContent=error?.message||"Personalization pool unavailable.";
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
    cancel:["Cancel assessment","Allowed only when no submission, evidence, or grade history exists."]
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
function openDeploymentSettings(task){
  deploymentSettingsTask=task;
  const dialog=el("tl-deployment-settings-dialog"),form=el("tl-deployment-settings-form");
  form.reset();
  el("tl-deployment-settings-title").textContent=task.title+" · "+sourceLabel(task.submissionSource);
  if(task.opensAt)form.elements.opensAt.value=localDateInput(new Date(task.opensAt));
  if(task.dueAt)form.elements.dueAt.value=localDateInput(new Date(task.dueAt));
  form.elements.allowLateSubmissions.checked=task.allowLateSubmissions===true;
  const manual=el("tl-settings-manual-exam-option");
  manual.hidden=task.submissionSource!=="studio";
  form.elements.manualOpenRequired.disabled=task.submissionSource!=="studio";
  form.elements.manualOpenRequired.checked=task.manualOpenRequired===true;
  dialog.showModal();
}
function showPreview(item){
  el("tl-preview-heading").textContent=item.title;
  el("tl-preview-meta").textContent=(item.subject||"General")+" · "+(item.assessmentType||"Assessment")+" · "+sourceLabel(item.defaultSubmissionSource||"text")+
    (item.defaultSubmissionSource==="studio"?" · "+studioProfileLabel(item.studioProjectProfile):"")+
    " · "+(item.canShare?"Owned by you":"Shared by teacher "+item.ownerUid.slice(0,8))+" · "+item.visibility;
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
    ?"Personalized Studio assessment · variant count calculated when deployment classes are selected. Private prompts/evaluator notes are not included in shared previews."
    :"Standard assessment · one task for the class.";
  previewDialog.showModal();
}
function render(){
  document.querySelectorAll("[data-filter]").forEach(button=>
    button.setAttribute("aria-pressed",String(button.dataset.filter===filter)));
  list.replaceChildren();
  const uid=picker.scope.current?.uid;
  if(filter==="deployed"){
    if(!deployments.length&&!legacyDeploymentHistory.length){
      const empty=document.createElement("p");empty.className="tl-muted";
      empty.textContent=legacyDeploymentWarning
        ?"School-scoped deployments are empty, but historical deployments could not be checked. Open Repository Assessment Studio to manage existing legacy schedules."
        :"No class assessment deployments yet.";
      list.append(empty);
    }
    if(legacyDeploymentWarning){
      const warning=document.createElement("p");warning.className="tl-muted";
      warning.textContent="Historical Repository Management deployments could not be verified: "+legacyDeploymentWarning+
        ". Your existing legacy records have not been modified.";
      list.append(warning);
    }
    for(const task of deployments){
      const lifecycle=task.lifecycle||"active";
      const row=document.createElement("article");row.className="tl-row";
      const text=document.createElement("div"),heading=document.createElement("h3"),meta=document.createElement("p");
      heading.style.fontWeight="750";heading.textContent=task.title;
      meta.className="tl-muted";
      const handedOver=task.ownerUid&&task.reviewerUid&&task.ownerUid!==task.reviewerUid;
      meta.textContent=(task.published?"Published":"Private deployment")+" · "+sourceLabel(task.submissionSource)+
        (task.manualOpenRequired?" · Teacher session: "+(task.manualAccessState==="open"?"OPEN":
          ["closed","closing","held"].includes(task.manualAccessState)?"CLOSED":"WAITING"):"")+
        (task.submissionSource==="studio"?" · "+studioProfileLabel(task.studioProjectProfile):"")+
        " · "+lifecycle+" · revision "+(task.revision||1)+" · due "+(task.dueAt?
        new Date(task.dueAt).toLocaleString():"not scheduled")+
        (task.allowLateSubmissions?" · late submissions allowed":"")+
        (handedOver?" · review responsibility handed over; original blueprint ownership unchanged":"");
      text.append(heading,meta);
      const controls=document.createElement("div");controls.className="tl-actions";
      if(lifecycle!=="cancelled"){
        const gradebook=document.createElement("a");gradebook.className="tl-action alt";
        gradebook.href="school-gradebook.html?view=review&task="+encodeURIComponent(task.taskId);
        gradebook.textContent="Review & Grade";controls.append(gradebook);
        // Navigation only: the teacher still chooses the linked Class Record
        // column, and its school-scoped score/release policies remain enforced.
        if(task.offeringId&&task.taskId){
          const classRecord=document.createElement("a");classRecord.className="tl-action alt";
          classRecord.href="class-record.html?"+new URLSearchParams({
            offering:task.offeringId,assessment:task.taskId,source:"school"
          }).toString();
          classRecord.textContent="Add to Class Record";controls.append(classRecord);
        }
        controls.append(actionButton("Deployment settings",()=>openDeploymentSettings(task),true));
      }
      if(["active","closed"].includes(lifecycle)){
        controls.append(actionButton(task.published?"Unpublish":"Publish",()=>void setPublication(task,!task.published),!task.published));
      }
      if(lifecycle==="active"&&task.published&&task.manualOpenRequired&&task.submissionSource==="studio"){
        const isOpen=task.manualAccessState==="open",
          finalSaving=["closed","closing"].includes(task.manualAccessState)&&Number(task.manualCloseGraceUntil||0)>Date.now();
        const button=actionButton(isOpen?"Close exam":finalSaving?"Finalizing saves…":"Open exam",
          ()=>void setExamOpening(task,!isOpen),isOpen);
        button.disabled=finalSaving;
        if(finalSaving)button.title="Previous session's final cloud checkpoints are still being accepted.";
        controls.append(button);
      }
      if(task.submissionSource==="studio"&&Number(task.manualSessionEpoch||0)>0){
        controls.append(actionButton("Class save history",
          ()=>void showExamCloseReport(task),true));
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
    if(legacyDeploymentHistory.length){
      const heading=document.createElement("section");
      heading.className="tl-row";
      const title=document.createElement("h3");title.style.fontWeight="800";
      title.textContent="Historical Repository Management deployments";
      const explanation=document.createElement("p");explanation.className="tl-muted";
      explanation.textContent="These deployments remain attached to the original legacy assessments. Edit their existing class deadlines or late-submission policy here; Deploy new creates a separate school assessment and does not change them.";
      heading.append(title,explanation);list.append(heading);
      for(const historical of legacyDeploymentHistory){
        const row=document.createElement("article");row.className="tl-row";row.setAttribute("role","listitem");
        const header=document.createElement("h3");header.style.fontWeight="750";
        header.textContent=historical.title||"Historical assessment";
        const meta=document.createElement("p");meta.className="tl-muted";
        meta.textContent=(historical.published?"Published":"Unpublished")+" · Legacy "+
          (historical.submissionSource==="studio"?"Adminerva Studio":"GitHub repository")+
          " · "+(historical.deploymentCount||historical.deployments?.length||0)+" original class deployment(s)";
        row.append(header,meta);
        const entries=Array.isArray(historical.deployments)?historical.deployments:[];
        for(const assigned of entries){
          const detail=document.createElement("div");
          detail.className="mt-2 flex flex-wrap items-center justify-between gap-2";
          const line=document.createElement("p");line.className="tl-muted";
          const rawDue=assigned.deadline?new Date(assigned.deadline):null;
          const validDue=rawDue&&Number.isFinite(rawDue.getTime());
          const due=assigned.deadlineEnabled===false?"No enforced deadline":
            validDue?"Due "+rawDue.toLocaleString():"Deadline not set";
          const expired=assigned.deadlineEnabled!==false&&validDue&&rawDue.getTime()<Date.now();
          line.textContent=(assigned.section||"Unassigned section")+" · "+due+
            (expired?" · Past due":"")+
            (assigned.allowLateSubmissions?" · Late submissions permitted":"");
          const link=document.createElement("a");link.className="tl-action alt";
          link.href="repository-assessment-studio.html?"+new URLSearchParams({
            legacyAssessment:historical.legacyAssessmentId,legacyDeployment:assigned.id
          }).toString();
          link.textContent="Edit deadline / late submissions";
          detail.append(line,link);row.append(detail);
        }
        const origin=document.createElement("a");origin.className="tl-action alt";
        origin.href="repository-assessment-studio.html?"+new URLSearchParams({
          legacyAssessment:historical.legacyAssessmentId,legacyView:"deployments"
        }).toString();
        origin.textContent="View original assessment and deployments";
        row.append(origin);list.append(row);
      }
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
    const badges=document.createElement("div");badges.className="mt-2 flex flex-wrap gap-1.5";
    const subjectBadge=document.createElement("span");
    subjectBadge.className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-cyan-200";
    subjectBadge.textContent=item.subject||"General";
    const sourceBadge=document.createElement("span");
    sourceBadge.className="rounded-full border border-slate-500 bg-slate-700 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-100";
    sourceBadge.textContent=sourceLabel(item.defaultSubmissionSource||"text");
    badges.append(subjectBadge,sourceBadge);
    meta.className="tl-muted";meta.textContent=(item.assessmentType||"Assessment")+
      " · "+(personalized(item)?"personalized":"standard")+
      (item.defaultSubmissionSource==="studio"?" · "+studioProfileLabel(item.studioProjectProfile):"")+
      " · "+(item.canShare?"Owned by you":"Shared by teacher "+item.ownerUid.slice(0,8))+
      " · revision "+item.contentRevision;
    info.append(heading,badges,meta);
    const controls=document.createElement("div");controls.className="tl-actions";
    controls.append(actionButton("Preview",()=>showPreview(item),true));
    if(item.canShare&&item.legacyImport?.assessmentId){
      const legacy=document.createElement("a");legacy.className="tl-action alt";
      legacy.href="repository-assessment-studio.html?legacyAssessment="+encodeURIComponent(item.legacyImport.assessmentId);
      legacy.textContent="Open historical assessment";controls.append(legacy);
    }
    if(item.canShare){
      controls.append(actionButton("Edit",()=>edit(item),true));
      controls.append(actionButton("Share",()=>void share(item)));
      if(personalized(item))controls.append(actionButton(item.legacyImport?.assessmentId?"New school pool":"Personalization",()=>void loadPersonalization(item)));
      controls.append(actionButton(item.legacyImport?.assessmentId?"Deploy new":"Deploy",()=>void prepareDeployment(item),true));
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
  form.elements.subject.value=item.subject||"General";
  form.elements.assessmentType.value=item.assessmentType||"Assessment";
  form.elements.defaultSubmissionSource.value=item.defaultSubmissionSource||"text";
  form.elements.studioProjectProfile.value=item.studioProjectProfile||"auto";
  toggleStudioProjectProfile();
  form.elements.checkingInstructions.value=item.checkingInstructions||"";
  form.elements.personalizationMode.value=personalized(item)?"personalized":"standard";
  form.elements.variationGuidance.value=item.personalization?.variationGuidance||"";
  togglePersonalizationFields();
  form.elements.rubric.value=(item.rubric||[]).map(criterion=>criterion.name+" | "+criterion.points).join("\n");
  form.querySelector("h2").textContent="Edit private draft";
  form.querySelector('button[type="submit"]').textContent="Save draft revision";
  if(editorDialog){editorDialog.showModal();}else form.scrollIntoView({behavior:"smooth",block:"start"});
  form.elements.title.focus();
}
function resetEditor({close=true}={}){
  editing=null;form.reset();
  if(form.elements.studioProjectProfile)form.elements.studioProjectProfile.value="auto";
  toggleStudioProjectProfile();togglePersonalizationFields();
  form.querySelector("h2").textContent="New private blueprint";
  form.querySelector('button[type="submit"]').textContent="Create private assessment";
  if(close&&editorDialog?.open)editorDialog.close();
}
function openNewEditor(){
  resetEditor({close:false});
  if(editorDialog)editorDialog.showModal();
  form.elements.title.focus();
}
async function migrateOwnedLegacyAssessments(){
  try{
    const result=await performScoped(migrationApi,"list_legacy");
    const pending=(result.items||[]).filter(item=>!item.alreadyImported);
    if(!pending.length)return {migrated:0,total:(result.items||[]).length};
    say("Migrating "+pending.length+" existing Repository Management assessment"+(pending.length===1?"":"s")+" into Assessment Studio…");
    let migrated=0,failed=0;
    for(const item of pending){
      try{
        await performScoped(migrationApi,"import_legacy",{legacyAssessmentId:item.legacyAssessmentId});
        migrated++;
      }catch(error){
        failed++;
        console.warn("Legacy assessment migration skipped:",item.legacyAssessmentId,error);
      }
    }
    return {migrated,failed,total:(result.items||[]).length};
  }catch(error){
    console.warn("Automatic legacy assessment migration unavailable:",error);
    return {migrated:0,total:0,error};
  }
}
async function refresh(){
  // The V4 deployed list is not the authoritative source for historical
  // Repository Management deployments. Read their owner-scoped summaries
  // separately without importing, re-deploying or mutating legacy records.
  const legacyRead=(async()=>{
    try{return await performScoped(migrationApi,"list_legacy_deployments");}
    catch(error){
      console.warn("Legacy deployment listing unavailable:",error);
      return {items:[],error:String(error?.message||"Service unavailable")};
    }
  })();
  const [result,deployed,historical]=await Promise.all([
    perform("list"),performScoped(scopedAssessmentApi,"list_teacher"),legacyRead
  ]);
  items=result.items||[];
  deployments=deployed.assessments||[];
  legacyDeploymentHistory=historical.items||[];
  legacyDeploymentWarning=historical.error||"";
  render();
  if(result.truncated)say("Only the first assessment records are shown. Pagination is required for more.");
  if(filter==="deployed"&&legacyDeploymentWarning)
    say("School deployments loaded, but historical deployments could not be checked. The original records are unchanged.");
}
document.querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",()=>{
  filter=button.dataset.filter;
  const url=new URL(location.href);url.searchParams.set("view",filter);history.replaceState(null,"",url);
  render();
}));
el("tl-new-assessment")?.addEventListener("click",openNewEditor);
el("tl-editor-cancel")?.addEventListener("click",()=>editorDialog?.close());
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
    instructions:String(data.get("instructions")||""),subject:String(data.get("subject")||"General"),
    assessmentType:String(data.get("assessmentType")||"Assessment"),
    defaultSubmissionSource:String(data.get("defaultSubmissionSource")||"text"),
    studioProjectProfile:String(data.get("studioProjectProfile")||"auto"),
    checkingInstructions:String(data.get("checkingInstructions")||""),rubric:criteria,
    personalization:isPersonalized?{
      enabled:true,mode:"ai_blueprint_pool_v1",
      variantTarget:editing?.personalization?.variantTarget||10,
      variationGuidance:String(data.get("variationGuidance")||"")
    }:{enabled:false,mode:"standard"}
  };
  const action=editing?"update":"create",details=editing?{
    resourceId:editing.id,expectedRevision:editing.contentRevision,blueprint
  }:{blueprint};
  void write(action,details,action==="create"?"Private assessment created.":"Assessment draft updated.").then(resetEditor).catch(()=>{});
});
async function share(item){
  const turn=++shareEpoch;sharing=item;recipientsReady=false;el("tl-share-title").textContent=item.title;
  el("tl-recipients").textContent="Loading verified teachers…";
  const radios=[...shareDialog.querySelectorAll('input[name="visibility"]')];
  radios.forEach(radio=>radio.checked=radio.value===item.visibility);
  toggleRecipients();
  shareDialog.showModal();
  try{
    const data=await perform("recipients");
    if(turn!==shareEpoch||!shareDialog.open||sharing?.id!==item.id)return;
    recipientsReady=true;const host=el("tl-recipients");host.replaceChildren();
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
  }catch(error){if(turn===shareEpoch&&shareDialog.open){el("tl-recipients").textContent="Teacher directory not available. Reopen sharing to retry.";say(error?.message||"Teacher directory unavailable.");}}
}
function toggleRecipients(){
  const chosen=shareDialog.querySelector('input[name="visibility"]:checked')?.value;
  el("tl-recipient-container").hidden=chosen!=="selected_teachers";
}
shareDialog.querySelectorAll('input[name="visibility"]').forEach(radio=>
  radio.addEventListener("change",toggleRecipients));
el("tl-cancel-share").addEventListener("click",()=>{if(!pendingWrite)shareDialog.close();});
shareDialog.addEventListener("cancel",event=>{if(pendingWrite)event.preventDefault();});
shareDialog.addEventListener("close",()=>{++shareEpoch;sharing=null;recipientsReady=false;});
el("tl-share-form").addEventListener("submit",event=>{
  event.preventDefault();if(!sharing||pendingWrite)return;
  const visibility=shareDialog.querySelector('input[name="visibility"]:checked')?.value;
  const teacherUids=visibility==="selected_teachers"?
    [...el("tl-recipients").querySelectorAll('input:checked')].map(input=>input.value):[];
  if(visibility==="selected_teachers"&&!recipientsReady){say("Wait for the verified teacher list before saving.");return;}
  if(visibility==="selected_teachers"&&!teacherUids.length){
    say("Select at least one verified school teacher.");return;
  }
  void write("share",{resourceId:sharing.id,visibility,teacherUids},
    "Assessment sharing updated. Recipients receive view and independent copy rights only.")
    .then(()=>{shareDialog.close();sharing=null;}).catch(()=>{});
});
async function setPublication(task,publish){
  if(pendingWrite)return;
  const action=publish?"publish":"unpublish";
  if(!confirm(publish?
    "Publish this prepared assessment to enrolled students? Assignment notifications will be sent now.":
    "Unpublish this assessment? Existing submissions and grades are preserved, but the task will disappear from student assignment lists until republished."))return;
  pendingWrite=true;
  try{
    say(publish?"Publishing assessment to students…":"Removing assessment from student assignment lists…");
    const result=await performScoped(scopedAssessmentApi,action,{
      taskId:task.taskId,expectedRevision:task.revision||1
    });
    await refreshAfterWrite(result.alreadyCurrent?
      "Assessment publication was already in the requested state.":
      publish?"Assessment published. Enrolled students can now see it.":
        "Assessment unpublished. Existing evidence and grades were preserved.");
  }catch(error){say(error?.message||"Assessment publication could not be changed.");}
  finally{pendingWrite=false;}
}
async function showExamCloseSnapshot(task,epoch,student){
  const holder=document.getElementById("schoolAssessmentStudioHost")||document.body;
  let dialog=document.getElementById("tl-closed-exam-source");
  if(!dialog){
    dialog=document.createElement("dialog");dialog.id="tl-closed-exam-source";
    dialog.className="tl-dialog";
    dialog.style.cssText="width:min(880px,calc(100vw - 20px));max-height:92dvh;overflow:auto;border:0;border-radius:16px;padding:0;box-shadow:0 24px 90px #02061788;";
    const root=document.createElement("section");root.className="bg-white p-4 sm:p-6";
    const header=document.createElement("div");header.className="flex items-center justify-between gap-3";
    const heading=document.createElement("h2");heading.id="tl-close-source-title";
    heading.className="text-lg font-extrabold text-slate-900";
    const close=document.createElement("button");close.textContent="Close";close.className="tl-action alt";
    close.type="button";close.addEventListener("click",()=>dialog.close());
    header.append(heading,close);
    const meta=document.createElement("p");meta.id="tl-close-source-meta";
    meta.className="mt-2 text-xs text-slate-600";
    const label=document.createElement("label");label.className="mt-4 block text-sm font-bold text-slate-700";
    label.textContent="Saved file / project data";
    const fileSelect=document.createElement("select");fileSelect.id="tl-close-source-file";
    fileSelect.className="tl-input";label.append(fileSelect);
    const pre=document.createElement("pre");pre.id="tl-close-source-code";
    pre.className="mt-3 max-h-[60dvh] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100";
    pre.style.tabSize="4";
    root.append(header,meta,label,pre);
    root.insertBefore(label,pre);dialog.append(root);holder.append(dialog);
  }
  const title=dialog.querySelector("#tl-close-source-title"),
    meta=dialog.querySelector("#tl-close-source-meta"),
    fileSelect=dialog.querySelector("#tl-close-source-file"),
    pre=dialog.querySelector("#tl-close-source-code");
  title.textContent=student.displayName+" · Session "+epoch;
  meta.textContent="Loading the immutable school-received project checkpoint…";
  fileSelect.replaceChildren();fileSelect.disabled=true;pre.textContent="";
  if(!dialog.open)dialog.showModal();
  try{
    const frozen=await performScoped(scopedAssessmentApi,"exam_close_project",{
      taskId:task.taskId,sessionEpoch:epoch,studentUid:student.receiptStudentUid||student.studentUid
    });
    if(!dialog.open)return;
    meta.textContent="School received project revision "+frozen.projectRevision+
      (frozen.savedAt?" · "+new Date(frozen.savedAt).toLocaleString():"")+
      " · Project SHA-256 "+String(frozen.contentDigest||"").slice(0,20)+
      "… · Evidence of the server-received checkpoint, not a graded submission.";
    const files=Array.isArray(frozen.files)?frozen.files:[];
    fileSelect.replaceChildren();
    for(let i=0;i<files.length;i++){
      const option=document.createElement("option");
      option.value=String(i);option.textContent=files[i].path||"Source file "+(i+1);fileSelect.append(option);
    }
    const artifacts=frozen.artifacts||{};
    for(const [key,label] of [
      ["database","Database tables / history"],["design","Design / diagrams"],
      ["config","Project configuration"],["workspace","Workspace structure"],
      ["evidence","Execution evidence"],["assessment","Assessment binding"]
    ]){
      if(!Object.prototype.hasOwnProperty.call(artifacts,key))continue;
      const option=document.createElement("option");option.value="artifact:"+key;
      option.textContent=label;fileSelect.append(option);
    }
    const renderFile=()=>{
      const value=String(fileSelect.value||"");
      if(value.startsWith("artifact:")){
        const key=value.slice(9);
        pre.textContent=JSON.stringify(artifacts[key]??{},null,2);
      }else pre.textContent=files[Number(value)||0]?.content||"";
    };
    fileSelect.onchange=renderFile;fileSelect.disabled=!fileSelect.options.length;
    pre.textContent=fileSelect.options.length?"": "No files or project artifacts were captured.";
    if(fileSelect.options.length)renderFile();
  }catch(error){
    if(dialog.open){
      meta.textContent=error?.message||"The saved exam source could not be opened.";
      pre.textContent="No source content was returned.";
    }
  }
}
async function showExamCloseReport(task){
  if(pendingWrite)return;
  const holder=document.getElementById("schoolAssessmentStudioHost")||document.body;
  let dialog=document.getElementById("tl-close-checkpoint-report");
  if(!dialog){
    dialog=document.createElement("dialog");
    dialog.id="tl-close-checkpoint-report";
    dialog.className="tl-dialog";
    dialog.style.cssText="width:min(760px,calc(100vw - 20px));max-height:90dvh;overflow:auto;border:0;border-radius:16px;padding:0;box-shadow:0 24px 90px #02061766;";
    const body=document.createElement("div");
    body.className="p-4 sm:p-6 bg-white text-slate-900";
    const header=document.createElement("div");header.className="flex items-start justify-between gap-3";
    const heading=document.createElement("h2");heading.id="tl-close-report-title";heading.className="text-xl font-extrabold";
    heading.textContent="Practical exam · Final save checkpoints";
    const close=document.createElement("button");close.type="button";close.className="tl-action alt";
    close.textContent="Close";close.addEventListener("click",()=>dialog.close());
    header.append(heading,close);
    const help=document.createElement("p");help.className="mt-2 text-sm text-slate-600";
    help.textContent="This is a cloud-confirmed progress checkpoint, not a formal submission or grade. Students with no final checkpoint may still have an earlier autosaved school revision.";
    const controls=document.createElement("div");controls.className="mt-4 flex flex-wrap items-end gap-3";
    const label=document.createElement("label");label.className="text-sm font-semibold";
    label.textContent="Class session";
    const select=document.createElement("select");select.id="tl-close-report-session";
    select.className="tl-input";select.style.minWidth="150px";
    label.append(select);
    const olderLabel=document.createElement("label");olderLabel.className="text-sm font-semibold";
    olderLabel.textContent="Earlier session number";
    const older=document.createElement("input");older.id="tl-close-report-older";older.type="number";
    older.className="tl-input";older.min="1";older.step="1";
    older.placeholder="e.g. 1";older.style.width="110px";olderLabel.append(older);
    const refresh=document.createElement("button");refresh.id="tl-close-report-refresh";refresh.type="button";
    refresh.className="tl-action";refresh.textContent="Refresh confirmations";
    const exportButton=document.createElement("button");exportButton.id="tl-close-report-export";
    exportButton.type="button";exportButton.className="tl-action alt";
    exportButton.textContent="Export receipt CSV";exportButton.disabled=true;
    controls.append(label,olderLabel,refresh,exportButton);
    const summary=document.createElement("p");summary.id="tl-close-report-summary";
    summary.className="mt-3 text-sm font-bold text-slate-700";summary.setAttribute("role","status");
    const tableWrap=document.createElement("div");tableWrap.id="tl-close-report-table";
    tableWrap.className="mt-3 overflow-x-auto rounded-lg border border-slate-200";
    body.append(header,help,controls,summary,tableWrap);dialog.append(body);holder.append(dialog);
  }
  const title=dialog.querySelector("#tl-close-report-title"),
    select=dialog.querySelector("#tl-close-report-session"),
    older=dialog.querySelector("#tl-close-report-older"),
    refresh=dialog.querySelector("#tl-close-report-refresh"),
    exportButton=dialog.querySelector("#tl-close-report-export"),
    summary=dialog.querySelector("#tl-close-report-summary"),
    tableWrap=dialog.querySelector("#tl-close-report-table");
  title.textContent=task.title+" · Final cloud save checkpoints";
  select.replaceChildren();
  const current=Number(task.manualSessionEpoch||0);
  for(let epoch=current;epoch>=Math.max(1,current-19);epoch--){
    const option=document.createElement("option");option.value=String(epoch);
    option.textContent="Class session "+epoch;select.append(option);
  }
  older.max=String(current);
  older.value="";
  let generation=0,lastReport=null;
  exportButton.disabled=true;
  exportButton.onclick=()=>{
    if(!lastReport)return;
    const escapeCsv=value=>{
      let cell=String(value??"");
      // Imported student names can be spreadsheet formulas. Preserve the
      // literal value rather than executing it in Excel/Sheets after export.
      if(/^[\s]*[=+@-]/.test(cell))cell="'"+cell;
      return '"'+cell.replaceAll('"','""')+'"';
    };
    const rows=[
      ["Session","Student","Saved account UID","Final checkpoint","Project revision","Saved at","Project SHA-256","Source SHA-256","Payload bytes"],
      ...(lastReport.students||[]).map(student=>[
        lastReport.sessionEpoch,student.displayName,student.receiptStudentUid||student.studentUid||"",
        student.checkpointConfirmed?"Confirmed":lastReport.sessionClosed?"Unconfirmed":"In progress",
        student.projectRevision||"",
        student.savedAt?new Date(student.savedAt).toISOString():"",
        student.contentDigest||"",student.sourceDigest||"",student.payloadBytes||0
      ])
    ];
    const csv=rows.map(row=>row.map(escapeCsv).join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;
    link.download="adminerva-exam-checkpoints-"+lastReport.taskId.slice(0,20)+
      "-session-"+lastReport.sessionEpoch+".csv";
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const load=async()=>{
    const epoch=Number(older.value||select.value),turn=++generation;
    if(!Number.isSafeInteger(epoch)||epoch<1||epoch>current){
      summary.textContent="Choose a valid class session number.";return;
    }
    refresh.disabled=true;lastReport=null;exportButton.disabled=true;
    summary.textContent="Loading school-confirmed checkpoints…";
    tableWrap.replaceChildren();
    try{
      const report=await performScoped(scopedAssessmentApi,"exam_close_report",{
        taskId:task.taskId,sessionEpoch:epoch
      });
      if(turn!==generation||!dialog.open)return;
      lastReport=report;exportButton.disabled=false;
      summary.textContent=report.sessionClosed
        ?report.confirmed+" of "+report.enrolledStudents+
          " students have a confirmed final cloud save for class session "+report.sessionEpoch+"."
        :"Class session "+report.sessionEpoch+" is still open. Final checkpoints are not expected until the teacher closes it.";
      const payloadBytes=Number(report.confirmedPayloadBytes||0);
      if(payloadBytes>0)
        summary.textContent+=" Approximate retained source/project payload: "+
          (payloadBytes/1048576).toFixed(2)+" MiB (excludes Firestore overhead).";
      if(report.rosterSource==="capture_pending")
        summary.textContent+=" School roster capture is still processing; the current enrollment shown is provisional. Refresh to check again.";
      else if(report.rosterSource!=="close_snapshot")
        summary.textContent+=" Historical roster unavailable; showing the current enrollment roster.";
      const table=document.createElement("table");table.className="min-w-full text-left text-sm";
      const thead=document.createElement("thead");thead.className="bg-slate-100";
      const headings=document.createElement("tr");
      for(const label of ["Student","Final checkpoint","Project revision","Confirmed at","Saved code"]){
        const th=document.createElement("th");th.className="px-3 py-2 font-bold";th.textContent=label;
        headings.append(th);
      }
      thead.append(headings);table.append(thead);
      const tbody=document.createElement("tbody");
      for(const student of report.students||[]){
        const tr=document.createElement("tr");tr.className="border-t border-slate-200";
        const cells=[
          student.displayName||"Student",
          student.checkpointConfirmed?"Saved to school cloud":report.sessionClosed?"Unconfirmed":"In progress",
          student.projectRevision?"Revision "+student.projectRevision:"—",
          student.savedAt?new Date(student.savedAt).toLocaleString():"—"
        ];
        cells.forEach((value,index)=>{
          const td=document.createElement("td");td.className="px-3 py-2 align-top";
          if(index===1)td.className+=" font-bold "+
            (student.checkpointConfirmed?"text-emerald-700":"text-amber-800");
          td.textContent=value;tr.append(td);
        });
        const codeCell=document.createElement("td");codeCell.className="px-3 py-2";
        if(student.checkpointConfirmed&&(student.receiptStudentUid||student.studentUid)){
          const inspect=document.createElement("button");inspect.type="button";
          inspect.className="tl-action alt";inspect.textContent="View code";
          inspect.addEventListener("click",()=>void showExamCloseSnapshot(task,epoch,student));
          codeCell.append(inspect);
        }else codeCell.textContent="—";
        tr.append(codeCell);
        tbody.append(tr);
      }
      table.append(tbody);tableWrap.replaceChildren(table);
      if(!tbody.children.length)
        summary.textContent+=report.rosterSource==="close_snapshot"
          ?" No students were recorded in this session's closing roster."
          :" There are no currently enrolled students in the provisional roster.";
    }catch(error){
      if(turn===generation)summary.textContent=error?.message||"Could not load final exam save confirmations.";
    }finally{if(turn===generation)refresh.disabled=false;}
  };
  select.onchange=()=>{older.value="";void load();};
  older.onchange=()=>void load();
  refresh.onclick=()=>void load();
  if(!dialog.open)dialog.showModal();
  void load();
}

async function setExamOpening(task,opening){
  if(pendingWrite)return;
  if(!confirm(opening?
    "Open this Studio examination for the assigned section now? Students will be able to see their tasks and create or resume their assessment project.":
    "Close this section's Studio exam now? All connected student editors will lock on their next session check, final school cloud saves will be requested, and students will automatically leave once their save is confirmed."))return;
  pendingWrite=true;
  try{
    say(opening?"Opening this section's Studio exam…":"Closing this section's Studio exam and locking student sessions…");
    await performScoped(scopedAssessmentApi,opening?"open_exam":"close_exam",{
      taskId:task.taskId,expectedRevision:task.revision||1
    });
    await refreshAfterWrite(task.title+(opening?" is open for this section.":" is closed for this class session. Student sessions are finalizing their cloud checkpoints."));
  }catch(error){say(error?.message||"Exam access could not be changed.");}
  finally{pendingWrite=false;}
}
const MAX_BULK_DEPLOYMENTS=20;
let deployOfferings=[],deploySelectedOfferings=new Set(),deploySucceededOfferings=new Set(),
  deployRequestKeys=new Map(),deployDatePicker=null,deployTimesEdited=false,deployAttempted=false,deployRangePending=false,
  deployVariantReview=null,deployVariantLoading=false;
function deploySelectionKey(){return [...deploySelectedOfferings].sort().join("|");}
function syncDeploymentPersonalizationReview(){
  if(!deploying||!personalized(deploying)||!personalizationState?.calculated||
     !personalizingOfferings.length||personalizing?.id!==deploying.id)return;
  const key=[...personalizingOfferings].sort().join("|");
  if(key!==deploySelectionKey())return;
  deployVariantReview={key,ready:personalizationState.ready===true,status:personalizationState};
  renderDeploymentOfferings();
}
function updateDeploymentVariantMessage(){
  const review=el("tl-deploy-variant-review");
  if(!review)return;
  const existing=previouslyDeployedOfferingIds().size,ids=[...deploySelectedOfferings];
  const applicable=personalized(deploying);
  review.hidden=!applicable;
  if(!applicable)return;
  if(!ids.length){
    review.textContent=existing
      ?existing+" class deployment(s) already exist for this blueprint. Their original student variants are preserved. Select only a new class if you need another deployment."
      :deploying?.legacyImport?.assessmentId
        ?"This is a legacy-imported blueprint. Its original personalized tasks and completed student submissions remain in Repository Management. Open the historical assessment to review them; select a new class only if you intend another deployment."
        :"Choose at least one assigned class. Variant requirements will be calculated automatically.";
    return;
  }
  if(deployVariantLoading){
    review.textContent="Checking verified class rosters and existing private variants…";
    return;
  }
  const plan=deployVariantReview&&(deployAttempted||deployVariantReview.key===deploySelectionKey())?deployVariantReview:null;
  if(!plan){
    review.textContent="Deployment settings are ready. Continue to calculate variants for "+ids.length+
      " class(es); no variants will be regenerated if the existing pool is sufficient.";
    return;
  }
  const data=plan.status;
  review.textContent="Current students: "+Number(data.roster?.totalStudents||0)+
    " across "+ids.length+" class(es) · largest class "+Number(data.roster?.largestClass||0)+
    " · needed pool "+Number(data.variantTarget||0)+" · existing pool "+Number(data.count||0)+
    (plan.ready?" · ready, no additional variants required.":" · complete or activate the pool before deploying.");
}
async function reviewDeploymentPersonalization(item,ids){
  if(deployVariantLoading||pendingWrite||!item||!ids.length)return;
  const key=[...ids].sort().join("|"),turn=deployEpoch;
  deployVariantLoading=true;renderDeploymentOfferings();
  try{
    const state=await perform("personalization_status",{resourceId:item.id,offeringIds:ids});
    if(state?.calculated!==true)
      throw Error("Roster-based personalization is not available on the school backend yet. Existing deployments are unchanged; deploy the matching school Functions release before continuing.");
    if(deploying!==item||turn!==deployEpoch||deploySelectionKey()!==key||
       !el("tl-deploy-dialog").open)return;
    deployVariantReview={key,ready:state.ready===true,status:state};
    renderDeploymentOfferings();
    if(!state.ready)await loadPersonalization(item,ids,state);
  }catch(error){
    el("tl-deploy-feedback").textContent=error?.message||"Could not calculate the class variant requirement.";
    say("Variant requirements could not be verified. Try again.");
  }finally{
    deployVariantLoading=false;
    if(el("tl-deploy-dialog").open)renderDeploymentOfferings();
  }
}


function deploymentOfferingLabel(offering){
  return [offering.subjectName||offering.subjectId||"Subject",
    offering.sectionName||offering.sectionId||"Section",
    offering.yearName||offering.yearId,
    offering.termName||offering.termId].filter(Boolean).join(" · ");
}
function previouslyDeployedOfferingIds(){
  return new Set(deployments.filter(task=>task.blueprintId===deploying?.id &&
    task.lifecycle!=="cancelled").map(task=>task.offeringId).filter(Boolean));
}
function matchingDeployOfferings(){
  const term=el("tl-deploy-offering-search").value.trim().toLocaleLowerCase();
  return deployOfferings.filter(offering=>deploymentOfferingLabel(offering).toLocaleLowerCase().includes(term));
}
function renderDeploymentOfferings(){
  if(!deployAttempted&&deployVariantReview?.key!==deploySelectionKey())deployVariantReview=null;
  const selected=el("tl-deploy-selected"),list=el("tl-deploy-offerings"),
    status=el("tl-deploy-selection-status"),existing=previouslyDeployedOfferingIds();
  selected.replaceChildren();list.replaceChildren();
  const visible=matchingDeployOfferings();
  if(!deploySelectedOfferings.size){
    const hint=document.createElement("span");hint.className="text-xs text-slate-500";
    hint.textContent="No classes selected.";selected.append(hint);
  }
  for(const id of deploySelectedOfferings){
    const offering=deployOfferings.find(entry=>entry.offeringId===id);
    if(!offering)continue;
    const chip=document.createElement("span");
    chip.className="inline-flex max-w-full items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-900";
    const label=document.createElement("span");label.className="min-w-0 break-words";
    label.textContent=deploymentOfferingLabel(offering);
    const remove=document.createElement("button");remove.type="button";remove.className="rounded-full px-1 text-blue-800 hover:bg-blue-100";
    remove.setAttribute("aria-label","Remove "+deploymentOfferingLabel(offering));
    remove.textContent="×";remove.disabled=pendingWrite;
    remove.addEventListener("click",()=>{deploySelectedOfferings.delete(id);deployRequestKeys.delete(id);renderDeploymentOfferings();});
    chip.append(label,remove);selected.append(chip);
  }
  for(const offering of visible){
    const already=existing.has(offering.offeringId)||deploySucceededOfferings.has(offering.offeringId);
    const label=document.createElement("label");
    label.className="flex min-h-11 cursor-pointer items-start gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0";
    if(already)label.className+=" bg-slate-50 text-slate-500";
    const checkbox=document.createElement("input");checkbox.type="checkbox";
    checkbox.className="mt-1 h-4 w-4 shrink-0";
    checkbox.checked=deploySelectedOfferings.has(offering.offeringId);
    checkbox.disabled=already||pendingWrite;
    checkbox.addEventListener("change",()=>{
      if(checkbox.checked){
        if(deploySelectedOfferings.size>=MAX_BULK_DEPLOYMENTS){
          checkbox.checked=false;el("tl-deploy-feedback").textContent="Select no more than "+MAX_BULK_DEPLOYMENTS+" classes at a time.";return;
        }
        deploySelectedOfferings.add(offering.offeringId);
      }else{deploySelectedOfferings.delete(offering.offeringId);deployRequestKeys.delete(offering.offeringId);}
      renderDeploymentOfferings();
    });
    const span=document.createElement("span");span.className="min-w-0 break-words";
    span.textContent=deploymentOfferingLabel(offering)+(already?" · already deployed":"");
    label.append(checkbox,span);list.append(label);
  }
  if(!visible.length){
    const empty=document.createElement("p");empty.className="p-3 text-xs text-slate-500";
    empty.textContent=deployOfferings.length?"No classes match this search.":"No active teaching assignments available.";
    list.append(empty);
  }
  status.textContent=deploySelectedOfferings.size+" selected · "+visible.length+" visible · "+MAX_BULK_DEPLOYMENTS+" maximum per operation."+
    (existing.size?" Classes already deployed from this blueprint cannot be selected again.":"");
  const submit=el("tl-deploy-submit");
  submit.disabled=!deployReady||!deploySelectedOfferings.size||pendingWrite||deployRangePending||deployVariantLoading;
  const reviewReady=Boolean(deployVariantReview?.ready&&
    (deployAttempted||deployVariantReview.key===deploySelectionKey()));
  submit.textContent=personalized(deploying)&&!reviewReady
    ?"Continue · check variants"
    :"Deploy to "+deploySelectedOfferings.size+" class"+(deploySelectedOfferings.size===1?"":"es");
  updateDeploymentVariantMessage();
  el("tl-deploy-select-visible").disabled=!deployReady||pendingWrite;
  el("tl-deploy-clear").disabled=!deploySelectedOfferings.size||pendingWrite;
}
function calendarDateStamp(date){
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
}
function setDeploymentRange(first,second){
  const dates=[first,second].sort((a,b)=>a.getTime()-b.getTime());
  const form=el("tl-deploy-form");
  const opensTime=deployTimesEdited?String(form.elements.opensAt.value).slice(11)||"00:00":"00:00";
  const dueTime=deployTimesEdited?String(form.elements.dueAt.value).slice(11)||"23:59":"23:59";
  form.elements.opensAt.value=calendarDateStamp(dates[0])+"T"+opensTime;
  form.elements.dueAt.value=calendarDateStamp(dates[1])+"T"+dueTime;
  deployRangePending=false;
  if(!deployAttempted)deployRequestKeys.clear();
  renderDeploymentOfferings();
  el("tl-deploy-feedback").textContent="Schedule set: "+dates[0].toLocaleDateString()+
    " to "+dates[1].toLocaleDateString()+". Review the exact times below.";
}
function ensureDeploymentCalendar(){
  if(deployDatePicker)return;
  if(typeof window.flatpickr!=="function"){
    el("tl-deploy-feedback").textContent="The two-click calendar is unavailable. Enter opening and deadline dates in the fields below.";
    return;
  }
  deployDatePicker=window.flatpickr(el("tl-deploy-date-range"),{
    mode:"range",dateFormat:"M j, Y",allowInput:false,disableMobile:true,
    appendTo:el("tl-deploy-dialog"),
    onChange(selectedDates){
      if(selectedDates.length===1){
        deployRangePending=true;el("tl-deploy-feedback").textContent="Choose the second date to complete this range.";
        renderDeploymentOfferings();
      }
      if(selectedDates.length===2)setDeploymentRange(selectedDates[0],selectedDates[1]);
    }
  });
}
function freezeBulkDeploymentSettings(){
  const form=el("tl-deploy-form");
  for(const name of ["submissionSource","manualOpenRequired","opensAt","dueAt","allowLateSubmissions"])
    form.elements[name].disabled=true;
  for(const button of form.querySelectorAll("[data-deploy-range-days], #tl-deploy-custom-range"))
    button.disabled=true;
  el("tl-deploy-date-range").disabled=true;
}
async function prepareDeployment(item){
  if(pendingWrite)return;
  const turn=++deployEpoch;deployReady=false;
  // Deployment settings come first; do not force the blueprint's old
  // variant target before knowing which new course offerings are selected.
  deploying=item;deployOfferings=[];deploySelectedOfferings.clear();deploySucceededOfferings.clear();
  deployRequestKeys.clear();deployAttempted=false;deployTimesEdited=false;deployRangePending=false;
  deployVariantReview=null;deployVariantLoading=false;
  el("tl-deploy-title").textContent=item.title;
  const form=el("tl-deploy-form");form.reset();
  form.elements.submissionSource.disabled=personalized(item);
  form.elements.submissionSource.value=personalized(item)?"studio":(item.defaultSubmissionSource||"text");
  for(const name of ["manualOpenRequired","opensAt","dueAt","allowLateSubmissions"])
    form.elements[name].disabled=false;
  for(const button of form.querySelectorAll("[data-deploy-range-days], #tl-deploy-custom-range"))
    button.disabled=false;
  el("tl-deploy-date-range").disabled=false;
  el("tl-deploy-offering-search").value="";
  el("tl-deploy-feedback").textContent="";
  toggleManualOpening();
  // Practical-exam deployments default to teacher-controlled class sessions.
  form.elements.manualOpenRequired.checked=
    form.elements.submissionSource.value==="studio"&&
    /\b(?:practical\s+)?exam(?:ination)?\b/i.test(String(item.assessmentType||""));
  const now=new Date(),tomorrow=new Date(now.getTime()+24*60*60*1000);
  form.elements.opensAt.value=localDateInput(now);
  form.elements.dueAt.value=localDateInput(tomorrow);
  ensureDeploymentCalendar();
  if(deployDatePicker)deployDatePicker.clear(false);
  el("tl-deploy-dialog").showModal();
  renderDeploymentOfferings();
  try{
    const offerings=(await performScoped(schoolAcademicsApi,"planning_options",{assignmentScope:"teacher"})).offerings||[];
    if(turn!==deployEpoch||!el("tl-deploy-dialog").open||deploying?.id!==item.id)return;
    deployOfferings=offerings.filter(o=>o?.offeringId).sort((a,b)=>
      deploymentOfferingLabel(a).localeCompare(deploymentOfferingLabel(b)));
    deployReady=deployOfferings.length>0;
    renderDeploymentOfferings();
    if(!deployReady)el("tl-deploy-feedback").textContent="No active teaching assignments are available for deployment.";
  }catch(error){
    el("tl-deploy-feedback").textContent=error?.message||"Could not load assigned classes.";
    say("Could not load assigned classes.");
  }
}
el("tl-deployment-settings-cancel").addEventListener("click",()=>{
  deploymentSettingsTask=null;el("tl-deployment-settings-dialog").close();
});
el("tl-deployment-settings-form").addEventListener("submit",event=>{
  event.preventDefault();if(!deploymentSettingsTask||pendingWrite)return;
  const form=event.currentTarget;if(!form.reportValidity())return;
  const opensAt=new Date(String(form.elements.opensAt.value||"")),
    dueAt=new Date(String(form.elements.dueAt.value||""));
  if(!Number.isFinite(opensAt.getTime())||!Number.isFinite(dueAt.getTime())||dueAt<=opensAt){
    say("Choose a valid opening time and later deadline.");return;
  }
  const task=deploymentSettingsTask,details={
    taskId:task.taskId,expectedRevision:task.revision||1,
    opensAt:opensAt.toISOString(),dueAt:dueAt.toISOString(),
    allowLateSubmissions:form.elements.allowLateSubmissions.checked===true,
    manualOpenRequired:form.elements.manualOpenRequired.checked===true,
    reason:String(form.elements.reason.value||"")
  };
  void (async()=>{
    pendingWrite=true;[...form.elements].forEach(control=>control.disabled=true);
    try{
      say("Saving audited deployment settings…");
      await performScoped(scopedAssessmentApi,"update_settings",details);
      el("tl-deployment-settings-dialog").close();deploymentSettingsTask=null;
      await refreshAfterWrite(task.title+" deployment settings updated.");
    }catch(error){say(error?.message||"Deployment settings could not be saved.");}
    finally{pendingWrite=false;[...form.elements].forEach(control=>control.disabled=false);}
  })();
});
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
      await refreshAfterWrite(task.title+" is now "+result.lifecycle+".");
    }catch(error){say(error?.message||"Assessment lifecycle change could not be saved.");}
    finally{pendingWrite=false;[...form.elements].forEach(control=>control.disabled=false);}
  })();
});
el("tl-cancel-deploy").addEventListener("click",()=>{if(!pendingWrite)el("tl-deploy-dialog").close();});
el("tl-deploy-dialog").addEventListener("cancel",event=>{if(pendingWrite)event.preventDefault();});
el("tl-deploy-dialog").addEventListener("close",()=>{
  ++deployEpoch;deployReady=false;deploying=null;deployOfferings=[];
  deploySelectedOfferings.clear();deploySucceededOfferings.clear();deployRequestKeys.clear();deployAttempted=false;deployRangePending=false;
  deployVariantReview=null;deployVariantLoading=false;
});
el("tl-deploy-offering-search").addEventListener("input",renderDeploymentOfferings);
el("tl-deploy-select-visible").addEventListener("click",()=>{
  const existing=previouslyDeployedOfferingIds();
  for(const offering of matchingDeployOfferings()){
    if(existing.has(offering.offeringId)||deploySucceededOfferings.has(offering.offeringId))continue;
    if(deploySelectedOfferings.size>=MAX_BULK_DEPLOYMENTS)break;
    deploySelectedOfferings.add(offering.offeringId);
  }
  renderDeploymentOfferings();
});
el("tl-deploy-clear").addEventListener("click",()=>{
  for(const id of deploySelectedOfferings)deployRequestKeys.delete(id);
  deploySelectedOfferings.clear();renderDeploymentOfferings();
});
el("tl-deploy-custom-range").addEventListener("click",()=>{
  ensureDeploymentCalendar();
  if(deployDatePicker)deployDatePicker.open();
  else el("tl-deploy-form").elements.opensAt.focus();
});
for(const button of document.querySelectorAll("#tl-deploy-form [data-deploy-range-days]")){
  button.addEventListener("click",()=>{
    if(deployAttempted)return;
    const start=new Date();start.setHours(0,0,0,0);
    const end=new Date(start);end.setDate(start.getDate()+Number(button.dataset.deployRangeDays));
    ensureDeploymentCalendar();
    if(deployDatePicker)deployDatePicker.setDate([start,end],false);
    setDeploymentRange(start,end);
  });
}
el("tl-deploy-form").elements.submissionSource.addEventListener("change",()=>{
  if(deployAttempted)return;
  toggleManualOpening();
  const form=el("tl-deploy-form");
  if(form.elements.submissionSource.value==="studio"&&
     /\b(?:practical\s+)?exam(?:ination)?\b/i.test(String(deploying?.assessmentType||"")))
    form.elements.manualOpenRequired.checked=true;
  deployRequestKeys.clear();
});
for(const name of ["manualOpenRequired","allowLateSubmissions"]){
  el("tl-deploy-form").elements[name].addEventListener("change",()=>{
    if(!deployAttempted)deployRequestKeys.clear();
  });
}
for(const name of ["opensAt","dueAt"]){
  el("tl-deploy-form").elements[name].addEventListener("change",()=>{
    if(deployAttempted)return;
    deployTimesEdited=true;deployRangePending=false;deployRequestKeys.clear();
    renderDeploymentOfferings();
    const form=el("tl-deploy-form");
    const opens=new Date(form.elements.opensAt.value),due=new Date(form.elements.dueAt.value);
    if(deployDatePicker&&Number.isFinite(opens.getTime())&&Number.isFinite(due.getTime())&&due>=opens)
      deployDatePicker.setDate([opens,due],false);
  });
}
el("tl-deploy-form").addEventListener("submit",event=>{
  event.preventDefault();if(!deploying||pendingWrite||!deployReady)return;
  const form=event.currentTarget;
  if(!form.reportValidity())return;
  if(deployRangePending){el("tl-deploy-feedback").textContent="Choose the second calendar date before deploying.";return;}
  const ids=[...deploySelectedOfferings];
  if(!ids.length){el("tl-deploy-feedback").textContent="Select at least one assigned class.";return;}
  if(ids.length>MAX_BULK_DEPLOYMENTS){
    el("tl-deploy-feedback").textContent="Choose no more than "+MAX_BULK_DEPLOYMENTS+" classes.";return;
  }
  const opensAt=new Date(form.elements.opensAt.value),dueAt=new Date(form.elements.dueAt.value);
  if(!Number.isFinite(opensAt.getTime())||!Number.isFinite(dueAt.getTime())||dueAt<=opensAt){
    el("tl-deploy-feedback").textContent="Choose a valid opening time and a later deadline.";return;
  }
  if(personalized(deploying)&&!deployAttempted){
    const key=deploySelectionKey();
    if(!deployVariantReview||deployVariantReview.key!==key){
      void reviewDeploymentPersonalization(deploying,ids);
      return;
    }
    if(!deployVariantReview.ready){
      void loadPersonalization(deploying,ids,deployVariantReview.status);
      return;
    }
  }
  const resource=deploying,settings={
    blueprintId:resource.id,
    submissionSource:personalized(resource)?"studio":form.elements.submissionSource.value,
    opensAt:opensAt.toISOString(),dueAt:dueAt.toISOString(),
    allowLateSubmissions:form.elements.allowLateSubmissions.checked===true,
    manualOpenRequired:form.elements.manualOpenRequired.checked===true
  };
  void (async()=>{
    pendingWrite=true;deployAttempted=true;
    const controls=[...form.elements].filter(control=>!control.disabled);
    controls.forEach(control=>control.disabled=true);
    const failures=[];let completed=0;
    try{
      for(const offeringId of ids){
        if(deploySucceededOfferings.has(offeringId))continue;
        const offering=deployOfferings.find(entry=>entry.offeringId===offeringId);
        const name=offering?deploymentOfferingLabel(offering):offeringId;
        const requestKey=deployRequestKeys.get(offeringId)||crypto.randomUUID();
        deployRequestKeys.set(offeringId,requestKey);
        const status="Preparing "+(completed+failures.length+1)+" of "+ids.length+" classes: "+name+"…";
        say(status);el("tl-deploy-feedback").textContent=status;
        try{
          await performScoped(scopedAssessmentApi,"deploy",{...settings,offeringId,requestKey});
          deploySucceededOfferings.add(offeringId);
          deploySelectedOfferings.delete(offeringId);
          completed++;
        }catch(error){
          failures.push(name+": "+(error?.message||"Request failed"));
        }
      }
      if(!failures.length){
        el("tl-deploy-dialog").close();
        await refreshAfterWrite("Prepared "+completed+" independent class deployment"+(completed===1?"":"s")+
          ". Each remains private until published individually.");
      }else{
        const summary="Prepared "+completed+" of "+ids.length+" selected class"+(ids.length===1?"":"es")+
          ". "+failures.length+" could not be prepared. Retry reuses each class's request ID. "+
          failures.join(" | ");
        el("tl-deploy-feedback").textContent=summary;say(summary);
        if(completed)try{await refresh();}catch{/* successful writes are retained */}
      }
    }finally{
      pendingWrite=false;controls.forEach(control=>control.disabled=false);
      if(failures.length)freezeBulkDeploymentSettings();
      if(el("tl-deploy-dialog").open)renderDeploymentOfferings();
    }
  })();
});
form.elements.personalizationMode.addEventListener("change",togglePersonalizationFields);
form.elements.defaultSubmissionSource.addEventListener("change",toggleStudioProjectProfile);
el("tl-personalization-close").addEventListener("click",()=>{if(!pendingWrite)personalizationDialog.close();});
personalizationDialog.addEventListener("cancel",event=>{if(pendingWrite)event.preventDefault();});
personalizationDialog.addEventListener("close",()=>{
  personalizing=null;personalizationState=null;personalizingOfferings=[];
  if(el("tl-deploy-dialog").open)renderDeploymentOfferings();
});
el("tl-personalization-copy").addEventListener("click",()=>void (async()=>{
  if(!personalizing||!personalizationState||!personalizingOfferings.length)return;
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
  if(!personalizing||!personalizationState||pendingWrite||!personalizingOfferings.length)return;
  const missing=Math.max(0,Number(personalizationState.variantTarget||0)-Number(personalizationState.count||0)),
    expectedCount=Math.min(15,missing);
  if(!expectedCount){el("tl-personalization-status").textContent="The pool already meets its target.";return;}
  const item=personalizing;
  let saved=false;
  pendingWrite=true;el("tl-personalization-import").disabled=true;el("tl-personalization-close").disabled=true;
  try{
    const variants=await parseExternalPersonalizationResponse(el("tl-personalization-response").value,{
      expectedCount,hashPrompt:sha256Text,existingScenarios:personalizationState.scenarioRegistry||[]
    });
    if(personalizing!==item)throw Error("The assessment selection changed.");
    const result=await perform("personalization_import",{
      resourceId:item.id,expectedRevision:item.contentRevision,variants,
      offeringIds:personalizingOfferings
    });
    saved=true;
    personalizationState=await perform("personalization_status",{
      resourceId:item.id,offeringIds:personalizingOfferings
    });
    el("tl-personalization-response").value="";renderPersonalizationState();
    syncDeploymentPersonalizationReview();
    say("Imported "+variants.length+" private personalized variants. "+result.count+" saved for this blueprint revision.");
  }catch(error){
    if(saved){personalizationState=null;el("tl-personalization-response").value="";for(const id of ["tl-personalization-copy","tl-personalization-import","tl-personalization-activate"])el(id).disabled=true;}
    else renderPersonalizationState();
    el("tl-personalization-status").textContent=saved?"Variants saved. Close and reopen the pool to refresh its status.":"Import failed: "+(error?.message||"unknown error");
  }finally{pendingWrite=false;el("tl-personalization-close").disabled=false;}
})());
el("tl-personalization-activate").addEventListener("click",()=>void (async()=>{
  if(!personalizing||!personalizationState||pendingWrite||!personalizingOfferings.length)return;
  let saved=false;
  try{
    pendingWrite=true;el("tl-personalization-activate").disabled=true;el("tl-personalization-close").disabled=true;
    await perform("personalization_activate",{
      resourceId:personalizing.id,expectedRevision:personalizing.contentRevision,
      offeringIds:personalizingOfferings
    });
    saved=true;
    personalizationState=await perform("personalization_status",{
      resourceId:personalizing.id,offeringIds:personalizingOfferings
    });
    renderPersonalizationState();syncDeploymentPersonalizationReview();
    say("Private personalization pool activated for the selected class roster. Return to deployment settings and confirm.");
  }catch(error){
    if(saved){personalizationState=null;for(const id of ["tl-personalization-copy","tl-personalization-import","tl-personalization-activate"])el(id).disabled=true;}
    else renderPersonalizationState();
    el("tl-personalization-status").textContent=saved?"Pool activated. Close and reopen to refresh its status.":"Activation failed: "+(error?.message||"unknown error");
  }
  finally{pendingWrite=false;el("tl-personalization-close").disabled=false;}
})());
el("tl-preview-close").addEventListener("click",()=>previewDialog.close());
try{
  await picker.load();
  if(!auth.currentUser)say("Sign in before accessing teacher-owned school assessments.");
}catch(error){say(error?.message||"Cannot verify teacher access to your school.");}
