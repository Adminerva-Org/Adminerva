/** Aggregate-only System Admin view. No student records or raw telemetry returned. */
import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const endpoint=httpsCallable(getFunctions(app,"asia-southeast1"),"platformPilotResearchOverview");
const status=document.getElementById("pilot-research-status");
const rows=document.getElementById("pilot-research-rows");
const legacy=document.getElementById("pilot-research-legacy");
const button=document.getElementById("pilot-research-refresh");
let generation=0,loading=false;
function tableCell(row,value){
  const cell=document.createElement("td");
  cell.className="p-2 border-b align-top";
  cell.textContent=String(value??"—");
  row.appendChild(cell);
}
async function refresh(){
  if(loading||!auth.currentUser)return;
  const actor=auth.currentUser.uid,epoch=++generation;
  loading=true;button.disabled=true;rows.replaceChildren();
  status.textContent="Loading platform and pilot metrics…";
  try{
    const overview=(await endpoint({action:"overview"})).data;
    if(epoch!==generation||auth.currentUser?.uid!==actor)return;
    const schools=Array.isArray(overview?.schools)?overview.schools:[];
    const old=overview?.legacySourceCounts||{};
    legacy.textContent="Legacy pre-V4 source totals (may overlap with current school records): "+
      ["students","assessments","student_grades","student_submissions","assessment_evidence","activity_events"]
        .map(key=>key.replaceAll("_"," ")+": "+(Number.isInteger(old[key])?old[key]:"—")).join(" · ");
    for(const school of schools){
      const record=school.counts||{},pilot=school.pilotSample||{},types=pilot.eventsByType||{};
      const row=document.createElement("tr");
      for(const value of [
        school.schoolName||school.schoolId,school.schoolState,
        record.people,record.memberships,record.enrollments,record.assessments,
        record.studio_submissions,record.github_evidence,record.student_grades,
        pilot.observedAccounts,pilot.events,types.editor_activity||0,types.run_finished||0,types.cloud_saved||0
      ])tableCell(row,value);
      rows.appendChild(row);
      if(pilot.truncated){
        const warning=row.lastElementChild;
        warning.textContent+="*";
      }
    }
    status.textContent=schools.length
      ? "School record totals come from current source collections. Pilot activity is a latest-500-event, last-30-days observation per school; * indicates a truncated sample. Zero observed events does not prove no activity. No code, names or raw grades are shown."
      : "No active, pilot, or draft schools are currently available in the bounded registry.";
  }catch(error){
    if(epoch===generation)status.textContent=
      /permission-denied|unauthenticated/.test(String(error?.code||""))
        ?"Only an authorized Platform Administrator may view cross-school aggregates."
        :"Pilot overview is unavailable. The research backend may not be deployed or the registry may exceed its safe reporting limit.";
  }finally{
    if(epoch===generation){loading=false;button.disabled=false;}
  }
}
button?.addEventListener("click",()=>void refresh());
onAuthStateChanged(auth,()=>{
  generation++;loading=false;if(button)button.disabled=false;
  rows?.replaceChildren();if(legacy)legacy.textContent="Legacy source counts have not been loaded.";
  if(auth.currentUser)void refresh();
});
