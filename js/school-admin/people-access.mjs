import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs";
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"peopleDirectory");
const rosterSourceApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolRosterSource");
const get=id=>document.getElementById(id);
const academicsApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
const enrollmentApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolEnrollment");
let schoolPrograms=[],schoolTerms=[],schoolSections=[],schoolOfferings=[];
let workload=null,workloadRun=0,workloadLimit=12,rosterRun=0,inviteRun=0,staffSearchRun=0,detailRun=0,academicRun=0,membershipRun=0,recoverySearchRun=0;
const status=get("school-status"),workspace=get("pa-workspace"),list=get("pa-person-list");
let after=null,loadingPeople=false,pendingWrite=false,peopleReloadQueued=false,peopleRun=0;
let accessChange=null,personChange=null,lifecycleChange=null,invitationChange=null,currentDetailPerson=null,
  currentRosterOfferingId=null,peopleSearchTimer=null,recoverySearchTimer=null,recoveryPreview=null,recoveryCanonicalPersonId=null,
  legacyPlacementReview=null,importRows=[],importDigest=null,importPreview=null,importCommitted=false,linkedStaffById=new Map();
function say(message){status.textContent=message;}
const tabNames=new Set(["overview","people","import","invites","classes","access"]);
const TAB_STATE_KEY="Adminerva_people_access_active_tab";
const requestedPersonId=String(new URL(location.href).searchParams.get("personId")||"");
let requestedPersonSchoolId=null;
let schoolReady=false,canonicalClassMode=false,standardEnrollmentMode=false;
function rememberedTab(){
  const hash=location.hash.slice(1);
  if(tabNames.has(hash))return hash;
  try{
    const saved=sessionStorage.getItem(TAB_STATE_KEY);
    if(tabNames.has(saved))return saved;
  }catch{}
  return "overview";
}
function rememberTab(name){
  try{sessionStorage.setItem(TAB_STATE_KEY,name);}catch{}
}
function activeTab(){return document.querySelector("[data-tab][aria-selected='true']")?.dataset.tab||rememberedTab();}
async function loadSelectedTab(name){
  if(!schoolReady||workspace.hidden)return;
  const task=name==="overview"?loadOverview:
    name==="people"?()=>loadPeople(false):
    name==="import"?()=>Promise.all([loadAcademics(),loadRosterSourceStatus()]):
    name==="invites"?loadInvitePeople:
    name==="classes"?()=>Promise.all([loadAcademics(),loadWorkload()]):
    name==="access"?loadMemberships:null;
  if(!task)return;
  const active=document.querySelector("[data-tab='"+name+"']");
  active?.setAttribute("aria-busy","true");
  try{await task();}catch(error){say(error.message||"This section is temporarily unavailable.");}
  finally{active?.removeAttribute("aria-busy");}
}
function setTab(name,{remember=true}={}) {
  if(name==="classes"&&canonicalClassMode){
    if(get("pa-person-detail-dialog")?.open)get("pa-person-detail-dialog").close();
    location.href="school-classes.html";return;
  }
  const target=tabNames.has(name)?name:"overview";
  for(const button of document.querySelectorAll("[data-tab]")){
    const active=button.dataset.tab===target;
    button.setAttribute("aria-selected",String(active));
    button.setAttribute("aria-controls","pa-"+button.dataset.tab);
    button.tabIndex=active?0:-1;
    get("pa-"+button.dataset.tab).hidden=!active;
  }
  if(remember)rememberTab(target);
  if(schoolReady)void loadSelectedTab(target);
}
const directoryTabs=[...document.querySelectorAll(".pa-tabs [data-tab]")];
directoryTabs.forEach(button=>{
  button.addEventListener("click",()=>setTab(button.dataset.tab));
  button.addEventListener("keydown",event=>{
    const index=directoryTabs.indexOf(button);
    const next=event.key==="ArrowRight"?(index+1)%directoryTabs.length:
      event.key==="ArrowLeft"?(index+directoryTabs.length-1)%directoryTabs.length:
      event.key==="Home"?0:event.key==="End"?directoryTabs.length-1:-1;
    if(next<0)return;
    event.preventDefault();
    setTab(directoryTabs[next].dataset.tab);
    directoryTabs[next].focus();
  });
});
document.querySelectorAll("[data-pa-open-tab]").forEach(button=>{
  button.addEventListener("click",()=>{
    const tab=button.dataset.paOpenTab;
    setTab(tab);
    const target=button.dataset.paFocus?get(button.dataset.paFocus):null;
    requestAnimationFrame(()=>{
      const focusable=target?.matches?.("input,select,button,textarea")?target:
        target?.querySelector?.("input,select,button,textarea");
      focusable?.focus?.();
    });
  });
});
// Use the URL hash only as an initial deep-link hint. Internal tab changes stay
// entirely in-page so the Adminerva shell/navigation never remounts.
setTab(rememberedTab(),{remember:false});
const picker=createTenantSchoolPicker({
  host:get("school-picker-host"),status,
  onBeforeChange:async()=>{
    if(pendingWrite)throw new Error("Finish saving before switching schools.");
    schoolReady=false;++peopleRun;peopleReloadQueued=false;clearTimeout(peopleSearchTimer);clearTimeout(recoverySearchTimer);++recoverySearchRun;recoveryPreview=null;recoveryCanonicalPersonId=null;++workloadRun;++rosterRun;++inviteRun;++staffSearchRun;++detailRun;++academicRun;++membershipRun;workload=null;resetWorkload();
    linkedStaffById=new Map();legacyPlacementReview=null;workspace.hidden=true;list.replaceChildren();get("pa-invitation-result").replaceChildren();get("pa-class-roster").replaceChildren();get("pa-membership-list").replaceChildren();get("pa-invite-person").replaceChildren();get("pa-suspension-dialog").close?.();get("pa-person-dialog").close?.();get("pa-person-detail-dialog").close?.();get("pa-academic-lifecycle-dialog").close?.();accessChange=null;personChange=null;lifecycleChange=null;currentRosterOfferingId=null;after=null;importRows=[];importDigest=null;importPreview=null;importCommitted=false;schoolPrograms=[];schoolTerms=[];schoolSections=[];schoolOfferings=[];get("pa-import-results").replaceChildren();get("pa-import-summary").textContent="No file previewed.";get("pa-import-status").textContent="Choose a CSV with up to 200 people.";get("pa-import-file").value="";get("pa-import-preview").disabled=true;get("pa-import-commit").disabled=true;resetImportCourseMapping();
    get("pa-reconcile-results")?.replaceChildren();for(const id of ["pa-reconcile-integrity","pa-reconcile-attention","pa-reconcile-review","pa-reconcile-total"]){if(get(id))get(id).textContent="—";}if(get("pa-reconcile-status"))get("pa-reconcile-status").textContent="Loading school relationship checks…";
    get("pa-more").hidden=true;
  },
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){
      workspace.hidden=true;say("This school has not granted you directory administration access.");
      return;
    }
    canonicalClassMode=scope.current.compatibilityMode==="v4_only";
    standardEnrollmentMode=scope.current.enrollmentMode==="canonical";
    const classTab=get("pa-tab-classes"),classPanel=get("pa-classes");
    if(classTab)classTab.hidden=canonicalClassMode;
    if(classPanel&&canonicalClassMode)classPanel.hidden=true;
    if(canonicalClassMode&&activeTab()==="classes"){
      location.replace("school-classes.html");return;
    }
    const studentInvite=get("pa-invite-role-student"),inviteForm=get("pa-create-invite");
    if(studentInvite){
      studentInvite.hidden=standardEnrollmentMode;studentInvite.disabled=standardEnrollmentMode;
      if(standardEnrollmentMode&&inviteForm.elements.role.value==="student")
        inviteForm.elements.role.value="teacher";
    }
    if(get("pa-invite-title"))get("pa-invite-title").textContent=
      standardEnrollmentMode?"Create staff invitation":"Create pending invitation";
    if(get("pa-invite-help"))get("pa-invite-help").textContent=standardEnrollmentMode
      ?"Students in this canonical school activate from Enrollment & Registration. Use invitations here for verified Teacher or Registrar staff access."
      :"The invitation is tied to this school person record. Acceptance links the verified account to that person; it still does not create an enrollment or teaching assignment.";
    for(const id of ["pa-student-enrollment-card","pa-bulk-enrollment-card","pa-section-enrollment-card"])
      if(get(id))get(id).hidden=standardEnrollmentMode;
    if(get("pa-classes-help"))get("pa-classes-help").innerHTML=standardEnrollmentMode
      ?'Student enrollment is owned by <a href="school-enrollment.html" style="font-weight:800;text-decoration:underline">Enrollment &amp; Registration</a> for this canonical school. Teaching assignments, teacher load, schedules and roster review are managed in <a href="school-classes.html" style="font-weight:800;text-decoration:underline">Classes &amp; Scheduling</a>.'
      :"Legacy class-relationship tools for compatibility schools. Changes preserve earlier grades and term history.";
    const enrollmentSummary=get("pa-enrollment-summary-link");
    if(enrollmentSummary)enrollmentSummary.href=standardEnrollmentMode?"school-enrollment.html":"people-access.html#classes";
    if(get("pa-enrollment-summary-action"))get("pa-enrollment-summary-action").textContent=standardEnrollmentMode
      ?"Open Enrollment & Registration →":"Manage enrollment relationships →";
    if(get("pa-legacy-requests-help"))get("pa-legacy-requests-help").innerHTML=standardEnrollmentMode
      ?'Pending requests from the older Adminerva directory are reviewed here during consolidation. Approval creates school-wide person and membership records only; student registration continues in <a href="school-enrollment.html" style="font-weight:800;text-decoration:underline">Enrollment &amp; Registration</a>, while teaching assignments are managed in <a href="school-classes.html" style="font-weight:800;text-decoration:underline">Classes &amp; Scheduling</a>.'
      :"Pending requests from the older Adminerva directory are reviewed here during consolidation. Approval creates school-wide person and membership records only; enrollment and teaching relationships remain in this compatibility workflow.";
    if(get("pa-import-course-help"))get("pa-import-course-help").innerHTML=standardEnrollmentMode
      ?'For this canonical school, roster import prepares identity records only. Complete official academic placement in <a href="school-enrollment.html" style="font-weight:800;text-decoration:underline">Enrollment &amp; Registration</a>.'
      :"Section values from the roster are hints only. After the people import is committed, review each matched section, choose the exact active course offering, and explicitly enroll the listed students.";
    workspace.hidden=false;schoolReady=true;
    if(requestedPersonId&&requestedPersonSchoolId!==scope.current.schoolId){
      requestedPersonSchoolId=scope.current.schoolId;
      setTab("people",{remember:false});
      void openPersonDetail({personId:requestedPersonId,displayName:"Student record"});
      return;
    }
    void loadSelectedTab(activeTab());
  }
});
async function performRosterSource(action,details={}){
  const lease=picker.scope.lease();
  const result=(await rosterSourceApi({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);return result;
}
async function loadRosterSourceStatus(){
  const result=await performRosterSource("status");
  const form=get("pa-sheet-source-form");
  form.elements.url.value=result.url||"";
  get("pa-sheet-preview").disabled=!result.configured;
  get("pa-sheet-clear").disabled=!result.configured;
  get("pa-sheet-status").textContent=result.configured?
    "Configured Google Sheets roster source"+(result.gid?" · tab "+result.gid:"")+".":
    "No Google Sheets roster source configured for this school.";
  return result;
}
async function previewImportRows(rows,sourceLabel){
  importRows=rows;importDigest=null;importPreview=null;importCommitted=false;
  get("pa-import-commit").disabled=true;resetImportCourseMapping("Validating section hints after the roster preview…");
  get("pa-import-status").textContent="Validating "+sourceLabel+" against the active school directory…";
  const preview=await perform("preview_import_people",{rows:importRows});
  importPreview=preview;importDigest=preview.digest;renderImportPreview(preview);renderImportCourseMapping();
  const invalid=Number(preview.summary?.invalid||0);
  get("pa-import-commit").disabled=invalid>0||!importDigest;
  get("pa-import-status").textContent=invalid?
    "Resolve invalid or duplicate rows at the source, then preview again.":
    "Preview ready. Committing creates people only; no access or enrollment will be granted.";
  return preview;
}
async function perform(action,details={}) {
  const lease=picker.scope.lease();
  const result=await api({schoolId:lease.schoolId,action,...details});
  picker.scope.assertLease(lease);
  return result.data;
}
async function loadInvitePeople(){
  const form=get("pa-create-invite"),role=String(form.elements.role.value||"student");
  const run=++inviteRun,select=get("pa-invite-person"),previous=select.value;
  const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
  const active=()=>run===inviteRun&&schoolReady&&String(form.elements.role.value||"student")===role;
  select.replaceChildren();
  const loading=document.createElement("option");loading.value="";loading.disabled=true;loading.selected=true;
  loading.textContent="Loading active unlinked "+(role==="student"?"students":"staff")+"…";select.append(loading);
  try{
    const result=await perform("list_invitable_people",{role});
    if(!active())return;
    select.replaceChildren();
    const blank=document.createElement("option");blank.value="";blank.disabled=true;blank.selected=true;
    blank.textContent=result.people?.length?"Choose an active unlinked person":"No matching unlinked person records";
    select.append(blank);
    for(const person of result.people||[]){
      const option=document.createElement("option");option.value=person.personId;option.textContent=person.displayName;
      select.append(option);
    }
    if((result.people||[]).some(person=>person.personId===previous))select.value=previous;
    form.querySelector('button[type="submit"]').disabled=!(result.people||[]).length;
  }catch(error){
    if(!active())return;
    select.replaceChildren();
    const unavailable=document.createElement("option");unavailable.value="";unavailable.disabled=true;unavailable.selected=true;
    unavailable.textContent="Person records unavailable";select.append(unavailable);
    form.querySelector('button[type="submit"]').disabled=true;
    throw error;
  }
}
get("pa-create-invite").elements.role.addEventListener("change",()=>
  void loadInvitePeople().catch(error=>say(error.message||"Invitation person list unavailable.")));


function parseCsv(text){
  const rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else field+=ch;
      continue;
    }
    if(ch==='"'){quoted=true;continue;}
    if(ch===","){row.push(field);field="";continue;}
    if(ch==="\n"){row.push(field);rows.push(row);row=[];field="";continue;}
    if(ch!=="\r")field+=ch;
  }
  if(quoted)throw new Error("CSV has an unclosed quoted field.");
  if(field.length||row.length){row.push(field);rows.push(row);}
  return rows.filter(values=>values.some(value=>String(value).trim()!==""));
}
function normalizeImportHeader(value){
  return String(value||"").trim().toLowerCase().replace(/[\s_-]+/g,"");
}
function importRowsFromCsv(text){
  const matrix=parseCsv(text);
  if(matrix.length<2)throw new Error("CSV needs a header row and at least one person.");
  const supported=new Map([
    ["displayname","displayName"],["firstname","firstName"],["lastname","lastName"],
    ["kind","kind"],["email","email"],["externalid","externalId"],["section","section"]
  ]);
  const headers=matrix[0].map(value=>supported.get(normalizeImportHeader(value))||null);
  if(!headers.includes("displayName")&&!(headers.includes("firstName")||headers.includes("lastName")))
    throw new Error("CSV needs displayName or firstName/lastName columns.");
  if(!headers.includes("email")&&!headers.includes("externalId"))
    throw new Error("CSV needs an email or externalId column for safe duplicate matching.");
  const rows=matrix.slice(1).map(values=>{
    const result={};
    headers.forEach((header,index)=>{if(header)result[header]=String(values[index]??"").trim();});
    return result;
  });
  if(rows.length>200)throw new Error("Import at most 200 people per batch.");
  return rows;
}
function renderImportPreview(preview){
  const host=get("pa-import-results");host.replaceChildren();
  const summary=preview?.summary||{};
  get("pa-import-summary").textContent=
    (summary.rows||0)+" rows · "+(summary.create||0)+" new · "+
    (summary.existing||0)+" already present · "+(summary.invalid||0)+" invalid";
  for(const item of preview?.rows||[]){
    const row=document.createElement("div");row.className="pa-row";row.setAttribute("role","listitem");
    const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p");
    name.textContent=item.displayName||"Unnamed row";
    meta.className="pa-muted";
    const hints=[
      item.kind||"unknown",
      item.email?"email supplied":item.externalId?"external ID supplied":"no identity key",
      item.sectionHint?"section hint: "+item.sectionHint:null,
      item.status==="create"?"will create person":
        item.status==="existing"?"already exists":"invalid"
    ].filter(Boolean);
    meta.textContent=hints.join(" · ");
    info.append(name,meta);
    if(Array.isArray(item.errors)&&item.errors.length){
      const error=document.createElement("p");error.className="pa-muted";
      error.style.color="#9f1239";error.textContent=item.errors.join(" ");
      info.append(error);
    }
    row.append(info);host.append(row);
  }
}
function sectionKey(value){
  return String(value||"").trim().replace(/\s+/g," ").toLocaleLowerCase("en");
}
function resetImportCourseMapping(message="Preview a roster with student section hints to prepare reviewed enrollment groups."){
  get("pa-import-course-groups")?.replaceChildren();
  if(get("pa-import-course-status"))get("pa-import-course-status").textContent=message;
}
function offeringLabel(item){
  return [
    item.sectionName||schoolSections.find(section=>section.id===item.sectionId)?.name||item.sectionId,
    item.subjectName||item.subjectId,
    item.termName||schoolTerms.find(term=>term.id===item.termId)?.name||item.termId,
    item.yearName||item.yearId
  ].filter(Boolean).join(" · ");
}
function renderImportCourseMapping(){
  const host=get("pa-import-course-groups"),statusNode=get("pa-import-course-status");
  if(!host||!statusNode)return;
  host.replaceChildren();
  if(standardEnrollmentMode){
    statusNode.textContent="Roster identities can be imported here. Complete section placement and subject enrollment in Enrollment & Registration.";
    return;
  }
  if(!importPreview){
    statusNode.textContent="Preview a roster with student section hints to prepare reviewed enrollment groups.";
    return;
  }
  const valid=(importPreview.rows||[]).filter(item=>
    item.status!=="invalid"&&(!Array.isArray(item.errors)||item.errors.length===0));
  const students=valid.filter(item=>item.kind==="student"&&item.sectionHint&&item.personId);
  const staffHints=valid.filter(item=>item.kind==="staff"&&item.sectionHint).length;
  if(!students.length){
    statusNode.textContent=staffHints?
      "Staff section hints are advisory only. Invite and verify each teacher account before assigning courses.":
      "This preview has no student section hints to map.";
    return;
  }
  const groups=new Map();
  for(const item of students){
    const key=sectionKey(item.sectionHint);
    if(!groups.has(key))groups.set(key,{hint:item.sectionHint,rows:[]});
    groups.get(key).rows.push(item);
  }
  for(const group of groups.values()){
    const matches=schoolSections.filter(section=>
      section.status==="active"&&sectionKey(section.name)===sectionKey(group.hint));
    const section=matches.length===1?matches[0]:null;
    const offerings=section?schoolOfferings.filter(item=>
      item.status==="active"&&item.sectionId===section.id):[];
    const card=document.createElement("section");card.className="pa-row";card.setAttribute("role","listitem");
    const info=document.createElement("div");
    const title=document.createElement("strong");
    title.textContent=group.hint+" · "+group.rows.length+" student"+(group.rows.length===1?"":"s");
    const detail=document.createElement("p");detail.className="pa-muted";
    if(matches.length>1)detail.textContent="More than one active section has this display name. Resolve the catalog ambiguity in Classes before enrolling.";
    else if(!section)detail.textContent="No exact active section match. The hint remains unapplied.";
    else if(!offerings.length)detail.textContent="Matched section "+section.name+", but it has no active course offering.";
    else detail.textContent="Matched section "+section.name+". Choose the exact subject/term offering; nothing is selected automatically.";
    info.append(title,detail);
    card.append(info);

    if(section&&offerings.length){
      const form=document.createElement("form");
      form.style.cssText="width:100%;margin-top:.65rem";
      const selectLabel=document.createElement("label");selectLabel.textContent="Course offering";
      const select=document.createElement("select");select.className="pa-field";select.required=true;
      const blank=document.createElement("option");blank.value="";blank.disabled=true;blank.selected=true;blank.textContent="Choose the exact offering";
      select.append(blank);
      for(const offering of offerings){
        const option=document.createElement("option");option.value=offering.offeringId;
        option.textContent=offeringLabel(offering)||offering.offeringId;select.append(option);
      }
      selectLabel.append(select);

      const reasonLabel=document.createElement("label");reasonLabel.textContent="Enrollment reason";
      const reason=document.createElement("input");reason.className="pa-field";reason.minLength=12;reason.maxLength=140;
      reason.placeholder="Explain this reviewed roster-to-course enrollment";reason.required=true;
      reasonLabel.append(reason);

      const button=document.createElement("button");button.type="submit";button.className="pa-action";
      button.textContent="Enroll "+group.rows.length+" reviewed student"+(group.rows.length===1?"":"s");
      button.disabled=!importCommitted||group.rows.length>80;
      form.append(selectLabel,reasonLabel,button);
      if(group.rows.length>80){
        const limit=document.createElement("p");limit.className="pa-muted";
        limit.textContent="This section group exceeds the 80-student reviewed bulk limit. Use the Classes bulk enrollment tool in smaller groups.";
        form.append(limit);
      }else if(!importCommitted){
        const pending=document.createElement("p");pending.className="pa-muted";
        pending.textContent="Commit this exact people preview before enrollment controls become available.";
        form.append(pending);
      }
      form.addEventListener("submit",event=>{
        event.preventDefault();
        if(pendingWrite||!importCommitted)return;
        const offeringId=String(select.value||""),reasonText=String(reason.value||"").trim();
        if(!offeringId){statusNode.textContent="Choose an exact course offering for "+group.hint+".";return;}
        if(reasonText.length<12){statusNode.textContent="Enter an enrollment reason of at least 12 characters.";return;}
        const personIds=[...new Set(group.rows.map(item=>item.personId))];
        if(personIds.length>80){statusNode.textContent="This reviewed group exceeds the safe bulk enrollment limit.";return;}
        if(!confirm("Enroll "+personIds.length+" reviewed student(s) from section hint “"+group.hint+"” into the selected course offering? Existing active enrollments will be skipped and ended history will not be restored."))return;
        void (async()=>{
          pendingWrite=true;button.disabled=true;
          statusNode.textContent="Applying the reviewed "+group.hint+" enrollment…";
          try{
            const result=await performAcademic("bulk_enroll_students",{personIds,offeringId,reason:reasonText});
            await Promise.all([loadAcademics(),loadOverview()]);
            renderImportCourseMapping();
            statusNode.textContent="Reviewed enrollment complete: "+result.created+" created · "+
              result.alreadyActive+" already active · "+result.historyExists+" historical enrollment(s) left unchanged.";
          }catch(error){
            statusNode.textContent=error?.message||"Reviewed import enrollment was not saved.";
            button.disabled=false;
          }finally{pendingWrite=false;}
        })();
      });
      card.append(form);
    }
    host.append(card);
  }
  if(!importCommitted){
    statusNode.textContent="Section groups are advisory. Commit the exact people preview before any reviewed enrollment can be applied.";
  }else if(staffHints){
    statusNode.textContent="Student section groups are ready for review. Staff section hints remain unapplied until verified teacher memberships exist.";
  }else{
    statusNode.textContent="People import committed. Review each section group and explicitly choose a course offering before enrolling.";
  }
}
get("pa-sheet-source-form").addEventListener("submit",event=>{
  event.preventDefault();if(pendingWrite)return;
  const form=event.currentTarget,values=new FormData(form);
  void (async()=>{
    pendingWrite=true;
    const controls=[...form.querySelectorAll("button,input")];controls.forEach(control=>control.disabled=true);
    get("pa-sheet-status").textContent="Validating and saving this school roster source…";
    try{
      const result=await performRosterSource("configure",{
        url:String(values.get("url")||"").trim(),
        reason:String(values.get("reason")||"").trim()
      });
      form.elements.url.value=result.url||"";
      form.elements.reason.value="";
      get("pa-sheet-preview").disabled=false;get("pa-sheet-clear").disabled=false;
      get("pa-sheet-status").textContent="Google Sheets roster source saved for this school.";
    }catch(error){get("pa-sheet-status").textContent=error?.message||"Roster source was not saved.";}
    finally{
      pendingWrite=false;
      controls.forEach(control=>control.disabled=false);
      const configured=Boolean(form.elements.url.value);
      get("pa-sheet-preview").disabled=!configured;get("pa-sheet-clear").disabled=!configured;
    }
  })();
});
get("pa-sheet-preview").addEventListener("click",()=>{
  if(pendingWrite)return;
  void (async()=>{
    const button=get("pa-sheet-preview");button.disabled=true;get("pa-import-commit").disabled=true;
    get("pa-sheet-status").textContent="Fetching the configured published Google Sheet…";
    try{
      const result=await performRosterSource("fetch_csv");
      const rows=importRowsFromCsv(result.csv);
      await previewImportRows(rows,"the configured Google Sheet");
      get("pa-sheet-status").textContent="Google Sheet fetched and previewed. Review the rows before committing.";
    }catch(error){
      importRows=[];importDigest=null;importPreview=null;importCommitted=false;resetImportCourseMapping();
      get("pa-import-results").replaceChildren();get("pa-import-summary").textContent="Preview failed.";
      get("pa-sheet-status").textContent=error?.message||"The configured Google Sheet could not be previewed.";
    }finally{button.disabled=false;}
  })();
});
get("pa-sheet-clear").addEventListener("click",()=>{
  if(pendingWrite)return;
  const reason=prompt("Explain why this school roster source is being removed:");
  if(reason===null)return;
  void (async()=>{
    pendingWrite=true;get("pa-sheet-clear").disabled=true;get("pa-sheet-preview").disabled=true;
    try{
      await performRosterSource("clear",{reason:String(reason).trim()});
      get("pa-sheet-source-form").reset();
      get("pa-sheet-status").textContent="Google Sheets roster source cleared for this school.";
    }catch(error){
      get("pa-sheet-status").textContent=error?.message||"Roster source was not cleared.";
      await loadRosterSourceStatus().catch(()=>{});
    }finally{pendingWrite=false;}
  })();
});
get("pa-import-file").addEventListener("change",event=>{
  importRows=[];importDigest=null;importPreview=null;importCommitted=false;resetImportCourseMapping();
  get("pa-import-results").replaceChildren();get("pa-import-summary").textContent="No file previewed.";
  get("pa-import-commit").disabled=true;
  const file=event.target.files?.[0]||null;
  get("pa-import-preview").disabled=!file;
  get("pa-import-status").textContent=file?
    file.name+" selected. Preview before committing.":"Choose a CSV with up to 200 people.";
});
get("pa-import-template").addEventListener("click",event=>{
  event.preventDefault();
  const csv="email,firstName,lastName,section,kind,externalId\nstudent@example.edu,Ana,Santos,Grade 11 ICT A,student,MCS-0001\n";
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");link.href=url;link.download="adminerva-v4-people-import-template.csv";
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
});
get("pa-import-preview").addEventListener("click",()=>{
  if(pendingWrite)return;
  const file=get("pa-import-file").files?.[0];
  if(!file)return;
  void (async()=>{
    if(file.size>512000)throw new Error("CSV is larger than 500 KB.");
    get("pa-import-preview").disabled=true;get("pa-import-commit").disabled=true;
    get("pa-import-status").textContent="Validating this CSV against the active school directory…";
    try{
      importRows=importRowsFromCsv(await file.text());
      await previewImportRows(importRows,"this CSV");
    }catch(error){
      importRows=[];importDigest=null;importPreview=null;importCommitted=false;resetImportCourseMapping();
      get("pa-import-results").replaceChildren();get("pa-import-summary").textContent="Preview failed.";
      get("pa-import-status").textContent=error?.message||"The CSV could not be previewed.";
    }finally{get("pa-import-preview").disabled=!get("pa-import-file").files?.length;}
  })().catch(error=>{get("pa-import-status").textContent=error?.message||"The CSV could not be previewed.";});
});
get("pa-import-commit").addEventListener("click",()=>{
  if(pendingWrite||!importDigest||!importRows.length)return;
  if(!confirm("Create the previewed school person records? This does not grant accounts, memberships, enrollments, teaching assignments, or grades."))return;
  void (async()=>{
    pendingWrite=true;get("pa-import-preview").disabled=true;get("pa-import-commit").disabled=true;
    get("pa-import-status").textContent="Committing the exact reviewed CSV preview…";
    try{
      const result=await perform("commit_import_people",{rows:importRows,expectedDigest:importDigest});
      get("pa-import-status").textContent=result.alreadyCommitted?
        "This exact import was already committed. No duplicate people were created.":
        "Import committed: "+result.created+" people created · "+result.skipped+" already present.";
      importCommitted=true;importDigest=null;
      await Promise.all([loadPeople(false),loadOverview(),loadInvitePeople(),loadAcademics()]);
      renderImportCourseMapping();
    }catch(error){
      get("pa-import-status").textContent=error?.message||"Import was not committed. Preview the file again before retrying.";
      get("pa-import-commit").disabled=false;
    }finally{
      pendingWrite=false;get("pa-import-preview").disabled=!get("pa-import-file").files?.length;
    }
  })();
});

