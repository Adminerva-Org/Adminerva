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
let picker=null,offerings=[],posts=[],classwork=[],rosterStudents=[],busy=false,epoch=0,loadedOffering="",editing=null,composerOffering="",canPost=false,classworkError="",rosterError="";
const fields=["Kind","Title","Body","Link","Pinned"];
function make(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function date(value){return value?new Date(value).toLocaleString():"";}
function label(item){return [item?.subject,item?.section,item?.term,item?.year].filter(Boolean).join(" · ");}
function current(){return offerings.find(item=>item.offeringId===select.value)||null;}
function say(message,error=false){el("teacherClassroomStatus").textContent=message;el("teacherClassroomStatus").className="text-sm mt-3 "+(error?"text-rose-700":"text-slate-600");}
function readComposer(){const data={};for(const name of fields){const field=el("teacherClassroom"+name);data[name.toLowerCase()]=name==="Pinned"?field.checked:field.value;}return data;}
function fillComposer(data={}){for(const name of fields){const field=el("teacherClassroom"+name),value=data[name.toLowerCase()];if(name==="Pinned")field.checked=Boolean(value);else field.value=value??(name==="Kind"?"announcement":"");}}
function draftKey(id){return "adminerva:classroom-draft:"+auth.currentUser?.uid+":"+picker?.scope.current?.schoolId+":"+id;}
function keepDraft(){if(editing||!composerOffering||!auth.currentUser)return;try{const data=readComposer();sessionStorage.setItem(draftKey(composerOffering),JSON.stringify(data));}catch{}}
function restoreDraft(id){editing=null;composerOffering=id;let data={};try{data=JSON.parse(sessionStorage.getItem(draftKey(id))||"{}");}catch{}fillComposer(data||{});syncControls();}
function dropDraft(id){try{sessionStorage.removeItem(draftKey(id));}catch{}}
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
  for(const control of el("teacherClassroomPosts").querySelectorAll("button"))control.disabled=busy||!canPost;
}
function setBusy(value){busy=value;syncControls();}
async function scoped(api,action,details={}){
  const lease=picker.scope.lease();
  if(auth.currentUser?.uid!==lease.uid)throw Error("Sign in again before continuing.");
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);if(auth.currentUser?.uid!==lease.uid)throw Error("Account changed.");return result;
}
function renderPosts(){
  const host=el("teacherClassroomPosts");host.replaceChildren();
  const kind=el("teacherClassroomFilter").value,term=el("teacherClassroomSearch").value.trim().toLowerCase();
  const visible=posts.filter(post=>(kind==="all"||post.kind===kind)&&(!term||[post.title,post.body,post.authorName].some(v=>String(v||"").toLowerCase().includes(term)))).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||Number(b.createdAt||0)-Number(a.createdAt||0));
  el("teacherClassroomPostCount").textContent=loadedOffering?visible.length+" of "+posts.length+" posts":"";
  if(!loadedOffering){host.append(make("p","text-sm text-slate-600 p-4","Select a classroom and load its posts."));return;}
  if(!visible.length){host.append(make("div","rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600",posts.length?"No posts match your filters.":"No teacher posts yet."));return;}
  for(const post of visible){
    const card=make("article","rounded-2xl border bg-white shadow-sm p-4 sm:p-5 "+(post.pinned?"border-cyan-300":"border-slate-200"));
    const top=make("div","flex flex-wrap items-start justify-between gap-3"),identity=make("div","min-w-0 break-words");
    identity.append(make("p","text-xs uppercase tracking-wider font-bold "+(post.pinned?"text-cyan-800":"text-slate-500"),(post.pinned?"Pinned · ":"")+(post.kind||"post")),make("h3","text-lg font-extrabold mt-1",post.title||"Classroom update"),make("p","text-xs text-slate-500 mt-1",(post.authorName||"Teacher")+" · "+date(post.createdAt)+(Number(post.revision)>1?" · edited":"")));
    top.append(identity);
    if(canPost&&post.canEdit!==false){
      const actions=make("div","flex flex-wrap gap-2");
      for(const [caption,handler] of [["Edit",()=>beginEdit(post)],[post.pinned?"Unpin":"Pin",()=>void changePin(post)],["Remove",()=>void archivePost(post)]]){
        const control=make("button","rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold "+(caption==="Remove"?"text-rose-700":"text-slate-700"),caption);control.type="button";control.disabled=busy;control.addEventListener("click",handler);actions.append(control);
      }
      top.append(actions);
    }
    card.append(top);
    if(post.body)card.append(make("p","whitespace-pre-wrap break-words text-sm text-slate-700 mt-3 leading-6",post.body));
    if(post.linkUrl)try{const url=new URL(post.linkUrl);if(["http:","https:"].includes(url.protocol)){const link=make("a","inline-block mt-3 text-sm font-bold text-cyan-800 underline break-all","Open shared link ↗");link.href=url.href;link.target="_blank";link.rel="noopener noreferrer";card.append(link);}}catch{}
    host.append(card);
  }
}
function updateClassLinks(){
  const item=current(),offeringId=item?.offeringId||"";
  const query=offeringId?"&offeringId="+encodeURIComponent(offeringId):"";
  el("teacherClassroomSubmissionsLink").href="school-gradebook.html?view=submissions"+query;
  el("teacherClassroomGradesLink").href="school-gradebook.html?view=results"+query;
  el("teacherClassroomRecordLink").href=offeringId?"class-record.html?offering="+encodeURIComponent(offeringId):"class-record.html";
  el("teacherClassroomAssessmentLink").href=offeringId?"assessment-studio.html?offeringId="+encodeURIComponent(offeringId):"assessment-studio.html";
}
function renderClasswork(){
  const host=el("teacherClassroomClasswork");host.replaceChildren();
  if(classworkError){host.append(make("p","rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900",classworkError));return;}
  if(!loadedOffering){host.append(make("p","text-sm text-slate-500","Choose a classroom to load classwork."));return;}
  if(!classwork.length){host.append(make("p","rounded-lg bg-slate-50 border border-dashed border-slate-300 p-4 text-sm text-slate-600","No assessments have been deployed to this class yet."));return;}
  for(const item of classwork){
    const row=make("article","rounded-xl border border-slate-200 p-3");
    const top=make("div","flex items-start justify-between gap-3"),text=make("div","min-w-0");
    text.append(make("strong","block text-sm",item.title||"Assessment"));
    const state=item.lifecycle==="closed"?"Closed":item.published===true?"Visible to students":"Teacher draft";
    text.append(make("span","block text-xs text-slate-500 mt-1",[item.assessmentType,state,item.dueAt?"Due "+date(item.dueAt):""].filter(Boolean).join(" · ")));
    const link=make("a","shrink-0 text-xs font-bold text-indigo-700 underline","Review");link.href="school-gradebook.html?view=review&offeringId="+encodeURIComponent(item.offeringId)+"&assessment="+encodeURIComponent(item.taskId);
    top.append(text,link);row.append(top);host.append(row);
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
  students.forEach((row,index)=>{const li=make("li","flex items-center gap-3 px-3 py-2 text-sm");li.append(make("span","w-6 text-right text-slate-400",index+1),make("span","font-medium",row.name||"Student"));list.append(li);});
  host.append(list);
}
function beginEdit(post){if(busy||!canPost||editing)return;keepDraft();editing=post;fillComposer({kind:post.kind,title:post.title,body:post.body,link:post.linkUrl,pinned:post.pinned});syncControls();el("teacherClassroomTitle").focus();form.scrollIntoView({block:"nearest",behavior:"smooth"});}
async function loadPosts(){
  const item=current(),turn=++epoch;loadedOffering="";canPost=false;posts=[];classwork=[];rosterStudents=[];classworkError="";rosterError="";
  renderPosts();renderClasswork();renderRoster();updateClassLinks();syncControls();
  if(!item)return false;
  try{
    const results=await Promise.allSettled([
      scoped(streamApi,"list",{offeringId:item.offeringId}),
      scoped(assessmentApi,"list_teacher"),
      scoped(academicsApi,"class_roster",{offeringId:item.offeringId})
    ]);
    if(turn!==epoch||current()?.offeringId!==item.offeringId)return false;
    const streamResult=results[0];
    if(streamResult.status!=="fulfilled")throw streamResult.reason;
    posts=streamResult.value.posts||[];canPost=streamResult.value.canPost===true;loadedOffering=item.offeringId;
    if(results[1].status==="fulfilled"){
      classwork=(results[1].value.assessments||[]).filter(task=>task.offeringId===item.offeringId&&!["archived","cancelled"].includes(task.lifecycle)).sort((a,b)=>(a.dueAt||0)-(b.dueAt||0));
    }else classworkError="Classwork could not load. The classroom stream is still available.";
    if(results[2].status==="fulfilled")rosterStudents=results[2].value.students||[];
    else rosterError="Roster could not load. Official enrollment was not changed.";
    renderPosts();renderClasswork();renderRoster();updateClassLinks();syncControls();return true;
  }catch(error){
    if(turn===epoch){say(error?.message||"Classroom could not load.",true);renderPosts();renderClasswork();renderRoster();}
    return false;
  }
}
async function refresh(){
  if(!picker?.scope.current||busy)return;
  if(editing&&!confirm("Discard unsaved post edits and reload the classroom?"))return;
  keepDraft();editing=null;setBusy(true);say("Loading your assigned classrooms…");
  try{
    const result=await scoped(analyticsApi,"scope");
    offerings=result.offerings||[];const previous=select.value;select.replaceChildren();
    for(const item of offerings)select.add(new Option(label(item),item.offeringId));
    if(offerings.some(item=>item.offeringId===previous))select.value=previous;
    else if(initialOfferingId&&offerings.some(item=>item.offeringId===initialOfferingId))select.value=initialOfferingId;
    if(!offerings.length){loadedOffering="";canPost=false;posts=[];classwork=[];rosterStudents=[];renderPosts();renderClasswork();renderRoster();say("No active class is assigned to this teacher account.",true);return;}
    restoreDraft(select.value);if(await loadPosts())say("Classroom ready for "+label(current())+".");
  }catch(error){loadedOffering="";canPost=false;posts=[];classwork=[];rosterStudents=[];renderPosts();renderClasswork();renderRoster();say(error?.message||"Classroom could not load.",true);}
  finally{setBusy(false);}
}
async function writePost(action,details,success){
  if(busy||!canPost||!current()||loadedOffering!==current().offeringId)return false;
  const id=current().offeringId;setBusy(true);say("Saving classroom post…");
  try{await scoped(streamApi,action,{offeringId:id,...details});
    if(action==="create"||action==="update"&&editing){if(action==="create")dropDraft(id);restoreDraft(id);}
    const refreshed=await loadPosts();say(success+(refreshed?"":" The change was saved, but the stream could not refresh. Select Refresh."),!refreshed);return true;
  }catch(error){say(error?.message||"Classroom post could not be saved.",true);return false;}
  finally{setBusy(false);}
}
async function archivePost(post){if(busy||editing||!confirm("Remove this classroom post? It will no longer appear in the student stream."))return;await writePost("archive",{postId:post.postId},"Classroom post removed.");}
async function changePin(post){if(busy||editing)return;await writePost("update",{postId:post.postId,title:post.title,body:post.body,linkUrl:post.linkUrl,pinned:!post.pinned},post.pinned?"Post unpinned.":"Post pinned.");}
form.addEventListener("input",keepDraft);
form.addEventListener("submit",event=>{
  event.preventDefault();if(busy||!canPost||!current())return;
  const data=readComposer(),title=data.title.trim(),body=data.body.trim();if(!title&&!body){say("Write a title or message before publishing.",true);el("teacherClassroomBody").focus();return;}
  const action=editing?"update":"create",details={kind:data.kind,title,body,linkUrl:data.link.trim(),pinned:data.pinned,...(editing?{postId:editing.postId}:{})};
  void writePost(action,details,editing?"Classroom post updated.":"Published to "+label(current())+". Students can now see it in their subject stream.");
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
  keepDraft();++epoch;offerings=[];posts=[];classwork=[];rosterStudents=[];loadedOffering="";canPost=false;composerOffering="";classworkError="";rosterError="";select.replaceChildren();fillComposer();renderPosts();renderClasswork();renderRoster();updateClassLinks();syncControls();
},onReady:scope=>{if(scope.current?.roles.includes("teacher"))void refresh();else say("Teacher access is required.",true);}});
renderClasswork();renderRoster();updateClassLinks();syncControls();
await auth.authStateReady();
try{const state=await picker.load();if(!auth.currentUser)say("Sign in with a verified teacher account.",true);else if(state?.state==="choose_school")say("Choose the school whose classroom stream you want to manage.");}catch(error){say(error?.message||"Verified school access is unavailable.",true);}
