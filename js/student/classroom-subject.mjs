
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";
import {loadLegacyProgrammingClassroom} from "./legacy-classroom-stream.mjs?v=1.0.0";

const functions=getFunctions(app,"asia-southeast1");
const profileApi=httpsCallable(functions,"schoolStudentProfile");
const assessmentApi=httpsCallable(functions,"schoolAssessments");
const gradeApi=httpsCallable(functions,"schoolGradebook");
const streamApi=httpsCallable(functions,"schoolClassroomStream");
const studioSubmissionApi=httpsCallable(functions,"schoolStudioSubmissions");
const responseSubmissionApi=httpsCallable(functions,"schoolAssessmentSubmissions");
const githubEvidenceApi=httpsCallable(functions,"schoolGithubEvidence");
const el=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const requestedOfferingId=params.get("offeringId")||"";
const requestedSubjectId=params.get("subjectId")||"";
const requestedSubjectName=params.get("subject")||"";
const forceLegacy=params.get("legacy")==="1";
let picker=null,profile=null,current=null,busy=false,epoch=0,legacyMode=false,streamData=null,streamLimit=20;

let classroomParticipation={canPost:false,canComment:false,muted:false,mode:"teacher_only"},officialMeetings=[];
function make(tag,cls,text){
  const node=document.createElement(tag);if(cls)node.className=cls;
  if(text!==undefined)node.textContent=String(text);return node;
}
function date(value,options={dateStyle:"medium",timeStyle:"short"}){
  return value?new Date(value).toLocaleString([],options):"";
}
function subjectQuery(item=current){
  const q=new URLSearchParams();
  if(item?.subjectId)q.set("subjectId",item.subjectId);
  if(item?.subject)q.set("subject",item.subject);
  if(item?.offeringId)q.set("offeringId",item.offeringId);
  return q.toString()?"?"+q.toString():"";
}
function isProgramming(item=current){return /computer\s*programming|programming/i.test(String(item?.subject||""));}
function setStatus(message,error=false){
  el("subjectClassroomStatus").textContent=message;
  el("subjectClassroomStatus").className="text-sm "+(error?"text-rose-700":"text-slate-600");
}
async function scoped(api,action,details={}){
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);return result;
}
function resolveClass(classes){
  let rows=classes||[];
  if(requestedSubjectId)rows=rows.filter(item=>item.subjectId===requestedSubjectId);
  else if(requestedSubjectName)rows=rows.filter(item=>String(item.subject||"").toLowerCase()===requestedSubjectName.toLowerCase());
  if(requestedOfferingId){
    const exact=(classes||[]).find(item=>item.offeringId===requestedOfferingId);
    if(exact&&rows.includes(exact))return exact;
    return null;
  }
  if(rows.length)return rows[0];
  if(requestedSubjectId||requestedSubjectName)return null;
  return (classes||[]).find(item=>/computer\s*programming|programming/i.test(String(item.subject||"")))||(classes||[])[0]||null;
}
function courseLabel(item){return [item?.section,item?.term,item?.year].filter(Boolean).join(" · ");}
function updateLinks(){
  const controls=["subjectAssignmentsLink","subjectAllWorkLink","subjectQuickAssignments","subjectGradesLink","subjectQuickGrades","subjectProjectsLink","subjectQuickProjects","subjectQuickStudio"];
  for(const id of controls){const link=el(id);if(!current){link.removeAttribute("href");link.setAttribute("aria-disabled","true");link.setAttribute("tabindex","-1");link.classList.add("opacity-50","pointer-events-none");}else{link.removeAttribute("aria-disabled");link.removeAttribute("tabindex");link.classList.remove("opacity-50","pointer-events-none");}}
  if(!current)return;
  const q=subjectQuery(),assign="student-assessments.html"+q;
  const grades=legacyMode?assign:"school-student-grades.html"+q;
  const projects=legacyMode?"student-dashboard.html":"school-student-projects.html"+q;
  for(const id of ["subjectAssignmentsLink","subjectAllWorkLink","subjectQuickAssignments"])el(id).href=assign;
  for(const id of ["subjectGradesLink","subjectQuickGrades"])el(id).href=grades;
  for(const id of ["subjectProjectsLink","subjectQuickProjects"])el(id).href=projects;
  el("subjectGradesLink").textContent=legacyMode?"Results":"Grades";
  el("subjectQuickGrades").firstChild.textContent=legacyMode?"Results ":"My Grades ";
  const studio=el("subjectQuickStudio");
  studio.href=current?.offeringId&&!legacyMode?"student-playground.html?offeringId="+encodeURIComponent(current.offeringId):"student-playground.html";
}
function renderHeader(){
const scheduleDayNames={mon:"Mon",tue:"Tue",wed:"Wed",thu:"Thu",fri:"Fri",sat:"Sat"};
function renderOfficialSchedule(){
  const host=el("subjectClassroomSchedule");host.replaceChildren();
  if(legacyMode||!current)return;
  if(!officialMeetings.length){
    host.append(make("span","rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-300","Official schedule not set"));
    return;
  }
  const sorted=[...officialMeetings].sort((a,b)=>Object.keys(scheduleDayNames).indexOf(a.day)-Object.keys(scheduleDayNames).indexOf(b.day)||
    String(a.startTime).localeCompare(String(b.startTime)));
  for(const meeting of sorted){
    host.append(make("span","rounded-full border border-violet-400/40 bg-violet-400/10 px-3 py-1.5 text-xs font-bold text-violet-100",
      [scheduleDayNames[meeting.day]||meeting.day,meeting.startTime+"–"+meeting.endTime,meeting.room||""].filter(Boolean).join(" · ")));
  }
}
  el("subjectClassroomTitle").textContent=current?.subject||requestedSubjectName||"Subject";
  el("subjectClassroomMeta").textContent=current?(courseLabel(current)||"Active school classroom"):"No accessible class selected";
  el("subjectClassroomEyebrow").textContent=(current?.section||"Classroom")+" · Student stream";
  el("subjectLegacyNote").classList.toggle("hidden",!isProgramming());
  if(legacyMode)el("subjectLegacyNote").innerHTML="<strong>Existing Adminerva programming classroom</strong><p class='mt-1'>This stream is using your current legacy class records, assignments, submissions and published feedback. Teacher announcements will appear here automatically after your verified school enrollment is linked.</p>";
  const same=current?(profile?.classes||[]).filter(item=>item.subjectId===current.subjectId):[];
  const wrap=el("subjectOfferingWrap"),select=el("subjectOfferingSelect");
  select.replaceChildren();
  for(const item of same)select.add(new Option(courseLabel(item)||item.subject,item.offeringId));
  wrap.classList.toggle("hidden",same.length<2);
  if(current?.offeringId)select.value=current.offeringId;
  updateLinks();
  updateLinks();renderOfficialSchedule();
function stateFor(task,submission,grade){
  if(grade)return {label:"Graded",tone:"emerald",action:false};
  if(submission?.error)return {label:"Status unavailable",tone:"slate",action:false};
  if(submission?.status==="reopened")return {label:"Revision requested",tone:"amber",action:true};
  if(submission?.status==="reopened")return Number(submission.revisionDueAt||0)>Date.now()?
    {label:"Revision requested",tone:"amber",action:true}:{label:"Revision expired",tone:"rose",action:false};
  if(task.windowStatus==="upcoming")return {label:"Upcoming",tone:"slate",action:false};
  if(task.windowStatus==="closed")return {label:"Past due",tone:"rose",action:true};
  if(task.windowStatus==="closed")return {label:"Past due",tone:"rose",action:false};
  if(task.windowStatus==="open"&&task.allowLateSubmissions===true&&Number(task.dueAt||0)<Date.now())
    return {label:"Late submission allowed",tone:"amber",action:true};
}
function badge(label,tone){
  const classes={
    emerald:"bg-emerald-100 text-emerald-800",amber:"bg-amber-100 text-amber-900",
    blue:"bg-blue-100 text-blue-800",slate:"bg-slate-100 text-slate-700",
    rose:"bg-rose-100 text-rose-800",indigo:"bg-indigo-100 text-indigo-800"
  };
  return make("span","rounded-full px-2.5 py-1 text-xs font-extrabold "+(classes[tone]||classes.slate),label);
}
function summaryCard(value,label,detail){
  const card=make("div","p-4 bg-white");
  card.append(make("strong","block text-2xl font-extrabold text-slate-900",value),
    make("span","block text-xs font-bold text-slate-600 mt-1",label));
  if(detail)card.append(make("span","block text-[11px] text-slate-400 mt-1",detail));
  return card;
}
function renderSummary(tasks,statuses,grades,posts,availability={}){
  const unknown=tasks.some(task=>!grades.get(task.taskId)&&statuses.get(task.taskId)?.error);
  const todo=tasks.filter(task=>stateFor(task,statuses.get(task.taskId),grades.get(task.taskId)).action).length;
  const submitted=tasks.filter(task=>statuses.get(task.taskId)?.submitted&&!grades.get(task.taskId)).length;
  const announcements=posts.filter(post=>post.kind==="announcement").length;
  const host=el("subjectSummary");host.replaceChildren(
    summaryCard(!current||unknown||availability.assignments===false?"—":todo,"Needs my action",unknown?"Some statuses unavailable":!current||availability.assignments===false?"Not loaded":todo?"Check due dates":"You’re caught up"),
    summaryCard(!current||unknown||availability.assignments===false?"—":submitted,"Submitted","Waiting for review"),
    summaryCard(!current||availability.grades===false?"—":grades.size,"Released results","Teacher-published"),
    summaryCard(!current||availability.assignments===false||availability.grades===false?"—":grades.size,"Released results",availability.assignments===false?"Assignment list unavailable":"Teacher-published"),
  );
}
function taskHref(task){
  const q=subjectQuery();return "student-assessments.html"+q+"#"+encodeURIComponent(task.taskId);
}
function assignmentCard(task,statusRow,grade){
  const state=stateFor(task,statusRow,grade),card=make("article","rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5");
  const top=make("div","flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"),identity=make("div","min-w-0");
  identity.append(make("p","text-xs uppercase tracking-wider font-bold text-indigo-700","Assignment"),
    make("h3","text-lg font-extrabold mt-1 text-slate-900",task.title),
    make("p","text-xs text-slate-500 mt-1",(task.postedAt?"Posted "+date(task.postedAt)+" · ":"")+"Due "+date(task.dueAt)));
  top.append(identity,badge(state.label,state.tone));card.append(top);
  if(task.description)card.append(make("p","text-sm text-slate-700 mt-3 line-clamp-3",task.description));
  if(statusRow?.status==="reopened"){
    const box=make("div","mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950");
    box.append(make("strong","","Teacher requested a revision"));
    const message=statusRow.requestMessage||statusRow.reopenReason||"Open the assignment to review the requested changes.";
    box.append(make("p","mt-1",message));if(statusRow.revisionDueAt)box.append(make("p","text-xs mt-2","Revision due "+date(statusRow.revisionDueAt)));
    card.append(box);
  }
  const actions=make("div","mt-4 flex flex-wrap gap-2");
  const open=make("a","rounded-lg bg-indigo-700 text-white px-4 py-2.5 text-sm font-bold","Open classwork →");open.href=taskHref(task);actions.append(open);
  if(grade){const result=make("a","rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-2.5 text-sm font-bold","View result "+grade.awarded+" / "+grade.total);result.href=legacyMode?taskHref(task):"school-student-grades.html"+subjectQuery();actions.append(result);}
  card.append(actions);return card;
}
function postCard(post,pinned=false){
function participationCopy(){
  if(legacyMode)return "Class discussion becomes available after this class is linked to the verified school workspace.";
  if(classroomParticipation.muted)return "Your teacher muted your classroom participation. You can still read posts, classwork, feedback and released results.";
  if(classroomParticipation.mode==="posts_comments")return "You may post and comment in this classroom. Teachers can moderate classroom discussion.";
  if(classroomParticipation.mode==="comments_only")return "You may comment on classroom posts. New top-level posts are teacher-only.";
  return "Classroom discussion is teacher-only. You can read posts, classwork, feedback and released results.";
}
function renderParticipation(){
  const panel=el("subjectParticipationPanel"),form=el("subjectPostForm"),note=el("subjectParticipationNote");
  if(!panel||!form||!note)return;
  note.textContent=participationCopy();
  form.hidden=legacyMode||!classroomParticipation.canPost;
  for(const control of form.querySelectorAll("textarea,button"))control.disabled=busy||form.hidden;
}
async function writeClassroom(action,details,success){
  if(busy||legacyMode||!current)return false;
  busy=true;el("subjectRefresh").disabled=true;renderParticipation();setStatus("Saving classroom discussion…");
  try{
    await scoped(streamApi,action,{offeringId:current.offeringId,...details});
    busy=false;el("subjectRefresh").disabled=false;
    await refresh();setStatus(success);return true;
  }catch(error){
    setStatus(error?.message||"Classroom discussion could not be saved.",true);return false;
  }finally{
    busy=false;el("subjectRefresh").disabled=false;renderParticipation();
  }
}
async function addClassComment(post,body){
  if(!classroomParticipation.canComment)return;
  await writeClassroom("create_comment",{postId:post.postId,body},"Comment posted.");
}
async function removeClassComment(comment){
  if(!comment.canDelete||!confirm("Remove this classroom comment?"))return;
  await writeClassroom("archive_comment",{commentId:comment.commentId},"Comment removed.");
}
async function removeClassPost(post){
  if(!post.canModerate||!confirm("Remove your classroom post?"))return;
  await writeClassroom("archive",{postId:post.postId,expectedRevision:post.revision},"Classroom post removed.");
}
function appendPostDiscussion(post,card){
  const comments=Array.isArray(post.comments)?post.comments:[],section=make("section","mt-4 border-t border-slate-100 pt-3");
  section.append(make("p","text-xs font-extrabold uppercase tracking-wide text-slate-500",comments.length+" comment"+(comments.length===1?"":"s")));
  if(comments.length){
    const list=make("div","mt-2 space-y-2");
    for(const comment of comments){
      const row=make("div","rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"),top=make("div","flex items-start justify-between gap-3");
      top.append(make("p","text-xs text-slate-500",(comment.authorName||"Class member")+" · "+(comment.authorRole==="student"?"Student":"Teacher")+" · "+date(comment.createdAt)));
      if(comment.canDelete){
        const remove=make("button","text-xs font-bold text-rose-700","Remove");remove.type="button";remove.addEventListener("click",()=>void removeClassComment(comment));top.append(remove);
      }
      row.append(top,make("p","text-sm text-slate-700 whitespace-pre-wrap break-words mt-1",comment.body||""));list.append(row);
    }section.append(list);
  }
  if(classroomParticipation.canComment){
    const form=make("form","mt-3 flex gap-2"),input=make("input","min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"),submit=make("button","rounded-lg bg-slate-800 text-white px-3 py-2 text-xs font-bold","Comment");
    input.type="text";input.maxLength=2000;input.required=true;input.placeholder="Add a class comment…";submit.type="submit";
    form.append(input,submit);form.addEventListener("submit",event=>{event.preventDefault();const body=input.value.trim();if(body)void addClassComment(post,body);});section.append(form);
  }
  card.append(section);
}
  const card=make("article","rounded-2xl border shadow-sm p-4 sm:p-5 "+(pinned?"border-cyan-300 bg-cyan-50":"border-slate-200 bg-white"));
  const student=post.authorRole==="student";
  const card=make("article","rounded-2xl border shadow-sm p-4 sm:p-5 "+(pinned?"border-cyan-300 bg-cyan-50":student?"border-violet-200 bg-white":"border-slate-200 bg-white"));
  identity.append(make("p","text-xs uppercase tracking-wider font-bold "+(pinned?"text-cyan-800":"text-slate-500"),
  const kind=pinned?"Pinned announcement":student?"Student post":post.kind==="material"?"Class material":post.kind==="post"?"Teacher post":"Announcement";
  identity.append(make("p","text-xs uppercase tracking-wider font-bold "+(student?"text-violet-700":pinned?"text-cyan-800":"text-slate-500"),kind));
  identity.append(make("p","text-xs text-slate-500 mt-1",(post.authorName||"Teacher")+" · "+date(post.createdAt)));
  identity.append(make("p","text-xs text-slate-500 mt-1",(post.authorName||(student?"Student":"Teacher"))+" · "+date(post.createdAt)));
  top.append(identity);
  const actions=make("div","flex items-center gap-2");
  if(pinned)actions.append(badge("Pinned","blue"));
  if(post.canModerate){
    const remove=make("button","rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-700","Remove");remove.type="button";remove.addEventListener("click",()=>void removeClassPost(post));actions.append(remove);
  }
  if(actions.children.length)top.append(actions);card.append(top);
  if(post.linkUrl){const link=make("a","inline-block mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-cyan-800","Open shared link ↗");link.href=post.linkUrl;link.target="_blank";link.rel="noopener noreferrer";card.append(link);}
  return card;
  appendPostDiscussion(post,card);return card;
function gradeCard(grade,task){
  const card=make("article","rounded-2xl border border-emerald-200 bg-emerald-50 shadow-sm p-4 sm:p-5");
  card.append(make("p","text-xs uppercase tracking-wider font-bold text-emerald-700","Result released"),
    make("h3","text-lg font-extrabold mt-1 text-slate-900",task?.title||"Assessment result"),
    make("p","text-sm font-bold text-emerald-900 mt-2",grade.awarded+" / "+grade.total),
    make("p","text-xs text-slate-500 mt-1","Published "+date(grade.publishedAt)));
  if(grade.feedback)card.append(make("p","text-sm text-emerald-950 mt-3 line-clamp-3",grade.feedback));
  const link=make("a","inline-block mt-4 text-sm font-bold text-emerald-900 underline",legacyMode?"Open assignment result →":"View in My Grades →");link.href=legacyMode&&task?taskHref(task):"school-student-grades.html"+subjectQuery();card.append(link);return card;
}
function renderUpcoming(tasks,statuses,grades,availability={}){
  const host=el("subjectUpcoming");host.replaceChildren();
  const rows=tasks.filter(task=>!grades.get(task.taskId)&&!statuses.get(task.taskId)?.error&&!statuses.get(task.taskId)?.submitted)
    .sort((a,b)=>(a.dueAt||0)-(b.dueAt||0)).slice(0,4);
  if(!rows.length){const unknown=tasks.some(task=>statuses.get(task.taskId)?.error);host.append(make("p","rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600",!current||availability.assignments===false||unknown?"Pending work could not be confirmed. Refresh to retry.":"No pending work right now."));return;}
  for(const task of rows){
    const row=make("a","block rounded-xl border border-slate-200 p-3 hover:border-indigo-300 hover:bg-indigo-50");row.href=taskHref(task);
    row.append(make("strong","block text-sm text-slate-900",task.title),make("span","block text-xs text-slate-500 mt-1","Due "+date(task.dueAt)));
    host.append(row);
  }
}
function renderStream(posts,tasks,statuses,grades,availability={}){
  streamData={posts,tasks,statuses,grades,availability};streamLimit=20;renderParticipation();paintStream();
}
el("subjectStreamSearch").addEventListener("input",()=>{streamLimit=20;paintStream();});
el("subjectPostForm").addEventListener("submit",event=>{
  event.preventDefault();if(!classroomParticipation.canPost||busy||legacyMode||!current)return;
  const body=el("subjectPostBody").value.trim();if(!body){setStatus("Write something before posting.",true);return;}
  void writeClassroom("create",{kind:"post",title:"",body},"Posted to your classroom.").then(saved=>{if(saved)el("subjectPostBody").value="";});
});
el("subjectStreamFilter").addEventListener("change",()=>{streamLimit=20;paintStream();});
el("subjectStreamMore").addEventListener("click",()=>{streamLimit+=20;paintStream();});
async function loadStatuses(tasks,grades=new Map()){
  const map=new Map(),queue=tasks.filter(task=>!grades.has(task.taskId)&&task.windowStatus!=="upcoming");
  let next=0;
  const worker=async()=>{while(next<queue.length){const task=queue[next++];
    try{
      const api=task.submissionSource==="github"?githubEvidenceApi:task.submissionSource==="studio"?studioSubmissionApi:responseSubmissionApi;
      map.set(task.taskId,await scoped(api,"my_status",{taskId:task.taskId}));
    }catch(error){map.set(task.taskId,{error:error?.message||"Submission status unavailable"});}
  }};
  await Promise.all(Array.from({length:Math.min(5,queue.length)},worker));
  return map;
}
async function refreshLegacy(){
  if(busy)return;
  const turn=++epoch;busy=true;legacyMode=true;el("subjectRefresh").disabled=true;setStatus("Loading your existing Computer Programming classroom…");
  try{
    const result=await loadLegacyProgrammingClassroom();if(turn!==epoch)return;
    profile={classes:result.classes||[]};current=resolveClass(profile.classes);
    if(!current){
      renderHeader();
      setStatus("Your existing Adminerva student record is not linked to this programming class. Return to All subjects to choose an available class.",true);
      renderSummary([],new Map(),new Map(),[]);renderUpcoming([],new Map(),new Map());renderStream([],[],new Map(),new Map());return;
    }
    renderHeader();
    const tasks=result.tasks||[],statuses=result.statuses||new Map(),grades=result.grades||new Map(),posts=[];
    renderSummary(tasks,statuses,grades,posts);renderUpcoming(tasks,statuses,grades);renderStream(posts,tasks,statuses,grades);
    el("subjectClassroomMeta").textContent=[courseLabel(current),"Existing Adminerva class"].filter(Boolean).join(" · ");
    setStatus(tasks.length||grades.size?"Existing programming classroom loaded. Announcements will join this stream after verified school access is linked.":"Your programming classroom is ready. No current assignments were found.");
  }catch(error){
    if(turn===epoch)setStatus(error?.message||"Your existing programming classroom could not be loaded.",true);
  }finally{if(turn===epoch){busy=false;el("subjectRefresh").disabled=false;}}
  }finally{if(turn===epoch){busy=false;el("subjectRefresh").disabled=false;renderParticipation();}}

async function refresh(){
  if(!picker?.scope.current||busy)return;
  const turn=++epoch;busy=true;legacyMode=false;el("subjectRefresh").disabled=true;setStatus("Loading your classroom stream…");
  current=null;profile=null;renderHeader();renderSummary([],new Map(),new Map(),[]);renderUpcoming([],new Map(),new Map());renderStream([],[],new Map(),new Map());
  current=null;profile=null;officialMeetings=[];classroomParticipation={canPost:false,canComment:false,muted:false,mode:"teacher_only"};renderParticipation();renderHeader();renderSummary([],new Map(),new Map(),[]);renderUpcoming([],new Map(),new Map());renderStream([],[],new Map(),new Map());
    profile=await scoped(profileApi,"my_profile");if(turn!==epoch)return;
    current=resolveClass(profile.classes||[]);
    if(!current){renderHeader();renderSummary([],new Map(),new Map(),[]);renderUpcoming([],new Map(),new Map());renderStream([],[],new Map(),new Map());setStatus("The requested class is not available in this school. Return to All subjects to choose an active class.",true);return;}
    renderHeader();
    const [assignmentResult,gradeResult,streamResult]=await Promise.all([
      scoped(assessmentApi,"list_student").catch(error=>({assignments:[],error:error?.message||"Classwork unavailable"})),
      scoped(gradeApi,"my_published").catch(error=>({grades:[],error:error?.message||"Grades unavailable"})),
      scoped(streamApi,"list",{offeringId:current.offeringId}).catch(error=>({posts:[],error:error?.message||"Announcements unavailable"}))
    ]);
    if(turn!==epoch)return;
    const tasks=(assignmentResult.assignments||[]).filter(task=>task.offeringId===current.offeringId);
    const grades=new Map((gradeResult.grades||[]).filter(grade=>tasks.some(task=>task.taskId===grade.taskId)).map(grade=>[grade.taskId,grade]));
    const statuses=await loadStatuses(tasks,grades);if(turn!==epoch)return;
    const posts=streamResult.posts||[];
    const teacherNames=(streamResult.teachers||[]).map(item=>item.name).filter(Boolean);
    officialMeetings=streamResult.schedule?.meetings||[];
    classroomParticipation={
      canPost:streamResult.canPost===true,
      canComment:streamResult.canComment===true,
      muted:streamResult.viewer?.muted===true,
      mode:streamResult.settings?.participationMode||"teacher_only"
    };
    renderParticipation();renderOfficialSchedule();
    const teacherRows=streamResult.teachers||[],
      primary=teacherRows.find(item=>item.role==="primary"),
      coTeachers=teacherRows.filter(item=>item.role==="co_teacher").map(item=>item.name).filter(Boolean),
      teamParts=[];
    if(primary?.name)teamParts.push("Primary Teacher: "+primary.name);
    if(coTeachers.length)teamParts.push("Co-teacher"+(coTeachers.length===1?"":"s")+": "+coTeachers.join(", "));
    if(streamResult.primaryNeedsReview===true)teamParts.push("Primary Teacher pending school review");
    el("subjectClassroomMeta").textContent=[courseLabel(current),...teamParts].filter(Boolean).join(" · ")||"Active school classroom";
    renderSummary(tasks,statuses,grades,posts,availability);renderUpcoming(tasks,statuses,grades,availability);renderStream(posts,tasks,statuses,grades);
    const missing=[assignmentResult.error?"classwork":"",gradeResult.error?"grades":"",streamResult.error?"announcements":"",[...statuses.values()].some(row=>row.error)?"some submission statuses":""].filter(Boolean);
    setStatus(missing.length?"Partially loaded. Unavailable: "+missing.join(", ")+". Refresh to retry.":tasks.length||posts.length||grades.size?"Classroom is up to date.":"This classroom has no activity yet.",Boolean(missing.length));
  }catch(error){
    if(turn===epoch)setStatus(error?.message||"Your classroom could not be loaded.",true);
  }finally{if(turn===epoch){busy=false;el("subjectRefresh").disabled=false;}}
}
el("subjectOfferingSelect").addEventListener("change",event=>{
  const selected=(profile?.classes||[]).find(item=>item.offeringId===event.target.value);
  if(!selected)return;const q=new URLSearchParams();q.set("subjectId",selected.subjectId);q.set("subject",selected.subject);q.set("offeringId",selected.offeringId);
  if(legacyMode)q.set("legacy","1");
  location.href="student-subject.html?"+q.toString();
});
el("subjectRefresh").addEventListener("click",()=>void (legacyMode?refreshLegacy():refresh()));

picker=createTenantSchoolPicker({
  host:el("subjectSchoolSwitcher"),status:null,
  onBeforeChange:async()=>{if(busy)throw new Error("Finish loading before switching schools.");++epoch;},
  onReady:scope=>{if(scope.current)void refresh();}
});
await auth.authStateReady();
try{
  if(forceLegacy){
    if(!auth.currentUser)setStatus("Sign in with your student account to open this classroom.",true);
    else await refreshLegacy();
  }else{
    const state=await picker.load();
    if(!auth.currentUser)setStatus("Sign in with your student account to open this classroom.",true);
    else if(state?.state==="no_school")await refreshLegacy();
    else if(state?.state==="choose_school")setStatus("Choose your active school to load this subject. Your existing programming classroom remains available from All subjects.");
  }
}catch(error){
  if(auth.currentUser&&isProgramming({subject:requestedSubjectName||"Computer Programming"}))await refreshLegacy();
  else setStatus(error?.message||"Verified school classroom access is unavailable.",true);
}
