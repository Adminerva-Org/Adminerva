import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.1";

const el=id=>document.getElementById(id);
const functions=getFunctions(app,"asia-southeast1");
const api=httpsCallable(functions,"schoolAcademics");
const attendanceApi=httpsCallable(functions,"schoolAttendance");
const select=el("advisorySection"),status=el("advisoryStatus");
let picker=null,sections=[],current=null,busy=false,epoch=0,attendanceRevision=0,attendanceDirty=false,attendanceRows=new Map();

function make(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function say(message,error=false){status.textContent=message;status.className="text-sm mt-3 "+(error?"text-rose-700":"text-slate-600");}
function setBusy(value){
 busy=value;select.disabled=value||!sections.length;el("advisoryRefresh").disabled=value;
 for(const id of ["advisoryAttendanceDate","advisoryAttendanceLoad","advisoryAttendanceAllPresent","advisoryAttendanceClear","advisoryAttendanceSave"])
  el(id).disabled=value||(id==="advisoryAttendanceSave"&&!attendanceDirty);
}
async function scoped(action,details={}){
  if(!picker?.scope.current)throw Error("Choose a verified school first.");
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);return result;
}
async function scopedAttendance(action,details={}){
  if(!picker?.scope.current)throw Error("Choose a verified school first.");
  const lease=picker.scope.lease();
  const result=(await attendanceApi({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);return result;
}
function sectionLabel(item){return [item.sectionName,item.yearName,item.gradeLevel?("Grade "+item.gradeLevel):"",item.pathway].filter(Boolean).join(" · ");}
const attendanceLabels={unmarked:"Unmarked",present:"Present",late:"Late",absent:"Absent",excused:"Excused"};
function localDate(){
 const now=new Date(),local=new Date(now.getTime()-now.getTimezoneOffset()*60000);return local.toISOString().slice(0,10);
}
function attendanceCounts(){
 const counts={unmarked:0,present:0,late:0,absent:0,excused:0};
 for(const row of attendanceRows.values())counts[row.status in counts?row.status:"unmarked"]++;
 return counts;
}
function markAttendanceDirty(){
 attendanceDirty=true;el("advisoryAttendanceSave").disabled=busy||!current;
 renderAttendanceSummary();
}
function renderAttendanceSummary(){
 const host=el("advisoryAttendanceSummary");host.replaceChildren();
 const counts=attendanceCounts(),tones={
  present:"bg-emerald-50 border-emerald-200 text-emerald-800",
  late:"bg-amber-50 border-amber-200 text-amber-800",
  absent:"bg-rose-50 border-rose-200 text-rose-800",
  excused:"bg-blue-50 border-blue-200 text-blue-800",
  unmarked:"bg-slate-50 border-slate-200 text-slate-700"
 };
 for(const key of ["present","late","absent","excused","unmarked"])
  host.append(make("span","rounded-full border px-2.5 py-1 text-xs font-bold "+tones[key],attendanceLabels[key]+" "+counts[key]));
}
function renderAttendanceRows(){
 const host=el("advisoryAttendanceRows");host.replaceChildren();
 if(!current){renderAttendanceSummary();return;}
 const students=current.students||[];
 if(!students.length){host.append(make("p","rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500","No official students are available for attendance."));renderAttendanceSummary();return;}
 for(const student of students){
  const state=attendanceRows.get(student.personId)||{status:"unmarked",note:""};
  attendanceRows.set(student.personId,state);
  const row=make("div","grid md:grid-cols-[minmax(180px,1fr)_170px_minmax(180px,.8fr)] gap-2 items-center rounded-xl border border-slate-200 p-3");
  const identity=make("div","min-w-0");identity.append(make("strong","block text-sm",student.name),make("span","block text-xs text-slate-500 mt-1",student.studentNumber||"No student number"));
  const statusSelect=make("select","rounded-lg border border-slate-300 px-3 py-2 text-sm");
  for(const key of ["unmarked","present","late","absent","excused"])statusSelect.add(new Option(attendanceLabels[key],key));
  statusSelect.value=state.status;
  statusSelect.addEventListener("change",()=>{state.status=statusSelect.value;markAttendanceDirty();});
  const note=make("input","rounded-lg border border-slate-300 px-3 py-2 text-sm");note.type="text";note.maxLength=240;note.placeholder="Optional note";note.value=state.note||"";
  note.addEventListener("input",()=>{state.note=note.value;markAttendanceDirty();});
  row.append(identity,statusSelect,note);host.append(row);
 }
 renderAttendanceSummary();
}
async function loadAttendance({discard=false}={}){
 if(!current||busy)return;
 if(attendanceDirty&&!discard&&!confirm("Discard unsaved attendance changes and load this day?"))return;
 const date=el("advisoryAttendanceDate").value;if(!date)return;
 const token=++epoch;setBusy(true);el("advisoryAttendanceStatus").textContent="Loading official attendance…";
 try{
  const result=await scopedAttendance("section_day",{sectionId:current.sectionId,yearId:current.yearId,date});
  if(token!==epoch)return;
  attendanceRevision=Number(result.revision)||0;attendanceRows=new Map((result.students||[]).map(row=>[
   row.personId,{status:row.status||"unmarked",note:row.note||""}
  ]));attendanceDirty=false;renderAttendanceRows();setBusy(false);
  el("advisoryAttendanceSave").disabled=true;
  el("advisoryAttendanceStatus").textContent=attendanceRevision?
   "Loaded saved attendance revision "+attendanceRevision+".":"No saved attendance yet for this date.";
 }catch(error){if(token===epoch){attendanceRevision=0;attendanceRows=new Map();attendanceDirty=false;renderAttendanceRows();el("advisoryAttendanceStatus").textContent=error?.message||"Attendance could not load.";setBusy(false);}}
}
async function saveAttendance(){
 if(!current||busy||!attendanceDirty)return;
 const date=el("advisoryAttendanceDate").value,entries=(current.students||[]).map(student=>{
  const row=attendanceRows.get(student.personId)||{status:"unmarked",note:""};
  return {personId:student.personId,status:row.status,note:row.note||""};
 });
 setBusy(true);el("advisoryAttendanceStatus").textContent="Saving revisioned advisory attendance…";
 try{
  const result=await scopedAttendance("save_section_day",{sectionId:current.sectionId,yearId:current.yearId,date,expectedRevision:attendanceRevision,entries});
  attendanceRevision=Number(result.revision)||attendanceRevision+1;attendanceDirty=false;setBusy(false);el("advisoryAttendanceSave").disabled=true;
  el("advisoryAttendanceStatus").textContent="Attendance saved · revision "+attendanceRevision+".";
  renderAttendanceSummary();
 }catch(error){setBusy(false);el("advisoryAttendanceSave").disabled=false;el("advisoryAttendanceStatus").textContent=error?.message||"Attendance was not saved.";}
}
function renderRoster(){
  const body=el("advisoryRoster"),empty=el("advisoryRosterEmpty"),query=el("advisoryStudentSearch").value.trim().toLocaleLowerCase();
  body.replaceChildren();if(!current){empty.hidden=true;return;}
  const rows=(current.students||[]).filter(row=>!query||[row.name,row.studentNumber].some(value=>String(value||"").toLocaleLowerCase().includes(query)));
  empty.hidden=rows.length>0;
  for(const row of rows){
    const tr=make("tr","border-b border-slate-100");
    const name=make("td","px-4 py-3 font-semibold",row.name||"Student");
    const number=make("td","px-4 py-3 text-slate-600",row.studentNumber||"—");
    const account=make("td","px-4 py-3");
    account.append(make("span","rounded-full px-2 py-1 text-xs font-bold "+(row.accountLinked?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-800"),row.accountLinked?"Linked":"Not linked"));
    const source=make("td","px-4 py-3 text-xs text-slate-500",row.registrationSource==="registration"?"Official registration":"Active class enrollment");
    tr.append(name,number,account,source);body.append(tr);
  }
}
function renderClasses(){
  const host=el("advisoryClasses");host.replaceChildren();if(!current)return;
  const classes=current.classes||[];
  if(!classes.length){host.append(make("p","rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500","No active class offerings are attached to this advisory section for the selected school year."));return;}
  const byTerm=new Map();
  for(const row of classes){const list=byTerm.get(row.termName)||[];list.push(row);byTerm.set(row.termName,list);}
  for(const [term,rows] of byTerm){
    const group=make("section","rounded-xl border border-slate-200 overflow-hidden");
    group.append(make("h3","px-3 py-2 bg-slate-50 text-xs font-extrabold uppercase text-slate-600",term||"Academic period"));
    const list=make("div","divide-y divide-slate-100");
    for(const row of rows){
      const item=make("div","p-3"),teachers=(row.teacherNames||[]);
      item.append(make("strong","block text-sm",row.subjectName||"Subject"),
        make("span","block text-xs mt-1 "+(teachers.length?"text-slate-500":"text-amber-800 font-bold"),teachers.length?teachers.join(", "):"No active subject teacher"));
      list.append(item);
    }
    group.append(list);host.append(group);
  }
}
function render(){
  current=sections.find(row=>row.advisoryId===select.value)||sections[0]||null;
  el("advisoryWorkspace").hidden=!current;
  if(!current){
    el("advisoryStudentCount").textContent="—";el("advisoryClassCount").textContent="—";
    el("advisoryUnstaffedCount").textContent="—";el("advisoryAccountCount").textContent="—";return;
  }
  const students=current.students||[],classes=current.classes||[];
  el("advisoryStudentCount").textContent=students.length.toLocaleString();
  el("advisoryClassCount").textContent=classes.length.toLocaleString();
  el("advisoryUnstaffedCount").textContent=classes.filter(row=>!(row.teacherNames||[]).length).length.toLocaleString();
  el("advisoryAccountCount").textContent=students.filter(row=>row.accountLinked).length.toLocaleString();
  el("advisoryRosterTitle").textContent=current.sectionName+" · "+current.yearName;
  renderRoster();renderClasses();
}
async function load(){
  if(!picker?.scope.current||busy)return;const turn=++epoch;setBusy(true);say("Loading advisory assignments…");
  try{
    const result=await scoped("my_advisory_sections");if(turn!==epoch)return;
    sections=result.sections||[];const prior=select.value;select.replaceChildren();
    if(!sections.length){
      current=null;render();select.add(new Option("No active advisory section",""));say("No active adviser / homeroom assignment is linked to this teacher account.");return;
    }
    for(const row of sections)select.add(new Option(sectionLabel(row),row.advisoryId));
    if(sections.some(row=>row.advisoryId===prior))select.value=prior;
    render();say("Advisory overview ready. Official roster placement is read-only here.");
    await loadAttendance({discard:true});
  }catch(error){sections=[];current=null;select.replaceChildren(new Option("Advisory unavailable",""));render();say(error?.message||"Advisory overview could not load.",true);}
  finally{setBusy(false);}
}
select.addEventListener("change",async()=>{
  if(attendanceDirty&&!confirm("Discard unsaved attendance changes and switch advisory sections?")){
    select.value=current?.advisoryId||"";return;
  }
  render();attendanceRevision=0;attendanceRows=new Map();attendanceDirty=false;renderAttendanceRows();
  say("Showing "+sectionLabel(current)+".");await loadAttendance({discard:true});
});
el("advisoryStudentSearch").addEventListener("input",renderRoster);
el("advisoryRefresh").addEventListener("click",()=>void load());
el("advisoryAttendanceDate").value=localDate();
el("advisoryAttendanceLoad").addEventListener("click",()=>void loadAttendance());
el("advisoryAttendanceAllPresent").addEventListener("click",()=>{
 if(!current||busy)return;
 for(const student of current.students||[]){const row=attendanceRows.get(student.personId)||{status:"unmarked",note:""};row.status="present";attendanceRows.set(student.personId,row);}
 markAttendanceDirty();renderAttendanceRows();el("advisoryAttendanceStatus").textContent="All students marked present locally. Save to commit the attendance revision.";
});
el("advisoryAttendanceClear").addEventListener("click",()=>{
 if(!current||busy)return;
 for(const student of current.students||[]){const row=attendanceRows.get(student.personId)||{status:"unmarked",note:""};row.status="unmarked";row.note="";attendanceRows.set(student.personId,row);}
 markAttendanceDirty();renderAttendanceRows();el("advisoryAttendanceStatus").textContent="Attendance reset locally. Save to commit this revision.";
});
el("advisoryAttendanceSave").addEventListener("click",()=>void saveAttendance());
window.addEventListener("beforeunload",event=>{if(attendanceDirty){event.preventDefault();event.returnValue="";}});


picker=createTenantSchoolPicker({
 host:el("advisorySchoolSwitcher"),status:null,
 onBeforeChange:async()=>{
  if(busy)throw Error("Finish the current advisory operation before switching schools.");
  if(attendanceDirty)throw Error("Save or discard unsaved advisory attendance before switching schools.");
  ++epoch;sections=[];current=null;attendanceRows=new Map();attendanceRevision=0;select.replaceChildren();render();renderAttendanceRows();
},
 onReady:scope=>{if(scope.current?.roles.includes("teacher"))void load();else say("Teacher access is required.",true);}
});
await auth.authStateReady();
try{
 const state=await picker.load();
 if(!auth.currentUser)say("Sign in with a verified teacher account.",true);
 else if(state?.state==="choose_school")say("Choose the school whose advisory section you want to view.");
}catch(error){say(error?.message||"Verified school access is unavailable.",true);}
