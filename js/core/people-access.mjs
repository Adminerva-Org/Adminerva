import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs";
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"peopleDirectory");
const rosterSourceApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolRosterSource");
const get=id=>document.getElementById(id);
const academicsApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
let schoolTerms=[],schoolSections=[],schoolOfferings=[];
const status=get("school-status"),workspace=get("pa-workspace"),list=get("pa-person-list");
let after=null,loadingPeople=false,pendingWrite=false;
let accessChange=null,personChange=null,lifecycleChange=null,currentRosterOfferingId=null,peopleSearchTimer=null,importRows=[],importDigest=null,importPreview=null,importCommitted=false;
function say(message){status.textContent=message;}
const tabNames=new Set(["overview","people","import","invites","classes","access"]);
function setTab(name,{remember=true}={}) {
  const target=tabNames.has(name)?name:"overview";
  for(const button of document.querySelectorAll("[data-tab]")){
    const active=button.dataset.tab===target;
    button.setAttribute("aria-selected",String(active));
    get("pa-"+button.dataset.tab).hidden=!active;
  }
  if(remember&&location.hash!=="#"+target)
    history.replaceState(null,"","#"+target);
}
document.querySelectorAll("[data-tab]").forEach(button=>
  button.addEventListener("click",()=>setTab(button.dataset.tab)));
