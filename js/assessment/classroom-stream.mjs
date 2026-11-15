import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const functions=getFunctions(app,"asia-southeast1");
const analyticsApi=httpsCallable(functions,"schoolTeacherAnalytics");
const streamApi=httpsCallable(functions,"schoolClassroomStream");
const el=id=>document.getElementById(id);
let picker=null,offerings=[],busy=false,epoch=0;

function make(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
function date(value){return value?new Date(value).toLocaleString():"";}
function label(item){return [item.subject,item.section,item.term,item.year].filter(Boolean).join(" · ");}
function current(){return offerings.find(item=>item.offeringId===el("teacherClassroomOffering").value)||null;}
function say(message,error=false){
  el("teacherClassroomStatus").textContent=message;
  el("teacherClassroomStatus").className="text-sm mt-3 "+(error?"text-rose-700":"text-slate-600");
}
function setBusy(value){
  busy=value;
  for(const id of ["teacherClassroomOffering","teacherClassroomRefresh","teacherClassroomPublish"])el(id).disabled=value;
}
async function scoped(api,action,details={}){
  const lease=picker.scope.lease(),result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);return result;
}
function renderPosts(posts){
  const host=el("teacherClassroomPosts");host.replaceChildren();
  if(!posts.length){host.append(make("div","rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600","No teacher posts yet. Publish the first classroom announcement from the composer."));return;}
  for(const post of posts){
    const card=make("article","rounded-2xl border bg-white shadow-sm p-4 sm:p-5 "+(post.pinned?"border-cyan-300":"border-slate-200"));
    const top=make("div","flex items-start justify-between gap-3"),identity=make("div","min-w-0");
    identity.append(make("p","text-xs uppercase tracking-wider font-bold "+(post.pinned?"text-cyan-800":"text-slate-500"),
      post.pinned?"Pinned "+post.kind:post.kind),make("h3","text-lg font-extrabold mt-1",post.title||"Classroom update"),
      make("p","text-xs text-slate-500 mt-1",(post.authorName||"Teacher")+" · "+date(post.createdAt)));
    const remove=make("button","rounded-lg border border-rose-200 text-rose-700 px-3 py-2 text-xs font-bold","Remove");remove.type="button";
    remove.addEventListener("click",()=>void archivePost(post.postId));top.append(identity,remove);card.append(top);
    if(post.body)card.append(make("p","whitespace-pre-wrap text-sm text-slate-700 mt-3 leading-6",post.body));
    if(post.linkUrl){const link=make("a","inline-block mt-3 text-sm font-bold text-cyan-800 underline","Open shared link ↗");link.href=post.linkUrl;link.target="_blank";link.rel="noopener noreferrer";card.append(link);}
    host.append(card);
  }
}
async function loadPosts(){
  const item=current();if(!item)return;
  const result=await scoped(streamApi,"list",{offeringId:item.offeringId});renderPosts(result.posts||[]);
}
async function refresh(){
  if(!picker?.scope.current||busy)return;
  const turn=++epoch;setBusy(true);say("Loading your assigned classrooms…");
  try{
    const scope=await scoped(analyticsApi,"scope");if(turn!==epoch)return;
    offerings=scope.offerings||[];const select=el("teacherClassroomOffering"),previous=select.value;select.replaceChildren();
    for(const item of offerings)select.add(new Option(label(item),item.offeringId));
    if(offerings.some(item=>item.offeringId===previous))select.value=previous;
    if(!offerings.length){say("No active course offering is assigned to this teacher account.",true);renderPosts([]);return;}
    await loadPosts();if(turn===epoch)say("Classroom stream ready for "+label(current())+".");
  }catch(error){if(turn===epoch)say(error?.message||"Classroom stream could not load.",true);}
  finally{if(turn===epoch)setBusy(false);}
}
async function archivePost(postId){
  if(busy||!current())return;
  setBusy(true);say("Removing classroom post…");
  try{await scoped(streamApi,"archive",{offeringId:current().offeringId,postId});await loadPosts();say("Classroom post removed.");}
  catch(error){say(error?.message||"Classroom post could not be removed.",true);}
  finally{setBusy(false);}
}
el("teacherClassroomForm").addEventListener("submit",async event=>{
  event.preventDefault();const item=current();if(!item||busy)return;
  const title=el("teacherClassroomTitle").value.trim(),body=el("teacherClassroomBody").value.trim();
  if(!title&&!body){say("Write a title or message before publishing.",true);el("teacherClassroomBody").focus();return;}
  setBusy(true);say("Publishing classroom post…");
  try{
    await scoped(streamApi,"create",{offeringId:item.offeringId,kind:el("teacherClassroomKind").value,title,body,
      linkUrl:el("teacherClassroomLink").value.trim(),pinned:el("teacherClassroomPinned").checked});
    event.target.reset();await loadPosts();say("Published to "+label(item)+". Students can now see it in their subject stream.");
  }catch(error){say(error?.message||"Classroom post could not be published.",true);}
  finally{setBusy(false);}
});
el("teacherClassroomOffering").addEventListener("change",()=>void loadPosts().catch(error=>say(error?.message||"Classroom posts could not load.",true)));
el("teacherClassroomRefresh").addEventListener("click",()=>void refresh());

picker=createTenantSchoolPicker({
  host:el("teacherClassroomSchoolSwitcher"),status:null,
  onBeforeChange:async()=>{if(busy)throw new Error("Finish the current classroom action before switching schools.");++epoch;offerings=[];renderPosts([]);},
  onReady:scope=>{if(scope.current)void refresh();}
});
await auth.authStateReady();
try{
  const state=await picker.load();
  if(!auth.currentUser)say("Sign in with a verified teacher account.",true);
  else if(state?.state==="choose_school")say("Choose the school whose classroom stream you want to manage.");
}catch(error){say(error?.message||"Verified school access is unavailable.",true);}