async function performAcademic(action,details={}){
  const lease=picker.scope.lease();
  const response=(await academicsApi({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);
  return response;
}
async function performEnrollment(action,details={}){
  const lease=picker.scope.lease();
  const response=(await enrollmentApi({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);
  return response;
}
function populateOptions(selector,items,idField,nameField="name"){
  const controls=[...document.querySelectorAll(selector)];
  for(const control of controls){
    const previous=control.value;control.replaceChildren();
    const blank=document.createElement("option");
    blank.value="";blank.textContent="Choose an option";blank.disabled=true;
    blank.selected=true;control.append(blank);
    for(const item of items){
      const option=document.createElement("option");
      option.value=item[idField];
      option.textContent=item[nameField]||item[idField];
      control.append(option);
    }
    if(items.some(item=>item[idField]===previous))control.value=previous;
  }
}
function populateMultiOptions(selector,items,idField,nameField="name"){
  for(const control of document.querySelectorAll(selector)){
    const selected=new Set([...control.selectedOptions].map(option=>option.value));
    control.replaceChildren();
    for(const item of items){
      const option=document.createElement("option");
      option.value=item[idField];option.textContent=item[nameField]||item[idField];
      option.selected=selected.has(option.value);control.append(option);
    }
  }
}
function renderSectionAssignmentOfferings(){
  const form=get("pa-section-assignment-form"),host=get("pa-section-offering-list");
  if(!form||!host)return;
  const sectionId=String(form.elements.sectionId.value||"");
  const offerings=schoolOfferings.filter(item=>item.sectionId===sectionId)
    .map(item=>({...item,label:offeringLabel(item)}))
    .sort((a,b)=>a.label.localeCompare(b.label));
  host.replaceChildren();
  for(const offering of offerings){
    const label=document.createElement("label");
    label.style.cssText="display:flex;align-items:flex-start;gap:.55rem;padding:.55rem .65rem;border:1px solid #cbd5e1;border-radius:10px;background:#fff;cursor:pointer";
    const checkbox=document.createElement("input");
    checkbox.type="checkbox";checkbox.name="offeringIds";checkbox.value=offering.offeringId;
    checkbox.style.cssText="width:18px;height:18px;margin-top:.1rem;flex:0 0 auto";
    const text=document.createElement("span");text.textContent=offering.label;
    label.append(checkbox,text);host.append(label);
  }
  const help=get("pa-section-assignment-help");
  if(help)help.textContent=!sectionId
    ?"Choose a section to see its active subject offerings. Select only the classes this teacher actually handles."
    :offerings.length
      ?offerings.length+" active class"+(offerings.length===1?"":"es")+" available in this section. Tap each subject/period class this teacher handles."
      :"This section has no active course offerings yet. Configure its subjects and periods first.";
}
function workloadNode(tag,text,className=""){
  const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;
}
function workloadButton(label,handler){
  const button=workloadNode("button",label,"pa-action");button.type="button";button.addEventListener("click",handler);return button;
}
function resetWorkload(){
  get("pa-workload-list")?.replaceChildren();
  for(const key of ["teachers","classes","unstaffed","idle"])if(get("pa-workload-"+key))get("pa-workload-"+key).textContent="—";
  if(get("pa-workload-more"))get("pa-workload-more").hidden=true;
  if(get("pa-workload-status"))get("pa-workload-status").textContent="Waiting for verified school access…";
  for(const [key,label] of [["year","All years"],["term","All periods"]])get("pa-workload-"+key)?.replaceChildren(new Option(label,""));
}
function workloadOptions(key,rows,id,name,placeholder){
  const select=get("pa-workload-"+key),previous=select.value;
  const options=new Map(rows.filter(row=>row[id]).map(row=>[row[id],row[name]||row[id]]));
  select.replaceChildren(new Option(placeholder,""));
  for(const [value,label] of [...options].sort((a,b)=>String(a[1]).localeCompare(String(b[1]))))select.add(new Option(label,value));
  if(options.has(previous))select.value=previous;
}
function workloadLabel(row){return [row.subjectName,row.sectionName,row.termName,row.yearName].filter(Boolean).join(" · ");}
function openWorkloadRoster(row){
  if(!schoolReady||pendingWrite)return;
  const form=get("pa-roster-form"),select=form.elements.offeringId;
  if(![...select.options].some(option=>option.value===row.offeringId))select.add(new Option(workloadLabel(row),row.offeringId));
  select.value=row.offeringId;form.scrollIntoView({behavior:"smooth",block:"start"});
  void loadClassRoster(row.offeringId).catch(error=>say(error.message||"Roster unavailable."));
}
function openWorkloadAssignment(teacher){
  if(!schoolReady||pendingWrite)return;
  const form=get("pa-section-assignment-form"),select=form.elements.teacherUid;
  if(![...select.options].some(option=>option.value===teacher.uid))select.add(new Option(teacher.name,teacher.uid));
  select.value=teacher.uid;form.closest("details").open=true;form.scrollIntoView({behavior:"smooth",block:"start"});form.elements.sectionId.focus({preventScroll:true});
}
function renderWorkload(){
  const host=get("pa-workload-list"),more=get("pa-workload-more");host.replaceChildren();more.hidden=true;
  if(!workload){host.append(workloadNode("p","Workload data is not available.","pa-muted"));return;}
  const year=get("pa-workload-year").value,term=get("pa-workload-term").value;
  const rows=(workload.offerings||[]).filter(row=>(!year||row.yearId===year)&&(!term||row.termId===term));
  const teachers=workload.teachers||[],teacherMap=new Map(teachers.map(t=>[t.uid,t.name])),byTeacher=new Map(teachers.map(t=>[t.uid,[]]));
  for(const row of rows)for(const uid of row.teacherUids||[])byTeacher.get(uid)?.push(row);
  const idle=teachers.filter(t=>!byTeacher.get(t.uid)?.length),unstaffed=rows.filter(row=>!row.teacherUids?.length);
  for(const [key,count] of [["teachers",teachers.length],["classes",rows.length],["unstaffed",unstaffed.length],["idle",idle.length]])get("pa-workload-"+key).textContent=String(count);
  const query=get("pa-workload-search").value.trim().toLocaleLowerCase(),matches=values=>!query||values.some(value=>String(value||"").toLocaleLowerCase().includes(query));
  const mode=get("pa-workload-mode").value;let results;
  if(mode==="teachers"||mode==="idle"){
    results=(mode==="idle"?idle:teachers).filter(t=>matches([t.name,...(byTeacher.get(t.uid)||[]).map(workloadLabel)])).sort((a,b)=>a.name.localeCompare(b.name));
    for(const teacher of results.slice(0,workloadLimit)){
      const classes=(byTeacher.get(teacher.uid)||[]).slice().sort((a,b)=>workloadLabel(a).localeCompare(workloadLabel(b)));
      const card=document.createElement("div");card.className="border rounded-xl p-3 mb-2";card.setAttribute("role","listitem");
      const header=document.createElement("div");header.className="flex flex-wrap gap-2 items-center justify-between";
      const summary=document.createElement("div");summary.append(workloadNode("strong",teacher.name),workloadNode("p",classes.length+" class offering(s) · "+new Set(classes.map(row=>row.sectionId)).size+" section(s)","pa-muted"));
      header.append(summary,workloadButton("Assign classes",()=>openWorkloadAssignment(teacher)));card.append(header);
      if(classes.length){
        const details=document.createElement("details");details.className="mt-2";details.append(workloadNode("summary","View assigned classes","font-semibold cursor-pointer"));
        for(const row of classes){const entry=document.createElement("div");entry.className="pa-row";entry.append(workloadNode("span",workloadLabel(row)),workloadButton("View roster",()=>openWorkloadRoster(row)));details.append(entry);}
        card.append(details);
      }
      host.append(card);
    }
  }else{
    results=(mode==="unstaffed"?unstaffed:rows).filter(row=>matches([workloadLabel(row),row.programName,...(row.teacherUids||[]).map(uid=>teacherMap.get(uid))])).sort((a,b)=>workloadLabel(a).localeCompare(workloadLabel(b)));
    for(const row of results.slice(0,workloadLimit)){
      const card=document.createElement("div");card.className="pa-row";card.setAttribute("role","listitem");
      const info=document.createElement("div");info.className="min-w-0";
      info.append(workloadNode("strong",workloadLabel(row)),workloadNode("p",(row.teacherUids||[]).map(uid=>teacherMap.get(uid)||"Teacher").join(", ")||"No verified active teacher","pa-muted"));
      if(row.invalidGrantCount)info.append(workloadNode("p",row.invalidGrantCount+" active grant(s) need access review.","pa-muted"));
      card.append(info,workloadButton("View roster",()=>openWorkloadRoster(row)));host.append(card);
    }
  }
  if(!results.length)host.append(workloadNode("p","No records match these filters.","pa-muted"));
  more.hidden=results.length<=workloadLimit;
  const invalid=rows.reduce((sum,row)=>sum+(row.invalidGrantCount||0),0);
  get("pa-workload-status").textContent="Showing "+Math.min(results.length,workloadLimit)+" of "+results.length+" matching records."+(invalid||workload.unmatchedGrants?" Staffing review: "+invalid+" invalid active grant(s) in this selection; "+(workload.unmatchedGrants||0)+" grant(s) reference inactive or missing offerings school-wide.":"");
}
function refreshWorkloadTerms(){workloadOptions("term",(workload?.offerings||[]).filter(row=>!get("pa-workload-year").value||row.yearId===get("pa-workload-year").value),"termId","termName","All periods");}
async function loadWorkload(){
  if(!schoolReady||!get("pa-workload"))return;
  const run=++workloadRun,button=get("pa-workload-refresh");button.disabled=true;get("pa-workload-status").textContent="Loading faculty workload…";
  try{
    const result=await performAcademic("faculty_workload");if(run!==workloadRun)return;
    workload=result;workloadLimit=12;workloadOptions("year",result.offerings||[],"yearId","yearName","All years");refreshWorkloadTerms();renderWorkload();
  }catch(error){
    if(run!==workloadRun)return;
    workload=null;resetWorkload();get("pa-workload-status").textContent=error?.message||"Faculty workload unavailable.";
  }finally{if(run===workloadRun)button.disabled=false;}
}
get("pa-workload-refresh")?.addEventListener("click",()=>void loadWorkload());
get("pa-workload-year")?.addEventListener("change",()=>{refreshWorkloadTerms();workloadLimit=12;renderWorkload();});
for(const key of ["term","mode","search"])get("pa-workload-"+key)?.addEventListener(key==="search"?"input":"change",()=>{workloadLimit=12;renderWorkload();});
get("pa-workload-more")?.addEventListener("click",()=>{workloadLimit+=12;renderWorkload();});
async function loadAcademics(){
  if(!schoolReady)return;
  const run=++academicRun;
  const kinds=["academic_programs","academic_years","terms","subjects","sections"];
  const [catalogs,offerings,people,teachers]=await Promise.all([
    Promise.all(kinds.map(kind=>performAcademic("list_catalog",{kind}))),
    performAcademic("planning_options"),
    Promise.resolve({students:[]}),
    performAcademic("list_teachers")
  ]);
  if(run!==academicRun||!schoolReady)return;
  for(let i=0;i<kinds.length;i++){
    const items=catalogs[i].items||[];
    if(kinds[i]==="academic_programs")schoolPrograms=items;
    if(kinds[i]==="terms"){schoolTerms=items;continue;}
    if(kinds[i]==="sections"){schoolSections=items;continue;}
    populateOptions('[data-catalog="'+kinds[i]+'"]',items,"id");
  }
  populateOptions('[data-catalog="academic_programs"]',schoolPrograms,"id");
  schoolOfferings=(offerings.offerings||[]).map(item=>({...item,status:"active"}));
  const labeledOfferings=schoolOfferings.map(item=>({...item,label:offeringLabel(item)}))
    .sort((a,b)=>a.label.localeCompare(b.label));
  populateOptions("[data-offering]",labeledOfferings,"offeringId","label");
  populateOptions("[data-assignment-section]",schoolSections.filter(item=>item.status==="active"),"id");
  populateOptions("#pa-section-enrollment-year",catalogs[1].items.filter(row=>row.status==="active"),"id");
  refreshStudentSectionPicker();
  // The large directory uses server-side student search, not a 100-record picker.
  if(!get("pa-class-student-search")?.value.trim())populateOptions("[data-student-person]",[],"personId");
  populateOptions("[data-school-teacher]",teachers.teachers||[],"uid");
  populateMultiOptions("[data-student-person-bulk]",people.students||[],"personId");
  populateMultiOptions("[data-school-teacher-bulk]",teachers.teachers||[],"uid");
  renderSectionAssignmentOfferings();
  renderImportCourseMapping();
  if(people.unavailable)say(people.unavailable+" Teaching and class controls remain available.");
}

function refreshStudentSectionPicker(){
  const form=get("pa-section-enrollment-form");
  if(!form)return;
  const yearId=form.elements.yearId.value;
  const termSelect=form.elements.termId,sectionSelect=form.elements.sectionId;
  const oldTerm=termSelect.value,oldSection=sectionSelect.value;
  const terms=schoolTerms.filter(row=>row.status==="active"&&row.yearId===yearId);
  termSelect.replaceChildren(new Option("Choose academic period",""));
  for(const row of terms)termSelect.add(new Option(row.name,row.id));
  if(terms.some(row=>row.id===oldTerm))termSelect.value=oldTerm;
  const term=terms.find(row=>row.id===termSelect.value);
  const sections=schoolSections.filter(row=>row.status==="active"&&
    (!term||row.programId===term.programId));
  sectionSelect.replaceChildren(new Option("Choose section",""));
  for(const row of sections)sectionSelect.add(new Option(row.name,row.id));
  if(sections.some(row=>row.id===oldSection))sectionSelect.value=oldSection;
  refreshStudentSectionPreview();
}
function refreshStudentSectionPreview(){
  const form=get("pa-section-enrollment-form");
  if(!form)return;
  const {yearId,termId,sectionId}=form.elements;
  const term=schoolTerms.find(row=>row.id===termId.value);
  const section=schoolSections.find(row=>row.id===sectionId.value);
  const matches=schoolOfferings.filter(row=>row.status==="active"&&
    row.yearId===yearId.value&&row.termId===termId.value&&
    row.sectionId===sectionId.value&&term?.programId===section?.programId);
  const info=get("pa-section-enrollment-preview");
  info.textContent=!yearId.value||!termId.value||!sectionId.value
    ?"Choose an academic year, period and section to preview the subjects."
    :matches.length
      ?matches.length+" active subject offering(s) will be added for "+section.name+". Existing active enrollments are preserved."
      :"No active subjects match this placement. Configure course offerings first.";
  form.querySelector('button[type="submit"]').disabled=!matches.length;
}
let classStudentSearchRun=0,classStudentSearchTimer=null;
get("pa-class-student-search")?.addEventListener("input",event=>{
  clearTimeout(classStudentSearchTimer);
  const query=event.currentTarget.value.trim();
  const select=get("pa-section-enrollment-form").elements.personId;
  select.replaceChildren(new Option(query?"Searching…":"Search for a student above",""));
  const run=++classStudentSearchRun;
  if(query.length<2)return;
  classStudentSearchTimer=setTimeout(()=>{
    void perform("search_people",{query,kind:"student",status:"active"})
      .then(result=>{
        if(run!==classStudentSearchRun)return;
        select.replaceChildren(new Option("Choose a matching student",""));
        for(const row of result.items||[])
          select.add(new Option(row.displayName+(row.studentNumber?" · "+row.studentNumber:""),row.personId));
        if(!result.items?.length)select.options[0].textContent="No matching students";
      }).catch(error=>{if(run===classStudentSearchRun)say(error.message||"Student search failed.");});
  },250);
});
get("pa-section-enrollment-year")?.addEventListener("change",refreshStudentSectionPicker);
get("pa-section-enrollment-term")?.addEventListener("change",refreshStudentSectionPicker);
get("pa-section-enrollment-section")?.addEventListener("change",refreshStudentSectionPreview);
get("pa-section-enrollment-form")?.addEventListener("submit",event=>{
  event.preventDefault();
  const form=event.currentTarget,d=new FormData(form);
  const personId=String(d.get("personId")||""),sectionId=String(d.get("sectionId")||""),
    yearId=String(d.get("yearId")||""),termId=String(d.get("termId")||""),
    reason=String(d.get("reason")||"").trim();
  if(!personId||!sectionId||!yearId||!termId||reason.length<12){say("Select a student and complete the section placement.");return;}
  if(!confirm("Assign this existing student to the selected section and enroll all active subjects for the academic period?"))return;
  void submitAcademic(form,"enroll_student_section",{personId,sectionId,yearId,termId,reason},
    "Existing student assigned to section and matching active subjects. No new account was created.")
    .then(result=>{
      if(result)say("Section placement saved · "+result.created+" subject enrollment(s) added · "+
        result.alreadyActive+" already active.");
    });
});
get("pa-bulk-enrollment-form").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget;
  const personIds=[...form.elements.personIds.selectedOptions].map(option=>option.value);
  const offeringId=String(form.elements.offeringId.value||"");
  const reason=String(form.elements.reason.value||"").trim();
  if(!personIds.length){say("Select at least one student for bulk enrollment.");return;}
  if(!confirm("Enroll "+personIds.length+" selected student(s) into this course offering? Existing active enrollments will be skipped."))return;
  void submitAcademic(form,"bulk_enroll_students",{personIds,offeringId,reason},
    "Bulk enrollment completed. Existing history was preserved.");
});
get("pa-section-assignment-form")?.elements.sectionId.addEventListener("change",renderSectionAssignmentOfferings);
get("pa-section-assignment-form")?.addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget;
  const teacherUid=String(form.elements.teacherUid.value||""),
    sectionId=String(form.elements.sectionId.value||""),
    offeringIds=[...form.querySelectorAll('input[name="offeringIds"]:checked')].map(input=>input.value),
    reason=String(form.elements.reason.value||"").trim();
  if(!teacherUid||!sectionId){say("Choose a verified teacher and section.");return;}
  if(!offeringIds.length){say("Select at least one class or subject offering in this section.");return;}
  if(!confirm("Assign this teacher to "+offeringIds.length+" selected class"+(offeringIds.length===1?"":"es")+" in the section? Existing active assignments will be skipped."))return;
  void submitAcademic(form,"assign_teacher_section",{teacherUid,sectionId,offeringIds,reason},
    "Section teaching assignments saved.").then(result=>{
      if(!result)return;
      say("Section assignment complete · "+result.created+" created · "+result.alreadyActive+
        " already active · "+result.historyExists+" ended assignment"+(result.historyExists===1?"":"s")+" left unchanged.");
    });
});
get("pa-bulk-assignment-form").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget;
  const teacherUids=[...form.elements.teacherUids.selectedOptions].map(option=>option.value);
  const offeringId=String(form.elements.offeringId.value||"");
  const reason=String(form.elements.reason.value||"").trim();
  if(!teacherUids.length){say("Select at least one teacher for bulk assignment.");return;}
  if(!confirm("Assign "+teacherUids.length+" selected teacher(s) to this course offering? Existing active assignments will be skipped."))return;
  void submitAcademic(form,"bulk_assign_teachers",{teacherUids,offeringId,reason},
    "Bulk teacher assignment completed. Existing history was preserved.");
});
async function submitAcademic(form,action,fields,message){
  if(pendingWrite)return;
  pendingWrite=true;
  const button=form.querySelector('button[type="submit"]');
  button.disabled=true;say("Saving academic records for your school…");
  try{
    const result=await performAcademic(action,fields);
    form.reset();
    const refreshes=await Promise.allSettled([loadAcademics(),loadWorkload()]);
    say(message+(refreshes.some(item=>item.status==="rejected")?" Some records could not refresh; reload before another change.":""));
    return result||true;
  }catch(error){say(error?.message||"Academic operation was not saved.");return false;}
  finally{pendingWrite=false;button.disabled=false;}
}
get("pa-enrollment-form").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget,d=new FormData(form);
  void submitAcademic(form,"enroll_student",{
    personId:String(d.get("personId")||""),offeringId:String(d.get("offeringId")||"")
  },"Student enrollment created; previous academic history remains unchanged.");
});
get("pa-assignment-form").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget,d=new FormData(form);
  void submitAcademic(form,"assign_teacher",{
    teacherUid:String(d.get("teacherUid")||""),offeringId:String(d.get("offeringId")||"")
  },"Teaching assignment created. Private teacher resources remain private.");
});
get("pa-handover-form").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget,d=new FormData(form),
    offeringId=String(d.get("offeringId")||""),
    fromTeacherUid=String(d.get("fromTeacherUid")||""),
    toTeacherUid=String(d.get("toTeacherUid")||""),
    reason=String(d.get("reason")||"").trim();
  if(fromTeacherUid===toTeacherUid){say("Choose a different replacement teacher.");return;}
  void (async()=>{
    let reviewed;
    try{reviewed=await performAcademic("class_roster",{offeringId});}
    catch(error){say(error?.message||"Refresh the class roster before handover.");return;}
    const fromAssignment=(reviewed.teachers||[]).find(row=>row.teacherUid===fromTeacherUid&&row.status==="active")||null,
      toAssignment=(reviewed.teachers||[]).find(row=>row.teacherUid===toTeacherUid)||null;
    if(!fromAssignment){say("The current teacher assignment changed. Refresh the class roster before handover.");return;}
    if(!confirm("Transfer this class to the replacement teacher? The current assignment will end and existing deployed assessment review responsibility will move. Private teacher resources will NOT transfer."))return;
    const result=await submitAcademic(form,"handover_offering",{
      offeringId,fromTeacherUid,toTeacherUid,
      expectedOfferingRevision:Number(reviewed.offeringRevision)||1,
      expectedFromRevision:Number(fromAssignment.revision)||1,
      expectedToRevision:toAssignment?(Number(toAssignment.revision)||1):0,reason
    },"Teacher handover completed. Private teacher resources kept their original ownership.");
    if(!result)return;
    say("Teacher handover completed · "+Number(result.assessmentCount||0)+
      " deployed assessment review responsibilit"+(Number(result.assessmentCount||0)===1?"y":"ies")+
      " transferred. Private resources were not transferred.");
    if(currentRosterOfferingId===offeringId)
      void loadClassRoster(offeringId).catch(error=>say(error.message||"Refresh class roster."));
  })();
});
function lifecycleButton(label,action,details,targetName){
  const button=document.createElement("button");button.type="button";button.className="pa-action";
  button.style.background=action.startsWith("end_")?"#9a3412":"#166534";
  button.textContent=label;
  button.addEventListener("click",()=>{
    lifecycleChange={action,details,targetName};
    get("pa-academic-lifecycle-title").textContent=
      action.startsWith("end_")?"End class membership":"Restore class membership";
    get("pa-academic-lifecycle-target").textContent=targetName;
    get("pa-academic-lifecycle-form").reset();
    get("pa-academic-lifecycle-dialog").showModal();
  });
  return button;
}
async function loadClassRoster(offeringId){
  const target=get("pa-class-roster");
  const run=++rosterRun;
  currentRosterOfferingId=offeringId;target.replaceChildren();say("Loading class roster…");
  const result=await performAcademic("class_roster",{offeringId});
  if(run!==rosterRun||currentRosterOfferingId!==offeringId)return;
  const studentHeading=document.createElement("h3");
  studentHeading.style.cssText="font-weight:750;margin-top:.75rem";
  studentHeading.textContent="Students";target.append(studentHeading);
  const students=result.students||[];
  if(!students.length){const empty=document.createElement("p");empty.className="pa-muted";
    empty.textContent="No student enrollment history for this offering.";target.append(empty);}
  for(const student of students){
    const row=document.createElement("div");row.className="pa-row";row.setAttribute("role","listitem");
    const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p");
    name.textContent=student.name;meta.className="pa-muted";meta.textContent="Enrollment · "+student.status;
    info.append(name,meta);row.append(info);
    row.append(student.status==="active"?
      lifecycleButton("End enrollment","end_enrollment",{
        enrollmentId:student.enrollmentId,expectedRevision:Number(student.revision)||1
      },student.name):
      lifecycleButton("Restore enrollment","restore_enrollment",{
        enrollmentId:student.enrollmentId,expectedRevision:Number(student.revision)||1
      },student.name));
    target.append(row);
  }
  const teacherHeading=document.createElement("h3");
  teacherHeading.style.cssText="font-weight:750;margin-top:1rem";
  teacherHeading.textContent="Teaching assignments";target.append(teacherHeading);
  const teachers=result.teachers||[];
  if(!teachers.length){const empty=document.createElement("p");empty.className="pa-muted";
    empty.textContent="No teaching assignment history for this offering.";target.append(empty);}
  for(const teacher of teachers){
    const row=document.createElement("div");row.className="pa-row";row.setAttribute("role","listitem");
    const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("p");
    name.textContent=teacher.name;meta.className="pa-muted";meta.textContent="Teacher · "+teacher.status;
    info.append(name,meta);row.append(info);
    row.append(teacher.status==="active"?
      lifecycleButton("End assignment","end_teacher_assignment",{
        teacherUid:teacher.teacherUid,offeringId,expectedRevision:Number(teacher.revision)||1
      },teacher.name):
      lifecycleButton("Restore assignment","restore_teacher_assignment",{
        teacherUid:teacher.teacherUid,offeringId,expectedRevision:Number(teacher.revision)||1
      },teacher.name));
    target.append(row);
  }
  say(students.filter(row=>row.status==="active").length+" active students · "+
    teachers.filter(row=>row.status==="active").length+" active teachers.");
}
get("pa-roster-form").addEventListener("submit",event=>{
  event.preventDefault();
  const id=String(new FormData(event.currentTarget).get("offeringId")||"");
  void loadClassRoster(id).catch(error=>say(error.message||"Roster unavailable."));
});
get("pa-academic-lifecycle-cancel").addEventListener("click",()=>{
  if(pendingWrite)return;
  lifecycleChange=null;get("pa-academic-lifecycle-dialog").close();
});
get("pa-academic-lifecycle-form").addEventListener("submit",event=>{
  event.preventDefault();if(!lifecycleChange||pendingWrite)return;
  const form=event.currentTarget,reason=String(new FormData(form).get("reason")||"").trim();
  const change=lifecycleChange;
  void submitAcademic(form,change.action,{...change.details,reason},
    change.action.startsWith("end_")?
      "Class membership ended. Historical records were preserved.":
      "Class membership restored with a new audit revision.").then(saved=>{
        if(!saved)return;
        lifecycleChange=null;get("pa-academic-lifecycle-dialog").close();
        if(currentRosterOfferingId)
          void loadClassRoster(currentRosterOfferingId).catch(error=>say(error.message||"Refresh class roster."));
      });
});
async function searchLinkedStaff(){
  const run=++staffSearchRun,query=get("pa-staff-access-query").value.trim();
  const select=get("pa-staff-access-person"),message=get("pa-staff-access-status");
  select.replaceChildren(new Option("Choose a verified linked staff record",""));
  if(!query){message.textContent="Enter a staff name.";return;}
  message.textContent="Searching active staff records…";
  let result;
  try{result=await perform("search_people",{query,kind:"staff",status:"active"});}
  catch(error){if(run===staffSearchRun&&schoolReady)throw error;return;}
  if(run!==staffSearchRun||!schoolReady||get("pa-staff-access-query").value.trim()!==query)return;
  const linked=(result.items||[]).filter(person=>person.accountLinked);
  linkedStaffById=new Map(linked.map(person=>[person.personId,person]));
  for(const person of linked)select.append(new Option(person.displayName,person.personId));
  message.textContent=linked.length?
    linked.length+" linked staff record(s) found. Select the intended account.":
    "No linked staff found. Verify the person's account link or use an invitation for an unlinked account.";
}
get("pa-staff-access-search").addEventListener("click",()=>void searchLinkedStaff().catch(error=>{
  get("pa-staff-access-status").textContent=error.message||"Staff search failed.";
}));
get("pa-activate-staff-form").addEventListener("submit",event=>{
  event.preventDefault();
  const form=event.currentTarget,data=new FormData(form);
  const personId=String(data.get("personId")||""),role=String(data.get("role")||"teacher"),
    reason=String(data.get("reason")||"").trim();
  if(!personId)return;
  const reviewed=linkedStaffById.get(personId);
  if(!reviewed){get("pa-staff-access-status").textContent="Refresh the linked staff search before activating access.";return;}
  if(!confirm("Activate this verified linked teacher for the selected school? Class assignments remain unchanged."))return;
  void submitForm(form,"activate_linked_staff",{
    personId,expectedPersonRevision:Number(reviewed.revision)||1,
    role:String(new FormData(form).get("role")||"teacher"),reason
  }).then(result=>{
    if(!result)return;
    get("pa-staff-access-status").textContent=result.status==="already_active"?
      "This staff member already has active "+(result.role||role)+" access.":
      (result.role||role)+" school access activated.";

  });
});
async function loadMemberships(){
  const run=++membershipRun;
  const result=await perform("list_memberships");
  if(run!==membershipRun||!schoolReady)return;
  const host=get("pa-membership-list");host.replaceChildren();
  for(const member of result.members||[]){
    const row=document.createElement("div");row.className="pa-row";row.setAttribute("role","listitem");
    const info=document.createElement("div");
    const name=document.createElement("strong");name.textContent=member.displayName||"Verified school account";
    const detail=document.createElement("p");detail.className="pa-muted";
    detail.textContent=member.roles.join(", ")+" · "+member.status+" · account "+member.uid.slice(0,9);
    info.append(name,detail);row.append(info);
    if(!member.roles.includes("school_admin")&&member.uid!==picker.scope.current?.uid&&
      ["active","suspended"].includes(member.status)){
      const restoring=member.status==="suspended";
      const button=document.createElement("button");button.type="button";button.className="pa-action";
      button.style.background=restoring?"#166534":"#9a3412";
      button.textContent=restoring?"Restore access":"Suspend access";
      button.addEventListener("click",()=>{
        accessChange={
          targetUid:member.uid,action:restoring?"restore_access":"suspend_access",
          name:member.displayName||member.uid.slice(0,9),
          expectedRevision:Number(member.revision)||1
        };
        get("pa-suspension-title").textContent=restoring?"Restore school access":"Suspend school access";
        get("pa-suspension-member").textContent=accessChange.name;
        get("pa-access-reason-label").textContent=restoring?"Reason for restoring access":"Reason for suspension";
        get("pa-access-change-help").textContent=restoring?
          "This restores only the selected school membership after verifying its linked person record. Academic history remains unchanged.":
          "This blocks future work only in the selected school. Academic history remains unchanged.";
        const confirmButton=get("pa-access-change-confirm");
        confirmButton.textContent=restoring?"Confirm restore":"Confirm suspension";
        confirmButton.style.background=restoring?"#166534":"#9a3412";
        get("pa-suspension-form").reset();
        get("pa-suspension-dialog").showModal();
      });
      row.append(button);
    }
    host.append(row);
  }
  if(!host.children.length){
    const empty=document.createElement("p");empty.className="pa-muted";
    empty.textContent="No verified school memberships yet.";host.append(empty);
  }
}
get("pa-refresh-memberships").addEventListener("click",()=>
  void loadMemberships().catch(error=>say(error.message||"Membership list unavailable.")));