window.addEventListener("hashchange",()=>setTab(location.hash.slice(1),{remember:false}));
setTab(location.hash.slice(1),{remember:false});
const picker=createTenantSchoolPicker({
  host:get("school-picker-host"),status,
  onBeforeChange:async()=>{
    if(pendingWrite)throw new Error("Finish saving before switching schools.");
    workspace.hidden=true;list.replaceChildren();get("pa-invitation-result").replaceChildren();get("pa-class-roster").replaceChildren();get("pa-membership-list").replaceChildren();get("pa-invite-person").replaceChildren();get("pa-suspension-dialog").close?.();get("pa-person-dialog").close?.();get("pa-academic-lifecycle-dialog").close?.();accessChange=null;personChange=null;lifecycleChange=null;currentRosterOfferingId=null;after=null;importRows=[];importDigest=null;importPreview=null;importCommitted=false;schoolSections=[];schoolOfferings=[];get("pa-import-results").replaceChildren();get("pa-import-summary").textContent="No file previewed.";get("pa-import-status").textContent="Choose a CSV with up to 200 people.";get("pa-import-file").value="";get("pa-import-preview").disabled=true;get("pa-import-commit").disabled=true;resetImportCourseMapping();
    get("pa-more").hidden=true;
  },
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){
      workspace.hidden=true;say("This school has not granted you directory administration access.");
      return;
    }
    workspace.hidden=false;
    void Promise.all([loadOverview(),loadPeople(false),loadAcademics(),loadMemberships(),loadInvitePeople(),loadRosterSourceStatus()]).catch(error=>say(error.message||"Directory access unavailable."));
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
  const select=get("pa-invite-person"),previous=select.value;
  select.replaceChildren();
  const loading=document.createElement("option");loading.value="";loading.disabled=true;loading.selected=true;
  loading.textContent="Loading active unlinked "+(role==="student"?"students":"staff")+"…";select.append(loading);
  try{
    const result=await perform("list_invitable_people",{role});
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
  return [item.sectionId,item.subjectId,item.termId,item.yearId].filter(Boolean).join(" · ");
}
function renderImportCourseMapping(){
  const host=get("pa-import-course-groups"),statusNode=get("pa-import-course-status");
  if(!host||!statusNode)return;
  host.replaceChildren();
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
function refreshTerms(){
  const year=get("pa-offering-form").elements.yearId.value;
  populateOptions('#pa-offering-form [data-catalog="terms"]',
    schoolTerms.filter(item=>item.yearId===year),"id");
}
async function loadAcademics(){
  const kinds=["academic_years","terms","subjects","sections"];
  const [catalogs,offerings,people,teachers]=await Promise.all([
    Promise.all(kinds.map(kind=>performAcademic("list_catalog",{kind}))),
    performAcademic("list_offerings"),
    performAcademic("list_students"),
    performAcademic("list_teachers")
  ]);
  for(let i=0;i<kinds.length;i++){
    if(kinds[i]==="terms"){schoolTerms=catalogs[i].items||[];continue;}
    if(kinds[i]==="sections")schoolSections=catalogs[i].items||[];
    populateOptions('[data-catalog="'+kinds[i]+'"]',catalogs[i].items||[],"id");
  }
  refreshTerms();
  schoolOfferings=offerings.offerings||[];
  populateOptions("[data-offering]",schoolOfferings,"offeringId","offeringId");
  populateOptions("[data-student-person]",people.students||[],"personId");
  populateOptions("[data-school-teacher]",teachers.teachers||[],"uid");
  populateMultiOptions("[data-student-person-bulk]",people.students||[],"personId");
  populateMultiOptions("[data-school-teacher-bulk]",teachers.teachers||[],"uid");
  renderImportCourseMapping();
}
get("pa-bulk-enrollment-form").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget;
  const personIds=[...form.elements.personIds.selectedOptions].map(option=>option.value);
  const offeringId=String(form.elements.offeringId.value||"");
  const reason=String(form.elements.reason.value||"").trim();
  if(!personIds.length){say("Select at least one student for bulk enrollment.");return;}
  if(!confirm("Enroll "+personIds.length+" selected student(s) into this course offering? Existing active enrollments will be skipped."))return;
  void submitAcademic(form,"bulk_enroll_students",{personIds,offeringId,reason},
    "Bulk enrollment completed. Existing history was preserved.").then(async saved=>{
      if(!saved)return;
      await loadAcademics();
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
    "Bulk teacher assignment completed. Existing history was preserved.").then(async saved=>{
      if(!saved)return;
      await loadAcademics();
    });
});
get("pa-offering-form").elements.yearId.addEventListener("change",refreshTerms);
get("pa-catalog-kind").addEventListener("change",event=>{
  get("pa-term-year").hidden=event.target.value!=="terms";
  get("pa-term-year").querySelector("select").required=event.target.value==="terms";
});
async function submitAcademic(form,action,fields,message){
  if(pendingWrite)return;
  pendingWrite=true;
  const button=form.querySelector('button[type="submit"]');
  button.disabled=true;say("Saving academic records for your school…");
  try{
    const result=await performAcademic(action,fields);
    say(message);
    form.reset();
    await loadAcademics();
    return result||true;
  }catch(error){say(error?.message||"Academic operation was not saved.");return false;}
  finally{pendingWrite=false;button.disabled=false;}
}
get("pa-catalog-form").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget,d=new FormData(form);
  void submitAcademic(form,"create_catalog",{
    kind:String(d.get("kind")||""),recordId:String(d.get("recordId")||"").trim(),
    name:String(d.get("name")||"").trim(),yearId:String(d.get("yearId")||"")||null
  },"Academic catalog record created.");
});
get("pa-offering-form").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget,d=new FormData(form);
  void submitAcademic(form,"create_offering",Object.fromEntries(
    ["yearId","termId","subjectId","sectionId"].map(k=>[k,String(d.get(k)||"")])
  ),"Class offering created without altering historical grades.");
});
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
  currentRosterOfferingId=offeringId;target.replaceChildren();say("Loading class roster…");
  const result=await performAcademic("class_roster",{offeringId});
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
async function loadMemberships(){
  const result=await perform("list_memberships");
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
get("pa-cancel-suspend").addEventListener("click",()=>{accessChange=null;get("pa-suspension-dialog").close();});
get("pa-suspension-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(!accessChange)return;
  const form=event.currentTarget,change=accessChange;
  const reason=String(new FormData(form).get("reason")||"").trim();
  const restoring=change.action==="restore_access";
  if(!confirm(restoring?
    "Restore this account for the current school after its linked identity is revalidated?":
    "Suspend this account for the current school? Existing grades and evidence will be preserved."))return;
  void submitForm(form,change.action,{targetUid:change.targetUid,reason}).then(result=>{
    if(!result)return;
    get("pa-suspension-dialog").close();accessChange=null;
    void loadMemberships().catch(error=>say(error.message||"Refresh membership access status."));
  });
});
async function loadOverview(){
  const response=await perform("overview");
  get("pa-people-count").textContent=response.counts.people;
  get("pa-enroll-count").textContent=response.counts.enrollments;
  get("pa-staff-count").textContent=response.counts.staff_assignments;
  get("pa-invite-count").textContent=response.counts.invitations;
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
    personChange=null;get("pa-person-dialog").close();after=null;
    void Promise.all([loadPeople(false),loadOverview(),loadInvitePeople(),loadMemberships(),loadAcademics()])
      .catch(error=>say(error.message||"Refresh the updated directory."));
  });
});

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
  const dialog=get("pa-person-detail-dialog");
  get("pa-person-detail-title").textContent=person.displayName;
  get("pa-person-detail-meta").textContent="Loading school-scoped identity and academic context…";
  get("pa-person-detail-access").textContent="—";
  get("pa-person-detail-relationships").textContent="—";
  for(const id of ["pa-person-detail-invites","pa-person-detail-links","pa-person-detail-audit"])get(id).replaceChildren();
  dialog.showModal();
  try{
    const result=await perform("get_person",{personId:person.personId});
    if(!dialog.open)return;
    const p=result.person;
    get("pa-person-detail-title").textContent=p.displayName;
    get("pa-person-detail-meta").textContent=p.kind+" · "+p.status+" · directory revision "+p.revision+
      (p.accountLinked?" · verified account linked":" · no account linked");
    get("pa-person-detail-access").textContent=result.membership?
      result.membership.status+" · "+result.membership.roles.join(", "):"No school membership";
    get("pa-person-detail-relationships").textContent=String(result.relationships?.length||0);
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
    get("pa-person-detail-meta").textContent=error?.message||"Person details are unavailable.";
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
  if(loadingPeople)return;
  loadingPeople=true;const button=get("pa-more"),note=get("pa-person-filter-note");
  button.disabled=true;
  try {
    const filters=directoryFilters(),filtered=directoryFilterActive(filters);
    const response=filtered?
      await perform("search_people",filters):
      await perform("list_people",append&&after?{after}:undefined);
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
  }catch(error){say(error.message||"Could not load this school directory.");}
  finally{loadingPeople=false;button.disabled=false;}
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
    if(["create_person","update_person","archive_person","restore_person"].includes(action))
      await Promise.all([loadPeople(false),loadOverview(),loadAcademics(),loadInvitePeople(),loadMemberships()]);
    else await loadOverview();
    return result;
  }catch(error){say(error.message||"This change was not saved.");return null;}
  finally{pendingWrite=false;button.disabled=false;}
}
get("pa-add-person").addEventListener("submit",event=>{
  event.preventDefault();const values=new FormData(event.currentTarget);
  void submitForm(event.currentTarget,"create_person",{person:{
    displayName:String(values.get("displayName")||""),kind:String(values.get("kind")||"")
  }});
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
