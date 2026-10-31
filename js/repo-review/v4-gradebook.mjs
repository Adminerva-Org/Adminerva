import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

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
  const gradeApi=httpsCallable(functions,"schoolGradebook");
  let picker=null,tasks=new Map(),currentTask=null,currentRow=null,currentSnapshot=null,currentGrade=null;
  let generation=0,busy=false;

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
    document.getElementById("gbV4SaveDraft").disabled=
      busy||!loaded||published||reopened;
    document.getElementById("gbV4Publish").disabled=
      busy||!loaded||published||reopened||currentGrade?.status!=="draft";
    document.getElementById("gbV4RequestRevision").disabled=
      busy||!loaded||published||reopened;
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
    const items=(result.assessments||[]).filter(item=>item.submissionSource==="studio"&&item.status==="deployed");
    tasks=new Map(items.map(item=>[item.taskId,item]));
    taskSelect.replaceChildren();
    const start=new Option(items.length?"Choose an assessment…":"No deployed Studio assessments","");
    start.disabled=true;start.selected=true;taskSelect.add(start);
    for(const task of items){
      const label=task.title+" · "+(task.sectionId||"class")+" · "+(task.subjectId||"subject");
      taskSelect.add(new Option(label,task.taskId));
    }
    panel.classList.remove("hidden");
    inbox.replaceChildren();
    status.textContent=items.length?
      items.length+" deployed Studio assessment"+(items.length===1?"":"s")+" available.":
      "No verified Studio assessments owned by this teacher in the active school.";
  }
  async function loadInbox(){
    const task=tasks.get(taskSelect.value);
    currentTask=task||null;inbox.replaceChildren();
    if(!task){status.textContent="Choose an assessment to load submissions.";return;}
    const token=++generation;
    status.textContent="Loading frozen Studio submissions…";
    try{
      const result=await scoped(submissionApi,"inbox",{taskId:task.taskId});
      if(token!==generation)return;
      const rows=result.submissions||[];
      status.textContent=rows.length?
        rows.length+" submitted project"+(rows.length===1?"":"s")+" loaded.":
        "No student Studio submissions yet for this assessment.";
      if(!rows.length){
        inbox.append(make("div","rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600",
          "Students will appear here after a verified project version is submitted."));
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
        const button=make("button","rounded-lg bg-indigo-700 text-white font-bold px-4 py-2.5 text-sm","Review frozen project");
        button.type="button";button.addEventListener("click",()=>void openReview(row));
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
    document.getElementById("gbV4ReviewStatus").textContent="Loading frozen project and private grade draft…";
    document.getElementById("gbV4Code").textContent="Loading…";
    document.getElementById("gbV4File").replaceChildren();
    document.getElementById("gbV4Rubric").replaceChildren();
    dialog.showModal();
    try{
      const result=await Promise.all([
        scoped(submissionApi,"inspect",{taskId:currentTask.taskId,submissionId:row.submissionId}),
        scoped(gradeApi,"get_draft",{taskId:currentTask.taskId,studentUid:row.studentUid})
      ]);
      currentSnapshot=result[0];currentGrade=result[1].grade;
      const fileSelect=document.getElementById("gbV4File");
      for(const file of currentSnapshot.files||[])fileSelect.add(new Option(file.path,file.path));
      fileSelect.onchange=renderFile;renderFile();
      document.getElementById("gbV4Artifacts").textContent=
        JSON.stringify(currentSnapshot.artifacts||{},null,2);
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
        "This grade is published. Use the future correction workflow for changes.":
        reopened?"A revision is already requested. Wait for the student to resubmit.":
        currentGrade?.status==="draft"?"Private draft loaded. Review before publishing.":
        "No grade draft yet. Scores remain private until you save and publish.";
    }catch(error){
      document.getElementById("gbV4ReviewStatus").textContent=error?.message||"Review data unavailable.";
    }
  }
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
      refreshReviewControls();
      await loadInbox();
    }catch(error){
      document.getElementById("gbV4ReviewStatus").textContent=error?.message||"Grade was not published.";
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
      await scoped(submissionApi,"request_revision",{
        taskId:currentTask.taskId,submissionId:currentRow.submissionId,
        reason,extensionDueAt
      });
      currentRow={...currentRow,status:"reopened"};
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
