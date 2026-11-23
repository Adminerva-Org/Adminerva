/** Platform Administrator aggregate research views; no individual school student data. */
import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const endpoint=httpsCallable(getFunctions(app,"asia-southeast1"),"platformPilotResearchOverview");
const status=document.getElementById("pilot-research-status");
const rows=document.getElementById("pilot-research-rows");
const details=document.getElementById("pilot-research-breakdowns");
const legacy=document.getElementById("pilot-research-legacy");
const button=document.getElementById("pilot-research-refresh");
const exportButton=document.getElementById("pilot-research-export");
let generation=0,loading=false,overview=null;
const outcomes=["success","compile_error","runtime_error","cancelled","unknown"];
const eventTypes=["project_open","editor_activity","run_finished","cloud_saved"];
const columns=[
  "School","State","People","Memberships","Enrollments","Assessments",
  "Studio submissions","GitHub evidence","Grade records","All 30-day pilot events",
  "Sample coverage percent","Sampled accounts","Sampled sessions","Sampled projects",
  "Editor bursts","Editor changes","Runs","Run success","Compile errors",
  "Runtime errors","Cancelled runs","Unknown run outcomes","Cloud saves",
  "First sampled UTC","Last sampled UTC","Daily sampled events (UTC)"
];
function safeNumber(value){return Number.isFinite(value)?value:0;}
function timestampText(value){return Number.isFinite(value)?new Date(value).toISOString():"";}
function sampledRow(school){
  const record=school.counts||{},pilot=school.pilotSample||{},types=pilot.eventsByType||{};
  const run=pilot.runsByOutcome||{},days=Array.isArray(pilot.dailyEvents)?pilot.dailyEvents:[];
  return [
    school.schoolName||school.schoolId,school.schoolState,
    record.people,record.memberships,record.enrollments,record.assessments,
    record.studio_submissions,record.github_evidence,record.student_grades,
    pilot.totalEvents,pilot.coveragePercent,pilot.observedAccounts,pilot.observedSessions,
    pilot.observedProjects,types.editor_activity||0,pilot.editorChanges||0,
    types.run_finished||0,run.success||0,run.compile_error||0,
    run.runtime_error||0,run.cancelled||0,run.unknown||0,types.cloud_saved||0,
    timestampText(pilot.firstObservedAt),timestampText(pilot.lastObservedAt),
    days.map(row=>row.day+":"+row.count).join(" | ")
  ];
}
function tableCell(row,value){
  const cell=document.createElement("td");
  cell.className="p-2 border-b align-top";
  cell.textContent=String(value??"—");
  row.appendChild(cell);
}
function csvCell(value){
  let valueText=String(value??"").replace(/[\r\n]/g," ");
  if(/^[=+\-@\t]/.test(valueText))valueText="'"+valueText;
  return '"'+valueText.replaceAll('"','""')+'"';
}
function exportAggregates(){
  if(!overview||!Array.isArray(overview.schools))return;
  const data=[columns,...overview.schools.map(sampledRow)]
    .map(row=>row.map(csvCell).join(",")).join("\r\n");
  const file=new Blob(["\ufeff",data],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(file),a=document.createElement("a");
  const date=new Date(overview.generatedAt||Date.now()).toISOString().slice(0,10);
  a.href=url;a.download="adminerva-pilot-research-aggregates-"+date+".csv";
  document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function breakdown(school){
  const pilot=school.pilotSample||{},type=pilot.eventsByType||{},run=pilot.runsByOutcome||{};
  const card=document.createElement("details");
  card.className="border rounded p-3";
  const title=document.createElement("summary");
  title.className="cursor-pointer font-semibold";
  title.textContent=(school.schoolName||school.schoolId)+
    " · "+(Number.isInteger(pilot.totalEvents)?pilot.totalEvents:"Not available")+" total 30-day events · "+safeNumber(pilot.events)+" sampled";
  const text=document.createElement("p");
  text.className="text-sm mt-2";
  text.textContent="30-day sampled events: "+
    eventTypes.map(key=>key.replaceAll("_"," ")+": "+safeNumber(type[key])).join(" · ")+
    ". Run outcomes: "+outcomes.map(key=>key.replaceAll("_"," ")+": "+safeNumber(run[key])).join(" · ")+
    ". Sampled editor change operations: "+safeNumber(pilot.editorChanges)+
    ". Sample coverage: "+safeNumber(pilot.coveragePercent)+"%. These measures are not keystrokes, time-on-task or mastery.";
  const time=document.createElement("p");
  time.className="text-sm mt-2";
  const days=Array.isArray(pilot.dailyEvents)?pilot.dailyEvents:[];
  time.textContent="Observed UTC days (sample only): "+
    (days.length?days.map(day=>day.day+" ("+day.count+")").join(" · "):"No eligible events.");
  card.append(title,text,time);
  return card;
}
async function refresh(){
  if(loading||!auth.currentUser)return;
  const actor=auth.currentUser.uid,epoch=++generation;
  loading=true;button.disabled=true;exportButton.disabled=true;
  overview=null;rows.replaceChildren();details.replaceChildren();
  status.textContent="Loading platform totals and pilot research coverage…";
  try{
    const response=(await endpoint({action:"overview"})).data;
    if(epoch!==generation||auth.currentUser?.uid!==actor)return;
    const schools=Array.isArray(response?.schools)?response.schools:[];
    const old=response?.legacySourceCounts||{};
    legacy.textContent="Legacy pre-V4 source totals (may overlap with current school records): "+
      ["students","assessments","student_grades","student_submissions","assessment_evidence","activity_events"]
        .map(key=>key.replaceAll("_"," ")+": "+(Number.isInteger(old[key])?old[key]:"—")).join(" · ");
    for(const school of schools){
      const data=sampledRow(school),row=document.createElement("tr");
      // The table is a compact subset; the export includes outcomes and UTC dates.
      for(const value of data.slice(0,17))tableCell(row,value);
      tableCell(row,data[22]);
      rows.appendChild(row);
      details.appendChild(breakdown(school));
    }
    overview=response;exportButton.disabled=false;
    status.textContent=schools.length
      ? "Loaded "+schools.length+" schools. The 30-day event totals are exact; process breakdowns and observed accounts/sessions are recent samples capped at 500 events per school. Coverage shows how representative that sample is by event count, not by learner. Historical legacy and V4 totals may overlap. No code, identities or raw grades are exported."
      : "No active, pilot or draft schools are available in the bounded overview.";
  }catch(error){
    if(epoch===generation)status.textContent=
      /permission-denied|unauthenticated/.test(String(error?.code||""))
        ?"Only an authorized Platform Administrator may view cross-school aggregates."
        :"Research overview unavailable. Refresh to retry; check backend deployment, server logs and registry pagination limits.";
  }finally{
    if(epoch===generation){loading=false;button.disabled=false;}
  }
}
button?.addEventListener("click",()=>void refresh());
exportButton?.addEventListener("click",exportAggregates);
onAuthStateChanged(auth,()=>{
  generation++;loading=false;overview=null;
  if(button)button.disabled=false;
  if(exportButton)exportButton.disabled=true;
  rows?.replaceChildren();details?.replaceChildren();
  if(legacy)legacy.textContent="Legacy source counts have not been loaded.";
  if(auth.currentUser)void refresh();
});