get("pa-cancel-suspend").addEventListener("click",()=>{if(pendingWrite)return;accessChange=null;get("pa-suspension-dialog").close();});
get("pa-suspension-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(!accessChange||pendingWrite)return;
  const form=event.currentTarget,change=accessChange;
  const reason=String(new FormData(form).get("reason")||"").trim();
  const restoring=change.action==="restore_access";
  if(!confirm(restoring?
    "Restore this account for the current school after its linked identity is revalidated?":
    "Suspend this account for the current school? Existing grades and evidence will be preserved."))return;
  void submitForm(form,change.action,{
    targetUid:change.targetUid,expectedRevision:change.expectedRevision,reason
  }).then(result=>{
    if(!result)return;
    get("pa-suspension-dialog").close();accessChange=null;

  });
});
function reconciliationTabLabel(tab){
  return tab==="classes"?"Open Classes":tab==="invites"?"Open Invitations":
    tab==="access"?"Open School Access":"Open People";
}
function renderReconciliation(result){
  const counts=result?.counts||{},host=get("pa-reconcile-results");
  get("pa-reconcile-integrity").textContent=counts.integrity??0;
  get("pa-reconcile-attention").textContent=counts.attention??0;
  get("pa-reconcile-review").textContent=counts.review??0;
  get("pa-reconcile-total").textContent=counts.total??0;
  host.replaceChildren();
  if(!(result?.issues||[]).length){
    const clear=document.createElement("p");clear.className="pa-muted";
    clear.textContent="No unresolved directory or active class relationships were found in the bounded school review.";
    host.append(clear);
  }else{
    for(const issue of result.issues){
      const row=document.createElement("div");row.className="pa-row";row.setAttribute("role","listitem");
      const info=document.createElement("div");
      const title=document.createElement("strong");title.textContent=issue.label||"School record";
      const detail=document.createElement("p");detail.className="pa-muted";
      detail.textContent=(issue.severity==="integrity"?"Integrity":issue.severity==="attention"?"Attention":"Review")+" · "+(issue.detail||"Review this school relationship.");
      info.append(title,detail);row.append(info);
      if(issue.targetTab&&tabNames.has(issue.targetTab)){
        const button=document.createElement("button");button.type="button";button.className="pa-action";
        button.style.background="#475569";button.textContent=reconciliationTabLabel(issue.targetTab);
        button.addEventListener("click",()=>setTab(issue.targetTab));
        row.append(button);
      }
      host.append(row);
    }
  }
  get("pa-reconcile-status").textContent=(result.truncated?
    "Showing the first 150 unresolved relationships. Resolve these before requesting another bounded review. ":
    "")+(result.note||"");
}
async function loadReconciliation(){
  const button=get("pa-reconcile-refresh");
  if(button)button.disabled=true;
  get("pa-reconcile-status").textContent="Checking school identity, access and active class relationships…";
  try{
    const result=await perform("reconcile_directory");
    renderReconciliation(result);
    return result;
  }catch(error){
    get("pa-reconcile-status").textContent=error?.message||"Directory reconciliation is unavailable.";
    throw error;
  }finally{if(button)button.disabled=false;}
}
get("pa-reconcile-refresh").addEventListener("click",()=>
  void loadReconciliation().catch(()=>{}));
