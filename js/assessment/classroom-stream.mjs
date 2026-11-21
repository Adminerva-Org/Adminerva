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
let classworkHealth=new Map(),classworkSummary=null;
const fields=["Kind","Title","Body","Link","Pinned"];
function make(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function date(value){return value?new Date(value).toLocaleString():"";}
function label(item){return [item?.subject,item?.section,item?.term,item?.year].filter(Boolean).join(" · ");}
function current(){return offerings.find(item=>item.offeringId===select.value)||null;}
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
function updateClassLinks(){
  const item=current(),offeringId=item?.offeringId||"",query=offeringId?"&offeringId="+encodeURIComponent(offeringId):"";
  el("teacherClassroomSubmissionsLink").href="school-gradebook.html?view=submissions"+query;
  el("teacherClassroomGradesLink").href="school-gradebook.html?view=results"+query;
  el("teacherClassroomRecordLink").href=offeringId?"class-record.html?offering="+encodeURIComponent(offeringId):"class-record.html";
  el("teacherClassroomAssessmentLink").href=offeringId?"assessment-studio.html?offeringId="+encodeURIComponent(offeringId):"assessment-studio.html";
  el("teacherClassroomPlanLink").href=offeringId?"lesson-planner.html?offeringId="+encodeURIComponent(offeringId):"lesson-planner.html";
}
function metricCard(label,value,tone="slate"){
  const card=make("div","rounded-lg border px-3 py-2 bg-"+tone+"-50 border-"+tone+"-200");
  card.append(make("strong","block text-lg leading-5 text-"+tone+"-900",Number(value||0).toLocaleString()),
    make("span","block text-[11px] font-bold text-"+tone+"-700 mt-1",label));
  return card;
}
function renderClasswork(){
  const host=el("teacherClassroomClasswork"),summaryHost=el("teacherClassroomClassworkSummary"),healthStatus=el("teacherClassroomClassworkHealthStatus");
  host.replaceChildren();summaryHost.replaceChildren();summaryHost.hidden=true;healthStatus.textContent="";
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
  else if(classworkSummary)healthStatus.textContent="Counts are student-task states for active enrolled learners with linked accounts. A revision request is not counted as never submitted.";
  if(!classwork.length){host.append(make("p","rounded-lg bg-slate-50 border border-dashed border-slate-300 p-4 text-sm text-slate-600","No assessments have been deployed to this class yet."));return;}
  for(const item of classwork){
    const row=make("article","rounded-xl border border-slate-200 p-3"),top=make("div","flex items-start justify-between gap-3"),text=make("div","min-w-0");
    text.append(make("strong","block text-sm",item.title||"Assessment"));
    const state=item.lifecycle==="closed"?"Closed":item.published===true?"Visible to students":"Teacher draft";
    text.append(make("span","block text-xs text-slate-500 mt-1",[item.assessmentType,state,item.dueAt?"Due "+date(item.dueAt):""].filter(Boolean).join(" · ")));
    const link=make("a","shrink-0 text-xs font-bold text-indigo-700 underline","Review");
    link.href="school-gradebook.html?view=review&offeringId="+encodeURIComponent(item.offeringId)+"&task="+encodeURIComponent(item.taskId);
    top.append(text,link);row.append(top);
    const health=classworkHealth.get(item.taskId);
    if(health){
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
  classworkError="";classworkHealthError="";rosterError="";classworkHealth=new Map();classworkSummary=null;classroomSettings={participationMode:"teacher_only",revision:0};
  renderPosts();renderClasswork();renderRoster();renderParticipation();updateClassLinks();syncControls();
  if(!item)return false;
  try{
    const results=await Promise.allSettled([
      scoped(streamApi,"list",{offeringId:item.offeringId}),
      scoped(assessmentApi,"list_teacher"),
      scoped(academicsApi,"class_roster",{offeringId:item.offeringId}),
      scoped(analyticsApi,"class",{offeringId:item.offeringId,includeDrafts:true})
    ]);
    if(turn!==epoch||current()?.offeringId!==item.offeringId)return false;
    if(results[0].status!=="fulfilled")throw results[0].reason;
    const stream=results[0].value;
    posts=stream.posts||[];canPost=stream.canPost===true;canComment=stream.canComment===true;
    classroomSettings=stream.settings||classroomSettings;mutedPersonIds=new Set(stream.mutedPersonIds||[]);loadedOffering=item.offeringId;
    if(results[1].status==="fulfilled")
      classwork=(results[1].value.assessments||[]).filter(task=>task.offeringId===item.offeringId&&!["archived","cancelled"].includes(task.lifecycle)).sort((a,b)=>(a.dueAt||0)-(b.dueAt||0));
    else classworkError="Classwork could not load. The classroom stream is still available.";
    if(results[2].status==="fulfilled")rosterStudents=results[2].value.students||[];
    else rosterError="Roster could not load. Official enrollment was not changed.";
    if(results[3].status==="fulfilled"){
      classworkHealth=new Map((results[3].value.assessments||[]).map(row=>[row.taskId,row]));
      classworkSummary=results[3].value.summary?.classwork||null;
    }else classworkHealthError="Submission and grading counts are temporarily unavailable. Classwork links still work.";
    renderPosts();renderClasswork();renderRoster();renderParticipation();updateClassLinks();syncControls();return true;
  }catch(error){
    if(turn===epoch){say(error?.message||"Classroom could not load.",true);renderPosts();renderClasswork();renderRoster();renderParticipation();}
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
    if(!offerings.length){loadedOffering="";posts=[];classwork=[];rosterStudents=[];renderPosts();renderClasswork();renderRoster();renderParticipation();say("No active class is assigned to this teacher account.",true);return;}
    restoreDraft(select.value);if(await loadPosts())say("Classroom ready for "+label(current())+".");
  }catch(error){loadedOffering="";posts=[];classwork=[];rosterStudents=[];renderPosts();renderClasswork();renderRoster();renderParticipation();say(error?.message||"Classroom could not load.",true);}
  finally{setBusy(false);}
}
async function writeStream(action,details,success,{after=null}={}){
  if(busy||!current()||loadedOffering!==current().offeringId)return false;
  const id=current().offeringId;setBusy(true);say("Saving classroom change…");
  try{
    await scoped(streamApi,action,{offeringId:id,...details});if(after)after();
    const refreshed=await loadPosts();say(success+(refreshed?"":" The change was saved, but the classroom could not refresh. Select Refresh."),!refreshed);return true;
  }catch(error){say(error?.message||"Classroom change could not be saved.",true);return false;}
  finally{setBusy(false);}
}
async function archivePost(post){
  if(busy||editing||!post.canModerate||!confirm("Remove this classroom post? It will no longer appear in the class stream."))return;
  await writeStream("archive",{postId:post.postId},"Classroom post removed.");
}
async function changePin(post){
  if(busy||editing||post.authorRole==="student"||!post.canEdit)return;
  await writeStream("update",{postId:post.postId,title:post.title,body:post.body,linkUrl:post.linkUrl,pinned:!post.pinned},post.pinned?"Post unpinned.":"Post pinned.");
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
  const action=editing?"update":"create",details={kind:data.kind,title,body,linkUrl:data.link.trim(),pinned:data.pinned,...(editing?{postId:editing.postId}:{})};
  void writeStream(action,details,editing?"Classroom post updated.":"Published to "+label(current())+". Students can now see it in their classroom.",{
    after:()=>{if(action==="create")dropDraft(current().offeringId);if(action==="create"||action==="update")restoreDraft(current().offeringId);}
  });
});
el("teacherClassroomCancelEdit").addEventListener("click",()=>{if(!busy)restoreDraft(select.value);});
select.addEventListener("change",async()=>{
  if(busy){select.value=composerOffering;return;}
  if(editing&&!confirm("Discard unsaved changes to this post?")){select.value=composerOffering;return;}
  keepDraft();restoreDraft(select.value);setBusy(true);say("Loading classroom…");
  try{if(await loadPosts())say("Classroom ready for "+label(current())+".");}finally{setBusy(false);}
});
el("teacherClassroomRefresh").addEventListener("click",()=>void refresh());
el("teacherClassroomFilter").addEventListener("change",renderPosts);
el("teacherClassroomSearch").addEventListener("input",renderPosts);
picker=createTenantSchoolPicker({host:el("teacherClassroomSchoolSwitcher"),status:null,onBeforeChange:async()=>{
  if(busy||editing)throw Error("Finish or cancel the current classroom action before switching schools.");
  keepDraft();++epoch;offerings=[];posts=[];classwork=[];rosterStudents=[];loadedOffering="";canPost=false;canComment=false;composerOffering="";
  classworkError="";classworkHealthError="";rosterError="";classworkHealth=new Map();classworkSummary=null;mutedPersonIds=new Set();classroomSettings={participationMode:"teacher_only",revision:0};
  select.replaceChildren();fillComposer();renderPosts();renderClasswork();renderRoster();renderParticipation();updateClassLinks();syncControls();
},onReady:scope=>{if(scope.current?.roles.includes("teacher"))void refresh();else say("Teacher access is required.",true);}});
renderClasswork();renderRoster();renderParticipation();updateClassLinks();syncControls();
await auth.authStateReady();
try{const state=await picker.load();if(!auth.currentUser)say("Sign in with a verified teacher account.",true);else if(state?.state==="choose_school")say("Choose the school whose classroom you want to manage.");}
catch(error){say(error?.message||"Verified school access is unavailable.",true);}
