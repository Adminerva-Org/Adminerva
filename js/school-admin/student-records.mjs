import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs";

const get=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolStudentRecords");
const status=get("sr-status"),workspace=get("sr-workspace"),fileHost=get("sr-file");
const requestedPersonId=(()=>{try{
  const value=new URL(location.href).searchParams.get("personId")||"";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)?value:"";
}catch{return "";}})();
let picker=null,students=[],current=null,saving=false,searchRun=0,fileRun=0,
  guardianChange=null,guardianLifecycle=null,requestLifecycle=null;

function assistMode(){
  try{return sessionStorage.getItem("Adminerva_platform_school_mode")==="assist"?"assist":"";}catch{return "";}
}
function perform(action,details={}){
  const lease=picker.scope.lease();
  return api({schoolId:lease.schoolId,action,...details,...(assistMode()?{platformMode:"assist"}:{})})
    .then(response=>{picker.scope.assertLease(lease);return response.data;});
}
function setSaving(value,message=""){
  saving=value;
  for(const control of document.querySelectorAll("button,input,select,textarea"))control.disabled=value;
  if(!value){
    get("sr-search").disabled=false;get("sr-search-button").disabled=false;
    get("sr-guardian-close").disabled=false;get("sr-guardian-lifecycle-close").disabled=false;
    get("sr-request-close").disabled=false;get("sr-request-lifecycle-close").disabled=false;
  }
  if(message)status.textContent=message;
}
function fmt(value){
  if(!Number.isFinite(Number(value))||Number(value)<=0)return "";
  try{return new Date(Number(value)).toLocaleString(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}
  catch{return "";}
}
function textNode(tag,text,className=""){
  const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;
}
function badge(label,state){
  const node=textNode("span",label,"sr-badge");node.dataset.state=state||"";return node;
}
function actions(){
  const node=document.createElement("div");node.style.cssText="display:flex;gap:.45rem;flex-wrap:wrap;align-items:center";return node;
}
function button(label,{tone="",onClick}={}){
  const node=document.createElement("button");node.type="button";node.className="sr-btn "+tone;node.textContent=label;
  if(onClick)node.addEventListener("click",onClick);return node;
}
function setUrlPerson(personId){
  try{
    const url=new URL(location.href);
    if(personId)url.searchParams.set("personId",personId);else url.searchParams.delete("personId");
    history.replaceState({},"",url);
  }catch{}
}
function recordLabel(row){
  return [row.yearName,row.programName,row.termName,row.sectionName].filter(Boolean).join(" · ");
}
function guardianState(row){
  return row.status==="active"?(row.isPrimary?"Primary · active":"Active"):"Ended";
}
function requestStateLabel(value){
  return ({requested:"Requested",in_review:"In review",ready:"Ready",released:"Released",cancelled:"Cancelled"})[value]||value;
}
function empty(host,message){
  host.replaceChildren(textNode("p",message,"sr-muted"));
}

function renderStudents(){
  const host=get("sr-student-list");host.replaceChildren();
  if(!students.length){empty(host,"No student records match this search.");return;}
  for(const item of students){
    const row=document.createElement("article");row.className="sr-row";row.setAttribute("role","listitem");
    const info=document.createElement("div");info.append(textNode("strong",item.displayName),
      textNode("p",[item.studentNumber||"No student number",item.status||"active"].join(" · "),"sr-muted"));
    const open=button(current?.person?.personId===item.personId?"Open":"View file",{
      tone:"secondary",onClick:()=>void openStudent(item.personId)
    });
    row.append(info,open);host.append(row);
  }
}
async function searchStudents(){
  if(saving)return;
  const run=++searchRun,query=String(get("sr-search").value||"").trim();
  get("sr-search-button").disabled=true;status.textContent="Searching canonical student directory…";
  try{
    const result=await perform("search_students",{query});
    if(run!==searchRun)return;
    students=result.items||[];renderStudents();
    status.textContent=(result.truncated?"Showing the first matching records. ":"")+
      students.length+" student"+(students.length===1?"":"s")+" loaded.";
  }catch(error){
    if(run===searchRun)status.textContent=error?.message||"Student directory search failed.";
  }finally{if(run===searchRun)get("sr-search-button").disabled=false;}
}

function renderGuardians(data){
  const host=get("sr-guardian-list");host.replaceChildren();
  get("sr-adopt-guardian").hidden=!data.legacyGuardianAvailable;
  if(!data.guardians?.length){empty(host,"No canonical guardian relationships yet.");return;}
  for(const guardian of data.guardians){
    const row=document.createElement("article");row.className="sr-row";
    const info=document.createElement("div"),title=document.createElement("div");
    title.style.cssText="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap";
    title.append(textNode("strong",guardian.displayName),badge(guardianState(guardian),guardian.status));
    const meta=textNode("p",
      [guardian.relationship,guardian.email,guardian.mobile,guardian.linkedUid?"Parent account linked":""].filter(Boolean).join(" · "),
      "sr-muted");
    info.append(title,meta);row.append(info);
    const controls=actions();
    if(guardian.status==="active"){
      controls.append(button("Edit",{tone:"secondary",onClick:()=>openGuardian(guardian)}));
      controls.append(button("End",{tone:"danger",onClick:()=>openGuardianLifecycle(guardian,false)}));
    }else if(guardian.status==="ended"){
      controls.append(button("Restore",{tone:"success",onClick:()=>openGuardianLifecycle(guardian,true)}));
    }
    row.append(controls);host.append(row);
  }
}
function renderRegistrations(data){
  const host=get("sr-registration-list");host.replaceChildren();
  if(!data.registrations?.length){empty(host,"No official registration records.");return;}
  for(const record of data.registrations){
    const row=document.createElement("article");row.className="sr-row";
    const info=document.createElement("div"),title=document.createElement("div");
    title.style.cssText="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap";
    const state=record.progressionType?record.progressionType:record.status;
    title.append(textNode("strong",recordLabel(record)),badge(state,record.status));
    const meta=[record.gradeLevel?(/^\d+$/.test(String(record.gradeLevel))?"Grade "+record.gradeLevel:record.gradeLevel):"",
      record.createdAt?"created "+fmt(record.createdAt):"",record.endedAt?"ended "+fmt(record.endedAt):""].filter(Boolean).join(" · ");
    info.append(title,textNode("p",meta,"sr-muted"));row.append(info);host.append(row);
  }
}
function renderGrades(data){
  const body=get("sr-grade-list");body.replaceChildren();
  if(!data.releasedGrades?.length){
    const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=5;cell.className="sr-muted";cell.textContent="No released Class Record Final Grades yet.";row.append(cell);body.append(row);return;
  }
  for(const grade of data.releasedGrades){
    const row=document.createElement("tr");
    for(const value of [
      [grade.yearName,grade.termName].filter(Boolean).join(" · "),
      grade.subjectName,grade.sectionName,
      Number.isFinite(Number(grade.finalGrade))?String(grade.finalGrade):"—",
      "r"+grade.releasedRevision
    ])row.append(textNode("td",value||"—"));
    body.append(row);
  }
}
function requestTransitions(row){
  if(row.status==="requested")return [["Start review","in_review",""],["Cancel","cancelled","danger"]];
  if(row.status==="in_review")return [["Mark ready","ready","success"],["Cancel","cancelled","danger"]];
  if(row.status==="ready")return [["Release","released","success"],["Return to review","in_review",""],["Cancel","cancelled","danger"]];
  if(row.status==="cancelled")return [["Reopen review","in_review",""]];
  return [];
}
function renderRequests(data){
  const host=get("sr-request-list");host.replaceChildren();
  if(!data.documentRequests?.length){empty(host,"No registrar document requests for this student.");return;}
  for(const request of data.documentRequests){
    const row=document.createElement("article");row.className="sr-row";
    const info=document.createElement("div"),title=document.createElement("div");
    title.style.cssText="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap";
    title.append(textNode("strong",request.label),badge(requestStateLabel(request.status),request.status));
    const meta=[request.purpose,request.releaseReference?"reference "+request.releaseReference:"",
      request.releasedAt?"released "+fmt(request.releasedAt):request.updatedAt?fmt(request.updatedAt):fmt(request.requestedAt)]
      .filter(Boolean).join(" · ");
    info.append(title,textNode("p",meta,"sr-muted"));row.append(info);
    const controls=actions();
    for(const [label,next,tone] of requestTransitions(request))
      controls.append(button(label,{tone,onClick:()=>openRequestLifecycle(request,next)}));
    if(controls.children.length)row.append(controls);
    host.append(row);
  }
}
function renderAudit(data){
  const host=get("sr-audit-list");host.replaceChildren();
  if(!data.audit?.length){empty(host,"No Student Records lifecycle audit entries yet.");return;}
  for(const event of data.audit){
    const row=document.createElement("article");row.className="sr-row";
    const info=document.createElement("div");
    info.append(textNode("strong",String(event.action||"record_change").replaceAll("_"," ")),
      textNode("p",[event.reason,fmt(event.createdAt)].filter(Boolean).join(" · "),"sr-muted"));
    row.append(info);host.append(row);
  }
}
function renderFile(data){
  current=data;const p=data.person;
  fileHost.hidden=false;get("sr-student-name").textContent=p.displayName;
  get("sr-student-meta").textContent=p.status+" · directory revision "+p.revision;
  get("sr-student-number").textContent=p.studentNumber||"—";get("sr-birth-date").textContent=p.birthDate||"—";
  get("sr-account-state").textContent=p.accountLinked?"Verified student account linked":
    p.accountResponsibility==="guardian"?"Guardian-managed learner":"Student activation pending";
  get("sr-open-people").href="people-access.html?personId="+encodeURIComponent(p.personId)+"#people";
  get("sr-open-enrollment").href="school-enrollment.html?personId="+encodeURIComponent(p.personId);
  renderGuardians(data);renderRegistrations(data);renderGrades(data);renderRequests(data);renderAudit(data);
  renderStudents();
}
async function openStudent(personId,{force=false}={}){
  if(saving&&!force)return;
  const run=++fileRun;status.textContent="Loading canonical Student Records file…";
  try{
    const data=await perform("student_file",{personId});
    if(run!==fileRun)return;
    renderFile(data);setUrlPerson(personId);
    status.textContent=data.person.displayName+" · 201-file aggregation loaded from canonical school records.";
  }catch(error){
    if(run===fileRun){fileHost.hidden=true;current=null;status.textContent=error?.message||"Student record could not be loaded.";}
  }
}

function openGuardian(guardian=null){
  if(!current||saving)return;
  guardianChange=guardian;
  const dialog=get("sr-guardian-dialog"),form=get("sr-guardian-form");form.reset();
  form.elements.relationshipId.value=guardian?.relationshipId||"";
  form.elements.expectedRelationshipRevision.value=guardian?.revision||"";
  form.elements.expectedContactRevision.value=guardian?.contactRevision||"";
  form.elements.displayName.value=guardian?.displayName||"";
  form.elements.email.value=guardian?.email||"";
  form.elements.email.readOnly=Boolean(guardian);
  form.elements.mobile.value=guardian?.mobile||"";
  form.elements.relationship.value=guardian?.relationship||"";
  form.elements.isPrimary.checked=guardian?.isPrimary===true;
  get("sr-guardian-title").textContent=guardian?"Edit guardian":"Add guardian";
  get("sr-guardian-target").textContent=current.person.displayName;
  get("sr-guardian-help").textContent=guardian
    ?"Guardian email is the canonical contact identity and cannot be changed in-place. Add a separate guardian relationship for a new email."
    :"If this email already belongs to a guardian contact in the school, Adminerva reuses that canonical contact instead of overwriting it.";
  dialog.showModal();
}
function closeGuardian(){
  if(saving)return;guardianChange=null;get("sr-guardian-dialog").close();
}
get("sr-guardian-close").addEventListener("click",closeGuardian);
get("sr-add-guardian").addEventListener("click",()=>openGuardian());
get("sr-guardian-dialog").addEventListener("cancel",event=>{if(saving)event.preventDefault();else guardianChange=null;});
get("sr-guardian-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!current||!event.currentTarget.reportValidity())return;
  const form=event.currentTarget,data=new FormData(form);
  void (async()=>{
    setSaving(true,"Saving guardian relationship…");
    try{
      const result=await perform("save_guardian",{
        personId:current.person.personId,
        relationshipId:String(data.get("relationshipId")||""),
        expectedRelationshipRevision:Number(data.get("expectedRelationshipRevision")||0),
        expectedContactRevision:Number(data.get("expectedContactRevision")||0),
        displayName:String(data.get("displayName")||"").trim(),
        email:String(data.get("email")||"").trim(),
        mobile:String(data.get("mobile")||"").trim(),
        relationship:String(data.get("relationship")||"").trim(),
        isPrimary:data.get("isPrimary")==="on"
      });
      guardianChange=null;get("sr-guardian-dialog").close();
      await openStudent(current.person.personId,{force:true});
      status.textContent=result.contactReused
        ?"Guardian relationship saved. An existing canonical guardian contact was reused."
        :"Guardian relationship saved.";
    }catch(error){status.textContent=error?.message||"Guardian relationship was not saved.";}
    finally{setSaving(false);}
  })();
});
get("sr-adopt-guardian").addEventListener("click",()=>{
  if(saving||!current)return;
  if(!confirm("Adopt the student's existing primary-guardian snapshot into the canonical guardian relationship model? The compatibility snapshot will remain unchanged."))return;
  const personId=current.person.personId,revision=current.person.revision;
  void (async()=>{
    setSaving(true,"Adopting primary guardian into the canonical relationship model…");
    try{
      await perform("adopt_primary_guardian",{personId,expectedPersonRevision:revision});
      await openStudent(personId,{force:true});status.textContent="Primary guardian adopted. The legacy compatibility snapshot was preserved.";
    }catch(error){status.textContent=error?.message||"Guardian adoption failed.";}
    finally{setSaving(false);}
  })();
});

