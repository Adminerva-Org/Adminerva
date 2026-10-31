import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs";
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"peopleDirectory");
const get=id=>document.getElementById(id);
const academicsApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
let schoolTerms=[];
const status=get("school-status"),workspace=get("pa-workspace"),list=get("pa-person-list");
let after=null,loadingPeople=false,pendingWrite=false;
let suspendUid=null;
function say(message){status.textContent=message;}
function setTab(name) {
  for(const button of document.querySelectorAll("[data-tab]")){
    const active=button.dataset.tab===name;
    button.setAttribute("aria-selected",String(active));
    get("pa-"+button.dataset.tab).hidden=!active;
  }
}
document.querySelectorAll("[data-tab]").forEach(button=>button.addEventListener("click",()=>setTab(button.dataset.tab)));
const picker=createTenantSchoolPicker({
  host:get("school-picker-host"),status,
  onBeforeChange:async()=>{
    if(pendingWrite)throw new Error("Finish saving before switching schools.");
    workspace.hidden=true;list.replaceChildren();get("pa-invitation-result").replaceChildren();get("pa-class-roster").replaceChildren();get("pa-membership-list").replaceChildren();get("pa-suspension-dialog").close?.();suspendUid=null;after=null;
    get("pa-more").hidden=true;
  },
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){
      workspace.hidden=true;say("This school has not granted you directory administration access.");
      return;
    }
    workspace.hidden=false;
    void Promise.all([loadOverview(),loadPeople(false),loadAcademics(),loadMemberships()]).catch(error=>say(error.message||"Directory access unavailable."));
  }
});
async function perform(action,details={}) {
  const lease=picker.scope.lease();
  const result=await api({schoolId:lease.schoolId,action,...details});
  picker.scope.assertLease(lease);
  return result.data;
}
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
    populateOptions('[data-catalog="'+kinds[i]+'"]',catalogs[i].items||[],"id");
  }
  refreshTerms();
  const offeringRows=offerings.offerings||[];
  populateOptions("[data-offering]",offeringRows,"offeringId","offeringId");
  populateOptions("[data-student-person]",people.students||[],"personId");
  populateOptions("[data-school-teacher]",teachers.teachers||[],"uid");
}
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
    await performAcademic(action,fields);
    say(message);
    form.reset();
    await loadAcademics();
  }catch(error){say(error?.message||"Academic operation was not saved.");}
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
get("pa-roster-form").addEventListener("submit",event=>{
  event.preventDefault();
  const target=get("pa-class-roster"),id=String(new FormData(event.currentTarget).get("offeringId")||"");
  target.replaceChildren();say("Loading class roster…");
  void performAcademic("class_roster",{offeringId:id}).then(result=>{
    const people=result.students||[];
    if(!people.length){const empty=document.createElement("p");empty.className="pa-muted";
      empty.textContent="No students enrolled in this offering.";target.append(empty);}
    for(const student of people){
      const row=document.createElement("div");row.className="pa-row";row.setAttribute("role","listitem");
      row.textContent=student.name;target.append(row);
    }
    say(people.length+" students enrolled in the selected offering.");
  }).catch(error=>say(error.message||"Roster unavailable."));
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
    if(member.status==="active"&&!member.roles.includes("school_admin")&&
      member.uid!==picker.scope.current?.uid){
      const button=document.createElement("button");button.type="button";button.className="pa-action";
      button.style.background="#9a3412";button.textContent="Suspend access";
      button.addEventListener("click",()=>{
        suspendUid=member.uid;
        get("pa-suspension-member").textContent=member.displayName||member.uid.slice(0,9);
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
get("pa-cancel-suspend").addEventListener("click",()=>get("pa-suspension-dialog").close());
get("pa-suspension-form").addEventListener("submit",event=>{
  event.preventDefault();
  if(!suspendUid)return;
  const form=event.currentTarget;
  const reason=String(new FormData(form).get("reason")||"").trim();
  if(!confirm("Suspend this account for the current school? Existing grades and evidence will be preserved."))return;
  void submitForm(form,"suspend_access",{targetUid:suspendUid,reason}).then(result=>{
    if(!result)return;
    get("pa-suspension-dialog").close();suspendUid=null;
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
async function loadPeople(append) {
  if(loadingPeople)return;
  loadingPeople=true;const button=get("pa-more");button.disabled=true;
  try {
    const response=await perform("list_people",append&&after?{after}:undefined);
    if(!append)list.replaceChildren();
    for(const person of response.items){
      const row=document.createElement("div");row.className="pa-row";row.setAttribute("role","listitem");
      const identity=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("div");
      name.textContent=person.displayName;meta.className="pa-muted";
      meta.textContent=person.kind+" · "+person.status+" · "+(person.accountLinked?"Account linked":"Account not linked");
      identity.append(name,meta);row.append(identity);list.append(row);
    }
    if(!list.children.length){
      const empty=document.createElement("p");empty.className="pa-muted";
      empty.textContent="No people records yet. Verify migration before importing historical rosters.";
      list.append(empty);
    }
    after=response.nextCursor;button.hidden=!after;
  }catch(error){say(error.message||"Could not load this school directory.");}
  finally{loadingPeople=false;button.disabled=false;}
}
get("pa-more").addEventListener("click",()=>void loadPeople(true));
async function submitForm(form,action,details) {
  if(pendingWrite)return null;
  const button=form.querySelector('button[type="submit"]');
  pendingWrite=true;button.disabled=true;say("Saving within your verified school…");
  try {
    const result=await perform(action,details);
    form.reset();
    say(action==="invite"?"Pending invitation recorded. Access has not been granted.":
      action==="suspend_access"?"School access suspended. Historical academic records were preserved.":
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
    if(action==="create_person")await Promise.all([loadPeople(false),loadOverview(),loadAcademics()]);
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
    email:String(values.get("email")||""),role:String(values.get("role")||"")
  });
});
try{
  await picker.load();
  if(!auth.currentUser){
    say("Sign in to use the school directory.");
    const link=document.createElement("a");link.href="login.html";link.textContent="Go to sign in";
    status.append(" ",link);
  }
}catch(error){say(error.message||"Unable to check your school membership.");}