async function loadOverview(){
  const response=await perform("overview");
  get("pa-people-count").textContent=response.counts.people;
  get("pa-enroll-count").textContent=response.counts.enrollments;
  get("pa-staff-count").textContent=response.counts.staff_assignments;
  get("pa-invite-count").textContent=response.counts.invitations;
  await loadReconciliation().catch(()=>{});
}
async function editPersonProfile(person){
  try{
    const record=await perform("get_person",{personId:person.personId});
    openPersonDialog({...person,...record.person},"edit");
  }catch(error){say(error.message||"Person profile could not be loaded.");}
}
function openPersonDialog(person,mode){
  personChange={person,mode};
  const form=get("pa-person-dialog-form"),nameField=get("pa-person-name-field"),
    reasonField=get("pa-person-reason-field"),nameInput=form.elements.displayName,
    reasonInput=form.elements.reason,confirm=get("pa-person-dialog-confirm");
  form.reset();get("pa-person-dialog-target").textContent=person.displayName+" · "+person.kind;
  nameField.hidden=mode!=="edit";reasonField.hidden=mode==="edit";
  nameInput.required=mode==="edit";reasonInput.required=mode!=="edit";
  nameInput.value=person.displayName||"";
  const studentFields=get("pa-student-profile-fields");
  studentFields.hidden=mode!=="edit"||person.kind!=="student";
  form.elements.studentNumber.value=person.studentNumber||"";
  get("pa-person-dialog-title").textContent=mode==="edit"?"Edit school person":
    mode==="archive"?"Archive school person":"Restore school person";
  confirm.textContent=mode==="edit"?"Save profile":mode==="archive"?"Archive person":"Restore person";
  confirm.style.background=mode==="archive"?"#9a3412":mode==="restore"?"#166534":"#1d4ed8";
  get("pa-person-dialog-help").textContent=mode==="archive"?
    "Archiving is blocked until active school access, official registration/class relationships, teaching assignments and active pending invitations are ended. Nothing is deleted.":
    mode==="restore"?"Restoring the person record does not automatically restore school access, enrollment, invitations or teaching assignments.":
    "Edit the school identity and student number here. Guardian relationships belong to Student Records; section placement belongs to Enrollment.";
  const lifecycleActions=get("pa-person-lifecycle-actions"),
    enrollmentLink=get("pa-person-open-enrollment"),classesLink=get("pa-person-open-classes");
  lifecycleActions.style.display=mode==="archive"?"flex":"none";
  enrollmentLink.style.display=mode==="archive"&&person.kind==="student"?"inline-flex":"none";
  classesLink.style.display=mode==="archive"?"inline-flex":"none";
  if(person.kind==="student")
    enrollmentLink.href="school-enrollment.html?personId="+encodeURIComponent(person.personId);
  get("pa-person-dialog").showModal();
}
for(const id of ["pa-person-open-access","pa-person-open-invites"]){
  get(id)?.addEventListener("click",()=>{if(get("pa-person-dialog").open)get("pa-person-dialog").close();personChange=null;});
}
get("pa-person-open-classes")?.addEventListener("click",()=>{personChange=null;});
get("pa-person-open-enrollment")?.addEventListener("click",()=>{personChange=null;});
get("pa-person-dialog-cancel").addEventListener("click",()=>{
  if(pendingWrite)return;
  personChange=null;get("pa-person-dialog").close();
});
get("pa-person-dialog-form").addEventListener("submit",event=>{
  event.preventDefault();if(!personChange||pendingWrite)return;
  const form=event.currentTarget,{person,mode}=personChange,values=new FormData(form);
  const action=mode==="edit"?"update_person":mode==="archive"?"archive_person":"restore_person";
  const details={personId:person.personId};
  if(mode==="edit"){
    details.expectedRevision=Number(person.revision)||1;
    details.displayName=String(values.get("displayName")||"").trim();
    if(person.kind==="student")
      details.studentNumber=String(values.get("studentNumber")||"").trim();
  }
  else {
    details.expectedRevision=Number(person.revision)||1;
    details.reason=String(values.get("reason")||"").trim();
  }
  void submitForm(form,action,details).then(result=>{
    if(!result)return;
    personChange=null;get("pa-person-dialog").close();
  });
});

