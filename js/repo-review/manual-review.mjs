import { auth, db } from "../core/firebase-core.js";
import { cleanGradeFeedback } from "../core/feedback-format.mjs";
import { pickDefinedGradeFields } from "./services/grade-revision-snapshot.mjs";
import {
  collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { analyzePatchSubstance } from "./services/commit-substance.mjs";
import {parseRepository,validSha} from "./services/assessment-evidence.mjs";
import {parseWeightedRubric,loadPinnedV2Source,buildRubricPrompt,parseSuggestedRubric}
  from "./services/v2-grading-assistant.mjs?v=2026.10.18.4";
import {evidenceRevision,gradeMatchesEvidence} from "./services/evidence-lifecycle.mjs";
import {verifyGradePublication} from "./services/evidence-transaction.mjs?v=2026.10.19.1";

const el = id => document.getElementById(id);
const state = { active: null, request: null, token: 0, flags: [], aiBusy: false, dirty:false };
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
function close() {
  if(state.dirty&&!confirm("Discard unsaved score or feedback changes?"))return;
  el("manualReviewModal").classList.add("hidden");
  state.active=null;
  state.request=null;
  state.aiBusy=false;
  state.dirty=false;
  state.token++;
}
async function githubGet(url, session) {
  const headers={Accept:"application/vnd.github+json"};
  const pat=localStorage.getItem("Adminerva_github_token");
  if (pat) headers.Authorization="Bearer "+pat;
  const response=await fetch(url,{headers});
  if (session!==state.token) throw new Error("Review was closed");
  if (!response.ok) throw new Error("GitHub HTTP "+response.status);
  return response.json();
}
async function sourceLinks(session, base, owner, repo, login, checkpointSha=null) {
  try {
    const data=checkpointSha?null:await githubGet("https://api.github.com/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(repo),session);
    if (session!==state.token) return;
    const branch=encodeURIComponent(checkpointSha||data?.default_branch||"main");
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
function displayAISuggestion(draft){
  const container=el("manualReviewAIScores");container.replaceChildren();
  for(const item of draft.criteria){
    const row=document.createElement("div");
    row.className="bg-white rounded border border-indigo-100 p-3";
    const heading=document.createElement("strong");heading.className="text-sm";
    heading.textContent=item.name+": "+(item.score===null?"Teacher review needed":item.score+"/"+item.maxScore);
    const rationale=document.createElement("p");rationale.className="mt-1 text-xs text-slate-700 whitespace-pre-wrap";
    rationale.textContent=item.rationale;
    row.append(heading,rationale);container.append(row);
  }
  const total=document.createElement("p");total.className="font-bold text-indigo-950";
  total.textContent=draft.score===null?"Suggested total unavailable — resolve unscored criteria before assigning a teacher score.":"Suggested score: "+draft.score+"/"+state.active.maxScore;
  container.append(total);
  if(draft.projectObservations){
    const observation=document.createElement("p");observation.className="text-xs text-slate-700";
    observation.textContent="Shared project context (separate from individual score): "+draft.projectObservations;
    container.append(observation);
  }
  if(draft.limitations){
    const limitation=document.createElement("p");
    limitation.className="text-xs text-amber-900 whitespace-pre-wrap";
    limitation.textContent="Teacher must verify: "+draft.limitations;
    container.append(limitation);
  }
}
async function generateAIDraft(){
  const active=state.active;
  if(!active||active.assessment.schemaVersion!==2||!active.checkpointSha||state.aiBusy){
    return aiStatus("Approve the checkpoint and verify individual contributions before evaluation.",true);
  }
  if(active.previous?.published)return aiStatus("Published grade protected. Unpublish for revision below before evaluating.",true);
  const token=localStorage.getItem("Adminerva_gemini_token");
  if(!token){el("manualReviewCheckerSetup").open=true;return aiStatus("Checker setup required: enter your instructor provider key below, or grade manually in section 3.",true);}
  const model=String(localStorage.getItem("Adminerva_ai_model")||"gemini-2.5-flash").trim();
  if(!/^[a-zA-Z0-9._-]{1,80}$/.test(model))return aiStatus("The configured evaluation model name is invalid. Check provider settings.",true);
  if(!confirm("Evaluate this approved checkpoint? Relevant student source and verified diffs will be sent to the configured Gemini AI provider to generate draft scores and feedback. Verify the result before saving."))return;
  const session=state.token;
  state.aiBusy=true;
  const button=el("manualReviewAIGenerate");button.disabled=true;
  button.textContent="Generating…";
  try{
    const criteria=parseWeightedRubric(active.assessment.evalCriteria,active.maxScore);
    aiStatus("Retrieving selected commit diffs and source files from the approved GitHub checkpoint…");
    const evidence=await loadPinnedV2Source({
      repository:active.base,checkpointSha:active.checkpointSha,
      selectedCommits:active.selectedEvidenceCommits,assessment:active.assessment,
      verifiedContributionCommits:active.evidence.verifiedContributionCommits,
      token:localStorage.getItem("Adminerva_github_token")
    });
    if(session!==state.token)return;
    aiStatus("Generating rubric suggestions. Existing student grades remain unchanged…");
    const prompt=buildRubricPrompt({
      assessment:active.assessment,criteria,checkpointSha:active.checkpointSha,
      files:evidence.files,patches:evidence.patches,contributionScope:active.evidence.contributionScope
    });
    const response=await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-goog-api-key":token},
        body:JSON.stringify({
          contents:[{parts:[{text:prompt}]}],
          generationConfig:{response_mime_type:"application/json",temperature:0.1}
        })
      }
    );
    if(!response.ok)throw Error("Evaluation provider returned HTTP "+response.status+
      ". Check the model and key in Settings. No grade was saved.");
    const aiData=await response.json();
    const output=aiData?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
    if(!output)throw Error("Evaluation provider returned no grading suggestion.");
    const parsed=JSON.parse(output.replace(/^\x60{3}(?:json)?\s*/i,"").replace(/\s*\x60{3}$/,"").trim());
    const draft=parseSuggestedRubric(parsed,criteria,active.maxScore,evidence);
    if(session!==state.token||state.active!==active)return;
    active.aiDraft={model,checkpointSha:active.checkpointSha,...draft};
    state.dirty=true;
    displayAISuggestion(draft);
    el("manualReviewAIFeedback").textContent=draft.feedback;
    el("manualReviewUseScore").disabled=draft.score===null;
    el("manualReviewUseFeedback").disabled=!draft.feedback;
    el("manualReviewFiles").value=evidence.files.map(f=>f.path).join("\n");
    aiStatus("System draft ready. Your teacher fields are unchanged. Copy only suggestions you accept; resolve unscored criteria yourself before saving.");
  }catch(error){
    if(session===state.token)aiStatus("Evaluation unavailable: "+error.message,true);
  }finally{
    if(session===state.token){
      state.aiBusy=false;button.disabled=Boolean(state.active?.previous?.published)||!state.active?.checkpointSha;
      button.textContent="Evaluate";
    }
  }
}

async function open({studentId, taskId, owner, repo, diagnostic=""}={}) {
  if (!auth.currentUser) return alert("Sign in as a teacher before opening manual grading.");
  if (!studentId || !taskId) return alert("Select a student and an assessment.");
  let base;
  try { base=safeRepo(owner,repo); } catch(e){return alert(e.message);}
  const session=++state.token;
  state.request={studentId,taskId,owner,repo,diagnostic};
  state.active=null;state.aiBusy=false;
  state.dirty=false;
  el("manualReviewAISection").classList.add("hidden");
  el("manualReviewAIScores").replaceChildren();
  el("manualReviewAIFeedback").textContent="";
  for(const id of ["manualReviewUseScore","manualReviewUseFeedback"])el(id).disabled=true;
  el("manualReviewUnpublish").classList.add("hidden");
  el("manualReviewPublish").classList.add("hidden");
  el("manualReviewAIGenerate").disabled=true;
  el("manualReviewAIGenerate").textContent="Evaluate";
  el("manualReviewSave").textContent="Save unpublished grade";
  el("integratedEvidence").classList.add("hidden");
  el("integratedEvidenceFrame").removeAttribute("src");
  el("integratedInspectorFrame").removeAttribute("src");
  el("integratedGroupInspectorFrame").removeAttribute("src");
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
    const [studentDoc,taskDoc,gradeDoc]=await Promise.all([
      getDoc(doc(db,"students",studentId)),
      getDoc(doc(db,"assessments",taskId)),
      getDoc(doc(db,"student_grades",studentId+"_"+taskId))
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
      const params=new URLSearchParams({student:studentId,assessment:taskId,section:student.section,embedded:"1"});
      el("integratedEvidenceFrame").src="assessment-evidence-review.html?"+params;
      el("integratedInspectorDetails").open=false;
      el("integratedInspectorDetails").ontoggle=()=>{
        if(el("integratedInspectorDetails").open&&!el("integratedInspectorFrame").getAttribute("src"))
          el("integratedInspectorFrame").src="contribution-inspector.html?"+params;
      };
      el("integratedGroupInspectorDetails").open=false;
      el("integratedGroupInspectorDetails").ontoggle=()=>{
        if(el("integratedGroupInspectorDetails").open&&!el("integratedGroupInspectorFrame").getAttribute("src"))
          el("integratedGroupInspectorFrame").src="temp-grading.html?"+params;
      };
      void groupSummary(student,taskId,session);
    }
    let checkpointSha=null,selectedEvidenceCommits=[],approvedEvidence=null;
    if(assessment.schemaVersion===2){
      const evidence=await getDoc(doc(db,"assessment_evidence",studentId+"_"+taskId));
      if(session!==state.token)return;
      el("integratedEvidenceStatus").textContent=evidence.exists()?"Evidence: "+evidence.data().status+". Review selected changes and verify each student's responsibilities below.":"No submission yet. Expand evidence to discover historical commits in this page.";
      el("integratedEvidenceDetails").open=true;
      if(!evidence.exists()||evidence.data().status!=="approved"||
        !validSha(evidence.data().approvedCheckpointSha)||
        evidence.data().approvedCheckpointSha!==evidence.data().checkpointSha)
        throw Error("Expand Evidence below and approve the checkpoint here before grading.");
      if(parseRepository(evidence.data().repository).url!==parseRepository(base).url)
        throw Error("Approved evidence belongs to a different repository. Review the student's linked repository.");
      checkpointSha=evidence.data().approvedCheckpointSha;
      selectedEvidenceCommits=evidence.data().selectedCommits||[];
      approvedEvidence=evidence.data();
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
    el("manualReviewFiles").value=(previous?.contributionEvidence?.matchedPaths||[]).join("\n");
    state.active={studentId,taskId,owner,repo,base,student,assessment,previous,gradeRef:gradeDoc.ref,maxScore,login,checkpointSha,selectedEvidenceCommits,evidence:approvedEvidence,aiDraft:null,aiApplied:false};
    el("manualReviewUnpublish").classList.toggle("hidden",!previous?.published);
    el("manualReviewPublish").classList.toggle("hidden",!previous||previous.published||assessment.schemaVersion!==2);
    const verified=approvedEvidence?.verifiedContributionCommits?.length&&approvedEvidence?.contributionScope?.length>=15;
    el("manualReviewAIGenerate").disabled=assessment.schemaVersion!==2||!!previous?.published||!verified;
    if(assessment.schemaVersion===2)aiStatus((previous?.aiAssistance?"Saved feedback includes automated assistance reviewed by a teacher. ":"")+(verified?"Approved checkpoint "+checkpointSha.slice(0,12)+". Evaluate verified individual work or enter a teacher score.":"No independently verified contributions are recorded. Reopen evidence to verify responsibilities and commits, or grade manually with an explicit review note. Shared project screens cannot earn individual credit."));
    el("manualReviewSave").disabled=!!previous?.published;
    for(const id of ["manualReviewScore","manualReviewFeedback","manualReviewFiles","manualReviewReason","manualReviewConfirm"])
      el(id).disabled=!!previous?.published;
    el("manualReviewAnalyze").disabled=!login||Boolean(checkpointSha);
    el("manualReviewAnalyze").onclick=()=>examineRecentCommits(session,owner,repo,login);
    message(previous?.published?"Published grade protected. Unpublish for revision here, then reopen evidence in section 1 if student changes are needed.":previous?"Saved private draft. Review, save changes, or explicitly publish.":"No teacher grade saved. Review evidence, optionally evaluate, then complete section 3.");
    void sourceLinks(session,base,owner,repo,login,checkpointSha);
  }catch(error) {
    if (session!==state.token)return;
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
  const reason=el("manualReviewReason").value.trim();
  const paths=[...new Set(el("manualReviewFiles").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean))];
  if(!raw.trim()||!Number.isFinite(score)||score<0||score>active.maxScore)return message("Score must be between 0 and "+active.maxScore+".",true);
  if(!feedback || !reason)return message("Feedback and teacher review note are required.",true);
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
      if(active.previous && JSON.stringify(previous)!==JSON.stringify(active.previous)) {
        throw new Error("Grade changed after opening. Close and reopen the dialog.");
      }
      if(!active.previous && previous)throw new Error("Grade was created by another process. Reopen the dialog.");
      tx.set(revision,{
        gradeId:active.gradeRef.id,studentId:active.studentId,taskId:active.taskId,
        editorUid:auth.currentUser?.uid||null,reason:"Manual teacher review: "+reason,
        before:previous?{...pickDefinedGradeFields(previous,["score","feedback"]),published:!!previous.published}:null,
        after:{score,feedback,published:false,aiAssisted:Boolean(acceptedDraft||previous?.aiAssistance)},
        createdAt:serverTimestamp()
      });
      tx.set(active.gradeRef,{
        studentId:active.studentId,taskId:active.taskId,score,maxScore:active.maxScore,
        feedback,published:false,reviewRequired:false,manuallyAdjusted:true,
        gradeSource:acceptedDraft||previous?.aiAssistance?"teacher_ai_reviewed":"teacher_manual",gradingMode:"individual",sourceSelectionMode:"teacher_manual",
        aiAssistance:acceptedDraft?{
          model:acceptedDraft.model,checkpointSha:active.checkpointSha,
          suggestedScore:acceptedDraft.score,
          criterionScores:acceptedDraft.criteria.map(c=>({name:c.name,score:c.score,maxScore:c.maxScore})),
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
            limitations:acceptedDraft.limitations,generatedBy:"Gemini automated assistance",teacherReviewed:true
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
    if(state.active!==active||state.token!==session)return;
    const savedGrade=(await getDoc(active.gradeRef)).data();
    if(state.active!==active||state.token!==session)return;
    message("Teacher-reviewed grade saved as UNPUBLISHED. Review queue refreshed. Publish separately when ready.");
    button.textContent="Saved private draft";
    button.disabled=true;
    state.dirty=false;
    active.previous=savedGrade;
    el("manualReviewPublish").classList.toggle("hidden",active.assessment.schemaVersion!==2);
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
  const reason=prompt(published?"Why is this reviewed draft ready for the student? (15–3,000 characters)":"Reason for unpublishing this protected grade for revision (15–3,000 characters)");
  if(reason===null)return;
  if(reason.trim().length<15||reason.length>3000)return message("Enter a reason of 15–3,000 characters.",true);
  if(!confirm(published?"Publish this teacher-reviewed score and feedback to this student now?":"Unpublish this grade? It will no longer be visible to the student. Its score, feedback and audit history will be retained."))return;
  const button=el(published?"manualReviewPublish":"manualReviewUnpublish");button.disabled=true;
  try{
    await runTransaction(db,async transaction=>{
      const snapshot=await transaction.get(active.gradeRef),current=snapshot.data();
      if(!snapshot.exists()||JSON.stringify(current)!==JSON.stringify(active.previous))throw Error("Grade changed. Reload before continuing.");
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
    if(state.active===active&&state.request)await open({...state.request});
  }catch(error){message("Publication unchanged: "+error.message,true);}
  finally{button.disabled=false;}
}
async function groupSummary(student,taskId,session){
  const box=el("integratedGroupSummary");box.textContent="Loading group evidence status…";
  try{
    const [roster,evidence]=await Promise.all([
      getDocs(query(collection(db,"students"),where("section","==",student.section))),
      getDocs(query(collection(db,"assessment_evidence"),where("assessmentId","==",taskId)))
    ]);
    if(session!==state.token)return;
    box.replaceChildren();
    const entries=new Map(evidence.docs.map(snapshot=>[snapshot.data().studentId,snapshot.data()]));
    for(const snapshot of roster.docs){
      const member=snapshot.data();
      let same=false;try{same=parseRepository(member.repoUrl).url.toLowerCase()===parseRepository(student.repoUrl).url.toLowerCase();}catch{}
      if(!same)continue;
      const record=entries.get(snapshot.id),row=document.createElement("p");
      row.textContent=(member.name||snapshot.id)+": "+(record?.status||"No evidence submitted")+
        " · "+(record?.verifiedContributionCommits?.length??"Unverified")+" verified contributing commits";
      box.append(row);
    }
    const note=document.createElement("p");note.className="text-xs text-amber-900";
    note.textContent="Members can have different checkpoints. Counts and shared files do not prove contribution. Missing submissions do not establish no work.";box.append(note);
  }catch(error){if(session===state.token)box.textContent="Group status unavailable: "+error.message;}
}
function init() {
  el("manualReviewClose").addEventListener("click",close);
  el("manualReviewCancel").addEventListener("click",close);
  el("manualReviewForm").addEventListener("submit",save);
  el("manualReviewForm").addEventListener("input",()=>{state.dirty=true;if(state.active&&!state.active.previous?.published)el("manualReviewSave").disabled=false;});
  el("manualReviewAIGenerate").addEventListener("click",()=>{void generateAIDraft();});
  el("manualReviewUseScore").addEventListener("click",()=>applySuggestion("score"));
  el("manualReviewUseFeedback").addEventListener("click",()=>applySuggestion("feedback"));
  el("manualReviewPublish").addEventListener("click",()=>{void changePublication(true);});
  el("manualReviewUnpublish").addEventListener("click",()=>{void changePublication(false);});
  el("manualReviewSaveChecker").addEventListener("click",()=>{
    const key=el("manualReviewCheckerKey").value.trim();
    if(key.length<15||key.length>500)return aiStatus("Enter a valid provider key. Do not enter it in feedback.",true);
    try{localStorage.setItem("Adminerva_gemini_token",key);el("manualReviewCheckerKey").value="";el("manualReviewCheckerSetup").open=false;aiStatus("Checker key saved on this device. Evaluate is available after contribution verification.");}
    catch{aiStatus("This browser could not save the key. You can still grade manually.",true);}
  });
  window.addEventListener("message",event=>{
    if(event.origin===location.origin&&event.source===el("integratedEvidenceFrame").contentWindow&&
      event.data?.type==="adminerva:evidence-height"&&Number.isFinite(event.data.height)){
      el("integratedEvidenceFrame").style.height=Math.max(180,Math.min(25000,event.data.height))+"px";return;
    }
    if(event.origin!==location.origin||event.source!==el("integratedEvidenceFrame").contentWindow||
      event.data?.type!=="adminerva:evidence-changed"||!state.request||
      event.data.studentId!==state.request.studentId||event.data.assessmentId!==state.request.taskId)return;
    window.dispatchEvent(new CustomEvent("adminerva:manual-grade-saved"));
    if(state.active&&(el("manualReviewScore").value||el("manualReviewFeedback").value)){
      el("integratedEvidenceStatus").textContent="Evidence changed. Reload the checkpoint and grade status before continuing this review.";
      state.active=null;el("manualReviewSave").disabled=true;el("manualReviewAIGenerate").disabled=true;
      return message("Evidence changed. Displayed draft is stale and cannot be saved. Reload checkpoint / grade status to review again.",true);
    }
    void open({...state.request});
  });
  el("manualReviewRefresh").addEventListener("click",()=>{
    if(state.dirty&&!confirm("Reload and discard unsaved score or feedback changes?"))return;
    if(state.request)void open({...state.request});
  });
  el("manualReviewModal").addEventListener("click",e=>{if(e.target===el("manualReviewModal"))close()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!el("manualReviewModal").classList.contains("hidden"))close()});
}
window.openManualGradeReview=open;
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
else init();
