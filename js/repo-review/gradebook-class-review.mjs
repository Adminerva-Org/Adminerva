/** Class-level submission triage and safe bulk review orchestration. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {collection,doc,getDoc,getDocs,query,where,serverTimestamp,setDoc,runTransaction} from "../core/teaching-firestore.mjs?v=1.3.2";
import {changeEvidence} from "./services/evidence-transaction.mjs?v=1.3.0";
import {normalizeSelection,parseRepository} from "./services/assessment-evidence.mjs?v=1.4.3";
import {verifyCheckpointAncestry} from "./services/commit-history.mjs?v=1.4.3";
import {approvalContribution,evidenceRevision} from "./services/evidence-lifecycle.mjs?v=1.4.3";
import {parseWeightedRubric,loadPinnedV2Source,buildRubricPrompt,buildRubricResponseSchema,parseSuggestedRubric} from "./services/v2-grading-assistant.mjs?v=1.4.9";
import {generateSchoolContent,schoolAIStatus} from "../core/school-ai.mjs?v=1.3.0";
import {evaluationJSON} from "./services/request-backoff.mjs?v=1.3.1";

const el=id=>document.getElementById(id);
let context=null,busy=false,busyEvaluation=false,cancelEvaluation=false,evidenceReadable=false,evidenceMap=new Map(),draftMap=new Map(),receiptMap=new Map();
const draftRef=(studentId,taskId)=>doc(db,"teacher_evaluation_drafts",auth.currentUser.uid,"items",studentId+"_"+taskId);
const badge=(text,tone="slate")=>'<span class="inline-flex rounded-full px-2 py-1 font-bold bg-'+tone+'-50 text-'+tone+'-800 border border-'+tone+'-200">'+text+'</span>';
function reviewUrl(studentId){const p=new URLSearchParams({section:context.section,assessment:context.taskId,student:studentId,view:"grade"});return "repofetch.html?"+p.toString();}
function statusFor(student){
  const evidence=evidenceMap.get(student.id),grade=context.grades?.[student.id],draft=draftMap.get(student.id);
  if(grade?.published)return {label:"Published",tone:"emerald",next:"View result"};
  if(grade)return {label:"Graded draft",tone:"cyan",next:"Continue grading"};
  if(draft)return {label:"Evaluation ready",tone:"indigo",next:"Review suggestion"};
  if(evidence?.status==="approved")return {label:evidence.verifiedContributionCommits?.length?"Approved · verified":"Approved · contribution check needed",tone:evidence.verifiedContributionCommits?.length?"emerald":"amber",next:"Review & grade"};
  if(evidence?.status==="submitted")return {label:"Submitted",tone:"blue",next:"Review submission"};
  if(evidence?.status==="needs_review"&&evidence?.source==="teacher_discovered")
    return {label:evidence.selectedCommits?.length?"Gathered · review evidence":"Gathered · checkpoint only",tone:"amber",next:"Review gathered evidence"};
  if(evidence?.status==="needs_review")return {label:"Needs review",tone:"amber",next:"Review submission"};
  if(evidence?.status==="reopened")return {label:"Returned for changes",tone:"amber",next:"View status"};
  if(evidence?.status==="withdrawn")return {label:"Withdrawn",tone:"slate",next:"View status"};
  if(receiptMap.has(student.id))return {label:"Submitted",tone:"blue",next:"Review submission"};
  return {label:"Not submitted",tone:"slate",next:"Open review"};
}
function render(){
  if(!context)return;
  const tools=el("gbClassReviewTools"),isV2=Number(context.schemaVersion)===2;
  if(tools){tools.dataset.ready="true";tools.classList.toggle("hidden",document.getElementById("gbLegacyView")?.classList.contains("hidden")!==false);}
  let submitted=0,approved=0,drafts=0,published=0,exceptions=0;
  for(const student of context.students){
    const state=statusFor(student),box=document.querySelector('[data-review-state="'+CSS.escape(student.id)+'"]');
    if(box){box.innerHTML=badge(state.label,state.tone)+'<a class="block mt-2 font-bold text-blue-700 hover:underline" href="'+reviewUrl(student.id)+'">'+state.next+' →</a>';}
    const evidence=evidenceMap.get(student.id),grade=context.grades?.[student.id];
    if(evidence?.status==="submitted"||evidence?.status==="needs_review"||(!evidence&&receiptMap.has(student.id)))submitted++;
    if(evidence?.status==="approved")approved++;
    if(grade?.published)published++; else if(grade||draftMap.has(student.id))drafts++;
    if(evidence&&["reopened","withdrawn"].includes(evidence.status))exceptions++;
  }
  const gatherCandidates=isV2?context.students.filter(student=>{
    if(evidenceMap.has(student.id)||context.grades?.[student.id]?.published)return false;
    try{return Boolean(parseRepository(student.repoUrl));}catch{return false;}
  }):[];
  const approveCandidates=isV2?context.students.filter(student=>["submitted","needs_review"].includes(evidenceMap.get(student.id)?.status)):[];
  const evaluateCandidates=isV2?context.students.filter(student=>{
    const e=evidenceMap.get(student.id),g=context.grades?.[student.id];
    return e?.status==="approved"&&Array.isArray(e.verifiedContributionCommits)&&e.verifiedContributionCommits.length>0&&!g&&!draftMap.has(student.id);
  }):[];
  el("gbClassReviewSummary").textContent=context.students.length+" learners · "+submitted+" awaiting review · "+approved+" approved · "+drafts+" draft/evaluation ready · "+published+" published"+(exceptions?" · "+exceptions+" exceptions":"");
  if(el("gbForceGather")){
    el("gbForceGather").textContent=isV2?"Force gather evidence ("+gatherCandidates.length+")":"Force gather · V2 evidence only";
    el("gbForceGather").disabled=busy||!evidenceReadable||!gatherCandidates.length;
  }
  el("gbBulkApprove").textContent=isV2?"Approve evidence ("+approveCandidates.length+")":"Approval · V2 evidence only";
  el("gbBulkApprove").disabled=busy||!evidenceReadable||!approveCandidates.length;
  el("gbBulkEvaluate").textContent=isV2?"Run system evaluation ("+evaluateCandidates.length+")":"System evaluation · V2 evidence only";
  el("gbBulkEvaluate").disabled=busy||!evidenceReadable||!evaluateCandidates.length;
  const reruns=isV2?context.students.filter(student=>eligibleToRerun(evidenceMap.get(student.id),context.grades?.[student.id])):[];
  if(el("gbBulkRerun")){el("gbBulkRerun").textContent="Re-evaluate drafts ("+reruns.length+")";el("gbBulkRerun").disabled=busy||!evidenceReadable||!reruns.length;}
  el("gbCancelEvaluation")?.classList.toggle("hidden",!busyEvaluation);
  const p=new URLSearchParams({section:context.section,assessment:context.taskId});el("gbReviewExceptions").href="repofetch.html?"+p.toString();
}
async function load(detail){
  context=detail;evidenceMap=new Map();draftMap=new Map();receiptMap=new Map();
  const isV2=Number(detail.schemaVersion)===2;
  // An unavailable optional collection must never erase the evidence roster or
  // turn unknown submission status into an apparent "not submitted" result.
  const sources=await Promise.allSettled([
    getDocs(query(collection(db,"student_submissions"),where("assessmentId","==",detail.taskId),where("section","==",detail.section))),
    ...(isV2?[
      getDocs(query(collection(db,"assessment_evidence"),where("assessmentId","==",detail.taskId),where("section","==",detail.section))),
      getDocs(collection(db,"teacher_evaluation_drafts",auth.currentUser.uid,"items"))
    ]:[])
  ]);
  const warnings=[];
  if(isV2){
    try{const grades=await getDocs(query(collection(db,"student_grades"),where("taskId","==",detail.taskId)));
      context.grades=Object.fromEntries(grades.docs.filter(record=>detail.students.some(student=>student.id===record.data().studentId))
        .map(record=>[record.data().studentId,record.data()]));
    }catch(error){warnings.push("gradebook drafts: "+error.message);}
  }
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
  busy=false;await load(context);
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
  const claims=await Promise.all(selection.selectedCommits.map(sha=>getDocs(query(collection(db,"commit_reclaims"),where("sha","==",sha)))));
  if(claims.some(snapshot=>snapshot.docs.some(record=>record.data().repository===evidence.repository&&record.data().status==="pending")))
    throw Error("pending attribution reclaim");
  const expected=linkedLogin(student);
  const verified=expected?selection.selectedCommits.filter(sha=>
    String(seen.get(sha)?.author?.login||"").toLowerCase()===expected):[];
  return {selection,verified,expected};
}
async function bulkApprove(){
  if(busy||!context||!evidenceReadable)return;
  const candidates=context.students.map(s=>({student:s,evidence:evidenceMap.get(s.id)})).filter(x=>["submitted","needs_review"].includes(x.evidence?.status));
  if(!candidates.length)return;
  if(!confirm("Approve "+candidates.length+" evidence record(s)? Adminerva will verify the project checkpoint and selected-commit ancestry. Selected commits whose GitHub author login exactly matches the learner's linked GitHub account will be marked as teacher-approved individual contributions; non-matching or unknown commits remain unverified. This is an explicit teacher approval action, not automatic proof of authorship."))return;
  busy=true;render();const failures=[];let completed=0,verifiedTotal=0,contextOnly=0;
  el("gbBulkStatus").textContent="Checking checkpoint ancestry, linked-account matches and attribution conflicts…";
  for(const {student,evidence} of candidates){
    try{
      const currentSnap=await getDoc(doc(db,"assessment_evidence",student.id+"_"+context.taskId));
      if(!currentSnap.exists()||!["submitted","needs_review"].includes(currentSnap.data().status))throw Error("Evidence is no longer awaiting approval.");
      const currentEvidence=currentSnap.data();
      const inspection=await inspectForApproval(student,currentEvidence);
      const verified=inspection.verified;
      const scope=verified.length
        ?"Teacher bulk approval verified "+verified.length+" selected commit(s) with an exact GitHub author-login match to @"+inspection.expected+
          " for "+student.name+". Only those matched commits are approved as individual contribution; non-matching commits and shared project files remain context."
        :"Teacher bulk approval recorded the project checkpoint as context for "+student.name+
          ". No selected commit had an exact linked-account match, so no individual contribution is verified and system evaluation remains disabled.";
      const contribution=approvalContribution(inspection.selection,verified,scope);
      await changeEvidence(doc(db,"assessment_evidence",student.id+"_"+context.taskId),currentEvidence,{
        status:"approved",reviewedBy:auth.currentUser.uid,reviewedAt:serverTimestamp(),
        verificationNote:"Bulk evidence approval verified the repository checkpoint, selected-commit ancestry where applicable, linked-account matches, and unresolved reclaim state.",
        approvedCheckpointSha:inspection.selection.checkpointSha,...contribution
      },"Bulk evidence approval after checkpoint and linked-account verification.");
      completed++;verifiedTotal+=verified.length;if(!verified.length)contextOnly++;
    }catch(error){failures.push(student.name+": "+error.message);}
    el("gbBulkStatus").textContent="Approval: "+completed+" approved · "+verifiedTotal+" contribution commit(s) verified · "+failures.length+" need individual review.";
  }
  busy=false;await load(context);
  el("gbBulkStatus").textContent="Approval complete: "+completed+" approved · "+verifiedTotal+
    " contribution commit(s) verified · "+contextOnly+" checkpoint-only/context-only approval(s) · "+failures.length+
    " left for Review & grade. System evaluation is available only where individual contribution was verified."+
    (failures.length?" "+failures.slice(0,3).join(" | "):"");
}
function eligibleToRerun(evidence,grade){
  return evidence?.status==="approved"&&evidence.verifiedContributionCommits?.length>0&&
    grade?.published===false&&grade.reviewRequired===true&&grade.manuallyAdjusted===false&&
    grade.gradeSource==="system_evaluation_draft";
}
async function evaluateOne(student,evidence,assessment,connection,{rerun=false}={}){
  const criteria=parseWeightedRubric(assessment.evalCriteria,assessment.maxScore),token=localStorage.getItem("Adminerva_github_token");
  const source=await loadPinnedV2Source({repository:evidence.repository,checkpointSha:evidence.approvedCheckpointSha,selectedCommits:evidence.selectedCommits,
    assessment,verifiedContributionCommits:evidence.verifiedContributionCommits,token,fetchImpl:globalThis.fetch});
  const prompt=buildRubricPrompt({assessment,criteria,checkpointSha:evidence.approvedCheckpointSha,files:source.files,patches:source.patches,
    contributionScope:evidence.contributionScope,analysis:source.analysis,visualAssetsIncluded:false});
  const result=await generateSchoolContent({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json",
    responseSchema:buildRubricResponseSchema(criteria),maxOutputTokens:12000,temperature:0.1}},{purpose:"evaluation"});
  const parsed=await evaluationJSON({ok:true,json:async()=>result}),draft=parseSuggestedRubric(parsed,criteria,assessment.maxScore,source);
  if(source.excludedMergeCommits?.length){
    draft.limitations=[draft.limitations,"Merge commits were excluded from individual credit ("+source.excludedMergeCommits.length+"). Teacher review should confirm the student's original commits."].filter(Boolean).join(" ").slice(0,1400);
  }
  // Persist the result in the protected gradebook as an unpublished, explicitly
  // unreviewed draft. A system result can never satisfy publication requirements.
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
    published:false,reviewRequired:true,manuallyAdjusted:false,reviewPriority:needsReview?"needs_review":"ready_for_teacher_confirmation",
    reviewReasons:[...new Set(draft.criteria.filter(item=>item.pendingPoints>0||item.confidence!=="high")
      .map(item=>item.name+": "+item.reviewAction))].slice(0,30),
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
  await setDoc(draftRef(student.id,context.taskId),{ownerUid:auth.currentUser.uid,studentId:student.id,taskId:context.taskId,section:context.section,
    evidenceRevision:evidenceRevision(evidence),checkpointSha:evidence.approvedCheckpointSha,model:connection.model||localStorage.getItem("Adminerva_ai_model")||"",
    draft,createdAt:serverTimestamp(),status:"private_suggestion"},{merge:false});
}
async function bulkEvaluate({rerun=false}={}){
  if(busy||!context)return;
  const candidates=context.students.map(s=>({student:s,evidence:evidenceMap.get(s.id)})).filter(({student,evidence})=>{
    const grade=context.grades?.[student.id];return rerun?eligibleToRerun(evidence,grade):
      evidence?.status==="approved"&&evidence.verifiedContributionCommits?.length&&!grade&&!draftMap.has(student.id);
  });
  if(!candidates.length)return;
  if(!confirm(rerun?"Re-evaluate "+candidates.length+" unreviewed, unpublished system draft(s)? Previous scores and feedback will be archived. Teacher-edited and published grades will not change.":
    "Generate unpublished grade drafts for "+candidates.length+" eligible learner(s)? Scores and feedback will require teacher confirmation."))return;
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
  const stopped=cancelEvaluation;busy=false;busyEvaluation=false;await load(context);el("gbBulkStatus").textContent=(stopped?"Evaluation stopped: ":"Evaluation complete: ")+completed+" unpublished draft(s) "+(rerun?"replaced":"saved")+" · "+failures.length+" exception(s). Open Review & grade to confirm score and feedback."+(failures.length?" "+failures.slice(0,2).join(" | "):"");
}
window.addEventListener("adminerva:gradebook-grid-loaded",event=>void load(event.detail));
el("gbForceGather")?.addEventListener("click",()=>void forceGather());
el("gbBulkApprove")?.addEventListener("click",()=>void bulkApprove());
el("gbBulkEvaluate")?.addEventListener("click",()=>void bulkEvaluate());
el("gbBulkRerun")?.addEventListener("click",()=>void bulkEvaluate({rerun:true}));
el("gbCancelEvaluation")?.addEventListener("click",()=>{cancelEvaluation=true;el("gbBulkStatus").textContent="Stopping after the current learner. Completed drafts are preserved.";});