for(const id of ["pa-person-dialog","pa-suspension-dialog","pa-academic-lifecycle-dialog","pa-invitation-lifecycle-dialog"]){
  get(id)?.addEventListener("cancel",event=>{if(pendingWrite)event.preventDefault();});
}
function detailRow(label,value){
  const row=document.createElement("p");row.className="pa-muted";
  const strong=document.createElement("strong");strong.textContent=label+": ";
  row.append(strong,document.createTextNode(value||"—"));return row;
}
function renderDetailList(host,items,formatter,emptyText){
  host.replaceChildren();
  if(!items?.length){host.append(detailRow("Status",emptyText));return;}
  for(const item of items){
    const row=document.createElement("div");row.className="pa-row";
    row.append(formatter(item));host.append(row);
  }
}
function openInvitationLifecycle(invitation){
  invitationChange={invitation,person:currentDetailPerson};
  const form=get("pa-invitation-lifecycle-form");form.reset();
  get("pa-invitation-lifecycle-target").textContent=
    (currentDetailPerson?.displayName||"School person")+" · "+(invitation.requestedRole||"invitation")+
    " · "+invitation.invitationId;
  get("pa-invitation-lifecycle-dialog").showModal();
}
function renderPersonInvitations(items){
  const host=get("pa-person-detail-invites");host.replaceChildren();
  if(!items?.length){host.append(detailRow("Status","No invitation records"));return;}
  const now=Date.now();
  for(const item of items){
    const row=document.createElement("div");row.className="pa-row";
    const info=document.createElement("div"),title=document.createElement("strong"),meta=document.createElement("p");
    title.textContent=item.requestedRole||"Invitation";meta.className="pa-muted";
    const expired=item.status==="pending"&&item.expiresAt&&item.expiresAt<=now;
    meta.textContent=(expired?"expired":item.status||"unknown")+
      (item.expiresAt?" · expires "+new Date(item.expiresAt).toLocaleString():"")+
      " · revision "+(item.revision||1);
    info.append(title,meta);row.append(info);
    if(item.status==="pending"){
      const revoke=document.createElement("button");revoke.type="button";revoke.className="pa-action";
      revoke.style.background="#9a3412";revoke.textContent=expired?"Revoke expired invite":"Revoke invitation";
      revoke.addEventListener("click",()=>openInvitationLifecycle(item));row.append(revoke);
    }
    host.append(row);
  }
}
async function openPersonDetail(person){
  const run=++detailRun,dialog=get("pa-person-detail-dialog");
  get("pa-person-detail-title").textContent=person.displayName;
  get("pa-person-detail-meta").textContent="Loading school-scoped identity and academic context…";
  get("pa-person-detail-access").textContent="—";
  get("pa-person-detail-relationships").textContent="—";
  for(const id of ["pa-person-detail-invites","pa-person-detail-links","pa-person-detail-audit"])get(id).replaceChildren();
  if(!dialog.open)dialog.showModal();
  try{
    const result=await perform("get_person",{personId:person.personId});
    if(!dialog.open||run!==detailRun||!schoolReady)return;
    const p=result.person;currentDetailPerson=p;
    get("pa-person-detail-title").textContent=p.displayName;
    get("pa-person-detail-meta").textContent=p.kind+" · "+p.status+" · directory revision "+p.revision+
      (p.accountLinked?" · verified account linked":" · no account linked");
    get("pa-person-detail-access").textContent=result.membership?
      result.membership.status+" · "+result.membership.roles.join(", "):"No school membership";
    get("pa-person-detail-relationships").textContent=String(result.relationships?.length||0);
    const classesAction=get("pa-person-detail-classes-action"),enrollmentAction=get("pa-person-detail-enrollment-action"),
      recordsAction=get("pa-person-detail-records-action");
    if(p.kind==="student"&&standardEnrollmentMode){
      classesAction.hidden=true;
      enrollmentAction.href="school-enrollment.html?personId="+encodeURIComponent(p.personId);
      enrollmentAction.style.display="inline-flex";
      recordsAction.href="school-student-records.html?personId="+encodeURIComponent(p.personId);
      recordsAction.style.display="inline-flex";
    }else{
      classesAction.hidden=false;classesAction.textContent=p.kind==="student"?"Enrollment relationships":"Teaching & classes";
      enrollmentAction.style.display="none";
      recordsAction.style.display=p.kind==="student"?"inline-flex":"none";
      if(p.kind==="student")recordsAction.href="school-student-records.html?personId="+encodeURIComponent(p.personId);
    }
    const recoveryCard=get("pa-account-recovery-card");
    recoveryCard.hidden=p.kind!=="student"||p.status!=="active";
    recoveryPreview=null;recoveryCanonicalPersonId=recoveryCard.hidden?null:p.personId;
    if(!recoveryCard.hidden){
      const recoveryForm=get("pa-account-recovery-form");
      recoveryForm.reset();recoveryForm.elements.personId.value=p.personId;
      get("pa-account-recovery-search").value="";
      get("pa-account-recovery-replacement").replaceChildren(
        new Option("Search for a linked student account","")
      );
      get("pa-account-recovery-summary").textContent=p.accountLinked?
        "This student already has a linked account. Preview will show whether the previous school login will be suspended.":
        "Search for the student's newly verified duplicate account, then preview the recovery.";
      get("pa-account-recovery-confirm").disabled=true;
    }
    const placementCard=get("pa-detail-placement-card");
    placementCard.hidden=p.kind!=="student"||standardEnrollmentMode;
    legacyPlacementReview=null;
    if(!placementCard.hidden){
      await loadPlacementCatalog();
      if(!dialog.open||run!==detailRun)return;
      const placementForm=get("pa-detail-placement-form");
      placementForm.elements.personId.value=p.personId;
      get("pa-detail-placement-status").textContent="";
      try{
        legacyPlacementReview=await performEnrollment("student_candidate",{personId:p.personId});
      }catch(error){
        get("pa-detail-placement-status").textContent=error?.message||"Current placement could not be checked.";
      }
      if(!dialog.open||run!==detailRun)return;
      renderDetailPlacementState();
      updateDetailPlacementPicker();
    }

    renderPersonInvitations(result.invitations);
    renderDetailList(get("pa-person-detail-links"),result.relationships,item=>
      detailRow(item.kind==="enrollment"?"Enrollment":"Teaching assignment",
        item.offeringId+" · "+item.status+" · revision "+item.revision),
      "No enrollment or teaching assignment records");
    renderDetailList(get("pa-person-detail-audit"),result.audit,item=>
      detailRow(item.action,(item.reason?item.reason+" · ":"")+
        (item.createdAt?new Date(item.createdAt).toLocaleString():"time unavailable")),
      "No recent person audit entries");
  }catch(error){
    if(dialog.open&&run===detailRun&&schoolReady)get("pa-person-detail-meta").textContent=error?.message||"Person details are unavailable.";
  }
}

