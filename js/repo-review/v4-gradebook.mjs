import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";
import {createGithubEvidenceClient} from "./services/github-evidence-client.mjs?v=1.3.0";
import {activateConnectionOwner} from "../core/connection-cache.mjs?v=1.3.0";

const panel=document.getElementById("gbV4Panel");
const taskSelect=document.getElementById("gbV4Task");
const inbox=document.getElementById("gbV4Inbox");
const status=document.getElementById("gbV4Status");
const dialog=document.getElementById("gbV4ReviewDialog");

function make(tag,className,text){
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(text!==undefined)element.textContent=String(text);
  return element;
}
function localIso(value){
  if(!value)return null;
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toISOString():null;
}
if(panel&&taskSelect&&inbox&&status&&dialog){
  const functions=getFunctions(app,"asia-southeast1");
  const assessmentApi=httpsCallable(functions,"schoolAssessments");
  const submissionApi=httpsCallable(functions,"schoolStudioSubmissions");
  const githubEvidenceApi=httpsCallable(functions,"schoolGithubEvidence");
  const gradeApi=httpsCallable(functions,"schoolGradebook");
  let picker=null,tasks=new Map(),currentTask=null,currentRow=null,currentSnapshot=null,currentGrade=null;
  let generation=0,busy=false,githubVerification=null;

  async function scoped(api,action,details={}){
    if(!picker?.scope.current)throw Error("Choose a verified school first.");
    const lease=picker.scope.lease();
    const result=(await api({schoolId:lease.schoolId,action,...details})).data;
    picker.scope.assertLease(lease);
    return result;
  }
  function refreshReviewControls(){
    const published=currentGrade?.status==="published";
    const reopened=currentRow?.status==="reopened";
    const loaded=Boolean(currentTask&&currentRow&&currentSnapshot);
    const evidenceReady=currentTask?.submissionSource!=="github"||
      ["approved","reviewed"].includes(currentSnapshot?.status);
    document.getElementById("gbV4SaveDraft").disabled=
      busy||!loaded||!evidenceReady||published||reopened;
    document.getElementById("gbV4Publish").disabled=
      busy||!loaded||published||reopened||currentGrade?.status!=="draft";
    document.getElementById("gbV4RequestRevision").disabled=
      busy||!loaded||published||reopened;
    const legacyScalar=published&&currentGrade?.gradeSchema==="legacy_scalar_v1";
    document.getElementById("gbV4Correct").disabled=busy||!loaded||!published||legacyScalar;
    const convert=document.getElementById("gbV4ConvertLegacy");
    convert.hidden=!legacyScalar;convert.disabled=busy||!loaded||!legacyScalar;
    document.getElementById("gbV4LegacyGradeNotice").hidden=!legacyScalar;
    document.getElementById("gbV4CorrectionPanel").classList.toggle("hidden",!published);
    document.getElementById("gbV4Refresh").disabled=busy;
  }
  function setBusy(value,message=""){
    busy=value;refreshReviewControls();
    if(message)document.getElementById("gbV4ReviewStatus").textContent=message;
  }
  async function loadTasks(){
    const token=++generation;
    status.textContent="Loading your verified school assessments…";
    const result=await scoped(assessmentApi,"list_teacher");
    if(token!==generation)return;
    const items=(result.assessments||[]).filter(item=>["studio","github"].includes(item.submissionSource)&&item.status==="deployed");
    tasks=new Map(items.map(item=>[item.taskId,item]));
    taskSelect.replaceChildren();
    const start=new Option(items.length?"Choose an assessment…":"No deployed V4 assessments","");
    start.disabled=true;start.selected=true;taskSelect.add(start);
    for(const task of items){
      const label=(task.submissionSource==="github"?"GitHub · ":"Studio · ")+task.title+" · "+(task.sectionId||"class")+" · "+(task.subjectId||"subject");
      taskSelect.add(new Option(label,task.taskId));
    }
    panel.classList.remove("hidden");
    inbox.replaceChildren();
    status.textContent=items.length?
      items.length+" deployed V4 assessment"+(items.length===1?"":"s")+" available.":
      "No verified V4 assessments owned by this teacher in the active school." ;
    const requested=new URL(location.href).searchParams.get("task");
    if(requested&&tasks.has(requested)){
      taskSelect.value=requested;
      await loadInbox();
    }
  }
  async function loadInbox(){
    const task=tasks.get(taskSelect.value);
    currentTask=task||null;inbox.replaceChildren();
    if(!task){status.textContent="Choose an assessment to load submissions.";return;}
    const token=++generation;
    status.textContent=task.submissionSource==="github"?
      "Loading frozen GitHub evidence…":"Loading frozen Studio submissions…";
    try{
      const evidenceApi=task.submissionSource==="github"?githubEvidenceApi:submissionApi;
      const result=await scoped(evidenceApi,"inbox",{taskId:task.taskId});
      if(token!==generation)return;
      const rows=task.submissionSource==="github"?(result.evidence||[]):(result.submissions||[]);
      status.textContent=rows.length?
        rows.length+" frozen evidence item"+(rows.length===1?"":"s")+" loaded.":
        "No student evidence yet for this assessment.";
      if(!rows.length){
        inbox.append(make("div","rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600",
          "Students will appear here after a verified assessment evidence version is submitted."));
        return;
      }
      for(const row of rows){
        const card=make("article","rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3");
        const details=make("div","min-w-0");
        details.append(
          make("h3","font-extrabold text-slate-900",row.studentName||"Student"),
          make("p","text-xs text-slate-500 mt-1",
            "Version "+row.version+" · "+row.status+" · "+(row.updatedAt?new Date(row.updatedAt).toLocaleString():"recently"))
        );
        const button=make("button","rounded-lg bg-indigo-700 text-white font-bold px-4 py-2.5 text-sm",task.submissionSource==="github"?"Verify evidence":"Review frozen project");
        button.type="button";
        const normalized=task.submissionSource==="github"?
          {...row,recordId:row.evidenceId}:{...row,recordId:row.submissionId};
        button.addEventListener("click",()=>void openReview(normalized));
        card.append(details,button);inbox.append(card);
      }
    }catch(error){
      if(token!==generation)return;
      status.textContent=error?.message||"Submission inbox is unavailable.";
    }
  }
  function renderFile(){
    if(!currentSnapshot)return;
    const select=document.getElementById("gbV4File");
    const file=currentSnapshot.files.find(item=>item.path===select.value)||currentSnapshot.files[0];
    document.getElementById("gbV4Code").textContent=file?.content||"";
  }
  function renderGithubEvidence(snapshot,commitMap=null){
    const host=document.getElementById("gbV4GithubCommits");host.replaceChildren();
    const repo=snapshot?.repository?.fullName||"";
    document.getElementById("gbV4GithubMeta").textContent=
      (repo||"Repository unavailable")+" · checkpoint "+String(snapshot?.checkpointSha||"").slice(0,12)+
      " · "+(snapshot?.selectedCommitShas?.length||0)+" selected commit(s)";
    const link=document.getElementById("gbV4GithubRepoLink");
    link.href=snapshot?.repository?.url||("https://github.com/"+repo);
    for(const sha of snapshot?.selectedCommitShas||[]){
      const commit=commitMap?.get(sha)||null;
      const row=make("div","rounded-lg border border-slate-200 bg-white p-3");
      const top=make("div","flex flex-wrap items-center justify-between gap-2");
      top.append(make("span","font-mono text-xs font-bold text-indigo-800",sha.slice(0,12)));
      const github=make("a","text-xs font-bold text-indigo-700 underline","Inspect diff ↗");
      github.href="https://github.com/"+repo+"/commit/"+sha;github.target="_blank";github.rel="noopener noreferrer";
      top.append(github);row.append(top);
      if(commit){
        row.append(make("p","text-sm font-bold text-slate-900 mt-2",
          String(commit.commit?.message||"No commit message").split("\n")[0].slice(0,180)));
        const author=commit.commit?.author||{};
        row.append(make("p","text-xs text-slate-500 mt-1",
          (author.name||"Unknown Git author")+" · "+(author.date?new Date(author.date).toLocaleString():"Date unavailable")));
      }
      host.append(row);
    }
    const approved=["approved","reviewed"].includes(snapshot?.status);
    document.getElementById("gbV4GithubVerifyStatus").textContent=approved?
      "This exact frozen evidence version already has teacher approval. Re-verification is optional before grading.":
      "Verify that every selected commit is reachable from the frozen checkpoint, then inspect the diffs before approval.";
    document.getElementById("gbV4GithubApproval").classList.add("hidden");
    document.getElementById("gbV4GithubApprovalNote").value="";
    githubVerification=null;
  }
  async function verifyGithubEvidence(){
    if(busy||currentTask?.submissionSource!=="github"||!currentSnapshot)return;
    const verifyStatus=document.getElementById("gbV4GithubVerifyStatus");
    const verifyButton=document.getElementById("gbV4GithubVerify");
    verifyButton.disabled=true;verifyStatus.textContent="Checking the frozen checkpoint and selected commit reachability…";
    try{
      const prefs=auth.currentUser?activateConnectionOwner(auth.currentUser.uid):{};
      const client=createGithubEvidenceClient({token:prefs.githubToken||null,maxPages:10,retryCount:1});
      const repo=currentSnapshot.repository.fullName,checkpoint=currentSnapshot.checkpointSha;
      const history=await client.listCommits({repository:repo,ref:checkpoint});
      const map=new Map(history.commits.map(commit=>[String(commit.sha||"").toLowerCase(),commit]));
      const selected=(currentSnapshot.selectedCommitShas||[]).map(value=>String(value).toLowerCase());
      const missing=selected.filter(value=>!map.has(value));
      renderGithubEvidence(currentSnapshot,map);
      if(missing.length){
        verifyStatus.textContent="Cannot approve yet: "+missing.length+
          " selected commit(s) were not found in the loaded checkpoint history. Increase repository access or inspect the evidence manually.";
        githubVerification=null;return;
      }
      githubVerification={verifiedCheckpointSha:checkpoint,verifiedCommitShas:selected};
      verifyStatus.textContent="All "+selected.length+
        " frozen evidence commit(s) are reachable from the selected checkpoint. Inspect the diffs, then record your verification note.";
      if(currentSnapshot.status==="submitted")
        document.getElementById("gbV4GithubApproval").classList.remove("hidden");
    }catch(error){
      githubVerification=null;
      verifyStatus.textContent=(error?.message||"GitHub verification failed")+
        ". Private repositories require the teacher's account-owned GitHub connection.";
    }finally{verifyButton.disabled=false;}
  }
  function updateScore(){
    if(!currentTask)return;
    let awarded=0,pending=0,total=0;
    document.querySelectorAll("#gbV4Rubric [data-rubric-row]").forEach((row,index)=>{
      const max=Number(currentTask.rubric[index]?.points||0);
      total+=max;
      awarded+=Number(row.querySelector("[data-awarded]").value||0);
      pending+=Number(row.querySelector("[data-pending]").value||0);
    });
    document.getElementById("gbV4ScoreSummary").textContent=
      awarded+" / "+total+(pending?" · "+pending+" pending":"");
  }
  function renderRubric(grade){
    const host=document.getElementById("gbV4Rubric");host.replaceChildren();
    const prior=Array.isArray(grade?.criteria)?grade.criteria:[];
    (currentTask?.rubric||[]).forEach((criterion,index)=>{
      const saved=prior[index]||{};
      const row=make("div","rounded-xl border border-slate-200 bg-slate-50 p-3");
      row.dataset.rubricRow=String(index);
      row.append(make("div","font-bold text-slate-900",criterion.name+" · "+criterion.points+" pts"));
      const grid=make("div","grid sm:grid-cols-2 gap-3 mt-2");
      const awardLabel=make("label","text-xs font-bold text-slate-700","Awarded points");
      const awarded=make("input","mt-1 w-full border border-slate-300 rounded-lg p-2");
      awarded.type="number";awarded.min="0";awarded.max=String(criterion.points);awarded.step="0.5";
      awarded.dataset.awarded="1";awarded.value=String(saved.awardedPoints??0);awardLabel.append(awarded);
      const pendingLabel=make("label","text-xs font-bold text-slate-700","Pending points");
      const pending=make("input","mt-1 w-full border border-slate-300 rounded-lg p-2");
      pending.type="number";pending.min="0";pending.max=String(criterion.points);pending.step="0.5";
      pending.dataset.pending="1";pending.value=String(saved.pendingPoints??0);pendingLabel.append(pending);
      grid.append(awardLabel,pendingLabel);row.append(grid);
      const feedbackLabel=make("label","block text-xs font-bold text-slate-700 mt-2","Criterion feedback");
      const comment=make("textarea","mt-1 w-full border border-slate-300 rounded-lg p-2");
      comment.rows=2;comment.maxLength=1000;comment.dataset.comment="1";comment.value=saved.comment||"";
      feedbackLabel.append(comment);row.append(feedbackLabel);
      awarded.addEventListener("input",updateScore);pending.addEventListener("input",updateScore);
      host.append(row);
    });
    document.getElementById("gbV4Feedback").value=grade?.feedback||"";
    updateScore();
  }
  function collectCriteria(){
    return [...document.querySelectorAll("#gbV4Rubric [data-rubric-row]")].map((row,index)=>{
      const awardedPoints=Number(row.querySelector("[data-awarded]").value||0);
      const pendingPoints=Number(row.querySelector("[data-pending]").value||0);
      const maximum=Number(currentTask.rubric[index].points||0);
      if(!Number.isFinite(awardedPoints)||!Number.isFinite(pendingPoints)||
        awardedPoints<0||pendingPoints<0||awardedPoints+pendingPoints>maximum)
        throw Error("Criterion "+(index+1)+" exceeds its "+maximum+" available points.");
      return {awardedPoints,pendingPoints,comment:row.querySelector("[data-comment]").value.trim()};
    });
  }
  async function openReview(row){
    if(busy||!currentTask)return;
    currentRow=row;currentSnapshot=null;currentGrade=null;
    document.getElementById("gbV4ReviewTitle").textContent=row.studentName||"Review student project";
    document.getElementById("gbV4ReviewMeta").textContent=
      currentTask.title+" · version "+row.version+" · "+row.status;
    document.getElementById("gbV4ReviewStatus").textContent="Loading frozen evidence and private grade draft…";
    document.getElementById("gbV4Code").textContent="Loading…";
    document.getElementById("gbV4File").replaceChildren();
    document.getElementById("gbV4Rubric").replaceChildren();
    document.getElementById("gbV4CorrectionReason").value="";
    document.getElementById("gbV4CorrectionPanel").classList.add("hidden");
    document.getElementById("gbV4StudioEvidence").classList.toggle("hidden",currentTask.submissionSource!=="studio");
    document.getElementById("gbV4GithubEvidence").classList.toggle("hidden",currentTask.submissionSource!=="github");
    document.getElementById("gbV4EvidenceType").textContent=
      currentTask.submissionSource==="github"?"Verified GitHub evidence":"Verified Studio submission";
    githubVerification=null;dialog.showModal();
    try{
      const evidenceApi=currentTask.submissionSource==="github"?githubEvidenceApi:submissionApi;
      const evidenceDetails=currentTask.submissionSource==="github"?
        {taskId:currentTask.taskId,evidenceId:row.recordId}:
        {taskId:currentTask.taskId,submissionId:row.recordId};
      const result=await Promise.all([
        scoped(evidenceApi,"inspect",evidenceDetails),
        scoped(gradeApi,"get_draft",{taskId:currentTask.taskId,studentUid:row.studentUid})
      ]);
      currentSnapshot=result[0];currentGrade=result[1].grade;
      if(currentTask.submissionSource==="studio"){
        const fileSelect=document.getElementById("gbV4File");
        for(const file of currentSnapshot.files||[])fileSelect.add(new Option(file.path,file.path));
        fileSelect.onchange=renderFile;renderFile();
        document.getElementById("gbV4Artifacts").textContent=
          JSON.stringify(currentSnapshot.artifacts||{},null,2);
      }else renderGithubEvidence(currentSnapshot);
      renderRubric(currentGrade);
      const revisionDue=document.getElementById("gbV4RevisionDue");
      const revisionDueLabel=document.getElementById("gbV4RevisionDueLabel");
      const originalDeadlinePassed=Number(currentTask.dueAt||0)>0&&Date.now()>Number(currentTask.dueAt);
      revisionDue.value="";
      revisionDue.required=originalDeadlinePassed;
      revisionDueLabel.textContent=originalDeadlinePassed?
        "Revision extension deadline (required because the original deadline passed)":
        "Extension deadline (optional before original deadline)";
      const published=currentGrade?.status==="published";
      const reopened=row.status==="reopened";
      refreshReviewControls();
      document.getElementById("gbV4ReviewStatus").textContent=published?
        (currentGrade?.gradeSchema==="legacy_scalar_v1"?
          "This imported historical grade preserves the original total but has no saved rubric breakdown. Reconstruct the breakdown without changing the score before any correction.":
          "This grade is published. Use the correction workflow for changes."):
        reopened?"A revision is already requested. Wait for the student to resubmit.":
        currentTask.submissionSource==="github"&&!["approved","reviewed"].includes(currentSnapshot.status)?
          "Verify and approve the exact frozen GitHub evidence before starting a grade draft.":
        currentGrade?.status==="draft"?"Private draft loaded. Review before publishing.":
        "No grade draft yet. Scores remain private until you save and publish.";
    }catch(error){
      document.getElementById("gbV4ReviewStatus").textContent=error?.message||"Review data unavailable.";
    }
  }
  document.getElementById("gbV4GithubVerify").addEventListener("click",()=>
    void verifyGithubEvidence());
  document.getElementById("gbV4GithubApprove").addEventListener("click",()=>void (async()=>{
    if(busy||currentTask?.submissionSource!=="github"||!currentSnapshot||!githubVerification)return;
    const note=document.getElementById("gbV4GithubApprovalNote").value.trim();
    if(note.length<12){
      document.getElementById("gbV4GithubVerifyStatus").textContent=
        "Add a verification note of at least 12 characters before approving evidence.";return;
    }
    if(!confirm("Approve this exact frozen repository checkpoint and commit set for grading?"))return;
    try{
      setBusy(true,"Recording teacher approval for the exact frozen GitHub evidence…");
      await scoped(githubEvidenceApi,"approve",{
        taskId:currentTask.taskId,evidenceId:currentRow.recordId,note,
        verifiedCheckpointSha:githubVerification.verifiedCheckpointSha,
        verifiedCommitShas:githubVerification.verifiedCommitShas
      });
      currentSnapshot={...currentSnapshot,status:"approved"};
      currentRow={...currentRow,status:"approved"};
      document.getElementById("gbV4GithubApproval").classList.add("hidden");
      document.getElementById("gbV4GithubVerifyStatus").textContent=
        "Evidence approved for grading. The exact commit set and checkpoint are frozen in the audit record.";
      refreshReviewControls();
      document.getElementById("gbV4ReviewStatus").textContent=
        "GitHub evidence approved. You can now save a private rubric draft.";
      await loadInbox();
    }catch(error){
      document.getElementById("gbV4GithubVerifyStatus").textContent=
        error?.message||"Evidence approval was not recorded.";
    }finally{setBusy(false);}
  })());
  document.getElementById("gbV4Close").addEventListener("click",()=>dialog.close());
  taskSelect.addEventListener("change",()=>void loadInbox());
  document.getElementById("gbV4Refresh").addEventListener("click",()=>void loadInbox());
  document.getElementById("gbV4SaveDraft").addEventListener("click",()=>void (async()=>{
    if(busy||!currentTask||!currentRow||!currentSnapshot)return;
    try{
      const criteria=collectCriteria();
      setBusy(true,"Saving private rubric draft…");
      await scoped(gradeApi,"save_draft",{
        taskId:currentTask.taskId,studentUid:currentRow.studentUid,
        submissionVersion:currentSnapshot.version,criteria,
        feedback:document.getElementById("gbV4Feedback").value.trim()
      });
      const refreshed=await scoped(gradeApi,"get_draft",{taskId:currentTask.taskId,studentUid:currentRow.studentUid});
      currentGrade=refreshed.grade;renderRubric(currentGrade);
      refreshReviewControls();
      document.getElementById("gbV4ReviewStatus").textContent=
        "Private draft saved against frozen submission version "+currentSnapshot.version+".";
    }catch(error){
      document.getElementById("gbV4ReviewStatus").textContent=error?.message||"Grade draft was not saved.";
    }finally{setBusy(false);}
  })());
  document.getElementById("gbV4Publish").addEventListener("click",()=>void (async()=>{
    if(busy||!currentTask||!currentRow)return;
    if(!confirm("Publish this reviewed grade to the student? The current V4 workflow does not allow ordinary edits after publication."))return;
    try{
      setBusy(true,"Verifying current submission and publishing grade…");
      const result=await scoped(gradeApi,"publish",{taskId:currentTask.taskId,studentUid:currentRow.studentUid});
      document.getElementById("gbV4ReviewStatus").textContent="Published "+result.awarded+" / "+result.total+" to the student.";
      currentGrade={...(currentGrade||{}),status:"published"};
      currentRow={...currentRow,status:"reviewed"};
      currentSnapshot={...(currentSnapshot||{}),status:"reviewed"};
      refreshReviewControls();
      await loadInbox();
    }catch(error){
      document.getElementById("gbV4ReviewStatus").textContent=error?.message||"Grade was not published.";
    }finally{setBusy(false);}
  })());
  document.getElementById("gbV4ConvertLegacy").addEventListener("click",()=>void (async()=>{
    if(busy||!currentTask||!currentRow||currentGrade?.status!=="published"||
       currentGrade?.gradeSchema!=="legacy_scalar_v1")return;
    const reason=document.getElementById("gbV4CorrectionReason").value.trim();
    if(reason.length<12){
      document.getElementById("gbV4ReviewStatus").textContent=
        "Explain how you reconstructed the historical rubric breakdown in at least 12 characters.";return;
    }
    let criteria;
    try{criteria=collectCriteria();}catch(error){
      document.getElementById("gbV4ReviewStatus").textContent=error.message;return;
    }
    if(criteria.some(item=>item.pendingPoints>0)){
      document.getElementById("gbV4ReviewStatus").textContent=
        "Historical rubric reconstruction cannot leave pending points.";return;
    }
    const awarded=criteria.reduce((sum,item)=>sum+item.awardedPoints,0);
    const total=(currentTask.rubric||[]).reduce((sum,item)=>sum+Number(item.points||0),0);
    if(Math.abs(awarded-Number(currentGrade.awarded))>0.000001||
       Math.abs(total-Number(currentGrade.total))>0.000001){
      document.getElementById("gbV4ReviewStatus").textContent=
        "The reconstructed rubric must total exactly "+currentGrade.awarded+" / "+currentGrade.total+
        ". Convert the historical breakdown first; score changes belong in a separate correction.";return;
    }
    if(!confirm("Reconstruct the missing historical rubric breakdown while preserving the exact published score?"))return;
    try{
      setBusy(true,"Verifying frozen evidence and reconstructing the historical rubric breakdown…");
      const result=await scoped(gradeApi,"convert_legacy_published",{
        taskId:currentTask.taskId,studentUid:currentRow.studentUid,
        expectedRevision:currentGrade.revision,criteria,reason
      });
      const refreshed=await scoped(gradeApi,"get_draft",{
        taskId:currentTask.taskId,studentUid:currentRow.studentUid
      });
      currentGrade=refreshed.grade;renderRubric(currentGrade);refreshReviewControls();
      document.getElementById("gbV4CorrectionReason").value="";
      document.getElementById("gbV4ReviewStatus").textContent=
        "Historical rubric breakdown reconstructed at "+result.awarded+" / "+result.total+
        ". The original imported revision remains in audit history.";
    }catch(error){
      document.getElementById("gbV4ReviewStatus").textContent=
        error?.message||"Historical rubric reconstruction was not recorded.";
    }finally{setBusy(false);}
  })());
  document.getElementById("gbV4Correct").addEventListener("click",()=>void (async()=>{
    if(busy||!currentTask||!currentRow||currentGrade?.status!=="published")return;
    const reason=document.getElementById("gbV4CorrectionReason").value.trim();
    if(reason.length<12){
      document.getElementById("gbV4ReviewStatus").textContent=
        "Explain why this published grade is being corrected in at least 12 characters.";return;
    }
    let criteria;
    try{criteria=collectCriteria();}catch(error){
      document.getElementById("gbV4ReviewStatus").textContent=error.message;return;
    }
    if(criteria.some(item=>item.pendingPoints>0)){
      document.getElementById("gbV4ReviewStatus").textContent=
        "Resolve all pending rubric points before correcting a published grade.";return;
    }
    if(!confirm("Record a new published-grade revision? The prior published revision will remain in audit history."))return;
    try{
      setBusy(true,"Verifying the frozen submission and recording the published-grade correction…");
      const result=await scoped(gradeApi,"correct_published",{
        taskId:currentTask.taskId,studentUid:currentRow.studentUid,
        expectedRevision:currentGrade.revision,criteria,
        feedback:document.getElementById("gbV4Feedback").value.trim(),reason
      });
      const refreshed=await scoped(gradeApi,"get_draft",{
        taskId:currentTask.taskId,studentUid:currentRow.studentUid
      });
      currentGrade=refreshed.grade;
      renderRubric(currentGrade);refreshReviewControls();
      document.getElementById("gbV4CorrectionReason").value="";
      document.getElementById("gbV4ReviewStatus").textContent=
        "Published grade corrected to "+result.awarded+" / "+result.total+
        ". The earlier published revision remains in history.";
    }catch(error){
      document.getElementById("gbV4ReviewStatus").textContent=
        error?.message||"Published-grade correction was not recorded.";
    }finally{setBusy(false);}
  })());
  document.getElementById("gbV4RequestRevision").addEventListener("click",()=>void (async()=>{
    if(busy||!currentTask||!currentRow)return;
    const reason=document.getElementById("gbV4RevisionReason").value.trim();
    if(reason.length<12){
      document.getElementById("gbV4ReviewStatus").textContent="Explain the revision request in at least 12 characters.";return;
    }
    const raw=document.getElementById("gbV4RevisionDue").value;
    const originalDeadlinePassed=Number(currentTask.dueAt||0)>0&&Date.now()>Number(currentTask.dueAt);
    if(originalDeadlinePassed&&!raw){
      document.getElementById("gbV4ReviewStatus").textContent=
        "The original deadline passed. Choose an explicit revision extension deadline.";return;
    }
    const extensionDueAt=raw?localIso(raw):null;
    if(raw&&!extensionDueAt){
      document.getElementById("gbV4ReviewStatus").textContent="Choose a valid revision extension deadline.";return;
    }
    if(!confirm("Reopen this frozen submission for a student revision?"))return;
    try{
      setBusy(true,"Requesting a new student revision…");
      const evidenceApi=currentTask.submissionSource==="github"?githubEvidenceApi:submissionApi;
      const identity=currentTask.submissionSource==="github"?
        {evidenceId:currentRow.recordId}:{submissionId:currentRow.recordId};
      await scoped(evidenceApi,"request_revision",{
        taskId:currentTask.taskId,...identity,reason,extensionDueAt
      });
      currentRow={...currentRow,status:"reopened"};
      currentSnapshot={...(currentSnapshot||{}),status:"reopened"};
      refreshReviewControls();
      document.getElementById("gbV4ReviewStatus").textContent="Revision requested. The current submission remains preserved in history.";
      await loadInbox();
    }catch(error){
      document.getElementById("gbV4ReviewStatus").textContent=error?.message||"Revision request was not saved.";
    }finally{setBusy(false);}
  })());

  await auth.authStateReady();
  if(auth.currentUser){
    picker=createTenantSchoolPicker({
      host:document.getElementById("gbV4SchoolSwitcher"),status:null,
      onReady:()=>void loadTasks(),
      onBeforeChange:async()=>{
        if(busy||dialog.open)throw Error("Close the current review before switching schools.");
        generation++;tasks.clear();taskSelect.replaceChildren();inbox.replaceChildren();
      }
    });
    try{
      const state=await picker.load();
      if(state?.state==="choose_school"){
        panel.classList.remove("hidden");
        status.textContent="Choose an active school to load your Gradebook.";
      }
    }catch(error){
      console.warn("Verified school Gradebook unavailable:",error?.message||error);
    }
  }
}
