import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";
import {authorizeGithubSession,getGithubSession} from "./github-session.mjs?v=9dc90ac0f1c0";

const functions=getFunctions(app,"asia-southeast1");
const profileApi=httpsCallable(functions,"schoolStudentProfile");
const assessmentApi=httpsCallable(functions,"schoolAssessments");
const gradeApi=httpsCallable(functions,"schoolGradebook");
const studioApi=httpsCallable(functions,"schoolStudioProjects");
const el=id=>document.getElementById(id);
let profile=null,assignments=[],grades=new Map(),studioProjects=[],busy=false,epoch=0,repositoryEpoch=0,studioLimit=12,availability={};
const projectParams=new URLSearchParams(location.search);
const requestedOfferingId=projectParams.get("offeringId")||"";
const requestedSubjectId=projectParams.get("subjectId")||"";

function make(tag,className,text){
  const node=document.createElement(tag);if(className)node.className=className;
  if(text!==undefined)node.textContent=String(text);return node;
}
function say(message,error=false){
  el("projectHubStatus").textContent=message;
  el("projectHubStatus").className="text-sm mt-3 "+(error?"text-rose-700":"text-slate-600");
}
function setBusy(value){
  busy=value;el("projectHubRefresh").disabled=value;el("projectHubClass").disabled=value;
  el("projectHubGithubConnect").disabled=value;
}
async function scoped(api,action,details={}){
  const lease=picker.scope.lease();
  const result=(await api({schoolId:lease.schoolId,action,...details})).data;
  picker.scope.assertLease(lease);return result;
}
function classLabel(item){return [item.section,item.subject,item.term,item.year].filter(Boolean).join(" · ");}
function selectedClass(){return profile?.classes?.find(item=>item.offeringId===el("projectHubClass").value)||null;}
function stat(value,label,detail=""){
  const card=make("div","rounded-xl border bg-slate-50 p-3");
  card.append(make("strong","block text-xl font-extrabold",value),
    make("span","block text-xs font-bold text-slate-600 mt-1",label));
  if(detail)card.append(make("span","block text-[11px] text-slate-500 mt-1",detail));
  return card;
}
function renderSelector(){
  const select=el("projectHubClass"),previous=select.value;select.replaceChildren();
  for(const item of profile?.classes||[])select.add(new Option(classLabel(item),item.offeringId));
  if((profile?.classes||[]).some(item=>item.offeringId===previous))select.value=previous;
  else if(requestedOfferingId&&(profile?.classes||[]).some(item=>item.offeringId===requestedOfferingId))select.value=requestedOfferingId;
  else if(requestedSubjectId){
    const match=(profile?.classes||[]).find(item=>item.subjectId===requestedSubjectId);
    if(match)select.value=match.offeringId;else if(select.options.length)select.selectedIndex=0;
  }else if(select.options.length)select.selectedIndex=0;
}
function renderStudio(){
  const host=el("projectHubStudio");host.replaceChildren();
  const filter=el("projectHubStudioSearch").value.trim().toLocaleLowerCase();
  const rows=studioProjects.filter(project=>[project.title,project.language].some(value=>String(value||"").toLocaleLowerCase().includes(filter)));
  el("projectHubStudioMore").hidden=rows.length<=studioLimit;
  el("projectHubStudioCount").textContent=availability.studio?"Showing "+Math.min(rows.length,studioLimit)+" of "+rows.length+" matching projects":"";
  if(!availability.studio){host.append(make("p","sm:col-span-2 rounded-xl border border-dashed p-4 text-sm text-slate-600","School project list unavailable. You can still open Studio to access your device drafts and retry cloud sync."));return;}
  if(!rows.length){
    host.append(make("p","sm:col-span-2 rounded-xl border border-dashed p-4 text-sm text-slate-500",
      filter?"No projects match your search.":"No school-synced Studio projects yet. Open Adminerva Studio to create or sync one."));
    return;
  }
  for(const project of rows.slice(0,studioLimit)){
    const card=make("article","rounded-xl border p-3");
    card.append(make("strong","block text-sm",project.title||"Studio project"),
      make("span","block text-xs text-slate-500 mt-1",
        (project.language||"code")+" · revision "+(project.revision||1)+
        (project.updatedAt?" · "+new Date(project.updatedAt).toLocaleString():"")));
    const link=make("a","inline-block mt-3 text-xs font-bold text-indigo-700 underline","Open Studio →");
    link.href="student-playground.html?codeProject="+encodeURIComponent(project.projectId);card.append(link);host.append(card);
  }
}
function renderAssignments(){
  const host=el("projectHubAssignments");host.replaceChildren();
  if(!availability.assignments){host.append(make("p","rounded-xl border border-dashed p-3 text-sm text-slate-600","Assignments are unavailable. Retry or open My Assessments directly."));return;}
  const current=selectedClass(),params=new URLSearchParams();
  if(current?.subjectId)params.set("subjectId",current.subjectId);
  if(current?.subject)params.set("subject",current.subject);
  if(current?.offeringId)params.set("offeringId",current.offeringId);
  const assignmentHref="student-assessments.html"+(params.toString()?"?"+params.toString():"");
  const allLink=el("projectHubAllAssignments");if(allLink)allLink.href=assignmentHref;
  const rows=assignments.filter(task=>!current||task.offeringId===current.offeringId)
    .sort((a,b)=>(a.dueAt||0)-(b.dueAt||0));
  if(!rows.length){
    host.append(make("p","rounded-xl border border-dashed p-3 text-sm text-slate-500",
      "No active verified-school assignments for this course offering."));
    return;
  }
  for(const task of rows.slice(0,8)){
    const grade=grades.get(task.taskId),card=make("article","rounded-xl border p-3");
    card.append(make("strong","block text-sm",task.title),
      make("span","block text-xs text-slate-500 mt-1",
        (task.submissionSource==="github"?"GitHub evidence":"Adminerva Studio")+" · "+
        (task.dueAt?"due "+new Date(task.dueAt).toLocaleString():"No deadline provided")));
    if(grade)card.append(make("span","inline-block mt-2 rounded-full bg-emerald-100 text-emerald-800 px-2 py-1 text-xs font-bold",
      "Published "+grade.awarded+" / "+grade.total));
    const link=make("a","inline-block mt-3 text-xs font-bold text-cyan-800 underline","Open assignment →");
    link.href=assignmentHref+"#"+encodeURIComponent(task.taskId);card.append(link);host.append(card);
  }
}
async function githubJson(url){
  const {token}=getGithubSession(),headers={Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
  if(token)headers.Authorization="Bearer "+token;
  const response=await fetch(url,{headers});
  if(response.status===404&&!token)
    throw new Error("Repository is private or unavailable. Connect GitHub in Settings or authorize it here for this browser session.");
  if(response.status===401||response.status===403)
    throw new Error("GitHub session authorization expired or lacks repository permission. Reconnect GitHub in Settings.");
  if(!response.ok)throw new Error("GitHub returned HTTP "+response.status+".");
  return response.json();
}
async function loadRepositoryActivity(){
  const run=++repositoryEpoch, schoolEpoch=epoch, uid=auth.currentUser?.uid;
  const current=selectedClass(),host=el("projectHubCommits"),summary=el("projectHubActivitySummary"),
    link=el("projectHubRepositoryLink");
  const stillCurrent=()=>run===repositoryEpoch&&schoolEpoch===epoch&&auth.currentUser?.uid===uid&&selectedClass()?.offeringId===current?.offeringId;
  host.replaceChildren();summary.replaceChildren();link.hidden=true;
  el("projectHubRepositoryTitle").textContent="Repository activity";el("projectHubRepositoryMeta").textContent="";
  if(!availability.profile){host.append(make("p","p-5 text-sm text-slate-600","Course and repository configuration is unavailable."));return;}
  if(!current){
    host.append(make("p","p-5 text-sm text-slate-500","No active course offering is available."));
    return;
  }
  el("projectHubRepositoryTitle").textContent=current.subject+" · repository activity";
  if(!current.repository){
    el("projectHubRepositoryMeta").textContent="No repository configured for this course offering.";
    summary.append(stat("—","Repository"),stat("—","Recent commits"),stat("—","Last activity"));
    const blank=make("div","p-5");
    blank.append(make("p","text-sm text-slate-600","Save a repository in Student Settings before loading GitHub activity."));
    const settings=make("a","inline-block mt-3 rounded-lg bg-cyan-800 text-white px-4 py-2 text-sm font-bold","Configure repository");
    settings.href="school-student-settings.html";blank.append(settings);host.append(blank);return;
  }
  el("projectHubRepositoryMeta").textContent=current.repository+
    (current.githubUsername?" · configured GitHub user: "+current.githubUsername:"");
  link.href=current.repositoryUrl||("https://github.com/"+current.repository);link.hidden=false;
  host.append(make("p","p-5 text-sm text-slate-500","Loading recent GitHub activity…"));
  try{
    const rows=await githubJson("https://api.github.com/repos/"+encodeURI(current.repository)+"/commits?per_page=50");
    if(!stillCurrent())return;
    host.replaceChildren();summary.replaceChildren();
    const commits=Array.isArray(rows)?rows:[],login=String(current.githubUsername||"").toLowerCase(),
      matched=login?commits.filter(item=>String(item.author?.login||"").toLowerCase()===login).length:0,
      latest=commits[0]?.commit?.author?.date||commits[0]?.commit?.committer?.date||null;
    summary.append(
      stat(current.repository.split("/").at(-1),"Repository","school-saved configuration"),
      stat(String(commits.length),"Recent commits","first 50 returned by GitHub"),
      stat(latest?new Date(latest).toLocaleDateString():"—","Last activity",
        login?matched+" returned commit(s) match configured GitHub login":"No username filter configured")
    );
    if(!commits.length){
      host.append(make("p","p-5 text-sm text-slate-500","GitHub returned no recent commits."));
      return;
    }
    for(const commit of commits.slice(0,12)){
      const row=make("article","p-4 sm:p-5");
      const top=make("div","flex gap-3 justify-between items-start");
      const identity=make("div","min-w-0");
      identity.append(make("strong","block text-sm break-words",
        String(commit.commit?.message||"Commit").split("\n")[0].slice(0,180)),
        make("span","block text-xs text-slate-500 mt-1",
          String(commit.sha||"").slice(0,12)+" · "+
          (commit.author?.login||commit.commit?.author?.name||"Git author")+" · "+
          (commit.commit?.author?.date?new Date(commit.commit.author.date).toLocaleString():"date unavailable")));
      const open=make("a","text-xs font-bold text-cyan-800 underline shrink-0","Open ↗");
      open.href=commit.html_url;open.target="_blank";open.rel="noopener noreferrer";top.append(identity,open);row.append(top);
      host.append(row);
    }
  }catch(error){
    if(!stillCurrent())return;
    host.replaceChildren(make("p","p-5 text-sm text-rose-700",error.message));
    summary.replaceChildren(stat(current.repository.split("/").at(-1),"Repository"),
      stat("Unavailable","Recent commits"),stat("—","Last activity"));
  }
}
function renderGithubSession(){
  const session=getGithubSession();
  el("projectHubGithubSession").textContent=session.active
    ?"GitHub session active"+(session.username?" as @"+session.username:"")+". The OAuth credential remains in this browser tab and is not stored in the school profile."
    :"Private GitHub authorization is not active. Connect GitHub in Settings or authorize it here when a private repository needs access.";
}
async function authorizeGithub(){
  if(busy)return;
  setBusy(true);say("Connecting GitHub for this browser session…");
  try{
    const session=await authorizeGithubSession();
    renderGithubSession();
    say("GitHub connected"+(session.username?" as @"+session.username:"")+". No OAuth token was written to school Firestore.");
    await loadRepositoryActivity();
  }catch(error){
    renderGithubSession();
    say(error?.message||"GitHub authorization did not finish.",true);
  }finally{setBusy(false);}
}
async function refresh(){
  const sequence=++epoch;repositoryEpoch++;setBusy(true);say("Loading school projects and coursework…");
  const lease=picker.scope.lease();
  const current=()=>sequence===epoch&&auth.currentUser?.uid===lease.uid;
  try{
    const sources=[
      ["profile","course configuration",profileApi,"my_profile"],
      ["assignments","assignments",assessmentApi,"list_student"],
      ["grades","published grades",gradeApi,"my_published"],
      ["studio","Studio projects",studioApi,"list"]
    ];
    const failed=[];
    availability={};
    profile=null;assignments=[];grades=new Map();studioProjects=[];
    el("projectHubWorkspace").hidden=false;
    el("projectHubStudio").replaceChildren(make("p","text-sm text-slate-500","Loading cloud projects…"));
    el("projectHubAssignments").replaceChildren(make("p","text-sm text-slate-500","Loading assignments…"));
    el("projectHubCommits").replaceChildren(make("p","p-5 text-sm text-slate-500","Loading course configuration…"));
    el("projectHubActivitySummary").replaceChildren();el("projectHubRepositoryLink").hidden=true;
    await Promise.all(sources.map(async ([name,label,api,action])=>{
      try{
        const result=await scoped(api,action);
        if(!current())return;
        availability[name]=true;
        if(name==="profile"){profile=result;renderSelector();renderAssignments();void loadRepositoryActivity();}
        if(name==="assignments"){assignments=result.assignments||[];renderAssignments();}
        if(name==="grades"){grades=new Map((result.grades||[]).map(item=>[item.taskId,item]));renderAssignments();}
        if(name==="studio"){studioProjects=(result.projects||[]).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));renderStudio();}
      }catch(error){
        if(!current())return;
        failed.push(label);availability[name]=false;
        if(name==="profile"){renderSelector();void loadRepositoryActivity();}
        if(name==="assignments")renderAssignments();
        if(name==="studio")renderStudio();
        console.warn("Project Hub source unavailable",name,error);
      }
    }));
    if(current())say(failed.length?"Unavailable: "+failed.join(", ")+". Other project tools remain usable.":"Project Hub loaded from verified school records.",failed.length>0);
  }catch(error){if(current())say(error?.message||"Project Hub could not load.",true);}
  finally{if(current())setBusy(false);}
}
renderGithubSession();
document.addEventListener("adminerva:github-session",renderGithubSession);

const picker=createTenantSchoolPicker({
  host:el("projectHubSchoolSwitcher"),status:el("projectHubStatus"),
  onBeforeChange:async()=>{
    if(busy)throw new Error("Finish the current Project Hub operation before switching schools.");
    ++epoch;++repositoryEpoch;profile=null;assignments=[];grades=new Map();studioProjects=[];availability={};sessionGithubToken="";
    el("projectHubWorkspace").hidden=true;
  },
  onReady:scope=>{if(scope.current)void refresh();}
});
el("projectHubClass").addEventListener("change",()=>{
  renderAssignments();void loadRepositoryActivity();
});
el("projectHubRefresh").addEventListener("click",()=>void refresh());
el("projectHubStudioSearch").addEventListener("input",()=>{studioLimit=12;renderStudio();});
el("projectHubStudioMore").addEventListener("click",()=>{studioLimit+=12;renderStudio();});
el("projectHubGithubConnect").addEventListener("click",()=>void authorizeGithub());
window.addEventListener("beforeunload",()=>{sessionGithubToken="";});
try{
  await picker.load();
  if(!auth.currentUser)say("Sign in with a verified school student account.",true);
}catch(error){say(error?.message||"Unable to load verified school Project Hub.",true);}