function resetRecoveryPreview(message="Preview the account replacement before saving."){
  recoveryPreview=null;
  get("pa-account-recovery-summary").textContent=message;
  const reconcile=get("pa-account-recovery-reconcile");
  if(reconcile){reconcile.style.display="none";reconcile.removeAttribute("href");}
  get("pa-account-recovery-confirm").disabled=true;
}
get("pa-account-recovery-search")?.addEventListener("input",event=>{
  clearTimeout(recoverySearchTimer);resetRecoveryPreview();
  const query=event.currentTarget.value.trim(),select=get("pa-account-recovery-replacement");
  select.replaceChildren(new Option(query?"Searching…":"Search for a linked student account",""));
  const run=++recoverySearchRun;
  if(query.length<2)return;
  recoverySearchTimer=setTimeout(()=>{
    void perform("search_people",{query,kind:"student",status:"active"}).then(result=>{
      if(run!==recoverySearchRun||!recoveryCanonicalPersonId)return;
      const matches=(result.items||[]).filter(person=>
        person.personId!==recoveryCanonicalPersonId&&person.accountLinked);
      select.replaceChildren(new Option(matches.length?
        "Choose the newly linked student record":"No other linked student records found",""));
      for(const person of matches)
        select.add(new Option(person.displayName+
          (person.studentNumber?" · "+person.studentNumber:""),person.personId));
    }).catch(error=>{
      if(run===recoverySearchRun)resetRecoveryPreview(error?.message||"Account search failed.");
    });
  },250);
});
get("pa-account-recovery-replacement")?.addEventListener("change",()=>resetRecoveryPreview());
get("pa-account-recovery-preview")?.addEventListener("click",()=>{
  const form=get("pa-account-recovery-form"),
    personId=String(form.elements.personId.value||""),
    replacementPersonId=String(form.elements.replacementPersonId.value||"");
  if(!personId||!replacementPersonId||pendingWrite)return;
  const button=get("pa-account-recovery-preview");button.disabled=true;
  resetRecoveryPreview("Checking identity, enrollment and academic-history conflicts…");
  void perform("preview_student_account_recovery",{personId,replacementPersonId}).then(preview=>{
    if(personId!==recoveryCanonicalPersonId||
       replacementPersonId!==String(form.elements.replacementPersonId.value||""))return;
    recoveryPreview=preview;
    const lines=[
      "Keep "+preview.canonical.displayName+" as the canonical student.",
      "Move the login currently linked to "+preview.replacement.displayName+" to this student.",
      preview.previousAccountWillBeSuspended?
        "The previous school login will be suspended.":"No active previous school login needs suspension."
    ];
    if(preview.blockers?.length)lines.push("Blocked: "+preview.blockers.join(" "));
    else lines.push("No duplicate registration, enrollment, grade, submission, evidence or record-history blockers were found.");
    get("pa-account-recovery-summary").textContent=lines.join(" ");
    const reconcile=get("pa-account-recovery-reconcile"),
      enrollmentBlocked=(preview.blockers||[]).some(message=>String(message).toLowerCase().includes("active class enrollment"));
    if(reconcile){
      reconcile.style.display=enrollmentBlocked?"inline-flex":"none";
      if(enrollmentBlocked)reconcile.href="school-enrollment.html?personId="+encodeURIComponent(preview.replacement.personId);
      else reconcile.removeAttribute("href");
    }
    get("pa-account-recovery-confirm").disabled=Boolean(preview.blockers?.length);
  }).catch(error=>resetRecoveryPreview(error?.message||"Account recovery preview failed."))
    .finally(()=>{button.disabled=false;});
});
get("pa-account-recovery-form")?.addEventListener("submit",event=>{
  event.preventDefault();
  const form=event.currentTarget,d=new FormData(form),preview=recoveryPreview;
  if(!preview||preview.blockers?.length||pendingWrite||!form.reportValidity())return;
  const personId=String(d.get("personId")||""),
    replacementPersonId=String(d.get("replacementPersonId")||""),
    reason=String(d.get("reason")||"").trim();
  if(personId!==preview.canonical.personId||replacementPersonId!==preview.replacement.personId){
    resetRecoveryPreview("The selected account changed. Preview the recovery again.");return;
  }
  if(!confirm("Replace this student's school login with the selected verified account? The existing student identity, registration, classes and academic history remain canonical."))return;
  const button=get("pa-account-recovery-confirm");
  pendingWrite=true;button.disabled=true;
  get("pa-account-recovery-summary").textContent=
    "Recovering the login while preserving the canonical student record…";
  void perform("recover_student_account",{
    personId,replacementPersonId,reason,
    expectedCanonicalRevision:preview.expected.canonicalRevision,
    expectedReplacementRevision:preview.expected.replacementRevision,
    expectedReplacementMembershipRevision:preview.expected.replacementMembershipRevision,
    expectedCanonicalMembershipRevision:preview.expected.canonicalMembershipRevision
  }).then(async result=>{
    say(result.displayName+" now uses the replacement verified login. Existing registration and academic history were preserved.");
    ++detailRun;get("pa-person-detail-dialog").close();
    recoveryPreview=null;recoveryCanonicalPersonId=null;
    await Promise.allSettled([loadPeople(false),loadOverview(),loadMemberships()]);
  }).catch(error=>resetRecoveryPreview(error?.message||"Student account recovery failed."))
    .finally(()=>{pendingWrite=false;button.disabled=false;});
});

