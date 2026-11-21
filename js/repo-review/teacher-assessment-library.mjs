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
    deployOfferings=[];deploymentOfferingNames.clear();deploySelectedOfferings.clear();deploySucceededOfferings.clear();deployRequestKeys.clear();
    bulkSettingsDialog?.close();bulkSettingsTasks=[];bulkSettingsSucceeded.clear();
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

let bulkSettingsTasks=[],bulkSettingsSucceeded=new Set(),bulkSettingsDialog=null;
function bulkSettingsModal(){
  if(bulkSettingsDialog)return bulkSettingsDialog;
  const host=el("schoolAssessmentStudioHost");
  const dialog=document.createElement("dialog");dialog.id="tl-bulk-settings-dialog";dialog.className="tl-dialog";
  dialog.setAttribute("aria-labelledby","tl-bulk-settings-heading");
  dialog.innerHTML=`
    <form id="tl-bulk-settings-form" class="tl-dialog-inner">
      <header class="bg-slate-800 px-5 py-5 text-white">
        <p class="text-[10px] font-extrabold uppercase tracking-widest text-cyan-300">Assessment group</p>
        <h2 id="tl-bulk-settings-heading" class="mt-1 text-xl font-extrabold">Bulk deployment settings</h2>
        <p id="tl-bulk-settings-subtitle" class="mt-1 text-sm text-slate-300"></p>
      </header>
      <div class="tl-dialog-body">
        <section class="tl-section">
          <h3 class="font-extrabold">1. Choose affected classes</h3>
          <p class="tl-muted mt-1">Each class retains its own assessment, evidence, grades, and revision. Uncheck classes you do not want to change.</p>
          <div id="tl-bulk-settings-classes" class="mt-3 grid gap-2"></div>
        </section>
        <section class="tl-section">
          <h3 class="font-extrabold">2. Select the settings to change</h3>
          <p class="tl-muted mt-1">Unchecked settings retain their existing value for each class.</p>
          <label class="tl-bulk-setting-field"><input type="checkbox" name="changeDates">
            <span class="font-bold">Opening and deadline</span></label>
          <div id="tl-bulk-dates" class="grid sm:grid-cols-2 gap-3 mt-2" hidden>
            <label class="text-sm font-bold">Opens at<input name="opensAt" class="tl-input" type="datetime-local"></label>
            <label class="text-sm font-bold">Deadline<input name="dueAt" class="tl-input" type="datetime-local"></label>
          </div>
          <label class="tl-bulk-setting-field"><input type="checkbox" name="changeLate">
            <span class="font-bold">Late submissions</span></label>
          <label id="tl-bulk-late" class="tl-bulk-setting-value" hidden><input type="checkbox" name="allowLateSubmissions"> Allow late submissions</label>
          <label class="tl-bulk-setting-field"><input type="checkbox" name="changeManual">
            <span class="font-bold">Teacher-controlled Studio sessions</span></label>
          <label id="tl-bulk-manual" class="tl-bulk-setting-value" hidden><input type="checkbox" name="manualOpenRequired"> Require teacher to open/close exam sessions</label>
          <p id="tl-bulk-manual-hint" class="tl-muted mt-2"></p>
          <label class="block text-sm font-bold mt-3">Reason for change
            <textarea name="reason" rows="3" class="tl-input" minlength="12" maxlength="1000" required placeholder="Explain why these class deployments are being updated."></textarea>
          </label>
        </section>
        <section class="tl-section">
          <h3 class="font-extrabold">3. Review changes before applying</h3>
          <div id="tl-bulk-settings-preview" class="mt-2 text-sm text-slate-700" aria-live="polite"></div>
          <p id="tl-bulk-settings-result" class="mt-3 text-sm text-slate-700" role="status" aria-live="polite"></p>
        </section>
      </div>
      <footer class="tl-dialog-footer">
        <button type="button" id="tl-bulk-settings-cancel" class="tl-action alt">Close</button>
        <button type="submit" id="tl-bulk-settings-save" class="tl-action">Apply to selected classes</button>
      </footer>
    </form>
  `;
  host.append(dialog);
  const form=dialog.querySelector("form");
  const update=()=>{
    const selected=bulkSettingsTasks.filter(task=>
      form.querySelector('input[data-task-id="'+CSS.escape(task.taskId)+'"]')?.checked&&!bulkSettingsSucceeded.has(task.taskId));
    const dates=form.elements.changeDates.checked;
    const late=form.elements.changeLate.checked;
    const manual=form.elements.changeManual.checked;
    el("tl-bulk-dates").hidden=!dates;
    el("tl-bulk-late").hidden=!late;
    el("tl-bulk-manual").hidden=!manual;
    const manualAllowed=selected.length>0&&selected.every(task=>task.submissionSource==="studio");
    form.elements.changeManual.disabled=!manualAllowed;
    if(!manualAllowed){form.elements.changeManual.checked=false;el("tl-bulk-manual").hidden=true;}
    el("tl-bulk-manual-hint").textContent=manualAllowed?
      "Only the teacher-control requirement changes; this does not open or close active sessions.":
      "Teacher control can be changed only when all selected classes use Adminerva Studio.";
    const preview=el("tl-bulk-settings-preview");preview.replaceChildren();
    const heading=document.createElement("p");heading.className="font-bold mb-2";
    heading.textContent=selected.length+" class"+(selected.length===1?"":"es")+" selected.";
    preview.append(heading);
    const actualChanges=dates||late||(manual&&manualAllowed);
    for(const task of selected){
      const line=document.createElement("p");line.className="tl-bulk-preview-line";
      const changes=[];
      if(dates)changes.push("Schedule: "+(task.opensAt?new Date(task.opensAt).toLocaleString():"not set")+
        " → "+(form.elements.opensAt.value||"choose opening")+", "+
        (task.dueAt?new Date(task.dueAt).toLocaleString():"not set")+" → "+(form.elements.dueAt.value||"choose deadline"));
      if(late)changes.push("Late: "+(task.allowLateSubmissions?"allowed":"not allowed")+
        " → "+(form.elements.allowLateSubmissions.checked?"allowed":"not allowed"));
      if(manual&&manualAllowed)changes.push("Teacher control: "+(task.manualOpenRequired?"on":"off")+
        " → "+(form.elements.manualOpenRequired.checked?"on":"off"));
      line.textContent=deploymentClassLabel(task)+" — "+(changes.join("; ")||"No changes selected");
      preview.append(line);
    }
    form.elements.opensAt.required=dates;
    form.elements.dueAt.required=dates;
    const button=el("tl-bulk-settings-save");
    button.disabled=pendingWrite||!selected.length||!actualChanges;
    button.textContent="Apply to "+selected.length+" class"+(selected.length===1?"":"es");
  };
  form.addEventListener("change",update);
  form.addEventListener("input",update);
  dialog.querySelector("#tl-bulk-settings-cancel").addEventListener("click",()=>{if(!pendingWrite)dialog.close();});
  dialog.addEventListener("cancel",event=>{if(pendingWrite)event.preventDefault();});
  form.addEventListener("submit",event=>{
    event.preventDefault();
    if(pendingWrite||!form.reportValidity())return;
    const selected=bulkSettingsTasks.filter(task=>
      form.querySelector('input[data-task-id="'+CSS.escape(task.taskId)+'"]')?.checked&&!bulkSettingsSucceeded.has(task.taskId));
    if(!selected.length)return;
    const dates=form.elements.changeDates.checked,late=form.elements.changeLate.checked,manual=form.elements.changeManual.checked;
    if(!dates&&!late&&!manual)return;
    const opensAt=dates?new Date(form.elements.opensAt.value):null;
    const dueAt=dates?new Date(form.elements.dueAt.value):null;
    if(dates&&(!Number.isFinite(opensAt.getTime())||!Number.isFinite(dueAt.getTime())||dueAt<=opensAt)){
      el("tl-bulk-settings-result").textContent="Choose a valid opening time and later deadline.";return;
    }
    const reason=String(form.elements.reason.value||"").trim();
    if(reason.length<12){el("tl-bulk-settings-result").textContent="Provide at least 12 characters explaining the change.";return;}
    if(!confirm("Apply these audited settings to "+selected.length+" independent class deployments? Each class is updated separately."))return;
    void (async()=>{
      pendingWrite=true;const button=el("tl-bulk-settings-save");
      const result=el("tl-bulk-settings-result");const failures=[];let completed=0;
      for(const input of form.querySelectorAll("input,textarea,button"))input.disabled=true;
      try{
        for(const task of selected){
          result.textContent="Updating "+(completed+failures.length+1)+" of "+selected.length+": "+deploymentClassLabel(task)+"…";
          const details={
            taskId:task.taskId,expectedRevision:task.revision||1,
            opensAt:dates?opensAt.toISOString():new Date(task.opensAt).toISOString(),
            dueAt:dates?dueAt.toISOString():new Date(task.dueAt).toISOString(),
            allowLateSubmissions:late?form.elements.allowLateSubmissions.checked:task.allowLateSubmissions===true,
            manualOpenRequired:manual?form.elements.manualOpenRequired.checked:task.manualOpenRequired===true,
            reason
          };
          try{
            await performScoped(scopedAssessmentApi,"update_settings",details);
            bulkSettingsSucceeded.add(task.taskId);completed++;
          }catch(error){failures.push(deploymentClassLabel(task)+": "+(error?.message||"Could not save"));}
        }
        result.textContent="Updated "+completed+" of "+selected.length+" classes."+
          (failures.length?" Failed: "+failures.join(" | ")+". Unchanged classes can be retried.":" All selected settings saved.");
        // Refresh source revisions before permitting a retry; never send stale revision IDs.
        try{
          const refreshed=await performScoped(scopedAssessmentApi,"list_teacher");
          deployments=refreshed.assessments||[];
          const byId=new Map(deployments.map(task=>[task.taskId,task]));
          bulkSettingsTasks=bulkSettingsTasks.map(task=>byId.get(task.taskId)||task);
          render();
        }catch(error){
          result.textContent+=" Refresh Deployed Tasks before retrying; current class revisions could not be verified.";
          button.disabled=true;
          return;
        }
        if(!failures.length){dialog.close();say("Bulk deployment settings updated for "+completed+" classes.");}
      }finally{
        pendingWrite=false;
        for(const input of form.querySelectorAll("input,textarea,button"))input.disabled=false;
        update();
      }
    })();
  });
  bulkSettingsDialog=dialog;
  return dialog;
}
function openBulkDeploymentSettings(tasks){
  if(pendingWrite||!tasks.length)return;
  bulkSettingsTasks=tasks.filter(task=>["active","closed"].includes(task.lifecycle||"active"));
  bulkSettingsSucceeded.clear();
  const dialog=bulkSettingsModal(),form=dialog.querySelector("form");
  form.reset();
  el("tl-bulk-settings-subtitle").textContent=tasks[0].title+" · "+bulkSettingsTasks.length+" eligible classes";
  const classes=el("tl-bulk-settings-classes");classes.replaceChildren();
  for(const task of bulkSettingsTasks){
    const label=document.createElement("label");label.className="tl-bulk-class-select";
    const input=document.createElement("input");input.type="checkbox";input.checked=true;
    input.dataset.taskId=task.taskId;
    const desc=document.createElement("span");desc.textContent=deploymentClassLabel(task)+
      " · "+(task.published?"Published":"Private")+" · Revision "+(task.revision||1);
    label.append(input,desc);classes.append(label);
  }
  el("tl-bulk-settings-result").textContent="";
  form.elements.changeManual.disabled=false;
  const first=bulkSettingsTasks[0];
  if(first){
    if(first.opensAt)form.elements.opensAt.value=localDateInput(new Date(first.opensAt));
    if(first.dueAt)form.elements.dueAt.value=localDateInput(new Date(first.dueAt));
    form.elements.allowLateSubmissions.checked=first.allowLateSubmissions===true;
    form.elements.manualOpenRequired.checked=first.manualOpenRequired===true;
  }
  dialog.showModal();
  form.dispatchEvent(new Event("change"));
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

let deploymentOfferingNames=new Map();
function deploymentClassLabel(task){
  const saved=[task.subjectName,task.sectionName].filter(Boolean).join(" · ");
  const known=deploymentOfferingNames.get(task.offeringId);
  return saved||known||("Class offering · "+String(task.offeringId||task.taskId||"unknown"));
}
function deployedActionLink(label,href,primary=false){
  const link=document.createElement("a");
  link.className="tl-action"+(primary?"":" alt");link.href=href;link.textContent=label;
  return link;
}
function deploymentClassRow(task){
  const lifecycle=task.lifecycle||"active";
  const row=document.createElement("article");row.className="tl-deploy-class";
  const main=document.createElement("div");main.className="tl-deploy-class-main";
  const info=document.createElement("div");info.className="tl-deploy-class-info";
  const name=document.createElement("h4");name.className="font-extrabold text-slate-900";
  name.textContent=deploymentClassLabel(task);
  const meta=document.createElement("p");meta.className="tl-muted";
  const manualState=task.manualAccessState==="open"?"Exam open":
    ["closing","closed","held"].includes(task.manualAccessState)?"Exam closed":"Awaiting teacher";
  const due=task.dueAt?new Date(task.dueAt):null;
  const dueLabel=due&&Number.isFinite(due.getTime())?due.toLocaleString():"Not scheduled";
  meta.textContent=(task.published?"Published":"Private")+" · "+
    (lifecycle==="active"?"Active":lifecycle)+" · Due "+dueLabel+
    (task.manualOpenRequired?" · "+manualState:"")+
    (task.allowLateSubmissions?" · Late allowed":"");
  info.append(name,meta);
  const quick=document.createElement("div");quick.className="tl-deploy-quick";
  if(lifecycle!=="cancelled"){
    quick.append(deployedActionLink("Review & Grade",
      "school-gradebook.html?view=review&task="+encodeURIComponent(task.taskId),true));
  }
  if(["active","closed"].includes(lifecycle)){
    quick.append(actionButton(task.published?"Unpublish":"Publish",
      ()=>void setPublication(task,!task.published),!task.published));
  }
  if(lifecycle==="active"&&task.published&&task.manualOpenRequired&&task.submissionSource==="studio"){
    const isOpen=task.manualAccessState==="open";
    const finalSaving=["closed","closing"].includes(task.manualAccessState)&&
      Number(task.manualCloseGraceUntil||0)>Date.now();
    const control=actionButton(isOpen?"Close exam":finalSaving?"Finalizing saves…":"Open exam",
      ()=>void setExamOpening(task,!isOpen),isOpen);
    control.disabled=finalSaving;
    if(finalSaving)control.title="Previous session's final cloud checkpoints are still being accepted.";
    quick.append(control);
  }
  main.append(info,quick);
  const more=document.createElement("details");more.className="tl-deploy-class-more";
  const summary=document.createElement("summary");
  summary.textContent="More actions";
  more.append(summary);
  const extra=document.createElement("div");extra.className="tl-deploy-more-actions";
  if(lifecycle!=="cancelled"){
    if(task.offeringId&&task.taskId)
      extra.append(deployedActionLink("Add to Class Record",
        "class-record.html?"+new URLSearchParams({
          offering:task.offeringId,assessment:task.taskId,source:"school"
        }).toString()));
    extra.append(actionButton("Deployment settings",()=>openDeploymentSettings(task),true));
  }
  if(task.submissionSource==="studio"&&Number(task.manualSessionEpoch||0)>0)
    extra.append(actionButton("Class save history",()=>void showExamCloseReport(task),true));
  if(lifecycle==="active"){
    extra.append(actionButton("Close assessment",()=>openLifecycle(task,"close"),true));
    extra.append(actionButton("Archive",()=>openLifecycle(task,"archive"),true));
    extra.append(actionButton("Cancel assessment",()=>openLifecycle(task,"cancel"),true));
  }else if(lifecycle==="closed"){
    extra.append(actionButton("Reopen assessment",()=>openLifecycle(task,"reopen"),true));
    extra.append(actionButton("Archive",()=>openLifecycle(task,"archive"),true));
    extra.append(actionButton("Cancel assessment",()=>openLifecycle(task,"cancel"),true));
  }else if(lifecycle==="archived"){
    extra.append(actionButton("Restore",()=>openLifecycle(task,"restore_archive"),true));
  }
  const context=document.createElement("p");context.className="tl-muted";
  const handedOver=task.ownerUid&&task.reviewerUid&&task.ownerUid!==task.reviewerUid;
  context.textContent="Response: "+sourceLabel(task.submissionSource)+
    (task.submissionSource==="studio"?" · "+studioProfileLabel(task.studioProjectProfile):"")+
    " · Revision "+(task.revision||1)+
    (handedOver?" · Review responsibility transferred; blueprint ownership retained.":"");
  more.append(extra,context);
  row.append(main,more);return row;
}
function renderDeployedTasks(){
  const current=deployments.filter(task=>task.lifecycle!=="archived"&&task.lifecycle!=="cancelled");
  const historic=deployments.filter(task=>task.lifecycle==="archived"||task.lifecycle==="cancelled");
  const summary=document.createElement("div");summary.className="tl-deploy-overview";
  const title=document.createElement("h3");title.textContent="Class deployments";
  const count=document.createElement("p");count.className="tl-muted";
  count.textContent=current.length+" current class deployment"+(current.length===1?"":"s")+
    " · "+current.filter(task=>task.published).length+" published · "+
    current.filter(task=>!task.published).length+" private";
  summary.append(title,count);list.append(summary);
  if(legacyDeploymentWarning){
    const warning=document.createElement("p");warning.className="tl-deploy-notice";
    warning.textContent="Historical deployments could not be loaded: "+legacyDeploymentWarning+
      ". No original records were changed.";
    list.append(warning);
  }
  const groups=new Map();
  for(const task of current){
    const key=task.blueprintId||("unlinked:"+String(task.taskId||"unknown"));
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(task);
  }
  if(!current.length){
    const empty=document.createElement("p");empty.className="tl-deploy-notice";
    empty.textContent="No current class deployments. Open My Assessments to deploy a blueprint.";
    list.append(empty);
  }
  for(const tasks of [...groups.values()].sort((a,b)=>
    String(a[0]?.title||"").localeCompare(String(b[0]?.title||"")))){
    const group=document.createElement("section");group.className="tl-deploy-group";
    const header=document.createElement("div");header.className="tl-deploy-group-header";
    const label=document.createElement("div");
    const h=document.createElement("h3");h.textContent=tasks[0].title||"Assessment";
    const meta=document.createElement("p");meta.className="tl-muted";
    meta.textContent=tasks.length+" class"+(tasks.length===1?"":"es")+" · "+
      sourceLabel(tasks[0].submissionSource)+" · "+
      tasks.filter(task=>task.published).length+" published";
    label.append(h,meta);header.append(label);
    if(tasks.length>1){
      const bulk=actionButton("Bulk settings",()=>openBulkDeploymentSettings(tasks),true);
      bulk.classList.add("tl-deploy-bulk-button");
      header.append(bulk);
    }
    group.append(header);
    for(const task of tasks.sort((a,b)=>deploymentClassLabel(a).localeCompare(deploymentClassLabel(b))))
      group.append(deploymentClassRow(task));
    list.append(group);
  }
  if(historic.length){
    const past=document.createElement("details");past.className="tl-deploy-history";
    const toggle=document.createElement("summary");
    toggle.textContent="Archived / cancelled deployments ("+historic.length+")";
    past.append(toggle);
    for(const task of historic)past.append(deploymentClassRow(task));
    list.append(past);
  }
  if(legacyDeploymentHistory.length){
    const legacy=document.createElement("details");legacy.className="tl-deploy-history";
    const toggle=document.createElement("summary");
    toggle.textContent="Historical Repository Management assessments ("+legacyDeploymentHistory.length+")";
    legacy.append(toggle);
    const explanation=document.createElement("p");explanation.className="tl-muted tl-deploy-history-help";
    explanation.textContent="Original class deployments and evidence are preserved. Their schedules use the historical editor; new deployments create separate school assessments.";
    legacy.append(explanation);
    for(const historical of legacyDeploymentHistory){
      const assessment=document.createElement("details");assessment.className="tl-deploy-legacy-item";
      const header=document.createElement("summary");
      header.textContent=(historical.title||"Historical assessment")+" · "+
        (historical.deploymentCount||historical.deployments?.length||0)+" classes";
      assessment.append(header);
      const entries=Array.isArray(historical.deployments)?historical.deployments:[];
      for(const assigned of entries){
        const entry=document.createElement("div");entry.className="tl-deploy-legacy-class";
        const line=document.createElement("p");line.className="tl-muted";
        const rawDue=assigned.deadline?new Date(assigned.deadline):null;
        const validDue=rawDue&&Number.isFinite(rawDue.getTime());
        line.textContent=(assigned.section||"Unassigned section")+" · "+
          (assigned.deadlineEnabled===false?"No enforced deadline":
            validDue?"Due "+rawDue.toLocaleString():"Deadline not set")+
          (assigned.allowLateSubmissions?" · Late allowed":"");
        entry.append(line,deployedActionLink("Edit schedule",
          "repository-assessment-studio.html?"+new URLSearchParams({
            legacyAssessment:historical.legacyAssessmentId,legacyDeployment:assigned.id
          }).toString()));
        assessment.append(entry);
      }
      const footer=document.createElement("div");footer.className="tl-deploy-more-actions";
      if(historical.submissionSource==="studio")
        footer.append(deployedActionLink("Review in V4",
          "school-gradebook.html?"+new URLSearchParams({
            view:"review",task:"legacy:"+historical.legacyAssessmentId
          }).toString(),true));
      footer.append(deployedActionLink("Open original deployment",
        "repository-assessment-studio.html?"+new URLSearchParams({
          legacyAssessment:historical.legacyAssessmentId,legacyView:"deployments"
        }).toString()));
      assessment.append(footer);legacy.append(assessment);
    }
    list.append(legacy);
  }
}
function render(){
  document.querySelectorAll("[data-filter]").forEach(button=>
    button.setAttribute("aria-pressed",String(button.dataset.filter===filter)));
  list.replaceChildren();
  const uid=picker.scope.current?.uid;
  if(filter==="deployed"){
    renderDeployedTasks();
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
      legacy.href="repository-assessment-studio.html?"+new URLSearchParams({
        legacyAssessment:item.legacyImport.assessmentId,legacyView:"deployments"
      }).toString();
      legacy.textContent="View original deployments";controls.append(legacy);
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
      // Older deployed school callables may not yet have the dedicated list.
      // The existing owner-scoped legacy listing carries the same deployment
      // summaries and is already used by the assessment migration.
      try{
        const fallback=await performScoped(migrationApi,"list_legacy");
        return {items:(fallback.items||[]).filter(row=>row.deploymentCount>0)};
      }catch(fallbackError){
        console.warn("Legacy deployment listing unavailable:",error,fallbackError);
        return {items:[],error:String(fallbackError?.message||"Service unavailable")};
      }
    }
  })();
  const [result,deployed,historical]=await Promise.all([
    perform("list"),performScoped(scopedAssessmentApi,"list_teacher"),legacyRead
  ]);
  items=result.items||[];
  deployments=deployed.assessments||[];
  legacyDeploymentHistory=historical.items||[];
  legacyDeploymentWarning=historical.error||"";
  deploymentOfferingNames=new Map();
  if(filter==="deployed"){
    try{
      const options=await performScoped(schoolAcademicsApi,"planning_options",{assignmentScope:"teacher"});
      for(const offering of options.offerings||[])
        if(offering.offeringId)deploymentOfferingNames.set(offering.offeringId,deploymentOfferingLabel(offering));
    }catch(error){
      console.warn("Class labels unavailable; showing stable offering identifiers.",error);
    }
  }
  render();
  if(result.truncated)say("Only the first assessment records are shown. Pagination is required for more.");
  if(filter==="deployed"&&legacyDeploymentWarning)
    say("School deployments loaded, but historical deployments could not be checked. The original records are unchanged.");
}
document.querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",()=>{
  filter=button.dataset.filter;
  const url=new URL(location.href);url.searchParams.set("view",filter);history.replaceState(null,"",url);
  if(filter==="deployed"&&!deploymentOfferingNames.size)
    void refresh().catch(error=>say(error.message));
  else render();
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
    // Keep the calendar in the input's local coordinate system. Appending an
    // absolutely positioned calendar to the scrollable <dialog> mixes
    // viewport and dialog scroll offsets and can place it far above the field.
    static:true,
    onOpen(_selectedDates,_dateString,instance){
      requestAnimationFrame(()=>{
        const dialog=el("tl-deploy-dialog"),calendar=instance.calendarContainer;
        if(!dialog?.open||!calendar)return;
        const dialogRect=dialog.getBoundingClientRect(),calendarRect=calendar.getBoundingClientRect();
        if(calendarRect.bottom>dialogRect.bottom-12)
          dialog.scrollBy({top:calendarRect.bottom-dialogRect.bottom+20,behavior:"auto"});
      });
    },
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
