/** Primary teacher evidence review, evaluation drafts and deliberate grade publication. */
import { auth, db } from "../core/firebase-core.js?v=1.3.0";
import {schoolAIStatus} from "../core/school-ai.mjs?v=1.3.0";
import { cleanGradeFeedback } from "../core/feedback-format.mjs?v=1.3.0";
import {assertGradeVersion,nextGradeVersion} from "./services/grade-version.mjs?v=1.3.0";
import {renderFeedbackMarkdown} from "./review-ui.mjs?v=1.3.0";
import { pickDefinedGradeFields } from "./services/grade-revision-snapshot.mjs?v=1.3.0";
import {
  collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp
} from "../core/teaching-firestore.mjs?v=1.3.2";
import { analyzePatchSubstance } from "./services/commit-substance.mjs?v=1.3.0";
import {parseRepository,validSha} from "./services/assessment-evidence.mjs?v=1.3.0";
import {parseWeightedRubric,loadPinnedV2Source,parseSuggestedRubric}
  from "./services/v2-grading-assistant.mjs?v=1.4.25";
import {buildExternalEvaluationPackage,parseExternalEvaluationResponse}
  from "./services/external-evaluation.mjs?v=1.1.1";
import {evaluateVerifiedEvidence} from "./services/adaptive-evaluation.mjs?v=1.3.2";
import {isAndroidUiAssessment} from "./services/android-evidence.mjs?v=1.3.0";
import {evidenceRevision,gradeMatchesEvidence,sameEvidence} from "./services/evidence-lifecycle.mjs?v=1.3.0";
import {verifyGradePublication} from "./services/evidence-transaction.mjs?v=1.3.0";
import {createReviewRequests} from "./services/review-requests.mjs?v=1.3.0";
import {mountReviewPanels} from "./review-panels.mjs?v=1.4.8";

const el = id => document.getElementById(id);
const analytics=(event,params={})=>window.AdminervaAnalytics?.track(event,params);
const state = { active: null, request: null, token: 0, flags: [], aiBusy: false, dirty:false, abort:null,panels:null,requests:null,aiAbort:null,
  externalEvidence:null,externalPackage:"",externalEvidenceKey:"",externalBusy:false };