let directoryPlacementCatalog=null;
async function loadPlacementCatalog(){
  if(directoryPlacementCatalog)return directoryPlacementCatalog;
  const kinds=["academic_years","terms","sections"];
  const [years,terms,sections,offers]=await Promise.all([
    ...kinds.map(kind=>performAcademic("list_catalog",{kind})),
    performAcademic("planning_options")
  ]);
  directoryPlacementCatalog={
    years:(years.items||[]).filter(r=>r.status==="active"),
    terms:(terms.items||[]).filter(r=>r.status==="active"),
    sections:(sections.items||[]).filter(r=>r.status==="active"),
    offerings:(offers.offerings||[]).filter(r=>r.status==="active")
  };
  return directoryPlacementCatalog;
}
function renderDetailPlacementState(){
  const box=get("pa-detail-current-placement"),summary=get("pa-detail-current-placement-summary"),
    endButton=get("pa-detail-placement-end"),endReason=get("pa-detail-placement-end-reason"),
    form=get("pa-detail-placement-form");
  if(!box||!form)return;
  const official=legacyPlacementReview?.activeRegistrations||[],
    legacy=legacyPlacementReview?.activeLegacyEnrollments||[];
  if(official.length){
    const current=official[0],section=directoryPlacementCatalog?.sections?.find(row=>row.id===current.sectionId)?.name||current.sectionId||"assigned section";
    box.hidden=false;summary.textContent="Official registration active · "+section+". Use Enrollment & Registration for lifecycle changes.";
    endButton.hidden=true;endReason.parentElement.hidden=true;
    form.hidden=true;return;
  }
  form.hidden=false;
  if(!legacy.length){
    box.hidden=true;endButton.hidden=false;endReason.parentElement.hidden=false;endReason.value="";
    return;
  }
  const sectionIds=[...new Set(legacy.map(row=>row.sectionId).filter(Boolean))],
    sectionNames=sectionIds.map(id=>directoryPlacementCatalog?.sections?.find(row=>row.id===id)?.name||id),
    registrationLinked=legacy.some(row=>Boolean(row.registrationId));
  box.hidden=false;
  summary.textContent=legacy.length+" active pre-canonical class enrollment"+(legacy.length===1?"":"s")+
    (sectionNames.length?" · "+sectionNames.join(", "):"")+
    (registrationLinked?" · linked registration history requires registrar review":"");
  endButton.hidden=false;endButton.disabled=registrationLinked;
  endReason.parentElement.hidden=false;
  get("pa-detail-placement-preview").textContent=registrationLinked
    ?"This placement is linked to registration history. Open Enrollment & Registration instead of changing it here."
    :"End the current placement before assigning the student to another section.";
}
function updateDetailPlacementPicker(stage="year"){
  const catalog=directoryPlacementCatalog,form=get("pa-detail-placement-form");
  if(!catalog)return;
  const select=(control,rows,label)=>{
    const previous=control.value;
    control.replaceChildren(new Option(label,""));
    for(const row of rows)control.add(new Option(row.name,row.id));
    if(rows.some(row=>row.id===previous))control.value=previous;
  };
  if(stage==="year")select(form.elements.yearId,catalog.years,"Choose academic year");
  if(stage!=="section"){
    select(form.elements.termId,catalog.terms.filter(row=>row.yearId===form.elements.yearId.value),"Choose academic period");
    const term=catalog.terms.find(row=>row.id===form.elements.termId.value);
    select(form.elements.sectionId,catalog.sections.filter(row=>!term||row.programId===term.programId),"Choose section");
  }
  const {yearId,termId,sectionId}=form.elements;
  const offerings=catalog.offerings.filter(row=>row.yearId===yearId.value&&row.termId===termId.value&&row.sectionId===sectionId.value),
    activeLegacy=Boolean(legacyPlacementReview?.activeLegacyEnrollments?.length);
  get("pa-detail-placement-preview").textContent=activeLegacy
    ?"End the current placement before assigning the student to another section."
    :offerings.length
      ?offerings.length+" active subject offering(s) will be added to the student's class roster."
      :"Choose a section with active subjects in the selected academic year and period.";
  form.querySelector('button[type="submit"]').disabled=activeLegacy||!offerings.length;
}
get("pa-detail-placement-end")?.addEventListener("click",()=>{
  if(pendingWrite||!legacyPlacementReview?.person?.personId)return;
  const legacy=legacyPlacementReview.activeLegacyEnrollments||[],
    reason=String(get("pa-detail-placement-end-reason")?.value||"").trim();
  if(!legacy.length)return;
  if(reason.length<12){
    get("pa-detail-placement-status").textContent="Enter a placement change reason of at least 12 characters.";return;
  }
  if(legacy.some(row=>Boolean(row.registrationId))){
    get("pa-detail-placement-status").textContent="This placement is linked to registration history. Use Enrollment & Registration instead.";return;
  }
  if(!confirm("End this student's current pre-canonical section placement? Enrollment history will be preserved."))return;
  const button=get("pa-detail-placement-end"),personId=legacyPlacementReview.person.personId;
  pendingWrite=true;button.disabled=true;
  get("pa-detail-placement-status").textContent="Ending current placement while preserving enrollment history…";
  void performEnrollment("end_orphan_enrollments",{
    personId,reason,
    enrollments:legacy.map(row=>({enrollmentId:row.enrollmentId,expectedRevision:Number(row.expectedRevision)||1}))
  }).then(async result=>{
    get("pa-detail-placement-status").textContent="Ended · "+result.courseCount+" legacy class enrollment"+
      (result.courseCount===1?"":"s")+" preserved in history. You can now assign a new section or continue account recovery.";
    legacyPlacementReview=await performEnrollment("student_candidate",{personId});
    renderDetailPlacementState();updateDetailPlacementPicker();
    await Promise.allSettled([loadOverview(),loadPeople(false)]);
  }).catch(error=>{
    get("pa-detail-placement-status").textContent=error?.message||"The current placement was not ended.";
  }).finally(()=>{pendingWrite=false;button.disabled=false;});
});
get("pa-detail-placement-form")?.elements.yearId.addEventListener("change",()=>updateDetailPlacementPicker("term"));
get("pa-detail-placement-form")?.elements.termId.addEventListener("change",()=>updateDetailPlacementPicker("term"));
get("pa-detail-placement-form")?.elements.sectionId.addEventListener("change",()=>updateDetailPlacementPicker("section"));
get("pa-detail-placement-form")?.addEventListener("submit",event=>{
  event.preventDefault();
  const form=event.currentTarget,d=new FormData(form);
  const data=Object.fromEntries(["personId","yearId","termId","sectionId","reason"].map(name=>[name,String(d.get(name)||"").trim()]));
  if(!form.reportValidity()||pendingWrite)return;
  if(!confirm("Assign this existing student to the selected section and enroll the matching active subjects?"))return;
  const button=form.querySelector('button[type="submit"]');
  pendingWrite=true;button.disabled=true;
  get("pa-detail-placement-status").textContent="Saving section and subject enrollments…";
  void performAcademic("enroll_student_section",data).then(async result=>{
    get("pa-detail-placement-status").textContent="Saved · "+result.created+" subjects added; "+result.alreadyActive+" already enrolled.";
    ++detailRun;
    get("pa-person-detail-dialog").close();
    await Promise.allSettled([loadPeople(false),loadOverview()]);
    directoryPlacementCatalog=null;
  }).catch(error=>{
    get("pa-detail-placement-status").textContent=error?.message||"Section assignment failed.";
  }).finally(()=>{pendingWrite=false;button.disabled=false;});
});
get("pa-invitation-lifecycle-cancel").addEventListener("click",()=>{
  if(pendingWrite)return;invitationChange=null;get("pa-invitation-lifecycle-dialog").close();
});
get("pa-invitation-lifecycle-dialog").addEventListener("cancel",event=>{
  if(pendingWrite)event.preventDefault();else invitationChange=null;
});
get("pa-invitation-lifecycle-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(pendingWrite||!invitationChange||!event.currentTarget.reportValidity())return;
  const form=event.currentTarget,change=invitationChange,
    reason=String(new FormData(form).get("reason")||"").trim(),
    button=get("pa-invitation-lifecycle-confirm");
  pendingWrite=true;button.disabled=true;say("Revoking school invitation…");
  void perform("revoke_invitation",{
    invitationId:change.invitation.invitationId,
    expectedRevision:Number(change.invitation.revision)||1,reason
  }).then(async()=>{
    invitationChange=null;get("pa-invitation-lifecycle-dialog").close();
    say("Invitation revoked. The record and audit history were preserved.");
    if(change.person&&get("pa-person-detail-dialog").open)
      await openPersonDetail(change.person);
    await Promise.allSettled([loadOverview(),loadInvitePeople()]);
  }).catch(error=>say(error?.message||"The invitation was not revoked."))
    .finally(()=>{pendingWrite=false;button.disabled=false;});
});
get("pa-person-detail-close").addEventListener("click",()=>{
  recoveryPreview=null;recoveryCanonicalPersonId=null;clearTimeout(recoverySearchTimer);
  get("pa-person-detail-dialog").close();
});

