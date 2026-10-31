/** Class-level submission triage and safe bulk review orchestration. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {collection,deleteDoc,doc,getDoc,getDocFromServer,getDocs,getDocsFromServer,query,where,serverTimestamp,setDoc,runTransaction} from "../core/teaching-firestore.mjs?v=1.3.2";
import {changeEvidence} from "./services/evidence-transaction.mjs?v=1.3.0";
import {normalizeSelection,parseRepository} from "./services/assessment-evidence.mjs?v=1.4.3";
import {verifyCheckpointAncestry} from "./services/commit-history.mjs?v=1.4.3";
import {approvalContribution,evidenceRevision} from "./services/evidence-lifecycle.mjs?v=1.4.3";
import {bulkApproveCandidates,bulkReopenCandidates,mayBulkReopen,wasResubmittedAfterReopening,currentGradeForEvidence} from "./services/bulk-evidence.mjs?v=1.4.1";
import {parseWeightedRubric,loadPinnedV2Source,parseSuggestedRubric} from "./services/v2-grading-assistant.mjs?v=1.4.25";
import {evaluateVerifiedEvidence} from "./services/adaptive-evaluation.mjs?v=1.3.2";
import {schoolAIStatus} from "../core/school-ai.mjs?v=1.3.0";
import {legacyReadyDraft} from "./services/publication-queue.mjs?v=1.3.2";
import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.10";
import {decideReclaim} from "./services/reclaim-decision.mjs?v=1.3.1";

const el=id=>document.getElementById(id);
const analytics=(event,params={})=>window.AdminervaAnalytics?.track(event,params);
let context=null,busy=false,busyEvaluation=false,cancelEvaluation=false,evidenceReadable=false,evidenceMap=new Map(),draftMap=new Map(),receiptMap=new Map(),claimMap=new Map(),claimsReadable=false,canDecideClaims=false,loadSequence=0;
const draftRef=(studentId,taskId)=>doc(db,"teacher_evaluation_drafts",auth.currentUser.uid,"items",studentId+"_"+taskId);
function showBulkExceptions(failures){
  const box=el("gbBulkExceptionDetails"),list=el("gbBulkExceptionList");
  if(!box||!list)return;
  list.replaceChildren();
  box.classList.toggle("hidden",!failures.length);
  for(const item of failures){
    const row=document.createElement("p");
    row.textContent=item;
    row.className="border-b border-amber-100 pb-1 last:border-0";
    list.appendChild(row);
  }
}
function renderReclaimQueue(){
  const list=el("gbReclaimList"),label=el("gbReclaimCount");if(!list||!label)return;
  const learners=new Map((context?.students||[]).map(student=>[student.id,student]));
  const pending=[...claimMap.values()].filter(claim=>claim.status==="pending"&&learners.has(claim.studentId));
  label.textContent="("+pending.length+" pending)";
  list.replaceChildren();
  if(!pending.length){
    const empty=document.createElement("p");empty.className="text-xs text-slate-600";
    empty.textContent="No pending reclaim requests for this assessment and section.";
    list.append(empty);return;
  }
  for(const claim of pending){
    const student=learners.get(claim.studentId);
    const card=document.createElement("article");card.className="rounded-lg border border-amber-200 bg-white p-3 space-y-2";
    const name=document.createElement("p");name.className="text-sm font-bold text-slate-900";
    name.textContent=(student.name||student.id)+" · "+String(claim.sha||"").slice(0,12);
    const author=document.createElement("p");author.className="text-xs text-slate-600";
    author.textContent="Detected Git identity: "+(claim.detectedAuthorLogin?"@"+claim.detectedAuthorLogin:claim.detectedAuthorName||"Unknown");
    const explanation=document.createElement("p");explanation.className="text-sm text-slate-700 whitespace-pre-wrap break-words";
    explanation.textContent=claim.explanation||"No explanation provided.";
    const controls=document.createElement("div");controls.className="flex flex-wrap items-center gap-2";
    const review=document.createElement("a");review.className="text-xs font-bold text-indigo-700 underline p-2";
    review.textContent="Review student evidence";
    review.href=reviewUrl(claim.studentId);
    controls.append(review);
    if(canDecideClaims){
      for(const [decision,buttonText] of [["approved","Approve claim"],["shared","Shared"],["rejected","Reject"]]){
        const button=document.createElement("button");button.type="button";button.className="text-xs rounded border border-amber-300 bg-amber-50 px-3 py-2 font-bold text-amber-950 disabled:opacity-50";
        button.textContent=buttonText;button.disabled=busy;
        button.addEventListener("click",()=>void window.withLoading("Saving attribution decision…",()=>decidePendingClaim(claim,decision),{button}));controls.append(button);
      }
    }else{
      const note=document.createElement("span");note.className="text-xs text-amber-900";
      note.textContent="Administrator decision required";controls.append(note);
    }
    card.append(name,author,explanation,controls);list.append(card);
  }
}
async function decidePendingClaim(claim,decision){
  if(busy||!canDecideClaims)return;
  const reason=prompt("Reason for "+decision+" reclaim for "+claim.studentId+" ("+String(claim.sha||"").slice(0,12)+")? Enter 10–2,000 characters:");
  if(reason===null)return;
  const active=context;busy=true;render();
  try{
    await decideReclaim({claimId:claim.id,decision,reason});
    el("gbBulkStatus").textContent="Reclaim decision saved with an audit record. Refreshing current pending requests…";
  }catch(error){
    showBulkExceptions([claim.studentId+": "+error.message]);
    el("gbBulkStatus").textContent="Unable to decide reclaim: "+error.message;
  }finally{busy=false;if(context===active)await load(active);}
}
const badge=(text,tone="slate")=>'<span class="inline-flex rounded-full px-2 py-1 font-bold bg-'+tone+'-50 text-'+tone+'-800 border border-'+tone+'-200">'+text+'</span>';
function reviewUrl(studentId){
  if(Number(context?.schemaVersion)===3){
    const params=new URLSearchParams({assessment:context.taskId,section:context.section,student:studentId});
    return "studio-submissions.html?"+params.toString();
  }
  const p=new URLSearchParams({section:context.section,assessment:context.taskId,student:studentId,view:"grade"});
  return "repofetch.html?"+p.toString();
}
function missingEvidenceReason(student){
  if(!student||context?.grades?.[student.id]||draftMap.has(student.id))return "";
  const evidence=evidenceMap.get(student.id);
  if(!evidence||["reopened","withdrawn"].includes(evidence.status))return "";
  const selected=Array.isArray(evidence.selectedCommits)?evidence.selectedCommits:[];
  const verified=Array.isArray(evidence.verifiedContributionCommits)?evidence.verifiedContributionCommits:[];
  if(evidence.status==="approved"&&!verified.length)
    return "No individual contribution commits were verified.";
  if(["submitted","needs_review"].includes(evidence.status)&&!selected.length)
    return evidence.source==="teacher_discovered"
      ?"Repository checkpoint found, but no linked-account contribution commits were found."
      :"No contribution commits are selected in the submitted evidence.";
  return "";
}
function missingEvidenceCandidates(){
  if(!context||Number(context.schemaVersion)!==2||!evidenceReadable)return [];
  return context.students.map(student=>({student,reason:missingEvidenceReason(student)})).filter(item=>item.reason);
}
function assessmentLabel(){
  const select=document.getElementById("gbAssessment"),option=select?.selectedOptions?.[0];
  return String(option?.textContent||"this assessment").trim();
}
function buildMissingReminder(items){
  const names=items.map(({student})=>"• "+student.name).join("\n");
  return [
    "Reminder — "+assessmentLabel()+" · "+context.section,
    "",
    "Adminerva currently has no verifiable individual contribution evidence for the following student(s):",
    names,
    "",
    "Please check that your work has been committed and pushed to the correct repository, your GitHub account is linked correctly, and the relevant commits are included in your assessment evidence/submission.",
    "",
    "If you already completed these steps, please re-check the repository and submitted commits. This is an evidence reminder only; it is not a grade."
  ].join("\n");
}
async function copyMissingReminder(){
  const items=missingEvidenceCandidates();
  if(!items.length)return;
  const message=buildMissingReminder(items);
  let copied=false;
  try{await navigator.clipboard.writeText(message);copied=true;}
  catch{
    const area=document.createElement("textarea");
    area.value=message;area.setAttribute("readonly","");area.style.position="fixed";area.style.opacity="0";
    document.body.append(area);area.select();
    try{copied=Boolean(document.execCommand?.("copy"));}catch{}
    area.remove();
  }
  analytics("missing_evidence_reminder_copied",{feature:"gradebook",count_bucket:items.length,status:copied?"success":"clipboard_blocked"});
  el("gbBulkStatus").textContent=copied
    ?"Copied a GC-ready missing-evidence reminder for "+items.length+" learner"+(items.length===1?"":"s")+". No grades or private review notes were included."
    :"Clipboard access was blocked. Use your browser's clipboard permission and try Copy missing reminder again.";
}
function statusFor(student){
  const evidence=evidenceMap.get(student.id),grade=context.grades?.[student.id],draft=draftMap.get(student.id);
  if(Number(context?.schemaVersion)===3)
    return grade?.published?{label:"Published Studio grade",tone:"emerald"}:
      grade?{label:"Studio draft · ready",tone:"cyan",next:"View Studio review"}:
      {label:"Studio · review project",tone:"blue",next:"Open Studio submissions"};
  if(grade?.published)return {label:"Published",tone:"emerald"};
  // V2 evidence lifecycle takes precedence over older unpublished drafts.
  // A grade from the previous approved revision must not look publishable.
  if(evidence?.status==="reopened")return {label:"Reopened · awaiting student",tone:"amber",next:"View status"};
  if(evidence?.status==="withdrawn")return {label:"Withdrawn",tone:"slate",next:"View status"};
  if(evidence?.status==="submitted")return {label:wasResubmittedAfterReopening(evidence)?
    "Resubmitted · approval pending":"Submitted",tone:"blue",next:"Review submission"};
  if(evidence?.status==="needs_review"&&evidence?.source==="teacher_discovered")
    return {label:evidence.selectedCommits?.length?"Gathered · review evidence":"Gathered · checkpoint only",tone:"amber",next:"Review gathered evidence"};
  if(evidence?.status==="needs_review")return {label:"Needs review",tone:"amber",next:"Review submission"};
  if(grade&&Number(context.schemaVersion)===2&&!currentGradeForEvidence(grade,evidence))
    return {label:"Prior draft · evidence changed",tone:"amber",next:"Review & grade"};
  if(grade?.reviewRequired===true&&!legacyReadyDraft(grade))return {label:"Review needed",tone:"amber",next:"Review & grade"};
  if(grade)return {label:legacyReadyDraft(grade)?"Legacy draft · ready":"Ready to publish",tone:"cyan"};
  if(draft)return {label:"Evaluation ready",tone:"indigo",next:"Review suggestion"};
  if(evidence?.status==="approved")return {label:evidence.verifiedContributionCommits?.length?
    "Approved · verified":"Approved · contribution check needed",tone:evidence.verifiedContributionCommits?.length?"emerald":"amber",next:"Review & grade"};
  if(receiptMap.has(student.id))return {label:"Submitted",tone:"blue",next:"Review submission"};
  return {label:"Not submitted",tone:"slate",next:"Open review"};
}
function render(){
  if(!context)return;
  const tools=el("gbClassReviewTools"),isV2=Number(context.schemaVersion)===2;
  if(tools){tools.dataset.ready="true";tools.classList.toggle("hidden",document.getElementById("gbLegacyView")?.classList.contains("hidden")!==false);}
  let submitted=0,approved=0,drafts=0,ready=0,flagged=0,published=0,exceptions=0;
  for(const student of context.students){
    const state=statusFor(student),box=document.querySelector('[data-review-state="'+CSS.escape(student.id)+'"]');
    if(box){
      box.innerHTML=badge(state.label,state.tone)+(state.next?
        '<a class="block mt-2 font-bold text-blue-700 hover:underline" href="'+reviewUrl(student.id)+'">'+state.next+' →</a>':'');
    }
    const evidence=evidenceMap.get(student.id),grade=context.grades?.[student.id];
    if(evidence?.status==="submitted"||evidence?.status==="needs_review"||(!evidence&&receiptMap.has(student.id)))submitted++;
    if(evidence?.status==="approved")approved++;
    if(grade?.published)published++;
    else if((!isV2||!grade||currentGradeForEvidence(grade,evidence))&&(grade||draftMap.has(student.id))){
      drafts++;
      if(grade?.reviewRequired===true&&!legacyReadyDraft(grade))flagged++;
      else if(grade)ready++;
    }
    if(evidence&&["reopened","withdrawn"].includes(evidence.status))exceptions++;
  }
  const gatherCandidates=isV2?context.students.filter(student=>{
    if(evidenceMap.has(student.id)||context.grades?.[student.id]?.published)return false;
    try{return Boolean(parseRepository(student.repoUrl));}catch{return false;}
  }):[];
  const approveCandidates=isV2?bulkApproveCandidates(context.students,evidenceMap):[];
  const reopenCandidates=isV2?bulkReopenCandidates(context.students,evidenceMap,context.grades):[];
  const evaluateCandidates=isV2?context.students.filter(student=>{
    const e=evidenceMap.get(student.id),g=context.grades?.[student.id];
    return e?.status==="approved"&&Array.isArray(e.verifiedContributionCommits)&&e.verifiedContributionCommits.length>0&&!g&&!draftMap.has(student.id);
  }):[];
  el("gbClassReviewSummary").textContent=context.students.length+" learners · "+ready+" ready to publish · "+flagged+" need review · "+published+" published"+(submitted?" · "+submitted+" awaiting evidence review":"")+(exceptions?" · "+exceptions+" exceptions":"");
  if(el("gbForceGather")){
    el("gbForceGather").textContent=isV2?"Force gather evidence ("+gatherCandidates.length+")":"Force gather · V2 evidence only";
    el("gbForceGather").disabled=busy||!evidenceReadable||!gatherCandidates.length;
  }
  const missingReminder=isV2?missingEvidenceCandidates():[];
  if(el("gbCopyMissingReminder")){
    el("gbCopyMissingReminder").textContent=isV2?"Copy missing reminder ("+missingReminder.length+")":"Missing reminder · V2 evidence only";
    el("gbCopyMissingReminder").disabled=busy||!evidenceReadable||!missingReminder.length;
  }
  if(el("gbBulkReopen")){
    el("gbBulkReopen").textContent=isV2?"Reopen section evidence ("+reopenCandidates.length+")":"Reopen · V2 evidence only";
    el("gbBulkReopen").disabled=busy||!evidenceReadable||!reopenCandidates.length;
  }
  if(el("gbRefreshEvidence"))el("gbRefreshEvidence").disabled=busy||!context;
  el("gbBulkApprove").textContent=isV2?"Approve evidence ("+approveCandidates.length+")":"Approval · V2 evidence only";
  el("gbBulkApprove").disabled=busy||!evidenceReadable||!approveCandidates.length;
  el("gbBulkEvaluate").textContent=isV2?"Run system evaluation ("+evaluateCandidates.length+")":"System evaluation · V2 evidence only";
  el("gbBulkEvaluate").disabled=busy||!evidenceReadable||!evaluateCandidates.length;
  const reruns=isV2?context.students.filter(student=>eligibleToRerun(evidenceMap.get(student.id),context.grades?.[student.id])):[];
  if(el("gbBulkRerun")){el("gbBulkRerun").textContent="Re-evaluate drafts ("+reruns.length+")";el("gbBulkRerun").disabled=busy||!evidenceReadable||!reruns.length;}
  el("gbCancelEvaluation")?.classList.toggle("hidden",!busyEvaluation);
  const p=new URLSearchParams({section:context.section,assessment:context.taskId});el("gbReviewExceptions").href="repofetch.html?"+p.toString();
  renderReclaimQueue();
}
async function load(detail){
  if(!detail)return;
  const sequence=++loadSequence;
  context=detail;evidenceReadable=false;evidenceMap=new Map();draftMap=new Map();receiptMap=new Map();claimMap=new Map();claimsReadable=false;
  render();
  const isV2=Number(detail.schemaVersion)===2;
  // An unavailable optional collection must never erase the evidence roster or
  // turn unknown submission status into an apparent "not submitted" result.
  const sources=await Promise.allSettled([
    getDocs(query(collection(db,"student_submissions"),where("assessmentId","==",detail.taskId),where("section","==",detail.section))),
    ...(isV2?[
      getDocsFromServer(query(collection(db,"assessment_evidence"),where("assessmentId","==",detail.taskId),where("section","==",detail.section))),
      getDocs(collection(db,"teacher_evaluation_drafts",auth.currentUser.uid,"items")),
      getDocsFromServer(query(collection(db,"commit_reclaims"),where("section","==",detail.section)))
    ]:[])
  ]);
  if(sequence!==loadSequence)return;
  const warnings=[];
  try{canDecideClaims=(await resolveStaffRole(auth.currentUser))==="admin";}catch{canDecideClaims=false;}
  if(sequence!==loadSequence)return;
  if(isV2){
    try{const grades=await getDocsFromServer(query(collection(db,"student_grades"),where("taskId","==",detail.taskId),where("section","==",detail.section)));
      context.grades=Object.fromEntries(grades.docs.filter(record=>detail.students.some(student=>student.id===record.data().studentId))
        .map(record=>[record.data().studentId,record.data()]));
    }catch(error){warnings.push("gradebook drafts: "+error.message);}
  }
  if(sequence!==loadSequence)return;
  if(sources[0].status==="fulfilled")for(const record of sources[0].value.docs){
    const data={id:record.id,...record.data()},prior=receiptMap.get(data.studentId);
    const stamp=value=>value?.toMillis?.()||Date.parse(value||"")||0;
    if(!prior||stamp(data.submittedAt)>stamp(prior.submittedAt))receiptMap.set(data.studentId,data);
  }else warnings.push("submission receipts: "+sources[0].reason?.message);
  if(isV2){
    if(sources[1].status==="fulfilled"){
      evidenceMap=new Map(sources[1].value.docs.map(record=>[record.data().studentId,{id:record.id,...record.data()}]));
    }else warnings.push("evidence: "+sources[1].reason?.message);
    if(sources[2].status==="fulfilled"){
      draftMap=new Map(sources[2].value.docs.filter(record=>{
        const draft=record.data(),evidence=evidenceMap.get(draft.studentId);
        return draft.taskId===detail.taskId&&draft.section===detail.section&&draft.status==="private_suggestion"&&
          evidence?.status==="approved"&&draft.evidenceRevision===evidenceRevision(evidence)&&draft.checkpointSha===evidence.approvedCheckpointSha;
      }).map(record=>[record.data().studentId,{id:record.id,...record.data()}]));
    }else warnings.push("evaluation drafts: "+sources[2].reason?.message);
    if(sources[3].status==="fulfilled"){
      claimsReadable=true;
      claimMap=new Map(sources[3].value.docs
        .filter(record=>record.data().assessmentId===detail.taskId)
        .map(record=>[record.id,{id:record.id,...record.data()}]));
    }else{
      claimsReadable=false;
      warnings.push("reclaim requests: "+sources[3].reason?.message);
    }
  }
  // If evidence cannot be read, bulk actions must fail closed instead of
  // treating missing query results as students without submissions.
  evidenceReadable=!isV2||sources[1].status==="fulfilled";
  render();
  if(warnings.length)el("gbBulkStatus").textContent="Some review data could not load ("+warnings.join(" | ")+"). Evidence actions are disabled if evidence could not be read.";
}
const linkedLogin=student=>String(student?.githubUsername||"").trim().replace(/^@/,"").toLowerCase();
const dateMillis=value=>{
  if(value?.toDate)return value.toDate().getTime();
  const parsed=Date.parse(value||"");
  return Number.isFinite(parsed)?parsed:null;
};
function gatheringWindow(assessment){
  const deployment=(assessment.deployments||[]).find(item=>item.section===context.section);
  const now=Date.now(),deadline=deployment?.deadlineEnabled===false?null:dateMillis(deployment?.deadline);
  const cutoff=deadline===null?now:Math.min(deadline,now);
  const post=dateMillis(deployment?.postDate);
  return {
    cutoffMs:cutoff,cutoffIso:new Date(cutoff).toISOString(),
    postMs:post!==null&&post<=cutoff?post:null,
    deadlineMs:deadline,
    label:deadline!==null&&deadline<=now?"the class deadline ("+new Date(deadline).toLocaleString()+")":"the current repository state ("+new Date(cutoff).toLocaleString()+")"
  };
}
function githubHeaders(){
  const token=localStorage.getItem("Adminerva_github_token");
  return token?{Authorization:"Bearer "+token,Accept:"application/vnd.github+json"}:{Accept:"application/vnd.github+json"};
}
async function repositoryHistory(repo,cutoffIso,cache){
  const key=repo.url.toLowerCase()+"|"+cutoffIso;
  if(cache.has(key))return cache.get(key);
  const promise=(async()=>{
    const items=[],headers=githubHeaders();
    for(let page=1;page<=5;page++){
      const url="https://api.github.com/repos/"+encodeURIComponent(repo.owner)+"/"+encodeURIComponent(repo.repo)+
        "/commits?per_page=100&page="+page+"&until="+encodeURIComponent(cutoffIso);
      const response=await fetch(url,{headers});
      if(response.status===409)return [];
      if(!response.ok)throw Error("GitHub HTTP "+response.status);
      const batch=await response.json();
      if(!Array.isArray(batch))throw Error("GitHub returned invalid commit history.");
      items.push(...batch);
      if(batch.length<100)break;
    }
    return items;
  })();
  cache.set(key,promise);
  try{return await promise;}catch(error){cache.delete(key);throw error;}
}
async function forceGather(){
  if(busy||!context||!evidenceReadable||Number(context.schemaVersion)!==2)return;
  const candidates=context.students.filter(student=>{
    if(evidenceMap.has(student.id)||context.grades?.[student.id]?.published)return false;
    try{return Boolean(parseRepository(student.repoUrl));}catch{return false;}
  });
  if(!candidates.length)return;
  let assessment;
  try{
    const snapshot=await getDoc(doc(db,"assessments",context.taskId));
    if(!snapshot.exists())throw Error("Assessment not found.");
    assessment={id:snapshot.id,...snapshot.data()};
  }catch(error){el("gbBulkStatus").textContent="Force gather could not start: "+error.message;return;}
  const windowInfo=gatheringWindow(assessment);
  if(!confirm("Force gather evidence for "+candidates.length+" learner(s) with no saved evidence using "+windowInfo.label+"? Existing student submissions and evidence will not be overwritten. Adminerva will auto-select up to 20 commits whose GitHub author login exactly matches each learner's linked account. Git commit dates are repository metadata, not verified push times."))return;
  showBulkExceptions([]);
  analytics("evidence_gather_started",{feature:"gradebook",count_bucket:candidates.length});
  busy=true;render();
  const cache=new Map(),failures=[];let created=0,checkpointOnly=0,matched=0,skipped=0,permissionFailures=0;
  for(const student of candidates){
    el("gbBulkStatus").textContent="Gathering deadline evidence for "+student.name+" · "+created+" saved…";
    try{
      const ref=doc(db,"assessment_evidence",student.id+"_"+context.taskId),existing=await getDoc(ref);
      if(existing.exists()){skipped++;continue;}
      const repo=parseRepository(student.repoUrl),history=await repositoryHistory(repo,windowInfo.cutoffIso,cache);
      const checkpoint=String(history[0]?.sha||"").toLowerCase();
      if(!/^[a-f0-9]{40}$/.test(checkpoint))throw Error("No repository checkpoint was found at or before the cutoff.");
      const expected=linkedLogin(student);
      const own=expected?history.filter(commit=>{
        const login=String(commit?.author?.login||"").toLowerCase();
        const time=dateMillis(commit?.commit?.committer?.date||commit?.commit?.author?.date);
        return login===expected&&(windowInfo.postMs===null||(time!==null&&time>=windowInfo.postMs));
      }).slice(0,20):[];
      const selectedCommits=own.map(commit=>String(commit.sha).toLowerCase());
      const bounded=history.length>=500;
      const note=selectedCommits.length
        ?"Force gathered "+selectedCommits.length+" commit(s) with an exact GitHub author-login match to @"+expected+
          " and pinned the newest project checkpoint at or before "+windowInfo.cutoffIso+". These matches are proposed evidence only until teacher approval; Git timestamps do not prove push time."+(bounded?" The history scan reached the 500-commit review limit.":"")
        :"Force gathered a checkpoint-only project snapshot at or before "+windowInfo.cutoffIso+
          (expected?". No commit in the bounded history had an exact GitHub author-login match to @"+expected+".":" because no linked GitHub username was available for individual matching.")+
          " No individual contribution is inferred."+(bounded?" The history scan reached the 500-commit review limit.":"");
      await setDoc(ref,{
        studentId:student.id,assessmentId:context.taskId,section:context.section,repository:student.repoUrl,
        selectedCommits,checkpointSha:checkpoint,status:"needs_review",source:"teacher_discovered",
        discoveredBy:auth.currentUser.uid,recordedAt:serverTimestamp(),updatedAt:serverTimestamp(),
        discoveryCutoff:windowInfo.cutoffIso,discoveryNote:note.slice(0,1200)
      });
      created++;matched+=selectedCommits.length;if(!selectedCommits.length)checkpointOnly++;
    }catch(error){if(error?.code==="permission-denied")permissionFailures++;failures.push(student.name+": "+error.message);}
  }
  busy=false;await load(context);showBulkExceptions(failures);
  analytics("evidence_gather_completed",{feature:"gradebook",status:failures.length?"partial":"success",count_bucket:created});
  el("gbBulkStatus").textContent="Force gather complete: "+created+" evidence snapshot(s) saved · "+matched+
    " linked-account commit match(es) proposed · "+checkpointOnly+" checkpoint-only snapshot(s) · "+skipped+
    " already handled · "+failures.length+" exception(s) ("+permissionFailures+" permission-related). Existing evidence was never overwritten."+
    (failures.length?" "+failures.slice(0,3).join(" | "):"");
}
async function inspectForApproval(student,evidence){
  const repo=parseRepository(evidence.repository),selection=normalizeSelection(
    evidence.selectedCommits,evidence.checkpointSha,{allowEmpty:evidence.source==="teacher_discovered"});
  const headers=githubHeaders(),api="https://api.github.com/repos/"+encodeURIComponent(repo.owner)+"/"+encodeURIComponent(repo.repo);
  const seen=new Map();
  if(selection.selectedCommits.length){
    const result=await verifyCheckpointAncestry({
      selectedCommits:selection.selectedCommits,checkpointSha:selection.checkpointSha,
      fetchPage:async page=>{
        const response=await fetch(api+"/commits?sha="+encodeURIComponent(selection.checkpointSha)+"&per_page=100&page="+page,{headers});
        if(!response.ok)throw Error("GitHub HTTP "+response.status);
        const items=await response.json();if(!Array.isArray(items))throw Error("GitHub returned invalid commit ancestry.");
        for(const item of items)seen.set(String(item?.sha||"").toLowerCase(),item);
        return items;
      }
    });
    if(!result.ok)throw Error("checkpoint ancestry excludes "+result.missing.length+" selected commit(s)");
  }else{
    const response=await fetch(api+"/commits/"+encodeURIComponent(selection.checkpointSha),{headers});
    if(!response.ok)throw Error("checkpoint could not be verified (GitHub HTTP "+response.status+")");
  }
  if(canDecideClaims){
    const claims=await Promise.all(selection.selectedCommits.map(sha=>
      getDocs(query(collection(db,"commit_reclaims"),where("sha","==",sha)))));
    if(claims.some(snapshot=>snapshot.docs.some(record=>
      record.data().repository===evidence.repository&&record.data().status==="pending")))
      throw Error("pending attribution reclaim");
  }else{
    if(!claimsReadable)throw Error("reclaim-request context unavailable; review this learner individually");
    const selected=new Set(selection.selectedCommits.map(sha=>String(sha).toLowerCase()));
    if([...claimMap.values()].some(claim=>
      selected.has(String(claim.sha||"").toLowerCase())&&
      claim.repository===evidence.repository&&claim.status==="pending"))
      throw Error("pending attribution reclaim");
  }
  const expected=linkedLogin(student);
  const verified=expected?selection.selectedCommits.filter(sha=>
    String(seen.get(sha)?.author?.login||"").toLowerCase()===expected):[];
  return {selection,verified,expected};
}
async function refreshEvidence(){
  if(busy||!context)return;
  const active=context;
  el("gbBulkStatus").textContent="Refreshing evidence statuses from the server…";
  await load(active);
  if(context===active&&evidenceReadable){
    const submitted=bulkApproveCandidates(active.students,evidenceMap);
    const revised=submitted.filter(student=>wasResubmittedAfterReopening(evidenceMap.get(student.id))).length;
    el("gbBulkStatus").textContent="Evidence refreshed: "+submitted.length+" submission(s) awaiting approval"+
      (revised?" · "+revised+" resubmitted after reopening":"")+
      ". Only submitted evidence can be approved; reopened records must be resubmitted first.";
  }
}
async function bulkReopen(){
  if(busy||!context||!evidenceReadable||Number(context.schemaVersion)!==2)return;
  const active=context;
  busy=true;render();
  const failures=[];let reopened=0,skipped=0,confirmed=false;
  try{
    el("gbBulkStatus").textContent="Checking current evidence and protected grades…";
    await load(active);
    if(context!==active||!evidenceReadable)throw Error("Cannot verify current section evidence. Refresh and retry.");
    const candidates=bulkReopenCandidates(active.students,evidenceMap,active.grades);
    const published=active.students.filter(student=>
      mayBulkReopen(evidenceMap.get(student.id))&&active.grades?.[student.id]?.published===true).length;
    if(!candidates.length){
      el("gbBulkStatus").textContent="No eligible evidence to reopen for "+active.section+" · "+assessmentLabel()+
        (published?". "+published+" published grade(s) are protected; unpublish those individually first.":"");
      return;
    }
    const reason=prompt("Reason for reopening "+candidates.length+" evidence submission(s) in "+active.section+
      " for "+assessmentLabel()+" (15–3,000 characters; added to each student's audit history):");
    if(reason===null)return;
    const auditReason=reason.trim();
    if(auditReason.length<15||auditReason.length>3000)
      throw Error("Enter a reopening reason of 15–3,000 characters.");
    if(!confirm("Reopen "+candidates.length+" evidence submission(s) for "+active.section+" · "+assessmentLabel()+
      "? Students will be allowed to change their selected commits and must resubmit for fresh approval. Old approvals and unpublished grading eligibility become stale; no grades or Git commits will be deleted."+
      (published?" "+published+" published grade(s) will remain protected and excluded.":"")))return;
    confirmed=true;
    showBulkExceptions([]);
    analytics("evidence_section_reopen_started",{feature:"gradebook",count_bucket:candidates.length});
    for(const student of candidates){
      if(context!==active){failures.push("Section or assessment changed; remaining students were not processed.");break;}
      try{
        const ref=doc(db,"assessment_evidence",student.id+"_"+active.taskId);
        const [latest,grade]=await Promise.all([
          getDocFromServer(ref),
          getDocFromServer(doc(db,"student_grades",ref.id))
        ]);
        if(grade.exists()&&grade.data().published===true)
          throw Error("Published grade is protected. Unpublish the grade individually first.");
        if(!latest.exists()||!mayBulkReopen(latest.data())){
          skipped++;continue;
        }
        await changeEvidence(ref,latest.data(),{
          status:"reopened",approvedCheckpointSha:null,verifiedContributionCommits:[],contributionScope:"",
          reviewedBy:null,reviewedAt:null,verificationNote:"",
          reopenedBy:auth.currentUser.uid,reopenedAt:serverTimestamp(),reopenReason:auditReason
        },auditReason);
        reopened++;
      }catch(error){failures.push(student.name+": "+error.message);}
      el("gbBulkStatus").textContent="Reopening section evidence: "+reopened+"/"+candidates.length+
        " completed · "+failures.length+" exception(s).";
    }
    analytics("evidence_section_reopen_completed",{feature:"gradebook",
      status:failures.length?"partial":"success",count_bucket:reopened});
  }catch(error){failures.push(error.message);}
  finally{
    busy=false;
    if(context===active){
      await load(active);showBulkExceptions(failures);
      el("gbBulkStatus").textContent=!confirmed&&!failures.length
        ?"No evidence was reopened. The section action was cancelled or no eligible submissions were found."
        :"Section reopening complete: "+reopened+" evidence record(s) reopened · "+
          skipped+" already changed · "+failures.length+" exception(s). Students must select or revise their commits and resubmit for approval."+
          (failures.length?" "+failures.slice(0,3).join(" | "):"");
    }
  }
}
async function bulkApprove(){
  if(busy||!context||Number(context.schemaVersion)!==2)return;
  const active=context;
  busy=true;render();
  const failures=[];let completed=0,verifiedTotal=0,contextOnly=0,candidates=[],confirmed=false,resubmitted=0;
  try{
    el("gbBulkStatus").textContent="Refreshing submitted and resubmitted evidence from the server…";
    await load(active);
    if(context!==active||!evidenceReadable)throw Error("Current submitted evidence could not be verified. Refresh and retry.");
    candidates=bulkApproveCandidates(active.students,evidenceMap).map(student=>({student,evidence:evidenceMap.get(student.id)}));
    if(!candidates.length){
      el("gbBulkStatus").textContent="No submitted evidence is awaiting approval. Evidence still marked Reopened must be resubmitted by the student first.";
      return;
    }
    resubmitted=candidates.filter(item=>wasResubmittedAfterReopening(item.evidence)).length;
    if(!confirm("Approve "+candidates.length+" evidence record(s) in "+active.section+" · "+assessmentLabel()+
      (resubmitted?"? "+resubmitted+" were resubmitted after reopening.":"?")+
      " Adminerva will verify checkpoint ancestry, linked GitHub author matches, and pending reclaim conflicts. Only verified linked-account commits may receive individual contribution credit. This records your approval, not proof of runtime behavior."))return;
    confirmed=true;
    showBulkExceptions([]);
    analytics("evidence_approval_started",{feature:"gradebook",count_bucket:candidates.length});
    for(const {student} of candidates){
      if(context!==active){failures.push("Section or assessment changed; remaining students were not processed.");break;}
      try{
        const ref=doc(db,"assessment_evidence",student.id+"_"+active.taskId);
        const currentSnap=await getDocFromServer(ref);
        if(!currentSnap.exists()||!["submitted","needs_review"].includes(currentSnap.data().status))
          throw Error("Evidence is no longer awaiting approval (status changed).");
        const currentEvidence=currentSnap.data();
        const inspection=await inspectForApproval(student,currentEvidence);
        const verified=inspection.verified;
        const scope=verified.length
          ?"Teacher bulk approval verified "+verified.length+" selected commit(s) with an exact GitHub author-login match to @"+inspection.expected+
            " for "+student.name+". Only those matched commits are approved as individual contribution; non-matching commits and shared project files remain context."
          :"Teacher bulk approval recorded the project checkpoint as context for "+student.name+
            ". No selected commit had an exact linked-account match, so no individual contribution is verified and system evaluation remains disabled.";
        const contribution=approvalContribution(inspection.selection,verified,scope);
        await changeEvidence(ref,currentEvidence,{
          status:"approved",reviewedBy:auth.currentUser.uid,reviewedAt:serverTimestamp(),
          verificationNote:"Bulk evidence approval verified the repository checkpoint, selected-commit ancestry where applicable, linked-account matches, and unresolved reclaim state.",
          approvedCheckpointSha:inspection.selection.checkpointSha,...contribution
        },"Bulk evidence approval after checkpoint and linked-account verification.");
        completed++;verifiedTotal+=verified.length;if(!verified.length)contextOnly++;
      }catch(error){failures.push(student.name+": "+error.message);}
      el("gbBulkStatus").textContent="Approval: "+completed+"/"+candidates.length+
        " approved · "+verifiedTotal+" contribution commit(s) verified · "+failures.length+" need individual review.";
    }
    analytics("evidence_approval_completed",{feature:"gradebook",status:failures.length?"partial":"success",count_bucket:completed});
  }catch(error){failures.push(error.message);}
  finally{
    busy=false;
    if(context===active){
      await load(active);showBulkExceptions(failures);
      el("gbBulkStatus").textContent=!confirmed&&!failures.length
        ?"No evidence was approved. "+(candidates.length?"Approval was cancelled.":"No submitted evidence is awaiting approval; reopened evidence must be resubmitted first.")
        :"Approval complete: "+completed+" approved · "+verifiedTotal+
          " contribution commit(s) verified · "+contextOnly+" checkpoint-only/context-only approval(s) · "+failures.length+
          " left for Review & Grade."+(resubmitted?" "+resubmitted+" reopened submission(s) were included.":"")+
          (failures.length?" "+failures.slice(0,3).join(" | "):"");
    }
  }
}
function eligibleToRerun(evidence,grade){
  return evidence?.status==="approved"&&evidence.verifiedContributionCommits?.length>0&&
    grade?.published===false&&grade.manuallyAdjusted===false&&
    grade.gradeSource==="system_evaluation_draft";
}
async function evaluateOne(student,evidence,assessment,connection,{rerun=false}={}){
  const criteria=parseWeightedRubric(assessment.evalCriteria,assessment.maxScore),token=localStorage.getItem("Adminerva_github_token");
  const source=await loadPinnedV2Source({repository:evidence.repository,checkpointSha:evidence.approvedCheckpointSha,selectedCommits:evidence.selectedCommits,
    assessment,verifiedContributionCommits:evidence.verifiedContributionCommits,token,fetchImpl:globalThis.fetch});
  const evaluation=await evaluateVerifiedEvidence({
    assessment,criteria,evidence:source,contributionScope:evidence.contributionScope,includeImages:false,
    onProgress:progress=>{
      if(progress.mode==="adaptive"&&progress.stage==="chunk")
        el("gbBulkStatus").textContent="Large contribution: processing evidence chunk "+Math.min(progress.completed+1,progress.total)+"/"+progress.total+" for "+student.name+"…";
      else if(progress.mode==="adaptive"&&progress.stage==="final")
        el("gbBulkStatus").textContent="Large contribution: building final rubric proposal for "+student.name+"…";
    }
  });
  const draft=parseSuggestedRubric(evaluation.parsed,criteria,assessment.maxScore,source);
  draft.evaluationMode=evaluation.mode;draft.evidenceChunks=evaluation.chunkCount;
  if(source.truncatedDiffs?.length)draft.limitations=[draft.limitations,"Large verified diffs were truncated for evaluation; teacher review is required."].filter(Boolean).join(" ").slice(0,1400);
  if(source.missingPrimaryPaths?.length)draft.limitations=[draft.limitations,
    "Some verified primary files were renamed or removed before the approved checkpoint ("+source.missingPrimaryPaths.slice(0,6).join(", ")+"). Their commit changes were retained, but teacher review is required before publishing."].filter(Boolean).join(" ").slice(0,1400);
  if(source.excludedMergeCommits?.length){
    draft.limitations=[draft.limitations,"Merge commits were excluded from individual credit ("+source.excludedMergeCommits.length+"). Teacher review should confirm the student's original commits."].filter(Boolean).join(" ").slice(0,1400);
  }
  // Persist an unpublished draft. Only material uncertainty is held for
  // teacher review; clean evaluations can enter the existing bulk publish queue.
  const gradeRef=doc(db,"student_grades",student.id+"_"+context.taskId);
  const latestEvidence=await getDoc(doc(db,"assessment_evidence",gradeRef.id));
  if(!latestEvidence.exists()||latestEvidence.data().status!=="approved"||
     latestEvidence.data().approvedCheckpointSha!==evidence.approvedCheckpointSha||
     evidenceRevision(latestEvidence.data())!==evidenceRevision(evidence))
    throw Error("Evidence changed during evaluation. Reload and evaluate again.");
  const priorGrade=await getDoc(gradeRef);
  if(priorGrade.exists()&&!rerun)throw Error("An existing grade is protected.");
  if(rerun&&(!priorGrade.exists()||!eligibleToRerun(evidence,priorGrade.data())))
    throw Error("This draft has been reviewed or published. Re-evaluation blocked.");
  const needsReview=draft.pendingPoints>0||draft.criteria.some(item=>item.confidence!=="high"||item.status!=="supported")||
    Boolean(draft.limitations);
  const gradePayload={
    studentId:student.id,taskId:context.taskId,section:context.section,
    score:draft.score,maxScore:Number(assessment.maxScore),feedback:draft.feedback,
    published:false,reviewRequired:needsReview,manuallyAdjusted:false,reviewPriority:needsReview?"needs_review":"ready_to_publish",
    reviewReasons:[...new Set([
      ...draft.criteria.filter(item=>item.pendingPoints>0||item.confidence!=="high"||item.status!=="supported")
        .map(item=>item.name+": "+item.reviewAction),
      ...(draft.limitations?[draft.limitations]:[])
    ])].slice(0,30),
    gradeSource:"system_evaluation_draft",gradingMode:"individual",sourceSelectionMode:"verified_evidence",
    gradedSha:evidence.approvedCheckpointSha,evidenceRevision:evidenceRevision(evidence),
    evaluationDraft:{...draft,generatedBy:"Adminerva system evaluation",teacherReviewed:false},
    ...(!rerun?{createdAt:serverTimestamp()}:{}),gradedAt:serverTimestamp()
  };
  if(rerun){
    await runTransaction(db,async tx=>{
      const current=await tx.get(gradeRef),updatedEvidence=await tx.get(doc(db,"assessment_evidence",gradeRef.id));
      if(!current.exists()||!eligibleToRerun(evidence,current.data())||
        !updatedEvidence.exists()||updatedEvidence.data().status!=="approved"||
        evidenceRevision(updatedEvidence.data())!==evidenceRevision(evidence))
        throw Error("Draft or evidence changed; no score was replaced.");
      const old=current.data(),updated={...old,...gradePayload};
      if(old.score===updated.score&&old.feedback===updated.feedback)
        throw Error("Re-evaluation produced the same score and feedback; previous draft preserved.");
      const revision=doc(collection(db,"grade_revisions"));
      tx.set(revision,{gradeId:gradeRef.id,studentId:student.id,taskId:context.taskId,
        editorUid:auth.currentUser.uid,reason:"System draft re-evaluation against current approved contribution evidence",
        before:{score:old.score,feedback:old.feedback,published:false},
        after:{score:updated.score,feedback:updated.feedback,published:false},createdAt:serverTimestamp()});
      tx.set(gradeRef,updated);
    });
  }else await setDoc(gradeRef,gradePayload);
  // A clean system result is an unpublished grade, not a second private suggestion.
  // Only material exceptions need a separate suggestion for instructor review.
  const suggestionRef=draftRef(student.id,context.taskId);
  if(needsReview){
    await setDoc(suggestionRef,{ownerUid:auth.currentUser.uid,studentId:student.id,taskId:context.taskId,section:context.section,
      evidenceRevision:evidenceRevision(evidence),checkpointSha:evidence.approvedCheckpointSha,model:connection.model||localStorage.getItem("Adminerva_ai_model")||"",
      draft,createdAt:serverTimestamp(),status:"private_suggestion"},{merge:false});
  }else{
    await deleteDoc(suggestionRef);
  }
}
async function bulkEvaluate({rerun=false}={}){
  if(busy||!context)return;
  const candidates=context.students.map(s=>({student:s,evidence:evidenceMap.get(s.id)})).filter(({student,evidence})=>{
    const grade=context.grades?.[student.id];return rerun?eligibleToRerun(evidence,grade):
      evidence?.status==="approved"&&evidence.verifiedContributionCommits?.length&&!grade&&!draftMap.has(student.id);
  });
  if(!candidates.length)return;
  if(!confirm(rerun?"Re-evaluate "+candidates.length+" unreviewed, unpublished system draft(s)? Previous scores and feedback will be archived. Teacher-edited and published grades will not change.":
    "Generate unpublished grade drafts for "+candidates.length+" eligible learner(s)? Evaluations with material uncertainty will be flagged for teacher review; clean drafts can be bulk published."))return;
  showBulkExceptions([]);
  analytics(rerun?"system_reevaluation_started":"system_evaluation_started",{feature:"gradebook",count_bucket:candidates.length});
  busy=true;busyEvaluation=true;cancelEvaluation=false;render();let assessment,connection;const failures=[];let completed=0;
  try{
    const snapshot=await getDoc(doc(db,"assessments",context.taskId));if(!snapshot.exists())throw Error("Assessment not found.");assessment={id:snapshot.id,...snapshot.data()};
    connection=await schoolAIStatus();
    for(const item of candidates){
      if(cancelEvaluation)break;
      try{el("gbBulkStatus").textContent=(rerun?"Re-evaluating ":"Evaluating ")+item.student.name+" · "+completed+"/"+candidates.length+" complete…";await evaluateOne(item.student,item.evidence,assessment,connection,{rerun});completed++;}
      catch(error){failures.push(item.student.name+": "+error.message);}
    }
  }catch(error){failures.push(error.message);}
  const stopped=cancelEvaluation;busy=false;busyEvaluation=false;await load(context);showBulkExceptions(failures);
  analytics(rerun?"system_reevaluation_completed":"system_evaluation_completed",{feature:"gradebook",status:stopped?"stopped":failures.length?"partial":"success",count_bucket:completed});el("gbBulkStatus").textContent=(stopped?"Evaluation stopped: ":"Evaluation complete: ")+completed+" unpublished draft(s) "+(rerun?"replaced":"saved")+" · "+failures.length+" processing exception(s). Publish ready drafts in Gradebook; only flagged evaluations need individual review."+(failures.length?" "+failures.slice(0,2).join(" | "):"");
}
window.addEventListener("adminerva:gradebook-grid-loaded",event=>void load(event.detail));
if(window.__adminervaGradebookGridContext)void load(window.__adminervaGradebookGridContext);
el("gbForceGather")?.addEventListener("click",()=>void window.withLoading("Finding repository history…",forceGather,{button:el("gbForceGather")}));
el("gbCopyMissingReminder")?.addEventListener("click",()=>void copyMissingReminder());
el("gbBulkApprove")?.addEventListener("click",()=>void window.withLoading("Reviewing and approving evidence…",bulkApprove,{button:el("gbBulkApprove")}));
el("gbBulkReopen")?.addEventListener("click",()=>void window.withLoading("Reopening selected evidence…",bulkReopen,{button:el("gbBulkReopen")}));
el("gbRefreshEvidence")?.addEventListener("click",()=>void window.withLoading("Refreshing class evidence…",refreshEvidence,{button:el("gbRefreshEvidence")}));
window.addEventListener("focus",()=>{if(context&&!busy&&!document.getElementById("gbLegacyView")?.classList.contains("hidden"))void refreshEvidence();});
el("gbBulkEvaluate")?.addEventListener("click",()=>void window.withLoading("Evaluating verified learner evidence…",()=>bulkEvaluate(),{button:el("gbBulkEvaluate")}));
el("gbBulkRerun")?.addEventListener("click",()=>void window.withLoading("Re-evaluating learner evidence…",()=>bulkEvaluate({rerun:true}),{button:el("gbBulkRerun")}));
el("gbCancelEvaluation")?.addEventListener("click",()=>{cancelEvaluation=true;el("gbBulkStatus").textContent="Stopping after the current learner. Completed drafts are preserved.";});
