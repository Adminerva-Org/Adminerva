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
  await auth.authStateReady();
  if(auth.currentUser){
    picker=createTenantSchoolPicker({
      host:schoolHost,status:null,
      onReady:scope=>void render(scope),
      onBeforeChange:async()=>{
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