function openGuardianLifecycle(guardian,restoring){
  guardianLifecycle={guardian,restoring};
  const form=get("sr-guardian-lifecycle-form");form.reset();
  get("sr-guardian-lifecycle-title").textContent=restoring?"Restore guardian relationship":"End guardian relationship";
  get("sr-guardian-lifecycle-target").textContent=guardian.displayName+" · "+guardian.relationship;
  get("sr-guardian-lifecycle-confirm").textContent=restoring?"Restore relationship":"End relationship";
  get("sr-guardian-lifecycle-confirm").className="sr-btn mt-4 "+(restoring?"success":"danger");
  get("sr-guardian-lifecycle-dialog").showModal();
}
function closeGuardianLifecycle(){
  if(saving)return;guardianLifecycle=null;get("sr-guardian-lifecycle-dialog").close();
}
get("sr-guardian-lifecycle-close").addEventListener("click",closeGuardianLifecycle);
get("sr-guardian-lifecycle-dialog").addEventListener("cancel",event=>{if(saving)event.preventDefault();else guardianLifecycle=null;});
get("sr-guardian-lifecycle-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!current||!guardianLifecycle||!event.currentTarget.reportValidity())return;
  const change=guardianLifecycle,reason=String(new FormData(event.currentTarget).get("reason")||"").trim(),
    action=change.restoring?"restore_guardian":"end_guardian",personId=current.person.personId;
  void (async()=>{
    setSaving(true,(change.restoring?"Restoring":"Ending")+" guardian relationship…");
    try{
      await perform(action,{personId,relationshipId:change.guardian.relationshipId,
        expectedRevision:Number(change.guardian.revision)||1,reason});
      guardianLifecycle=null;get("sr-guardian-lifecycle-dialog").close();
      await openStudent(personId,{force:true});status.textContent=change.restoring?"Guardian relationship restored.":"Guardian relationship ended; history was preserved.";
    }catch(error){status.textContent=error?.message||"Guardian relationship lifecycle change failed.";}
    finally{setSaving(false);}
  })();
});

