import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.1";

const functions=getFunctions(app,"asia-southeast1"),
  el=id=>document.getElementById(id),
  api=httpsCallable(functions,"schoolAttendance"),
  profileApi=httpsCallable(functions,"schoolProfile");
let picker=null,rows=[],busy=false,epoch=0,dateTouched=false;
function localDate(){const now=new Date(),local=new Date(now.getTime()-now.getTimezoneOffset()*60000);return local.toISOString().slice(0,10);}
function dateInTimeZone(timeZone){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"})
    .formatToParts(new Date()),values=Object.fromEntries(parts.filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  return values.year+"-"+values.month+"-"+values.day;
}
function make(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function say(message,error=false){el("attendanceStatus").textContent=message;el("attendanceStatus").className="text-sm mt-3 "+(error?"text-rose-700":"text-slate-600");}
function platformMode(){try{return sessionStorage.getItem("Adminerva_platform_school_mode")==="assist"?"assist":undefined;}catch{return undefined;}}
async function scoped(action,details={}){
 if(!picker?.scope.current)throw Error("Choose a verified school first.");
 const lease=picker.scope.lease(),mode=platformMode();
 const result=(await api({schoolId:lease.schoolId,action,...details,...(mode?{platformMode:mode}:{})})).data;
 picker.scope.assertLease(lease);return result;
}
async function initializeSchoolDate(){
 if(!picker?.scope.current)return;
 const lease=picker.scope.lease(),mode=platformMode();
 try{
  const result=(await profileApi({schoolId:lease.schoolId,action:"get",...(mode?{platformMode:mode}:{})})).data;
  picker.scope.assertLease(lease);
  const timeZone=String(result?.profile?.timezone||"").trim();
  if(timeZone){
    if(!dateTouched)el("attendanceDate").value=dateInTimeZone(timeZone);
    el("attendanceTimezone").textContent="School timezone · "+timeZone;
    return;
  }
 }catch(error){
  try{picker.scope.assertLease(lease);}catch{return;}
 }
 if(!dateTouched)el("attendanceDate").value=localDate();
 el("attendanceTimezone").textContent="School timezone unavailable · using this device's local date.";
}
function counts(){
 const submitted=rows.filter(row=>row.submitted).length;
 return {sections:rows.length,submitted,missing:rows.length-submitted,
  concern:rows.reduce((sum,row)=>sum+Number(row.counts?.absent||0)+Number(row.counts?.late||0),0)};
}
function renderSummary(){
 const c=counts();
 el("attendanceSectionCount").textContent=c.sections.toLocaleString();
 el("attendanceSubmittedCount").textContent=c.submitted.toLocaleString();
 el("attendanceMissingCount").textContent=c.missing.toLocaleString();
 el("attendanceConcernCount").textContent=c.concern.toLocaleString();
}
function renderTable(){
 const body=el("attendanceTable"),cards=el("attendanceCards"),empty=el("attendanceEmpty"),q=el("attendanceSearch").value.trim().toLocaleLowerCase();
 body.replaceChildren();cards?.replaceChildren();
 const visible=rows.filter(row=>!q||[row.sectionName,row.teacherName,row.yearName].some(value=>String(value||"").toLocaleLowerCase().includes(q)));
 empty.hidden=visible.length>0;
 for(const row of visible){
  const tr=make("tr","border-b border-slate-100 align-middle");
  tr.append(make("td","px-4 py-3 font-semibold",row.sectionName+" · "+row.yearName),
    make("td","px-4 py-3",row.teacherName));
  const status=make("td","px-4 py-3");
  status.append(make("span","rounded-full px-2 py-1 text-xs font-bold "+(row.submitted?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-800"),
    row.submitted?"Submitted · rev "+row.revision:"Missing"));
  tr.append(status);
  for(const key of ["present","late","absent","excused","unmarked"])
   tr.append(make("td","px-4 py-3 text-center "+(key==="absent"&&Number(row.counts?.[key])>0?"font-extrabold text-rose-700":key==="late"&&Number(row.counts?.[key])>0?"font-bold text-amber-700":"text-slate-600"),row.submitted?Number(row.counts?.[key]||0).toLocaleString():"—"));
  const action=make("td","px-4 py-3");
  if(row.submitted){
   const button=make("button","rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold","Review");
   button.type="button";button.addEventListener("click",()=>void openDetail(row));action.append(button);
  }else action.append(make("span","text-xs text-slate-400","Awaiting adviser"));
  tr.append(action);body.append(tr);

  if(cards){
   const card=make("article","rounded-xl border border-slate-200 bg-white p-4");
   const top=make("div","flex items-start justify-between gap-3"),info=make("div","min-w-0");
   info.append(make("h3","font-extrabold text-slate-900",row.sectionName),make("p","text-xs text-slate-500 mt-1",row.teacherName+" · "+row.yearName));
   const badge=make("span","shrink-0 rounded-full px-2 py-1 text-[11px] font-bold "+(row.submitted?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-800"),row.submitted?"Submitted":"Missing");
   top.append(info,badge);card.append(top);
   const metrics=make("div","grid grid-cols-5 gap-1 mt-3 text-center");
   for(const [key,label] of [["present","P"],["late","L"],["absent","A"],["excused","E"],["unmarked","—"]]){
    const box=make("div","rounded-lg bg-slate-50 px-1.5 py-2"),value=make("strong","block text-base",row.submitted?Number(row.counts?.[key]||0).toLocaleString():"—");
    if(key==="absent"&&Number(row.counts?.[key])>0)value.className+=" text-rose-700";
    if(key==="late"&&Number(row.counts?.[key])>0)value.className+=" text-amber-700";
    box.append(make("span","block text-[10px] font-bold uppercase text-slate-500",label),value);metrics.append(box);
   }
   card.append(metrics);
   if(row.submitted){
    const review=make("button","mt-3 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold","Review saved roster");
    review.type="button";review.addEventListener("click",()=>void openDetail(row));card.append(review);
   }else card.append(make("p","mt-3 text-xs font-bold text-amber-700","Awaiting adviser submission"));
   cards.append(card);
  }
 }
}
async function openDetail(row){
 if(busy||!row.submitted)return;
 const dialog=el("attendanceDetailDialog"),host=el("attendanceDetailRows");
 host.replaceChildren();el("attendanceDetailTitle").textContent=row.sectionName;
 el("attendanceDetailMeta").textContent=row.teacherName+" · "+row.yearName+" · "+el("attendanceDate").value;
 el("attendanceDetailStatus").textContent="Loading exact saved roster…";dialog.showModal();
 try{
  const result=await scoped("section_day",{sectionId:row.sectionId,yearId:row.yearId,date:el("attendanceDate").value});
  el("attendanceDetailStatus").textContent="Revision "+result.revision+" · read-only School Admin oversight";
  for(const student of result.students||[]){
   const item=make("div","grid sm:grid-cols-[minmax(0,1fr)_120px] gap-2 rounded-xl border border-slate-200 p-3");
   const info=make("div","min-w-0");info.append(make("strong","block text-sm",student.name),
    make("span","block text-xs text-slate-500 mt-1",[student.studentNumber,student.note].filter(Boolean).join(" · ")||"No note"));
   const tone={present:"bg-emerald-50 text-emerald-800",late:"bg-amber-50 text-amber-800",absent:"bg-rose-50 text-rose-800",excused:"bg-blue-50 text-blue-800",unmarked:"bg-slate-50 text-slate-700"}[student.status]||"bg-slate-50 text-slate-700";
   const state=make("span","self-center justify-self-start sm:justify-self-end rounded-full px-2.5 py-1 text-xs font-bold "+tone,
    ({present:"Present",late:"Late",absent:"Absent",excused:"Excused",unmarked:"Unmarked"})[student.status]||"Unmarked");
   item.append(info,state);host.append(item);
  }
  if(!host.children.length)host.append(make("p","text-sm text-slate-500","No students are in this attendance roster."));
 }catch(error){el("attendanceDetailStatus").textContent=error?.message||"Attendance detail could not load.";}
}
async function load(){
 if(!picker?.scope.current||busy)return;const turn=++epoch,date=el("attendanceDate").value;if(!date)return;
 busy=true;el("attendanceRefresh").disabled=true;say("Loading official attendance for "+date+"…");
 try{
  const result=await scoped("admin_overview",{date});if(turn!==epoch)return;
  rows=result.sections||[];renderSummary();renderTable();
  const c=counts();say(c.sections?
   c.submitted+" of "+c.sections+" advisory section"+(c.sections===1?"":"s")+" submitted attendance for "+date+".":
   "No active advisory sections apply to this date.");
 }catch(error){if(turn===epoch){rows=[];renderSummary();renderTable();say(error?.message||"Attendance oversight could not load.",true);}}
 finally{if(turn===epoch){busy=false;el("attendanceRefresh").disabled=false;}}
}
el("attendanceDate").value=localDate();
el("attendanceDate").addEventListener("change",()=>{dateTouched=true;});
el("attendanceRefresh").addEventListener("click",()=>void load());
el("attendanceSearch").addEventListener("input",renderTable);
el("attendanceDetailClose").addEventListener("click",()=>el("attendanceDetailDialog").close());
el("attendanceDetailDialog").addEventListener("cancel",()=>{});
picker=createTenantSchoolPicker({
 host:el("attendanceSchoolSwitcher"),status:null,
 onBeforeChange:async()=>{
  if(busy)throw Error("Finish the attendance refresh before switching schools.");
  ++epoch;rows=[];dateTouched=false;renderSummary();renderTable();
  el("attendanceTimezone").textContent="Loading school timezone…";
 },
 onReady:scope=>{
  if(scope.current?.roles.includes("school_admin")||platformMode()==="assist")
    void initializeSchoolDate().then(()=>load());
  else say("School Administrator access is required.",true);
 }
});
renderSummary();renderTable();
await auth.authStateReady();
try{
 const state=await picker.load();
 if(!auth.currentUser)say("Sign in with a verified School Administrator account.",true);
 else if(state?.state==="choose_school")say("Choose the school whose advisory attendance you want to review.");
}catch(error){say(error?.message||"Verified school access is unavailable.",true);}
