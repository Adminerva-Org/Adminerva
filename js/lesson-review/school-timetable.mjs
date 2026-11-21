/** School-owned timetable editor. Existing legacy timetable remains a separate source. */
import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.1";
import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.0";
const el=id=>document.getElementById(id);
const functions=getFunctions(app,"asia-southeast1"),academics=httpsCallable(functions,"schoolAcademics"),schedules=httpsCallable(functions,"schoolSchedules");
const panel=el("schoolTimetable"),legacy=el("legacyTimetable"),status=el("schoolTimetableStatus"),period=el("schoolTimetablePeriod"),editor=el("schoolTimetableEditor"),host=el("schoolTimetableRows");
const days=[["mon","Monday"],["tue","Tuesday"],["wed","Wednesday"],["thu","Thursday"],["fri","Friday"]];
let picker=null,rows=[],offerings=[],periods=[],officialSchedules=[],activePeriod="",revision=0,dirty=false,busy=false,ready=false,epoch=0,legacyLoaded=false,legacyAvailable=false;
const node=(tag,text="",className="")=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
function say(message){status.textContent=message;}
function markDirty(){dirty=true;el("schoolTimetableSave").disabled=!ready||busy;say("Unsaved personal timetable changes. Save the overlay to sync across devices.");}
function updateControls(){
  period.disabled=busy;editor.disabled=busy||!ready;
  el("schoolTimetableReload").disabled=busy||!activePeriod;
  el("schoolTimetableSave").disabled=busy||!ready||!dirty;
}
function reset(){++epoch;rows=[];offerings=[];periods=[];officialSchedules=[];activePeriod="";revision=0;dirty=false;busy=false;ready=false;host.replaceChildren();period.replaceChildren(new Option("Choose academic period",""));updateControls();el("schoolTimetableSummary").textContent="";el("schoolOfficialTimetableRows").replaceChildren();el("schoolOfficialTimetableSummary").textContent="";}
async function scoped(api,action,fields={}){
  const lease=picker.scope.lease(),result=(await api({schoolId:lease.schoolId,action,...fields})).data;
  picker.scope.assertLease(lease);
  if(auth.currentUser?.uid!==lease.uid)throw Error("Account changed. Reload your timetable.");
  return result;
}
function pairKey(sec,sub){return JSON.stringify([sec||"",sub||""]);}
function choices(){
  const pairs=new Map();
  for(const row of offerings.filter(row=>row.termId===activePeriod)){
    if(row.sectionName&&row.subjectName)pairs.set(pairKey(row.sectionName,row.subjectName),row.sectionName+" · "+row.subjectName);
  }
  return [...pairs].sort((a,b)=>a[1].localeCompare(b[1]));
}
function minutes(text){const m=/^([0-9]{2}):([0-9]{2})$/.exec(text||"");return m&&Number(m[1])<24&&Number(m[2])<60?Number(m[1])*60+Number(m[2]):null;}
const dayNames={mon:"Monday",tue:"Tuesday",wed:"Wednesday",thu:"Thursday",fri:"Friday",sat:"Saturday"};
function renderOfficial(){
  const host=el("schoolOfficialTimetableRows"),summary=el("schoolOfficialTimetableSummary");host.replaceChildren();
  const schedules=officialSchedules.filter(row=>!activePeriod||row.termId===activePeriod),meetings=[];
  for(const schedule of schedules){
    const offering=offerings.find(row=>row.offeringId===schedule.offeringId);
    for(const meeting of schedule.meetings||[])meetings.push({meeting,offering});
  }
  meetings.sort((a,b)=>Object.keys(dayNames).indexOf(a.meeting.day)-Object.keys(dayNames).indexOf(b.meeting.day)||
    minutes(a.meeting.startTime)-minutes(b.meeting.startTime));
  const weekly=meetings.reduce((sum,row)=>sum+Math.max(0,(minutes(row.meeting.endTime)||0)-(minutes(row.meeting.startTime)||0)),0);
  summary.textContent=meetings.length?
    meetings.length+" official class meeting"+(meetings.length===1?"":"s")+" · "+Math.floor(weekly/60)+"h "+weekly%60+"m scheduled/week":
    activePeriod?"No official class meetings have been scheduled for your assigned classes in this period.":"Choose an academic period to view its official meetings.";
  if(!meetings.length){
    const empty=node("p",activePeriod?"School Administration has not scheduled your assigned classes in this period yet.":"Choose an academic period.","rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600 md:col-span-2");
    host.append(empty);return;
  }
  const grouped=new Map();
  for(const entry of meetings){const list=grouped.get(entry.meeting.day)||[];list.push(entry);grouped.set(entry.meeting.day,list);}
  for(const day of Object.keys(dayNames)){
    const entries=grouped.get(day);if(!entries?.length)continue;
    const card=node("article","","rounded-xl border border-violet-100 bg-violet-50/50 p-4"),title=node("h3",dayNames[day],"font-extrabold text-violet-950");
    card.append(title);
    for(const {meeting,offering} of entries){
      const row=node("div","","mt-2 rounded-lg border border-violet-100 bg-white p-3");
      row.append(node("strong",[meeting.startTime+"–"+meeting.endTime,offering?.subjectName||"Class"].join(" · "),"block text-sm"),
        node("span",[offering?.sectionName,meeting.room].filter(Boolean).join(" · ")||"Assigned class","block text-xs text-slate-500 mt-1"));
      card.append(row);
    }
    host.append(card);
  }
}
function renderSummary(){
  let sessions=0,weekly=0;
  for(const row of rows){const start=minutes(row.startTime),end=minutes(row.endTime);if(row.type!=="class")continue;
    const count=days.filter(([key])=>row[key]?.sec&&row[key]?.sub&&!row[key]?.evt).length;sessions+=count;
    if(start!==null&&end!==null&&end>start)weekly+=(end-start)*count;
  }
  el("schoolTimetableSummary").textContent=sessions+" class sessions · "+Math.floor(weekly/60)+"h "+weekly%60+"m scheduled per week in this period.";
}
function control(label,input){const wrap=node("label","","block text-sm font-bold");wrap.append(node("span",label),input);return wrap;}
function input(type,value,handler){
  const control=node("input","","block w-full min-h-11 border rounded-lg p-2 mt-1");control.type=type;control.value=value||"";
  control.addEventListener("input",()=>{handler(control.value);markDirty();renderSummary();});return control;
}
function renderRows(){
  host.replaceChildren();
  const pairs=choices();
  rows.forEach((row,index)=>{
    const card=node("article","","rounded-xl border p-3 space-y-3 bg-white");
    const heading=node("div","","flex flex-wrap items-center justify-between gap-2");
    heading.append(node("strong","Slot "+(index+1)+" · "+(row.type==="constant"?"Daily event":"Weekly classes")));
    const remove=node("button","Remove slot","av-secondary-button");remove.type="button";remove.addEventListener("click",()=>{rows.splice(index,1);markDirty();renderRows();});heading.append(remove);
    const times=node("div","","grid grid-cols-2 gap-2");
    times.append(control("Start",input("time",row.startTime,v=>row.startTime=v)),control("End",input("time",row.endTime,v=>row.endTime=v)));
    card.append(heading,times);
    if(row.type==="constant"){
      const event=input("text",row.eventName,v=>row.eventName=v);event.maxLength=120;card.append(control("Event on weekdays",event));
    }else{
      const grid=node("div","","grid sm:grid-cols-2 xl:grid-cols-5 gap-3");
      for(const [key,label] of days){
        const cell=row[key]||(row[key]={sec:"",sub:"",evt:""}),wrap=node("div","","rounded-lg border p-2 min-w-0");
        const select=node("select","","block w-full min-h-11 border rounded-lg p-2 mt-1 text-sm");
        select.add(new Option("No class",""));
        for(const [value,name] of pairs)select.add(new Option(name,value));
        const value=cell.sec&&cell.sub?pairKey(cell.sec,cell.sub):"";
        if(value&&!pairs.some(([id])=>id===value))select.add(new Option(cell.sec+" · "+cell.sub+" (assignment needs review)",value));
        select.value=value;
        const event=input("text",cell.evt,v=>cell.evt=v);event.maxLength=120;event.placeholder="Optional non-class event";
        select.addEventListener("change",()=>{const [sec,sub]=select.value?JSON.parse(select.value):["",""];cell.sec=sec;cell.sub=sub;if(sec){cell.evt="";event.value="";}markDirty();renderSummary();});
        event.addEventListener("input",()=>{if(event.value.trim()){cell.sec="";cell.sub="";select.value="";}renderSummary();});
        wrap.append(control(label,select),control("Event",event));grid.append(wrap);
      }
      card.append(grid);
    }
    host.append(card);
  });
  if(!rows.length)host.append(node("p","No weekly slots yet. Add a class slot or a repeating event.","text-sm text-slate-500"));
  renderSummary();updateControls();
}
function blankRow(type){
  const row={type,startTime:"08:00",endTime:"08:50"};
  if(type==="constant")row.eventName="";else for(const [key] of days)row[key]={sec:"",sub:"",evt:""};
  return row;
}
function addRow(type){if(!ready||busy)return;if(rows.length>=40){say("A timetable supports up to 40 time slots.");return;}rows.push(blankRow(type));markDirty();renderRows();}
async function loadPeriod(id){
  const run=++epoch;ready=false;busy=true;activePeriod=id;period.value=id;rows=[];dirty=false;revision=0;host.replaceChildren();renderSummary();updateControls();
  if(!id){busy=false;updateControls();say("Choose an assigned academic period.");return;}
  say("Loading your saved personal timetable overlay…");
  try{
    const data=await scoped(schedules,"get",{periodId:id});
    if(run!==epoch)return;
    rows=Array.isArray(data.rows)?structuredClone(data.rows):[];revision=Number(data.revision)||0;ready=true;
    say(revision?"Loaded personal timetable overlay · revision "+revision:"No personal timetable overlay in this period. Official classes are shown above.");
  }catch(error){if(run===epoch)say(error?.message||"Timetable unavailable. Reload before editing.");}
  finally{if(run===epoch){busy=false;renderRows();}}
}
async function loadOptions(){
  const run=++epoch;busy=true;updateControls();say("Loading your active school teaching assignments…");
  try{
    const [result,official]=await Promise.all([
      scoped(academics,"planning_options",{assignmentScope:"teacher"}),
      scoped(schedules,"my_official_schedule")
    ]);
    if(run!==epoch)return;
    offerings=result.offerings||[];officialSchedules=official.schedules||[];
    const used=new Set(offerings.map(row=>row.termId));
    periods=(result.periodRecords||[]).filter(row=>used.has(row.termId));
    period.replaceChildren(new Option("Choose academic period",""));
    for(const row of periods){
      const sample=offerings.find(x=>x.termId===row.termId);
      period.add(new Option([sample?.yearName,sample?.programName,row.name].filter(Boolean).join(" · "),row.termId));
    }
    if(periods.length===1){await loadPeriod(periods[0].termId);return;}
    renderOfficial();
    say(periods.length?"Choose an academic period to view the official timetable and personal planning overlay.":"No active assigned periods. Ask your school administrator to assign your classes.");
  }catch(error){if(run===epoch)say(error?.message||"Teaching assignments unavailable.");}
  finally{if(run===epoch){busy=false;updateControls();}}
}
async function save(){
  if(!ready||busy||!dirty)return;
  for(const [index,row] of rows.entries()){
    const start=minutes(row.startTime),end=minutes(row.endTime);
    if(start===null||end===null||start>=end){say("Slot "+(index+1)+" needs a valid start and end time.");return;}
    if(row.type==="constant"&&!row.eventName.trim()){say("Slot "+(index+1)+" needs an event name.");return;}
  }
  const ordered=rows.map((row,index)=>({row,index})).sort((a,b)=>minutes(a.row.startTime)-minutes(b.row.startTime));
  for(let i=1;i<ordered.length;i++)if(minutes(ordered[i-1].row.endTime)>minutes(ordered[i].row.startTime)){say("Time slots "+(ordered[i-1].index+1)+" and "+(ordered[i].index+1)+" overlap. Use one slot for the same time across weekdays.");return;}
  const run=epoch;busy=true;updateControls();say("Saving personal timetable overlay…");
  try{
    const result=await scoped(schedules,"save",{periodId:activePeriod,rows:ordered.map(x=>x.row),expectedRevision:revision});
    if(run!==epoch)return;
    revision=result.revision;rows=ordered.map(x=>x.row);dirty=false;say("Personal timetable overlay saved · revision "+revision);
  }catch(error){if(run===epoch)say((error?.message||"Cloud save failed.")+" Your unsaved edits remain in this view.");}
  finally{if(run===epoch){busy=false;renderRows();}}
}
async function showLegacy(){
  if(!legacyAvailable)return;
  if(dirty&&!confirm("Leave this view with unsaved personal timetable changes?"))return;
  panel.hidden=true;legacy.hidden=false;el("schoolTimetableReturn").hidden=!picker.scope.current?.roles.includes("teacher");
  if(!legacyLoaded){legacyLoaded=true;try{await import("./schedule.js?v=4.0.1");}catch(error){legacyLoaded=false;legacy.hidden=true;panel.hidden=false;say("Legacy timetable could not load: "+(error?.message||error));}}
}
function showSchool(){legacy.hidden=true;panel.hidden=false;el("schoolTimetableReturn").hidden=true;}
period.addEventListener("change",()=>{const requested=period.value;if(dirty&&!confirm("Discard unsaved edits before changing periods?")){period.value=activePeriod;return;}void loadPeriod(requested);});
el("schoolTimetableReload").addEventListener("click",()=>{if(dirty&&!confirm("Discard unsaved edits and reload the cloud timetable?"))return;void loadPeriod(activePeriod);});
el("schoolTimetableRefreshOptions").addEventListener("click",()=>{if(busy)return;if(dirty&&!confirm("Discard unsaved edits to reload the period list?"))return;reset();void loadOptions();});
el("schoolTimetableAddClass").addEventListener("click",()=>addRow("class"));
el("schoolTimetableAddEvent").addEventListener("click",()=>addRow("constant"));
el("schoolTimetableSave").addEventListener("click",()=>void save());
el("schoolTimetableLegacy").addEventListener("click",()=>void showLegacy());
el("schoolTimetableReturn").addEventListener("click",()=>showSchool());
window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});
picker=createTenantSchoolPicker({
  host:el("schoolTimetableSwitcher"),status,
  onBeforeChange:async()=>{if(busy||dirty)throw Error("Finish saving your timetable before switching schools.");reset();showSchool();legacyAvailable=false;el("schoolTimetableLegacy").hidden=true;},
  onReady:scope=>{
    const current=scope.current;showSchool();reset();
    if(current?.roles.includes("teacher"))void loadOptions();
    else say("An active teacher membership is required for school timetable editing.");
    void resolveStaffRole(auth.currentUser).then(role=>{
      if(scope.current?.schoolId!==current?.schoolId)return;
      legacyAvailable=Boolean(role&&current?.compatibilityMode==="legacy_allowed");
      el("schoolTimetableLegacy").hidden=!legacyAvailable;
    });
  }
});
try{
  const result=await picker.load();
  if(!result?.context&&result?.state==="no_school"){
    legacyAvailable=Boolean(await resolveStaffRole(auth.currentUser));
    el("schoolTimetableLegacy").hidden=!legacyAvailable;
    if(legacyAvailable)await showLegacy();
  }
}catch(error){say("School access could not be verified. Reload before editing: "+(error?.message||error));}