function message(text, error=false) {
  const node=el("manualReviewStatus");
  node.textContent=text; node.className=error ? "text-sm text-rose-700" : "text-sm text-slate-600";
  if(el("manualReviewStepStatus"))el("manualReviewStepStatus").textContent=text;
}
function safeRepo(owner, repo) {
  const segment = /^[A-Za-z0-9_.-]{1,100}$/;
  if (!segment.test(owner) || !segment.test(repo) || owner==="." || repo==="..") {
    throw new Error("Invalid repository owner or name.");
  }
  return "https://github.com/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo);
}
function link(parent, text, url) {
  const a=document.createElement("a");
  a.textContent=text; a.href=url; a.target="_blank"; a.rel="noopener noreferrer";
  a.className="font-bold text-blue-700 hover:underline break-all";
  parent.append(a);
  return a;
}
function flag(text) {
  if (!text) return;
  const p=document.createElement("p");
  p.className="mb-2"; p.textContent=String(text);
  if (state.flags.length < 60) state.flags.push(String(text).slice(0, 1200));
  el("manualReviewFlags").append(p);
}
function close({force=false,silent=false}={}) {
  if(!force&&(state.dirty||state.panels?.hasUnsavedReview?.())&&!confirm("Discard unsaved score, feedback or verification changes?"))return false;
  el("manualReviewModal").classList.add("hidden");
  el("externalEvaluationModal")?.classList.add("hidden");
  state.abort?.abort();state.aiAbort?.abort();state.panels?.destroy();state.panels=null;
  state.active=null;
  state.request=null;
  state.aiBusy=false;
  state.externalEvidence=null;state.externalPackage="";state.externalEvidenceKey="";state.externalBusy=false;
  state.dirty=false;
  state.token++;
  if(!silent)window.dispatchEvent(new CustomEvent("adminerva:manual-review-closed"));
  return true;
}
async function githubGet(url, session) {
  const response=await state.requests.fetch(url);
  if (session!==state.token) throw new Error("Review was closed");
  if (!response.ok) throw new Error("GitHub HTTP "+response.status);
  return response.json();
}
async function sourceLinks(session, base, owner, repo, login, checkpointSha=null) {
  try {
    const data=checkpointSha?null:await githubGet("https://api.github.com/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo),session);
    if (session!==state.token) return;
    if(!checkpointSha&&!data?.default_branch)throw Error("No confirmed default branch");
    const branch=encodeURIComponent(checkpointSha||data.default_branch);
    const links=el("manualReviewLinks");
    link(links,"app/src ↗",base+"/tree/"+branch+"/app/src");
    link(links,"app/src/test/java ↗",base+"/tree/"+branch+"/app/src/test/java");
    link(links,"src ↗",base+"/tree/"+branch+"/src");
    const note=document.createElement("span");
    note.className="text-xs text-slate-500";
    note.textContent="Source locations vary by project; unavailable folders may show 404.";
    links.append(note);
  } catch (error) {
    if (session!==state.token) return;
    flag("Source-folder shortcuts could not verify the default branch ("+error.message+"). Open the repository and use its Code tab.");
  }
}
async function examineRecentCommits(session, owner, repo, login) {
  const button=el("manualReviewAnalyze");
  button.disabled=true; button.textContent="Checking up to 8 commits…";
  try {
    const url="https://api.github.com/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo)+
      "/commits?author="+encodeURIComponent(login)+"&per_page=20";
    const recent=await githubGet(url,session);
    if (!Array.isArray(recent)) throw new Error("Unexpected GitHub response");
    if (!recent.length) { flag("No recent commits were found for this GitHub login. This does not prove that work is absent."); return; }
    let low=0,substantive=0,unknown=0,merges=0;
    for (const c of recent.slice(0,8)) {
      if (session!==state.token) return;
      if (c.parents?.length>1) {merges++; continue;}
      const item=await githubGet("https://api.github.com/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo)+"/commits/"+encodeURIComponent(c.sha),session);
      const flagged=[];
      for(const file of item.files||[]) {
        const result=analyzePatchSubstance(file.patch,file.filename);
        if(result.substantive===false){low++;flagged.push(file.filename+" — "+result.reason);}
        else if(result.substantive===true) substantive++;
        else unknown++;
      }
      if(flagged.length) {
        const base=safeRepo(owner,repo);
        flag("Possible low-substance change in commit "+c.sha.slice(0,12)+": "+flagged.slice(0,6).join(" | "));
        link(el("manualReviewFlags"),"View commit ↗",base+"/commit/"+encodeURIComponent(c.sha));
      }
    }
    flag("Sampled up to 8 recent commits: "+low+" formatting/comment-only file patches; "+
      substantive+" patches with implementation changes; "+unknown+" unavailable/uncertain patches; "+
      merges+" merge commits requiring separate review. Flags do not prove original authorship.");
  } catch (error) {
    if (session===state.token) flag("Commit patch scan unavailable: "+error.message+
      ". Use the GitHub commit-history shortcut for manual inspection.");
  } finally {
    if (session===state.token){button.disabled=false;button.textContent="Analyze recent commit patches";}
  }
}

function aiStatus(text,error=false){
  const target=el("manualReviewAIStatus");if(!target)return;
  target.textContent=text;
  target.className="text-xs "+(error?"text-rose-800":"text-indigo-900");
}
function evaluationResponsibilityReady(assessment,evidence){
  const commits=Array.isArray(evidence?.verifiedContributionCommits)?evidence.verifiedContributionCommits:[];
  if(!commits.length||commits.some(sha=>!evidence?.selectedCommits?.includes(sha)))return false;
  return String(evidence?.contributionScope||"").trim().length>=15||isAndroidUiAssessment(assessment);
}
function stopEvaluation(text){
  if(!state.active)return;
  state.aiAbort?.abort();state.aiBusy=false;state.active={...state.active};
  el("manualReviewAIGenerate").disabled=Boolean(state.active.previous?.published)||!state.active.checkpointSha||!state.active.evidence?.verifiedContributionCommits?.length;
  el("manualReviewAIGenerate").textContent="Evaluate";aiStatus(text);
}
function displayAISuggestion(draft){
  const container=el("manualReviewAIScores");container.replaceChildren();
  for(const item of draft.criteria){
    const row=document.createElement("div");
    row.className="bg-white rounded border border-indigo-100 p-3";
    const heading=document.createElement("strong");heading.className="text-sm";
    heading.textContent=item.score===null
      ?item.name+": teacher confirmation · up to "+item.pendingPoints+" / "+item.maxScore+" pts"
      :item.name+": "+item.score+"/"+item.maxScore+(item.pendingPoints>0?" · +"+item.pendingPoints+" pt"+(item.pendingPoints===1?"":"s")+" pending":"");
    const confidence=document.createElement("span");confidence.className="ml-2 text-[11px] font-semibold text-slate-500";
    confidence.textContent="Confidence: "+item.confidence.replace("_"," ");
    const rationale=document.createElement("p");rationale.className="mt-1 text-xs text-slate-700 whitespace-pre-wrap";
    rationale.textContent=item.rationale;
    row.append(heading,confidence,rationale);
    if(item.reviewAction){const action=document.createElement("p");action.className="mt-2 text-xs font-semibold text-amber-900";action.textContent="Teacher confirmation: "+item.reviewAction;row.append(action);}
    if(item.evidence?.length){const references=document.createElement("p");references.className="mt-2 text-xs font-mono break-words";references.textContent="Verified evidence: "+item.evidence.map(reference=>reference.path+" @ "+reference.sha.slice(0,12)).join(" · ");row.append(references);}
    container.append(row);
  }
  const total=document.createElement("div");total.className="rounded-lg border border-indigo-200 bg-white p-3";
  const main=document.createElement("p");main.className="font-extrabold text-indigo-950";
  main.textContent="Proposed score: "+draft.score+"/"+state.active.maxScore;
  total.append(main);
  if(draft.pendingPoints>0){
    const range=document.createElement("p");range.className="text-xs text-amber-900 mt-1";
    range.textContent=draft.pendingPoints+" point"+(draft.pendingPoints===1?"":"s")+" still need teacher confirmation · possible range "+draft.score+"–"+draft.potentialScore+"/"+state.active.maxScore+".";
    total.append(range);
  }else{
    const complete=document.createElement("p");complete.className="text-xs text-emerald-800 mt-1";
    complete.textContent="No rubric points remain pending from this evidence package.";
    total.append(complete);
  }
  container.append(total);
  if(draft.projectObservations){
    const observation=document.createElement("p");observation.className="text-xs text-slate-700";
    observation.textContent="Shared project context (separate from individual score): "+draft.projectObservations;
    container.append(observation);
  }
  if(draft.limitations){
    const limitation=document.createElement("p");
    limitation.className="text-xs text-amber-900 whitespace-pre-wrap";
    limitation.textContent="Remaining teacher checks: "+draft.limitations;
    container.append(limitation);
  }
}
function currentExternalEvidenceKey(active){
  if(!active?.evidence||!active.checkpointSha)return "";
  return JSON.stringify([
    active.studentId,active.taskId,active.checkpointSha,evidenceRevision(active.evidence),
    active.selectedEvidenceCommits||[],active.evidence.verifiedContributionCommits||[]
  ]);
}
function externalStatus(text,error=false){
  const node=el("externalEvaluationStatus");if(!node)return;
  node.textContent=text;node.className="text-xs "+(error?"text-rose-700":"text-indigo-900");
}
let externalLoadingGeneration=0;
function beginExternalOperation(message){
  const indicator=el("externalEvaluationProcessing"),label=el("externalEvaluationProcessingText");
  const generation=++externalLoadingGeneration;
  if(label)label.textContent=message;
  if(indicator){indicator.hidden=false;indicator.classList.remove("hidden");indicator.style.display="flex";}
  const end=window.beginLoading?.(message)||(()=>{});
  return ()=>{
    end();
    if(generation===externalLoadingGeneration&&indicator){
      indicator.hidden=true;indicator.classList.add("hidden");indicator.style.display="none";
    }
  };
}
function closeExternalEvaluation(){
  el("externalEvaluationModal")?.classList.add("hidden");
}
async function copyExternalPackage(){
  const value=state.externalPackage||el("externalEvaluationPackage")?.value||"";
  if(!value)return externalStatus("Prepare the evidence package before copying.",true);
  const button=el("externalEvaluationCopy");
  if(button.disabled||state.externalBusy)return;
  button.disabled=true;
  const end=beginExternalOperation("Copying verified evaluation package…");
  try{
    await navigator.clipboard.writeText(value);
    externalStatus("Evaluation package copied. Paste it into ChatGPT or another evaluator, then paste the returned JSON below.");
  }catch{
    const target=el("externalEvaluationPackage");target.focus();target.select();
    const copied=document.execCommand?.("copy");
    externalStatus(copied?"Evaluation package copied.":"Clipboard access was blocked. Select the package text and copy it manually.",!copied);
  }finally{button.disabled=false;end();}
}
async function openExternalEvaluation(){
  const active=state.active;
  if(!active||active.assessment.schemaVersion!==2||!active.checkpointSha||!evaluationResponsibilityReady(active.assessment,active.evidence))
    return aiStatus("Approve the checkpoint and verify individual contributions before preparing an external evaluation.",true);
  if(active.previous?.published)return aiStatus("Published grade protected. Unpublish it before preparing a new evaluation.",true);
  const key=currentExternalEvidenceKey(active);
  if(!key)return aiStatus("Approved evidence is unavailable. Reopen the assessment review.",true);
  el("externalEvaluationModal").classList.remove("hidden");
  if(state.externalBusy){
    externalStatus("Adminerva is still processing the current external evaluation step. Please wait for the status above.");
    return;
  }
  if(state.externalEvidence&&state.externalPackage&&state.externalEvidenceKey===key){
    el("externalEvaluationPackage").value=state.externalPackage;
    el("externalEvaluationCopy").disabled=false;
    el("externalEvaluationImport").disabled=false;
    externalStatus("Verified evidence is ready. Paste the evaluator's JSON below; closing and reopening this dialog does not clear your result.");
    return;
  }
  // A changed evidence revision invalidates the previous response; otherwise keep any pasted JSON.
  if(state.externalEvidenceKey&&state.externalEvidenceKey!==key)
    el("externalEvaluationResult").value="";
  el("externalEvaluationPackage").value="";
  el("externalEvaluationCopy").disabled=true;
  el("externalEvaluationImport").disabled=true;
  el("externalEvaluationPackageStatus").textContent="Preparing verified evidence…";
  externalStatus("Preparing the approved checkpoint. Paste your result once the package is ready.");
  state.externalBusy=true;state.externalEvidence=null;state.externalPackage="";
  const end=beginExternalOperation("Preparing verified commits and checkpoint files…");
  const session=state.token;
  try{
    const criteria=parseWeightedRubric(active.assessment.evalCriteria,active.maxScore);
    const [evidence,privateAssessment]=await Promise.all([
      loadPinnedV2Source({
        repository:active.base,checkpointSha:active.checkpointSha,
        selectedCommits:active.selectedEvidenceCommits,assessment:active.assessment,
        verifiedContributionCommits:active.evidence.verifiedContributionCommits,
        token:localStorage.getItem("Adminerva_github_token"),fetchImpl:state.requests?.fetch||globalThis.fetch
      }),
      getDoc(doc(db,"assessment_private",active.taskId))
        .then(snapshot=>snapshot.exists()?snapshot.data():{})
        .catch(()=>({}))
    ]);
    if(session!==state.token||state.active!==active||key!==currentExternalEvidenceKey(active))return;
    const pack=buildExternalEvaluationPackage({
      assessment:active.assessment,criteria,evidence,privateAssessment,
      contributionScope:active.evidence.contributionScope,maxScore:active.maxScore
    });
    state.externalEvidence=evidence;state.externalPackage=pack;state.externalEvidenceKey=key;
    el("externalEvaluationPackage").value=pack;
    el("externalEvaluationCopy").disabled=false;
    el("externalEvaluationImport").disabled=false;
    const kb=Math.max(1,Math.round(new Blob([pack]).size/1024));
    const historical=evidence.files.filter(file=>file.historical).length;
    el("externalEvaluationPackageStatus").textContent="Ready · "+evidence.patches.length+" verified change record(s) · "+
      evidence.files.filter(file=>!file.historical).length+" checkpoint file(s) · "+historical+" recovered historical file(s) · about "+kb+
      " KB. "+(evidence.missingPrimaryPaths?.length
        ?"Some verified student files are absent at the later checkpoint; their exact selected-commit diffs are retained. Historical source and missing files are explicitly marked. ":"")+
      "Rubric and task instructions included. Review teacher-only guidance before sharing; JSON-only reply required.";
    externalStatus("Evidence ready. Paste the evaluator's JSON and validate, or copy the package for a new evaluation.");
    analytics("external_evaluation_package_ready",{feature:"review_grade",size_bucket:kb>500?"500kb_plus":kb>100?"100_500kb":"under_100kb"});
  }catch(error){
    if(session===state.token&&state.active===active){
      el("externalEvaluationPackageStatus").textContent="Could not prepare the external package: "+error.message;
      externalStatus("Evidence could not be prepared. Check the GitHub connection and reopen External evaluation to retry; your pasted result is preserved.",true);
    }
  }finally{end();if(session===state.token)state.externalBusy=false;}
}
async function importExternalEvaluation(){
  const active=state.active,session=state.token;
  if(!active||!active.checkpointSha||!evaluationResponsibilityReady(active.assessment,active.evidence))
    return externalStatus("This assessment no longer has an approved verified checkpoint. Reopen evidence review before importing.",true);
  if(active.previous?.published)return externalStatus("Published grade protected. Unpublish it before importing a new evaluation.",true);
  if(state.externalBusy)return externalStatus("An evaluation operation is still processing. Finish it before validating again.",true);
  const key=currentExternalEvidenceKey(active);
  if(state.externalEvidenceKey&&state.externalEvidenceKey!==key)
    return externalStatus("The approved evidence changed after the package was prepared. Copy a new package and request an updated evaluation.",true);
  const button=el("externalEvaluationImport");
  if(button.disabled)return;
  state.externalBusy=true;
  button.disabled=true;button.textContent="Validating…";
  const end=beginExternalOperation("Validating external evaluation against the rubric…");
  try{
    const criteria=parseWeightedRubric(active.assessment.evalCriteria,active.maxScore);
    const parsed=parseExternalEvaluationResponse(el("externalEvaluationResult").value);
    let evidence=state.externalEvidence;
    if(!evidence){
      // Recover an interrupted/closed handoff from the current approved snapshot, not a mutable branch.
      externalStatus("Restoring verified evidence from the approved checkpoint before validation…");
      el("externalEvaluationProcessingText").textContent="Restoring approved checkpoint evidence for validation…";
      evidence=await loadPinnedV2Source({
        repository:active.base,checkpointSha:active.checkpointSha,
        selectedCommits:active.selectedEvidenceCommits,assessment:active.assessment,
        verifiedContributionCommits:active.evidence.verifiedContributionCommits,
        token:localStorage.getItem("Adminerva_github_token"),fetchImpl:state.requests?.fetch||globalThis.fetch
      });
      if(session!==state.token||state.active!==active||key!==currentExternalEvidenceKey(active))
        throw Error("Approved evidence changed while restoring it. Reopen this learner and prepare a new package.");
      state.externalEvidence=evidence;state.externalEvidenceKey=key;
    }
    if(session!==state.token||state.active!==active||key!==currentExternalEvidenceKey(active))
      throw Error("The active learner or approved evidence changed. Reopen the current review.");
    const draft=parseSuggestedRubric(parsed,criteria,active.maxScore,evidence);
    if(evidence.truncatedDiffs?.length)
      draft.limitations=[draft.limitations,evidence.truncatedDiffs.length+" relevant commit diff(s) were bounded; omitted changes require teacher review before assigning credit."].filter(Boolean).join(" ").slice(0,1400);
    if(evidence.missingPrimaryPaths?.length)
      draft.limitations=[draft.limitations,"Some primary files in the verified commits were renamed or removed before the approved checkpoint ("+
        evidence.missingPrimaryPaths.slice(0,6).join(", ")+"). Retained commit changes require teacher confirmation."].filter(Boolean).join(" ").slice(0,1400);
    active.aiDraft={model:"external-evaluation",checkpointSha:active.checkpointSha,evaluationMode:"external",evidenceChunks:0,...draft};
    active.aiApplied=false;state.dirty=true;
    displayAISuggestion(draft);
    renderFeedbackMarkdown(el("manualReviewAIFeedback"),draft.feedback);
    el("manualReviewUseScore").disabled=draft.score===null;
    el("manualReviewUseFeedback").disabled=!draft.feedback;
    el("manualReviewFiles").value=[...new Set(evidence.patches.filter(p=>p.substantive===true&&!p.mergeContext).map(p=>p.path))].join("\n");
    const scoreField=el("manualReviewScore"),feedbackField=el("manualReviewFeedback"),applied=[];
    if(draft.score!==null&&!scoreField.value.trim()){scoreField.value=String(draft.score);applied.push("score");}
    if(draft.feedback&&!feedbackField.value.trim()){feedbackField.value=String(draft.feedback);applied.push("feedback");}
    if(applied.length){
      active.aiApplied=true;
      el("manualReviewConfirm").checked=false;
      el("manualReviewSave").disabled=false;
    }
    const appliedLabel=applied.length===2?"score and feedback":applied[0]||"";
    aiStatus(applied.length
      ?"External evaluation validated. The proposed "+appliedLabel+" "+(applied.length===2?"were":"was")+" copied into empty teacher fields. Review or edit before saving; nothing has been published."
      :"External evaluation validated. Existing teacher fields were preserved. Review the proposal and use the replacement buttons if you want to overwrite them; nothing has been saved or published.");
    externalStatus("Validated successfully. The proposal is now in Evaluation draft.");
    analytics("external_evaluation_imported",{feature:"review_grade",status:"success"});
    closeExternalEvaluation();
    el("manualReviewAISection").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(error){
    if(session===state.token){
      analytics("external_evaluation_imported",{feature:"review_grade",status:"invalid"});
      externalStatus("Import rejected: "+error.message,true);
    }
  }finally{
    end();
    if(session===state.token){
      state.externalBusy=false;
      button.disabled=false;
      button.textContent="Validate & apply proposal";
    }
  }
}

async function generateAIDraft(){
  const active=state.active;
  if(!active||active.assessment.schemaVersion!==2||!active.checkpointSha||state.aiBusy){
    return aiStatus("Approve the checkpoint and verify individual contributions before evaluation.",true);
  }
  if(active.previous?.published)return aiStatus("Published grade protected. Unpublish for revision below before evaluating.",true);
  let connection;try{connection=await schoolAIStatus();}catch(error){return aiStatus(error.message,true);}
  const model=String(connection.configured?connection.model:localStorage.getItem("Adminerva_ai_model")||"gemini-3.8-flash").trim();
  if(!/^[a-zA-Z0-9._-]{1,80}$/.test(model))return aiStatus("The configured evaluation model name is invalid. Check provider settings.",true);
  if(!confirm("Evaluate this approved checkpoint? Relevant student source and verified diffs will be sent through the school’s configured evaluation service to generate draft scores and feedback. Verify the result before saving."))return;
  const session=state.token;
  state.aiBusy=true;
  const controller=new AbortController();state.aiAbort=controller;
  let evaluationTimeout=null,evaluationSlowNotice=null;
  const button=el("manualReviewAIGenerate");button.disabled=true;
  button.textContent="Evaluating…";
  try{
    const criteria=parseWeightedRubric(active.assessment.evalCriteria,active.maxScore);
    aiStatus("Retrieving selected commit diffs and source files from the approved GitHub checkpoint…");
    const evidence=await loadPinnedV2Source({
      repository:active.base,checkpointSha:active.checkpointSha,
      selectedCommits:active.selectedEvidenceCommits,assessment:active.assessment,
      verifiedContributionCommits:active.evidence.verifiedContributionCommits,
      token:localStorage.getItem("Adminerva_github_token"),fetchImpl:state.requests?.fetch||globalThis.fetch
    });
    if(session!==state.token||state.active!==active)return;
    aiStatus("Preparing verified evidence for evaluation. Existing student grades remain unchanged…");
    if(controller.signal.aborted)throw Error("Evaluation timed out. Continue manually or retry.");
    evaluationSlowNotice=setTimeout(()=>{
      if(session===state.token&&state.active===active&&state.aiBusy)
        aiStatus("Evaluation is still processing verified evidence. No score or feedback has been changed.");
    },45000);
    evaluationTimeout=setTimeout(()=>{
      controller.abort();
      if(session===state.token&&state.active===active){
        stopEvaluation("Evaluation timed out before the service finished. No score was saved. Retry or continue manually.");
        el("manualReviewFallback").classList.remove("hidden");
      }
    },420000);
    const evaluation=await evaluateVerifiedEvidence({
      assessment:active.assessment,criteria,evidence,
      contributionScope:active.evidence.contributionScope,signal:controller.signal,
      includeImages:Boolean(evidence.assets?.length&&(!connection.configured||connection.capabilities?.inlineImages===true)),
      onProgress:progress=>{
        if(session!==state.token||state.active!==active)return;
        if(progress.mode==="adaptive"&&progress.stage==="chunk")
          aiStatus("Large contribution detected. Processing verified evidence chunk "+Math.min(progress.completed+1,progress.total)+"/"+progress.total+"…");
        else if(progress.mode==="adaptive"&&progress.stage==="final")
          aiStatus("Evidence chunks processed. Building the final rubric proposal…");
        else aiStatus("Generating rubric suggestions from verified evidence…");
      }
    });
    const parsed=evaluation.parsed;
    const draft=parseSuggestedRubric(parsed,criteria,active.maxScore,evidence);
    if(session!==state.token||state.active!==active)return;
    if(evidence.truncatedDiffs?.length){
      draft.limitations=[draft.limitations,evidence.truncatedDiffs.length+" relevant commit diff(s) were bounded; omitted changes require teacher review before assigning credit."].filter(Boolean).join(" ").slice(0,1400);
    }
    if(evidence.missingPrimaryPaths?.length){
      draft.limitations=[draft.limitations,"Some primary files in the verified commits were renamed or removed before the approved checkpoint ("+
        evidence.missingPrimaryPaths.slice(0,6).join(", ")+"). Retained commit changes require teacher confirmation."].filter(Boolean).join(" ").slice(0,1400);
    }
    active.aiDraft={model,checkpointSha:active.checkpointSha,evaluationMode:evaluation.mode,evidenceChunks:evaluation.chunkCount,...draft};
    state.dirty=true;
    displayAISuggestion(draft);
    renderFeedbackMarkdown(el("manualReviewAIFeedback"),draft.feedback);
    el("manualReviewUseScore").disabled=draft.score===null;
    el("manualReviewUseFeedback").disabled=!draft.feedback;
    el("manualReviewFiles").value=[...new Set(evidence.patches.filter(p=>p.substantive===true).map(p=>p.path))].join("\n");
    aiStatus(draft.pendingPoints>0?"System proposal ready. "+draft.pendingPoints+" point"+(draft.pendingPoints===1?"":"s")+" still need teacher confirmation; the proposed score can be adjusted in Teacher grade. Nothing was saved or published.":"System proposal ready with no pending rubric points. Your teacher fields are unchanged; saving and publication remain separate.");
    el("manualReviewFallback").classList.add("hidden");
  }catch(error){
    if(session===state.token&&state.active===active){
      aiStatus("Evaluation unavailable: "+error.message+" No score or feedback was changed.",true);
      el("manualReviewFallback").classList.remove("hidden");
      el("manualReviewRetry").textContent=error.retryAt?"Retry after "+new Date(error.retryAt).toLocaleTimeString():"Retry evaluation";
    }
  }finally{
    clearTimeout(evaluationSlowNotice);clearTimeout(evaluationTimeout);
    if(session===state.token&&state.active===active){
      state.aiBusy=false;button.disabled=Boolean(state.active?.previous?.published)||!state.active?.checkpointSha||!evaluationResponsibilityReady(state.active?.assessment,state.active?.evidence);
      button.textContent="Evaluate";
    }
  }
}

function applyEvidenceState(record,{initial=false}={}){
  const active=state.active;if(!active||active.assessment.schemaVersion!==2)return;
  const changed=!initial&&!sameEvidence(active.evidence,record)&&Boolean(active.evidence||record);
  if(changed){state.aiAbort?.abort();state.aiBusy=false;state.externalEvidence=null;state.externalPackage="";el("externalEvaluationImport").disabled=true;
    el("manualReviewUseScore").disabled=true;el("manualReviewUseFeedback").disabled=true;el("manualReviewConfirm").checked=false;}
  let approved=record?.status==="approved"&&validSha(record.approvedCheckpointSha)&&record.approvedCheckpointSha===record.checkpointSha;
  try{approved=approved&&record.studentId===active.studentId&&record.assessmentId===active.taskId&&parseRepository(record.repository).url===parseRepository(active.base).url;}catch{approved=false;}
  const verified=approved&&evaluationResponsibilityReady(active.assessment,record);
  const protectedGrade=Boolean(active.previous?.published);
  const next={...active,evidence:record,checkpointSha:approved?record.approvedCheckpointSha:null,selectedEvidenceCommits:record?.selectedCommits||[],
    aiDraft:changed?null:active.aiDraft,aiApplied:changed?false:active.aiApplied};
  state.active=changed?next:Object.assign(active,next);
  const blocker=protectedGrade?"Published grade protected. Unpublish for revision before evaluating or changing verification.":
    !approved?record?.status==="reopened"?"Evidence is reopened. The student can change selections now, then must resubmit for fresh approval.":
      "Approve the submitted checkpoint in Review before evaluating.":!verified?
      "Individual contributing commits have not been verified. Complete commit verification below, or grade manually.":
      "Approved, independently verified checkpoint "+record.approvedCheckpointSha.slice(0,12)+". Choose Evaluate to generate a private system draft.";
  el("manualReviewAIGenerate").disabled=state.aiBusy||protectedGrade||!verified;el("manualReviewAIGenerate").textContent=state.aiBusy?"Evaluating…":"Evaluate";
  el("manualReviewExternal").disabled=protectedGrade||!verified;el("manualReviewExternal").title=blocker;
  el("manualReviewAIGenerate").title=blocker;if(!state.aiBusy)aiStatus((active.previous?.aiAssistance?"Saved feedback includes automated assistance reviewed by a teacher. ":"")+blocker,!verified);
  el("manualReviewVerifyContributions").classList.toggle("hidden",!approved||verified||protectedGrade);
  el("manualReviewSave").disabled=protectedGrade||!approved;
  for(const id of ["manualReviewScore","manualReviewFeedback","manualReviewFiles","manualReviewReason","manualReviewConfirm"])el(id).disabled=protectedGrade||!approved;
  el("manualReviewPublish").disabled=protectedGrade||!approved||!gradeMatchesEvidence(active.previous,record)||state.dirty;
  el("integratedEvidenceStatus").textContent="Evidence: "+(record?.status||"Not submitted")+" · revision "+evidenceRevision(record)+". "+blocker;
  if(changed)message("Evidence status updated. Teacher score and feedback were kept; previous system suggestions were invalidated. Review the current checkpoint and confirm again before saving.",true);
  else if(!approved)message(blocker,true);
}

async function open({studentId, taskId, owner, repo, diagnostic=""}={}) {
  if (!auth.currentUser) return alert("Sign in as a teacher before opening manual grading.");
  if (!studentId || !taskId) return alert("Select a student and an assessment.");
  if(state.active&&(state.active.studentId!==studentId||state.active.taskId!==taskId)&&(state.dirty||state.panels?.hasUnsavedReview?.())&&!confirm("Discard unsaved review changes and open this learner?"))return false;
  let base;
  try { base=safeRepo(owner,repo); } catch(e){return alert(e.message);}
  const session=++state.token;
  state.abort?.abort();state.aiAbort?.abort();state.panels?.destroy();state.panels=null;
  state.abort=new AbortController();state.requests=createReviewRequests({token:localStorage.getItem("Adminerva_github_token"),signal:state.abort.signal});
  state.request={studentId,taskId,owner,repo,diagnostic};
  state.active=null;state.aiBusy=false;state.externalEvidence=null;state.externalPackage="";state.externalEvidenceKey="";state.externalBusy=false;
  state.dirty=false;
  el("manualReviewAISection").classList.add("hidden");
  el("manualReviewAIScores").replaceChildren();
  el("manualReviewAIFeedback").textContent="";
  el("manualReviewFallback").classList.add("hidden");
  for(const id of ["manualReviewUseScore","manualReviewUseFeedback"])el(id).disabled=true;
  el("manualReviewUnpublish").classList.add("hidden");
  el("manualReviewPublish").classList.add("hidden");
  el("manualReviewAIGenerate").disabled=true;
  el("manualReviewExternal").disabled=true;
  el("manualReviewAIGenerate").textContent="Evaluate";
  el("manualReviewSave").textContent="Save unpublished grade";
  el("integratedEvidence").classList.add("hidden");
  el("integratedEvidencePanel").replaceChildren();
  aiStatus("Approve checkpoint evidence to enable suggestions.");
  el("manualReviewModal").classList.remove("hidden");
  el("manualReviewForm").reset();
  for(const id of ["manualReviewScore","manualReviewFeedback","manualReviewFiles","manualReviewReason","manualReviewConfirm"])
    el(id).disabled=true;
  el("manualReviewFlags").replaceChildren();
  state.flags = [];
  el("manualReviewLinks").replaceChildren();
  el("manualReviewStudent").textContent="Loading student and assessment…";
  el("manualReviewTask").textContent="";
  el("manualReviewSave").disabled=true;
  el("manualReviewAnalyze").disabled=true;
  message("Loading existing grade; no changes will be saved until you confirm.");
  try {
    const [studentDoc,taskDoc,gradeDoc,evidenceDoc]=await Promise.all([
      getDoc(doc(db,"students",studentId)),
      getDoc(doc(db,"assessments",taskId)),
      getDoc(doc(db,"student_grades",studentId+"_"+taskId)),getDoc(doc(db,"assessment_evidence",studentId+"_"+taskId))
    ]);
    if (session!==state.token) return;
    if (!studentDoc.exists() || !taskDoc.exists()) throw new Error("Student or assessment no longer exists.");
    const student=studentDoc.data(),assessment=taskDoc.data(),previous=gradeDoc.exists()?gradeDoc.data():null;
    const accountName=String(student.githubUsername||"").trim().replace(/^@/,"")||"Unlinked GitHub account";
    el("manualReviewSteps").classList.toggle("hidden",assessment.schemaVersion!==2);
    for(const button of el("manualReviewSteps").querySelectorAll?.("[data-review-step]")||[])button.onclick=()=>el(button.dataset.reviewStep).scrollIntoView({behavior:"smooth",block:"start"});
    el("manualReviewStudent").textContent=(student.name||studentId)+" (@"+accountName+")";
    el("manualReviewTask").textContent=(assessment.title||taskId)+" — "+(assessment.maxScore||20)+" points";
    if(assessment.schemaVersion===2){
      el("manualReviewAISection").classList.remove("hidden");
      el("manualReviewAnalyze").classList.add("hidden");
      el("integratedEvidence").classList.remove("hidden");
      el("integratedInspectorDetails").open=false;
      el("integratedGroupInspectorDetails").open=false;
    }
    let checkpointSha=null,selectedEvidenceCommits=[],approvedEvidence=null;
    if(assessment.schemaVersion===2){
      const evidence=evidenceDoc;
      if(session!==state.token)return;
      el("integratedEvidenceStatus").textContent=evidence.exists()?"Evidence: "+evidence.data().status+". Review selected changes and verify each student's responsibilities below.":"No submission yet. Expand evidence to discover historical commits in this page.";
      el("integratedEvidenceDetails").open=true;
      if(evidence.exists()&&parseRepository(evidence.data().repository).url!==parseRepository(base).url)
        throw Error("Approved evidence belongs to a different repository. Review the student's linked repository.");
      approvedEvidence=evidence.exists()?evidence.data():null;
      checkpointSha=approvedEvidence?.status==="approved"?approvedEvidence.approvedCheckpointSha:null;
      selectedEvidenceCommits=approvedEvidence?.selectedCommits||[];
    }
    const maxScore=Number(assessment.maxScore || 20);
    if (!Number.isFinite(maxScore) || maxScore<=0) throw new Error("Assessment has an invalid maximum score.");
    const login=String(student.githubUsername||"").trim().replace(/^@/,"");
    el("manualReviewStudent").textContent=(student.name||studentId)+" (@"+accountName+")";
    el("manualReviewTask").textContent=(assessment.title||taskId)+" — "+maxScore+" points";
    const links=el("manualReviewLinks");
    link(links,"Repository ↗",base);
    if (/^[A-Za-z0-9-]{1,39}$/.test(login)) {
      link(links,"Student's commits ↗",base+"/commits?author="+encodeURIComponent(login));
    } else flag("GitHub account is not linked or has an invalid login. Verify identity before scoring.");
    if(assessment.schemaVersion!==2)link(links,"Contribution Inspector ↗","contribution-inspector.html?section="+
      encodeURIComponent(student.section)+"&student="+encodeURIComponent(studentId)+
      "&assessment="+encodeURIComponent(taskId));
    if(checkpointSha){
      link(links,"Approved project checkpoint ↗",base+"/tree/"+encodeURIComponent(checkpointSha));
      flag("V2 assessment: inspect this pinned project revision, not the mutable latest branch.");
    }
    if(diagnostic)flag("Auto-Checker: "+String(diagnostic).slice(0,2500));
    for(const issue of previous?.reviewReasons || [])flag(issue);
    for(const path of previous?.contributionEvidence?.excludedTaskOrClassmatePaths||[])flag("Excluded from automated evidence: "+path);
    for(const item of previous?.contributionEvidence?.fallbackReasons||[])flag("Alternative file: "+item.path+" — "+(item.reasons||[]).join("; "));
    if (!previous)flag("No grade has been recorded. Inspect actual code and commits before assigning a score.");
    if(previous&&approvedEvidence&&!gradeMatchesEvidence(previous,approvedEvidence))
      flag("This saved grade draft predates the current evidence approval. Recheck its score and feedback; it cannot be published until a fresh review is saved.");
    if (previous?.provisionalScore)flag("Existing score is provisional; alternate source paths need confirmation.");
    if(previous?.published)flag("Published grade protected. Use Unpublish protected grade for revision in section 3 before changing it or reopening evidence.");
    flag("GitHub commit attribution alone cannot establish original authorship. Recommits changing only comments or formatting may not demonstrate new implementation.");
    el("manualReviewScore").max=String(maxScore);
    el("manualReviewMax").value=String(maxScore);
    el("manualReviewScore").value=previous?.score!=null?String(previous.score):"";
    el("manualReviewFeedback").value=cleanGradeFeedback(previous?.feedback);
    // Legacy grade paths may belong to a different assessment or checkpoint.
    // Never silently present them as the files used for a current V2 evaluation.
    const priorPaths=previous?.contributionEvidence?.matchedPaths||[];
    const sameCheckpoint=Boolean(approvedEvidence?.approvedCheckpointSha&&
      previous?.gradedSha===approvedEvidence.approvedCheckpointSha&&
      previous?.evidenceRevision===evidenceRevision(approvedEvidence));
    el("manualReviewFiles").value=assessment.schemaVersion===2
      ?(sameCheckpoint?priorPaths:[]).join("\n")
      :priorPaths.join("\n");
    if(assessment.schemaVersion===2&&priorPaths.length&&!sameCheckpoint)
      flag("Saved file paths belong to a previous or unverified evidence revision and were not copied into this review. Inspect the current pinned checkpoint and verified commits before saving.");
    el("manualReviewReason").value=previous?.teacherReviewNote||"";
    state.active={studentId,taskId,owner,repo,base,student,assessment,previous,gradeRef:gradeDoc.ref,maxScore,login,checkpointSha,selectedEvidenceCommits,evidence:approvedEvidence,aiDraft:null,aiApplied:false};
    analytics("review_editor_opened",{feature:"review_grade",mode:assessment.schemaVersion===2?"v2":"legacy",status:previous?"existing_grade":"new_grade"});
    if(assessment.schemaVersion===2&&approvedEvidence?.status==="approved"&&auth.currentUser?.uid){
      try{
        const queued=await getDoc(doc(db,"teacher_evaluation_drafts",auth.currentUser.uid,"items",studentId+"_"+taskId));
        const saved=queued.exists()?queued.data():null;
        if(saved&&saved.status==="private_suggestion"&&saved.checkpointSha===approvedEvidence.approvedCheckpointSha&&saved.evidenceRevision===evidenceRevision(approvedEvidence)&&saved.draft){
          state.active.aiDraft={model:saved.model||"",checkpointSha:saved.checkpointSha,...saved.draft};
          displayAISuggestion(state.active.aiDraft);
          renderFeedbackMarkdown(el("manualReviewAIFeedback"),state.active.aiDraft.feedback||"");
          el("manualReviewUseScore").disabled=state.active.aiDraft.score===null;
          el("manualReviewUseFeedback").disabled=!state.active.aiDraft.feedback;
          el("manualReviewAISection").classList.remove("hidden");
          aiStatus("Private class evaluation suggestion is ready. Review it, apply only what you agree with, then save an unpublished teacher grade.");
        }
      }catch(error){console.warn("Private class evaluation suggestion unavailable:",error);}
    }
    el("manualReviewUnpublish").classList.toggle("hidden",!previous?.published);
    el("manualReviewPublish").classList.toggle("hidden",!previous||previous.published||assessment.schemaVersion!==2);
    const verified=Boolean(checkpointSha)&&approvedEvidence?.status==="approved"&&evaluationResponsibilityReady(assessment,approvedEvidence);
    el("manualReviewAIGenerate").disabled=assessment.schemaVersion!==2||!!previous?.published||!verified;
    el("manualReviewExternal").disabled=assessment.schemaVersion!==2||!!previous?.published||!verified;
    if(assessment.schemaVersion===2)aiStatus((previous?.aiAssistance?"Saved feedback includes a prior system evaluation reviewed by a teacher. ":"")+(verified?"Approved checkpoint "+checkpointSha.slice(0,12)+". Evaluate the verified student screen and supporting changes, or enter a teacher score.":"No verified contributing commits are recorded. Reopen evidence to verify the student commits, or grade manually."));
    el("manualReviewSave").disabled=!!previous?.published;
    for(const id of ["manualReviewScore","manualReviewFeedback","manualReviewFiles","manualReviewReason","manualReviewConfirm"])
      el(id).disabled=!!previous?.published;
    el("manualReviewAnalyze").disabled=!login||Boolean(checkpointSha);
    el("manualReviewAnalyze").onclick=()=>examineRecentCommits(session,owner,repo,login);
    message(previous?.published?"Published grade protected. Unpublish for revision here, then reopen evidence in section 1 if student changes are needed.":previous?"Saved unpublished grade. Review, save changes, or explicitly publish.":"No teacher grade saved. Review evidence, optionally evaluate, then complete section 3.");
    if(assessment.schemaVersion===2){
      applyEvidenceState(approvedEvidence,{initial:true});
      const advanced=el("integratedAdvancedLinks");advanced.replaceChildren();
      const params=new URLSearchParams({student:studentId,assessment:taskId,section:student.section});
      const contextParams=new URLSearchParams({section:student.section});
      link(advanced,"Repository context ↗","repobank.html?"+contextParams);
      link(advanced,"Standalone contribution tools ↗","contribution-inspector.html?"+params);
      link(advanced,"Standalone group tools ↗","group-inspector.html?"+params);
      state.panels=mountReviewPanels({root:el("integratedEvidence"),student:{...student,id:studentId},assessment:{...assessment,id:taskId},evidence:approvedEvidence,requests:state.requests,signal:state.abort.signal,
        onEvidenceChange:record=>{if(session!==state.token)return;applyEvidenceState(record);state.panels?.updateEvidence(record);window.dispatchEvent(new CustomEvent("adminerva:manual-grade-saved"));}});
    }
    if(assessment.schemaVersion!==2)void sourceLinks(session,base,owner,repo,login,checkpointSha);
  }catch(error) {
    if (session!==state.token)return;
    el("manualReviewSave").disabled=true;el("manualReviewAIGenerate").disabled=true;
    message("Review is not ready: "+error.message,true);
    aiStatus("Evaluation is available after evidence approval in this workspace.",true);
  }
}
async function save(event) {
  event.preventDefault();
  const active=state.active;if(!active)return;
  const session=state.token;
  const acceptedDraft=active.aiApplied?active.aiDraft:null;
  if(state.aiBusy)return message("Wait for evaluation to finish before saving.",true);
  const raw=el("manualReviewScore").value;
  const score=Number(raw);
  const feedback=cleanGradeFeedback(el("manualReviewFeedback").value);
  const customReason=el("manualReviewReason").value.trim();
  const adjustment=acceptedDraft&&Math.abs(score-acceptedDraft.score)>0.001?"Teacher adjusted the system proposal from "+acceptedDraft.score+" to "+score+" after reviewing the remaining evidence or classroom observation.":"";
  const reason=customReason||adjustment||active.evidence?.verificationNote||"Teacher reviewed the selected work and entered the score and student feedback.";
  const paths=[...new Set(el("manualReviewFiles").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean))];
  if(!raw.trim()||!Number.isFinite(score)||score<0||score>active.maxScore)return message("Score must be between 0 and "+active.maxScore+".",true);
  if(!feedback)return message("Add feedback for the student before saving.",true);
  if(!el("manualReviewConfirm").checked)return message("Confirm you inspected the evidence before saving.",true);
  if(paths.length>40 || paths.some(p=>p.length>240 || p.startsWith("/") || p.split("/").includes("..")))
    return message("Provide at most 40 safe repository-relative file paths.",true);
  const button=el("manualReviewSave");button.disabled=true;message("Saving manual grade and audit record…");
  try {
    const revision=doc(collection(db,"grade_revisions"));
    await runTransaction(db, async tx => {
      if(active.assessment.schemaVersion===2){
        const evidenceSnap=await tx.get(doc(db,"assessment_evidence",active.studentId+"_"+active.taskId));
        const evidence=evidenceSnap.exists()?evidenceSnap.data():null;
        if(!evidence||evidence.status!=="approved"||evidence.approvedCheckpointSha!==active.checkpointSha||
          evidence.checkpointSha!==active.checkpointSha||
          JSON.stringify(evidence.selectedCommits)!==JSON.stringify(active.selectedEvidenceCommits))
          throw Error("The approved evidence changed. Reload and re-check the checkpoint before saving.");
        if(evidenceRevision(evidence)!==evidenceRevision(active.evidence))
          throw Error("The evidence approval changed. Reload before saving.");
      }
      const latest=await tx.get(active.gradeRef);
      const previous=latest.exists()?latest.data():null;
      if(previous?.published)throw new Error("A published grade is protected. Unpublish in Gradebook first.");
      assertGradeVersion(previous,active.previous);
      tx.set(revision,{
        gradeId:active.gradeRef.id,studentId:active.studentId,taskId:active.taskId,
        editorUid:auth.currentUser?.uid||null,reason:"Manual teacher review: "+reason,
        before:previous?{...pickDefinedGradeFields(previous,["score","feedback"]),published:!!previous.published}:null,
        after:{score,feedback,published:false,aiAssisted:Boolean(acceptedDraft||previous?.aiAssistance)},
        createdAt:serverTimestamp()
      });
      tx.set(active.gradeRef,{
        studentId:active.studentId,taskId:active.taskId,section:active.student.section,score,maxScore:active.maxScore,
        gradeVersion:nextGradeVersion(previous),
        feedback,published:false,reviewRequired:false,manuallyAdjusted:true,
        gradeSource:acceptedDraft||previous?.aiAssistance?"teacher_ai_reviewed":"teacher_manual",gradingMode:"individual",sourceSelectionMode:"teacher_manual",
        aiAssistance:acceptedDraft?{
          model:acceptedDraft.model,checkpointSha:active.checkpointSha,
          evaluationMode:acceptedDraft.evaluationMode||"system",
          suggestedScore:acceptedDraft.score,
          criterionScores:acceptedDraft.criteria.map(c=>({name:c.name,score:c.score,maxScore:c.maxScore,pendingPoints:c.pendingPoints,confidence:c.confidence})),
          pendingPoints:acceptedDraft.pendingPoints,potentialScore:acceptedDraft.potentialScore,
          generatedAt:serverTimestamp()
        }:(previous?.aiAssistance||null),
        reviewPriority:"teacher_verified",provisionalScore:false,
        teacherReviewNote:reason,
        reviewReasons:[...new Set(state.flags.concat(previous?.reviewReasons || []))].slice(0,60),
        reviewedBy:auth.currentUser?.uid||null,
        reviewedAt:serverTimestamp(),gradedAt:serverTimestamp(),
        ...(active.checkpointSha?{gradedSha:active.checkpointSha,evidenceRevision:evidenceRevision(active.evidence),
          verifiedContributionCommits:active.evidence.verifiedContributionCommits||[],
          contributionScope:active.evidence.contributionScope||"",evaluationDraft:acceptedDraft?{
            criteria:acceptedDraft.criteria,projectObservations:acceptedDraft.projectObservations,
            limitations:acceptedDraft.limitations,pendingPoints:acceptedDraft.pendingPoints,potentialScore:acceptedDraft.potentialScore,
            generatedBy:acceptedDraft.evaluationMode==="external"?"External evaluation imported through Adminerva":"Adminerva system evaluation",teacherReviewed:true
          }:(previous?.evaluationDraft||null)}:{}),
        targetPath:paths.length?paths.join(", "):"Manual review — see teacher note",
        contributionEvidence:{
          ...(previous?.contributionEvidence||{}),
          repository:active.owner+"/"+active.repo,
          githubLogin:active.login,
          matchedPaths:paths,
          ...(active.checkpointSha?{approvedCheckpointSha:active.checkpointSha,
            selectedCommits:active.selectedEvidenceCommits}:{}),
          manualEvidence:true,
          authorshipIndependentlyProven:false
        }
      },{merge:true});
    });
    window.dispatchEvent(new CustomEvent("adminerva:manual-grade-saved",{
      detail:{studentId:active.studentId,assessmentId:active.taskId}
    }));
    analytics("grade_draft_saved",{feature:"review_grade",mode:acceptedDraft?.evaluationMode==="external"?"external_assisted":acceptedDraft?"system_assisted":"manual",status:"unpublished"});
    if(state.active!==active||state.token!==session)return;
    const savedGrade=(await getDoc(active.gradeRef)).data();
    if(state.active!==active||state.token!==session)return;
    message("Teacher-reviewed grade saved as UNPUBLISHED. Review queue refreshed. Publish separately when ready.");
    button.textContent="Saved unpublished grade";
    button.disabled=true;
    state.dirty=false;
    active.previous=savedGrade;
    el("manualReviewPublish").classList.toggle("hidden",active.assessment.schemaVersion!==2);
    el("manualReviewPublish").disabled=active.assessment.schemaVersion===2&&!gradeMatchesEvidence(savedGrade,active.evidence);
  }catch(error){if(state.active===active&&state.token===session){message("Unable to save: "+error.message,true);button.disabled=false;}}
}
function applySuggestion(field){
  const active=state.active,draft=active?.aiDraft;
  if(!draft||active.previous?.published||!active.checkpointSha||state.aiBusy)return;
  if(field==="score"&&draft.score===null)return;
  const target=el(field==="score"?"manualReviewScore":"manualReviewFeedback");
  if(target.value.trim()&&!confirm("Replace your current teacher "+field+" with this suggestion?"))return;
  target.value=String(draft[field]);active.aiApplied=true;state.dirty=true;
  el("manualReviewConfirm").checked=false;el("manualReviewSave").disabled=false;
  message("Suggestion copied to teacher "+field+". Inspect it and save explicitly; nothing has been published.");
}
async function changePublication(published){
  const active=state.active;
  if(!active?.previous||state.aiBusy)return;
  if(state.dirty)return message("Save or discard your teacher changes before changing publication.",true);
  const reason=published?(active.previous.teacherReviewNote||"Teacher approved the saved score and feedback for publication."):prompt("Reason for unpublishing this protected grade for revision (15–3,000 characters)");
  if(reason===null)return;
  if(reason.trim().length<15||reason.length>3000)return message("Enter a reason of 15–3,000 characters.",true);
  if(!confirm(published?"Publish this teacher-reviewed score and feedback to this student now?":"Unpublish this grade? It will no longer be visible to the student. Its score, feedback and audit history will be retained."))return;
  const button=el(published?"manualReviewPublish":"manualReviewUnpublish");button.disabled=true;
  try{
    await runTransaction(db,async transaction=>{
      const snapshot=await transaction.get(active.gradeRef),current=snapshot.data();
      if(!snapshot.exists())throw Error("Grade missing. Reload before continuing.");
      assertGradeVersion(current,active.previous);
      if(published)await verifyGradePublication(transaction,active.gradeRef,current);
      transaction.set(doc(collection(db,"grade_revisions")),{
        gradeId:active.gradeRef.id,studentId:active.studentId,taskId:active.taskId,
        editorUid:auth.currentUser.uid,reason:reason.trim(),
        before:{score:current.score,feedback:current.feedback,published:Boolean(current.published)},
        after:{score:current.score,feedback:current.feedback,published},createdAt:serverTimestamp()
      });
      transaction.set(active.gradeRef,{published},{merge:true});
    });
    window.dispatchEvent(new CustomEvent("adminerva:manual-grade-saved"));
    analytics("grade_publication_changed",{feature:"review_grade",action:published?"publish":"unpublish",status:"success"});
    if(state.active===active&&state.request)await open({...state.request});
  }catch(error){message("Publication unchanged: "+error.message,true);}
  finally{button.disabled=false;}
}
function init() {
  el("manualReviewClose").addEventListener("click",close);
  el("manualReviewCancel").addEventListener("click",close);
  el("manualReviewForm").addEventListener("submit",event=>{
    event.preventDefault();
    void window.withLoading("Saving teacher-reviewed grade…",()=>save(event),{button:el("manualReviewSave"),region:el("manualReviewForm")})
      .catch(error=>message("Grade processing failed: "+error.message,true));
  });
  el("manualReviewForm").addEventListener("input",()=>{state.dirty=true;if(state.active&&!state.active.previous?.published)el("manualReviewSave").disabled=false;});
  const runSystemEvaluation=()=>void window.withLoading("Preparing system evaluation…",generateAIDraft,
    {button:el("manualReviewAIGenerate"),region:el("manualReviewAISection")})
    .catch(error=>aiStatus("Evaluation could not finish: "+error.message,true));
  el("manualReviewAIGenerate").addEventListener("click",runSystemEvaluation);
  el("manualReviewExternal").addEventListener("click",()=>{void openExternalEvaluation();});
  el("externalEvaluationCopy").addEventListener("click",()=>{void copyExternalPackage();});
  el("externalEvaluationImport").addEventListener("click",()=>{void importExternalEvaluation();});
  el("externalEvaluationClose").addEventListener("click",closeExternalEvaluation);
  el("externalEvaluationCancel").addEventListener("click",closeExternalEvaluation);
  el("externalEvaluationModal").addEventListener("click",event=>{if(event.target===el("externalEvaluationModal"))closeExternalEvaluation();});
  el("manualReviewRetry").addEventListener("click",runSystemEvaluation);
  el("manualReviewManual").addEventListener("click",()=>{
    if(!state.active?.checkpointSha)return message("Approve the submitted evidence before saving a teacher grade.",true);
    stopEvaluation("Manual grading selected. Any pending evaluation result is ignored; your teacher fields are unchanged.");
    el("manualReviewForm").scrollIntoView({behavior:"smooth",block:"start"});el("manualReviewScore").focus();
  });
  el("manualReviewPreview").addEventListener("click",()=>{renderFeedbackMarkdown(el("manualReviewFeedbackPreview"),el("manualReviewFeedback").value);});
  el("manualReviewVerifyContributions").addEventListener("click",()=>{
    el("integratedEvidenceDetails").open=true;
    document.getElementById("evidenceEditVerification")?.click();
  });
  el("manualReviewUseScore").addEventListener("click",()=>applySuggestion("score"));
  el("manualReviewUseFeedback").addEventListener("click",()=>applySuggestion("feedback"));
  el("manualReviewPublish").addEventListener("click",()=>void window.withLoading("Publishing teacher grade…",
    ()=>changePublication(true),{button:el("manualReviewPublish")}).catch(error=>message(error.message,true)));
  el("manualReviewUnpublish").addEventListener("click",()=>void window.withLoading("Unpublishing teacher grade…",
    ()=>changePublication(false),{button:el("manualReviewUnpublish")}).catch(error=>message(error.message,true)));
  el("manualReviewSaveChecker")?.addEventListener("click",()=>{
    const key=el("manualReviewCheckerKey").value.trim();
    if(key.length<15||key.length>500)return aiStatus("Enter a valid provider key. Do not enter it in feedback.",true);
    try{localStorage.setItem("Adminerva_gemini_token",key);el("manualReviewCheckerKey").value="";el("manualReviewCheckerSetup").open=false;aiStatus("Checker key saved on this device. Evaluate is available after contribution verification.");}
    catch{aiStatus("This browser could not save the key. You can still grade manually.",true);}
  });
  el("manualReviewRefresh").addEventListener("click",()=>{
    if((state.dirty||state.panels?.hasUnsavedReview?.())&&!confirm("Reload and discard unsaved score, feedback or verification changes?"))return;
    if(state.request)void window.withLoading("Refreshing learner grading record…",
      ()=>open({...state.request}),{button:el("manualReviewRefresh")})
      .catch(error=>message("Could not refresh review: "+error.message,true));
  });
  el("manualReviewModal").addEventListener("click",e=>{if(e.target===el("manualReviewModal"))close()});
  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape")return;
    if(!el("externalEvaluationModal").classList.contains("hidden"))return closeExternalEvaluation();
    if(!el("manualReviewModal").hasAttribute("data-inline-review")&&!el("manualReviewModal").classList.contains("hidden"))close();
  });
}
window.openManualGradeReview=open;
window.dispatchEvent(new CustomEvent("adminerva:manual-review-ready"));
window.manualReviewHasUnsavedChanges=()=>Boolean(state.dirty||state.panels?.hasUnsavedReview?.());
window.closeManualGradeReview=options=>close(options);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
else init();
