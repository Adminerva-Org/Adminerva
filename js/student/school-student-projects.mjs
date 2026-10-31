import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {GithubAuthProvider,linkWithPopup,reauthenticateWithPopup} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const functions=getFunctions(app,"asia-southeast1");
const profileApi=httpsCallable(functions,"schoolStudentProfile");
const assessmentApi=httpsCallable(functions,"schoolAssessments");
const gradeApi=httpsCallable(functions,"schoolGradebook");
const studioApi=httpsCallable(functions,"schoolStudioProjects");
const el=id=>document.getElementById(id);
let profile=null,assignments=[],grades=new Map(),studioProjects=[],sessionGithubToken="",busy=false,epoch=0;

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
  else if(select.options.length)select.selectedIndex=0;
}
function renderStudio(){
  const host=el("projectHubStudio");host.replaceChildren();
  if(!studioProjects.length){
    host.append(make("p","sm:col-span-2 rounded-xl border border-dashed p-4 text-sm text-slate-500",
      "No school-synced Studio projects yet. Open Adminerva Studio to create or sync one."));
    return;
  }
  for(const project of studioProjects.slice(0,8)){
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
  const current=selectedClass(),rows=assignments.filter(task=>!current||task.offeringId===current.offeringId)
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
        (task.submissionSource==="github"?"GitHub evidence":"Adminerva Studio")+" · due "+
        new Date(task.dueAt).toLocaleString()));
    if(grade)card.append(make("span","inline-block mt-2 rounded-full bg-emerald-100 text-emerald-800 px-2 py-1 text-xs font-bold",
      "Published "+grade.awarded+" / "+grade.total));
    const link=make("a","inline-block mt-3 text-xs font-bold text-cyan-800 underline","Open assignment →");
    link.href="student-assessments.html#"+encodeURIComponent(task.taskId);card.append(link);host.append(card);
  }
}
async function githubJson(url){
  const headers={Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
  if(sessionGithubToken)headers.Authorization="Bearer "+sessionGithubToken;
  const response=await fetch(url,{headers});
  if(response.status===404&&!sessionGithubToken)
    throw new Error("Repository is private or unavailable. Authorize GitHub for this session if you have access.");
  if(response.status===401||response.status===403)
    throw new Error("GitHub session authorization expired or lacks repository permission.");
  if(!response.ok)throw new Error("GitHub returned HTTP "+response.status+".");
  return response.json();
}
async function loadRepositoryActivity(){
  const current=selectedClass(),host=el("projectHubCommits"),summary=el("projectHubActivitySummary"),
    link=el("projectHubRepositoryLink");
  host.replaceChildren();summary.replaceChildren();link.hidden=true;
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
    host.replaceChildren();summary.replaceChildren();
    const commits=Array.isArray(rows)?rows:[],login=current.githubUsername.toLowerCase(),
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
    host.replaceChildren(make("p","p-5 text-sm text-rose-700",error.message));
    summary.replaceChildren(stat(current.repository.split("/").at(-1),"Repository"),
      stat("Unavailable","Recent commits"),stat("—","Last activity"));
  }
}
async function authorizeGithub(){
  if(busy)return;
  const user=auth.currentUser;if(!user)return;
  const provider=new GithubAuthProvider();provider.addScope("repo");provider.addScope("read:user");
  setBusy(true);say("Authorizing GitHub for this browser session…");
  try{
    const linked=user.providerData.some(item=>item.providerId==="github.com");
    const result=linked?await reauthenticateWithPopup(user,provider):await linkWithPopup(user,provider);
    if(auth.currentUser?.uid!==user.uid)throw new Error("Adminerva account changed during GitHub authorization.");
    const credential=GithubAuthProvider.credentialFromResult(result);
    if(!credential?.accessToken)throw new Error("GitHub did not return a usable session credential.");
    sessionGithubToken=credential.accessToken;
    el("projectHubGithubSession").textContent="Private GitHub access is authorized for this page session only. Reloading or signing out discards the token.";
    say("GitHub authorized for this session. No OAuth token was written to school Firestore.");
    await loadRepositoryActivity();
  }catch(error){
    if(error?.code==="auth/credential-already-in-use")
      say("This GitHub identity is linked to another Adminerva sign-in. No school profile was changed.",true);
    else say(error?.message||"GitHub authorization did not finish.",true);
  }finally{setBusy(false);}
}
async function refresh(){
  const sequence=++epoch;setBusy(true);say("Loading canonical Project Hub…");
  try{
    const [profileResult,assignmentResult,gradeResult,studioResult]=await Promise.all([
      scoped(profileApi,"my_profile"),scoped(assessmentApi,"list_student"),
      scoped(gradeApi,"my_published"),scoped(studioApi,"list")
    ]);
    if(sequence!==epoch)return;
    profile=profileResult;assignments=assignmentResult.assignments||[];
    grades=new Map((gradeResult.grades||[]).map(item=>[item.taskId,item]));
    studioProjects=(studioResult.projects||[]).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    renderSelector();renderStudio();renderAssignments();el("projectHubWorkspace").hidden=false;
    await loadRepositoryActivity();
    if(sequence===epoch)say("Project Hub loaded from verified school records.");
  }catch(error){if(sequence===epoch)say(error?.message||"Project Hub could not load.",true);}
  finally{if(sequence===epoch)setBusy(false);}
}
const picker=createTenantSchoolPicker({
  host:el("projectHubSchoolSwitcher"),status:el("projectHubStatus"),
  onBeforeChange:async()=>{
    if(busy)throw new Error("Finish the current Project Hub operation before switching schools.");
    ++epoch;profile=null;assignments=[];grades=new Map();studioProjects=[];
    el("projectHubWorkspace").hidden=true;
  },
  onReady:scope=>{if(scope.current)void refresh();}
});
el("projectHubClass").addEventListener("change",()=>{
  renderAssignments();void loadRepositoryActivity();
});
el("projectHubRefresh").addEventListener("click",()=>void refresh());
el("projectHubGithubConnect").addEventListener("click",()=>void authorizeGithub());
window.addEventListener("beforeunload",()=>{sessionGithubToken="";});
try{
  await picker.load();
  if(!auth.currentUser)say("Sign in with a verified school student account.",true);
}catch(error){say(error?.message||"Unable to load verified school Project Hub.",true);}