function closeRequest(){if(saving)return;get("sr-request-dialog").close();}
get("sr-new-request").addEventListener("click",()=>{
  if(!current||saving)return;get("sr-request-form").reset();get("sr-request-dialog").showModal();
});
get("sr-request-close").addEventListener("click",closeRequest);
get("sr-request-dialog").addEventListener("cancel",event=>{if(saving)event.preventDefault();});
get("sr-request-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!current||!event.currentTarget.reportValidity())return;
  const data=new FormData(event.currentTarget),personId=current.person.personId;
  void (async()=>{
    setSaving(true,"Creating registrar document request…");
    try{
      await perform("create_document_request",{personId,type:String(data.get("type")||""),
        purpose:String(data.get("purpose")||"").trim(),notes:String(data.get("notes")||"").trim()});
      get("sr-request-dialog").close();await openStudent(personId,{force:true});status.textContent="Document request created.";
    }catch(error){status.textContent=error?.message||"Document request was not created.";}
    finally{setSaving(false);}
  })();
});

function openRequestLifecycle(request,nextStatus){
  requestLifecycle={request,nextStatus};
  const form=get("sr-request-lifecycle-form");form.reset();
  get("sr-request-lifecycle-title").textContent=requestStateLabel(nextStatus);
  get("sr-request-lifecycle-target").textContent=request.label+" · "+requestStateLabel(request.status)+" → "+requestStateLabel(nextStatus);
  const release=nextStatus==="released";get("sr-release-reference-field").hidden=!release;
  form.elements.releaseReference.required=release;
  get("sr-request-lifecycle-confirm").textContent=release?"Release record":"Confirm status";
  get("sr-request-lifecycle-dialog").showModal();
}
function closeRequestLifecycle(){
  if(saving)return;requestLifecycle=null;get("sr-request-lifecycle-dialog").close();
}
get("sr-request-lifecycle-close").addEventListener("click",closeRequestLifecycle);
get("sr-request-lifecycle-dialog").addEventListener("cancel",event=>{if(saving)event.preventDefault();else requestLifecycle=null;});
get("sr-request-lifecycle-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!current||!requestLifecycle||!event.currentTarget.reportValidity())return;
  const change=requestLifecycle,data=new FormData(event.currentTarget),personId=current.person.personId;
  void (async()=>{
    setSaving(true,"Updating document request…");
    try{
      await perform("change_document_request",{requestId:change.request.requestId,
        expectedRevision:Number(change.request.revision)||1,status:change.nextStatus,
        reason:String(data.get("reason")||"").trim(),
        releaseReference:String(data.get("releaseReference")||"").trim()});
      requestLifecycle=null;get("sr-request-lifecycle-dialog").close();
      await openStudent(personId,{force:true});status.textContent="Document request updated.";
    }catch(error){status.textContent=error?.message||"Document request was not updated.";}
    finally{setSaving(false);}
  })();
});