function directoryFilters(){
  const values=new FormData(get("pa-person-search"));
  return {
    query:String(values.get("query")||"").trim(),
    kind:String(values.get("kind")||"all"),
    status:String(values.get("status")||"all")
  };
}
function directoryFilterActive(filters){
  return Boolean(filters.query)||filters.kind!=="all"||filters.status!=="all";
}
async function loadPeople(append) {
  if(!schoolReady)return;
  if(loadingPeople){if(!append){peopleReloadQueued=true;++peopleRun;}return;}
  loadingPeople=true;const run=++peopleRun,button=get("pa-more"),note=get("pa-person-filter-note");
  button.disabled=true;
  try {
    const filters=directoryFilters(),filtered=directoryFilterActive(filters);
    const response=filtered?
      await perform("search_people",filters):
      await perform("list_people",append&&after?{after}:undefined);
    if(run!==peopleRun||!schoolReady)return;
    if(!append||filtered)list.replaceChildren();
    for(const person of response.items||[]){
      const row=document.createElement("div");row.className="pa-row";row.setAttribute("role","listitem");
      const identity=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("div");
      name.textContent=person.displayName;meta.className="pa-muted";
      meta.textContent=person.kind+" · "+person.status+" · "+(person.accountLinked?"Account linked":"Account not linked");
      identity.append(name,meta);row.append(identity);
      const actions=document.createElement("div");actions.style.cssText="display:flex;gap:.4rem;flex-wrap:wrap";
      const view=document.createElement("button");view.type="button";view.className="pa-action";view.style.background="#0f766e";view.textContent="View details";
      view.addEventListener("click",()=>void openPersonDetail(person));
      actions.append(view);
      if(person.status==="active"){
        const edit=document.createElement("button");edit.type="button";edit.className="pa-action";edit.textContent="Edit";
        edit.addEventListener("click",()=>void editPersonProfile(person));
        actions.append(edit);
      }
      if(["active","archived"].includes(person.status)){
        const lifecycle=document.createElement("button");lifecycle.type="button";lifecycle.className="pa-action";
        lifecycle.style.background=person.status==="active"?"#9a3412":"#166534";
        lifecycle.textContent=person.status==="active"?"Archive":"Restore";
        lifecycle.addEventListener("click",()=>openPersonDialog(person,person.status==="active"?"archive":"restore"));
        actions.append(lifecycle);
      }
      row.append(actions);list.append(row);
    }
    if(!list.children.length){
      const empty=document.createElement("p");empty.className="pa-muted";
      empty.textContent=filtered?"No school people match these filters.":
        "No people records yet. Verify migration before importing historical rosters.";
      list.append(empty);
    }
    if(filtered){
      after=null;button.hidden=true;
      note.hidden=!response.truncated;
      note.textContent=response.truncated?
        "Showing the first 50 matches. Narrow the search or filters to refine the result.":"";
    }else{
      after=response.nextCursor;button.hidden=!after;note.hidden=true;note.textContent="";
    }
  }catch(error){if(run===peopleRun&&schoolReady)say(error.message||"Could not load this school directory.");}
  finally{loadingPeople=false;button.disabled=false;if(peopleReloadQueued){peopleReloadQueued=false;void loadPeople(false);}}
}
get("pa-more").addEventListener("click",()=>void loadPeople(true));
get("pa-export-people").addEventListener("click",()=>{
  if(pendingWrite)return;
  void (async()=>{
    const button=get("pa-export-people");button.disabled=true;
    say("Preparing a school-scoped directory export…");
    try{
      const result=await perform("export_people");
      const quote=value=>'"'+String(value??"").replaceAll('"','""')+'"';
      const lines=[["personId","displayName","kind","recordStatus","accountLinked","membershipStatus","roles","revision"]
        .map(quote).join(",")];
      for(const row of result.rows||[])lines.push([
        row.personId,row.displayName,row.kind,row.status,row.accountLinked?"yes":"no",
        row.membershipStatus,(row.roles||[]).join("|"),row.revision
      ].map(quote).join(","));
      const blob=new Blob([lines.join("\r\n")+"\r\n"],{type:"text/csv;charset=utf-8"});
      const url=URL.createObjectURL(blob),link=document.createElement("a");
      link.href=url;
      link.download="adminerva-"+picker.scope.current.schoolId+"-people-"+new Date(result.generatedAt||Date.now()).toISOString().slice(0,10)+".csv";
      document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);
      say("Directory export prepared from the active verified school only.");
    }catch(error){say(error?.message||"Directory export could not be prepared.");}
    finally{button.disabled=false;}
  })();
});

get("pa-person-search").addEventListener("input",()=>{
  clearTimeout(peopleSearchTimer);
  peopleSearchTimer=setTimeout(()=>{after=null;void loadPeople(false);},250);
});
get("pa-person-search").addEventListener("change",()=>{after=null;void loadPeople(false);});
async function submitForm(form,action,details) {
  if(pendingWrite)return null;
  const button=form.querySelector('button[type="submit"]');
  pendingWrite=true;button.disabled=true;say("Saving within your verified school…");
  try {
    const result=await perform(action,details);
    form.reset();
    say(action==="invite"?"Pending invitation recorded. Access has not been granted.":
      action==="suspend_access"?"School access suspended. Historical academic records were preserved.":
      action==="restore_access"?"School access restored after identity revalidation. Historical records were unchanged.":
      action==="update_person"?"School person record updated.":
      action==="archive_person"?"School person archived without deleting academic history.":
      action==="restore_person"?"School person restored. Access and class assignments remain separately controlled.":
      "Person created. No account or enrollment was created.");
    if(action==="invite"&&result.invitationId){
      const host=get("pa-invitation-result");
      host.replaceChildren();
      const title=document.createElement("p");
      title.textContent="Invitation recorded. Give this link only to the intended account holder:";
      const link=document.createElement("a");
      const url=new URL("join-school.html",location.href);
      url.searchParams.set("schoolId",picker.scope.current.schoolId);
      url.searchParams.set("invitationId",result.invitationId);
      link.href=url.href;link.textContent=url.href;link.style.cssText="overflow-wrap:anywhere;color:#1d4ed8;text-decoration:underline";
      const hint=document.createElement("p");hint.className="pa-muted";
      hint.textContent="The invited person's verified email must match. This link is not a public school signup.";
      host.append(title,link,hint);
    }
    const personWrite=["create_person","update_person","archive_person","restore_person"].includes(action);
    const refreshes=await Promise.allSettled(personWrite
      ?[loadPeople(false),loadOverview(),loadAcademics(),loadInvitePeople(),loadMemberships()]
      :[loadOverview(),...(["activate_linked_staff","suspend_access","restore_access"].includes(action)?[loadAcademics(),loadMemberships()]:[])]);
    if(refreshes.some(item=>item.status==="rejected"))say("Change saved successfully. Some school data could not refresh; reopen the affected tab or refresh the page.");
    return result;
  }catch(error){say(error.message||"This change was not saved.");return null;}
  finally{pendingWrite=false;button.disabled=false;}
}
get("pa-add-person").addEventListener("submit",event=>{
  event.preventDefault();const values=new FormData(event.currentTarget);
  const kind=String(values.get("kind")||"");
  void submitForm(event.currentTarget,"create_person",{person:{
    displayName:String(values.get("displayName")||""),kind
  }}).then(result=>{
    if(result&&kind==="student")
      say("Student directory record created. Next: use Invitations if this learner needs to sign in, then Classes to enroll the student.");
  });
});
get("pa-create-invite").addEventListener("submit",event=>{
  event.preventDefault();const values=new FormData(event.currentTarget);
  void submitForm(event.currentTarget,"invite",{
    email:String(values.get("email")||""),role:String(values.get("role")||""),
    personId:String(values.get("personId")||"")
  }).then(result=>{if(result)void loadInvitePeople().catch(()=>{});});
});
try{
  await picker.load();
  if(!auth.currentUser){
    say("Sign in to use the school directory.");
    const link=document.createElement("a");link.href="login.html";link.textContent="Go to sign in";
    status.append(" ",link);
  }
}catch(error){say(error.message||"Unable to check your school membership.");}
