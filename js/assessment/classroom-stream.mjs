import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const functions=getFunctions(app,"asia-southeast1");
const analyticsApi=httpsCallable(functions,"schoolTeacherAnalytics");
const streamApi=httpsCallable(functions,"schoolClassroomStream");
const assessmentApi=httpsCallable(functions,"schoolAssessments");
const academicsApi=httpsCallable(functions,"schoolAcademics");
const initialOfferingId=String(new URLSearchParams(location.search).get("offeringId")||"");
const el=id=>document.getElementById(id);
const form=el("teacherClassroomForm"),select=el("teacherClassroomOffering");
let picker=null,offerings=[],posts=[],classwork=[],rosterStudents=[],busy=false,epoch=0,loadedOffering="",editing=null,composerOffering="";
let canPost=false,canComment=false,classworkError="",classworkHealthError="",rosterError="",classroomSettings={participationMode:"teacher_only",revision:0},mutedPersonIds=new Set();
let classworkHealth=new Map(),classworkSummary=null,preparationPlans=[],officialMeetings=[],teachingTeam=[],
  primaryTeacherUid="",primaryNeedsReview=false;
const fields=["Kind","Title","Body","Link","Pinned"];
function make(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function date(value){return value?new Date(value).toLocaleString():"";}
function label(item){return [item?.subject,item?.section,item?.term,item?.year].filter(Boolean).join(" · ");}
function current(){return offerings.find(item=>item.offeringId===select.value)||null;}
function syncOfferingUrl(offeringId){
  const url=new URL(location.href);
  if(offeringId)url.searchParams.set("offeringId",offeringId);else url.searchParams.delete("offeringId");
  history.replaceState(null,"",url.pathname+(url.search?url.search:"")+url.hash);
}
function say(message,error=false){el("teacherClassroomStatus").textContent=message;el("teacherClassroomStatus").className="text-sm mt-3 "+(error?"text-rose-700":"text-slate-600");}
function readComposer(){const data={};for(const name of fields){const field=el("teacherClassroom"+name);data[name.toLowerCase()]=name==="Pinned"?field.checked:field.value;}return data;}
function fillComposer(data={}){for(const name of fields){const field=el("teacherClassroom"+name),value=data[name.toLowerCase()];if(name==="Pinned")field.checked=Boolean(value);else field.value=value??(name==="Kind"?"announcement":"");}}
function draftKey(id){return "adminerva:classroom-draft:"+auth.currentUser?.uid+":"+picker?.scope.current?.schoolId+":"+id;}
function keepDraft(){if(editing||!composerOffering||!auth.currentUser)return;try{sessionStorage.setItem(draftKey(composerOffering),JSON.stringify(readComposer()));}catch{}}
function restoreDraft(id){editing=null;composerOffering=id;let data={};try{data=JSON.parse(sessionStorage.getItem(draftKey(id))||"{}");}catch{}fillComposer(data||{});syncControls();}
function dropDraft(id){try{sessionStorage.removeItem(draftKey(id));}catch{}}
function participationLabel(mode){
  return ({teacher_only:"Teacher only · students read",comments_only:"Students may comment",posts_comments:"Students may post and comment"})[mode]||"Teacher only · students read";
}
function syncControls(){
  select.disabled=busy||!offerings.length;
  el("teacherClassroomRefresh").disabled=busy;
  const ready=!busy&&canPost&&Boolean(current())&&loadedOffering===current()?.offeringId;
  for(const control of form.querySelectorAll("input,textarea,select,button"))control.disabled=!ready;
  el("teacherClassroomKind").disabled=!ready||Boolean(editing);
  el("teacherClassroomPublish").textContent=editing?"Save changes":"Publish to classroom";
  el("teacherClassroomCancelEdit").hidden=!editing;
  el("teacherClassroomComposerTitle").textContent=editing?"Edit classroom post":"Share an update";
  el("teacherClassroomDraftStatus").textContent=editing?"Editing an existing post. Changes are saved only when you select Save changes.":"Unpublished drafts are kept in this browser tab for this class.";
  const participationReady=!busy&&Boolean(loadedOffering);
  el("teacherClassroomParticipation").disabled=!participationReady;
  el("teacherClassroomParticipationSave").disabled=!participationReady;
  for(const control of el("teacherClassroomPosts").querySelectorAll("button,input,textarea"))control.disabled=busy;
}
function setBusy(value){busy=value;syncControls();}
async function scoped(api,action,details={}){
  const lease=picker.scope.lease();
  if(auth.currentUser?.uid!==lease.uid)throw Error("Sign in again before continuing.");
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);if(auth.currentUser?.uid!==lease.uid)throw Error("Account changed.");return result;
}
function renderParticipation(){
  const selectNode=el("teacherClassroomParticipation"),status=el("teacherClassroomParticipationStatus");
  selectNode.value=classroomSettings.participationMode||"teacher_only";
  status.textContent=loadedOffering?
    participationLabel(classroomSettings.participationMode)+" · revision "+Number(classroomSettings.revision||0)+
      (mutedPersonIds.size?" · "+mutedPersonIds.size+" muted student"+(mutedPersonIds.size===1?"":"s"):""):
    "Choose a classroom to manage student participation.";
}
function renderComments(post,card){
  const comments=Array.isArray(post.comments)?post.comments:[];
  const section=make("section","mt-4 border-t border-slate-100 pt-3");
  const heading=make("div","flex items-center justify-between gap-3");
  heading.append(make("p","text-xs font-extrabold uppercase tracking-wide text-slate-500",comments.length+" comment"+(comments.length===1?"":"s")));
  section.append(heading);
  if(comments.length){
    const list=make("div","mt-2 space-y-2");
    for(const comment of comments){
      const row=make("div","rounded-lg bg-slate-50 border border-slate-200 px-3 py-2");
      const top=make("div","flex items-start justify-between gap-3"),meta=make("p","text-xs text-slate-500",
        (comment.authorName||"Class member")+" · "+(comment.authorRole==="student"?"Student":"Teacher")+" · "+date(comment.createdAt));
      top.append(meta);
      if(comment.canDelete){
        const remove=make("button","text-xs font-bold text-rose-700","Remove");remove.type="button";
        remove.addEventListener("click",()=>void removeComment(comment));top.append(remove);
      }
      row.append(top,make("p","text-sm text-slate-700 whitespace-pre-wrap break-words mt-1",comment.body||""));
      list.append(row);
    }section.append(list);
  }
  if(canComment){
    const commentForm=make("form","mt-3 flex gap-2"),input=make("input","min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm");
    input.type="text";input.maxLength=2000;input.placeholder="Comment as teacher…";input.required=true;
    const submit=make("button","rounded-lg bg-slate-800 text-white px-3 py-2 text-xs font-bold","Comment");submit.type="submit";
    commentForm.append(input,submit);
    commentForm.addEventListener("submit",event=>{event.preventDefault();const body=input.value.trim();if(body)void addComment(post,body);});
    section.append(commentForm);
  }
  card.append(section);
}
function renderPosts(){
  const host=el("teacherClassroomPosts");host.replaceChildren();
  const kind=el("teacherClassroomFilter").value,term=el("teacherClassroomSearch").value.trim().toLowerCase();
  const visible=posts.filter(post=>(kind==="all"||post.kind===kind)&&(!term||[post.title,post.body,post.authorName,...(post.comments||[]).map(c=>c.body)].some(v=>String(v||"").toLowerCase().includes(term))))
    .sort((a,b)=>Number(b.pinned)-Number(a.pinned)||Number(b.createdAt||0)-Number(a.createdAt||0));
  el("teacherClassroomPostCount").textContent=loadedOffering?visible.length+" of "+posts.length+" posts":"";
  if(!loadedOffering){host.append(make("p","text-sm text-slate-600 p-4","Select a classroom and load its posts."));return;}
  if(!visible.length){host.append(make("div","rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600",posts.length?"No posts match your filters.":"No classroom posts yet."));return;}
  for(const post of visible){
    const student=post.authorRole==="student";
    const card=make("article","rounded-2xl border bg-white shadow-sm p-4 sm:p-5 "+(post.pinned?"border-cyan-300":student?"border-violet-200":"border-slate-200"));
    const top=make("div","flex flex-wrap items-start justify-between gap-3"),identity=make("div","min-w-0 break-words");
    const eyebrow=(post.pinned?"Pinned · ":"")+(student?"Student post":(post.kind||"post"));
    identity.append(make("p","text-xs uppercase tracking-wider font-bold "+(student?"text-violet-700":post.pinned?"text-cyan-800":"text-slate-500"),eyebrow),
      make("h3","text-lg font-extrabold mt-1",post.title||"Classroom update"),
      make("p","text-xs text-slate-500 mt-1",(post.authorName||"Class member")+" · "+date(post.createdAt)+(Number(post.revision)>1?" · edited":"")));
    top.append(identity);
    const actions=make("div","flex flex-wrap gap-2");
    if(post.canEdit){
      const edit=make("button","rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold","Edit");edit.type="button";edit.addEventListener("click",()=>beginEdit(post));actions.append(edit);
      if(!student){
        const pin=make("button","rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold",post.pinned?"Unpin":"Pin");pin.type="button";pin.addEventListener("click",()=>void changePin(post));actions.append(pin);
      }
    }
    if(post.canModerate){
      const remove=make("button","rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700","Remove");remove.type="button";remove.addEventListener("click",()=>void archivePost(post));actions.append(remove);
    }
    if(actions.children.length)top.append(actions);
    card.append(top);
    if(post.body)card.append(make("p","whitespace-pre-wrap break-words text-sm text-slate-700 mt-3 leading-6",post.body));
    if(post.linkUrl)try{const url=new URL(post.linkUrl);if(["http:","https:"].includes(url.protocol)){const link=make("a","inline-block mt-3 text-sm font-bold text-cyan-800 underline break-all","Open shared link ↗");link.href=url.href;link.target="_blank";link.rel="noopener noreferrer";card.append(link);}}catch{}
    renderComments(post,card);host.append(card);
  }
}
function currentTeachingRole(){
  const row=teachingTeam.find(teacher=>teacher.uid===auth.currentUser?.uid);
  return row?.role||"";
}
function renderTeachingTeam(){
  const host=el("teacherClassroomTeachingTeam");host.replaceChildren();
  if(!current()||!loadedOffering)return;
  if(!teachingTeam.length){
    host.append(make("span","rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900","No active teaching team"));
    return;
  }
  for(const teacher of teachingTeam){
    const mine=teacher.uid===auth.currentUser?.uid,primary=teacher.role==="primary",
      cls=primary?"border-emerald-200 bg-emerald-50 text-emerald-900":"border-slate-200 bg-white text-slate-700";
    host.append(make("span","rounded-full border px-3 py-1.5 text-xs font-bold "+cls,
      (primary?"Primary Teacher: ":"Co-teacher: ")+teacher.name+(mine?" · You":"")));
  }
  if(primaryNeedsReview){
    host.append(make("span","rounded-full border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-extrabold text-amber-950",
      "Primary Teacher needs School Admin review"));
  }
}
const scheduleDayNames={mon:"Mon",tue:"Tue",wed:"Wed",thu:"Thu",fri:"Fri",sat:"Sat"};
function renderOfficialSchedule(){
  const host=el("teacherClassroomSchedule");host.replaceChildren();
  if(!current()||!loadedOffering)return;
  if(!officialMeetings.length){
    host.append(make("span","rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600","Official schedule not set"));
    return;
  }
  const sorted=[...officialMeetings].sort((a,b)=>Object.keys(scheduleDayNames).indexOf(a.day)-Object.keys(scheduleDayNames).indexOf(b.day)||
    String(a.startTime).localeCompare(String(b.startTime)));
  for(const meeting of sorted){
    host.append(make("span","rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-900",
      [scheduleDayNames[meeting.day]||meeting.day,meeting.startTime+"–"+meeting.endTime,meeting.room||""].filter(Boolean).join(" · ")));
  }
}
function updateClassLinks(){
  const item=current(),offeringId=item?.offeringId||"",query=offeringId?"&offeringId="+encodeURIComponent(offeringId):"";
  el("teacherClassroomSubmissionsLink").href="school-gradebook.html?view=submissions"+query;
  el("teacherClassroomGradesLink").href="school-gradebook.html?view=results"+query;
  el("teacherClassroomRecordLink").href=offeringId?"class-record.html?offering="+encodeURIComponent(offeringId):"class-record.html";
  el("teacherClassroomAssessmentLink").href=offeringId?"assessment-studio.html?offeringId="+encodeURIComponent(offeringId):"assessment-studio.html";
  el("teacherClassroomPlanLink").href=offeringId?"lesson-planner.html?offeringId="+encodeURIComponent(offeringId):"lesson-planner.html";
}
const metricTone={
  slate:["bg-slate-50","border-slate-200","text-slate-900","text-slate-700"],
  amber:["bg-amber-50","border-amber-200","text-amber-900","text-amber-700"],
  indigo:["bg-indigo-50","border-indigo-200","text-indigo-900","text-indigo-700"],
  violet:["bg-violet-50","border-violet-200","text-violet-900","text-violet-700"],
  emerald:["bg-emerald-50","border-emerald-200","text-emerald-900","text-emerald-700"]
};
function metricCard(label,value,tone="slate"){
  const palette=metricTone[tone]||metricTone.slate;
  const card=make("div","rounded-lg border px-3 py-2 "+palette[0]+" "+palette[1]);
  card.append(make("strong","block text-lg leading-5 "+palette[2],Number(value||0).toLocaleString()),
    make("span","block text-[11px] font-bold mt-1 "+palette[3],label));
  return card;
}
function gradebookTaskHref(item,view="review"){
  return "school-gradebook.html?"+new URLSearchParams({
    view,offeringId:item.offeringId,task:item.taskId
  }).toString();
}
function renderActionQueue(){
  const panel=el("teacherClassroomActionQueuePanel"),host=el("teacherClassroomActionQueue"),
    count=el("teacherClassroomActionQueueCount");
  host.replaceChildren();panel.hidden=true;count.textContent="";
  if(!loadedOffering||classworkHealthError)return;
  const queue=[];
  for(const item of classwork){
    if(item.canReview!==true)continue;
    const health=classworkHealth.get(item.taskId);if(!health)continue;
    if(Number(health.awaitingGrade)>0)queue.push({
      priority:0,item,label:health.awaitingGrade+" submission"+(health.awaitingGrade===1?"":"s")+" awaiting grade",
      detail:"Submitted work is ready for review.",view:"review",action:"Review now"
    });
    if(Number(health.draftGrades)>0)queue.push({
      priority:1,item,label:health.draftGrades+" draft grade"+(health.draftGrades===1?"":"s")+" not published",
      detail:"Review the saved drafts before releasing results.",view:"review",action:"Review drafts"
    });
    if(Number(health.revisionRequested)>0)queue.push({
      priority:2,item,label:health.revisionRequested+" revision request"+(health.revisionRequested===1?"":"s")+" pending",
      detail:"Learners are working on requested revisions or have not resubmitted yet.",view:"submissions",action:"Track revisions"
    });
    if(Number(health.notSubmitted)>0)queue.push({
      priority:3,item,label:health.notSubmitted+" learner"+(health.notSubmitted===1?"":"s")+" not submitted",
      detail:"No submission is recorded for these active linked learners.",view:"submissions",action:"Open submissions"
    });
  }
  queue.sort((a,b)=>a.priority-b.priority||(a.item.dueAt||0)-(b.item.dueAt||0)||String(a.item.title).localeCompare(String(b.item.title)));
  if(!queue.length){
    panel.hidden=false;count.textContent="0";
    host.append(make("p","rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900",
      "No current classwork state requires teacher action. Published results and future deadlines remain visible below."));
    return;
  }
  panel.hidden=false;count.textContent=queue.length+" item"+(queue.length===1?"":"s");
  for(const entry of queue.slice(0,10)){
    const row=make("div","flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-amber-100 bg-white p-3"),
      text=make("div","min-w-0");
    text.append(make("strong","block text-sm text-slate-900",entry.item.title||"Assessment"),
      make("span","block text-xs font-bold text-amber-900 mt-1",entry.label),
      make("span","block text-xs text-slate-500 mt-1",entry.detail));
    const link=make("a","shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-extrabold text-amber-900",entry.action);
    link.href=gradebookTaskHref(entry.item,entry.view);row.append(text,link);host.append(row);
  }
  if(queue.length>10)host.append(make("p","text-xs text-amber-900","Showing the 10 highest-priority actions. Open Submissions or Review & Grade for the full class queue."));
}
function renderPreparation(){
  const host=el("teacherClassroomPreparation"),count=el("teacherClassroomPreparationCount");host.replaceChildren();
  count.textContent=loadedOffering?preparationPlans.length+" linked plan"+(preparationPlans.length===1?"":"s"):"";
  if(!loadedOffering){host.append(make("p","text-xs text-cyan-900","Choose a classroom to load linked preparation."));return;}
  if(!preparationPlans.length){
    const row=make("div","rounded-lg border border-dashed border-cyan-200 bg-white/70 p-3");
    row.append(make("p","text-xs text-cyan-950","No saved lesson plan is linked to this class yet."));
    const link=make("a","inline-block mt-2 text-xs font-extrabold text-cyan-800 underline","Start planning for this class →");
    link.href=el("teacherClassroomPlanLink").href;row.append(link);host.append(row);return;
  }
  for(const plan of preparationPlans.slice(0,4)){
    const row=make("div","flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-cyan-100 bg-white p-3");
    const text=make("div","min-w-0");
    text.append(make("strong","block text-sm text-slate-900",plan.courseWeek||plan.subject||"Lesson plan"),
      make("span","block text-xs text-slate-500 mt-1",[plan.academicTerm,plan.dateRange,plan.version?"v"+plan.version:""].filter(Boolean).join(" · ")));
    const link=make("a","shrink-0 text-xs font-extrabold text-cyan-800 underline","Open plan");
    const q=new URLSearchParams({savedPlan:plan.planId,offeringId:current()?.offeringId||""});
    link.href="lesson-planner.html?"+q.toString();row.append(text,link);host.append(row);
  }
}
function renderMaterials(){
  const host=el("teacherClassroomMaterials"),count=el("teacherClassroomMaterialCount");host.replaceChildren();
  const materials=posts.filter(post=>post.kind==="material").sort((a,b)=>Number(b.pinned)-Number(a.pinned)||Number(b.createdAt||0)-Number(a.createdAt||0));
  count.textContent=loadedOffering?materials.length+" material"+(materials.length===1?"":"s"):"";
  if(!loadedOffering){host.append(make("p","text-xs text-sky-900","Choose a classroom to load materials."));return;}
  if(!materials.length){
    const row=make("div","rounded-lg border border-dashed border-sky-200 bg-white/70 p-3");
    row.append(make("p","text-xs text-sky-950","No student-facing materials have been posted to this class."));
    const link=make("a","inline-block mt-2 text-xs font-extrabold text-sky-800 underline","Post a material in the Stream ↓");
    link.href="#class-stream";row.append(link);host.append(row);return;
  }
  for(const material of materials.slice(0,6)){
    const row=make("article","rounded-lg border border-sky-100 bg-white p-3"),top=make("div","flex items-start justify-between gap-2"),text=make("div","min-w-0");
    text.append(make("strong","block text-sm text-slate-900",material.title||"Class material"),
      make("span","block text-[11px] text-slate-500 mt-1",[material.authorName||"Teacher",date(material.createdAt),material.pinned?"Pinned":""].filter(Boolean).join(" · ")));
    const edit=make("a","shrink-0 text-xs font-extrabold text-sky-800 underline","Manage in Stream");edit.href="#class-stream";
    top.append(text,edit);row.append(top);
    if(material.body)row.append(make("p","mt-2 text-xs text-slate-600 whitespace-pre-wrap break-words",material.body.length>260?material.body.slice(0,260)+"…":material.body));
    if(material.linkUrl)try{
      const url=new URL(material.linkUrl);
      if(["http:","https:"].includes(url.protocol)){
        const link=make("a","inline-block mt-2 text-xs font-extrabold text-indigo-700 underline break-all","Open shared resource ↗");
        link.href=url.href;link.target="_blank";link.rel="noopener noreferrer";row.append(link);
      }
    }catch{}
    host.append(row);
  }
  if(materials.length>6)host.append(make("p","text-xs text-sky-900","Showing 6 of "+materials.length+" materials. Use the Stream to review older posts."));
}
function renderClasswork(){
  const host=el("teacherClassroomClasswork"),summaryHost=el("teacherClassroomClassworkSummary"),healthStatus=el("teacherClassroomClassworkHealthStatus");
  host.replaceChildren();summaryHost.replaceChildren();summaryHost.hidden=true;healthStatus.textContent="";
  const queuePanel=el("teacherClassroomActionQueuePanel"),queueHost=el("teacherClassroomActionQueue"),queueCount=el("teacherClassroomActionQueueCount");
  queuePanel.hidden=true;queueHost.replaceChildren();queueCount.textContent="";
  if(classworkError){host.append(make("p","rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900",classworkError));return;}
  if(!loadedOffering){host.append(make("p","text-sm text-slate-500","Choose a classroom to load classwork."));return;}
  if(classworkSummary){
    summaryHost.hidden=false;
    summaryHost.append(
      metricCard("Not submitted",classworkSummary.notSubmitted,"slate"),
      metricCard("Revision requested",classworkSummary.revisionRequested,"amber"),
      metricCard("Awaiting grade",classworkSummary.awaitingGrade,"indigo"),
      metricCard("Draft grades",classworkSummary.draftGrades,"violet"),
      metricCard("Published",classworkSummary.publishedGrades,"emerald")
    );
  }
  if(classworkHealthError)healthStatus.textContent=classworkHealthError;
  else if(classworkSummary)healthStatus.textContent="Counts are classwide student-task states. Needs Action includes only assessments assigned to you for review; Co-teacher access does not change review ownership.";
  if(!classwork.length){host.append(make("p","rounded-lg bg-slate-50 border border-dashed border-slate-300 p-4 text-sm text-slate-600","No assessments have been deployed to this class yet."));return;}
  for(const item of classwork){
    const row=make("article","rounded-xl border border-slate-200 p-3"),top=make("div","flex items-start justify-between gap-3"),text=make("div","min-w-0");
    text.append(make("strong","block text-sm",item.title||"Assessment"));
    const state=item.lifecycle==="closed"?"Closed":item.published===true?"Visible to students":"Teacher draft";
    text.append(make("span","block text-xs text-slate-500 mt-1",[item.assessmentType,state,item.dueAt?"Due "+date(item.dueAt):""].filter(Boolean).join(" · ")));
    if(item.canReview===true){
      const link=make("a","shrink-0 text-xs font-bold text-indigo-700 underline","Review");
      link.href="school-gradebook.html?view=review&offeringId="+encodeURIComponent(item.offeringId)+"&task="+encodeURIComponent(item.taskId);
      top.append(text,link);
    }else{
      const reviewer=teachingTeam.find(teacher=>teacher.uid===item.reviewerUid),
        badge=make("span","shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600",
          "Reviewer: "+(reviewer?.name||"another teacher"));
      top.append(text,badge);
    }
    row.append(top);
    const health=classworkHealth.get(item.taskId);
    if(health){
      const record=health.classRecord||{status:"unlinked"};
      const recordRow=make("div","mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2");
      const recordText=make("div","min-w-0");
      if(record.status==="linked"){
        recordText.append(make("strong","block text-xs text-emerald-800","Linked to Class Record"),
          make("span","block text-[11px] text-slate-500 mt-0.5",[record.category||"Uncategorized",record.studentVisibility==="released"?"visible to students":"hidden from students"].join(" · ")));
      }else if(record.status==="archived"){
        recordText.append(make("strong","block text-xs text-amber-800","Archived Class Record link"),
          make("span","block text-[11px] text-slate-500 mt-0.5","The prior Class Record column is archived; review the record before linking again."));
      }else{
        recordText.append(make("strong","block text-xs text-slate-700","Not linked to Class Record"),
          make("span","block text-[11px] text-slate-500 mt-0.5","Published Gradebook results do not enter the formal Class Record until you link this assessment."));
      }
      const isPrimary=currentTeachingRole()==="primary";
      if(record.status==="linked"||record.status==="archived"||isPrimary){
        const recordLink=make("a","shrink-0 text-xs font-extrabold underline "+(record.status==="linked"?"text-emerald-800":record.status==="archived"?"text-amber-800":"text-blue-700"),
          record.status==="linked"?"Open record":record.status==="archived"?"Review archived link":"Link to record");
        recordLink.href=record.status==="unlinked"?
          "class-record.html?"+new URLSearchParams({offering:item.offeringId,assessment:item.taskId,source:"school"}).toString():
          "class-record.html?offering="+encodeURIComponent(item.offeringId);
        recordRow.append(recordText,recordLink);
      }else{
        const owner=teachingTeam.find(teacher=>teacher.role==="primary");
        recordRow.append(recordText,make("span","shrink-0 text-[11px] font-bold text-slate-500",
          primaryNeedsReview?"Primary Teacher must be set by School Admin":"Primary Teacher "+(owner?.name||"")+" must link"));
      }
      row.append(recordRow);
      const chips=make("div","flex flex-wrap gap-1.5 mt-3");
      const add=(label,value,cls)=>{if(Number(value)>0)chips.append(make("span","rounded-full border px-2 py-1 text-[11px] font-bold "+cls,label+" "+Number(value).toLocaleString()));};
      add("Not submitted",health.notSubmitted,"border-slate-200 bg-slate-50 text-slate-700");
      add("Revision",health.revisionRequested,"border-amber-200 bg-amber-50 text-amber-900");
      add("Awaiting grade",health.awaitingGrade,"border-indigo-200 bg-indigo-50 text-indigo-800");
      add("Draft",health.draftGrades,"border-violet-200 bg-violet-50 text-violet-800");
      add("Published",health.publishedGrades,"border-emerald-200 bg-emerald-50 text-emerald-800");
      if(!chips.children.length)chips.append(make("span","text-xs text-slate-500","No learner activity recorded yet."));
      row.append(chips);
    }
    host.append(row);
  }
  renderActionQueue();
}
function renderRoster(){
  const host=el("teacherClassroomRoster");host.replaceChildren();
  if(rosterError){host.append(make("p","p-4 text-sm text-amber-900 bg-amber-50",rosterError));el("teacherClassroomRosterCount").textContent="";return;}
  if(!loadedOffering){host.append(make("p","p-4 text-sm text-slate-500","Choose a classroom to load students."));el("teacherClassroomRosterCount").textContent="";return;}
  const students=rosterStudents.filter(row=>row.status==="active").sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  el("teacherClassroomRosterCount").textContent=students.length+" active student"+(students.length===1?"":"s");
  if(!students.length){host.append(make("p","p-4 text-sm text-slate-500","No active students are enrolled in this class."));return;}
  const list=make("ol","divide-y divide-slate-100");
  students.forEach((row,index)=>{
    const li=make("li","flex items-center gap-3 px-3 py-2 text-sm"),number=make("span","w-6 text-right text-slate-400",index+1),name=make("span","font-medium min-w-0 flex-1",row.name||"Student");
    const muted=mutedPersonIds.has(row.personId),control=make("button","rounded-md border px-2 py-1 text-xs font-bold "+(muted?"border-emerald-200 text-emerald-700":"border-amber-200 text-amber-800"),muted?"Unmute":"Mute");
    control.type="button";control.addEventListener("click",()=>void toggleMute(row,!muted));li.append(number,name,control);list.append(li);
  });host.append(list);
}
function beginEdit(post){
  if(busy||!post.canEdit||editing)return;keepDraft();editing=post;
  fillComposer({kind:post.kind,title:post.title,body:post.body,link:post.linkUrl,pinned:post.pinned});
  syncControls();el("teacherClassroomTitle").focus();form.scrollIntoView({block:"nearest",behavior:"smooth"});
}
async function loadPosts(){
  const item=current(),turn=++epoch;loadedOffering="";canPost=false;canComment=false;posts=[];classwork=[];rosterStudents=[];mutedPersonIds=new Set();
  classworkError="";classworkHealthError="";rosterError="";classworkHealth=new Map();classworkSummary=null;preparationPlans=[];officialMeetings=[];
  teachingTeam=[];primaryTeacherUid="";primaryNeedsReview=false;classroomSettings={participationMode:"teacher_only",revision:0};
  renderPosts();renderPreparation();renderMaterials();renderClasswork();renderRoster();renderParticipation();renderTeachingTeam();renderOfficialSchedule();updateClassLinks();syncControls();
  if(!item)return false;
  try{
    const results=await Promise.allSettled([
      scoped(streamApi,"list",{offeringId:item.offeringId}),
      scoped(assessmentApi,"list_class_teacher",{offeringId:item.offeringId}),
      scoped(academicsApi,"class_roster",{offeringId:item.offeringId}),
      scoped(analyticsApi,"class",{offeringId:item.offeringId,includeDrafts:true})
    ]);
    if(turn!==epoch||current()?.offeringId!==item.offeringId)return false;
    if(results[0].status!=="fulfilled")throw results[0].reason;
    const stream=results[0].value;
    posts=stream.posts||[];canPost=stream.canPost===true;canComment=stream.canComment===true;
    classroomSettings=stream.settings||classroomSettings;officialMeetings=stream.schedule?.meetings||[];
    teachingTeam=stream.teachers||[];primaryTeacherUid=stream.primaryTeacherUid||"";primaryNeedsReview=stream.primaryNeedsReview===true;
    mutedPersonIds=new Set(stream.mutedPersonIds||[]);loadedOffering=item.offeringId;
    if(results[1].status==="fulfilled")
      classwork=(results[1].value.assessments||[]).filter(task=>task.offeringId===item.offeringId&&!["archived","cancelled"].includes(task.lifecycle)).sort((a,b)=>(a.dueAt||0)-(b.dueAt||0));
    else classworkError="Classwork could not load. The classroom stream is still available.";
    if(results[2].status==="fulfilled")rosterStudents=results[2].value.students||[];
    else rosterError="Roster could not load. Official enrollment was not changed.";
    if(results[3].status==="fulfilled"){
      classworkHealth=new Map((results[3].value.assessments||[]).map(row=>[row.taskId,row]));
      classworkSummary=results[3].value.summary?.classwork||null;
      preparationPlans=results[3].value.preparation||[];
    }else classworkHealthError="Submission and grading counts are temporarily unavailable. Classwork links still work.";
    renderPosts();renderPreparation();renderMaterials();renderClasswork();renderRoster();renderParticipation();renderTeachingTeam();renderOfficialSchedule();updateClassLinks();syncControls();return true;
  }catch(error){
    if(turn===epoch){say(error?.message||"Classroom could not load.",true);renderPosts();renderPreparation();renderMaterials();renderClasswork();renderRoster();renderParticipation();renderTeachingTeam();renderOfficialSchedule();}
    return false;
  }
}
async function refresh(){
  if(!picker?.scope.current||busy)return;
  if(editing&&!confirm("Discard unsaved post edits and reload the classroom?"))return;
  keepDraft();editing=null;setBusy(true);say("Loading your assigned classrooms…");
  try{
    const result=await scoped(analyticsApi,"scope");offerings=result.offerings||[];const previous=select.value;select.replaceChildren();
    for(const item of offerings)select.add(new Option(label(item),item.offeringId));
    if(offerings.some(item=>item.offeringId===previous))select.value=previous;
    else if(initialOfferingId&&offerings.some(item=>item.offeringId===initialOfferingId))select.value=initialOfferingId;
    if(!offerings.length){loadedOffering="";posts=[];classwork=[];rosterStudents=[];preparationPlans=[];officialMeetings=[];teachingTeam=[];primaryTeacherUid="";primaryNeedsReview=false;renderPosts();renderPreparation();renderMaterials();renderClasswork();renderRoster();renderParticipation();renderOfficialSchedule();say("No active class is assigned to this teacher account.",true);return;}
    syncOfferingUrl(select.value);restoreDraft(select.value);if(await loadPosts())say("Classroom ready for "+label(current())+".");
  }catch(error){loadedOffering="";posts=[];classwork=[];rosterStudents=[];preparationPlans=[];renderPosts();renderPreparation();renderMaterials();renderClasswork();renderRoster();renderParticipation();say(error?.message||"Classroom could not load.",true);}
  finally{setBusy(false);}
}
async function writeStream(action,details,success,{after=null}={}){
  if(busy||!current()||loadedOffering!==current().offeringId)return false;
  const id=current().offeringId;setBusy(true);say("Saving classroom change…");
  try{
    await scoped(streamApi,action,{offeringId:id,...details});if(after)after();
    const refreshed=await loadPosts();say(success+(refreshed?"":" The change was saved, but the classroom could not refresh. Select Refresh."),!refreshed);return true;
  }catch(error){say(error?.message||"Classroom change could not be saved. Unsaved composer content was retained.",true);return false;}
  finally{setBusy(false);}
}
async function archivePost(post){
  if(busy||editing||!post.canModerate||!confirm("Remove this classroom post? It will no longer appear in the class stream."))return;
  await writeStream("archive",{postId:post.postId,expectedRevision:post.revision},"Classroom post removed.");
}
async function changePin(post){
  if(busy||editing||post.authorRole==="student"||!post.canEdit)return;
  await writeStream("update",{postId:post.postId,expectedRevision:post.revision,title:post.title,body:post.body,linkUrl:post.linkUrl,pinned:!post.pinned},post.pinned?"Post unpinned.":"Post pinned.");
}
async function addComment(post,body){
  if(!canComment)return;
  await writeStream("create_comment",{postId:post.postId,body},"Comment posted.");
}
async function removeComment(comment){
  if(!comment.canDelete||!confirm("Remove this classroom comment?"))return;
  await writeStream("archive_comment",{commentId:comment.commentId},"Comment removed.");
}
async function toggleMute(student,muting){
  if(!student?.personId)return;
  const reason=prompt((muting?"Reason for muting ":"Reason for restoring classroom participation for ")+(student.name||"this student")+" (at least 12 characters):",
    muting?"Classroom participation moderation":"Classroom participation restored");
  if(reason===null)return;if(reason.trim().length<12){say("Explain the moderation change in at least 12 characters.",true);return;}
  await writeStream(muting?"mute_student":"unmute_student",{personId:student.personId,reason:reason.trim()},
    muting?(student.name||"Student")+" can now read the class but cannot post or comment.":(student.name||"Student")+" can participate again under the class participation setting.");
}
el("teacherClassroomParticipationForm").addEventListener("submit",event=>{
  event.preventDefault();if(busy||!loadedOffering)return;
  const participationMode=el("teacherClassroomParticipation").value;
  void writeStream("update_settings",{participationMode,expectedRevision:Number(classroomSettings.revision||0)},"Classroom participation updated.");
});
form.addEventListener("input",keepDraft);
form.addEventListener("submit",event=>{
  event.preventDefault();if(busy||!canPost||!current())return;
  const data=readComposer(),title=data.title.trim(),body=data.body.trim();
  if(!title&&!body){say("Write a title or message before publishing.",true);el("teacherClassroomBody").focus();return;}
  const action=editing?"update":"create",details={kind:data.kind,title,body,linkUrl:data.link.trim(),pinned:data.pinned,...(editing?{postId:editing.postId,expectedRevision:editing.revision}:{})};
  void writeStream(action,details,editing?"Classroom post updated.":"Published to "+label(current())+". Students can now see it in their classroom.",{
    after:()=>{if(action==="create")dropDraft(current().offeringId);if(action==="create"||action==="update")restoreDraft(current().offeringId);}
  });
});
el("teacherClassroomCancelEdit").addEventListener("click",()=>{if(!busy)restoreDraft(select.value);});
select.addEventListener("change",async()=>{
  if(busy){select.value=composerOffering;return;}
  if(editing&&!confirm("Discard unsaved changes to this post?")){select.value=composerOffering;return;}
  keepDraft();syncOfferingUrl(select.value);restoreDraft(select.value);setBusy(true);say("Loading classroom…");
  try{if(await loadPosts())say("Classroom ready for "+label(current())+".");}finally{setBusy(false);}
});
el("teacherClassroomRefresh").addEventListener("click",()=>void refresh());
el("teacherClassroomFilter").addEventListener("change",renderPosts);
el("teacherClassroomSearch").addEventListener("input",renderPosts);
picker=createTenantSchoolPicker({host:el("teacherClassroomSchoolSwitcher"),status:null,onBeforeChange:async()=>{
  if(busy||editing)throw Error("Finish or cancel the current classroom action before switching schools.");
  keepDraft();++epoch;offerings=[];posts=[];classwork=[];rosterStudents=[];loadedOffering="";canPost=false;canComment=false;composerOffering="";
  classworkError="";classworkHealthError="";rosterError="";classworkHealth=new Map();classworkSummary=null;preparationPlans=[];officialMeetings=[];teachingTeam=[];primaryTeacherUid="";primaryNeedsReview=false;mutedPersonIds=new Set();classroomSettings={participationMode:"teacher_only",revision:0};
  syncOfferingUrl("");select.replaceChildren();fillComposer();renderPosts();renderPreparation();renderMaterials();renderClasswork();renderRoster();renderParticipation();renderOfficialSchedule();updateClassLinks();syncControls();
},onReady:scope=>{if(scope.current?.roles.includes("teacher"))void refresh();else say("Teacher access is required.",true);}});
renderClasswork();renderRoster();renderParticipation();updateClassLinks();syncControls();
await auth.authStateReady();
try{const state=await picker.load();if(!auth.currentUser)say("Sign in with a verified teacher account.",true);else if(state?.state==="choose_school")say("Choose the school whose classroom you want to manage.");}
catch(error){say(error?.message||"Verified school access is unavailable.",true);}
