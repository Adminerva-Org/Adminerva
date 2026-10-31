import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {activePlanningSchool} from "./school-planning.mjs?v=4.0.0";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolSchedules");
function key(uid,schoolId,year,semester){
  return "Adminerva_v4_schedule_revision_"+uid+"_"+schoolId+"_"+year+"_"+semester;
}
function revision(uid,schoolId,year,semester){
  try{
    const value=Number(localStorage.getItem(key(uid,schoolId,year,semester)));
    return Number.isInteger(value)&&value>=0?value:null;
  }catch{return null;}
}
function remember(uid,schoolId,year,semester,value){
  try{localStorage.setItem(key(uid,schoolId,year,semester),String(value));}catch{}
}
function canonical(value){
  function normalize(node){
    if(node===null||typeof node==="string"||typeof node==="boolean")return node;
    if(typeof node==="number")return Number.isFinite(node)?(Object.is(node,-0)?0:node):null;
    if(Array.isArray(node))return node.map(normalize);
    if(node&&typeof node==="object"){
      const out={};for(const name of Object.keys(node).sort())out[name]=normalize(node[name]);return out;
    }
    return null;
  }
  return JSON.stringify(normalize(value));
}
async function call(action,details){
  const school=await activePlanningSchool(),uid=auth.currentUser?.uid;
  const result=(await api({schoolId:school.schoolId,action,...details})).data;
  if(auth.currentUser?.uid!==uid)throw Error("Account changed. School timetable response ignored.");
  const current=await activePlanningSchool();
  if(current.schoolId!==school.schoolId)throw Error("School changed. School timetable response ignored.");
  return {school,result};
}
async function loadSchoolSchedule(){
  const state=window.adminervaScheduleBridgeState?.();
  if(!state)throw Error("The timetable editor is not ready.");
  const {school,result}=await call("get",{schoolYear:state.schoolYear,semester:state.semester});
  if(result.revision===0&&!result.rows.length)
    throw Error("No verified-school timetable has been saved for this period.");
  const loaded=window.adminervaApplySchoolSchedule?.(result);
  if(loaded===false)return;
  remember(auth.currentUser.uid,school.schoolId,state.schoolYear,state.semester,result.revision);
}
async function saveSchoolSchedule(){
  const state=window.adminervaScheduleBridgeState?.();
  if(!state)throw Error("The timetable editor is not ready.");
  const school=await activePlanningSchool(),uid=auth.currentUser.uid;
  let expected=revision(uid,school.schoolId,state.schoolYear,state.semester);
  if(expected===null){
    const current=(await call("get",{schoolYear:state.schoolYear,semester:state.semester})).result;
    if(current.revision>0){
      if(canonical(current.rows)!==canonical(state.rows))
        throw Error("A different verified-school timetable already exists for this period. Load it first before replacing anything.");
      expected=current.revision;
    }else expected=0;
    remember(uid,school.schoolId,state.schoolYear,state.semester,expected);
  }
  const result=(await call("save",{
    schoolYear:state.schoolYear,semester:state.semester,rows:state.rows,expectedRevision:expected
  })).result;
  remember(uid,school.schoolId,state.schoolYear,state.semester,result.revision);
  return {...result,schoolName:school.name||school.schoolId};
}
async function mount(){
  const anchor=document.getElementById("editSaveBtn");
  if(!anchor||document.getElementById("v4ScheduleSave"))return;
  try{await activePlanningSchool();}catch{return;}
  const load=document.createElement("button");
  load.id="v4ScheduleLoad";load.type="button";
  load.className="w-full sm:w-auto justify-center border border-indigo-300 bg-white text-indigo-800 px-4 py-3 sm:py-2 rounded font-bold hover:bg-indigo-50 transition shadow-sm flex items-center gap-2 text-sm";
  load.innerHTML="<span>🏫</span> Load school";
  const save=document.createElement("button");
  save.id="v4ScheduleSave";save.type="button";
  save.className="w-full sm:w-auto justify-center bg-indigo-700 text-white px-4 py-3 sm:py-2 rounded font-bold hover:bg-indigo-800 transition shadow-sm flex items-center gap-2 text-sm";
  save.innerHTML="<span>🏫</span> Save to school";
  const setBusy=value=>{load.disabled=value;save.disabled=value;};
  load.addEventListener("click",()=>void (async()=>{
    setBusy(true);const end=window.beginLoading?.("Loading verified-school timetable…")||(()=>{});
    try{await loadSchoolSchedule();}
    catch(error){alert("School timetable was not loaded: "+(error?.message||"check your verified school access."));}
    finally{end();setBusy(false);}
  })());
  save.addEventListener("click",()=>void (async()=>{
    setBusy(true);const end=window.beginLoading?.("Validating class assignments and saving school timetable…")||(()=>{});
    try{
      const result=await saveSchoolSchedule();
      alert("Timetable saved to "+result.schoolName+" · revision "+result.revision+
        ". The legacy personal Save Schedule remains separate during migration.");
    }catch(error){alert("School timetable was not saved: "+(error?.message||"review the class assignments and current school revision."));}
    finally{end();setBusy(false);}
  })());
  anchor.after(save);anchor.after(load);
  const note=document.createElement("p");note.id="v4ScheduleNote";
  note.className="text-xs text-indigo-800 mt-2";
  note.textContent="Verified-school timetable controls are separate from the legacy personal cloud schedule during the 4.0 migration.";
  document.getElementById("scheduleScopeStatus")?.parentElement?.append(note);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void mount(),{once:true});
else void mount();
