import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.1";

const el=id=>document.getElementById(id);
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
const params=new URLSearchParams(location.search);
let picker=null,busy=false,epoch=0,view=["classes","teachers","sections"].includes(params.get("view"))?params.get("view"):"classes";
let model={teachers:[],offerings:[]},selectedId=String(params.get("offeringId")||""),roster=null;

function platformMode(){
  try{return sessionStorage.getItem("Adminerva_platform_school_mode")==="assist"?"assist":undefined;}catch{return undefined;}
}
function say(message,error=false){
  const node=el("csStatus");node.textContent=message;node.className="text-sm "+(error?"text-rose-700":"text-slate-600");
}
function make(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node;}
function teacherMap(){return new Map((model.teachers||[]).map(row=>[row.uid,row]));}
function classLabel(item){return [item.subjectName,item.sectionName].filter(Boolean).join(" · ")||item.offeringId;}
function classMeta(item){return [item.termName,item.yearName,item.programName].filter(Boolean).join(" · ");}
function selected(){return (model.offerings||[]).find(row=>row.offeringId===selectedId)||null;}
function enrollmentRoute(){
  const school=picker?.scope?.current;
  return school?.schoolId==="manila-cathedral-school"&&school?.compatibilityMode==="v4_only"?
    "school-enrollment.html":"people-access.html#classes";
}
async function scoped(action,details={}){
  if(!picker?.scope.current)throw Error("Choose a verified school first.");
  const lease=picker.scope.lease(),mode=platformMode();
  const response=await api({schoolId:lease.schoolId,action,...details,...(mode?{platformMode:mode}:{})});
  picker.scope.assertLease(lease);return response.data;
}
function setBusy(value){
  busy=value;
  for(const node of document.querySelectorAll("button,select,input,textarea"))if(node.id!=="csSearch")node.disabled=value;
}
function uniqueValues(field){
  return [...new Map((model.offerings||[]).map(row=>[row[field],row[field]]).filter(([value])=>value)).values()].sort((a,b)=>String(a).localeCompare(String(b)));
}
function fillFilters(){
  const pairs=[["csYearFilter","yearName"],["csTermFilter","termName"]];
  for(const [id,field] of pairs){
    const node=el(id),current=node.value,first=node.options[0]?.textContent||"All";
    node.replaceChildren(new Option(first,""));
    for(const value of uniqueValues(field))node.add(new Option(value,value));
    if([...node.options].some(option=>option.value===current))node.value=current;
  }
}
function filterOfferings(){
  const search=el("csSearch").value.trim().toLowerCase(),year=el("csYearFilter").value,term=el("csTermFilter").value,teachers=teacherMap();
  return (model.offerings||[]).filter(row=>{
    if(year&&row.yearName!==year)return false;if(term&&row.termName!==term)return false;
    if(!search)return true;
    const staff=(row.teacherUids||[]).map(uid=>teachers.get(uid)?.name||uid).join(" ");
    return [row.subjectName,row.sectionName,row.termName,row.yearName,row.programName,staff].some(value=>String(value||"").toLowerCase().includes(search));
  });
}
function renderSummary(){
  const classes=model.offerings||[],sections=new Set(classes.map(row=>row.sectionId).filter(Boolean));
  el("csClassCount").textContent=classes.length.toLocaleString();
  el("csUnstaffedCount").textContent=classes.filter(row=>!(row.teacherUids||[]).length).length.toLocaleString();
  el("csTeacherCount").textContent=(model.teachers||[]).length.toLocaleString();
  el("csSectionCount").textContent=sections.size.toLocaleString();
}
function setView(next,{replace=false}={}){
  view=next;
  for(const button of document.querySelectorAll("[data-cs-view]")){
    const active=button.dataset.csView===view;
    button.className="cs-view rounded-lg px-4 py-2.5 text-sm font-"+(active?"extrabold bg-blue-600 text-white":"bold border border-slate-300 bg-white text-slate-800");
    button.setAttribute("aria-selected",String(active));
  }
  const copy={
    classes:["Class offerings","Classes","Each row is one subject taught to one section in one academic period."],
    teachers:["Derived workload","Teachers","Teacher load is calculated from active class assignments. It is not maintained as a separate record."],
    sections:["Section coverage","Sections","See every class attached to a section and which teachers currently cover it."]
  }[view];
  el("csViewEyebrow").textContent=copy[0];el("csViewTitle").textContent=copy[1];el("csViewHelp").textContent=copy[2];
  const url=new URL(location.href);if(view==="classes")url.searchParams.delete("view");else url.searchParams.set("view",view);
  history[replace?"replaceState":"pushState"]({},"",url);renderList();
}
function button(text,handler,cls="border border-slate-300 bg-white text-slate-800"){
  const node=make("button","rounded-lg px-3 py-2 text-xs font-bold "+cls,text);node.type="button";node.addEventListener("click",handler);return node;
}
function empty(message){return make("div","rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600",message);}
function renderClasses(rows){
  const host=el("csList");host.replaceChildren();if(!rows.length){host.append(empty("No classes match these filters."));return;}
  const wrap=make("div","overflow-x-auto"),table=make("table","w-full text-sm"),thead=make("thead","bg-slate-50 text-left text-xs uppercase text-slate-500"),tr=make("tr");
  for(const label of ["Class","Period","Teacher(s)","Status",""])tr.append(make("th","px-3 py-3 font-extrabold",label));thead.append(tr);table.append(thead);
  const body=make("tbody","divide-y divide-slate-200"),teachers=teacherMap();
  for(const row of rows){
    const r=make("tr","align-top hover:bg-slate-50");
    const title=make("td","px-3 py-3");title.append(make("strong","block text-slate-900",classLabel(row)),make("span","block text-xs text-slate-500 mt-1",row.programName||""));
    const period=make("td","px-3 py-3 text-slate-600", [row.termName,row.yearName].filter(Boolean).join(" · "));
    const names=(row.teacherUids||[]).map(uid=>teachers.get(uid)?.name||("Teacher "+uid.slice(0,8)));
    const staff=make("td","px-3 py-3",names.length?names.join(", "):"Unassigned");if(!names.length)staff.className+=" font-bold text-amber-700";
    const status=make("td","px-3 py-3",row.invalidGrantCount?row.invalidGrantCount+" assignment issue"+(row.invalidGrantCount===1?"":"s"):"Ready");
    if(row.invalidGrantCount)status.className+=" text-rose-700 font-bold";else status.className+=" text-emerald-700";
    const action=make("td","px-3 py-3 text-right");action.append(button("Manage",()=>void openClass(row.offeringId),"bg-blue-700 text-white"));
    r.append(title,period,staff,status,action);body.append(r);
  }
  table.append(body);wrap.append(table);host.append(wrap);
}
function renderTeachers(rows){
  const host=el("csList");host.replaceChildren();const visibleIds=new Set(rows.flatMap(row=>row.teacherUids||[]));
  const teachers=(model.teachers||[]).map(teacher=>({teacher,classes:rows.filter(row=>(row.teacherUids||[]).includes(teacher.uid))}))
    .filter(item=>!el("csSearch").value.trim()||visibleIds.has(item.teacher.uid)||item.teacher.name.toLowerCase().includes(el("csSearch").value.trim().toLowerCase()))
    .sort((a,b)=>b.classes.length-a.classes.length||a.teacher.name.localeCompare(b.teacher.name));
  if(!teachers.length){host.append(empty("No teachers match these filters."));return;}
  const grid=make("div","grid md:grid-cols-2 gap-3");
  for(const item of teachers){
    const card=make("article","rounded-xl border border-slate-200 p-4");
    card.append(make("h3","font-extrabold",item.teacher.name),make("p","text-xs text-slate-500 mt-1",item.classes.length+" active class"+(item.classes.length===1?"":"es")));
    const list=make("div","mt-3 space-y-2");
    if(!item.classes.length)list.append(make("p","text-sm text-slate-500","No active classes in the selected period."));
    for(const row of item.classes.slice(0,8)){
      const link=make("button","block w-full text-left rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm","");link.type="button";
      link.append(make("strong","block",classLabel(row)),make("span","block text-xs text-slate-500",classMeta(row)));link.addEventListener("click",()=>void openClass(row.offeringId));list.append(link);
    }
    card.append(list);grid.append(card);
  }host.append(grid);
}
function renderSections(rows){
  const host=el("csList");host.replaceChildren(),groups=new Map(),teachers=teacherMap();
  for(const row of rows){const key=row.sectionId||row.sectionName||"unknown",entry=groups.get(key)||{name:row.sectionName||"Unspecified section",classes:[]};entry.classes.push(row);groups.set(key,entry);}
  if(!groups.size){host.append(empty("No sections match these filters."));return;}
  const grid=make("div","grid lg:grid-cols-2 gap-3");
  for(const entry of [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name))){
    const card=make("article","rounded-xl border border-slate-200 p-4");card.append(make("h3","font-extrabold",entry.name),make("p","text-xs text-slate-500 mt-1",entry.classes.length+" class"+(entry.classes.length===1?"":"es")+" in the selected scope"));
    const list=make("div","mt-3 divide-y divide-slate-100");
    for(const row of entry.classes.sort((a,b)=>String(a.subjectName).localeCompare(String(b.subjectName)))){
      const line=make("button","w-full py-2 text-left text-sm","");line.type="button";
      const names=(row.teacherUids||[]).map(uid=>teachers.get(uid)?.name||uid.slice(0,8)).join(", ")||"Unassigned";
      line.append(make("strong","block",row.subjectName||row.subjectId),make("span","block text-xs "+(names==="Unassigned"?"text-amber-700 font-bold":"text-slate-500"),names+" · "+(row.termName||"")));
      line.addEventListener("click",()=>void openClass(row.offeringId));list.append(line);
    }card.append(list);grid.append(card);
  }host.append(grid);
}
function renderList(){
  const rows=filterOfferings();if(view==="teachers")renderTeachers(rows);else if(view==="sections")renderSections(rows);else renderClasses(rows);
}
function renderTeacherSelectors(){
  const active=new Set((roster?.staff||[]).filter(row=>row.status==="active").map(row=>row.teacherUid));
  const assign=el("csAssignTeacher");assign.replaceChildren(new Option("Choose teacher…",""));
  const handoverTo=el("csHandoverTo");handoverTo.replaceChildren(new Option("Choose replacement…",""));
  for(const row of model.teachers||[]){
    if(!active.has(row.uid))assign.add(new Option(row.name,row.uid));
    handoverTo.add(new Option(row.name,row.uid));
  }
  const from=el("csHandoverFrom");from.replaceChildren(new Option("Current teacher…",""));
  for(const row of (roster?.staff||[]).filter(row=>row.status==="active"))from.add(new Option(row.name,row.teacherUid));
  el("csAssignForm").hidden=assign.options.length<=1;
  el("csHandoverForm").hidden=from.options.length<=1||handoverTo.options.length<=1;
}
function renderDetail(){
  const item=selected();if(!item){el("csDetail").hidden=true;el("csDetailEmpty").hidden=false;return;}
  el("csDetailEmpty").hidden=true;el("csDetail").hidden=false;el("csDetailTitle").textContent=classLabel(item);el("csDetailMeta").textContent=classMeta(item);
  const staff=el("csStaffList");staff.replaceChildren();const active=(roster?.staff||[]).filter(row=>row.status==="active");
  el("csStaffCount").textContent=active.length+" active";
  if(!active.length)staff.append(empty("No teacher is assigned to this class."));
  for(const row of active){
    const card=make("div","flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3");
    const text=make("div","min-w-0");text.append(make("strong","block truncate",row.name),make("span","block text-xs text-slate-500","Teaching assignment"));
    const end=button("Remove",()=>void endAssignment(row),"border border-rose-200 bg-white text-rose-700");card.append(text,end);staff.append(card);
  }
  const students=(roster?.students||[]).filter(row=>row.status==="active"),rosterHost=el("csRoster");rosterHost.replaceChildren();el("csStudentCount").textContent=students.length+" active";
  if(!students.length)rosterHost.append(make("p","p-4 text-sm text-slate-500","No active students are enrolled in this class."));
  else{
    const list=make("ol","divide-y divide-slate-100");
    students.sort((a,b)=>String(a.name).localeCompare(String(b.name))).forEach((row,index)=>{const li=make("li","flex gap-3 px-3 py-2 text-sm");li.append(make("span","text-slate-400 w-6 text-right",index+1),make("span","font-medium",row.name));list.append(li);});rosterHost.append(list);
  }
  renderTeacherSelectors();
  el("csRecordLink").href="school-class-records.html?offeringId="+encodeURIComponent(item.offeringId);
  el("csEnrollmentClassLink").href=enrollmentRoute();
}
async function openClass(offeringId){
  selectedId=offeringId;roster=null;renderDetail();say("Loading class roster…");
  const url=new URL(location.href);url.searchParams.set("offeringId",offeringId);history.replaceState({},"",url);
  const turn=++epoch;
  try{const result=await scoped("class_roster",{offeringId});if(turn!==epoch||selectedId!==offeringId)return;roster=result;renderDetail();say("Class ready: "+classLabel(selected())+".");}
  catch(error){if(turn===epoch){say(error?.message||"Class roster could not load.",true);renderDetail();}}
}
async function mutate(action,details,success){
  if(busy||!selected())return;setBusy(true);say("Saving class assignment…");
  try{await scoped(action,details);await loadOverview({preserveSelection:true});say(success);}
  catch(error){say(error?.message||"The class assignment could not be changed.",true);}
  finally{setBusy(false);}
}
async function endAssignment(row){
  const reason=prompt("Reason for removing "+row.name+" from this class (at least 12 characters):","Teaching assignment ended");
  if(reason===null)return;if(reason.trim().length<12){say("Explain the teaching assignment change in at least 12 characters.",true);return;}
  await mutate("end_teacher_assignment",{teacherUid:row.teacherUid,offeringId:selectedId,reason:reason.trim()},"Teacher removed from this class.");
}
async function loadOverview({preserveSelection=false}={}){
  if(!picker?.scope.current||busy)return;const turn=++epoch;say("Loading classes and teaching assignments…");
  try{
    const result=await scoped("faculty_workload");if(turn!==epoch)return;
    model={teachers:result.teachers||[],offerings:result.offerings||[]};renderSummary();fillFilters();renderList();
    const enroll=enrollmentRoute();el("csEnrollmentLink").href=enroll;el("csEnrollmentClassLink").href=enroll;
    const requested=preserveSelection?selectedId:(selectedId&&model.offerings.some(row=>row.offeringId===selectedId)?selectedId:"");
    selectedId=requested;roster=null;renderDetail();
    if(selectedId)await openClass(selectedId);else say(model.offerings.length?"Scheduling workspace ready.":"No active classes exist yet. Create course offerings in Academic Configuration.");
  }catch(error){if(turn===epoch){model={teachers:[],offerings:[]};renderSummary();renderList();say(error?.message||"Classes & Scheduling could not load.",true);}}
}
el("csAssignForm").addEventListener("submit",event=>{
  event.preventDefault();const teacherUid=el("csAssignTeacher").value;if(!teacherUid||!selectedId)return;
  void mutate("assign_teacher",{teacherUid,offeringId:selectedId},"Teacher assigned. Their teaching load now includes this class.");
});
el("csHandoverForm").addEventListener("submit",event=>{
  event.preventDefault();const fromTeacherUid=el("csHandoverFrom").value,toTeacherUid=el("csHandoverTo").value,reason=el("csHandoverReason").value.trim();
  if(!fromTeacherUid||!toTeacherUid){say("Choose both the current and replacement teacher.",true);return;}
  if(fromTeacherUid===toTeacherUid){say("Choose a different replacement teacher.",true);return;}
  if(reason.length<12){say("Explain the teacher change in at least 12 characters.",true);return;}
  void mutate("handover_offering",{offeringId:selectedId,fromTeacherUid,toTeacherUid,reason},"Teaching responsibility transferred with assessment review ownership.");
});
for(const node of [el("csSearch"),el("csYearFilter"),el("csTermFilter")])node.addEventListener(node.tagName==="INPUT"?"input":"change",renderList);
for(const node of document.querySelectorAll("[data-cs-view]"))node.addEventListener("click",()=>setView(node.dataset.csView));
el("csRefresh").addEventListener("click",()=>void loadOverview({preserveSelection:true}));
window.addEventListener("popstate",()=>{const next=new URLSearchParams(location.search).get("view");setView(["teachers","sections"].includes(next)?next:"classes",{replace:true});});

picker=createTenantSchoolPicker({host:el("csSchoolSwitcher"),status:null,onBeforeChange:async()=>{
  if(busy)throw Error("Finish the current class assignment action before switching schools.");
  ++epoch;model={teachers:[],offerings:[]};selectedId="";roster=null;renderSummary();renderList();renderDetail();
},onReady:scope=>{if(scope.current?.roles.includes("school_admin")||platformMode()==="assist")void loadOverview();else say("School Administrator access is required.",true);}});
setView(view,{replace:true});renderSummary();renderDetail();
await auth.authStateReady();
try{const state=await picker.load();if(!auth.currentUser)say("Sign in with a verified School Administrator account.",true);else if(state?.state==="choose_school")say("Choose the school whose classes you want to manage.");}
catch(error){say(error?.message||"Verified school access is unavailable.",true);}
