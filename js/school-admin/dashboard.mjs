import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.1";

const get=id=>document.getElementById(id);
const functions=getFunctions(app,"asia-southeast1");
const peopleApi=httpsCallable(functions,"peopleDirectory");
const profileApi=httpsCallable(functions,"schoolProfile");
const academicsApi=httpsCallable(functions,"schoolAcademics");
const schedulesApi=httpsCallable(functions,"schoolSchedules");
const classRecordApi=httpsCallable(functions,"schoolClassRecordAdmin");
const gradingPolicyApi=httpsCallable(functions,"schoolClassRecord");
const supportApi=httpsCallable(functions,"schoolSupport");
const status=get("adminOverviewStatus"),attentionList=get("adminAttentionList"),recordList=get("adminClassRecordList");
const refresh=get("adminRefresh"),attentionFilter=get("adminAttentionFilter"),recordFilter=get("adminRecordFilter"),recordSearch=get("adminRecordSearch");
let picker=null,loadGeneration=0,model={},attentionLimit=10,recordLimit=20,enrollmentHref="people-access.html#classes";
const priorities={integrity:0,attention:1,review:2};
const tabs=new Set(["overview","people","invites","classes","access","import"]);
function escapeHTML(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));}
function count(value){return Number.isFinite(value)&&value>=0?value.toLocaleString():"—";}
function set(id,value){get(id).textContent=value;}
function gradingCoverage(){
  const offerings=Array.isArray(model.academics?.offerings)?model.academics.offerings:[],
    schemes=Array.isArray(model.grading?.schemes)?model.grading.schemes:[],
    periodTypes=new Map((model.academics?.periodRecords||[]).map(row=>[row.termId,row.periodType||"term"])),
    uncovered=[],ambiguous=[],covered=[];
  const specificity=scope=>Number(Boolean(scope?.programId))+Number(Boolean(scope?.subjectId))+
    Number(Boolean(scope?.sectionId))+Number(Boolean(scope?.periodTypes?.length));
  const matches=(scheme,offering)=>{
    const scope=scheme.applicability||{},periodType=String(periodTypes.get(offering.termId)||"term").toLowerCase();
    if(scope.programId&&scope.programId!==offering.programId)return false;
    if(scope.subjectId&&scope.subjectId!==offering.subjectId)return false;
    if(scope.sectionId&&scope.sectionId!==offering.sectionId)return false;
    if(scope.periodTypes?.length&&!scope.periodTypes.map(value=>String(value).toLowerCase()).includes(periodType))return false;
    return true;
  };
  for(const offering of offerings){
    const candidates=schemes.filter(scheme=>matches(scheme,offering));
    if(!candidates.length){uncovered.push(offering);continue;}
    const top=Math.max(...candidates.map(scheme=>specificity(scheme.applicability||{}))),
      winners=candidates.filter(scheme=>specificity(scheme.applicability||{})===top);
    if(winners.length>1)ambiguous.push({offering,schemes:winners});
    else covered.push(offering);
  }
  return {total:offerings.length,covered,uncovered,ambiguous};
}
function renderGradingWorkflow(){
  const node=get("adminWorkflowGrading");if(!node)return;
  if(model.grading===null){node.textContent="Unavailable";node.className="rounded-full px-2 py-1 text-[11px] font-bold bg-amber-100 text-amber-900";return;}
  const schemes=Array.isArray(model.grading?.schemes)?model.grading.schemes:null;
  if(!schemes){node.textContent="Checking…";node.className="rounded-full px-2 py-1 text-[11px] font-bold bg-slate-200 text-slate-700";return;}
  if(!schemes.length){node.textContent="Not configured";node.className="rounded-full px-2 py-1 text-[11px] font-bold bg-slate-200 text-slate-700";return;}
  const coverage=gradingCoverage();
  if(coverage.ambiguous.length){
    node.textContent=coverage.ambiguous.length+" policy conflict"+(coverage.ambiguous.length===1?"":"s");
    node.className="rounded-full px-2 py-1 text-[11px] font-bold bg-rose-100 text-rose-800";return;
  }
  if(coverage.total&&coverage.uncovered.length){
    node.textContent=coverage.covered.length+"/"+coverage.total+" classes covered";
    node.className="rounded-full px-2 py-1 text-[11px] font-bold bg-amber-100 text-amber-900";return;
  }
  node.textContent=coverage.total?coverage.total+"/"+coverage.total+" classes covered":schemes.length+" active polic"+(schemes.length===1?"y":"ies");
  node.className="rounded-full px-2 py-1 text-[11px] font-bold bg-emerald-100 text-emerald-800";
}
function setWorkflow(id,value,noun){
  const node=get(id);if(!node)return;
  const numeric=Number(value),known=Number.isFinite(numeric)&&numeric>=0;
  node.textContent=!known?"Unavailable":numeric>0?numeric.toLocaleString()+" "+noun+(numeric===1?"":"s"):"Not started";
  node.className="rounded-full px-2 py-1 text-[11px] font-bold "+(!known?"bg-amber-100 text-amber-900":numeric>0?"bg-emerald-100 text-emerald-800":"bg-slate-200 text-slate-700");
}
function applyEnrollmentRoute(scope){
  const standard=scope.current?.enrollmentMode==="canonical";
  const href=standard?"school-enrollment.html":"people-access.html#classes";
  enrollmentHref=href;
  const workflow=get("adminWorkflowEnrollmentLink"),shortcut=get("adminEnrollmentShortcut");
  if(workflow){workflow.href=href;workflow.textContent=standard?"Open Enrollment & Registration →":"Manage enrollment relationships →";}
  if(shortcut)shortcut.href=href;
  if(get("adminEnrollmentShortcutAction"))get("adminEnrollmentShortcutAction").textContent=standard?"Open Enrollment & Registration →":"Manage enrollment relationships →";
  if(get("adminWorkflowEnrollmentTitle"))get("adminWorkflowEnrollmentTitle").textContent=standard?"Enrollment & Registration":"Student enrollment";
  if(get("adminWorkflowEnrollmentHelp"))get("adminWorkflowEnrollmentHelp").textContent=standard
    ?"Register students, confirm official placement and create subject enrollments together."
    :"Manage reviewed student-to-offering relationships for this school's current enrollment model.";
}
function renderRecommendation({final=false}={}){
  const title=get("adminNextActionTitle"),detail=get("adminNextActionDetail"),link=get("adminNextActionLink"),panel=get("adminNextAction");
  if(!title||!detail||!link||!panel)return;
  const sources=[model.profile,model.academics,model.overview,model.reconciliation,model.classes,model.schedules,model.grading,model.records,model.support],
    complete=sources.every(value=>value!==undefined);
  if(!final&&!complete){
    title.textContent="Checking school operations…";
    detail.textContent="Adminerva is checking school profile, academic setup, directory, staffing, Class Record and support signals.";
    link.hidden=true;panel.className="av-panel p-4 sm:p-5 border-l-4 border-l-blue-600";return;
  }
  let action=null;
  const critical=Number(model.support?.counts?.critical)||0;
  const open=Number(model.support?.counts?.open)||0;
  const loadedIssues=issues();
  const integrity=loadedIssues.find(item=>item.severity==="integrity");
  const attention=loadedIssues.find(item=>item.severity==="attention");
  const classRows=Array.isArray(model.classes?.offerings)?model.classes.offerings:[],
    totalClasses=classRows.length,
    unstaffed=classRows.filter(row=>!(row.teacherUids||[]).length).length,
    scheduledIds=new Set((model.schedules?.schedules||[]).filter(row=>(row.meetings||[]).length).map(row=>row.offeringId)),
    unscheduled=classRows.filter(row=>!scheduledIds.has(row.offeringId)).length,
    legacyRosterClasses=classRows.filter(row=>row.rosterMode==="legacy").length,
    primaryReviewClasses=classRows.filter(row=>row.primaryNeedsReview).length;
  const enrollments=Number(model.overview?.counts?.enrollments);
  const people=Number(model.overview?.counts?.people);
  const gradeCoverage=gradingCoverage();
  const profileSaved=Number(model.profile?.profile?.revision)>0;
  const academicOfferings=Array.isArray(model.academics?.offerings)?model.academics.offerings.length:null;
  if(critical>0)action={
    title:critical+" critical support report"+(critical===1?"":"s")+" need review",
    detail:"Critical support reports take priority over routine administration because they may be blocking normal school use.",
    href:"issues.html",label:"Open support queue",tone:"rose"
  };
  else if(model.profile!==null&&model.profile!==undefined&&!profileSaved)action={
    title:"Complete the school profile first",
    detail:"Save the official institution profile before configuring the academic and operational workspaces. This establishes the school identity, timezone and contact context used across Adminerva.",
    href:"school-profile.html",label:"Complete school profile",tone:"blue"
  };
  else if(model.academics!==null&&model.academics!==undefined&&academicOfferings===0)action={
    title:"Complete Academic Configuration",
    detail:"No active class offering is configured yet. Create the academic year, division/program, period, subjects, sections and at least one class offering before staffing or enrollment.",
    href:"school-academic-configuration.html",label:"Configure academics",tone:"blue"
  };
  else if(integrity)action={
    title:"Resolve an integrity issue first",
    detail:(integrity.label?integrity.label+" · ":"")+(integrity.detail||"A school relationship is inconsistent and may block access."),
    href:issueHref(integrity),label:"Review integrity issue",tone:"rose"
  };
  else if(attention)action={
    title:"Review the next school relationship issue",
    detail:(attention.label?attention.label+" · ":"")+(attention.detail||"A school relationship needs administrator attention."),
    href:issueHref(attention),label:"Review issue",tone:"amber"
  };
  else if(totalClasses>0&&unstaffed>0)action={
    title:unstaffed+" active class"+(unstaffed===1?" is":"es are")+" unstaffed",
    detail:"Assign an active school teacher to every class before Classroom, assessment review and Class Record workflows depend on it.",
    href:"school-classes.html",label:"Staff active classes",tone:"amber"
  };
  else if(totalClasses>0&&unscheduled>0)action={
    title:unscheduled+" active class"+(unscheduled===1?" has":"es have")+" no official schedule",
    detail:"Add the institutional meeting time and room so teachers and students share the same class timetable and conflict checks remain authoritative.",
    href:"school-classes.html?view=schedule",label:"Complete class schedules",tone:"amber"
  };
  else if(primaryReviewClasses>0)action={
    title:primaryReviewClasses+" staffed class"+(primaryReviewClasses===1?" needs":"es need")+" a Primary Teacher review",
    detail:"These classes have multiple active teachers or stale lead metadata without a valid explicit Primary Teacher. Set the class lead without changing existing assessment-review ownership.",
    href:"school-classes.html",label:"Review teaching teams",tone:"amber"
  };
  else if(legacyRosterClasses>0)action={
    title:legacyRosterClasses+" active class"+(legacyRosterClasses===1?" needs":"es need")+" roster-source review",
    detail:"These classes predate the explicit roster-source model. Adopt official section placement for normal classes, or mark true electives/irregular classes as selective.",
    href:"school-classes.html",label:"Review roster sources",tone:"amber"
  };
  else if(Number.isFinite(enrollments)&&enrollments===0&&Number.isFinite(people)&&people>0)action={
    title:"Complete student enrollment",
    detail:"People records exist but no enrollment relationships are loaded. Use the enrollment workflow available to this school.",
    href:enrollmentHref,label:"Open enrollment",tone:"blue"
  };
  else if(model.grading!==null&&model.grading!==undefined&&!(model.grading.schemes||[]).length)action={
    title:"Configure a grading policy",
    detail:"No active school grading policy is available yet. Define the category weights, transmutation rule and applicability before teachers finalize Class Records.",
    href:"school-grading-schemes.html",label:"Configure grading policy",tone:"blue"
  };
  else if(gradeCoverage.ambiguous.length)action={
    title:gradeCoverage.ambiguous.length+" class"+(gradeCoverage.ambiguous.length===1?" has":"es have")+" overlapping grading policies",
    detail:"Multiple equally specific active policies match these classes. Class Record will block policy resolution until School Administration removes the overlap.",
    href:"school-grading-schemes.html",label:"Resolve grading-policy overlap",tone:"amber"
  };
  else if(gradeCoverage.uncovered.length)action={
    title:gradeCoverage.uncovered.length+" class"+(gradeCoverage.uncovered.length===1?" has":"es have")+" no matching grading policy",
    detail:"At least one active class is outside the applicability of every active grading policy. Add or broaden a policy before teachers finalize those Class Records.",
    href:"school-grading-schemes.html",label:"Complete grading coverage",tone:"amber"
  };
  else if(open>0)action={
    title:open+" open support report"+(open===1?"":"s")+" remain",
    detail:"No higher-priority integrity blocker is loaded. Review the remaining school support queue.",
    href:"issues.html",label:"Review reports",tone:"blue"
  };
  else action={
    title:"No blocking administrator issue found",
    detail:complete?"The completed dashboard checks did not find a blocking directory, class staffing, official schedule, Class Record or support issue. Continue routine academic-policy and operations review.":"Available checks did not confirm a blocker; some sources are unavailable, so refresh before treating this as a full health result.",
    href:"school-grading-schemes.html",label:"Review grading policies",tone:complete?"emerald":"amber"
  };
  title.textContent=action.title;detail.textContent=action.detail;link.href=action.href;link.textContent=action.label+" →";link.hidden=false;
  const border=action.tone==="rose"?"border-l-rose-600":action.tone==="amber"?"border-l-amber-500":action.tone==="emerald"?"border-l-emerald-600":"border-l-blue-600";
  panel.className="av-panel p-4 sm:p-5 border-l-4 "+border;
}
function message(host,value){host.replaceChildren();const p=document.createElement("p");p.className="p-5 text-sm text-slate-600";p.textContent=value;host.append(p);}
function platformModePayload(){
  try{return sessionStorage.getItem("Adminerva_platform_school_mode")==="assist"?{platformMode:"assist"}:{};}catch{return {};}
}
function perform(api,action,lease){
  return api({schoolId:lease.schoolId,action,...platformModePayload()}).then(response=>{picker.scope.assertLease(lease);return response.data;});
}
function renderClassWorkflow(){
  const node=get("adminWorkflowTeaching");if(!node)return;
  if(model.classes===null||model.schedules===null){
    node.textContent="Unavailable";node.className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-900";return;
  }
  if(model.classes===undefined||model.schedules===undefined){
    node.textContent="Checking…";node.className="rounded-full bg-slate-200 px-2 py-1 text-[11px] font-bold text-slate-700";return;
  }
  const rows=model.classes.offerings||[],total=rows.length;
  if(!total){
    node.textContent="Not started";node.className="rounded-full bg-slate-200 px-2 py-1 text-[11px] font-bold text-slate-700";return;
  }
  const staffed=rows.filter(row=>(row.teacherUids||[]).length).length,
    scheduledIds=new Set((model.schedules.schedules||[]).filter(row=>(row.meetings||[]).length).map(row=>row.offeringId)),
    scheduled=rows.filter(row=>scheduledIds.has(row.offeringId)).length,
    complete=staffed===total&&scheduled===total;
  node.textContent=staffed+"/"+total+" staffed · "+scheduled+"/"+total+" scheduled";
  node.className="rounded-full px-2 py-1 text-[11px] font-bold "+(complete?"bg-emerald-100 text-emerald-800":"bg-amber-100 text-amber-900");
  set("adminAssignmentCount",staffed+"/"+total);
}
function activityLabel(action){
  return String(action||"directory change").replace(/^student_/,"student ").replace(/^teacher_/,"teacher ").replaceAll("_"," ");
}
function renderActivity(){
  const host=get("adminActivityList"),items=model.overview?.recentActivity;
  if(!host)return;
  if(!Array.isArray(items)){
    message(host,"Recent administrative activity is unavailable. Refresh to retry.");return;
  }
  if(!items.length){
    message(host,"No directory administration activity has been recorded yet.");return;
  }
  host.innerHTML=items.map(item=>{
    const when=item.createdAt?new Date(item.createdAt).toLocaleString():"Time unavailable";
    const context=[item.reason,item.personId?"person "+item.personId:"",item.offeringId?"class "+item.offeringId:""].filter(Boolean).join(" · ");
    return '<article class="p-4"><div class="flex flex-wrap items-center justify-between gap-2"><strong class="text-sm capitalize">'+escapeHTML(activityLabel(item.action))+'</strong><span class="text-xs text-slate-500">'+escapeHTML(when)+'</span></div><p class="text-xs text-slate-600 mt-1">'+escapeHTML((item.actorUid?"Actor "+item.actorUid+(context?" · ":""):"")+context)+'</p></article>';
  }).join("");
}
function issueHref(item){
  if(item.source==="class")return "school-classes.html?"+new URLSearchParams({
    ...(item.targetTab==="schedule"?{view:"schedule"}:{}),...(item.offeringId?{offeringId:item.offeringId}:{})
  }).toString();
  if(item.source==="record")return item.targetTab==="classes"?"school-classes.html":"school-class-records.html";
  const identityIssue=Boolean(item.personId)&&["access","invites","people"].includes(item.targetTab);
  if(identityIssue)return "people-access.html?personId="+encodeURIComponent(item.personId)+"#people";
  if(item.type==="student_no_enrollment"&&picker?.scope.current?.enrollmentMode==="canonical")return "school-enrollment.html"+(item.personId?"?personId="+encodeURIComponent(item.personId):"");
  if(item.type==="student_registration_without_classes"&&picker?.scope.current?.enrollmentMode==="canonical")return "school-classes.html";
  return "people-access.html#"+(tabs.has(item.targetTab)?item.targetTab:"overview");
}
function recordState(record){
  if(!record.finalization)return {key:"not-finalized",label:"Not finalized",tone:"text-slate-600"};
  if(record.finalization.layoutChangedSinceFinalization)return {key:"review",label:"Needs review",tone:"text-amber-700"};
  if(record.finalization.releasedRevision)return {key:"released",label:"Released",tone:"text-emerald-700"};
  return {key:"finalized",label:"Finalized",tone:"text-blue-700"};
}
function issues(){
  const items=(model.reconciliation?.issues||[]).slice();
  const classRows=model.classes?.offerings||[],scheduleIds=new Set((model.schedules?.schedules||[])
    .filter(row=>(row.meetings||[]).length).map(row=>row.offeringId));
  for(const row of classRows){
    const label=[row.subjectName,row.sectionName,row.termName].filter(Boolean).join(" · ");
    if(!(row.teacherUids||[]).length)items.push({source:"class",severity:"integrity",label,detail:"Active class has no assigned subject teacher.",offeringId:row.offeringId,targetTab:"classes"});
    if(!scheduleIds.has(row.offeringId))items.push({source:"class",severity:"attention",label,detail:"Active class has no official meeting schedule.",offeringId:row.offeringId,targetTab:"schedule"});
    if(row.primaryNeedsReview)items.push({source:"class",severity:"review",label,detail:"Teaching team needs an explicit valid Primary Teacher. Co-teacher access and existing assessment review ownership remain separate.",offeringId:row.offeringId,targetTab:"classes"});
    if(row.rosterMode==="legacy")items.push({source:"class",severity:"review",label,detail:"Class roster source is still legacy/unclassified. Adopt official section placement or mark it selective.",offeringId:row.offeringId,targetTab:"classes"});
  }
  for(const record of model.records||[]){
    if(!record.teacherNames?.length)items.push({source:"record",severity:"integrity",label:record.subjectName+" · "+record.sectionName,detail:"No active teacher is assigned to this Class Record.",targetTab:"classes"});
    if(record.finalization?.layoutChangedSinceFinalization)items.push({source:"record",severity:"attention",label:record.subjectName+" · "+record.sectionName,detail:"The Class Record changed after finalization and needs a new review.",targetTab:"records"});
  }
  return items.sort((a,b)=>(priorities[a.severity]??9)-(priorities[b.severity]??9)||String(a.label).localeCompare(String(b.label)));
}
function renderAttention(){
  const all=issues(),kind=attentionFilter.value,items=all.filter(item=>!kind||item.severity===kind),shown=items.slice(0,attentionLimit);
  const incomplete=!model.reconciliation||!model.records;
  set("adminAttentionCoverage",[
    model.reconciliation?.truncated?"Directory returned its first 150 issues; open People & Access for details.":"",
    incomplete?"Some checks are unavailable; this list is incomplete.":"",
    all.length?("Showing "+shown.length+" of "+items.length+" loaded items."):""
  ].filter(Boolean).join(" "));
  get("adminAttentionMore").hidden=items.length<=attentionLimit;
  if(!shown.length){message(attentionList,incomplete?"No matching issues could be confirmed. Refresh to retry unavailable checks.":all.length?"No issues match this filter.":"No issues found by the completed checks.");return;}
  attentionList.innerHTML=shown.map(item=>{
    const tone=item.severity==="integrity"?"text-rose-700 bg-rose-50":item.severity==="attention"?"text-amber-800 bg-amber-50":"text-slate-700 bg-slate-50";
    return '<div class="p-4 flex flex-wrap items-start justify-between gap-3"><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><span class="rounded px-2 py-0.5 text-[10px] font-extrabold uppercase '+tone+'">'+escapeHTML(item.severity||"review")+'</span><strong class="text-sm break-words">'+escapeHTML(item.label||"School record")+'</strong></div><p class="text-xs text-slate-600 mt-1">'+escapeHTML(item.detail||"")+'</p></div><a class="shrink-0 text-sm font-bold text-blue-700" href="'+issueHref(item)+'">Review →</a></div>';
  }).join("");
}
function renderRecords(){
  const records=model.records,kind=recordFilter.value,query=recordSearch.value.trim().toLocaleLowerCase();
  if(!records){message(recordList,"Class Record status is unavailable. Refresh to retry.");set("adminRecordCoverage","");get("adminRecordMore").hidden=true;return;}
  const matching=records.filter(record=>(!kind||recordState(record).key===kind)&&(!query||[record.subjectName,record.sectionName,...(record.teacherNames||[])].some(value=>String(value||"").toLocaleLowerCase().includes(query))));
  const shown=matching.slice(0,recordLimit);
  set("adminRecordCoverage","Showing "+shown.length+" of "+matching.length+" matching · "+records.length+" loaded");
  get("adminRecordMore").hidden=shown.length>=matching.length;
  if(!shown.length){message(recordList,records.length?"No Class Records match the filters.":"No Class Records have been created yet.");return;}
  const rows=shown.map(record=>{const state=recordState(record),auditHref="school-class-records.html?offeringId="+encodeURIComponent(record.offeringId||"")+"&audit=1";return '<tr class="border-b border-slate-100"><td class="px-4 py-3 text-sm font-semibold">'+escapeHTML(record.subjectName)+'</td><td class="px-4 py-3 text-sm">'+escapeHTML(record.sectionName)+'</td><td class="px-4 py-3 text-sm">'+escapeHTML((record.teacherNames||[]).join(", ")||"Unassigned")+'</td><td class="px-4 py-3 text-sm text-center">'+count(record.activeColumnCount)+'</td><td class="px-4 py-3 text-sm font-bold '+state.tone+'">'+state.label+'</td><td class="px-4 py-3 text-sm"><a class="font-bold text-blue-700 whitespace-nowrap" href="'+auditHref+'">Audit →</a></td></tr>';}).join("");
  recordList.innerHTML='<table class="min-w-full"><thead class="bg-slate-50 text-xs uppercase text-slate-500"><tr><th scope="col" class="px-4 py-2 text-left">Subject</th><th scope="col" class="px-4 py-2 text-left">Section</th><th scope="col" class="px-4 py-2 text-left">Teacher</th><th scope="col" class="px-4 py-2 text-center">Activities</th><th scope="col" class="px-4 py-2 text-left">State</th><th scope="col" class="px-4 py-2 text-left">Action</th></tr></thead><tbody>'+rows+'</tbody></table>';
}
function reset(){
  model={};attentionLimit=10;recordLimit=20;
  for(const id of ["adminPeopleCount","adminAttentionCount","adminClassRecordCount","adminReportCount","adminSupportOpen","adminSupportCritical","adminSupportWaiting","adminEnrollmentCount","adminAssignmentCount","adminInvitationCount"])set(id,"—");
  set("adminIntegrityMeta","Not checked");set("adminClassRecordMeta","Not checked");set("adminReportMeta","Not checked");
  for(const id of ["adminWorkflowProfile","adminWorkflowAcademics","adminWorkflowPeople","adminWorkflowTeaching","adminWorkflowEnrollment","adminWorkflowGrading","adminWorkflowRecords"]){const node=get(id);if(node){node.textContent="Checking…";node.className="rounded-full bg-slate-200 px-2 py-1 text-[11px] font-bold text-slate-700";}}
  set("adminAttentionCoverage","");set("adminRecordCoverage","");get("adminAttentionMore").hidden=true;get("adminRecordMore").hidden=true;
  message(attentionList,"Waiting for verified school checks…");message(recordList,"Waiting for verified school records…");message(get("adminActivityList"),"Waiting for verified school activity…");renderRecommendation();
}
function renderSource(name,data){
  if(name==="profile"){
    model.profile=data;
    const node=get("adminWorkflowProfile"),saved=Number(data?.profile?.revision)>0;
    if(node){node.textContent=data===null?"Unavailable":saved?"Saved":"Not configured";node.className="rounded-full px-2 py-1 text-[11px] font-bold "+(data===null?"bg-amber-100 text-amber-900":saved?"bg-emerald-100 text-emerald-800":"bg-slate-200 text-slate-700");}
  }else if(name==="academics"){
    model.academics=data;
    const node=get("adminWorkflowAcademics"),total=Array.isArray(data?.offerings)?data.offerings.length:null;
    if(node){node.textContent=data===null?"Unavailable":total?"Configured · "+total+" class"+(total===1?"":"es"):"Not configured";node.className="rounded-full px-2 py-1 text-[11px] font-bold "+(data===null?"bg-amber-100 text-amber-900":total?"bg-emerald-100 text-emerald-800":"bg-slate-200 text-slate-700");}
    renderGradingWorkflow();
  }else if(name==="directory"){
    model.overview=data;
    for(const [id,key] of [["adminPeopleCount","people"],["adminEnrollmentCount","enrollments"],["adminAssignmentCount","staff_assignments"],["adminInvitationCount","invitations"]])set(id,count(data?.counts?.[key]));
    renderActivity();
    setWorkflow("adminWorkflowPeople",data?.counts?.people,"record");setWorkflow("adminWorkflowEnrollment",data?.counts?.enrollments,"enrollment");
  }else if(name==="classes"){
    model.classes=data;
    renderClassWorkflow();
    if(data){
      const total=(data.offerings||[]).length,staffed=(data.offerings||[]).filter(row=>(row.teacherUids||[]).length).length;
      set("adminAssignmentCount",total?staffed+"/"+total:"0");
    }else set("adminAssignmentCount","—");
    renderAttention();
  }else if(name==="schedules"){
    model.schedules=data;
    renderClassWorkflow();renderAttention();
  }else if(name==="relationships"){
    model.reconciliation=data;
    set("adminAttentionCount",count(data?.counts?.total));
    set("adminIntegrityMeta",data?count(data.counts?.integrity)+" integrity · "+count(data.counts?.attention)+" attention":"Relationship checks unavailable");
    renderAttention();
  }else if(name==="grading"){
    model.grading=data;renderGradingWorkflow();
  }else if(name==="records"){
    model.records=Array.isArray(data?.records)?data.records:null;
    set("adminClassRecordCount",model.records?count(model.records.length):"—");
    const finalized=model.records?.filter(row=>row.finalization&&!row.finalization.layoutChangedSinceFinalization).length;
    const released=model.records?.filter(row=>recordState(row).key==="released").length;
    set("adminClassRecordMeta",model.records?count(finalized)+" finalized · "+count(released)+" released":"Class Record source unavailable");
    setWorkflow("adminWorkflowRecords",model.records?.length,"record");
    renderRecords();renderAttention();
  }else if(name==="support"){
    model.support=data;
    for(const [id,key] of [["adminReportCount","open"],["adminSupportOpen","open"],["adminSupportCritical","critical"],["adminSupportWaiting","waiting"]])set(id,count(data?.counts?.[key]));
    set("adminReportMeta",data?count(data.counts?.critical)+" critical":"Support source unavailable");
  }
  renderRecommendation();
}
async function loadDashboard(){
  const generation=++loadGeneration,lease=picker.scope.lease();
  reset();refresh.disabled=true;status.textContent="Loading school operations…";get("adminLastChecked").textContent="";
  const sources=[
    ["profile","School profile",profileApi,"get"],
    ["academics","Academic configuration",academicsApi,"planning_options"],
    ["directory","Directory totals",peopleApi,"overview"],
    ["relationships","Relationship checks",peopleApi,"reconcile_directory"],
    ["classes","Active classes",academicsApi,"faculty_workload"],
    ["schedules","Official schedules",schedulesApi,"admin_overview"],
    ["grading","Grading policies",gradingPolicyApi,"list_schemes"],
    ["records","Class Records",classRecordApi,"overview"],
    ["support","Support reports",supportApi,"overview"]
  ];
  const failed=[];
  const current=()=>generation===loadGeneration&&auth.currentUser?.uid===lease.uid;
  await Promise.all(sources.map(async ([name,label,api,action])=>{
    try{const result=await perform(api,action,lease);if(current())renderSource(name,result);}
    catch(error){if(current()){failed.push(label);renderSource(name,null);console.warn("School operations source unavailable",name,error);}}
  }));
  if(!current())return;
  refresh.disabled=false;set("adminLastChecked","Checked "+new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}));
  status.textContent=failed.length?"Unavailable: "+failed.join(", ")+". Other results remain usable.":"All nine school operation sources loaded.";
  renderRecommendation({final:true});
}
refresh.addEventListener("click",()=>{if(picker.scope.current?.roles.includes("school_admin"))void loadDashboard();else void picker.load().catch(error=>{status.textContent=error?.message||"School access unavailable.";});});
attentionFilter.addEventListener("change",()=>{attentionLimit=10;renderAttention();});
recordFilter.addEventListener("change",()=>{recordLimit=20;renderRecords();});
recordSearch.addEventListener("input",()=>{recordLimit=20;renderRecords();});
get("adminAttentionMore").addEventListener("click",()=>{attentionLimit+=20;renderAttention();});
get("adminRecordMore").addEventListener("click",()=>{recordLimit+=20;renderRecords();});
picker=createTenantSchoolPicker({host:get("sa-school-picker"),status,
  onBeforeChange:async()=>{++loadGeneration;reset();refresh.disabled=true;get("adminSchoolName").textContent="Checking school…";},
  onReady:scope=>{
    if(!scope.current?.roles.includes("school_admin")){reset();refresh.disabled=false;status.textContent="School administrator access required.";return;}
    set("adminSchoolName",scope.current.name||scope.current.schoolId);applyEnrollmentRoute(scope);
    void loadDashboard().catch(error=>{refresh.disabled=false;status.textContent=error?.message||"School operations could not be loaded.";});
  }
});
void picker.load().catch(error=>{refresh.disabled=false;status.textContent=error?.message||"School administration access could not be loaded.";});
