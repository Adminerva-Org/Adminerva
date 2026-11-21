import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.1";

const el=id=>document.getElementById(id);
const functions=getFunctions(app,"asia-southeast1");
const api=httpsCallable(functions,"schoolAcademics");
const scheduleApi=httpsCallable(functions,"schoolSchedules");
const params=new URLSearchParams(location.search);
let picker=null,busy=false,epoch=0,view=["classes","teachers","sections","schedule"].includes(params.get("view"))?params.get("view"):"classes";
let model={teachers:[],offerings:[],advisories:[],schedules:new Map()},selectedId=String(params.get("offeringId")||""),roster=null;
let detailTab=["team","schedule","roster"].includes(params.get("panel"))?params.get("panel"):"team";
let scheduleDraft=[],scheduleRevision=0,scheduleDirty=false,studentSearchResults=[];

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
const dayNames={mon:"Monday",tue:"Tuesday",wed:"Wednesday",thu:"Thursday",fri:"Friday",sat:"Saturday"};
function minutes(value){const match=/^([0-9]{2}):([0-9]{2})$/.exec(String(value||""));return match?Number(match[1])*60+Number(match[2]):null;}
function scheduleFor(item){return item?model.schedules.get(item.offeringId)||null:null;}
function scheduleMinutes(item){
  return (scheduleFor(item)?.meetings||[]).reduce((sum,row)=>{
    const start=minutes(row.startTime),end=minutes(row.endTime);return sum+(start!==null&&end!==null&&end>start?end-start:0);
  },0);
}
function meetingText(row){return [dayNames[row.day]||row.day,row.startTime+"–"+row.endTime,row.room||""].filter(Boolean).join(" · ");}
function selected(){return (model.offerings||[]).find(row=>row.offeringId===selectedId)||null;}
function currentAdviser(item=selected()){
  if(!item)return null;
  return (model.advisories||[]).find(row=>row.status==="active"&&row.sectionId===item.sectionId&&row.yearId===item.yearId)||null;
}
function enrollmentRoute(){
  const school=picker?.scope?.current;
  return school?.enrollmentMode==="canonical"?"school-enrollment.html":"people-access.html#classes";
}
async function scoped(action,details={}){
  if(!picker?.scope.current)throw Error("Choose a verified school first.");
  const lease=picker.scope.lease(),mode=platformMode();
  const response=await api({schoolId:lease.schoolId,action,...details,...(mode?{platformMode:mode}:{})});
  picker.scope.assertLease(lease);return response.data;
}
async function scopedSchedule(action,details={}){
  if(!picker?.scope.current)throw Error("Choose a verified school first.");
  const lease=picker.scope.lease(),mode=platformMode();
  const response=await scheduleApi({schoolId:lease.schoolId,action,...details,...(mode?{platformMode:mode}:{})});
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
  const classes=model.offerings||[];
  el("csClassCount").textContent=classes.length.toLocaleString();
  el("csUnstaffedCount").textContent=classes.filter(row=>!(row.teacherUids||[]).length).length.toLocaleString();
  el("csTeacherCount").textContent=(model.teachers||[]).length.toLocaleString();
  el("csScheduledCount").textContent=classes.filter(row=>(scheduleFor(row)?.meetings||[]).length).length.toLocaleString();
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
    sections:["Section coverage","Sections","See every class attached to a section and which teachers currently cover it."],
    schedule:["Official timetable","Schedule","School-owned meeting times and rooms for each class offering. Conflicts are rejected before saving."]
  }[view];
  el("csViewEyebrow").textContent=copy[0];el("csViewTitle").textContent=copy[1];el("csViewHelp").textContent=copy[2];
  const url=new URL(location.href);if(view==="classes")url.searchParams.delete("view");else url.searchParams.set("view",view);
  history[replace?"replaceState":"pushState"]({},"",url);renderList();
}
function setDetailTab(next,{replace=false}={}){
  if(!["team","schedule","roster"].includes(next))next="team";
  detailTab=next;
  for(const node of document.querySelectorAll("[data-cs-detail-tab]")){
    const active=node.dataset.csDetailTab===detailTab;
    node.setAttribute("aria-selected",String(active));
    node.className="rounded-lg px-3 py-2 text-sm whitespace-nowrap "+(active?
      "bg-slate-900 text-white font-extrabold":"border border-slate-300 bg-white text-slate-800 font-bold");
  }
  for(const panel of document.querySelectorAll("[data-cs-detail-panel]"))
    panel.hidden=panel.dataset.csDetailPanel!==detailTab;
  const url=new URL(location.href);
  if(detailTab==="team")url.searchParams.delete("panel");else url.searchParams.set("panel",detailTab);
  history[replace?"replaceState":"pushState"]({},"",url);
}
function button(text,handler,cls="border border-slate-300 bg-white text-slate-800"){
  const node=make("button","rounded-lg px-3 py-2 text-xs font-bold "+cls,text);node.type="button";node.addEventListener("click",handler);return node;
}
function empty(message){return make("div","rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600",message);}
function renderClasses(rows){
  const host=el("csList");host.replaceChildren();if(!rows.length){host.append(empty("No classes match these filters."));return;}
  const teachers=teacherMap(),cards=make("div","grid gap-3 md:hidden"),
    wrap=make("div","hidden md:block overflow-x-auto"),table=make("table","w-full text-sm"),
    thead=make("thead","bg-slate-50 text-left text-xs uppercase text-slate-500"),tr=make("tr");
  for(const label of ["Class","Period","Teacher(s)","Roster","Schedule","Status",""])tr.append(make("th","px-3 py-3 font-extrabold",label));
  thead.append(tr);table.append(thead);
  const body=make("tbody","divide-y divide-slate-200");
  for(const row of rows){
    const names=(row.teacherUids||[]).map(uid=>{
      const name=teachers.get(uid)?.name||("Teacher "+uid.slice(0,8));
      return name+(uid===row.primaryTeacherUid?" (Primary)":" (Co-teacher)");
    });
    const rosterLabels={section:"Official section",selective:"Selective",legacy:"Legacy / review"},
      rosterLabel=rosterLabels[row.rosterMode]||"Legacy / review",meetings=scheduleFor(row)?.meetings||[],
      statusText=row.invalidGrantCount?row.invalidGrantCount+" assignment issue"+(row.invalidGrantCount===1?"":"s"):
        row.primaryNeedsReview?"Primary teacher needs review":"Ready";
    const r=make("tr","align-top hover:bg-slate-50");
    const title=make("td","px-3 py-3");title.append(make("strong","block text-slate-900",classLabel(row)),make("span","block text-xs text-slate-500 mt-1",row.programName||""));
    const period=make("td","px-3 py-3 text-slate-600",[row.termName,row.yearName].filter(Boolean).join(" · "));
    const staff=make("td","px-3 py-3",names.length?names.join(", "):"Unassigned");if(!names.length)staff.className+=" font-bold text-amber-700";
    const roster=make("td","px-3 py-3 font-bold",rosterLabel);
    roster.className+=" "+(row.rosterMode==="section"?"text-emerald-700":row.rosterMode==="selective"?"text-blue-700":"text-amber-700");
    const schedule=make("td","px-3 py-3",meetings.length?meetings.length+" meeting"+(meetings.length===1?"":"s"):"Unscheduled");
    schedule.className+=" "+(meetings.length?"text-violet-700 font-bold":"text-slate-500");
    const status=make("td","px-3 py-3",statusText);
    status.className+=" "+(row.invalidGrantCount?"text-rose-700 font-bold":row.primaryNeedsReview?"text-amber-700 font-bold":"text-emerald-700");
    const action=make("td","px-3 py-3 text-right");action.append(button("Manage",()=>void openClass(row.offeringId),"bg-blue-700 text-white"));
    r.append(title,period,staff,roster,schedule,status,action);body.append(r);

    const card=make("article","rounded-xl border border-slate-200 bg-white p-4");
    card.append(make("h3","font-extrabold text-slate-900",classLabel(row)),make("p","text-xs text-slate-500 mt-1",classMeta(row)));
    const facts=make("dl","grid grid-cols-2 gap-x-3 gap-y-2 mt-3 text-xs");
    for(const [label,value,tone] of [
      ["Teachers",names.length?names.join(", "):"Unassigned",names.length?"text-slate-700":"text-amber-700 font-bold"],
      ["Roster",rosterLabel,row.rosterMode==="legacy"?"text-amber-700 font-bold":"text-slate-700"],
      ["Schedule",meetings.length?meetings.length+" meeting"+(meetings.length===1?"":"s"):"Unscheduled",meetings.length?"text-slate-700":"text-amber-700 font-bold"],
      ["Status",statusText,statusText==="Ready"?"text-emerald-700 font-bold":"text-amber-700 font-bold"]
    ]){
      const box=make("div","min-w-0"),dt=make("dt","font-bold uppercase tracking-wide text-slate-500",label),dd=make("dd","mt-0.5 "+tone,value);
      box.append(dt,dd);facts.append(box);
    }
    card.append(facts);
    const manage=button("Manage class",()=>void openClass(row.offeringId),"mt-4 w-full bg-blue-700 text-white");
    manage.className+=" min-h-11";card.append(manage);cards.append(card);
  }
  table.append(body);wrap.append(table);host.append(cards,wrap);
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
    const weekly=item.classes.reduce((sum,row)=>sum+scheduleMinutes(row),0);
    card.append(make("h3","font-extrabold",item.teacher.name),make("p","text-xs text-slate-500 mt-1",
      item.classes.length+" active class"+(item.classes.length===1?"":"es")+" · "+Math.floor(weekly/60)+"h "+weekly%60+"m scheduled/week"));
    const list=make("div","mt-3 space-y-2");
    if(!item.classes.length)list.append(make("p","text-sm text-slate-500","No active classes in the selected period."));
    for(const row of item.classes.slice(0,8)){
      const link=make("button","block w-full text-left rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm","");link.type="button";
      const role=row.primaryTeacherUid===item.teacher.uid?"Primary Teacher":"Co-teacher";
      link.append(make("strong","block",classLabel(row)),make("span","block text-xs text-slate-500",role+" · "+classMeta(row)));link.addEventListener("click",()=>void openClass(row.offeringId));list.append(link);
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
      const names=(row.teacherUids||[]).map(uid=>{
        const name=teachers.get(uid)?.name||uid.slice(0,8);
        return name+(uid===row.primaryTeacherUid?" · Primary":" · Co-teacher");
      }).join(", ")||"Unassigned";
      line.append(make("strong","block",row.subjectName||row.subjectId),make("span","block text-xs "+(names==="Unassigned"?"text-amber-700 font-bold":"text-slate-500"),names+" · "+(row.termName||"")));
      line.addEventListener("click",()=>void openClass(row.offeringId));list.append(line);
    }card.append(list);grid.append(card);
  }host.append(grid);
}
function renderSchedules(rows){
  const host=el("csList");host.replaceChildren();
  if(!rows.length){host.append(empty("No classes match these schedule filters."));return;}
  const grid=make("div","grid lg:grid-cols-2 gap-3"),teachers=teacherMap();
  for(const row of rows){
    const schedule=scheduleFor(row),meetings=schedule?.meetings||[],card=make("article","rounded-xl border border-slate-200 p-4");
    const top=make("div","flex items-start justify-between gap-3"),text=make("div","min-w-0");
    text.append(make("h3","font-extrabold",classLabel(row)),make("p","text-xs text-slate-500 mt-1",classMeta(row)));
    const manage=button(meetings.length?"Edit schedule":"Schedule class",()=>void openClass(row.offeringId),"bg-violet-700 text-white");
    top.append(text,manage);card.append(top);
    const staff=(row.teacherUids||[]).map(uid=>{
      const name=teachers.get(uid)?.name||("Teacher "+uid.slice(0,8));
      return name+(uid===row.primaryTeacherUid?" · Primary":" · Co-teacher");
    }).join(", ")||"Unassigned teacher";
    card.append(make("p","text-xs text-slate-600 mt-3",staff));
    if(!meetings.length)card.append(make("p","mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500","No official meeting times."));
    else{
      const list=make("div","mt-3 space-y-1");
      for(const meeting of meetings)list.append(make("p","rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-xs font-bold text-violet-900",meetingText(meeting)));
      card.append(list);
    }
    grid.append(card);
  }host.append(grid);
}
function renderList(){
  const rows=filterOfferings();if(view==="teachers")renderTeachers(rows);else if(view==="sections")renderSections(rows);else if(view==="schedule")renderSchedules(rows);else renderClasses(rows);
}
function renderTeacherSelectors(){
  const active=new Set((roster?.teachers||[]).filter(row=>row.status==="active").map(row=>row.teacherUid));
  const assign=el("csAssignTeacher");assign.replaceChildren(new Option("Choose teacher…",""));
  const handoverTo=el("csHandoverTo");handoverTo.replaceChildren(new Option("Choose replacement…",""));
  for(const row of model.teachers||[]){
    if(!active.has(row.uid))assign.add(new Option(row.name,row.uid));
    handoverTo.add(new Option(row.name,row.uid));
  }
  const from=el("csHandoverFrom");from.replaceChildren(new Option("Current teacher…",""));
  for(const row of (roster?.teachers||[]).filter(row=>row.status==="active"))
    from.add(new Option(row.name+(row.role==="primary"?" · Primary":" · Co-teacher"),row.teacherUid));
  if(roster?.primaryTeacherUid&&[...from.options].some(option=>option.value===roster.primaryTeacherUid))
    from.value=roster.primaryTeacherUid;
  el("csAssignForm").hidden=assign.options.length<=1;
  el("csHandoverForm").hidden=from.options.length<=1||handoverTo.options.length<=1;
}
function resetScheduleDraft(item=selected()){
  const saved=scheduleFor(item);scheduleDraft=structuredClone(saved?.meetings||[]);
  scheduleRevision=Number(saved?.revision)||0;scheduleDirty=false;
}
function renderScheduleEditor(){
  const item=selected(),host=el("csScheduleMeetings"),status=el("csScheduleStatus");
  host.replaceChildren();
  if(!item){status.textContent="";return;}
  el("csScheduleRevision").textContent=scheduleRevision?"Revision "+scheduleRevision:"Not scheduled";
  if(!scheduleDraft.length)host.append(make("p","rounded-lg border border-dashed border-violet-200 bg-white/70 p-3 text-xs text-violet-900","No official meetings yet."));
  scheduleDraft.forEach((meeting,index)=>{
    const row=make("div","flex items-center justify-between gap-2 rounded-lg border border-violet-100 bg-white p-2"),
      label=make("span","text-xs font-bold text-violet-950",meetingText(meeting)),
      remove=button("Remove",()=>{scheduleDraft.splice(index,1);scheduleDirty=true;renderScheduleEditor();},"border border-rose-200 bg-white text-rose-700");
    row.append(label,remove);host.append(row);
  });
  status.textContent=scheduleDirty?"Unsaved official schedule changes.":"Official schedule changes are audited and checked for teacher, section and room conflicts.";
}
function renderStudentSearchResults(){
  const host=el("csStudentSearchResults");if(!host)return;host.replaceChildren();
  const item=selected();if(!item||item.rosterMode!=="selective"){studentSearchResults=[];return;}
  const existing=new Set((roster?.students||[]).map(row=>row.personId));
  const available=studentSearchResults.filter(row=>!existing.has(row.personId));
  if(!studentSearchResults.length)return;
  if(!available.length){
    host.append(make("p","rounded-lg border border-blue-200 bg-white p-3 text-xs text-blue-900","All matching students already have active or historical enrollment in this class. Restore ended history from the roster instead of creating a duplicate."));
    return;
  }
  for(const row of available){
    const card=make("div","flex items-center justify-between gap-3 rounded-lg border border-blue-100 bg-white p-3"),
      info=make("div","min-w-0");
    info.append(make("strong","block text-sm truncate",row.name),
      make("span","block text-[11px] text-slate-500 mt-1",[row.studentNumber||"No student number",row.accountLinked?"account linked":"no linked account"].join(" · ")));
    const add=button("Add to class",()=>void addSelectiveStudent(row),"bg-blue-700 text-white");
    card.append(info,add);host.append(card);
  }
}
async function searchStudents(){
  const item=selected(),query=el("csStudentSearchQuery").value.trim();
  if(!item||item.rosterMode!=="selective"||busy)return;
  if(query.length<2){el("csStudentSearchStatus").textContent="Enter at least 2 characters.";return;}
  setBusy(true);el("csStudentSearchStatus").textContent="Searching active students…";
  try{
    const result=await scoped("search_students",{query});studentSearchResults=result.students||[];
    renderStudentSearchResults();el("csStudentSearchStatus").textContent=studentSearchResults.length?
      studentSearchResults.length+" matching active student"+(studentSearchResults.length===1?"":"s")+".":"No matching active students.";
  }catch(error){studentSearchResults=[];renderStudentSearchResults();el("csStudentSearchStatus").textContent=error?.message||"Student search failed.";}
  finally{setBusy(false);}
}
async function addSelectiveStudent(row){
  const item=selected();if(!item||item.rosterMode!=="selective"||busy)return;
  setBusy(true);say("Adding "+row.name+" to this selective class…");
  try{
    await scoped("enroll_student",{personId:row.personId,offeringId:item.offeringId});
    studentSearchResults=[];el("csStudentSearchQuery").value="";el("csStudentSearchStatus").textContent="";
    await openClass(item.offeringId);say(row.name+" added to this selective class. Official section placement was not changed.");
  }catch(error){say(error?.message||"The student could not be added to this class.",true);}
  finally{setBusy(false);}
}
async function changeSelectiveEnrollment(row,action){
  const item=selected();if(!item||item.rosterMode!=="selective"||busy)return;
  const restoring=action==="restore_enrollment",reason=prompt(
    (restoring?"Reason for restoring ":"Reason for removing ")+row.name+" "+(restoring?"to":"from")+" this selective class (at least 12 characters):",
    restoring?"Selective class enrollment restored":"Selective class enrollment ended");
  if(reason===null)return;if(reason.trim().length<12){say("Explain the selective class enrollment change in at least 12 characters.",true);return;}
  setBusy(true);say(restoring?"Restoring class enrollment…":"Ending class enrollment…");
  try{
    await scoped(action,{enrollmentId:row.enrollmentId,reason:reason.trim()});
    await openClass(item.offeringId);
    say(restoring?row.name+" restored to this selective class.":row.name+" removed from the active class roster; enrollment history was preserved.");
  }catch(error){say(error?.message||"The class enrollment could not be changed.",true);}
  finally{setBusy(false);}
}
function renderDetail(){
  const item=selected();if(!item){el("csDetail").hidden=true;el("csDetailEmpty").hidden=false;return;}
  el("csDetailEmpty").hidden=true;el("csDetail").hidden=false;el("csDetailTitle").textContent=classLabel(item);el("csDetailMeta").textContent=classMeta(item);
  const staff=el("csStaffList");staff.replaceChildren();const active=(roster?.teachers||[]).filter(row=>row.status==="active");
  el("csStaffCount").textContent=active.length+" active"+(roster?.primaryTeacherUid?" · Primary set":"");
  if(!active.length)staff.append(empty("No teacher is assigned to this class."));
  if(roster?.primaryNeedsReview&&active.length){
    staff.append(make("p","rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900",
      "This class has multiple active teachers but no valid explicit Primary Teacher. Choose Make primary before relying on class-lead ownership."));
  }
  for(const row of active){
    const card=make("div","flex items-center justify-between gap-3 rounded-lg border p-3 "+(row.role==="primary"?"border-emerald-200 bg-emerald-50/50":"border-slate-200"));
    const text=make("div","min-w-0");
    text.append(make("strong","block truncate",row.name),
      make("span","block text-xs mt-1 "+(row.role==="primary"?"font-bold text-emerald-800":"text-slate-500"),
        row.role==="primary"?"Primary Teacher":"Co-teacher · shared class access; assessment reviews remain explicitly assigned"));
    const actions=make("div","flex flex-wrap justify-end gap-2");
    if(row.role!=="primary")actions.append(button("Make primary",()=>void setPrimaryTeacher(row),"border border-emerald-200 bg-white text-emerald-700"));
    actions.append(button("Remove",()=>void endAssignment(row),"border border-rose-200 bg-white text-rose-700"));
    card.append(text,actions);staff.append(card);
  }
  const allStudents=roster?.students||[],students=allStudents.filter(row=>row.status==="active"),
    endedStudents=allStudents.filter(row=>row.status==="ended"),rosterHost=el("csRoster"),
    selective=item.rosterMode==="selective";
  rosterHost.replaceChildren();el("csStudentCount").textContent=students.length+" active";
  el("csSelectiveRosterTools").hidden=!selective;
  el("csRosterAuthorityHelp").textContent=selective?
    "This class intentionally uses a selective roster. Add/remove class enrollment here; official section placement is unchanged.":
    item.rosterMode==="section"?
      "This class follows official section placement. Change the student's official registration through Enrollment & Registration.":
      "Classify the roster source above before using the canonical roster workflow.";
  if(!students.length&&!endedStudents.length)rosterHost.append(make("p","p-4 text-sm text-slate-500","No student enrollment exists for this class."));
  else{
    const list=make("div","divide-y divide-slate-100");
    const ordered=[...students].sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    ordered.forEach((row,index)=>{
      const li=make("div","flex items-center justify-between gap-3 px-3 py-2 text-sm"),
        info=make("div","min-w-0 flex gap-3 items-start");
      info.append(make("span","text-slate-400 w-6 text-right",index+1));
      const label=make("div","min-w-0");label.append(make("span","block font-medium truncate",row.name),
        make("span","block text-[11px] text-slate-500 mt-0.5",[row.studentNumber||"",row.accountLinked?"account linked":"no linked account"].filter(Boolean).join(" · ")));
      info.append(label);li.append(info);
      if(selective){
        const end=button("Remove",()=>void changeSelectiveEnrollment(row,"end_enrollment"),"border border-rose-200 bg-white text-rose-700");
        li.append(end);
      }
      list.append(li);
    });
    if(selective&&endedStudents.length){
      const history=make("div","bg-slate-50 px-3 py-2 text-xs font-extrabold uppercase text-slate-500","Ended enrollment history");
      list.append(history);
      for(const row of [...endedStudents].sort((a,b)=>String(a.name).localeCompare(String(b.name)))){
        const li=make("div","flex items-center justify-between gap-3 px-3 py-2 text-sm bg-slate-50/50"),
          info=make("div","min-w-0");
        info.append(make("span","block font-medium text-slate-600 truncate",row.name),
          make("span","block text-[11px] text-slate-500 mt-0.5","Ended class enrollment · history preserved"));
        const restore=button("Restore",()=>void changeSelectiveEnrollment(row,"restore_enrollment"),"border border-emerald-200 bg-white text-emerald-700");
        li.append(info,restore);list.append(li);
      }
    }
    rosterHost.append(list);
  }
  renderStudentSearchResults();
  renderTeacherSelectors();
  const adviser=currentAdviser(item),teacherById=teacherMap(),adviserSelect=el("csAdviserTeacher");
  adviserSelect.replaceChildren(new Option("Choose adviser…",""));
  for(const teacher of (model.teachers||[]).sort((a,b)=>a.name.localeCompare(b.name)))
    adviserSelect.add(new Option(teacher.name,teacher.uid));
  if(adviser&&[...adviserSelect.options].some(option=>option.value===adviser.teacherUid))
    adviserSelect.value=adviser.teacherUid;
  el("csAdviserCurrent").textContent=adviser?
    "Current adviser: "+(teacherById.get(adviser.teacherUid)?.name||("Teacher "+adviser.teacherUid.slice(0,8)))+" · "+(item.yearName||"school year"):
    "No adviser assigned for "+(item.yearName||"this school year")+".";
  el("csAdviserRemove").disabled=!adviser||busy;
  renderScheduleEditor();
  const rosterMode=item.rosterMode||"legacy",modeSelect=el("csRosterMode"),modeButton=el("csRosterModeSave");
  if(rosterMode==="selective")modeSelect.value="selective";else modeSelect.value="section";
  el("csRosterModeCurrent").textContent=rosterMode==="section"?
    "Official section placement · automatic synchronization":
    rosterMode==="selective"?"Selective / manual roster":"Legacy roster behavior · not yet explicitly classified";
  el("csRosterModeHelp").textContent=rosterMode==="section"?
    "Saving Official section placement again performs a safe synchronization of missing active official placements. Ended enrollment history is never silently restored.":
    rosterMode==="selective"?
      "New section registrations are not automatically added to this class. Switching modes does not remove current students.":
      "Existing classes keep their current behavior. Adopt Official section placement to reconcile the current official section roster, or choose Selective for an intentional exception.";
  modeButton.textContent=rosterMode==="section"&&modeSelect.value==="section"?"Synchronize official roster":"Apply roster source";
  el("csRecordLink").href="school-class-records.html?offeringId="+encodeURIComponent(item.offeringId);
  el("csEnrollmentClassLink").href=enrollmentRoute();
  setDetailTab(detailTab,{replace:true});
}
async function openClass(offeringId){
  if(scheduleDirty&&offeringId!==selectedId&&!confirm("Discard unsaved official schedule changes before opening another class?"))return;
  selectedId=offeringId;roster=null;studentSearchResults=[];if(el("csStudentSearchQuery"))el("csStudentSearchQuery").value="";if(el("csStudentSearchStatus"))el("csStudentSearchStatus").textContent="";
  resetScheduleDraft();renderDetail();say("Loading class roster…");
  if(window.matchMedia("(max-width:1279px)").matches)requestAnimationFrame(()=>{
    const behavior=window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth";
    el("csDetailPanel")?.scrollIntoView({behavior,block:"start"});
  });
  const url=new URL(location.href);url.searchParams.set("offeringId",offeringId);history.replaceState({},"",url);
  const turn=++epoch;
  try{const result=await scoped("class_roster",{offeringId});if(turn!==epoch||selectedId!==offeringId)return;roster=result;renderDetail();say("Class ready: "+classLabel(selected())+".");}
  catch(error){if(turn===epoch){say(error?.message||"Class roster could not load.",true);renderDetail();}}
}
async function mutate(action,details,success){
  if(busy||!selected())return;setBusy(true);say("Saving class assignment…");
  try{
    await scoped(action,details);
    await loadOverview({preserveSelection:true,force:true});
    say(success);
  }catch(error){say(error?.message||"The class assignment could not be changed.",true);}
  finally{setBusy(false);}
}
async function setPrimaryTeacher(row){
  const item=selected();if(!item||busy||row.role==="primary")return;
  const reason=prompt("Reason for making "+row.name+" the Primary Teacher (at least 12 characters):",
    "Primary teaching responsibility updated");
  if(reason===null)return;if(reason.trim().length<12){say("Explain the primary-teacher change in at least 12 characters.",true);return;}
  setBusy(true);say("Updating class primary teacher…");
  try{
    const result=await scoped("set_primary_teacher",{
      offeringId:item.offeringId,teacherUid:row.teacherUid,expectedRevision:Number(item.revision)||1,reason:reason.trim()
    });
    await loadOverview({preserveSelection:true,force:true});
    say(result.alreadyCurrent?row.name+" is already the Primary Teacher.":
      row.name+" is now the Primary Teacher. Existing assessment review ownership was not changed.");
  }catch(error){say(error?.message||"The Primary Teacher could not be changed.",true);}
  finally{setBusy(false);}
}
async function endAssignment(row){
  const reason=prompt("Reason for removing "+row.name+" from this class (at least 12 characters):","Teaching assignment ended");
  if(reason===null)return;if(reason.trim().length<12){say("Explain the teaching assignment change in at least 12 characters.",true);return;}
  await mutate("end_teacher_assignment",{teacherUid:row.teacherUid,offeringId:selectedId,reason:reason.trim()},"Teacher removed from this class.");
}
async function loadOverview({preserveSelection=false,force=false}={}){
  if(!picker?.scope.current||(busy&&!force))return;const turn=++epoch;say("Loading classes and teaching assignments…");
  try{
    const [result,scheduleResult]=await Promise.all([
      scoped("faculty_workload"),scopedSchedule("admin_overview")
    ]);if(turn!==epoch)return;
    model={teachers:result.teachers||[],offerings:result.offerings||[],advisories:result.advisories||[],
      schedules:new Map((scheduleResult.schedules||[]).map(row=>[row.offeringId,row]))};
    renderSummary();fillFilters();renderList();
    const enroll=enrollmentRoute();el("csEnrollmentLink").href=enroll;el("csEnrollmentClassLink").href=enroll;
    const requested=preserveSelection?selectedId:(selectedId&&model.offerings.some(row=>row.offeringId===selectedId)?selectedId:"");
    selectedId=requested;roster=null;resetScheduleDraft();renderDetail();
    if(selectedId)await openClass(selectedId);else say(model.offerings.length?"Scheduling workspace ready.":"No active classes exist yet. Create course offerings in Academic Configuration.");
  }catch(error){if(turn===epoch){model={teachers:[],offerings:[],advisories:[],schedules:new Map()};renderSummary();renderList();say(error?.message||"Classes & Scheduling could not load.",true);}}
}
el("csStudentSearchButton").addEventListener("click",()=>void searchStudents());
el("csStudentSearchQuery").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();void searchStudents();}});
el("csScheduleAdd").addEventListener("click",()=>{
  const item=selected();if(!item||busy)return;
  const day=el("csScheduleDay").value,startTime=el("csScheduleStart").value,endTime=el("csScheduleEnd").value,
    room=el("csScheduleRoom").value.trim(),start=minutes(startTime),end=minutes(endTime);
  if(start===null||end===null||start>=end){say("Choose a valid meeting start and later end time.",true);return;}
  const overlap=scheduleDraft.some(row=>row.day===day&&start<minutes(row.endTime)&&minutes(row.startTime)<end);
  if(overlap){say("This class already has an overlapping meeting on "+(dayNames[day]||day)+".",true);return;}
  scheduleDraft.push({day,startTime,endTime,room});
  scheduleDraft.sort((a,b)=>Object.keys(dayNames).indexOf(a.day)-Object.keys(dayNames).indexOf(b.day)||minutes(a.startTime)-minutes(b.startTime));
  scheduleDirty=true;el("csScheduleRoom").value="";renderScheduleEditor();say("Meeting added locally. Save the official schedule to commit it.");
});
el("csScheduleForm").addEventListener("submit",event=>{
  event.preventDefault();const item=selected(),reason=el("csScheduleReason").value.trim();if(!item||busy)return;
  if(reason.length<12){say("Explain the official schedule change in at least 12 characters.",true);return;}
  void (async()=>{
    setBusy(true);say("Checking conflicts and saving the official class schedule…");
    try{
      const saved=await scopedSchedule("save_class_schedule",{offeringId:item.offeringId,meetings:scheduleDraft,
        expectedRevision:scheduleRevision,reason});
      model.schedules.set(item.offeringId,{...saved,yearId:item.yearId,termId:item.termId,programId:item.programId,
        sectionId:item.sectionId,subjectId:item.subjectId});
      scheduleRevision=saved.revision;scheduleDirty=false;el("csScheduleReason").value="";
      renderSummary();renderList();renderScheduleEditor();say("Official class schedule saved. Teacher, section and room conflicts were checked.");
    }catch(error){say(error?.message||"The official class schedule could not be saved.",true);}
    finally{setBusy(false);renderScheduleEditor();}
  })();
});
el("csRosterMode").addEventListener("change",()=>{
  const item=selected();if(!item)return;
  el("csRosterModeSave").textContent=item.rosterMode==="section"&&el("csRosterMode").value==="section"?
    "Synchronize official roster":"Apply roster source";
});
el("csRosterModeForm").addEventListener("submit",event=>{
  event.preventDefault();const item=selected(),rosterMode=el("csRosterMode").value,
    reason=el("csRosterModeReason").value.trim();if(!item||busy)return;
  if(reason.length<12){say("Explain the roster-source change or synchronization in at least 12 characters.",true);return;}
  void (async()=>{
    setBusy(true);say(rosterMode==="section"?"Synchronizing official section placement with this class…":"Saving selective roster mode…");
    try{
      const result=await scoped("set_offering_roster_mode",{
        offeringId:item.offeringId,rosterMode,expectedRevision:Number(item.revision)||1,reason
      });
      el("csRosterModeReason").value="";
      await loadOverview({preserveSelection:true,force:true});
      const added=Number(result.added)||0;
      say(rosterMode==="section"?
        "Official section roster active. "+added+" missing student"+(added===1?" was":"s were")+" added; ended history was not restored.":
        "Selective/manual roster active. Existing enrollments were preserved; future section registrations will not be auto-added.");
    }catch(error){say(error?.message||"Roster source could not be changed.",true);}
    finally{setBusy(false);}
  })();
});
el("csAdviserForm").addEventListener("submit",event=>{
  event.preventDefault();const item=selected(),teacherUid=el("csAdviserTeacher").value;if(!item||!teacherUid)return;
  const existing=currentAdviser(item),name=teacherMap().get(teacherUid)?.name||"selected teacher";
  const reason=prompt((existing?"Reason for changing":"Reason for assigning")+" the section adviser (at least 12 characters):",
    existing?"Section adviser reassignment":"Official homeroom/advisory assignment");
  if(reason===null)return;if(reason.trim().length<12){say("Explain the adviser assignment change in at least 12 characters.",true);return;}
  void mutate("set_section_adviser",{teacherUid,sectionId:item.sectionId,yearId:item.yearId,reason:reason.trim()},
    name+" is now the adviser for "+item.sectionName+" in "+item.yearName+".");
});
el("csAdviserRemove").addEventListener("click",()=>{
  const item=selected(),adviser=currentAdviser(item);if(!item||!adviser||busy)return;
  const reason=prompt("Reason for ending this adviser assignment (at least 12 characters):","Advisory responsibility ended");
  if(reason===null)return;if(reason.trim().length<12){say("Explain the adviser assignment change in at least 12 characters.",true);return;}
  void mutate("end_section_adviser",{sectionId:item.sectionId,yearId:item.yearId,reason:reason.trim()},
    "Section adviser assignment ended. Subject teaching assignments were not changed.");
});
el("csAssignForm").addEventListener("submit",event=>{
  event.preventDefault();const teacherUid=el("csAssignTeacher").value;if(!teacherUid||!selectedId)return;
  void (async()=>{
    if(busy)return;setBusy(true);say("Adding teacher to class…");
    try{
      const result=await scoped("assign_teacher",{teacherUid,offeringId:selectedId});
      await loadOverview({preserveSelection:true,force:true});
      say(result.role==="primary"?"Teacher assigned as Primary Teacher. Their teaching load now includes this class.":
        "Teacher added as Co-teacher. Their teaching load includes this class; existing assessment reviews were not reassigned.");
    }catch(error){say(error?.message||"The teacher could not be added to this class.",true);}
    finally{setBusy(false);}
  })();
});
el("csHandoverForm").addEventListener("submit",event=>{
  event.preventDefault();const fromTeacherUid=el("csHandoverFrom").value,toTeacherUid=el("csHandoverTo").value,reason=el("csHandoverReason").value.trim();
  if(!fromTeacherUid||!toTeacherUid){say("Choose both the current and replacement teacher.",true);return;}
  if(fromTeacherUid===toTeacherUid){say("Choose a different replacement teacher.",true);return;}
  if(reason.length<12){say("Explain the teacher change in at least 12 characters.",true);return;}
  void (async()=>{
    if(busy)return;setBusy(true);say("Handing over teaching responsibility…");
    try{
      const result=await scoped("handover_offering",{offeringId:selectedId,fromTeacherUid,toTeacherUid,reason});
      await loadOverview({preserveSelection:true,force:true});
      say("Teaching assignment handed over. "+result.assessmentCount+" assessment review"+(result.assessmentCount===1?"":"s")+
        " transferred."+(result.primaryTransferred?" Primary Teacher leadership also moved to the replacement.":" Class primary leadership was unchanged."));
    }catch(error){say(error?.message||"Teaching responsibility could not be handed over.",true);}
    finally{setBusy(false);}
  })();
});
for(const node of [el("csSearch"),el("csYearFilter"),el("csTermFilter")])node.addEventListener(node.tagName==="INPUT"?"input":"change",renderList);
for(const node of document.querySelectorAll("[data-cs-view]"))node.addEventListener("click",()=>setView(node.dataset.csView));
for(const node of document.querySelectorAll("[data-cs-detail-tab]"))node.addEventListener("click",()=>setDetailTab(node.dataset.csDetailTab));
el("csRefresh").addEventListener("click",()=>void loadOverview({preserveSelection:true}));
window.addEventListener("popstate",()=>{
  const query=new URLSearchParams(location.search),next=query.get("view"),panel=query.get("panel");
  setView(["teachers","sections","schedule"].includes(next)?next:"classes",{replace:true});
  setDetailTab(["team","schedule","roster"].includes(panel)?panel:"team",{replace:true});
});

picker=createTenantSchoolPicker({host:el("csSchoolSwitcher"),status:null,onBeforeChange:async()=>{
  if(busy||scheduleDirty)throw Error("Save or discard the current official schedule changes before switching schools.");
  ++epoch;model={teachers:[],offerings:[],advisories:[],schedules:new Map()};selectedId="";roster=null;studentSearchResults=[];resetScheduleDraft();renderSummary();renderList();renderDetail();
},onReady:scope=>{if(scope.current?.roles.includes("school_admin")||platformMode()==="assist")void loadOverview();else say("School Administrator access is required.",true);}});
window.addEventListener("beforeunload",event=>{if(scheduleDirty){event.preventDefault();event.returnValue="";}});
setView(view,{replace:true});renderSummary();renderDetail();
await auth.authStateReady();
try{const state=await picker.load();if(!auth.currentUser)say("Sign in with a verified School Administrator account.",true);else if(state?.state==="choose_school")say("Choose the school whose classes you want to manage.");}
catch(error){say(error?.message||"Verified school access is unavailable.",true);}