get("sr-search-button").addEventListener("click",()=>void searchStudents());
get("sr-search").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();void searchStudents();}});

picker=createTenantSchoolPicker({
  host:get("sr-school-picker"),status,
  onBeforeChange:async()=>{
    if(saving)throw new Error("Finish the current Student Records change before switching schools.");
    ++searchRun;++fileRun;students=[];current=null;guardianChange=null;guardianLifecycle=null;requestLifecycle=null;
    setUrlPerson("");get("sr-search").value="";get("sr-student-list").replaceChildren();fileHost.hidden=true;workspace.hidden=true;
    for(const dialog of document.querySelectorAll("dialog"))if(dialog.open)dialog.close();
  },
  onReady:scope=>{
    const currentScope=scope.current;
    if(!currentScope?.roles.some(role=>["school_admin","registrar"].includes(role))){
      workspace.hidden=true;status.textContent="School Administrator or Registrar access is required for Student Records.";return;
    }
    workspace.hidden=false;status.textContent="Student Records ready. Search for a learner or open a deep link from People & Access.";
    void searchStudents().then(()=>{
      if(requestedPersonId&&!current)void openStudent(requestedPersonId);
    });
  }
});
try{
  await picker.load();
  if(!auth.currentUser)status.textContent="Sign in to use Student Records.";
}catch(error){status.textContent=error?.message||"Student Records access could not be verified.";}
