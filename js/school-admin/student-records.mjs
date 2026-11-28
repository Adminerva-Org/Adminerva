import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs";

const get=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolStudentRecords");
const status=get("sr-status"),workspace=get("sr-workspace"),fileHost=get("sr-file");
const requestedSchoolId=(()=>{try{return new URL(location.href).searchParams.get("schoolId")||"";}catch{return "";}})();
let requestedPersonId=(()=>{try{
  const value=new URL(location.href).searchParams.get("personId")||"";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)?value:"";
}catch{return "";}})();
let picker=null,students=[],current=null,saving=false,searchRun=0,fileRun=0,
  guardianChange=null,guardianLifecycle=null,requestLifecycle=null;
let directoryCursor=null,directoryQuery="",directoryBusy=false;
let fileView="registrations",historyBusy=false,readinessRun=0,readinessData=null,requestPlacement=null;
let profileData=null,profileRun=0,profileDirty=false;
let requestedQueueStatus=(()=>{try{const url=new URL(location.href),value=url.searchParams.get("status");return url.searchParams.get("view")==="requests"&&["requested","in_review","ready","released","cancelled","open","all"].includes(value)?value:"";}catch{return "";}})();
let recordsMode="students",queueRows=[],queueCursor=null,queueRun=0,queueBusy=false,queueSkipped=0;

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
    get("sr-search").disabled=false;get("sr-search-button").disabled=directoryBusy;get("sr-more").disabled=directoryBusy;
    get("sr-guardian-close").disabled=false;get("sr-guardian-lifecycle-close").disabled=false;
    get("sr-request-close").disabled=false;get("sr-request-lifecycle-close").disabled=false;
    renderHistoryControls();renderQueueControls();
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
  if(!students.length){empty(host,directoryCursor?"No matches in the records searched so far.":"No student records match this search.");return;}
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
async function searchStudents({more=false}={}){
  if(saving||directoryBusy)return;
  const query=String(get("sr-search").value||"").trim();
  if(more&&(!directoryCursor||query!==directoryQuery))return;
  const run=++searchRun,cursor=more?directoryCursor:null;
  if(!more){directoryQuery=query;directoryCursor=null;students=[];get("sr-student-list").replaceChildren();}
  directoryBusy=true;
  get("sr-search-button").disabled=true;get("sr-more").disabled=true;
  get("sr-search-progress").textContent="Searching…";
  try{
    const result=await perform("search_students",{query,...(cursor?{cursor}:{})});
    if(run!==searchRun)return;
    const unique=new Map(students.map(item=>[item.personId,item]));
    for(const item of result.items||[])unique.set(item.personId,item);
    students=[...unique.values()].sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.personId.localeCompare(b.personId));
    directoryCursor=result.nextCursor||null;
    renderStudents();
    get("sr-more").hidden=!directoryCursor||String(get("sr-search").value||"").trim()!==directoryQuery;
    get("sr-more").textContent=query?"Search more records":"Load more";
    get("sr-search-progress").textContent=students.length+" found"+(directoryCursor?" · More records available.":result.truncated?" · Results limited by the current server version.":" · End of directory.");
  }catch(error){
    if(run===searchRun)get("sr-search-progress").textContent=error?.message||"Search failed. Retry.";
  }finally{
    if(run===searchRun){directoryBusy=false;get("sr-search-button").disabled=saving;get("sr-more").disabled=saving;}
  }
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
    const state=record.status==="ended"?(record.endReasonType==="progression"?record.progressionType||"progression":record.endReasonType||"ended"):record.status;
    title.append(textNode("strong",recordLabel(record)),badge(state,record.status));
    const meta=[record.gradeLevel?(/^\d+$/.test(String(record.gradeLevel))?"Grade "+record.gradeLevel:record.gradeLevel):"",
      record.createdAt?"created "+fmt(record.createdAt):"",record.endedAt?"ended "+fmt(record.endedAt):""].filter(Boolean).join(" · ");
    info.append(title,textNode("p",meta,"sr-muted"));row.append(info);
    if(record.status==="active"&&picker.scope.current.enrollmentMode==="canonical"){
      const link=document.createElement("a");link.className="sr-btn secondary";link.textContent="Transfer out";link.href="school-enrollment.html?schoolId="+encodeURIComponent(picker.scope.current.schoolId)+"&personId="+encodeURIComponent(data.person.personId)+"&registrationId="+encodeURIComponent(record.registrationId)+"&intent=transfer_out";row.append(link);
    }
    if(record.status==="ended"&&record.endReasonType==="transfer_out")row.append(button("Request transfer certificate",{tone:"secondary",onClick:()=>openNewRequest(record)}));
    host.append(row);
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
  if(row.status==="in_review")return [...(row.generationMode==="institutional"&&!row.hasCertificateDraft?[]:[["Mark ready","ready","success"]]),["Cancel","cancelled","danger"]];
  if(row.status==="ready")return [...(row.generationMode==="institutional"?[]:[["Release","released","success"]]),["Return to review","in_review",""],["Cancel","cancelled","danger"]];
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
    if(request.generationMode==="institutional"&&["in_review","ready","released"].includes(request.status))controls.append(button("Certificate",{tone:"secondary",onClick:()=>void openCertificate(request)}));
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
async function loadAdmissionDocuments(){
  if(saving||!current)return;
  const personId=current.person.personId,run=fileRun,host=get("sr-admission-docs");
  host.textContent="Loading…";
  try{
    const result=await perform("list_admission_documents",{personId});
    if(run!==fileRun||current?.person.personId!==personId)return;
    host.replaceChildren();
    if(!result.items?.length){host.textContent="No admission documents stored.";return;}
    for(const row of result.items){
      const line=document.createElement("div");line.className="sr-row";
      line.append(textNode("span",row.label+" · "+Math.ceil(row.size/1024)+" KB"));
      line.append(button("Download",{tone:"secondary",onClick:()=>void (async()=>{
        if(saving||current?.person.personId!==personId)return;
        setSaving(true,"Downloading document…");
        try{
          const result=await perform("download_admission_document",{personId,applicationId:row.applicationId,documentId:row.documentId});
          if(run!==fileRun||current?.person.personId!==personId)return;
          const ext=({"application/pdf":"pdf","image/jpeg":"jpg","image/png":"png"})[result.contentType];if(!ext)throw new Error("Unsupported document format.");
          const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0))],{type:result.contentType})),link=document.createElement("a");
          link.href=url;link.download="admission-document."+ext;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent="Document downloaded.";
        }catch(error){status.textContent=error?.message||"Document download failed.";}finally{setSaving(false);}
      })()}));host.append(line);
    }
  }catch(error){if(run===fileRun)host.textContent=error?.message||"Documents unavailable.";}
}
get("sr-load-admission-docs").addEventListener("click",()=>void loadAdmissionDocuments());
const historyKeys={registrations:"registrationId",guardians:"relationshipId",documentRequests:"requestId",releasedGrades:"offeringId",audit:"auditId"};
const historyRenderers={registrations:renderRegistrations,guardians:renderGuardians,documentRequests:renderRequests,releasedGrades:renderGrades,audit:renderAudit};
function showFileView(view){
  if(!["readiness","registrations","profile","releasedGrades","guardians","documents","audit"].includes(view))return;
  if(fileView==="profile"&&view!=="profile"&&profileDirty&&!confirm("Discard unsaved profile changes?"))return;
  if(fileView==="profile"&&view!=="profile"&&profileDirty)clearProfile();
  fileView=view;
  for(const panel of document.querySelectorAll("[data-sr-panel]"))panel.hidden=panel.dataset.srPanel!==view;
  for(const control of document.querySelectorAll("[data-sr-view]"))control.setAttribute("aria-pressed",String(control.dataset.srView===view));
  if(view==="profile"&&current&&!profileData)void loadProfile();
  if(view==="readiness"&&current&&!readinessData)void loadReadiness();
}
function clearReadiness(){++readinessRun;readinessData=null;get("sr-readiness-list").replaceChildren();get("sr-readiness-status").textContent="";}
async function loadReadiness(){
  if(saving||!current)return;const personId=current.person.personId,run=++readinessRun,host=get("sr-readiness-list");host.replaceChildren();get("sr-readiness-status").textContent="Checking canonical records…";
  try{
    const data=await perform("student_record_readiness",{personId});if(run!==readinessRun||current?.person.personId!==personId)return;
    readinessData=data;const conflicts=data.issues.filter(issue=>issue.level==="conflict").length;
    get("sr-readiness-status").textContent=conflicts+" conflicts · "+(data.issues.length-conflicts)+" items to review"+(data.partial?" · partial scan":"")+" · "+fmt(data.asOf);
    if(!data.issues.length)empty(host,"No issues found in this record check. Academic evidence is checked separately.");
    for(const issue of data.issues){
      const row=document.createElement("article");row.className="sr-row";row.append(textNode("strong",issue.label));
      if(issue.view==="identity"){if(!get("sr-open-people").hidden){const link=document.createElement("a");link.className="sr-btn secondary";link.href=get("sr-open-people").href;link.textContent="Identity & access";row.append(link);}else row.append(textNode("span","School Administrator review","sr-muted"));}
      else row.append(button("Review",{tone:"secondary",onClick:()=>showFileView(issue.view)}));
      host.append(row);
    }
  }catch(error){if(run===readinessRun)get("sr-readiness-status").textContent=error?.message||"Record check unavailable.";}
}
get("sr-readiness-refresh").addEventListener("click",()=>void loadReadiness());
get("sr-readiness-academic").addEventListener("click",()=>{if(current&&!saving){showFileView("releasedGrades");academicOptions();get("sr-academic-dialog").showModal();}});
function renderHistoryControls(){
  for(const section of Object.keys(historyKeys)){
    const cursor=current?.nextCursors?.[section];
    get("sr-history-more-"+section).hidden=!cursor;get("sr-history-more-"+section).disabled=saving||historyBusy;
    get("sr-history-count-"+section).textContent=current?((current[section]||[]).length+" loaded"+(cursor?" · more history available":"")):"";
  }
}
function sortHistory(section,rows){
  if(section==="guardians")return rows.sort((a,b)=>Number(b.isPrimary)-Number(a.isPrimary)||a.displayName.localeCompare(b.displayName));
  const time=section==="releasedGrades"?"finalizedAt":section==="documentRequests"?"updatedAt":"createdAt";
  return rows.sort((a,b)=>(b[time]||0)-(a[time]||0));
}
async function loadHistory(section){
  if(saving||historyBusy||!current||!Object.hasOwn(historyKeys,section)||!current.nextCursors?.[section])return;
  const run=fileRun,personId=current.person.personId,cursor=current.nextCursors[section];historyBusy=true;renderHistoryControls();
  try{
    const data=await perform("student_file",{personId,historySection:section,cursor});
    if(run!==fileRun||current?.person.personId!==personId)return;
    if(data.historySection!==section||!data.nextCursors)throw new Error("History pagination is not available on this backend.");
    const key=historyKeys[section],rows=new Map((current[section]||[]).map(row=>[row[key],row]));
    for(const row of data[section]||[])rows.set(row[key],row);
    current[section]=sortHistory(section,[...rows.values()]);current.nextCursors[section]=data.nextCursors[section]||null;
    // Adoption is a mutation; only the complete first-page check can offer it.
    if(section==="guardians")current.legacyGuardianAvailable=false;
    historyRenderers[section](current);
  }catch(error){if(run===fileRun)status.textContent=error?.message||"More history could not be loaded.";}
  finally{if(run===fileRun){historyBusy=false;renderHistoryControls();}}
}
for(const control of document.querySelectorAll("[data-sr-view]"))control.addEventListener("click",()=>showFileView(control.dataset.srView));
for(const control of document.querySelectorAll("[data-sr-history]"))control.addEventListener("click",()=>void loadHistory(control.dataset.srHistory));
const profileFields=["lrn","lrnState","sex","birthPlace","nationality","addressLine","barangay","cityMunicipality","province","postalCode","country","previousSchool"];
function clearProfile(){++profileRun;profileData=null;profileDirty=false;get("sr-profile-form").reset();get("sr-profile-form").hidden=true;get("sr-profile-status").textContent="";}
async function loadProfile({force=false}={}){
  if((saving&&!force)||!current)return;
  if(profileDirty&&!confirm("Discard unsaved profile changes?"))return;
  const personId=current.person.personId,run=++profileRun;profileDirty=false;get("sr-profile-form").hidden=true;get("sr-profile-status").textContent="Loading profile…";
  try{
    const result=await perform("get_registrar_profile",{personId});
    if(run!==profileRun||current?.person.personId!==personId)return;
    profileData=result;const form=get("sr-profile-form");
    for(const field of profileFields)form.elements[field].value=result.profile[field]||((field==="lrnState")?"unrecorded":"");
    form.elements.reason.value="";form.hidden=false;get("sr-profile-status").textContent=result.revision?"Profile revision "+result.revision:"No supplementary profile recorded.";
  }catch(error){if(run===profileRun)get("sr-profile-status").textContent=error?.message||"Profile unavailable.";}
}
get("sr-profile-refresh").addEventListener("click",()=>void loadProfile());
get("sr-profile-form").addEventListener("input",()=>{profileDirty=true;});
get("sr-profile-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!current||!profileData||profileData.personId!==current.person.personId||!event.currentTarget.reportValidity())return;
  const personId=current.person.personId,data=new FormData(event.currentTarget),profile=Object.fromEntries(profileFields.map(key=>[key,String(data.get(key)||"").trim()]));
  const reason=String(data.get("reason")||"").trim(),expectedRevision=profileData.revision;
  void (async()=>{
    setSaving(true,"Saving profile…");
    try{await perform("save_registrar_profile",{personId,profile,reason,expectedRevision});profileDirty=false;await loadProfile({force:true});status.textContent="Student profile saved.";}
    catch(error){get("sr-profile-status").textContent=error?.message||"Profile save failed.";}finally{setSaving(false);}
  })();
});
let academicData=null,academicRun=0,certificateData=null,certificateRun=0,certificateSettings=null,settingsRun=0,verifyRun=0,lrnRun=0;
function clearLrnLookup(){++lrnRun;get("sr-lrn-value").value="";get("sr-lrn-status").textContent="";}
get("sr-lrn-find").addEventListener("click",()=>{if(!saving){clearLrnLookup();get("sr-lrn-dialog").showModal();}});
get("sr-lrn-close").addEventListener("click",()=>{clearLrnLookup();get("sr-lrn-dialog").close();});
get("sr-lrn-dialog").addEventListener("cancel",clearLrnLookup);
get("sr-lrn-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!event.currentTarget.reportValidity())return;
  const run=++lrnRun,lrn=get("sr-lrn-value").value;get("sr-lrn-status").textContent="Searching school records…";
  void (async()=>{try{const data=await perform("find_student_by_lrn",{lrn});if(run!==lrnRun)return;
    if(data.state!=="found"){get("sr-lrn-status").textContent="No active LRN claim in this school.";return;}
    clearLrnLookup();get("sr-lrn-dialog").close();await openStudent(data.personId);
  }catch(error){if(run===lrnRun)get("sr-lrn-status").textContent=error?.message||"LRN lookup unavailable.";}})();
});
let externalRows=[],externalCursor=null,externalRun=0,externalBusy=false,externalEdit=null,externalDirty=false;
function closeExternalEdit(){externalEdit=null;externalDirty=false;const form=get("sr-external-form");form.reset();form.hidden=true;get("sr-external-results").replaceChildren();}
function clearExternal(){++externalRun;externalRows=[];externalCursor=null;externalBusy=false;closeExternalEdit();get("sr-external-list").replaceChildren();get("sr-external-status").textContent="";get("sr-external-more").hidden=true;}
function renderExternalResults(){
  const host=get("sr-external-results");host.replaceChildren();if(!externalEdit)return;
  for(const [index,result] of externalEdit.results.entries()){
    const row=document.createElement("div");row.className="grid sm:grid-cols-[1fr_100px_auto] gap-2";
    const subject=document.createElement("input");subject.className="sr-input";subject.placeholder="Subject";subject.setAttribute("aria-label","Source subject");subject.maxLength=150;subject.required=true;subject.value=result.subject;
    const grade=document.createElement("input");grade.className="sr-input";grade.placeholder="Result";grade.setAttribute("aria-label","Source result");grade.maxLength=40;grade.required=true;grade.value=result.result;
    subject.addEventListener("input",()=>{result.subject=subject.value;externalDirty=true;});grade.addEventListener("input",()=>{result.result=grade.value;externalDirty=true;});
    row.append(subject,grade,button("Remove",{tone:"secondary",onClick:()=>{if(saving)return;externalEdit.results.splice(index,1);externalDirty=true;renderExternalResults();}}));host.append(row);
  }
  get("sr-external-result-add").disabled=saving||externalEdit.results.length>=30;
}
function editExternal(item=null){
  if(saving||!current)return;
  if(externalDirty&&!confirm("Discard unsaved source record changes?"))return;
  const form=get("sr-external-form");form.reset();form.hidden=false;
  externalEdit={recordId:item?.recordId||"",revision:item?.revision||0,results:(item?.results||[{subject:"",result:""}]).map(row=>({...row}))};
  for(const key of ["sourceSchool","schoolYear","gradeLevel","period","sourceReference"]){form.elements[key].value=item?.[key]||"";form.elements[key].readOnly=Boolean(item&&key!=="sourceReference");}
  get("sr-external-form-title").textContent=item?"Correct source record":"New source record";externalDirty=false;renderExternalResults();
}
function renderExternalRows(){
  const host=get("sr-external-list");host.replaceChildren();if(!externalRows.length)empty(host,externalCursor?"No records in loaded page. Load more.":"No previous-school academic records.");
  for(const item of externalRows){
    const card=document.createElement("article");card.className="sr-row";const info=document.createElement("div");info.append(textNode("strong",item.sourceSchool),textNode("p",[item.schoolYear,item.gradeLevel,item.period,item.state].join(" · "),"sr-muted"),textNode("p",item.results.map(row=>row.subject+": "+row.result).join(" · "),"sr-muted"),textNode("p","Source: "+item.sourceReference,"sr-muted"));card.append(info);
    const controls=actions();if(item.state!=="archived")controls.append(button("Correct",{tone:"secondary",onClick:()=>editExternal(item)}));
    if(item.state==="recorded")controls.append(button("Verify",{tone:"success",onClick:()=>void reviewExternal(item,"verified")}));
    if(item.state==="verified")controls.append(button("Return to review",{tone:"secondary",onClick:()=>void reviewExternal(item,"recorded")}));
    controls.append(button(item.state==="archived"?"Restore":"Archive",{tone:"secondary",onClick:()=>void reviewExternal(item,item.state==="archived"?"recorded":"archived")}));card.append(controls);host.append(card);
  }
  get("sr-external-more").hidden=!externalCursor;get("sr-external-more").disabled=externalBusy||saving;
  get("sr-external-status").textContent=externalRows.length+" source records loaded"+(externalCursor?" · more available":"");
}
async function loadExternal({more=false,force=false}={}){
  if(!current||(saving&&!force)||(more&&(!externalCursor||externalBusy)))return;
  const run=++externalRun,personId=current.person.personId,cursor=more?externalCursor:null;externalBusy=true;get("sr-external-status").textContent="Loading…";
  try{const result=await perform("list_external_academic_records",{personId,...(cursor?{cursor}:{})});if(run!==externalRun||current?.person.personId!==personId)return;
    const rows=new Map((more?externalRows:[]).map(row=>[row.recordId,row]));for(const row of result.items||[])rows.set(row.recordId,row);externalRows=[...rows.values()];externalCursor=result.nextCursor||null;renderExternalRows();
  }catch(error){if(run===externalRun)get("sr-external-status").textContent=error?.message||"Source records unavailable.";}finally{if(run===externalRun){externalBusy=false;get("sr-external-more").disabled=saving;}}
}
async function reviewExternal(item,next){
  if(saving||!current||externalDirty)return;const reason=prompt(next==="verified"?"Confirm authentic source review and record the reason (at least 8 characters).":"Record the reason (at least 8 characters).");
  if(!reason||reason.trim().length<8)return;setSaving(true,"Updating external academic record…");
  try{await perform("review_external_academic_record",{personId:current.person.personId,recordId:item.recordId,expectedRevision:item.revision,state:next,reason:reason.trim(),confirmSourceReviewed:next==="verified"});closeExternalEdit();await loadExternal({force:true});status.textContent="Source evidence updated.";}catch(error){get("sr-external-status").textContent=error?.message||"Source review failed.";}finally{setSaving(false);}
}
get("sr-external-open").addEventListener("click",()=>{if(!current||saving)return;clearExternal();get("sr-external-dialog").showModal();void loadExternal();});
function closeExternal(){if(saving||(externalDirty&&!confirm("Discard unsaved source record changes?")))return;clearExternal();get("sr-external-dialog").close();}
get("sr-external-close").addEventListener("click",closeExternal);get("sr-external-dialog").addEventListener("cancel",event=>{event.preventDefault();closeExternal();});
get("sr-external-refresh").addEventListener("click",()=>void loadExternal());get("sr-external-more").addEventListener("click",()=>void loadExternal({more:true}));get("sr-external-add").addEventListener("click",()=>editExternal());get("sr-external-cancel").addEventListener("click",()=>{if(!saving&&(!externalDirty||confirm("Discard changes?")))closeExternalEdit();});
get("sr-external-form").addEventListener("input",()=>{externalDirty=true;});
get("sr-external-result-add").addEventListener("click",()=>{if(!saving&&externalEdit&&externalEdit.results.length<30){externalEdit.results.push({subject:"",result:""});externalDirty=true;renderExternalResults();}});
get("sr-external-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!current||!externalEdit||!event.currentTarget.reportValidity())return;const personId=current.person.personId,edit=externalEdit,data=Object.fromEntries(new FormData(event.currentTarget));
  const details=Object.fromEntries(["sourceSchool","schoolYear","gradeLevel","period","sourceReference"].map(key=>[key,String(data[key]||"").trim()]));details.results=edit.results.map(row=>({...row}));
  void (async()=>{setSaving(true,"Saving previous-school evidence…");try{await perform("save_external_academic_record",{personId,recordId:edit.recordId,expectedRevision:edit.revision,details,reason:String(data.reason||"").trim()});closeExternalEdit();await loadExternal({force:true});status.textContent="Source evidence saved. Verify before using it in academic preparation.";}catch(error){get("sr-external-status").textContent=error?.message||"Source record save failed.";}finally{setSaving(false);}})();
});
function resetAcademic(){++academicRun;academicData=null;get("sr-academic-results").replaceChildren();get("sr-academic-blockers").replaceChildren();get("sr-academic-export").disabled=true;get("sr-academic-status").textContent="";}
async function academicOptions(){
  if(!current)return;const mode=get("sr-academic-mode").value,select=get("sr-academic-year"),prior=select.value,personId=current.person.personId;select.replaceChildren(new Option(mode==="sf9"?"Choose academic year":"All school years",""));select.required=mode==="sf9";resetAcademic();const run=academicRun;
  get("sr-academic-status").textContent="Loading academic years…";
  try{const result=await perform("academic_record_years",{personId});if(run!==academicRun||current?.person.personId!==personId)return;const years=new Map((result.items||[]).map(row=>[row.yearId,row.label]));for(const [id,label] of years)select.append(new Option(label,id));if(years.has(prior))select.value=prior;else if(mode==="sf9"&&years.size===1)select.value=years.keys().next().value;get("sr-academic-status").textContent="";}catch(error){if(run===academicRun)get("sr-academic-status").textContent=error?.message||"Academic years unavailable.";}
}
get("sr-academic-prepare").addEventListener("click",()=>{if(!current||saving)return;academicOptions();get("sr-academic-dialog").showModal();});
get("sr-academic-mode").addEventListener("change",academicOptions);get("sr-academic-year").addEventListener("change",resetAcademic);
get("sr-academic-close").addEventListener("click",()=>{resetAcademic();get("sr-academic-dialog").close();});
get("sr-academic-dialog").addEventListener("cancel",resetAcademic);
get("sr-academic-form").addEventListener("submit",event=>{
  event.preventDefault();if(!current||saving||!event.currentTarget.reportValidity())return;
  resetAcademic();const run=academicRun,personId=current.person.personId,mode=get("sr-academic-mode").value,yearId=get("sr-academic-year").value;
  get("sr-academic-status").textContent="Checking released academic records…";
  void (async()=>{try{
    const data=await perform("academic_record_packet",{personId,mode,yearId});
    if(run!==academicRun||current?.person.personId!==personId)return;
    academicData=data;get("sr-academic-status").textContent=data.rows.length+" class results · "+(data.completeWithinScope?"No evidence blockers in selected scope":"Review missing evidence")+" · Working data only";
    for(const issue of data.blockers)get("sr-academic-blockers").append(textNode("p",issue,"sr-muted"));
    for(const row of data.rows){
      const line=document.createElement("div");line.className="sr-row";line.append(textNode("strong",row.subjectName||row.subjectId||"Unknown subject"),
        textNode("p",[row.yearName,row.termName,row.sectionName,row.state==="released"?"Grade "+row.finalGrade+" · r"+row.releasedRevision:row.state.replaceAll("_"," ")].filter(Boolean).join(" · "),"sr-muted"));
      get("sr-academic-results").append(line);
    }
    if(data.externalRecords?.length){get("sr-academic-results").append(textNode("h3","Verified previous-school records","font-bold"));for(const item of data.externalRecords){const line=document.createElement("div");line.className="sr-row";line.append(textNode("strong",item.sourceSchool),textNode("p",[item.schoolYear,item.gradeLevel,item.period,item.results.map(row=>row.subject+": "+row.result).join(" · ")].join(" · "),"sr-muted"));get("sr-academic-results").append(line);}}
    get("sr-academic-export").disabled=!data.rows.length&&!data.externalRecords?.length;
  }catch(error){if(run===academicRun)get("sr-academic-status").textContent=error?.message||"Academic data unavailable.";}})();
});
function csvCell(value){
  let s=String(value??"");if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';
}
get("sr-academic-export").addEventListener("click",()=>{
  if(!academicData||saving)return;
  const data=academicData,rows=[["WORKING DATA ONLY — NOT AN OFFICIAL SCHOOL FORM"],["Record type",data.mode,"Student",data.studentName,"Student number",data.studentNumber],["Year","Period","Subject","Section","Final grade","Released revision","Evidence status","Offering ID","Grade record ID"],...data.rows.map(row=>[row.yearName,row.termName,row.subjectName,row.sectionName,row.finalGrade,row.releasedRevision,row.state,row.offeringId,row.gradeRecordId||""]),...data.blockers.map(issue=>["REVIEW",issue]),["PREVIOUS-SCHOOL VERIFIED SOURCE EVIDENCE"],["Source school","Source year","Grade level","Source period","Subject","Result as recorded","Source reference","Evidence revision"],...(data.externalRecords||[]).flatMap(item=>item.results.map(row=>[item.sourceSchool,item.schoolYear,item.gradeLevel,item.period,row.subject,row.result,item.sourceReference,item.revision]))];
  const url=URL.createObjectURL(new Blob([rows.map(row=>row.map(csvCell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"})),link=document.createElement("a");
  link.href=url;link.download="academic-record-working-data.csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
function closeCertificateSettings(){++settingsRun;certificateSettings=null;get("sr-certificate-settings-form").reset();get("sr-certificate-settings-save").disabled=true;get("sr-certificate-settings-dialog").close();}
async function loadCertificateSettings(){
  if(saving)return;
  const run=++settingsRun,type=get("sr-certificate-type").value;certificateSettings=null;get("sr-certificate-settings-save").disabled=true;get("sr-certificate-settings-status").textContent="Loading…";
  for(const key of ["signatoryName","signatoryTitle","schoolAddress","schoolIdentifier","reason"])get("sr-certificate-settings-form").elements[key].value="";
  try{const data=await perform("get_certificate_template",{type});if(run!==settingsRun)return;certificateSettings=data;
    for(const key of ["signatoryName","signatoryTitle","schoolAddress","schoolIdentifier"])get("sr-certificate-settings-form").elements[key].value=data[key]||"";
    get("sr-certificate-settings-status").textContent=data.revision?"Template revision "+data.revision:"Not configured.";get("sr-certificate-settings-save").disabled=false;
  }catch(error){if(run===settingsRun)get("sr-certificate-settings-status").textContent=error?.message||"Settings unavailable.";}
}
get("sr-certificate-settings").addEventListener("click",()=>{if(!saving){get("sr-certificate-settings-form").reset();get("sr-certificate-settings-dialog").showModal();void loadCertificateSettings();}});
get("sr-certificate-type").addEventListener("change",()=>void loadCertificateSettings());
get("sr-certificate-settings-close").addEventListener("click",()=>{if(!saving)closeCertificateSettings();});
get("sr-certificate-settings-dialog").addEventListener("cancel",event=>{event.preventDefault();if(!saving)closeCertificateSettings();});
get("sr-certificate-settings-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!certificateSettings||!event.currentTarget.reportValidity())return;
  const data=Object.fromEntries(new FormData(event.currentTarget)),expectedRevision=certificateSettings.revision;
  void (async()=>{setSaving(true,"Saving certificate settings…");try{certificateSettings=await perform("save_certificate_template",{...data,expectedRevision});
    get("sr-certificate-settings-form").elements.reason.value="";get("sr-certificate-settings-status").textContent="Saved · revision "+certificateSettings.revision;
  }catch(error){get("sr-certificate-settings-status").textContent=error?.message||"Settings save failed.";}finally{setSaving(false);}})();
});
function certificatePreview(data){
  const host=get("sr-certificate-preview");host.replaceChildren();const c=data?.certificate;
  if(!c)return;
  for(const [tag,value] of [["strong",c.schoolName],["span",c.schoolAddress],["strong",c.title||"Certificate of Enrollment"],["p",c.studentName+" · "+(c.studentNumber||"")],["p",[c.yearName,c.termName,c.programName,c.sectionName].join(" · ")],["p","Purpose: "+c.purpose],["p",c.signatoryName+" · "+c.signatoryTitle],["p",data.reference||"DRAFT — not issued"],["p","Requires authorized signature. Digital signature not provided."]])if(value)host.append(textNode(tag,value,tag==="p"?"sr-muted":""));
}
function renderCertificate(){
  const data=certificateData?.data;certificatePreview(data);
  const state=data?.state||"",editable=["in_review","ready"].includes(state);
  get("sr-certificate-prepare-form").hidden=!editable;
  const type=data?.type||certificateData?.type;get("sr-good-moral-approval").hidden=type!=="good_moral_certificate"||!editable;
  get("sr-good-moral-state").textContent=data?.attestation?.status==="approved"?"Office approval recorded · "+data.attestation.office+" · "+data.attestation.reference:"Documented office approval required.";
  get("sr-good-moral-attest").hidden=get("sr-certificate-settings").hidden;
  get("sr-good-moral-withdraw").hidden=get("sr-certificate-settings").hidden||data?.attestation?.status!=="approved";
  get("sr-certificate-print").hidden=!data?.certificate||state==="revoked";
  get("sr-certificate-issue").hidden=state!=="ready"||!data?.certificate;
  get("sr-certificate-revoke").hidden=state!=="issued";
  get("sr-certificate-status").textContent=state==="revoked"?"Revoked — no valid institutional release.":state==="issued"?"Issued record · signature must be verified separately.":state==="ready"?"Approved for release.":state==="in_review"?"Prepare or review draft. Mark ready in the request queue.":"";
  const select=get("sr-certificate-registration");select.replaceChildren(new Option("Choose registration",""));
  for(const row of data?.placements||[])select.append(new Option(row.label,row.registrationId));
  if(data?.certificate?.registrationId)select.value=data.certificate.registrationId;else if(data?.placements?.length===1)select.value=data.placements[0].registrationId;
}
function closeCertificate(){++certificateRun;certificateData=null;get("sr-certificate-preview").replaceChildren();get("sr-certificate-registration").replaceChildren();get("sr-certificate-dialog").close();}
async function openCertificate(row,fromQueue=false){
  if(saving)return;const run=++certificateRun;
  certificateData={requestId:row.requestId,personId:fromQueue?row.personId:current?.person.personId,fromQueue,type:row.type,data:null};
  get("sr-certificate-title").textContent=row.label||"Institutional certificate";
  get("sr-certificate-preview").replaceChildren();get("sr-certificate-status").textContent="Loading…";
  for(const id of ["sr-certificate-prepare-form","sr-certificate-print","sr-certificate-issue","sr-certificate-revoke"])get(id).hidden=true;
  get("sr-certificate-dialog").showModal();
  try{const data=await perform("get_enrollment_certificate",{requestId:row.requestId});if(run!==certificateRun||!certificateData)return;certificateData.data=data;renderCertificate();}
  catch(error){if(run===certificateRun)get("sr-certificate-status").textContent=error?.message||"Certificate unavailable.";}
}
get("sr-certificate-close").addEventListener("click",()=>{if(!saving)closeCertificate();});
get("sr-certificate-dialog").addEventListener("cancel",event=>{event.preventDefault();if(!saving)closeCertificate();});
async function refreshCredentialOwner(owner){
  if(owner.fromQueue){await loadRequestQueue({force:true});if(current?.person.personId===owner.personId){current=null;fileHost.hidden=true;get("sr-empty-file").hidden=false;}}
  else await openStudent(owner.personId,{force:true});
}
async function mutateCertificate(action,details){
  if(saving||!certificateData?.data)return;
  const owner=certificateData,requestId=owner.requestId,expectedRevision=owner.data.revision;
  setSaving(true,"Updating certificate…");
  try{
    await perform(action,{requestId,expectedRevision,...details});closeCertificate();
    await refreshCredentialOwner(owner);status.textContent=action==="withdraw_good_moral_attestation"?"Office approval withdrawn. A new approval is required.":action==="record_good_moral_attestation"?"Office approval recorded. Prepare the certificate draft.":action==="prepare_enrollment_certificate"?"Draft prepared. Review and mark ready.":action==="issue_enrollment_certificate"?"Institutional certificate issued. Print unsigned copy for authorized signature.":"Certificate revoked.";
  }catch(error){get("sr-certificate-status").textContent=error?.message||"Certificate update failed.";}finally{setSaving(false);}
}
get("sr-certificate-prepare-form").addEventListener("submit",event=>{event.preventDefault();if(event.currentTarget.reportValidity())void mutateCertificate("prepare_enrollment_certificate",{registrationId:get("sr-certificate-registration").value});});
get("sr-good-moral-attest").addEventListener("click",()=>{
  if(saving||!certificateData?.data)return;const registrationId=get("sr-certificate-registration").value;if(!registrationId){get("sr-certificate-status").textContent="Select an eligible registration first.";return;}
  const office=prompt("Authorized approving office:");if(!office?.trim())return;const reference=prompt("Documented approval reference:");if(!reference?.trim())return;
  const reason=prompt("Confirm review of the authorized office approval (at least 12 characters):");if(reason?.trim().length>=12)void mutateCertificate("record_good_moral_attestation",{registrationId,office:office.trim(),reference:reference.trim(),reason:reason.trim(),confirmSourceReviewed:true});
});
get("sr-good-moral-withdraw").addEventListener("click",()=>{
  if(saving||!certificateData?.data)return;const reason=prompt("Document why the authorized office approval is withdrawn (at least 12 characters).");
  if(reason?.trim().length>=12&&confirm("Withdraw approval and invalidate the current draft?"))void mutateCertificate("withdraw_good_moral_attestation",{reason:reason.trim()});
});
get("sr-certificate-issue").addEventListener("click",()=>{
  if(saving||!certificateData?.data)return;const reason=prompt("Confirm institutional release and record the reason (at least 12 characters).");
  if(reason?.trim().length>=12)void mutateCertificate("issue_enrollment_certificate",{reason:reason.trim(),confirmRelease:true});
});
get("sr-certificate-revoke").addEventListener("click",()=>{
  if(saving||!certificateData?.data)return;const reason=prompt("Record the reason for revocation (at least 12 characters).");
  if(reason?.trim().length>=12&&confirm("Revoke this institutional certificate? Its reference and history will be preserved."))void mutateCertificate("revoke_enrollment_certificate",{reason:reason.trim()});
});
get("sr-certificate-print").addEventListener("click",()=>{
  const data=certificateData?.data,c=data?.certificate;if(!c||saving||data.state==="revoked")return;
  const popup=window.open("","_blank");if(!popup){get("sr-certificate-status").textContent="Allow pop-ups to print the certificate.";return;}
  popup.opener=null;const doc=popup.document;doc.title=c.title||"Certificate of Enrollment";
  const style=doc.createElement("style");style.textContent="body{font:15pt Georgia,serif;margin:18mm;color:#111}header{text-align:center;margin-bottom:38px}h1{font-size:22pt}h2{font-size:18pt}p{line-height:1.6}footer{margin-top:60px}small{font:10pt Arial,sans-serif}";doc.head.append(style);
  const add=(host,tag,value)=>{const node=doc.createElement(tag);node.textContent=value;host.append(node);return node;};
  const header=doc.createElement("header");doc.body.append(header);add(header,"h2",c.schoolName);if(c.schoolAddress)add(header,"small",c.schoolAddress);if(c.schoolIdentifier)add(header,"p",c.schoolIdentifier);
  add(header,"h1",c.title||"Certificate of Enrollment");add(header,"small",data.state==="issued"?"UNSIGNED COPY — AUTHORIZED SIGNATURE REQUIRED":"DRAFT — NOT ISSUED");
  const who=c.studentName+(c.studentNumber?" (Student no. "+c.studentNumber+")":""),scope=c.programName+", "+c.sectionName+", for "+c.termName+" of "+c.yearName;
  const statement=c.type==="graduation_certificate"?"This certifies that "+who+" has a recorded graduation decision in "+scope+".":c.type==="transfer_certificate"?"This certifies that "+who+" has a recorded transfer-out from "+scope+".":c.type==="good_moral_certificate"?"Based on documented approval of "+c.attestationOffice+", this certifies the good moral character of "+who+" for the recorded school placement in "+scope+".":"This certifies that "+who+" is recorded as officially enrolled in "+scope+".";
  add(doc.body,"p",statement);
  add(doc.body,"p","Purpose: "+c.purpose);if(data.reference)add(doc.body,"p","Institutional reference: "+data.reference);
  if(data.issuedAt)add(doc.body,"p","Issued: "+fmt(data.issuedAt));
  const footer=doc.createElement("footer");doc.body.append(footer);add(footer,"p","________________________________");add(footer,"strong",c.signatoryName);add(footer,"p",c.signatoryTitle);
  add(doc.body,"small","No digital signature is attached. Confirm the authorized signature and institutional reference with the issuing school.");
  popup.focus();popup.print();
});
function clearVerify(){++verifyRun;get("sr-certificate-reference").value="";get("sr-certificate-verify-result").replaceChildren();}
get("sr-certificate-verify").addEventListener("click",()=>{if(saving)return;clearVerify();get("sr-certificate-verify-dialog").showModal();});
get("sr-certificate-verify-close").addEventListener("click",()=>{clearVerify();get("sr-certificate-verify-dialog").close();});
get("sr-certificate-verify-dialog").addEventListener("cancel",clearVerify);
get("sr-certificate-verify-form").addEventListener("submit",event=>{
  event.preventDefault();if(!event.currentTarget.reportValidity()||saving)return;const run=++verifyRun,reference=get("sr-certificate-reference").value.trim(),host=get("sr-certificate-verify-result");host.textContent="Checking…";
  void (async()=>{try{const data=await perform("verify_enrollment_certificate",{reference});if(run!==verifyRun)return;host.replaceChildren();host.append(textNode("strong",data.state==="recorded"?"Recorded issuance":data.state==="revoked"?"Revoked":"Reference not found"));if(data.state!=="not_found")host.append(textNode("p",[data.studentName,data.yearName,data.termName,fmt(data.issuedAt)].filter(Boolean).join(" · "),"sr-muted"));host.append(textNode("p","Signature verification remains separate.","sr-muted"));}catch(error){if(run===verifyRun)host.textContent=error?.message||"Verification failed.";}})();
});
function renderFile(data){
  get("sr-admission-docs").replaceChildren();
  current=data;const p=data.person;
  fileHost.hidden=false;get("sr-empty-file").hidden=true;get("sr-student-name").textContent=p.displayName;
  get("sr-student-meta").textContent=p.status+" · directory revision "+p.revision;
  get("sr-student-number").textContent=p.studentNumber||"—";get("sr-birth-date").textContent=p.birthDate||"—";
  get("sr-account-state").textContent=p.accountLinked?"Verified student account linked":
    p.accountResponsibility==="guardian"?"Guardian-managed learner":"Student activation pending";
  const schoolQuery="&schoolId="+encodeURIComponent(picker.scope.current.schoolId);
  get("sr-open-people").hidden=!picker.scope.current.roles.includes("school_admin");
  get("sr-open-people").href="people-access.html?personId="+encodeURIComponent(p.personId)+schoolQuery+"#people";
  get("sr-open-enrollment").hidden=picker.scope.current.enrollmentMode!=="canonical";
  get("sr-open-enrollment").href="school-enrollment.html?personId="+encodeURIComponent(p.personId)+schoolQuery;
  renderGuardians(data);renderRegistrations(data);renderGrades(data);renderRequests(data);renderAudit(data);
  renderHistoryControls();showFileView(fileView);renderStudents();
}
async function openStudent(personId,{force=false}={}){
  if(saving&&!force)return;
  if(profileDirty&&!force&&!confirm("Discard unsaved profile changes?"))return;
  clearProfile();resetAcademic();clearReadiness();requestPlacement=null;
  if(current?.person.personId!==personId){fileView="registrations";fileHost.hidden=true;}
  historyBusy=false;const run=++fileRun;status.textContent="Loading student record…";
  try{
    const data=await perform("student_file",{personId});
    if(run!==fileRun)return;
    renderFile(data);setUrlPerson(personId);
    status.textContent=data.person.displayName+" · Record loaded.";
  }catch(error){
    if(run===fileRun){fileHost.hidden=true;get("sr-empty-file").hidden=false;current=null;status.textContent=error?.message||"Student record could not be loaded.";}
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

function closeRequest(){if(saving)return;requestPlacement=null;get("sr-request-dialog").close();}
function openNewRequest(record=null){
  if(!current||saving)return;const form=get("sr-request-form");form.reset();requestPlacement=record?{personId:current.person.personId,registrationId:record.registrationId}:null;
  form.elements.type.value=record?"transfer_certificate":"";get("sr-request-status").textContent="";const placement=get("sr-request-placement");placement.hidden=!record;placement.textContent=record?recordLabel(record):"";get("sr-request-dialog").showModal();
}
get("sr-new-request").addEventListener("click",()=>openNewRequest());
get("sr-request-close").addEventListener("click",closeRequest);
get("sr-request-dialog").addEventListener("cancel",event=>{if(saving)event.preventDefault();else requestPlacement=null;});
get("sr-request-form").addEventListener("submit",event=>{
  event.preventDefault();if(saving||!current||!event.currentTarget.reportValidity())return;
  const data=new FormData(event.currentTarget),personId=current.person.personId;
  void (async()=>{
    setSaving(true,"Creating registrar document request…");
    try{
      const type=String(data.get("type")||"");
      if(requestPlacement&&(requestPlacement.personId!==personId||type!=="transfer_certificate"))throw new Error("Open a new request to select a different document type.");
      await perform("create_document_request",{personId,type,...(requestPlacement?{registrationId:requestPlacement.registrationId}:{}),
        purpose:String(data.get("purpose")||"").trim(),notes:String(data.get("notes")||"").trim()});
      requestPlacement=null;get("sr-request-dialog").close();await openStudent(personId,{force:true});showFileView("documents");status.textContent="Document request created.";
    }catch(error){get("sr-request-status").textContent=error?.message||"Document request was not created.";}
    finally{setSaving(false);}
  })();
});

function openRequestLifecycle(request,nextStatus,fromQueue=false){
  if(saving)return;
  requestLifecycle={request,nextStatus,fromQueue,personId:fromQueue?request.personId:current?.person.personId};
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
  event.preventDefault();if(saving||!requestLifecycle?.personId||!event.currentTarget.reportValidity())return;
  const change=requestLifecycle,data=new FormData(event.currentTarget),personId=change.personId;
  void (async()=>{
    setSaving(true,"Updating document request…");
    try{
      await perform("change_document_request",{requestId:change.request.requestId,
        expectedRevision:Number(change.request.revision)||1,status:change.nextStatus,
        reason:String(data.get("reason")||"").trim(),
        releaseReference:String(data.get("releaseReference")||"").trim()});
      requestLifecycle=null;get("sr-request-lifecycle-dialog").close();
      if(change.fromQueue){
        try{await loadRequestQueue({force:true});}catch{status.textContent="Request updated. Refresh the queue.";}
        if(current?.person.personId===personId){current=null;fileHost.hidden=true;get("sr-empty-file").hidden=false;}
      }else await openStudent(personId,{force:true});
      status.textContent="Document request updated.";
    }catch(error){status.textContent=error?.message||"Document request was not updated.";}
    finally{setSaving(false);}
  })();
});

function renderQueueControls(){
  get("sr-queue-more").hidden=!queueCursor;get("sr-queue-more").disabled=saving||queueBusy;
  get("sr-queue-refresh").disabled=saving||queueBusy;
}
function renderRequestQueue(){
  const host=get("sr-queue-list"),query=String(get("sr-queue-search").value||"").trim().toLowerCase();host.replaceChildren();
  const rows=queueRows.filter(row=>!query||[row.displayName,row.studentNumber,row.label,row.releaseReference].some(value=>String(value||"").toLowerCase().includes(query)));
  if(!rows.length)empty(host,queueCursor?"No matches in loaded requests. Load more.":"No matching requests.");
  for(const row of rows){
    const card=document.createElement("article");card.className="sr-row";
    const info=document.createElement("div");info.append(textNode("strong",row.displayName+(row.studentNumber?" · "+row.studentNumber:"")),
      textNode("p",[row.label,requestStateLabel(row.status),fmt(row.updatedAt||row.requestedAt)].filter(Boolean).join(" · "),"sr-muted"),
      textNode("p",row.purpose||"","sr-muted"));card.append(info);
    const controls=actions();controls.append(button("201 file",{tone:"secondary",onClick:()=>void (async()=>{
      if(saving)return;showRecordsMode("students");await openStudent(row.personId);if(current?.person.personId===row.personId)showFileView("documents");
    })()}));
    if(row.generationMode==="institutional"&&["in_review","ready","released"].includes(row.status))controls.append(button("Certificate",{tone:"secondary",onClick:()=>void openCertificate(row,true)}));
    for(const [label,next,tone] of requestTransitions(row))controls.append(button(label,{tone,onClick:()=>openRequestLifecycle(row,next,true)}));
    card.append(controls);host.append(card);
  }
  get("sr-queue-status").textContent=rows.length+" matching · "+queueRows.length+" loaded"+(queueCursor?" · more requests available":"")+(queueSkipped?" · some requests require identity review":"");renderQueueControls();
}
async function loadRequestQueue({more=false,force=false}={}){
  if((saving&&!force)||(more&&(!queueCursor||queueBusy)))return;
  const run=++queueRun,cursor=more?queueCursor:null,filter=get("sr-queue-filter").value||"open";queueBusy=true;renderQueueControls();
  get("sr-queue-status").textContent="Loading requests…";
  try{
    const result=await perform("list_document_requests",{status:filter,...(cursor?{cursor}:{})});
    if(run!==queueRun)return;
    const rows=new Map((more?queueRows:[]).map(row=>[row.requestId,row]));for(const row of result.items||[])rows.set(row.requestId,row);
    queueRows=[...rows.values()].sort((a,b)=>(b.updatedAt||b.requestedAt||0)-(a.updatedAt||a.requestedAt||0));
    queueCursor=result.nextCursor||null;queueSkipped=(more?queueSkipped:0)+(result.skippedCount||0);renderRequestQueue();
  }catch(error){if(run===queueRun)get("sr-queue-status").textContent=error?.message||"Request queue unavailable.";}
  finally{if(run===queueRun){queueBusy=false;renderQueueControls();}}
}
function showRecordsMode(mode){
  if(saving||!["students","requests"].includes(mode))return;
  if(mode!=="students"&&profileDirty&&!confirm("Discard unsaved profile changes?"))return;
  if(mode!=="students"&&profileDirty)clearProfile();
  recordsMode=mode;workspace.hidden=mode!=="students";get("sr-requests-workspace").hidden=mode!=="requests";
  get("sr-mode-students").setAttribute("aria-pressed",String(mode==="students"));get("sr-mode-requests").setAttribute("aria-pressed",String(mode==="requests"));
  if(mode==="requests")void loadRequestQueue();
}
get("sr-mode-students").addEventListener("click",()=>showRecordsMode("students"));
get("sr-mode-requests").addEventListener("click",()=>showRecordsMode("requests"));
get("sr-queue-refresh").addEventListener("click",()=>void loadRequestQueue());
get("sr-queue-more").addEventListener("click",()=>void loadRequestQueue({more:true}));
get("sr-queue-filter").addEventListener("change",()=>{queueRows=[];queueCursor=null;renderRequestQueue();void loadRequestQueue();});
get("sr-queue-search").addEventListener("input",renderRequestQueue);

get("sr-search-button").addEventListener("click",()=>void searchStudents());
get("sr-more").addEventListener("click",()=>void searchStudents({more:true}));
get("sr-search").addEventListener("input",()=>{get("sr-more").hidden=String(get("sr-search").value||"").trim()!==directoryQuery||!directoryCursor;});
get("sr-search").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();void searchStudents();}});

picker=createTenantSchoolPicker({
  host:get("sr-school-picker"),status,
  onBeforeChange:async()=>{
    if(saving)throw new Error("Finish the current Student Records change before switching schools.");
    if(profileDirty&&!confirm("Discard unsaved profile changes?"))throw new Error("Finish the profile edit before switching schools.");
    if(externalDirty&&!confirm("Discard unsaved source record changes?"))throw new Error("Finish the source record edit before switching schools.");
    clearExternal();
    clearProfile();resetAcademic();clearReadiness();requestPlacement=null;closeCertificate();closeCertificateSettings();clearVerify();clearLrnLookup();
    ++searchRun;++fileRun;requestedPersonId="";requestedQueueStatus="";students=[];current=null;historyBusy=false;fileView="registrations";guardianChange=null;guardianLifecycle=null;requestLifecycle=null;
    directoryCursor=null;directoryQuery="";directoryBusy=false;get("sr-more").hidden=true;get("sr-search-progress").textContent="";
    ++queueRun;queueRows=[];queueCursor=null;queueBusy=false;queueSkipped=0;recordsMode="students";get("sr-requests-workspace").hidden=true;get("sr-workspace-nav").hidden=true;get("sr-queue-list").replaceChildren();get("sr-queue-search").value="";get("sr-queue-filter").value="open";get("sr-queue-status").textContent="";
    setUrlPerson("");get("sr-search").value="";get("sr-student-list").replaceChildren();fileHost.hidden=true;get("sr-empty-file").hidden=false;get("sr-open-people").hidden=true;workspace.hidden=true;
    for(const dialog of document.querySelectorAll("dialog"))if(dialog.open)dialog.close();
  },
  onReady:scope=>{
    const currentScope=scope.current;
    if(!currentScope?.roles.some(role=>["school_admin","registrar"].includes(role))){
      workspace.hidden=true;get("sr-workspace-nav").hidden=true;get("sr-requests-workspace").hidden=true;status.textContent="School Administrator or Registrar access is required for Student Records.";return;
    }
    get("sr-workspace-nav").hidden=false;get("sr-certificate-settings").hidden=!currentScope.roles.includes("school_admin")||currentScope.platformOverride===true;showRecordsMode("students");status.textContent="Select a student.";
    const personId=requestedPersonId,queue=requestedQueueStatus;requestedPersonId="";requestedQueueStatus="";
    if(queue&&(!requestedSchoolId||requestedSchoolId===currentScope.schoolId)){get("sr-queue-filter").value=queue;showRecordsMode("requests");}else void searchStudents();
    if(personId&&requestedSchoolId&&requestedSchoolId!==currentScope.schoolId){
      setUrlPerson("");status.textContent="The linked student belongs to a different school. Select the intended school.";
    }else if(personId&&!current)void openStudent(personId);
  }
});
try{
  await picker.load();
  if(!auth.currentUser)status.textContent="Sign in to use Student Records.";
}catch(error){status.textContent=error?.message||"Student Records access could not be verified.";}
