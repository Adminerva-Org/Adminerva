import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";
import {createGithubEvidenceClient} from "./services/github-evidence-client.mjs?v=1.3.0";
import {buildV4RepositoryEvaluationSnapshot} from "./services/v4-repository-evidence.mjs?v=20261123-revisionless-save-1";
import {activateConnectionOwner} from "../core/connection-cache.mjs?v=1.3.0";
import {buildGeneralExternalEvaluationPackage,parseGeneralExternalEvaluationResponse} from "../assessment/general-external-evaluation.mjs?v=20261121-universal-bulk20-1";
import {generateSchoolContent} from "../core/school-ai.mjs?v=1.3.0";
import {evaluationJSON} from "./services/request-backoff.mjs?v=1.3.0";
import {clearEvaluationReview,renderEvaluationReview} from "../assessment/evaluation-review-ui.mjs?v=1.0.0";
import {createV4BulkEvaluationController} from "./v4-bulk-evaluation.mjs?v=20261123-revisionless-save-1";

const panel=document.getElementById("gbV4Panel");
const taskSelect=document.getElementById("gbV4Task");
const inbox=document.getElementById("gbV4Inbox");
const status=document.getElementById("gbV4Status");
const dialog=document.getElementById("gbV4ReviewDialog");
const bulkPublish=document.getElementById("gbV4BulkPublish");

