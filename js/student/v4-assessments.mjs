import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {GithubAuthProvider,linkWithPopup,reauthenticateWithPopup} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";
import {createGithubEvidenceClient,parseGithubRepository} from "../repo-review/services/github-evidence-client.mjs?v=1.3.0";
import {activateConnectionOwner} from "../core/connection-cache.mjs?v=1.3.0";

const panel=document.getElementById("v4AssignmentsPanel");
const list=document.getElementById("v4AssignmentsList");
const status=document.getElementById("v4AssignmentsStatus");
const schoolHost=document.getElementById("v4AssignmentsSchoolSwitcher");
const assignmentSubjectLabel=document.getElementById("assignmentSubjectLabel");
const assignmentParams=new URLSearchParams(location.search);
const requestedSubjectId=assignmentParams.get("subjectId")||"";
const requestedOfferingId=assignmentParams.get("offeringId")||"";
const requestedSubjectName=assignmentParams.get("subject")||"";

function node(tag,className,text){
  const item=document.createElement(tag);
  if(className)item.className=className;
  if(text!==undefined)item.textContent=String(text);
  return item;
}
function date(value){return value?new Date(value).toLocaleString():"—";}
function sourceLabel(source,task={}){
  return ({text:"Written response",link:"Submission link",studio:task.personalizedTask?.enabled===true?"Personalized Adminerva Studio":"Adminerva Studio",github:"GitHub / repository evidence"})[source]||"Assessment response";
}
function submissionReceipt(submission,grade){
  if(!submission?.submitted||submission.status==="reopened")return null;
  const revision=String(submission.revisionSha||submission.checkpointSha||"").trim();
  const version=Number(submission.version||0);
  const submittedAt=submission.submittedAt||submission.updatedAt||submission.createdAt||0;
  let title="Submitted successfully",detail="Your work is recorded and awaiting teacher review.";
  let className="border-blue-200 bg-blue-50 text-blue-950",iconClass="bg-blue-600";
  if(submission.status==="approved"){
    title="Submission verified";detail="Your submitted evidence has been verified. Published grading appears separately when available.";
    className="border-emerald-200 bg-emerald-50 text-emerald-950";iconClass="bg-emerald-600";
  }else if(submission.status==="reviewed"){
    title="Submission reviewed";detail="Your teacher has reviewed this submission. Check the published feedback or grade shown with this task.";
    className="border-emerald-200 bg-emerald-50 text-emerald-950";iconClass="bg-emerald-600";
  }else if(grade){
    title="Submitted and graded";detail="This submission is already recorded and has a published grade.";
    className="border-emerald-200 bg-emerald-50 text-emerald-950";iconClass="bg-emerald-600";
  }
  const meta=[];
  if(submittedAt)meta.push("Recorded "+date(submittedAt));
  if(version>0)meta.push("Version "+version);
  if(revision)meta.push("Revision "+revision.slice(0,12));
  return {title,detail,meta:meta.join(" · "),className,iconClass};
}
if(panel&&list&&status&&schoolHost){
  const functions=getFunctions(app,"asia-southeast1");
  const assessmentsApi=httpsCallable(functions,"schoolAssessments");
  const profileApi=httpsCallable(functions,"schoolStudentProfile");
  const submissionsApi=httpsCallable(functions,"schoolStudioSubmissions");
  const generalSubmissionsApi=httpsCallable(functions,"schoolAssessmentSubmissions");
  const gradebookApi=httpsCallable(functions,"schoolGradebook");
  const githubEvidenceApi=httpsCallable(functions,"schoolGithubEvidence");
  const reclaimsApi=httpsCallable(functions,"schoolReclaims");
  let renderGeneration=0,picker=null,githubTask=null,githubTaskStatus=null;
  let githubCommits=[],githubSelected=new Set(),githubCheckpoint="",githubBusy=false,reclaimTarget=null,githubSessionToken="";
  let githubClaims=new Map(),historyRepository="",githubTokenOwner="";
  async function scoped(scope,api,action,details={}){
    const lease=scope.lease();
    const result=(await api({schoolId:lease.schoolId,action,...details})).data;
    scope.assertLease(lease);
    return result;
  }
  function assignmentState(task,submission,grade){
    if(grade)return {label:"Graded",className:"bg-emerald-100 text-emerald-800"};
    if(submission?.error)return {label:"Status unavailable",className:"bg-slate-100 text-slate-700"};
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
    if(task.late===true)return {label:"Late submission allowed",className:"bg-amber-100 text-amber-900"};
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
        scoped(scope,gradebookApi,"my_published").catch(error=>({grades:[],error:error?.message||"Grades unavailable"})),
        scoped(scope,profileApi,"my_profile")
      ]);
      if(generation!==renderGeneration)return;
      const profile=results[2]||{},classes=profile.classes||[];
      let subjectId=requestedSubjectId,subjectName=requestedSubjectName,offeringId=requestedOfferingId;
      const allowedOfferings=new Set(classes.filter(item=>
        (!offeringId||item.offeringId===offeringId)&&(!subjectId||item.subjectId===subjectId)&&(!subjectName||Boolean(subjectId)||String(item.subject||"").toLowerCase()===subjectName.toLowerCase())
      ).map(item=>item.offeringId));
      if(!subjectName&&subjectId)subjectName=classes.find(item=>item.subjectId===subjectId)?.subject||subjectName;
      if(assignmentSubjectLabel)assignmentSubjectLabel.textContent=subjectName||"All subjects";
      const allTasks=results[0].assignments||[];
      const tasks=(subjectId||offeringId||subjectName)?allTasks.filter(task=>allowedOfferings.has(task.offeringId)):allTasks;
      const grades=new Map((results[1].grades||[]).map(item=>[item.taskId,item]));
      const statuses=new Map();
      let next=0;
      const worker=async()=>{while(next<tasks.length&&generation===renderGeneration){const task=tasks[next++];
        try{
          const api=task.submissionSource==="github"?githubEvidenceApi:task.submissionSource==="studio"?submissionsApi:generalSubmissionsApi;
          statuses.set(task.taskId,await scoped(scope,api,"my_status",{taskId:task.taskId}));
        }catch(error){
          statuses.set(task.taskId,{error:error?.message||"Status unavailable"});
        }
      }};
      await Promise.all(Array.from({length:Math.min(5,tasks.length)},worker));
      if(generation!==renderGeneration)return;
      if(!tasks.length){
        status.textContent="No verified school assignments are currently deployed"+(subjectName?" for "+subjectName:"")+".";
        list.append(node("div","rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600",
          "No other active verified-school tasks are available in this school."));
        return;
      }
      const unavailable=[...statuses.values()].filter(row=>row?.error).length;
      status.textContent=tasks.length+" verified school assignment"+(tasks.length===1?"":"s")+" loaded"+(subjectName?" for "+subjectName:"")+"."+(unavailable?" "+unavailable+" submission status(es) unavailable. Refresh before submitting.":"")+(results[1].error?" Published grades temporarily unavailable.":"");
      for(const task of tasks){
        const submission=statuses.get(task.taskId),grade=grades.get(task.taskId);
        const state=assignmentState(task,submission,grade);
        const article=node("article","rounded-xl border border-slate-200 bg-white p-4 shadow-sm");
        article.dataset.taskId=task.taskId;article.tabIndex=-1;
        const top=node("div","flex flex-col sm:flex-row sm:justify-between gap-3");
        const identity=node("div","min-w-0");
        identity.append(
          node("h3","font-extrabold text-slate-900",task.title),
          node("p","text-xs text-slate-500 mt-1",
            (task.assessmentType||"Assessment")+" · Due "+date(task.dueAt)+" · "+sourceLabel(task.submissionSource,task))
        );
        const badge=node("span","self-start rounded-full px-3 py-1 text-xs font-bold "+state.className,state.label);
        top.append(identity,badge);article.append(top);
        const receipt=submissionReceipt(submission,grade);
        if(receipt){
          const confirmation=node("div","mt-3 rounded-xl border p-3 "+receipt.className);
          confirmation.setAttribute("role","status");
          confirmation.setAttribute("aria-label",receipt.title);
          const row=node("div","flex items-start gap-3");
          const icon=node("span","mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white "+receipt.iconClass,"✓");
          const copy=node("div","min-w-0 flex-1");
          copy.append(node("p","text-sm font-extrabold",receipt.title),node("p","mt-0.5 text-xs leading-5",receipt.detail));
          if(receipt.meta)copy.append(node("p","mt-1 text-[11px] font-semibold opacity-80 break-words",receipt.meta));
          row.append(icon,copy);confirmation.append(row);article.append(confirmation);
        }
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
        if(submission?.error)article.append(node("p","mt-3 text-sm text-amber-900","Submission status could not be confirmed. Refresh this page before starting a new submission."));
        const canSubmit=!submission?.error&&(submission?.status==="reopened"?Number(submission.revisionDueAt||0)>Date.now():!submission?.submitted&&!grade&&!["upcoming","closed"].includes(task.windowStatus));
        if(task.submissionSource==="studio"){
          const studioSubmitted=submission?.submitted&&submission.status!=="reopened";
          const link=node("a","rounded-lg px-4 py-2.5 text-sm font-bold "+(studioSubmitted?"border border-emerald-200 bg-emerald-50 text-emerald-800":"bg-indigo-700 text-white"),
            submission?.status==="reopened"?"Open Studio to revise":
              studioSubmitted?"✓ Submitted · Open Studio":
              task.personalizedTask?.enabled===true?"Open my personalized Studio task":"Open Adminerva Studio");
          link.href="student-playground.html?assessment="+encodeURIComponent(task.taskId);
          actions.append(link);
        }else if(task.submissionSource==="github"){
          const canEdit=canSubmit;
          const canOpen=canEdit||submission?.status==="submitted"||submission?.status==="approved"||submission?.status==="reviewed";
          const evidenceButton=node("button",
            "rounded-lg px-4 py-2.5 text-sm font-bold "+(canOpen?"bg-indigo-700 text-white":"border border-slate-300 text-slate-600"),
            canEdit?(submission?.status==="reopened"?"Revise GitHub evidence":"Select GitHub evidence"):
              submission?.status==="submitted"?"✓ Submitted · Review evidence":
              submission?.status==="approved"?"✓ Evidence approved":submission?.status==="reviewed"?"✓ Evidence reviewed":"Evidence unavailable for submission");
          evidenceButton.type="button";evidenceButton.disabled=!canOpen;
          if(canOpen)evidenceButton.addEventListener("click",()=>void openGithubEvidence(task,submission));
          actions.append(evidenceButton);
          if(submission?.repository){
            const repoLink=node("a","rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700","Open repository ↗");
            repoLink.href="https://github.com/"+submission.repository;repoLink.target="_blank";repoLink.rel="noopener noreferrer";
            actions.append(repoLink);
          }
        }else if(["text","link"].includes(task.submissionSource)){
          const canEdit=canSubmit;
          const responseButton=node("button",
            "rounded-lg px-4 py-2.5 text-sm font-bold "+(canEdit?"bg-indigo-700 text-white":"border border-slate-300 text-slate-600"),
            canEdit?(submission?.status==="reopened"?"Revise response":"Open response editor"):submission?.submitted?"✓ Response submitted":"Response unavailable for submission");
          responseButton.type="button";responseButton.disabled=!canEdit;
          if(canEdit)responseButton.addEventListener("click",()=>openGeneralSubmission(task,submission));
          actions.append(responseButton);
        }
        if(actions.children.length)article.append(actions);
        list.append(article);
      }
      let targetId=(location.hash||"").replace(/^#/,"");try{targetId=decodeURIComponent(targetId);}catch{}
      if(targetId){
        const target=[...list.querySelectorAll("[data-task-id]")].find(item=>item.dataset.taskId===targetId);
        if(target){
          target.classList.add("ring-2","ring-indigo-400");
          requestAnimationFrame(()=>{target.scrollIntoView({behavior:"smooth",block:"center"});target.focus({preventScroll:true});});
        }
      }
    }catch(error){
      if(generation!==renderGeneration)return;
      status.textContent="Verified school assignments are temporarily unavailable: "+(error?.message||"retry later");
      list.append(node("p","text-xs text-slate-500",
        "No school assignment data was changed. Retry when the verified-school service is available."));
    }
  }
  const generalDialog=document.getElementById("v4GeneralSubmissionDialog");
  const generalForm=document.getElementById("v4GeneralSubmissionForm");
  const generalStatus=document.getElementById("v4GeneralSubmissionStatus");
  let generalTask=null,generalTaskStatus=null,generalBusy=false;

  function openGeneralSubmission(task,current){
    generalTask=task;generalTaskStatus=current||null;
    const isLink=task.submissionSource==="link";
    document.getElementById("v4GeneralSubmissionType").textContent=sourceLabel(task.submissionSource,task);
    document.getElementById("v4GeneralSubmissionTitle").textContent=task.title;
    document.getElementById("v4GeneralSubmissionMeta").textContent=
      "Due "+date(task.dueAt)+" · version "+(current?.version||0);
    document.getElementById("v4TextResponseFields").classList.toggle("hidden",isLink);
    document.getElementById("v4LinkResponseFields").classList.toggle("hidden",!isLink);
    document.getElementById("v4TextResponse").value=current?.payload?.response||"";
    document.getElementById("v4LinkResponseUrl").value=current?.payload?.url||"";
    document.getElementById("v4LinkResponseNote").value=current?.payload?.note||"";
    const notice=document.getElementById("v4GeneralRevisionNotice");
    notice.classList.toggle("hidden",current?.status!=="reopened");
    notice.textContent=current?.status==="reopened"
      ?"Teacher revision request: "+(current.requestMessage||"Revise and resubmit this response.")+
        (current.revisionDueAt?" · Extension deadline: "+date(current.revisionDueAt):""):"";
    generalStatus.textContent=current?.status==="reopened"?
      "Edit the prior frozen response and submit a new immutable version.":
      "Your response becomes read-only after submission unless your teacher requests a revision.";
    generalDialog.showModal();
  }
  function closeGeneralSubmission(){
    if(generalBusy)return;
    generalDialog.close();generalTask=null;generalTaskStatus=null;
  }
  document.getElementById("v4GeneralSubmissionClose").addEventListener("click",closeGeneralSubmission);
  document.getElementById("v4GeneralSubmissionCancel").addEventListener("click",closeGeneralSubmission);
  generalDialog.addEventListener("cancel",event=>{if(generalBusy)event.preventDefault();});
  generalForm.addEventListener("submit",event=>void (async()=>{
    event.preventDefault();
    if(generalBusy||!generalTask||!picker?.scope.current)return;
    const source=generalTask.submissionSource;
    const details=source==="text"?
      {response:document.getElementById("v4TextResponse").value}:
      {url:document.getElementById("v4LinkResponseUrl").value,note:document.getElementById("v4LinkResponseNote").value};
    if(!confirm("Submit this frozen "+sourceLabel(source,generalTask).toLowerCase()+" for \""+generalTask.title+"\"? Changes require a teacher revision request after submission."))return;
    generalBusy=true;
    const submit=document.getElementById("v4GeneralSubmissionSubmit");
    const editable=[...generalForm.querySelectorAll("input,textarea,button")].filter(control=>!control.disabled);editable.forEach(control=>control.disabled=true);
    submit.disabled=true;generalStatus.textContent="Freezing your assessment response…";
    try{
      const receipt=await scoped(picker.scope,generalSubmissionsApi,"submit",{taskId:generalTask.taskId,...details});
      generalStatus.textContent=receipt.alreadyExisted?
        "This exact response was already submitted. No duplicate version was created.":
        "Response submitted as frozen version "+receipt.version+".";
      generalDialog.close();generalTask=null;generalTaskStatus=null;
      await render(picker.scope);
    }catch(error){
      generalStatus.textContent=error?.message||"Assessment response was not submitted.";
    }finally{generalBusy=false;editable.forEach(control=>control.disabled=false);submit.disabled=false;}
  })());

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
      const editable=!githubTaskStatus?.submitted||githubTaskStatus?.status==="reopened";
      const check=document.createElement("input");check.type="checkbox";check.checked=githubSelected.has(full);
      check.disabled=githubBusy||!editable||commit.unavailable===true;
      check.addEventListener("change",()=>{
        if(check.checked)githubSelected.add(full);else githubSelected.delete(full);
        renderGithubCommits();
      });
      include.append(check,node("span","","Include"));
      const checkpointLabel=node("label","inline-flex items-center gap-2 text-xs font-bold text-indigo-800");
      const radio=document.createElement("input");radio.type="radio";radio.name="v4GithubCheckpoint";
      radio.checked=githubCheckpoint===full;radio.disabled=githubBusy||!editable||commit.unavailable===true;
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
      if(githubTaskStatus?.status==="submitted"&&githubSelected.has(full)){
        const claim=githubClaims.get(full),claimBox=node("div","mt-2 flex flex-wrap items-center gap-2");
        if(claim){
          claimBox.append(node("span","text-xs font-bold "+(
            claim.status==="approved"||claim.status==="shared"?"text-emerald-800":
            claim.status==="rejected"?"text-rose-800":"text-amber-800"),
            "Attribution: "+claim.status.replace(/_/g," ")));
          if(claim.status==="pending"){
            const withdraw=node("button","text-xs font-bold text-rose-700 underline","Withdraw request");
            withdraw.type="button";withdraw.addEventListener("click",()=>void withdrawReclaim(claim));
            claimBox.append(withdraw);
          }
          if(claim.decisionReason)claimBox.append(node("span","text-xs text-slate-500",claim.decisionReason));
        }else{
          const request=node("button","text-xs font-bold text-amber-800 underline","Request attribution review");
          request.type="button";request.addEventListener("click",()=>openReclaim(commit));
          claimBox.append(request);
        }
        row.append(claimBox);
      }
      ghList.append(row);
    }
  }
  async function loadGithubClaims(){
    githubClaims=new Map();
    if(!githubTask||githubTaskStatus?.status!=="submitted")return;
    try{
      const result=await scoped(picker.scope,reclaimsApi,"mine",{taskId:githubTask.taskId});
      githubClaims=new Map((result.claims||[]).map(claim=>[claim.sha,claim]));
    }catch(error){ghStatus.textContent="Attribution status unavailable: "+(error?.message||"retry later");}
  }
  function openReclaim(commit){
    reclaimTarget=commit;
    document.getElementById("v4GithubReclaimSubject").textContent=String(commit.sha||"");
    document.getElementById("v4GithubReclaimReason").value="";
    document.getElementById("v4GithubReclaimStatus").textContent="";
    document.getElementById("v4GithubReclaimEditor").classList.remove("hidden");
    document.getElementById("v4GithubReclaimReason").focus();
  }
  function closeReclaim(){
    reclaimTarget=null;document.getElementById("v4GithubReclaimEditor").classList.add("hidden");
  }
  async function withdrawReclaim(claim){
    if(githubBusy||!confirm("Withdraw this pending attribution request? The evidence submission itself remains unchanged."))return;
    githubBusy=true;renderGithubCommits();
    try{
      await scoped(picker.scope,reclaimsApi,"withdraw",{claimId:claim.claimId});
      await loadGithubClaims();renderGithubCommits();
      ghStatus.textContent="Attribution request withdrawn. Your frozen evidence was not changed.";
    }catch(error){ghStatus.textContent=error?.message||"Attribution request could not be withdrawn.";}
    finally{githubBusy=false;renderGithubCommits();}
  }
  async function openGithubEvidence(task,current){
    githubTask=task;githubTaskStatus=current||null;
    githubCommits=[];githubSelected=new Set(current?.selectedCommitShas||[]);
    githubCheckpoint=current?.checkpointSha||"";githubClaims=new Map();historyRepository="";closeReclaim();
    const savedKey="adminerva:v4:github-repository:"+(auth.currentUser?.uid||"")+":"+
      (picker?.scope.current?.schoolId||"");
    let remembered="";try{remembered=sessionStorage.getItem(savedKey)||"";}catch{}
    ghRepository.value=current?.repository||remembered;
    ghRepository.readOnly=Boolean(current?.submitted&&current.status!=="reopened");
    document.getElementById("v4GithubEvidenceMeta").textContent=
      task.title+" · due "+date(task.dueAt);
    ghStatus.textContent=current?.status==="reopened"?
      "Your teacher requested a revision. Load the repository, adjust the frozen commit selection, and resubmit before the extension deadline.":
      "Choose commits representing your work and a project checkpoint containing that work.";
    const editable=!current?.submitted||current?.status==="reopened";
    ghSubmit.classList.toggle("hidden",!editable);ghSubmit.disabled=true;
    renderGithubCommits();ghDialog.showModal();
    if(current?.status==="submitted")await loadGithubClaims();
    if(ghRepository.value)await loadGithubHistory().catch(error=>{ghStatus.textContent=error.message;});
    renderGithubCommits();
  }
  async function loadGithubHistory(){
    if(githubBusy)return;
    const repositoryValue=ghRepository.value.trim();
    let parsed;try{parsed=parseGithubRepository(repositoryValue);}catch(error){ghStatus.textContent=error.message;return;}
    const uid=auth.currentUser?.uid,taskId=githubTask?.taskId;
    const priorRepository=historyRepository||githubTaskStatus?.repository||"";
    githubBusy=true;ghRepository.disabled=true;document.getElementById("v4GithubLoad").disabled=true;ghSubmit.disabled=true;
    ghStatus.textContent="Loading pinned GitHub commit history…";
    try{
      const preferences=auth.currentUser?activateConnectionOwner(auth.currentUser.uid):{};
      const client=createGithubEvidenceClient({
        token:(githubTokenOwner===uid?githubSessionToken:"")||preferences.githubToken||null,maxPages:5,retryCount:1
      });
      const head=await client.getBranchHead(parsed.fullName);
      const sameRepository=!priorRepository||priorRepository.toLowerCase()===parsed.fullName.toLowerCase();
      const ref=sameRepository&&githubTaskStatus?.checkpointSha||head.sha;
      const history=await client.listCommits({repository:parsed.fullName,ref});
      if(auth.currentUser?.uid!==uid||!ghDialog.open||githubTask?.taskId!==taskId)return;
      if(!sameRepository){githubSelected.clear();githubCheckpoint="";}
      githubCommits=history.commits.slice(0,500);historyRepository=parsed.fullName;
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
      githubBusy=false;ghRepository.disabled=false;document.getElementById("v4GithubLoad").disabled=false;
      ghSubmit.disabled=!historyRepository||historyRepository.toLowerCase()!==ghRepository.value.trim().toLowerCase()||Boolean(githubTaskStatus?.submitted&&githubTaskStatus.status!=="reopened");
      renderGithubCommits();
    }
  }
  document.getElementById("v4GithubReclaimCancel").addEventListener("click",closeReclaim);
  document.getElementById("v4GithubReclaimSubmit").addEventListener("click",()=>void (async()=>{
    if(githubBusy||!reclaimTarget||githubTaskStatus?.status!=="submitted")return;
    const explanation=document.getElementById("v4GithubReclaimReason").value.trim();
    if(explanation.length<10){
      document.getElementById("v4GithubReclaimStatus").textContent=
        "Explain the attribution issue in at least 10 characters.";return;
    }
    const author=reclaimTarget.commit?.author||{};
    if(!confirm("Send this commit attribution request to your school administrator?"))return;
    githubBusy=true;document.getElementById("v4GithubReclaimSubmit").disabled=true;
    try{
      await scoped(picker.scope,reclaimsApi,"request",{
        taskId:githubTask.taskId,evidenceId:githubTaskStatus.evidenceId,
        sha:String(reclaimTarget.sha||"").toLowerCase(),explanation,
        detectedAuthorName:String(author.name||""),
        detectedAuthorLogin:String(reclaimTarget.author?.login||"")
      });
      await loadGithubClaims();closeReclaim();renderGithubCommits();
      ghStatus.textContent="Attribution request sent. Evidence approval waits for any pending claim decision.";
    }catch(error){
      document.getElementById("v4GithubReclaimStatus").textContent=
        error?.message||"Attribution request was not sent.";
    }finally{githubBusy=false;document.getElementById("v4GithubReclaimSubmit").disabled=false;}
  })());
  document.getElementById("v4GithubLoad").addEventListener("click",()=>
    void loadGithubHistory().catch(()=>{}));
  const authorizeButton=document.getElementById("v4GithubAuthorize");
  authorizeButton?.addEventListener("click",()=>void (async()=>{
    if(githubBusy)return;
    const user=auth.currentUser;if(!user)return;
    const provider=new GithubAuthProvider();provider.addScope("repo");provider.addScope("read:user");
    githubBusy=true;authorizeButton.disabled=true;ghStatus.textContent="Authorizing GitHub for this browser session…";
    try{
      const linked=user.providerData.some(item=>item.providerId==="github.com");
      const result=linked?await reauthenticateWithPopup(user,provider):await linkWithPopup(user,provider);
      if(auth.currentUser?.uid!==user.uid)throw new Error("Adminerva account changed during GitHub authorization.");
      const credential=GithubAuthProvider.credentialFromResult(result);
      if(!credential?.accessToken)throw new Error("GitHub did not return a usable session credential.");
      githubSessionToken=credential.accessToken;githubTokenOwner=user.uid;
      ghStatus.textContent="GitHub authorized for this page session only. The OAuth token was not written to school Firestore.";
      if(ghRepository.value.trim()){githubBusy=false;await loadGithubHistory();}
    }catch(error){
      ghStatus.textContent=error?.code==="auth/credential-already-in-use"?
        "This GitHub identity is linked to another Adminerva sign-in. No school data changed.":
        error?.message||"GitHub authorization did not finish.";
    }finally{githubBusy=false;authorizeButton.disabled=false;renderGithubCommits();}
  })());
  document.getElementById("v4GithubEvidenceClose").addEventListener("click",()=>{if(!githubBusy)ghDialog.close();});
  ghRepository.addEventListener("input",()=>{ghSubmit.disabled=true;ghStatus.textContent="Load this repository before selecting or submitting evidence.";});
  ghDialog.addEventListener("cancel",event=>{if(githubBusy)event.preventDefault();});
  ghSubmit.addEventListener("click",()=>void (async()=>{
    if(githubBusy||!githubTask)return;
    let parsed;
    try{parsed=parseGithubRepository(ghRepository.value);}
    catch(error){ghStatus.textContent=error.message;return;}
    if(!historyRepository||historyRepository.toLowerCase()!==parsed.fullName.toLowerCase()){ghStatus.textContent="Load this repository before submitting evidence.";return;}
    if(githubTaskStatus?.submitted&&githubTaskStatus.status!=="reopened")return;
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
      ghDialog.close();githubTask=null;githubTaskStatus=null;historyRepository="";
      await render(picker.scope);
    }catch(error){ghStatus.textContent=error?.message||"GitHub evidence was not submitted.";}
    finally{githubBusy=false;ghSubmit.disabled=!historyRepository;document.getElementById("v4GithubLoad").disabled=false;}
  })());

  await auth.authStateReady();
  if(auth.currentUser){
    picker=createTenantSchoolPicker({
      host:schoolHost,status:null,
      onReady:scope=>void render(scope),
      onBeforeChange:async()=>{
        if(githubBusy||generalBusy||ghDialog.open||generalDialog.open)throw Error("Close the open assessment editor before switching schools.");
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
