import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";
import {createGithubEvidenceClient,parseGithubRepository} from "../repo-review/services/github-evidence-client.mjs?v=1.3.0";
import {activateConnectionOwner} from "../core/connection-cache.mjs?v=1.3.0";

const panel=document.getElementById("v4AssignmentsPanel");
const list=document.getElementById("v4AssignmentsList");
const status=document.getElementById("v4AssignmentsStatus");
const schoolHost=document.getElementById("v4AssignmentsSchoolSwitcher");

function node(tag,className,text){
  const item=document.createElement(tag);
  if(className)item.className=className;
  if(text!==undefined)item.textContent=String(text);
  return item;
}
function date(value){return value?new Date(value).toLocaleString():"—";}
if(panel&&list&&status&&schoolHost){
  const functions=getFunctions(app,"asia-southeast1");
  const assessmentsApi=httpsCallable(functions,"schoolAssessments");
  const submissionsApi=httpsCallable(functions,"schoolStudioSubmissions");
  const gradebookApi=httpsCallable(functions,"schoolGradebook");
  const githubEvidenceApi=httpsCallable(functions,"schoolGithubEvidence");
  let renderGeneration=0,picker=null,githubTask=null,githubTaskStatus=null;
  let githubCommits=[],githubSelected=new Set(),githubCheckpoint="",githubBusy=false;
  async function scoped(scope,api,action,details={}){
    const lease=scope.lease();
    const result=(await api({schoolId:lease.schoolId,action,...details})).data;
    scope.assertLease(lease);
    return result;
  }
  function assignmentState(task,submission,grade){
    if(grade)return {label:"Graded",className:"bg-emerald-100 text-emerald-800"};
    if(submission?.status==="reopened"){
      const due=Number(submission.revisionDueAt||0);
      return {label:due>Date.now()?"Revision requested":"Revision extension expired",
        className:"bg-amber-100 text-amber-900"};
    }
    if(submission?.submitted)return {
      label:submission.status==="reviewed"?"Reviewed":
        submission.status==="approved"?"Evidence approved":"Submitted",
      className:"bg-blue-100 text-blue-800"
    };
    if(task.windowStatus==="upcoming")return {label:"Upcoming",className:"bg-slate-100 text-slate-700"};
    if(task.windowStatus==="closed")return {label:"Past due",className:"bg-rose-100 text-rose-800"};
    return {label:"Ready to work",className:"bg-indigo-100 text-indigo-800"};
  }
  function appendDetails(article,title,body){
    if(!body)return;
    const details=node("details","mt-3 text-sm");
    const summary=node("summary","font-bold cursor-pointer",title);
    const content=node("p","whitespace-pre-wrap mt-2 text-slate-700",body);
    details.append(summary,content);article.append(details);
  }
  async function render(scope){
    const generation=++renderGeneration;
    panel.classList.remove("hidden");
    status.textContent="Loading verified school assignments…";
    list.replaceChildren();
    try{
      const results=await Promise.all([
        scoped(scope,assessmentsApi,"list_student"),
        scoped(scope,gradebookApi,"my_published")
      ]);
      if(generation!==renderGeneration)return;
      const tasks=results[0].assignments||[];
      const grades=new Map((results[1].grades||[]).map(item=>[item.taskId,item]));
      const statuses=new Map();
      await Promise.all(tasks.map(async task=>{
        try{
          const api=task.submissionSource==="github"?githubEvidenceApi:submissionsApi;
          statuses.set(task.taskId,await scoped(scope,api,"my_status",{taskId:task.taskId}));
        }catch(error){
          statuses.set(task.taskId,{error:error?.message||"Status unavailable"});
        }
      }));
      if(generation!==renderGeneration)return;
      if(!tasks.length){
        status.textContent="No verified school assignments are currently deployed to your active enrollments.";
        list.append(node("div","rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600",
          "Your legacy pilot assignments remain available below during migration."));
        return;
      }
      status.textContent=tasks.length+" verified school assignment"+(tasks.length===1?"":"s")+" loaded.";
      for(const task of tasks){
        const submission=statuses.get(task.taskId),grade=grades.get(task.taskId);
        const state=assignmentState(task,submission,grade);
        const article=node("article","rounded-xl border border-slate-200 bg-white p-4 shadow-sm");
        const top=node("div","flex flex-col sm:flex-row sm:justify-between gap-3");
        const identity=node("div","min-w-0");
        identity.append(
          node("h3","font-extrabold text-slate-900",task.title),
          node("p","text-xs text-slate-500 mt-1",
            "Due "+date(task.dueAt)+" · "+(task.submissionSource==="studio"?"Adminerva Studio":"GitHub evidence"))
        );
        const badge=node("span","self-start rounded-full px-3 py-1 text-xs font-bold "+state.className,state.label);
        top.append(identity,badge);article.append(top);
        if(task.description)article.append(node("p","text-sm text-slate-700 mt-3",task.description));
        appendDetails(article,"Instructions",task.instructions||"");
        if(Array.isArray(task.rubric)&&task.rubric.length){
          const rubric=node("details","mt-2 text-sm");
          rubric.append(node("summary","font-bold cursor-pointer","Rubric · "+task.rubricMax+" pts"));
          const rows=node("div","mt-2 text-slate-700 space-y-1");
          for(const row of task.rubric)rows.append(node("p","",row.name+" · "+row.points+" pts"));
          rubric.append(rows);article.append(rubric);
        }
        if(submission?.requestMessage){
          const request=node("div","mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950");
          request.append(node("strong","","Teacher revision request"),
            node("p","mt-1 whitespace-pre-wrap",submission.requestMessage));
          if(submission.revisionDueAt)request.append(node("p","text-xs mt-2","Extension deadline: "+date(submission.revisionDueAt)));
          article.append(request);
        }
        if(grade){
          const result=node("div","mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950");
          result.append(node("strong","","Published grade: "+grade.awarded+" / "+grade.total));
          if(Array.isArray(grade.criteria)&&grade.criteria.length)
            result.append(node("p","text-xs mt-1",grade.criteria.map(item=>
              item.name+": "+item.awardedPoints+"/"+item.maximum).join(" · ")));
          if(grade.feedback)result.append(node("p","mt-2 whitespace-pre-wrap",grade.feedback));
          article.append(result);
        }
        const actions=node("div","mt-4 flex flex-wrap gap-2");
        if(task.submissionSource==="studio"){
          const link=node("a","rounded-lg bg-indigo-700 text-white px-4 py-2.5 text-sm font-bold",
            submission?.status==="reopened"?"Open Studio to revise":"Open Adminerva Studio");
          link.href="student-playground.html?assessment="+encodeURIComponent(task.taskId);
          actions.append(link);
        }else if(task.submissionSource==="github"){
          const canEdit=!submission?.submitted||submission.status==="reopened";
          const evidenceButton=node("button",
            "rounded-lg px-4 py-2.5 text-sm font-bold "+(canEdit?"bg-indigo-700 text-white":"border border-slate-300 text-slate-600"),
            canEdit?(submission?.status==="reopened"?"Revise GitHub evidence":"Select GitHub evidence"):
              submission?.status==="approved"?"Evidence approved":"Evidence submitted");
          evidenceButton.type="button";evidenceButton.disabled=!canEdit;
          if(canEdit)evidenceButton.addEventListener("click",()=>void openGithubEvidence(task,submission));
          actions.append(evidenceButton);
          if(submission?.repository){
            const repoLink=node("a","rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700","Open repository ↗");
            repoLink.href="https://github.com/"+submission.repository;repoLink.target="_blank";repoLink.rel="noopener noreferrer";
            actions.append(repoLink);
          }
        }
        if(actions.children.length)article.append(actions);
        list.append(article);
      }
    }catch(error){
      if(generation!==renderGeneration)return;
      status.textContent="Verified school assignments are temporarily unavailable: "+(error?.message||"retry later");
      list.append(node("p","text-xs text-slate-500",
        "Your existing pilot assignment list below remains unchanged."));
    }
  }
  const ghDialog=document.getElementById("v4GithubEvidenceDialog");
  const ghRepository=document.getElementById("v4GithubRepository");
  const ghList=document.getElementById("v4GithubCommitList");
  const ghStatus=document.getElementById("v4GithubEvidenceStatus");
  const ghSelectedCount=document.getElementById("v4GithubSelectedCount");
  const ghCheckpoint=document.getElementById("v4GithubCheckpoint");
  const ghSubmit=document.getElementById("v4GithubEvidenceSubmit");
  function renderGithubCommits(){
    ghList.replaceChildren();
    ghSelectedCount.textContent=githubSelected.size+" selected";
    ghCheckpoint.textContent=githubCheckpoint||"No checkpoint selected";
    if(!githubCommits.length){
      ghList.append(node("p","rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600",
        "Load the repository commit history to choose evidence."));
      return;
    }
    for(const commit of githubCommits){
      const full=String(commit.sha||"").toLowerCase();
      if(!/^[a-f0-9]{40}$/.test(full))continue;
      const row=node("article","rounded-xl border border-slate-200 p-3");
      const controls=node("div","flex flex-wrap items-center gap-3");
      const include=node("label","inline-flex items-center gap-2 text-xs font-bold text-slate-700");
      const check=document.createElement("input");check.type="checkbox";check.checked=githubSelected.has(full);
      check.disabled=githubBusy||commit.unavailable===true;
      check.addEventListener("change",()=>{
        if(check.checked)githubSelected.add(full);else githubSelected.delete(full);
        renderGithubCommits();
      });
      include.append(check,node("span","","Include"));
      const checkpointLabel=node("label","inline-flex items-center gap-2 text-xs font-bold text-indigo-800");
      const radio=document.createElement("input");radio.type="radio";radio.name="v4GithubCheckpoint";
      radio.checked=githubCheckpoint===full;radio.disabled=githubBusy||commit.unavailable===true;
      radio.addEventListener("change",()=>{githubCheckpoint=full;renderGithubCommits();});
      checkpointLabel.append(radio,node("span","","Checkpoint"));
      controls.append(include,checkpointLabel,node("span","font-mono text-xs text-indigo-800",full.slice(0,12)));
      row.append(controls);
      row.append(node("p","mt-2 text-sm font-bold text-slate-900",
        String(commit.commit?.message||"Commit unavailable").split("\n")[0].slice(0,180)));
      const author=commit.commit?.author||{};
      row.append(node("p","mt-1 text-xs text-slate-500",
        (author.name||"Unknown Git author")+" · "+(author.date?new Date(author.date).toLocaleString():"Date unavailable")));
      if(commit.unavailable)row.append(node("p","mt-2 text-xs text-amber-800",
        "This commit is part of your prior frozen selection but was not returned in the loaded history window."));
      ghList.append(row);
    }
  }
  async function openGithubEvidence(task,current){
    githubTask=task;githubTaskStatus=current||null;
    githubCommits=[];githubSelected=new Set(current?.selectedCommitShas||[]);
    githubCheckpoint=current?.checkpointSha||"";
    const savedKey="adminerva:v4:github-repository:"+(auth.currentUser?.uid||"")+":"+
      (picker?.scope.current?.schoolId||"");
    let remembered="";try{remembered=sessionStorage.getItem(savedKey)||"";}catch{}
    ghRepository.value=current?.repository||remembered;
    document.getElementById("v4GithubEvidenceMeta").textContent=
      task.title+" · due "+date(task.dueAt);
    ghStatus.textContent=current?.status==="reopened"?
      "Your teacher requested a revision. Load the repository, adjust the frozen commit selection, and resubmit before the extension deadline.":
      "Choose commits representing your work and a project checkpoint containing that work.";
    renderGithubCommits();ghDialog.showModal();
    if(ghRepository.value)await loadGithubHistory().catch(error=>{ghStatus.textContent=error.message;});
  }
  async function loadGithubHistory(){
    if(githubBusy)return;
    const repositoryValue=ghRepository.value.trim();
    const parsed=parseGithubRepository(repositoryValue);
    githubBusy=true;document.getElementById("v4GithubLoad").disabled=true;ghSubmit.disabled=true;
    ghStatus.textContent="Loading pinned GitHub commit history…";
    try{
      const preferences=auth.currentUser?activateConnectionOwner(auth.currentUser.uid):{};
      const client=createGithubEvidenceClient({token:preferences.githubToken||null,maxPages:5,retryCount:1});
      const head=await client.getBranchHead(parsed.fullName);
      const ref=githubTaskStatus?.checkpointSha||head.sha;
      const history=await client.listCommits({repository:parsed.fullName,ref});
      githubCommits=history.commits.slice(0,500);
      const returned=new Set(githubCommits.map(item=>String(item.sha||"").toLowerCase()));
      for(const oldSha of githubSelected){
        if(!returned.has(oldSha))githubCommits.push({sha:oldSha,unavailable:true,commit:{message:"Previously frozen evidence commit"}});
      }
      if(!githubCheckpoint)githubCheckpoint=head.sha;
      if(!githubCommits.some(item=>String(item.sha||"").toLowerCase()===githubCheckpoint))
        githubCommits.unshift({sha:githubCheckpoint,unavailable:false,commit:{message:"Selected checkpoint"}});
      try{
        sessionStorage.setItem("adminerva:v4:github-repository:"+
          auth.currentUser.uid+":"+picker.scope.current.schoolId,parsed.fullName);
      }catch{}
      ghRepository.value=parsed.fullName;
      ghStatus.textContent=history.historyComplete?
        githubCommits.length+" commits loaded from pinned repository history.":
        githubCommits.length+" commits loaded. History hit the safe page limit; do not treat absent commits as proof of no contribution.";
    }catch(error){
      ghStatus.textContent=(error?.message||"GitHub history unavailable")+
        ". For a private repository, reconnect the account-owned GitHub integration before retrying.";
      throw error;
    }finally{
      githubBusy=false;document.getElementById("v4GithubLoad").disabled=false;ghSubmit.disabled=false;
      renderGithubCommits();
    }
  }
  document.getElementById("v4GithubLoad").addEventListener("click",()=>
    void loadGithubHistory().catch(()=>{}));
  document.getElementById("v4GithubEvidenceClose").addEventListener("click",()=>ghDialog.close());
  ghDialog.addEventListener("cancel",event=>{if(githubBusy)event.preventDefault();});
  ghSubmit.addEventListener("click",()=>void (async()=>{
    if(githubBusy||!githubTask)return;
    let parsed;
    try{parsed=parseGithubRepository(ghRepository.value);}
    catch(error){ghStatus.textContent=error.message;return;}
    if(!githubSelected.size){ghStatus.textContent="Select at least one evidence commit.";return;}
    if(!/^[a-f0-9]{40}$/.test(githubCheckpoint)){
      ghStatus.textContent="Choose a full Git commit as the project checkpoint.";return;
    }
    if(!confirm("Submit "+githubSelected.size+" frozen GitHub commit(s) for \""+githubTask.title+
      "\"? Changes require a teacher revision request after submission."))return;
    githubBusy=true;ghSubmit.disabled=true;document.getElementById("v4GithubLoad").disabled=true;
    ghStatus.textContent="Freezing the verified-school evidence selection…";
    try{
      const receipt=await scoped(picker.scope,githubEvidenceApi,"submit",{
        taskId:githubTask.taskId,repository:parsed.fullName,
        selectedCommitShas:[...githubSelected],checkpointSha:githubCheckpoint
      });
      ghStatus.textContent=receipt.alreadyExisted?
        "This exact evidence version was already submitted; no duplicate was created.":
        "GitHub evidence version "+receipt.version+" submitted for teacher verification.";
      setTimeout(()=>{if(ghDialog.open)ghDialog.close();},900);
      await render(picker.scope);
    }catch(error){ghStatus.textContent=error?.message||"GitHub evidence was not submitted.";}
    finally{githubBusy=false;ghSubmit.disabled=false;document.getElementById("v4GithubLoad").disabled=false;}
  })());

  await auth.authStateReady();
  if(auth.currentUser){
    picker=createTenantSchoolPicker({
      host:schoolHost,status:null,
      onReady:scope=>void render(scope),
      onBeforeChange:async()=>{
        if(githubBusy||ghDialog.open)throw Error("Close the GitHub evidence editor before switching schools.");
        renderGeneration++;list.replaceChildren();
        status.textContent="Switching verified school…";
      }
    });
    try{
      const state=await picker.load();
      if(state?.state==="choose_school"){
        panel.classList.remove("hidden");
        status.textContent="Choose your active school to load verified assignments.";
      }
    }catch(error){
      console.warn("Verified school assignment panel unavailable:",error?.message||error);
    }
  }
}