function make(tag,className,text){
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(text!==undefined)element.textContent=String(text);
  return element;
}
function sourceLabel(source){
  return ({text:"Written response",link:"Submission link",studio:"Adminerva Studio",github:"GitHub / repository evidence"})[source]||"Assessment response";
}
function sourceApi(source,{studio,general,github}){
  return source==="github"?github:source==="studio"?studio:general;
}
function localIso(value){
  if(!value)return null;
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toISOString():null;
}
if(panel&&taskSelect&&inbox&&status&&dialog){
  const pageParams=new URL(location.href).searchParams;
  const view=pageParams.get("view")||"review";
  const requestedOfferingId=String(pageParams.get("offeringId")||"");
  function syncGradebookUrl(task){
    const url=new URL(location.href);url.searchParams.set("view",view);
    if(task?.taskId)url.searchParams.set("task",task.taskId);else url.searchParams.delete("task");
    if(task?.offeringId)url.searchParams.set("offeringId",task.offeringId);
    else if(!requestedOfferingId)url.searchParams.delete("offeringId");
    history.replaceState(null,"",url.pathname+"?"+url.searchParams.toString()+url.hash);
  }
  const requestedStudentUid=String(pageParams.get("studentUid")||"");
  const viewCopy={
    submissions:["Submissions","Inspect frozen learner responses and open the exact submitted version when review is needed."],
    review:["Review & Grade","Review immutable assessment evidence, save grade drafts, and publish deliberately."],
    results:["Assessment Results","Review saved draft/published outcomes and open any learner result against its frozen submission."]
  }[view]||["Review & Grade","Review immutable assessment evidence, save grade drafts, and publish deliberately."];
  const pageTitle=document.getElementById("gbV4PageTitle"),pageDescription=document.getElementById("gbV4PageDescription");
  if(pageTitle)pageTitle.textContent=viewCopy[0];
  if(pageDescription)pageDescription.textContent=viewCopy[1];
  document.querySelectorAll('nav[aria-label="Assessment workflow views"] a').forEach(link=>{
    const target=new URL(link.href,location.href);
    const active=target.searchParams.get("view")===view;
    if(requestedOfferingId)target.searchParams.set("offeringId",requestedOfferingId);
    link.href=target.pathname+target.search+target.hash;
    link.classList.toggle("bg-cyan-900",active);
    if(active)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");
  });

  const functions=getFunctions(app,"asia-southeast1");
  const assessmentApi=httpsCallable(functions,"schoolAssessments");
  const migrationApi=httpsCallable(functions,"schoolAssessmentMigration");
  const submissionApi=httpsCallable(functions,"schoolStudioSubmissions");
  const generalSubmissionApi=httpsCallable(functions,"schoolAssessmentSubmissions");
  const githubEvidenceApi=httpsCallable(functions,"schoolGithubEvidence");
  const gradeApi=httpsCallable(functions,"schoolGradebook");
  const classRecordApi=httpsCallable(functions,"schoolClassRecord");
  const verificationApi=httpsCallable(functions,"studioSubmissionVerification");
  const conversationApi=httpsCallable(functions,"schoolAssessmentConversation");
  let picker=null,tasks=new Map(),currentTask=null,currentRow=null,currentSnapshot=null,currentGrade=null,currentPrivateConfig=null,currentConversation=null,currentClassRecordStatus=null;
  let generation=0,busy=false,githubVerification=null,currentDraftSource="teacher",reviewNeedsRefresh=false,pendingStudentDeepLink=requestedStudentUid;
  let bulkEvaluator=null;
  function clearTaskContext(){bulkEvaluator?.reset();currentTask=null;currentRow=null;currentSnapshot=null;currentGrade=null;currentPrivateConfig=null;currentConversation=null;currentClassRecordStatus=null;githubVerification=null;reviewNeedsRefresh=false;inbox.replaceChildren();renderClassRecordHandoff();if(bulkPublish){bulkPublish.dataset.ready="false";bulkPublish.disabled=true;bulkPublish.textContent="Publish all drafts (0)";}}

  async function scoped(api,action,details={}){
    if(!picker?.scope.current)throw Error("Choose a verified school first.");
    const lease=picker.scope.lease();
    const result=(await api({schoolId:lease.schoolId,action,...details})).data;
    picker.scope.assertLease(lease);
    return result;
  }
  function renderClassRecordHandoff(){
    const panel=document.getElementById("gbV4ClassRecordHandoff"),
      copy=document.getElementById("gbV4ClassRecordStatus"),
      link=document.getElementById("gbV4ClassRecordLink");
    if(!panel||!copy||!link)return;
    if(!currentTask){panel.hidden=true;return;}
    if(currentTask.legacyCompatibility){
      const classId=currentTask.legacyOfferingId||requestedOfferingId;
      panel.hidden=!classId;
      if(!classId)return;
      link.href="class-record.html?"+new URLSearchParams({
        offering:classId,assessment:currentTask.legacyAssessmentId,source:"legacy_historical"
      }).toString();
      link.textContent="Open historical Class Record";
      copy.textContent="This original historical assessment retains its grades and submissions. "+
        "The assigned teacher may link it to the official Class Record after confirming the "+
        "academic period and School Admin-verified custody. Existing scores are not copied.";
      return;
    }
    panel.hidden=false;
    link.href="class-record.html?"+new URLSearchParams({
      offering:currentTask.offeringId,assessment:currentTask.taskId,source:"school"
    }).toString();
    const state=currentClassRecordStatus?.status;
    if(state==="linked"){
      const column=currentClassRecordStatus.column;
      copy.textContent=(column?.label||currentTask.title)+" is already linked"+
        (column?.category?" under "+column.category:"")+". Published Gradebook results project into that Class Record column.";
      link.textContent="Open linked Class Record";
    }else if(state==="archived"){
      copy.textContent="This assessment has an archived Class Record column. Review the record before creating another grading column.";
      link.textContent="Review Class Record";
    }else if(state==="unlinked"){
      copy.textContent="This assessment is not yet part of the official Class Record. Add it once, choose its grading category, and published results will project automatically.";
      link.textContent="Add to Class Record";
    }else{
      copy.textContent="Checking whether this assessment is linked to the official Class Record…";
      link.textContent="Open Class Record";
    }
  }
  function renderConversation(){
    const host=document.getElementById("gbV4Conversation"),form=document.getElementById("gbV4ConversationForm"),
      statusNode=document.getElementById("gbV4ConversationStatus");
    host.replaceChildren();
    const messages=currentConversation?.messages||[];
    if(!currentConversation){
      host.append(make("p","text-sm text-slate-500","Private messages are unavailable until the learner review loads."));
      statusNode.textContent="";form.hidden=true;return;
    }
    form.hidden=false;
    if(!messages.length)host.append(make("p","text-sm text-slate-500","No private messages yet. Start a learner-specific conversation here."));
    for(const message of messages){
      const mine=message.authorUid===auth.currentUser?.uid,row=make("div","rounded-lg border p-3 "+(mine?"border-cyan-200 bg-cyan-50":"border-slate-200 bg-slate-50"));
      row.append(make("p","text-xs font-bold "+(mine?"text-cyan-800":"text-slate-600"),(mine?"You":message.authorName||"Learner")+" · "+(message.createdAt?new Date(message.createdAt).toLocaleString():"")),
        make("p","mt-1 text-sm text-slate-800 whitespace-pre-wrap break-words",message.body||""));
      host.append(row);
    }
    host.scrollTop=host.scrollHeight;
    statusNode.textContent=currentConversation.canSend===false?"This assessment conversation is closed.":"Messages are private to this learner and the currently responsible teacher.";
    const body=document.getElementById("gbV4ConversationBody"),send=document.getElementById("gbV4ConversationSend");
    body.disabled=busy||currentConversation.canSend===false;send.disabled=busy||currentConversation.canSend===false;
  }
  async function reloadConversation(){
    if(!currentTask||!currentRow)return;
    try{
      currentConversation=await scoped(conversationApi,"list",{taskId:currentTask.taskId,studentUid:currentRow.studentUid});
    }catch(error){
      currentConversation={messages:[],canSend:false,error:error?.message||"Private messages unavailable"};
      document.getElementById("gbV4ConversationStatus").textContent=currentConversation.error;
    }
    renderConversation();
  }
  function refreshReviewControls(){
    const published=currentGrade?.status==="published";
    const reopened=currentRow?.status==="reopened";
    const loaded=Boolean(currentTask&&currentRow&&currentSnapshot&&!reviewNeedsRefresh);
    const evidenceReady=currentTask?.submissionSource!=="github"||
      (["submitted","approved","reviewed"].includes(currentSnapshot?.status)&&
        currentSnapshot?.hasSubmission!==false&&
        (currentSnapshot?.selectedCommitShas?.length||0)>0);
    const readThrough=Boolean(currentTask?.legacyCompatibility);
    const historicalGithub=readThrough&&currentTask?.submissionSource==="github";
    const historicalScalar=historicalGithub&&currentGrade?.gradeSchema==="legacy_scalar_v1";
    const legacyScalar=currentGrade?.gradeSchema==="legacy_scalar_v1"&&!readThrough;
    document.getElementById("gbV4SaveDraft").disabled=
      busy||!loaded||!evidenceReady||published||reopened||legacyScalar;
    document.getElementById("gbV4Publish").disabled=
      busy||!loaded||published||reopened||currentGrade?.status!=="draft"||legacyScalar||historicalScalar;
    document.getElementById("gbV4RequestRevision").disabled=
      busy||!loaded||published||reopened||readThrough;
    document.getElementById("gbV4Correct").disabled=busy||!loaded||!published||legacyScalar||readThrough;
    const convert=document.getElementById("gbV4ConvertLegacy");
    convert.disabled=busy||!loaded||!legacyScalar||readThrough;
    document.getElementById("gbV4LegacyGradePanel").hidden=!legacyScalar||readThrough;
    document.getElementById("gbV4CorrectionPanel").classList.toggle("hidden",!published||legacyScalar||readThrough);
    document.getElementById("gbV4Refresh").disabled=busy;
    if(bulkPublish)bulkPublish.disabled=busy||bulkPublish.dataset.ready!=="true";
    if(document.getElementById("gbV4ConversationForm"))renderConversation();
  }
  function setBusy(value,message=""){
    busy=value;taskSelect.disabled=value;document.getElementById("gbV4Close").disabled=value;refreshReviewControls();
    if(message)document.getElementById("gbV4ReviewStatus").textContent=message;
  }
  // Shared GitHub evidence preparation for both single and bulk grading.
  // The student-submitted frozen checkpoint, not a moving branch, controls source.
  let githubClient=null,githubClientOwner="";
  async function prepareGithubEvaluation({task,snapshot}){
    if(!["submitted","approved","reviewed"].includes(snapshot?.status)||
       snapshot?.hasSubmission===false||!snapshot?.selectedCommitShas?.length)
      throw Error("No student-submitted commits are available. Instructor discoveries do not authorize grades.");
    if(!auth.currentUser)throw Error("Sign in again before reviewing repository evidence.");
    const owner=auth.currentUser.uid;
    if(!githubClient||githubClientOwner!==owner){
      const prefs=activateConnectionOwner(owner)||{};
      githubClient=createGithubEvidenceClient({
        token:prefs.githubToken||null,maxPages:10,maxCommitFilesPages:10,retryCount:1
      });
      githubClientOwner=owner;
    }
    const historical=Boolean(task?.legacyCompatibility);
    const selected=Array.isArray(snapshot.selectedCommitShas)?snapshot.selectedCommitShas:[];
    const verified=Array.isArray(snapshot.verifiedContributionCommits)?
      snapshot.verifiedContributionCommits:[];
    if(historical&&verified.some(sha=>!selected.includes(sha)))
      throw Error("Existing verified commit annotations do not match the frozen student submission.");
    const evaluationEvidence=historical&&verified.length?
      {...snapshot,selectedCommitShas:verified}:snapshot;
    const result=await buildV4RepositoryEvaluationSnapshot({
      snapshot:evaluationEvidence,client:githubClient
    });
    if(historical&&verified.length&&verified.length!==selected.length)
      result.limitations.push((selected.length-verified.length)+
        " selected historical commit(s) were excluded by the existing narrower teacher annotation.");
    if(result.analysis.substantiveChanges===0&&result.analysis.uncertainChanges===0)
      throw Error("No substantive code changes were detected in this submitted commit selection. Inspect the GitHub diff individually; no bulk grade is inferred.");
    return result;
  }

  bulkEvaluator=createV4BulkEvaluationController({
    root:document.getElementById("gbV4BulkPanel"),
    scoped,migrationApi,assessmentApi,submissionApi,generalSubmissionApi,githubEvidenceApi,
    gradeApi,verificationApi,prepareGithubEvidence:prepareGithubEvaluation,
    buildPackage:buildGeneralExternalEvaluationPackage,
    parseResponse:parseGeneralExternalEvaluationResponse,
    generateContent:generateSchoolContent,evaluationJSON,
    setBusy,isBusy:()=>busy||dialog.open,
    onSaved:()=>loadInbox()
  });
  async function loadTasks(){
    const token=++generation,previous=taskSelect.value;
    clearTaskContext();tasks.clear();taskSelect.replaceChildren(new Option("Loading assessments…",""));taskSelect.disabled=true;
    status.textContent="Loading your verified school assessments…";
    const [result,legacyResult]=await Promise.all([
      scoped(assessmentApi,"list_teacher"),
      scoped(migrationApi,"list_legacy_deployments").catch(()=>({items:[]}))
    ]);
    if(token!==generation)return;
    const v4Items=(result.assessments||[]).filter(item=>
      ["studio","github","text","link"].includes(item.submissionSource)&&item.status==="deployed"&&
      (!requestedOfferingId||item.offeringId===requestedOfferingId));
    const legacyItems=(legacyResult.items||[]).filter(item=>
      !requestedOfferingId||item.legacyOfferingId===requestedOfferingId).map(item=>({
      taskId:"legacy:"+item.legacyAssessmentId+
        (item.legacyOfferingId?"@"+item.legacyOfferingId:""),
      legacyAssessmentId:item.legacyAssessmentId,
      legacyOfferingId:item.legacyOfferingId||"",
      custodyApproved:item.custodyApproved===true,
      legacyCompatibility:true,
      title:item.title,
      subject:item.subject||"Computer Programming",
      assessmentType:item.type||"Assessment",
      submissionSource:item.submissionSource||"github",
      published:item.published===true,
      status:"deployed",
      deploymentCount:item.deploymentCount||0,
      legacyDeployments:Array.isArray(item.deployments)?item.deployments:[]
    }));
    const items=[...v4Items,...legacyItems];
    tasks=new Map(items.map(item=>[item.taskId,item]));
    taskSelect.replaceChildren();
    const start=new Option(items.length?"Choose an assessment…":"No deployed V4 assessments","");
    start.disabled=true;start.selected=true;taskSelect.add(start);
    for(const task of items){
      const label=(task.legacyCompatibility?"Historical · ":"")+sourceLabel(task.submissionSource)+" · "+task.title+" · "+
        (task.legacyCompatibility?(task.deploymentCount+" deployment"+(task.deploymentCount===1?"":"s")):(task.sectionId||"class"))+
        " · "+(task.subject||task.subjectId||"subject");
      taskSelect.add(new Option(label,task.taskId));
    }
    panel.classList.remove("hidden");
    inbox.replaceChildren();
    const legacyCount=legacyItems.length,v4Count=v4Items.length;
    status.textContent=items.length?
      (v4Count+" V4 deployment"+(v4Count===1?"":"s")+" · "+legacyCount+" historical deployment"+(legacyCount===1?"":"s")+" available."):
      "No deployed school assessments owned by this teacher in the active school." ;
    taskSelect.disabled=busy;
    const requested=previous||pageParams.get("task");
    if(requested&&tasks.has(requested)){
      taskSelect.value=requested;
      await loadInbox();
    }else if(requestedOfferingId&&v4Items.length===1){
      taskSelect.value=v4Items[0].taskId;
      await loadInbox();
    }
  }
  async function loadInbox(){
    const token=++generation;
    const task=tasks.get(taskSelect.value);
    syncGradebookUrl(task||null);
    currentTask=task||null;currentClassRecordStatus=null;inbox.replaceChildren();renderClassRecordHandoff();
    if(bulkPublish){bulkPublish.dataset.ready="false";bulkPublish.disabled=true;bulkPublish.textContent="Publish all drafts (0)";}
    if(!task){bulkEvaluator?.reset();status.textContent="Choose an assessment to load submissions.";return;}
    status.textContent="Loading frozen "+sourceLabel(task.submissionSource).toLowerCase()+" submissions…";
    try{
      const historicalStudio=task.legacyCompatibility&&task.submissionSource==="studio";
      const historicalGithub=task.legacyCompatibility&&task.submissionSource==="github";
      const historical=historicalStudio||historicalGithub;
      const evidenceApi=sourceApi(task.submissionSource,{
        studio:submissionApi,general:generalSubmissionApi,github:githubEvidenceApi
      });
      let result,resultData=null,classRecordStatus={status:"unavailable"};
      if(historical){
        result=await scoped(migrationApi,historicalStudio?"legacy_review_inbox":"legacy_github_inbox",{
          legacyAssessmentId:task.legacyAssessmentId,
          ...(task.legacyOfferingId?{legacyOfferingId:task.legacyOfferingId}:{})
        });
        currentTask={...task,...result.task};
      }else{
        [result,resultData,classRecordStatus]=await Promise.all([
          scoped(evidenceApi,"inbox",{taskId:task.taskId}),
          scoped(gradeApi,"list_task_results",{taskId:task.taskId}),
          scoped(classRecordApi,"assessment_link_status",{offeringId:task.offeringId,taskId:task.taskId})
            .catch(error=>({status:"unavailable",error:error?.message||"Class Record status unavailable"}))
        ]);
        currentClassRecordStatus=classRecordStatus;renderClassRecordHandoff();
      }
      if(token!==generation)return;
      currentClassRecordStatus=classRecordStatus;renderClassRecordHandoff();
      let rows=task.submissionSource==="github"?(result.evidence||[]):(result.submissions||[]);
      const gradeMap=new Map(historical?
        rows.filter(item=>item.gradeStatus).map(item=>[item.studentUid,{
          studentUid:item.studentUid,status:item.gradeStatus,awarded:item.awarded,
          total:currentTask.rubric.reduce((sum,part)=>sum+Number(part.points),0),pending:0
        }]):
        (resultData.results||[]).map(item=>[item.studentUid,item]));
      if(view==="results")rows=[...rows].sort((a,b)=>{
        const rank=value=>value==="published"?0:value==="draft"?1:2;
        return rank(gradeMap.get(a.studentUid)?.status)-rank(gradeMap.get(b.studentUid)?.status)||
          String(a.studentName||"").localeCompare(String(b.studentName||""));
      });
      const published=[...gradeMap.values()].filter(item=>item.status==="published").length;
      const draftRows=[...gradeMap.values()].filter(item=>item.status==="draft");
      const drafts=draftRows.length;
      const publishableDrafts=draftRows.filter(item=>Number(item.awarded)>0&&Number(item.pending||0)===0).length;
      const zeroDrafts=draftRows.filter(item=>Number(item.awarded)===0).length;
      if(bulkPublish){
        bulkPublish.dataset.ready=publishableDrafts?"true":"false";
        bulkPublish.disabled=busy||!publishableDrafts;
        bulkPublish.textContent="Publish all drafts ("+publishableDrafts+")";
        bulkPublish.title=zeroDrafts
          ?zeroDrafts+" zero-score draft"+(zeroDrafts===1?" is":"s are")+" excluded from bulk publication."
          :"Publish every valid non-zero draft for this assessment.";
      }
      bulkEvaluator?.onInbox({
        task:currentTask,rows,gradeMap,
        schoolId:picker.scope.current?.schoolId||picker.scope.lease().schoolId
      });
      if(historicalGithub){
        const notice=make("section","rounded-xl border border-violet-200 bg-violet-50 p-3 sm:p-4 text-sm");
        notice.append(make("h3","font-bold text-violet-950","Historical GitHub evidence · V4 review interface"));
        notice.append(make("p","text-violet-900 mt-1",
          "Actual student-submitted commit selections are eligible for V4 grading. Historical teacher-discovered repository snapshots are retained as context but excluded from new grades, even if previously approved. Existing historical grades are preserved. "+
          (result.coverage?result.coverage.gradeCount+" original grade records ("+
            result.coverage.publishedCount+" published, "+result.coverage.draftCount+" draft) · "+
            result.coverage.evidenceCount+" evidence records · "+
            result.coverage.evidenceWithoutGrade+" evidence-only · "+
            result.coverage.gradeOnly+" grade-only.":"")));
        inbox.append(notice);
      }
      if(historicalStudio){
        const notice=make("section","rounded-xl border border-violet-200 bg-violet-50 p-3 sm:p-4 text-sm");
        notice.append(make("h3","font-bold text-violet-950",
          "Historical Studio evidence · V4 review interface"));
        notice.append(make("p","text-violet-900 mt-1",
          "Frozen code and grades are read from the original submission records. No student files, variants, or grades have been copied into school V4 collections."));
        const button=make("button",
          "mt-3 rounded-lg border border-violet-300 px-3 py-2 font-bold text-violet-950 focus-visible:outline-2",
          "Check migration readiness");
        button.type="button";
        const output=make("p","mt-2 text-xs text-violet-900");
        output.setAttribute("role","status");output.setAttribute("aria-live","polite");
        button.addEventListener("click",()=>void (async()=>{
          button.disabled=true;output.textContent="Verifying original student identities, class placements, and submitted source…";
          try{
            const result=await scoped(migrationApi,"preview_evidence_migration",{
              legacyAssessmentId:task.legacyAssessmentId
            });
            const counts=result.checked+" historical submission(s) checked · "+
              result.identityAndClassMatched+" identity/class match(es) · "+
              result.needsAttention+" need confirmed historical term and/or record mapping.";
            const issues=new Map();
            for(const row of result.rows||[])
              for(const reason of row.blockers||[])
                issues.set(reason,(issues.get(reason)||0)+1);
            output.textContent=counts+" "+
              ([...issues].map(([reason,count])=>count+" "+reason.replaceAll("_"," ")).join("; ")||
              "No blocking identity issues found.")+
              " This is a read-only preview; no historical record is modified.";
          }catch(error){
            output.textContent=error?.message||"Migration readiness could not be verified.";
          }finally{button.disabled=false;}
        })());
        notice.append(button,output);inbox.append(notice);
      }
      status.textContent=rows.length?
        (historical?"Historical "+(historicalStudio?"Studio":"GitHub")+" evidence · ":"")+
          (historicalGithub?rows.filter(row=>row.hasSubmission).length+" student-submitted · "+
            rows.filter(row=>!row.hasSubmission).length+" without student submission · ":
            rows.length+" submitted · ")+
          published+" published · "+drafts+" draft"+(drafts===1?"":"s")+".":
        "No student evidence yet for this assessment.";
      if(!rows.length){
        const blank=make("div","rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600",
          historicalGithub?
            "No historical GitHub evidence receipts were found for this assessment. Older repository-only or unsubmitted work has not been inferred or converted into a V4 grade.":
            "Students will appear here after a verified assessment evidence version is submitted.");
        // No force-gather action: the learner must submit selected commits.
        inbox.append(blank);
        return;
      }
      let deepLinkRow=null;
      for(const row of rows){
        const grade=gradeMap.get(row.studentUid)||null;
        const card=make("article","rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3");
        const details=make("div","min-w-0");
        details.append(
          make("h3","font-extrabold text-slate-900",row.studentName||"Student"),
          make("p","text-xs text-slate-500 mt-1",
            (row.gradeOnly?"Original historical grade (no matching submission receipt)":
              "Version "+row.version+" · "+
              (historicalGithub&&row.hasSubmission===false?"no student submission (teacher discovery only)":row.status)+
              " · "+(row.updatedAt?new Date(row.updatedAt).toLocaleString():"recently")))
        );
        const resultLine=grade?
          (grade.status==="published"?"Published result":"Grade draft")+" · "+grade.awarded+" / "+grade.total+
            (grade.pending?" · "+grade.pending+" pending":""):
          (historicalGithub&&row.hasSubmission===false?
            "No student submission · excluded from evaluation":"Needs grading");
        details.append(make("p","text-xs font-bold mt-1 "+(grade?.status==="published"?"text-emerald-700":grade?"text-amber-700":"text-slate-600"),resultLine));
        const button=make("button","rounded-lg bg-indigo-700 text-white font-bold px-4 py-2.5 text-sm",
          view==="results"?(grade?"Open result":"Grade response"):
            task.submissionSource==="github"?"Review submitted commits":"Review response");
        button.type="button";
        if(row.gradeOnly){
          button.textContent="Original score — read only";
          button.disabled=true;button.title="No matching frozen student submission. The saved original score is preserved but cannot be edited through evidence review.";
          button.classList.add("opacity-60","cursor-not-allowed");
        }
        const normalized=task.submissionSource==="github"?
          {...row,recordId:row.evidenceId}:{...row,recordId:row.submissionId};
        if(!row.gradeOnly&&pendingStudentDeepLink&&row.studentUid===pendingStudentDeepLink)deepLinkRow=normalized;
        button.addEventListener("click",()=>void openReview(normalized));
        card.append(details,button);inbox.append(card);
      }
      if(deepLinkRow&&!dialog.open){
        pendingStudentDeepLink="";
        await openReview(deepLinkRow);
      }
    }catch(error){
      if(token!==generation)return;
      bulkEvaluator?.reset();
      status.textContent=error?.message||"Submission inbox is unavailable.";
      if(task?.legacyCompatibility&&task.submissionSource==="github"&&
         /Import this original assessment blueprint/i.test(error?.message||"")){
        const help=make("div","rounded-xl border border-sky-200 bg-sky-50 p-4");
        help.append(make("p","text-sm font-semibold text-sky-950",
          "This original repository assessment needs its school-scoped review reference prepared once. No student evidence or grades will be copied."));
        const prepare=make("button",
          "mt-3 rounded-lg bg-sky-800 text-white font-bold px-3 py-2 text-sm",
          "Prepare this historical assessment for V4");
        prepare.type="button";
        const note=make("p","mt-2 text-xs text-sky-900");
        prepare.addEventListener("click",()=>void (async()=>{
          prepare.disabled=true;
          note.textContent="Importing original assessment blueprint only…";
          try{
            await scoped(migrationApi,"import_legacy",{legacyAssessmentId:task.legacyAssessmentId});
            await loadInbox();
          }catch(e){
            note.textContent=e?.message||"Could not prepare the original review. No submissions or grades were changed.";
            prepare.disabled=false;
          }
        })());
        help.append(prepare,note);inbox.append(help);
        return;
      }
      if(task?.legacyCompatibility){
        const help=make("div","rounded-xl border border-amber-200 bg-amber-50 p-4");
        help.append(make("p","text-sm text-amber-950",
          "Historical submissions could not be loaded in V4. Original student evidence and grades remain unchanged; use the original review only for recovery."));
        const link=make("a","mt-2 inline-flex rounded-lg border border-amber-500 px-3 py-2 text-sm font-bold text-amber-950",
          task.submissionSource==="studio"?"Open original Studio submissions":"Open original Repository Review");
        link.href=(task.submissionSource==="studio"?"studio-submissions.html":"repofetch.html")+
          "?assessment="+encodeURIComponent(task.legacyAssessmentId);
        help.append(link);inbox.append(help);
      }
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
    const commitSummary=document.getElementById("gbV4GithubCommitSummary");
    if(commitSummary)commitSummary.textContent="Show commits ("+
      (snapshot?.selectedCommitShas?.length||0)+")";
    const commitDetails=document.getElementById("gbV4GithubCommitDetails");
    if(commitDetails)commitDetails.open=false;
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
    document.getElementById("gbV4GithubVerifyStatus").textContent=
      snapshot?.hasSubmission===false?
      "Historical teacher discovery only: there is no student submission, so no new grade is permitted.":
      "Student-submitted commit evidence is checked automatically against the frozen checkpoint during evaluation. Git metadata alone does not establish authorship.";
    document.getElementById("gbV4GithubApproval").classList.add("hidden");
    document.getElementById("gbV4GithubApprovalNote").value="";
    githubVerification=null;
  }
  function renderGeneralEvidence(snapshot){
    const isLink=currentTask?.submissionSource==="link";
    const payload=snapshot?.payload||{};
    document.getElementById("gbV4GeneralHeading").textContent=isLink?"Frozen submission link":"Frozen written response";
    document.getElementById("gbV4GeneralMeta").textContent=
      "Version "+(snapshot?.version||"—")+" · "+(snapshot?.status||"submitted");
    const link=document.getElementById("gbV4GeneralLink");
    link.classList.toggle("hidden",!isLink);
    if(isLink)link.href=payload.url||"#";
    const body=document.getElementById("gbV4GeneralBody");
    body.textContent=isLink?(payload.url||"No submitted URL."):(payload.response||"No written response.");
    const note=document.getElementById("gbV4GeneralNote");
    const noteText=isLink?String(payload.note||"").trim():"";
    note.classList.toggle("hidden",!noteText);
    note.textContent=noteText?"Student note:\n"+noteText:"";
  }

  async function verifyGithubEvidence(){
    if(busy||currentTask?.submissionSource!=="github"||!currentSnapshot)return;
    const verifyStatus=document.getElementById("gbV4GithubVerifyStatus");
    const verifyButton=document.getElementById("gbV4GithubVerify");
    setBusy(true);verifyButton.disabled=true;verifyStatus.textContent="Checking the frozen checkpoint and selected commit reachability…";
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
    }finally{verifyButton.disabled=false;setBusy(false);}
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
    if(currentTask?.legacyCompatibility&&grade?.status==="published"&&
       grade?.gradeSchema==="legacy_scalar_v1"){
      host.append(make("p","rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950",
        "Original published historical grade: "+grade.awarded+" / "+grade.total+
        ". The original record did not store a criterion-by-criterion breakdown. Empty rubric rows are deliberately not presented as zero scores."));
      document.getElementById("gbV4Feedback").value=grade.feedback||"";
      document.getElementById("gbV4ScoreSummary").textContent=
        "Historical published "+grade.awarded+" / "+grade.total;
      return;
    }
    if(currentTask?.legacyCompatibility&&grade?.gradeSchema==="legacy_scalar_v1"){
      host.append(make("p","rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950",
        "Original private historical draft: "+grade.awarded+" / "+grade.total+
        ". Its rubric breakdown was not recorded. Enter and review a fresh breakdown before saving any replacement draft."));
    }
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
  async function evaluationSnapshotForCurrent(){
    if(currentTask?.submissionSource!=="github"){
      if(currentTask?.submissionSource==="studio"&&currentTask?.personalizedTask?.enabled===true&&
         !(currentSnapshot?.personalizedTask?.variantId&&String(currentSnapshot?.personalizedTask?.prompt||"").trim()))
        throw Error("The assigned personalized scenario is unavailable for this frozen Studio submission. Reload before using AI evaluation.");
      return currentSnapshot;
    }
    const result=await prepareGithubEvaluation({task:currentTask,snapshot:currentSnapshot});
    const inspection=document.getElementById("gbV4GithubAnalysisStatus");
    if(inspection)inspection.textContent=
      "Repository inspection: "+result.analysis.inspectedCount+"/"+result.analysis.selectedCount+
      " selected commits · "+result.analysis.substantiveChanges+
      " substantive file changes detected · "+result.analysis.pinnedFileCount+
      " pinned source files loaded."+
      (result.analysis.complete?"":" Coverage is partial; see the evaluator limitations.")+
      " These signals do not independently establish individual authorship."+
      (currentTask.legacyCompatibility&&currentSnapshot?.verifiedContributionCommits?.length?
         " Previously annotated individual contribution scope was preserved.":"");
    return result;
  }
  function applyEvaluationSuggestion(suggestion,label){
    if(busy||!dialog.open||!currentSnapshot)return;
    currentDraftSource=label==="Internal AI"?"internal_ai":label==="External AI"?"external_ai":"teacher";
    const rows=[...document.querySelectorAll("#gbV4Rubric [data-rubric-row]")];
    suggestion.criteria.forEach((criterion,index)=>{
      const row=rows[index];if(!row)return;
      row.querySelector("[data-awarded]").value=String(criterion.awardedPoints);
      row.querySelector("[data-pending]").value=String(criterion.pendingPoints);
      row.querySelector("[data-comment]").value=criterion.comment||"";
    });
    if(suggestion.feedback)document.getElementById("gbV4Feedback").value=suggestion.feedback;
    updateScore();
    document.getElementById("gbV4ExternalStatus").textContent=
      label+" applied to the unsaved grade draft. Review every criterion before saving.";
  }
  function showEvaluationReview(containerId,label,suggestion){
    renderEvaluationReview(document.getElementById(containerId),{
      title:label+" rubric suggestion",sourceLabel:label,suggestion,task:currentTask,
      onApply:value=>applyEvaluationSuggestion(value,label),
      applyLabel:"Apply "+label+" to draft"
    });
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
    if(busy||!currentTask||dialog.open)return;
    reviewNeedsRefresh=false;
    currentRow=row;currentSnapshot=null;currentGrade=null;currentPrivateConfig=null;currentConversation=null;currentDraftSource="teacher";
    document.getElementById("gbV4ReviewTitle").textContent=row.studentName||"Review student project";
    document.getElementById("gbV4ReviewMeta").textContent=
      currentTask.title+" · version "+row.version+" · "+row.status;
    document.getElementById("gbV4ReviewStatus").textContent="Loading frozen evidence, private grade draft and learner conversation…";
    document.getElementById("gbV4ConversationBody").value="";
    document.getElementById("gbV4Conversation").replaceChildren(make("p","text-sm text-slate-500","Loading private messages…"));
    document.getElementById("gbV4ConversationStatus").textContent="";
    document.getElementById("gbV4Code").textContent="Loading…";
    document.getElementById("gbV4File").replaceChildren();
    document.getElementById("gbV4Rubric").replaceChildren();
    document.getElementById("gbV4CorrectionReason").value="";
    document.getElementById("gbV4LegacyReason").value="";
    document.getElementById("gbV4ExternalResponse").value="";
    document.getElementById("gbV4ExternalStatus").textContent="";
    const githubAnalysis=document.getElementById("gbV4GithubAnalysisStatus");
    if(githubAnalysis)githubAnalysis.textContent="";
    clearEvaluationReview(document.getElementById("gbV4SystemReview"),"Internal AI has not been run for this submission.");
    clearEvaluationReview(document.getElementById("gbV4ExternalReview"),"No External AI review has been imported for this submission.");
    document.getElementById("gbV4ExternalEvaluationPanel").classList.remove("hidden");
    const legacyGithub=currentTask.legacyCompatibility&&currentTask.submissionSource==="github";
    document.getElementById("gbV4LegacyGithubPanel").hidden=!legacyGithub;
    document.getElementById("gbV4LegacyGithubReviewNote").value="";
    document.getElementById("gbV4LegacyGithubConfirm").checked=false;
    document.getElementById("gbV4LegacyGithubAttribution").textContent="";
    document.getElementById("gbV4LegacyGithubVerifyLink").hidden=true;
    document.getElementById("gbV4GithubVerify").hidden=true;
    document.getElementById("gbV4LegacyGradePanel").hidden=true;
    document.getElementById("gbV4CorrectionPanel").classList.add("hidden");
    document.getElementById("gbV4StudioEvidence").classList.toggle("hidden",currentTask.submissionSource!=="studio");
    document.getElementById("gbV4PersonalizedTask").classList.add("hidden");
    document.getElementById("gbV4PersonalizedVariant").textContent="";
    document.getElementById("gbV4PersonalizedPrompt").textContent="";
    document.getElementById("gbV4PersonalizedNotes").textContent="";
    document.getElementById("gbV4GithubEvidence").classList.toggle("hidden",currentTask.submissionSource!=="github");
    document.getElementById("gbV4GeneralEvidence").classList.toggle("hidden",!["text","link"].includes(currentTask.submissionSource));
    document.getElementById("gbV4EvidenceType").textContent="Verified "+sourceLabel(currentTask.submissionSource);
    githubVerification=null;dialog.showModal();setBusy(true);
    try{
      const historicalStudio=currentTask.legacyCompatibility&&currentTask.submissionSource==="studio";
      const historicalGithub=currentTask.legacyCompatibility&&currentTask.submissionSource==="github";
      const evidenceApi=sourceApi(currentTask.submissionSource,{
        studio:submissionApi,general:generalSubmissionApi,github:githubEvidenceApi
      });
      const evidenceDetails=currentTask.submissionSource==="github"?
        {taskId:currentTask.taskId,evidenceId:row.recordId}:
        {taskId:currentTask.taskId,submissionId:row.recordId};
      const result=historicalStudio?
        await scoped(migrationApi,"legacy_review_inspect",{
          legacyAssessmentId:currentTask.legacyAssessmentId,
          ...(currentTask.legacyOfferingId?{legacyOfferingId:currentTask.legacyOfferingId}:{}),legacySubmissionId:row.recordId
        }):
        historicalGithub?
        await scoped(migrationApi,"legacy_github_inspect",{
          legacyAssessmentId:currentTask.legacyAssessmentId,
          ...(currentTask.legacyOfferingId?{legacyOfferingId:currentTask.legacyOfferingId}:{}),legacyEvidenceId:row.recordId
        }):null;
      if(historicalStudio||historicalGithub){
        currentSnapshot=result.snapshot;
        currentGrade=result.grade;
        currentPrivateConfig={checkingInstructions:result.checkingInstructions||""};
        currentTask={...currentTask,...result.task};
        currentConversation=null;renderConversation();
      }else{
        const native=await Promise.all([
          scoped(evidenceApi,"inspect",evidenceDetails),
          scoped(gradeApi,"get_draft",{taskId:currentTask.taskId,studentUid:row.studentUid}),
          scoped(assessmentApi,"get_private",{taskId:currentTask.taskId}),
          scoped(conversationApi,"list",{taskId:currentTask.taskId,studentUid:row.studentUid}).catch(error=>({messages:[],canSend:false,error:error?.message||"Private messages unavailable"}))
        ]);
        currentSnapshot=native[0];currentGrade=native[1].grade;currentPrivateConfig=native[2]||{};currentConversation=native[3]||null;renderConversation();
      }
      currentDraftSource=currentGrade?.draftSource||"teacher";
      if(currentTask.submissionSource==="studio"&&!currentSnapshot?.automaticVerification){
        document.getElementById("gbV4ReviewStatus").textContent=
          "Frozen Studio evidence loaded. Adminerva is compiling/verifying this exact version…";
        try{
          const verified=historicalStudio?
            await scoped(verificationApi,"verify_legacy",{
              submissionId:row.recordId,revision:Number(currentSnapshot.version)
            }):
            await scoped(verificationApi,"verify_school",{
              taskId:currentTask.taskId,submissionId:row.recordId,version:Number(currentSnapshot.version)
            });
          currentSnapshot={...currentSnapshot,automaticVerification:verified?.verification||null};
        }catch(error){
          currentSnapshot={...currentSnapshot,automaticVerification:{
            verificationVersion:"studio-auto-verification-v1",status:"verification_unavailable",
            matchesSubmittedSource:true,
            limitations:[String(error?.message||"Automatic verification unavailable.")]
          }};
        }
      }
      if(currentTask.submissionSource==="studio"){
        const fileSelect=document.getElementById("gbV4File");
        for(const file of currentSnapshot.files||[])fileSelect.add(new Option(file.path,file.path));
        fileSelect.onchange=renderFile;renderFile();
        document.getElementById("gbV4Artifacts").textContent=
          JSON.stringify({
            artifacts:currentSnapshot.artifacts||{},
            automaticVerification:currentSnapshot.automaticVerification||null
          },null,2);
        if(currentSnapshot.personalizedTask){
          document.getElementById("gbV4PersonalizedTask").classList.remove("hidden");
          document.getElementById("gbV4PersonalizedVariant").textContent=
            "Variant "+currentSnapshot.personalizedTask.variantId;
          document.getElementById("gbV4PersonalizedPrompt").textContent=
            currentSnapshot.personalizedTask.prompt||"Prompt unavailable.";
          document.getElementById("gbV4PersonalizedNotes").textContent=
            currentSnapshot.personalizedTask.evaluationNotes||"No private variant notes were saved.";
        }
      }else if(currentTask.submissionSource==="github"){
        renderGithubEvidence(currentSnapshot);
        if(historicalGithub){
          const approved=currentSnapshot?.status==="approved";
          document.getElementById("gbV4GithubApproval").classList.add("hidden");
          const link=document.getElementById("gbV4LegacyGithubVerifyLink");
          link.href="assessment-evidence-review.html?"+
            new URLSearchParams({assessment:currentTask.legacyAssessmentId,
              student:currentRow.studentUid}).toString();
          link.hidden=true;
          document.getElementById("gbV4GithubVerifyStatus").textContent=
            currentSnapshot.hasSubmission===false?
              "Teacher-discovered checkpoint only: no student-submitted commits, so no new grade can be created.":
              "Student-submitted commits are gradeable without additional contribution approval. Adminerva checks the frozen checkpoint and code changes during evaluation.";
          document.getElementById("gbV4LegacyGithubAttribution").textContent=
            (currentSnapshot.selectedCommitShas||[]).length+" selected commit(s) · "+
            (currentSnapshot.verifiedContributionCommits?.length?
              currentSnapshot.verifiedContributionCommits.length+
              " previously teacher-annotated contribution(s) preserved as a narrower evidence scope. ":"")+
            "Commit metadata does not independently establish authorship.";
        }
      }else renderGeneralEvidence(currentSnapshot);
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
        (historicalStudio?
          "Original published Studio grade preserved. Corrections still require the audited historical correction workflow.":
          historicalGithub?
          "Original published GitHub grade preserved. Legacy publication revisions cannot be corrected through ordinary V4 editing.":
          currentGrade?.gradeSchema==="legacy_scalar_v1"?
            "This imported historical grade preserves the original total but has no saved rubric breakdown. Reconstruct the breakdown without changing the score before any correction.":
            "This grade is published. Use the correction workflow for changes."):
        reopened?"A revision is already requested. Wait for the student to resubmit.":
        currentTask.submissionSource==="github"&&
          (currentSnapshot.hasSubmission===false||
            !["submitted","approved","reviewed"].includes(currentSnapshot.status))?
          "No student-submitted GitHub commits are available. Historical teacher discovery does not count as student submission.":
        historicalGithub&&currentGrade?.gradeSchema==="legacy_scalar_v1"?
          "This unpublished historical draft has no trustworthy rubric allocation. Enter a new reviewed criterion breakdown and save a revision of the original grade; no score changes are applied until you save.":
        currentGrade?.status==="draft"?"Draft loaded. Review before publishing.":
        "No grade draft yet. Scores remain private until you save and publish.";
    }catch(error){
      currentSnapshot=null;currentGrade=null;currentPrivateConfig=null;currentConversation=null;renderConversation();
      document.getElementById("gbV4ReviewStatus").textContent=error?.message||"Review data unavailable.";
    }finally{setBusy(false);}
  }
  document.getElementById("gbV4ConversationForm").addEventListener("submit",event=>void (async()=>{
    event.preventDefault();
    if(busy||!currentTask||!currentRow||currentConversation?.canSend===false)return;
    const body=document.getElementById("gbV4ConversationBody").value.trim();
    if(!body){document.getElementById("gbV4ConversationStatus").textContent="Write a private message before sending.";return;}
    const send=document.getElementById("gbV4ConversationSend"),field=document.getElementById("gbV4ConversationBody");
    send.disabled=true;field.disabled=true;document.getElementById("gbV4ConversationStatus").textContent="Sending private message…";
    try{
      await scoped(conversationApi,"create_message",{taskId:currentTask.taskId,studentUid:currentRow.studentUid,body});
      field.value="";await reloadConversation();
    }catch(error){document.getElementById("gbV4ConversationStatus").textContent=error?.message||"Private message could not be sent.";}
    finally{field.disabled=false;send.disabled=currentConversation?.canSend===false||busy;}
  })());
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
        "GitHub evidence approved. You can now save a grade draft.";
      await loadInbox();
    }catch(error){
      document.getElementById("gbV4GithubVerifyStatus").textContent=
        error?.message||"Evidence approval was not recorded.";
    }finally{setBusy(false);}
  })());
  document.getElementById("gbV4SystemCheck").addEventListener("click",()=>void (async()=>{
    const output=document.getElementById("gbV4ExternalStatus");
    const button=document.getElementById("gbV4SystemCheck");
    if(busy||!currentTask||!currentSnapshot)return;
    setBusy(true);button.disabled=true;
    output.textContent="Running Internal AI against the exact frozen submission…";
    try{
      const evaluationSnapshot=await evaluationSnapshotForCurrent();
      const packageText=buildGeneralExternalEvaluationPackage({
        task:currentTask,snapshot:evaluationSnapshot,
        checkingInstructions:currentPrivateConfig?.checkingInstructions||""
      });
      const result=await generateSchoolContent({
        contents:[{parts:[{text:packageText}]}],
        generationConfig:{responseMimeType:"application/json",temperature:0.2,maxOutputTokens:8192}
      },{purpose:"evaluation",signal:AbortSignal.timeout(100000)});
      const parsed=await evaluationJSON({ok:true,json:async()=>result});
      const suggestion=parseGeneralExternalEvaluationResponse(JSON.stringify(parsed),{task:currentTask});
      showEvaluationReview("gbV4SystemReview","Internal AI",suggestion);
      output.textContent="Internal AI review is ready below. It has not changed the teacher draft.";
    }catch(error){
      clearEvaluationReview(document.getElementById("gbV4SystemReview"),"Internal AI review unavailable.");
      output.textContent=error?.message||"Internal AI evaluation could not complete.";
    }finally{button.disabled=false;setBusy(false);}
  })());

  document.getElementById("gbV4ExternalCopy").addEventListener("click",()=>void (async()=>{
    const output=document.getElementById("gbV4ExternalStatus");
    if(busy||!currentTask||!currentSnapshot)return;
    setBusy(true);
    try{
      const evaluationSnapshot=await evaluationSnapshotForCurrent();
      const packageText=buildGeneralExternalEvaluationPackage({task:currentTask,snapshot:evaluationSnapshot,checkingInstructions:currentPrivateConfig?.checkingInstructions||""});
      await navigator.clipboard.writeText(packageText);
      output.textContent="Anonymous External AI evaluation package copied. Paste the evaluator JSON below when ready.";
    }catch(error){
      output.textContent=error?.message||"Evaluation package could not be copied.";
    }finally{setBusy(false);}
  })());

  document.getElementById("gbV4ExternalApply").addEventListener("click",()=>{
    const output=document.getElementById("gbV4ExternalStatus");
    if(busy||!currentTask||!currentSnapshot)return;
    try{
      const suggestion=parseGeneralExternalEvaluationResponse(
        document.getElementById("gbV4ExternalResponse").value,{task:currentTask}
      );
      showEvaluationReview("gbV4ExternalReview","External AI",suggestion);
      output.textContent="External AI review imported below. It has not changed the teacher draft.";
    }catch(error){
      clearEvaluationReview(document.getElementById("gbV4ExternalReview"),"External AI review was not imported.");
      output.textContent=error?.message||"External evaluation could not be imported.";
    }
  });

  document.getElementById("gbV4Close").addEventListener("click",()=>{if(!busy)dialog.close();});
  dialog.addEventListener("cancel",event=>{if(busy)event.preventDefault();});
  bulkPublish?.addEventListener("click",()=>void (async()=>{
    if(busy||!currentTask||bulkPublish.dataset.ready!=="true")return;
    const count=Number((bulkPublish.textContent.match(/\((\d+)\)/)||[])[1]||0);
    if(!count)return;
    if(!confirm("Publish all "+count+" valid non-zero draft"+(count===1?"":"s")+" for "+currentTask.title+"? This confirmation is the teacher approval step. Zero-score drafts and any draft that no longer matches frozen evidence will remain unpublished."))return;
    try{
      setBusy(true,"Publishing all valid drafts…");
      let result;
      if(currentTask.legacyCompatibility){
        const totals={published:0,failed:0,zeroSkipped:0,unverifiedSkipped:0};
        let cursor="",pages=0;
        for(;;){
          const part=await scoped(migrationApi,currentTask.submissionSource==="github"
            ?"legacy_github_bulk_publish":"legacy_review_bulk_publish",{
            legacyAssessmentId:currentTask.legacyAssessmentId,
          ...(currentTask.legacyOfferingId?{legacyOfferingId:currentTask.legacyOfferingId}:{}),
            ...(cursor?{cursor}:{})
          });
          totals.published+=Number(part.published||0);
          totals.failed+=Number(part.failed||0);
          totals.zeroSkipped+=Number(part.zeroSkipped||0);
          totals.unverifiedSkipped+=Number(part.unverifiedSkipped||0);
          pages++;
          if(!part.hasMore)break;
          if(!part.nextCursor||part.nextCursor===cursor||pages>25)
            throw Error("Bulk publication paused because the next page could not be verified. Already published grades are preserved. Refresh to continue.");
          cursor=part.nextCursor;
          status.textContent="Historical bulk publication: "+totals.published+
            " published, "+totals.zeroSkipped+" zero-score drafts held, "+
            totals.failed+" failed or changed, "+totals.unverifiedSkipped+
            " without verified student-submitted evidence. Preparing next page…";
        }
        result=totals;
      }else{
        result=await scoped(gradeApi,"publish_task_drafts",{taskId:currentTask.taskId});
      }
      const summary="Published "+result.published+" draft"+(result.published===1?"":"s")+
        (result.zeroSkipped?" · "+result.zeroSkipped+" zero-score draft"+(result.zeroSkipped===1?" remains":"s remain")+" for attention":"")+
        (result.failed?" · "+result.failed+" draft"+(result.failed===1?" was":"s were")+" skipped after validation":"")+
        (result.unverifiedSkipped?" · "+result.unverifiedSkipped+" source record"+(result.unverifiedSkipped===1?" lacked":"s lacked")+" verified student-submitted evidence":"")+".";
      await loadInbox();
      status.textContent=summary+" "+status.textContent;
    }catch(error){
      status.textContent=error?.message||"Bulk publication did not complete.";
    }finally{setBusy(false);}
  })());
  taskSelect.addEventListener("change",()=>void loadInbox());
  document.getElementById("gbV4Refresh").addEventListener("click",()=>{if(busy||dialog.open)return;if(tasks.size)void loadInbox();else void loadTasks().catch(error=>{taskSelect.disabled=false;status.textContent=error?.message||"Assessment list could not be loaded.";});});
  document.getElementById("gbV4SaveDraft").addEventListener("click",()=>void (async()=>{
    if(busy||reviewNeedsRefresh||!currentTask||!currentRow||!currentSnapshot)return;
    let saved=false;
    try{
      const criteria=collectCriteria();
      setBusy(true,"Saving grade draft…");
      if(currentTask.legacyCompatibility&&currentTask.submissionSource==="github"){
        const reviewNote=document.getElementById("gbV4LegacyGithubReviewNote").value.trim();
        if(reviewNote.length<15||!document.getElementById("gbV4LegacyGithubConfirm").checked)
          throw Error("Review the student's submitted commit evidence and enter a grading note of at least 15 characters. No separate contribution approval is required.");
        await scoped(migrationApi,"legacy_github_save_draft",{
          legacyAssessmentId:currentTask.legacyAssessmentId,
          ...(currentTask.legacyOfferingId?{legacyOfferingId:currentTask.legacyOfferingId}:{}),
          legacyEvidenceId:currentRow.recordId,
          expectedEvidenceRevision:Number(currentSnapshot.evidenceRevision||0),
          expectedCheckpointSha:currentSnapshot.checkpointSha,
          expectedGradeRevision:currentGrade?.revision||0,
          criteria,reviewNote,
          feedback:document.getElementById("gbV4Feedback").value.trim(),
          draftSource:currentDraftSource
        });
      }else if(currentTask.legacyCompatibility){
        await scoped(migrationApi,"legacy_review_save_draft",{
          legacyAssessmentId:currentTask.legacyAssessmentId,
          ...(currentTask.legacyOfferingId?{legacyOfferingId:currentTask.legacyOfferingId}:{}),
          legacySubmissionId:currentRow.recordId,criteria,
          feedback:document.getElementById("gbV4Feedback").value.trim(),
          draftSource:currentDraftSource
        });
      }else{
        await scoped(gradeApi,"save_draft",{
          taskId:currentTask.taskId,studentUid:currentRow.studentUid,
          submissionVersion:currentSnapshot.version,criteria,
          feedback:document.getElementById("gbV4Feedback").value.trim(),
          draftSource:currentDraftSource
        });
      }
      saved=true;
      const refreshed=currentTask.legacyCompatibility?
        await scoped(migrationApi,currentTask.submissionSource==="github"?
          "legacy_github_inspect":"legacy_review_inspect",{
          legacyAssessmentId:currentTask.legacyAssessmentId,
          ...(currentTask.legacyOfferingId?{legacyOfferingId:currentTask.legacyOfferingId}:{}),
          ...(currentTask.submissionSource==="github"?
            {legacyEvidenceId:currentRow.recordId}:{legacySubmissionId:currentRow.recordId})
        }):
        await scoped(gradeApi,"get_draft",{
          taskId:currentTask.taskId,studentUid:currentRow.studentUid
        });
      currentGrade=refreshed.grade;
      renderRubric(currentGrade);
      refreshReviewControls();
      document.getElementById("gbV4ReviewStatus").textContent=
        "Draft saved against frozen submission version "+currentSnapshot.version+".";
    }catch(error){
      if(saved){reviewNeedsRefresh=true;document.getElementById("gbV4ReviewStatus").textContent="Grade draft saved. Refresh the review before publishing; the saved revision could not reload.";}
      else document.getElementById("gbV4ReviewStatus").textContent=error?.message||"Grade draft was not saved.";
    }finally{setBusy(false);if(saved)await loadInbox();}
  })());
  document.getElementById("gbV4Publish").addEventListener("click",()=>void (async()=>{
    if(busy||reviewNeedsRefresh||!currentTask||!currentRow)return;
    if(!confirm("Publish this reviewed grade to the student? The current V4 workflow does not allow ordinary edits after publication."))return;
    try{
      setBusy(true,"Verifying current submission and publishing grade…");
      const result=currentTask.legacyCompatibility?
        await scoped(migrationApi,currentTask.submissionSource==="github"?
          "legacy_github_publish":"legacy_review_publish",{
          legacyAssessmentId:currentTask.legacyAssessmentId,
          ...(currentTask.legacyOfferingId?{legacyOfferingId:currentTask.legacyOfferingId}:{}),
          ...(currentTask.submissionSource==="github"?{
            legacyEvidenceId:currentRow.recordId,
            expectedEvidenceRevision:Number(currentSnapshot.evidenceRevision||0),
            expectedCheckpointSha:currentSnapshot.checkpointSha,
            expectedGradeRevision:currentGrade?.revision
          }:{
            legacySubmissionId:currentRow.recordId,
            expectedGradeRevision:currentGrade?.revision
          })
        }):
        await scoped(gradeApi,"publish",{
          taskId:currentTask.taskId,studentUid:currentRow.studentUid
        });
      document.getElementById("gbV4ReviewStatus").textContent="Published "+result.awarded+" / "+result.total+" to the student.";
      currentGrade={...(currentGrade||{}),status:"published"};
      currentRow={...currentRow,status:"reviewed"};
      if(!currentTask.legacyCompatibility)
        currentSnapshot={...(currentSnapshot||{}),status:"reviewed"};
      refreshReviewControls();
      await loadInbox();
    }catch(error){
      document.getElementById("gbV4ReviewStatus").textContent=error?.message||"Grade was not published.";
    }finally{setBusy(false);}
  })());
  document.getElementById("gbV4ConvertLegacy").addEventListener("click",()=>void (async()=>{
    if(busy||reviewNeedsRefresh||!currentTask||!currentRow||
       !["draft","published"].includes(currentGrade?.status)||
       currentGrade?.gradeSchema!=="legacy_scalar_v1")return;
    const reason=document.getElementById("gbV4LegacyReason").value.trim();
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
        ". Reconstruction cannot change the historical score.";return;
    }
    if(!confirm("Reconstruct the missing historical rubric breakdown while preserving the exact saved score?"))return;
    try{
      setBusy(true,"Verifying frozen evidence and reconstructing the historical rubric breakdown…");
      const result=await scoped(gradeApi,"convert_legacy_scalar",{
        taskId:currentTask.taskId,studentUid:currentRow.studentUid,
        expectedRevision:currentGrade.revision,criteria,reason
      });
      const refreshed=await scoped(gradeApi,"get_draft",{
        taskId:currentTask.taskId,studentUid:currentRow.studentUid
      });
      currentGrade=refreshed.grade;renderRubric(currentGrade);refreshReviewControls();
      document.getElementById("gbV4LegacyReason").value="";
      document.getElementById("gbV4ReviewStatus").textContent=
        "Historical rubric breakdown reconstructed at "+result.awarded+" / "+result.total+
        ". The original imported revision remains in audit history.";
    }catch(error){
      document.getElementById("gbV4ReviewStatus").textContent=
        error?.message||"Historical rubric reconstruction was not recorded.";
    }finally{setBusy(false);}
  })());
  document.getElementById("gbV4Correct").addEventListener("click",()=>void (async()=>{
    if(busy||reviewNeedsRefresh||!currentTask||!currentRow||currentGrade?.status!=="published")return;
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
    if(busy||reviewNeedsRefresh||!currentTask||!currentRow)return;
    if(currentTask.legacyCompatibility){
      document.getElementById("gbV4ReviewStatus").textContent=
        "Historical revisions remain managed by the original Studio submission workflow. Existing source and grades are unchanged.";
      return;
    }
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
      const evidenceApi=sourceApi(currentTask.submissionSource,{
        studio:submissionApi,general:generalSubmissionApi,github:githubEvidenceApi
      });
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
      onReady:()=>void loadTasks().catch(error=>{taskSelect.disabled=false;panel.classList.remove("hidden");status.textContent=error?.message||"Assessment list could not be loaded."; }),
      onBeforeChange:async()=>{
        if(busy||dialog.open)throw Error("Close the current review before switching schools.");
        generation++;tasks.clear();taskSelect.replaceChildren();clearTaskContext();
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
