import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs";
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"peopleDirectory");
const rosterSourceApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolRosterSource");
const get=id=>document.getElementById(id);
const academicsApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
let schoolPrograms=[],schoolTerms=[],schoolSections=[],schoolOfferings=[];
let workload=null,workloadRun=0,workloadLimit=12,rosterRun=0,inviteRun=0,staffSearchRun=0,detailRun=0,academicRun=0,membershipRun=0;
const status=get("school-status"),workspace=get("pa-workspace"),list=get("pa-person-list");
let after=null,loadingPeople=false,pendingWrite=false,peopleReloadQueued=false,peopleRun=0;
let accessChange=null,personChange=null,lifecycleChange=null,currentRosterOfferingId=null,peopleSearchTimer=null,importRows=[],importDigest=null,importPreview=null,importCommitted=false;
let importRun=0,rosterSourceRun=0,rosterSourceConfigured=false;
function say(message){status.textContent=message;}
const tabNames=new Set(["overview","people","import","invites","classes","access"]);
const TAB_STATE_KEY="Adminerva_people_access_active_tab";
const requestedPersonId=String(new URL(location.href).searchParams.get("personId")||"");
let requestedPersonSchoolId=null;
let schoolReady=false,standardEnrollmentMode=false,canonicalClassMode=false;
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
    if(get("pa-person-detail-dialog")?.open)get("pa-person-detail-dialog").close();
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
    ++importRun;++rosterSourceRun;rosterSourceConfigured=false;
    // Enter the next school with empty forms, including copied IDs and emails.
    for(const form of workspace.querySelectorAll("form"))form.reset();
    for(const control of workspace.querySelectorAll("[data-catalog],[data-offering],[data-assignment-section],[data-student-person],[data-school-teacher],[data-student-person-bulk],[data-school-teacher-bulk]"))
      control.replaceChildren(new Option("Choose an option",""));
    get("pa-staff-access-person").replaceChildren(new Option("Search this school's linked staff first",""));
    get("pa-staff-access-query").value="";
    get("pa-staff-access-status").textContent="Search linked staff in the selected school.";
    schoolReady=false;++peopleRun;peopleReloadQueued=false;clearTimeout(peopleSearchTimer);++workloadRun;++rosterRun;++inviteRun;++staffSearchRun;++detailRun;++academicRun;++membershipRun;workload=null;resetWorkload();
    workspace.hidden=true;list.replaceChildren();get("pa-invitation-result").replaceChildren();get("pa-class-roster").replaceChildren();get("pa-membership-list").replaceChildren();get("pa-invite-person").replaceChildren();get("pa-suspension-dialog").close?.();get("pa-person-dialog").close?.();get("pa-person-detail-dialog").close?.();get("pa-academic-lifecycle-dialog").close?.();accessChange=null;personChange=null;lifecycleChange=null;currentRosterOfferingId=null;after=null;importRows=[];importDigest=null;importPreview=null;importCommitted=false;schoolPrograms=[];schoolTerms=[];schoolSections=[];schoolOfferings=[];get("pa-import-results").replaceChildren();get("pa-import-summary").textContent="No file previewed.";get("pa-import-status").textContent="Choose a CSV with up to 200 people.";get("pa-import-file").value="";get("pa-import-preview").disabled=true;get("pa-import-commit").disabled=true;resetImportCourseMapping();
    get("pa-reconcile-results")?.replaceChildren();for(const id of ["pa-reconcile-integrity","pa-reconcile-attention","pa-reconcile-review","pa-reconcile-total"]){if(get(id))get(id).textContent="—";}if(get("pa-reconcile-status"))get("pa-reconcile-status").textContent="Loading school relationship checks…";
    get("pa-more").hidden=true;
    get("pa-sheet-source-form").reset();
    get("pa-sheet-preview").disabled=true;get("pa-sheet-clear").disabled=true;
    get("pa-sheet-status").textContent="No Google Sheets roster source loaded.";
  },
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){
      workspace.hidden=true;say("This school has not granted you directory administration access.");
      return;
    }
    canonicalClassMode=scope.current.compatibilityMode==="v4_only";
    standardEnrollmentMode=scope.current.compatibilityMode==="v4_only";
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
      ?"Manila Cathedral School students activate from Enrollment & Registration. Use invitations here for verified staff access."
      :"The invitation is tied to this school person record. Acceptance links the verified account to that person; it still does not create an enrollment or teaching assignment.";
    for(const id of ["pa-student-enrollment-card","pa-bulk-enrollment-card"])
      if(get(id))get(id).hidden=standardEnrollmentMode;
    if(get("pa-classes-help"))get("pa-classes-help").innerHTML=standardEnrollmentMode
      ?'Student enrollment is owned by <a href="school-enrollment.html" style="font-weight:800;text-decoration:underline">Enrollment &amp; Registration</a> for Manila Cathedral School. Teaching assignments, teacher load, schedules and roster review are managed in <a href="school-classes.html" style="font-weight:800;text-decoration:underline">Classes &amp; Scheduling</a>.'
      :"School-specific teaching assignments and class relationships. Changes preserve earlier grades and term history.";
    const enrollmentSummary=get("pa-enrollment-summary-link");
    if(enrollmentSummary)enrollmentSummary.href=standardEnrollmentMode?"school-enrollment.html":"people-access.html#classes";
    if(get("pa-enrollment-summary-action"))get("pa-enrollment-summary-action").textContent=standardEnrollmentMode
      ?"Open Enrollment & Registration →":"Manage enrollment relationships →";
    if(get("pa-legacy-requests-help"))get("pa-legacy-requests-help").innerHTML=standardEnrollmentMode
      ?'Pending requests from the older Adminerva directory are reviewed here during consolidation. Approval creates school-wide person and membership records only; student registration continues in <a href="school-enrollment.html" style="font-weight:800;text-decoration:underline">Enrollment &amp; Registration</a>, while teaching assignments are managed in <a href="school-classes.html" style="font-weight:800;text-decoration:underline">Classes &amp; Scheduling</a>.'
      :"Pending requests from the older Adminerva directory are reviewed here during consolidation. Approval creates school-wide person and membership records only; enrollment and teaching relationships are managed in Teaching & classes.";
    if(get("pa-import-course-help"))get("pa-import-course-help").innerHTML=standardEnrollmentMode
      ?'For Manila Cathedral School, roster import prepares identity records only. Complete official academic placement in <a href="school-enrollment.html" style="font-weight:800;text-decoration:underline">Enrollment &amp; Registration</a>.'
      :"Section values from the roster are hints only. After the people import is committed, review each matched section, choose the exact active course offering, and explicitly enroll the listed students.";
    workspace.hidden=false;schoolReady=true;
    if(requestedPersonId&&requestedPersonSchoolId!==scope.current.schoolId){
      requestedPersonSchoolId=scope.current.schoolId;
      setTab("people",{remember:false});
      void openPersonDetail({personId:requestedPersonId,displayName:"Student record"});
      return;
    }
    // Load only the active section. Large school directories should not fetch
    // six unrelated panels when the administrator only needs the overview.
    void loadSelectedTab(activeTab());
  }
});
async function performRosterSource(action,details={}){
  const lease=picker.scope.lease();
  const result=(await rosterSourceApi({schoolId:lease.schoolId,action,...platformModePayload(),...details})).data;
  picker.scope.assertLease(lease);return result;
}
async function loadRosterSourceStatus(){
  if(pendingWrite)return;
  const run=++rosterSourceRun;
  let result;
  try{result=await performRosterSource("status");}
  catch(error){if(run!==rosterSourceRun||!schoolReady||pendingWrite)return;throw error;}
  if(run!==rosterSourceRun||!schoolReady||pendingWrite)return;
  const form=get("pa-sheet-source-form");
  rosterSourceConfigured=result.configured===true;
  form.elements.url.value=result.url||"";
  get("pa-sheet-preview").disabled=pendingWrite||!rosterSourceConfigured;
  get("pa-sheet-clear").disabled=pendingWrite||!rosterSourceConfigured;
  get("pa-sheet-status").textContent=result.configured?
    "Configured Google Sheets roster source"+(result.gid?" · tab "+result.gid:"")+".":
    "No Google Sheets roster source configured for this school.";
  return result;
}
function clearImportReview(){
  ++importRun;
  importRows=[];importDigest=null;importPreview=null;importCommitted=false;
  get("pa-import-results").replaceChildren();get("pa-import-summary").textContent="No file previewed.";
  get("pa-import-commit").disabled=true;resetImportCourseMapping();
}
function beginImportPreview(){
  const lease=picker.scope.lease();
  clearImportReview();
  return {run:importRun,lease};
}
function currentImportPreview(token){
  if(token.run!==importRun||!schoolReady)return false;
  try{picker.scope.assertLease(token.lease);return true;}catch{return false;}
}
async function previewImportRows(rows,sourceLabel,token){
  if(!currentImportPreview(token))return null;
  importRows=rows;importDigest=null;importPreview=null;importCommitted=false;
  get("pa-import-commit").disabled=true;resetImportCourseMapping("Validating section hints after the roster preview…");
  get("pa-import-status").textContent="Validating "+sourceLabel+" against the active school directory…";
  const preview=await perform("preview_import_people",{rows:importRows});
  if(!currentImportPreview(token))return null;
  importPreview=preview;importDigest=preview.digest;renderImportPreview(preview);renderImportCourseMapping();
  const invalid=Number(preview.summary?.invalid||0);
  get("pa-import-commit").disabled=invalid>0||!importDigest;
  get("pa-import-status").textContent=invalid?
    "Resolve invalid or duplicate rows at the source, then preview again.":
    "Preview ready. Committing creates people only; no access or enrollment will be granted.";
  return preview;
}
function platformModePayload(){
  try{return sessionStorage.getItem("Adminerva_platform_school_mode")==="assist"?{platformMode:"assist"}:{};}catch{return {};}
}
async function perform(action,details={}) {
  const lease=picker.scope.lease();
  const result=await api({schoolId:lease.schoolId,action,...platformModePayload(),...details});
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
  const recognized=headers.filter(Boolean);
  if(new Set(recognized).size!==recognized.length)
    throw new Error("CSV has duplicate columns. Keep one column for each supported field before previewing.");
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
get("pa-sheet-source-form").addEventListener("input",()=>{++rosterSourceRun;});
get("pa-sheet-source-form").addEventListener("submit",event=>{
  event.preventDefault();if(pendingWrite)return;
  const form=event.currentTarget,values=new FormData(form);
  void (async()=>{
    pendingWrite=true;++rosterSourceRun;clearImportReview();
    const controls=[...form.querySelectorAll("button,input")];controls.forEach(control=>control.disabled=true);
    get("pa-sheet-status").textContent="Validating and saving this school roster source…";
    try{
      const result=await performRosterSource("configure",{
        url:String(values.get("url")||"").trim(),
        reason:String(values.get("reason")||"").trim()
      });
      form.elements.url.value=result.url||"";
      rosterSourceConfigured=true;
      form.elements.reason.value="";
      get("pa-sheet-preview").disabled=false;get("pa-sheet-clear").disabled=false;
      get("pa-sheet-status").textContent="Google Sheets roster source saved for this school.";
    }catch(error){get("pa-sheet-status").textContent=error?.message||"Roster source was not saved.";}
    finally{
      pendingWrite=false;
      controls.forEach(control=>control.disabled=false);
      get("pa-sheet-preview").disabled=!rosterSourceConfigured;get("pa-sheet-clear").disabled=!rosterSourceConfigured;
    }
  })();
});
get("pa-sheet-preview").addEventListener("click",()=>{
  if(pendingWrite||!schoolReady||!rosterSourceConfigured)return;
  const token=beginImportPreview();
  void (async()=>{
    const button=get("pa-sheet-preview");button.disabled=true;get("pa-import-commit").disabled=true;
    get("pa-sheet-status").textContent="Fetching the configured published Google Sheet…";
    try{
      const result=await performRosterSource("fetch_csv");
      if(!currentImportPreview(token))return;
      const rows=importRowsFromCsv(result.csv);
      await previewImportRows(rows,"the configured Google Sheet",token);
      if(!currentImportPreview(token))return;
      get("pa-sheet-status").textContent="Google Sheet fetched and previewed. Review the rows before committing.";
    }catch(error){
      if(!currentImportPreview(token))return;
      importRows=[];importDigest=null;importPreview=null;importCommitted=false;resetImportCourseMapping();
      get("pa-import-results").replaceChildren();get("pa-import-summary").textContent="Preview failed.";
      get("pa-sheet-status").textContent=error?.message||"The configured Google Sheet could not be previewed.";
    }finally{if(currentImportPreview(token))button.disabled=pendingWrite||!rosterSourceConfigured;}
  })();
});
get("pa-sheet-clear").addEventListener("click",()=>{
  if(pendingWrite)return;
  const reason=prompt("Explain why this school roster source is being removed:");
  if(reason===null)return;
  void (async()=>{
    pendingWrite=true;++rosterSourceRun;clearImportReview();get("pa-sheet-clear").disabled=true;get("pa-sheet-preview").disabled=true;
    try{
      await performRosterSource("clear",{reason:String(reason).trim()});
      rosterSourceConfigured=false;
      get("pa-sheet-source-form").reset();
      get("pa-sheet-status").textContent="Google Sheets roster source cleared for this school.";
    }catch(error){
      get("pa-sheet-status").textContent=error?.message||"Roster source was not cleared.";
      await loadRosterSourceStatus().catch(()=>{});
    }finally{
      pendingWrite=false;
      get("pa-sheet-clear").disabled=!rosterSourceConfigured;get("pa-sheet-preview").disabled=!rosterSourceConfigured;
    }
  })();
});
get("pa-import-file").addEventListener("change",event=>{
  if(pendingWrite)return;
  clearImportReview();
  get("pa-sheet-preview").disabled=!rosterSourceConfigured;
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
  if(pendingWrite||!schoolReady)return;
  const file=get("pa-import-file").files?.[0];
  if(!file)return;
  const token=beginImportPreview();
  void (async()=>{
    get("pa-import-preview").disabled=true;get("pa-import-commit").disabled=true;
    get("pa-import-status").textContent="Validating this CSV against the active school directory…";
    try{
      if(file.size>512000)throw new Error("CSV is larger than 500 KB.");
      const text=await file.text();
      if(!currentImportPreview(token))return;
      const rows=importRowsFromCsv(text);
      await previewImportRows(rows,"this CSV",token);
    }catch(error){
      if(!currentImportPreview(token))return;
      importRows=[];importDigest=null;importPreview=null;importCommitted=false;resetImportCourseMapping();
      get("pa-import-results").replaceChildren();get("pa-import-summary").textContent="Preview failed.";
      get("pa-import-status").textContent=error?.message||"The CSV could not be previewed.";
    }finally{
      if(currentImportPreview(token)){
        get("pa-import-preview").disabled=pendingWrite||!get("pa-import-file").files?.length;
        get("pa-sheet-preview").disabled=pendingWrite||!rosterSourceConfigured;
      }
    }
  })();
});
get("pa-import-commit").addEventListener("click",()=>{
  if(pendingWrite||!importDigest||!importRows.length)return;
  if(!confirm("Create the previewed school person records? This does not grant accounts, memberships, enrollments, teaching assignments, or grades."))return;
  const reviewedRows=importRows,reviewedPreview=importPreview,reviewedDigest=importDigest;
  void (async()=>{
    pendingWrite=true;++importRun;++rosterSourceRun;
    const controls=[get("pa-import-file"),get("pa-import-preview"),get("pa-import-commit"),
      ...get("pa-sheet-source-form").querySelectorAll("button,input")];
    const disabledBefore=controls.map(control=>control.disabled);
    controls.forEach(control=>control.disabled=true);
    get("pa-import-status").textContent="Committing the exact reviewed roster preview…";
    try{
      const result=await perform("commit_import_people",{rows:reviewedRows,expectedDigest:reviewedDigest});
      const savedMessage=result.alreadyCommitted?
        "This exact import was already committed. No duplicate people were created.":
        "Import committed: "+result.created+" people created · "+result.skipped+" already present.";
      importRows=reviewedRows;importPreview=reviewedPreview;importCommitted=true;importDigest=null;
      get("pa-import-status").textContent=savedMessage;
      const refreshes=await Promise.allSettled([loadPeople(false),loadOverview(),loadInvitePeople(),loadAcademics()]);
      renderImportCourseMapping();
      if(refreshes.some(result=>result.status==="rejected"))
        get("pa-import-status").textContent=savedMessage+" Some school data could not refresh. Reopen the affected tab to retry.";
    }catch(error){
      get("pa-import-status").textContent=error?.message||"Import was not committed. Preview the file again before retrying.";
      importDigest=null;
    }finally{
      pendingWrite=false;
      controls.forEach((control,index)=>control.disabled=disabledBefore[index]);
      get("pa-import-commit").disabled=true;
      get("pa-import-preview").disabled=!get("pa-import-file").files?.length;
      get("pa-sheet-preview").disabled=!rosterSourceConfigured;get("pa-sheet-clear").disabled=!rosterSourceConfigured;
    }
  })();
});

async function performAcademic(action,details={}){
  const lease=picker.scope.lease();
  const response=(await academicsApi({schoolId:lease.schoolId,action,...platformModePayload(),...details})).data;
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
    standardEnrollmentMode?Promise.resolve({students:[]}):performAcademic("list_students").catch(error=>({students:[],unavailable:error?.message||"Student picker unavailable."})),
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
  populateOptions("[data-student-person]",people.students||[],"personId");
  populateOptions("[data-school-teacher]",teachers.teachers||[],"uid");
  populateMultiOptions("[data-student-person-bulk]",people.students||[],"personId");
  populateMultiOptions("[data-school-teacher-bulk]",teachers.teachers||[],"uid");
  renderSectionAssignmentOfferings();
  renderImportCourseMapping();
  if(people.unavailable)say(people.unavailable+" Teaching and class controls remain available.");
}
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
  if(!confirm("Transfer this class to the replacement teacher? The current assignment will end and existing deployed assessment review responsibility will move. Private teacher resources will NOT transfer."))return;
  void submitAcademic(form,"handover_offering",{
    offeringId,fromTeacherUid,toTeacherUid,reason
  },"Teacher handover completed. Private teacher resources kept their original ownership.")
    .then(result=>{
      if(!result)return;
      say("Teacher handover completed · "+Number(result.assessmentCount||0)+
        " deployed assessment review responsibilit"+(Number(result.assessmentCount||0)===1?"y":"ies")+
        " transferred. Private resources were not transferred.");
      if(currentRosterOfferingId===offeringId)
        void loadClassRoster(offeringId).catch(error=>say(error.message||"Refresh class roster."));
    });
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
      lifecycleButton("End enrollment","end_enrollment",{enrollmentId:student.enrollmentId},student.name):
      lifecycleButton("Restore enrollment","restore_enrollment",{enrollmentId:student.enrollmentId},student.name));
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
        teacherUid:teacher.teacherUid,offeringId
      },teacher.name):
      lifecycleButton("Restore assignment","restore_teacher_assignment",{
        teacherUid:teacher.teacherUid,offeringId
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
  const personId=String(data.get("personId")||""),reason=String(data.get("reason")||"").trim();
  if(!personId)return;
  if(!confirm("Activate this verified linked teacher for the selected school? Class assignments remain unchanged."))return;
  void submitForm(form,"activate_linked_staff",{personId,reason}).then(result=>{
    if(!result)return;
    get("pa-staff-access-status").textContent=result.status==="already_active"?
      "This teacher already has active school access.":
      "Teacher school access activated. Assign a class under Classes to enable Class Record.";

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
          name:member.displayName||member.uid.slice(0,9)
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
  void submitForm(form,change.action,{targetUid:change.targetUid,reason}).then(result=>{
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
function openPersonDialog(person,mode){
  personChange={person,mode};
  const form=get("pa-person-dialog-form"),nameField=get("pa-person-name-field"),
    reasonField=get("pa-person-reason-field"),nameInput=form.elements.displayName,
    reasonInput=form.elements.reason,confirm=get("pa-person-dialog-confirm");
  form.reset();get("pa-person-dialog-target").textContent=person.displayName+" · "+person.kind;
  nameField.hidden=mode!=="edit";reasonField.hidden=mode==="edit";
  nameInput.required=mode==="edit";reasonInput.required=mode!=="edit";
  nameInput.value=person.displayName||"";
  get("pa-person-dialog-title").textContent=mode==="edit"?"Edit school person":
    mode==="archive"?"Archive school person":"Restore school person";
  confirm.textContent=mode==="edit"?"Save name":mode==="archive"?"Archive person":"Restore person";
  confirm.style.background=mode==="archive"?"#9a3412":mode==="restore"?"#166534":"#1d4ed8";
  get("pa-person-dialog-help").textContent=mode==="archive"?
    "Archiving is blocked until active school access, enrollments or teaching assignments are ended. Nothing is deleted.":
    mode==="restore"?"Restoring the person record does not automatically restore school access, enrollments or teaching assignments.":
    "Updating the display name also updates the linked school membership label when one exists.";
  get("pa-person-dialog").showModal();
}
get("pa-person-dialog-cancel").addEventListener("click",()=>{
  if(pendingWrite)return;
  personChange=null;get("pa-person-dialog").close();
});
get("pa-person-dialog-form").addEventListener("submit",event=>{
  event.preventDefault();if(!personChange||pendingWrite)return;
  const form=event.currentTarget,{person,mode}=personChange,values=new FormData(form);
  const action=mode==="edit"?"update_person":mode==="archive"?"archive_person":"restore_person";
  const details={personId:person.personId};
  if(mode==="edit")details.displayName=String(values.get("displayName")||"").trim();
  else details.reason=String(values.get("reason")||"").trim();
  const warning=mode==="archive"?
    "Archive this school person record? Active access and academic assignments must already be ended.":
    mode==="restore"?"Restore this school person record without automatically restoring access or enrollment?":null;
  if(warning&&!confirm(warning))return;
  void submitForm(form,action,details).then(result=>{
    if(!result)return;
    personChange=null;get("pa-person-dialog").close();
  });
});

for(const id of ["pa-person-dialog","pa-suspension-dialog","pa-academic-lifecycle-dialog"]){
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
async function openPersonDetail(person){
  const run=++detailRun,dialog=get("pa-person-detail-dialog");
  get("pa-person-detail-title").textContent=person.displayName;
  get("pa-person-detail-meta").textContent="Loading school-scoped identity and academic context…";
  get("pa-person-detail-access").textContent="—";
  get("pa-person-detail-relationships").textContent="—";
  for(const id of ["pa-person-detail-invites","pa-person-detail-links","pa-person-detail-audit"])get(id).replaceChildren();
  dialog.showModal();
  try{
    const result=await perform("get_person",{personId:person.personId});
    if(!dialog.open||run!==detailRun||!schoolReady)return;
    const p=result.person;
    get("pa-person-detail-title").textContent=p.displayName;
    get("pa-person-detail-meta").textContent=p.kind+" · "+p.status+" · directory revision "+p.revision+
      (p.accountLinked?" · verified account linked":" · no account linked");
    get("pa-person-detail-access").textContent=result.membership?
      result.membership.status+" · "+result.membership.roles.join(", "):"No school membership";
    get("pa-person-detail-relationships").textContent=String(result.relationships?.length||0);
    const classesAction=get("pa-person-detail-classes-action"),enrollmentAction=get("pa-person-detail-enrollment-action");
    if(p.kind==="student"&&standardEnrollmentMode){
      classesAction.hidden=true;enrollmentAction.style.display="inline-flex";
    }else{
      classesAction.hidden=false;classesAction.textContent=p.kind==="student"?"Enrollment relationships":"Teaching & classes";
      enrollmentAction.style.display="none";
    }
    renderDetailList(get("pa-person-detail-invites"),result.invitations,item=>
      detailRow(item.requestedRole||"Invitation",(item.status||"unknown")+
        (item.expiresAt?" · expires "+new Date(item.expiresAt).toLocaleString():"")),
      "No invitation records");
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
get("pa-person-detail-close").addEventListener("click",()=>get("pa-person-detail-dialog").close());

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
      const edit=document.createElement("button");edit.type="button";edit.className="pa-action";edit.textContent="Edit";
      edit.addEventListener("click",()=>openPersonDialog(person,"edit"));
      actions.append(edit);
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
