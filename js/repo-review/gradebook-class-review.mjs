/** Class-level submission triage and safe bulk review orchestration. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {collection,doc,getDoc,getDocs,query,where,serverTimestamp,setDoc} from "../core/teaching-firestore.mjs?v=1.3.2";
import {changeEvidence} from "./services/evidence-transaction.mjs?v=1.3.0";
import {normalizeSelection,parseRepository,verifyCheckpointAncestry} from "./services/assessment-evidence.mjs?v=1.3.0";
import {approvalContribution,evidenceRevision} from "./services/evidence-lifecycle.mjs?v=1.3.0";
import {parseWeightedRubric,loadPinnedV2Source,buildRubricPrompt,buildRubricResponseSchema,parseSuggestedRubric} from "./services/v2-grading-assistant.mjs?v=1.3.3";
import {generateSchoolContent,schoolAIStatus} from "../core/school-ai.mjs?v=1.3.0";
import {evaluationJSON} from "./services/request-backoff.mjs?v=1.3.1";

const el=id=>document.getElementById(id);
let context=null,busy=false,evidenceMap=new Map(),draftMap=new Map(),receiptMap=new Map();
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
  if(evidence?.status==="needs_review")return {label:"Needs review",tone:"amber",next:"Review submission"};
  if(evidence?.status==="reopened")return {label:"Returned for changes",tone:"amber",next:"View status"};
  if(evidence?.status==="withdrawn")return {label:"Withdrawn",tone:"slate",next:"View status"};
  if(receiptMap.has(student.id))return {label:"Submitted",tone:"blue",next:"Review submission"};
  return {label:"Not submitted",tone:"slate",next:"Open review"};
}
function render(){
  if(!context)return;
  const tools=el("gbClassReviewTools"),isV2=Number(context.schemaVersion)===2;
  tools?.classList.remove("hidden");
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
  const approveCandidates=isV2?context.students.filter(student=>["submitted","needs_review"].includes(evidenceMap.get(student.id)?.status)):[];
  const evaluateCandidates=isV2?context.students.filter(student=>{
    const e=evidenceMap.get(student.id),g=context.grades?.[student.id];
    return e?.status==="approved"&&Array.isArray(e.verifiedContributionCommits)&&e.verifiedContributionCommits.length>0&&!g?.published&&!draftMap.has(student.id);
  }):[];
  el("gbClassReviewSummary").textContent=context.students.length+" learners · "+submitted+" awaiting review · "+approved+" approved · "+drafts+" draft/evaluation ready · "+published+" published"+(exceptions?" · "+exceptions+" exceptions":"");
  el("gbBulkApprove").textContent=isV2?"Approve clean checkpoints ("+approveCandidates.length+")":"Bulk approval · V2 evidence only";
  el("gbBulkApprove").disabled=busy||!approveCandidates.length;
  el("gbBulkEvaluate").textContent=isV2?"Evaluate eligible ("+evaluateCandidates.length+")":"Bulk evaluation · V2 evidence only";
  el("gbBulkEvaluate").disabled=busy||!evaluateCandidates.length;
  const p=new URLSearchParams({section:context.section,assessment:context.taskId});el("gbReviewExceptions").href="repofetch.html?"+p.toString();
}
async function load(detail){
  context=detail;evidenceMap=new Map();draftMap=new Map();receiptMap=new Map();
  try{
    const isV2=Number(detail.schemaVersion)===2;
    const requests=[
      getDocs(query(collection(db,"student_submissions"),where("assessmentId","==",detail.taskId),where("section","==",detail.section)))
    ];
    if(isV2){
      requests.push(
        getDocs(query(collection(db,"assessment_evidence"),where("assessmentId","==",detail.taskId),where("section","==",detail.section))),
        getDocs(collection(db,"teacher_evaluation_drafts",auth.currentUser.uid,"items"))
      );
    }
    const [receiptSnap,evidenceSnap,draftsSnap]=await Promise.all(requests);
    for(const record of receiptSnap.docs){
      const data={id:record.id,...record.data()},prior=receiptMap.get(data.studentId);
      const stamp=value=>value?.toMillis?.()||Date.parse(value||"")||0;
      if(!prior||stamp(data.submittedAt)>stamp(prior.submittedAt))receiptMap.set(data.studentId,data);
    }
    if(isV2){
      evidenceMap=new Map(evidenceSnap.docs.map(record=>[record.data().studentId,{id:record.id,...record.data()}]));
      draftMap=new Map(draftsSnap.docs.filter(record=>{
        const draft=record.data(),evidence=evidenceMap.get(draft.studentId);
        return draft.taskId===detail.taskId&&draft.section===detail.section&&draft.status==="private_suggestion"&&
          evidence?.status==="approved"&&draft.evidenceRevision===evidenceRevision(evidence)&&draft.checkpointSha===evidence.approvedCheckpointSha;
      }).map(record=>[record.data().studentId,{id:record.id,...record.data()}]));
    }
  }catch(error){el("gbBulkStatus").textContent="Class review status is partially unavailable: "+error.message;}
  render();
}
async function ancestryOk(evidence){
  const repo=parseRepository(evidence.repository),selection=normalizeSelection(evidence.selectedCommits,evidence.checkpointSha),token=localStorage.getItem("Adminerva_github_token");
  const headers=token?{Authorization:"Bearer "+token,Accept:"application/vnd.github+json"}:{Accept:"application/vnd.github+json"};
  const api="https://api.github.com/repos/"+encodeURIComponent(repo.owner)+"/"+encodeURIComponent(repo.repo);
  const result=await verifyCheckpointAncestry({selectedCommits:selection.selectedCommits,checkpointSha:selection.checkpointSha,
    fetchPage:async page=>{const response=await fetch(api+"/commits?sha="+encodeURIComponent(selection.checkpointSha)+"&per_page=100&page="+page,{headers});if(!response.ok)throw Error("GitHub HTTP "+response.status);return response.json();}});
  if(!result.ok)throw Error("checkpoint ancestry excludes "+result.missing.length+" selected commit(s)");
  const claims=await Promise.all(selection.selectedCommits.map(sha=>getDocs(query(collection(db,"commit_reclaims"),where("sha","==",sha)))));
  if(claims.some(snapshot=>snapshot.docs.some(record=>record.data().repository===evidence.repository&&record.data().status==="pending")))throw Error("pending attribution reclaim");
  return selection;
}
async function bulkApprove(){
  if(busy||!context)return;
  const candidates=context.students.map(s=>({student:s,evidence:evidenceMap.get(s.id)})).filter(x=>["submitted","needs_review"].includes(x.evidence?.status));
  if(!candidates.length)return;
  if(!confirm("Check and approve "+candidates.length+" submitted checkpoint(s)? Clean checkpoints will be approved as shared project evidence only. Individual contribution credit will NOT be inferred; exceptions remain for manual review."))return;
  busy=true;render();const failures=[];let completed=0;el("gbBulkStatus").textContent="Checking checkpoint ancestry and attribution conflicts…";
  for(const {student,evidence} of candidates){
    try{
      const selection=await ancestryOk(evidence),scope="Bulk checkpoint approval verified repository ancestry and conflict state for "+student.name+". Individual contribution credit was not inferred; verify contribution separately before evaluation.";
      const contribution=approvalContribution(selection,[],scope);
      await changeEvidence(doc(db,"assessment_evidence",student.id+"_"+context.taskId),evidence,{status:"approved",reviewedBy:auth.currentUser.uid,reviewedAt:serverTimestamp(),
        verificationNote:"Bulk checkpoint preflight passed: ancestry was verified and no unresolved selected-commit reclaim was found.",approvedCheckpointSha:selection.checkpointSha,...contribution},
        "Bulk checkpoint approval after ancestry and reclaim preflight.");
      completed++;
    }catch(error){failures.push(student.name+": "+error.message);}
    el("gbBulkStatus").textContent="Bulk approval: "+completed+" approved · "+failures.length+" need individual review.";
  }
  busy=false;await load(context);el("gbBulkStatus").textContent="Bulk approval complete: "+completed+" approved · "+failures.length+" left untouched for Review & grade."+(failures.length?" "+failures.slice(0,3).join(" | "):"");
}
async function evaluateOne(student,evidence,assessment,connection){
  const criteria=parseWeightedRubric(assessment.evalCriteria,assessment.maxScore),token=localStorage.getItem("Adminerva_github_token");
  const source=await loadPinnedV2Source({repository:evidence.repository,checkpointSha:evidence.approvedCheckpointSha,selectedCommits:evidence.selectedCommits,
    assessment,verifiedContributionCommits:evidence.verifiedContributionCommits,token,fetchImpl:globalThis.fetch});
  const prompt=buildRubricPrompt({assessment,criteria,checkpointSha:evidence.approvedCheckpointSha,files:source.files,patches:source.patches,
    contributionScope:evidence.contributionScope,analysis:source.analysis,visualAssetsIncluded:false});
  const result=await generateSchoolContent({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json",
    responseSchema:buildRubricResponseSchema(criteria),maxOutputTokens:12000,temperature:0.1}},{purpose:"evaluation"});
  const parsed=await evaluationJSON({ok:true,json:async()=>result}),draft=parseSuggestedRubric(parsed,criteria,assessment.maxScore,source);
  await setDoc(draftRef(student.id,context.taskId),{ownerUid:auth.currentUser.uid,studentId:student.id,taskId:context.taskId,section:context.section,
    evidenceRevision:evidenceRevision(evidence),checkpointSha:evidence.approvedCheckpointSha,model:connection.model||localStorage.getItem("Adminerva_ai_model")||"",
    draft,createdAt:serverTimestamp(),status:"private_suggestion"},{merge:false});
}
async function bulkEvaluate(){
  if(busy||!context)return;
  const candidates=context.students.map(s=>({student:s,evidence:evidenceMap.get(s.id)})).filter(({student,evidence})=>{
    const grade=context.grades?.[student.id];return evidence?.status==="approved"&&evidence.verifiedContributionCommits?.length&&!grade?.published&&!draftMap.has(student.id);
  });
  if(!candidates.length)return;
  if(!confirm("Generate private evaluation suggestions for "+candidates.length+" eligible learner(s)? Nothing will be graded or published automatically. Each result must still be reviewed in Review & grade."))return;
  busy=true;render();let assessment,connection;const failures=[];let completed=0;
  try{
    const snapshot=await getDoc(doc(db,"assessments",context.taskId));if(!snapshot.exists())throw Error("Assessment not found.");assessment={id:snapshot.id,...snapshot.data()};
    connection=await schoolAIStatus();
    for(const item of candidates){
      try{el("gbBulkStatus").textContent="Evaluating "+item.student.name+" · "+completed+" complete…";await evaluateOne(item.student,item.evidence,assessment,connection);completed++;}
      catch(error){failures.push(item.student.name+": "+error.message);}
    }
  }catch(error){failures.push(error.message);}
  busy=false;await load(context);el("gbBulkStatus").textContent="Bulk evaluation complete: "+completed+" private suggestion(s) ready · "+failures.length+" exception(s). Open Review & grade to confirm score and feedback."+(failures.length?" "+failures.slice(0,2).join(" | "):"");
}
window.addEventListener("adminerva:gradebook-grid-loaded",event=>void load(event.detail));
el("gbBulkApprove")?.addEventListener("click",()=>void bulkApprove());
el("gbBulkEvaluate")?.addEventListener("click",()=>void bulkEvaluate());
