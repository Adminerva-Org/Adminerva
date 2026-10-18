import { auth, db } from "../core/firebase-core.js";
import { cleanGradeFeedback } from "../core/feedback-format.mjs";
import { pickDefinedGradeFields } from "./services/grade-revision-snapshot.mjs";
import {
  collection, doc, getDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { analyzePatchSubstance } from "./services/commit-substance.mjs";
import {parseRepository,validSha} from "./services/assessment-evidence.mjs";
import {parseWeightedRubric,loadPinnedV2Source,buildRubricPrompt,parseSuggestedRubric}
  from "./services/v2-grading-assistant.mjs";

const el = id => document.getElementById(id);
const state = { active: null, request: null, token: 0, flags: [], aiBusy: false };
function message(text, error=false) {
  const node=el("manualReviewStatus");
  node.textContent=text; node.className=error ? "text-sm text-rose-700" : "text-sm text-slate-600";
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
  el("manualReviewModal").classList.add("hidden");
  state.active=null;
  state.request=null;
  state.aiBusy=false;
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
    heading.textContent=item.name+": "+item.score+"/"+item.maxScore;
    const rationale=document.createElement("p");rationale.className="mt-1 text-xs text-slate-700 whitespace-pre-wrap";
    rationale.textContent=item.rationale;
    row.append(heading,rationale);container.append(row);
  }
  const total=document.createElement("p");total.className="font-bold text-indigo-950";
  total.textContent="AI suggested total: "+draft.score;
  container.append(total);
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
    return aiStatus("An approved V2 project checkpoint is required before AI suggestions.",true);
  }
  if(active.previous?.published)return aiStatus("Published grades are protected. No AI changes were made.",true);
  const token=localStorage.getItem("Adminerva_gemini_token");
  if(!token)return aiStatus("Configure your Gemini API key in Adminerva Settings before requesting AI suggestions.",true);
  const model=String(localStorage.getItem("Adminerva_ai_model")||"gemini-2.5-flash").trim();
  if(!/^[a-zA-Z0-9._-]{1,80}$/.test(model))return aiStatus("The configured AI model name is invalid.",true);
  if(!confirm("Request an AI rubric suggestion for the approved Git checkpoint? The relevant student source code and selected diffs will be sent to your configured AI provider. You must verify and approve any score before saving."))return;
  if((el("manualReviewScore").value.trim()||el("manualReviewFeedback").value.trim()) &&
     !confirm("Replace the currently displayed score and feedback with AI suggestions? No grade is saved until you confirm."))return;
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
      token:localStorage.getItem("Adminerva_github_token")
    });
    if(session!==state.token)return;
    aiStatus("Generating rubric suggestions. Existing student grades remain unchanged…");
    const prompt=buildRubricPrompt({
      assessment:active.assessment,criteria,checkpointSha:active.checkpointSha,
      files:evidence.files,patches:evidence.patches
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
    if(!response.ok)throw Error("AI provider returned HTTP "+response.status+
      ". Check the model and key in Settings. No grade was saved.");
    const aiData=await response.json();
    const output=aiData?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
    if(!output)throw Error("AI provider returned no grading suggestion.");
    const parsed=JSON.parse(output.replace(/^\x60{3}(?:json)?\s*/i,"").replace(/\s*\x60{3}$/,"").trim());
    const draft=parseSuggestedRubric(parsed,criteria,active.maxScore);
    if(session!==state.token||state.active!==active)return;
    active.aiDraft={model,checkpointSha:active.checkpointSha,...draft};
    displayAISuggestion(draft);
    el("manualReviewScore").value=String(draft.score);
    el("manualReviewFeedback").value=draft.feedback;
    el("manualReviewFiles").value=evidence.files.map(f=>f.path).join("\n");
    aiStatus("AI suggestions have filled the editable score and feedback fields. Review every criterion and source file. Add your own teacher review note and confirm inspection before saving.");
  }catch(error){
    if(session===state.token)aiStatus("AI suggestion unavailable: "+error.message,true);
  }finally{
    if(session===state.token){
      state.aiBusy=false;button.disabled=Boolean(state.active?.previous?.published)||!state.active?.checkpointSha;
      button.textContent="Generate AI rubric draft";
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
  el("manualReviewAISection").classList.add("hidden");
  el("manualReviewAIScores").replaceChildren();
  el("manualReviewAIGenerate").disabled=true;
  el("manualReviewAIGenerate").textContent="Generate AI rubric draft";
  aiStatus("Approve checkpoint evidence to enable suggestions.");
  el("manualReviewModal").classList.remove("hidden");
  el("manualReviewForm").reset();
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
    el("manualReviewStudent").textContent=(student.name||studentId)+" (@"+accountName+")";
    el("manualReviewTask").textContent=(assessment.title||taskId)+" — "+(assessment.maxScore||20)+" points";
    if(assessment.schemaVersion===2){
      el("manualReviewAISection").classList.remove("hidden");
      link(el("manualReviewLinks"),"Assessment Evidence Review ↗","assessment-evidence-review.html?student="+
        encodeURIComponent(studentId)+"&assessment="+encodeURIComponent(taskId));
      link(el("manualReviewLinks"),"Contribution Inspector ↗","contribution-inspector.html?section="+
        encodeURIComponent(student.section)+"&student="+encodeURIComponent(studentId)+
        "&assessment="+encodeURIComponent(taskId));
    }
    let checkpointSha=null,selectedEvidenceCommits=[];
    if(assessment.schemaVersion===2){
      const evidence=await getDoc(doc(db,"assessment_evidence",studentId+"_"+taskId));
      if(session!==state.token)return;
      if(!evidence.exists()||evidence.data().status!=="approved"||
        !validSha(evidence.data().approvedCheckpointSha)||
        evidence.data().approvedCheckpointSha!==evidence.data().checkpointSha)
        throw Error("Approve the student's assessment checkpoint in Assessment Evidence Review before grading.");
      if(parseRepository(evidence.data().repository).url!==parseRepository(base).url)
        throw Error("Approved evidence belongs to a different repository. Review the student's linked repository.");
      checkpointSha=evidence.data().approvedCheckpointSha;
      selectedEvidenceCommits=evidence.data().selectedCommits||[];
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
    if (previous?.provisionalScore)flag("Existing score is provisional; alternate source paths need confirmation.");
    if(previous?.published)flag("This grade is PUBLISHED. Unpublish it using Gradebook before replacing it manually.");
    flag("GitHub commit attribution alone cannot establish original authorship. Recommits changing only comments or formatting may not demonstrate new implementation.");
    el("manualReviewScore").max=String(maxScore);
    el("manualReviewMax").value=String(maxScore);
    el("manualReviewScore").value=previous?.score!=null?String(previous.score):"";
    el("manualReviewFeedback").value=cleanGradeFeedback(previous?.feedback);
    el("manualReviewFiles").value=(previous?.contributionEvidence?.matchedPaths||[]).join("\n");
    state.active={studentId,taskId,owner,repo,base,student,assessment,previous,gradeRef:gradeDoc.ref,maxScore,login,checkpointSha,selectedEvidenceCommits,aiDraft:null};
    el("manualReviewAIGenerate").disabled=assessment.schemaVersion!==2||!!previous?.published;
    if(assessment.schemaVersion===2)aiStatus("Approved checkpoint "+checkpointSha.slice(0,12)+". Generate a rubric suggestion or grade manually; scores are never auto-published.");
    el("manualReviewSave").disabled=!!previous?.published;
    el("manualReviewAnalyze").disabled=!login||Boolean(checkpointSha);
    el("manualReviewAnalyze").onclick=()=>examineRecentCommits(session,owner,repo,login);
    message(previous?.published?"Published grade protected: unpublish it in Gradebook first.":"Manual changes will be saved unpublished and documented in grade revisions.");
    void sourceLinks(session,base,owner,repo,login,checkpointSha);
  }catch(error) {
    if (session!==state.token)return;
    message("Review is not ready: "+error.message+" Use Assessment Evidence Review, then click Reload checkpoint / grade status.",true);
    aiStatus("No AI suggestion can run until the checkpoint is approved.",true);
  }
}
async function save(event) {
  event.preventDefault();
  const active=state.active;if(!active)return;
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
      }
      const latest=await tx.get(active.gradeRef);
      const previous=latest.exists()?latest.data():null;
      if(previous?.published)throw new Error("A published grade is protected. Unpublish in Gradebook first.");
      if(active.previous && (!previous || Number(previous.score)!==Number(active.previous.score) ||
          String(previous.feedback||"")!==String(active.previous.feedback||""))) {
        throw new Error("Grade changed after opening. Close and reopen the dialog.");
      }
      if(!active.previous && previous)throw new Error("Grade was created by another process. Reopen the dialog.");
      tx.set(revision,{
        gradeId:active.gradeRef.id,studentId:active.studentId,taskId:active.taskId,
        editorUid:auth.currentUser?.uid||null,reason:"Manual teacher review: "+reason,
        before:previous?{...pickDefinedGradeFields(previous,["score","feedback"]),published:!!previous.published}:null,
        after:{score,feedback,published:false,aiAssisted:Boolean(active.aiDraft)},
        createdAt:serverTimestamp()
      });
      tx.set(active.gradeRef,{
        studentId:active.studentId,taskId:active.taskId,score,maxScore:active.maxScore,
        feedback,published:false,reviewRequired:false,manuallyAdjusted:true,
        gradeSource:active.aiDraft?"teacher_ai_reviewed":"teacher_manual",gradingMode:"individual",sourceSelectionMode:"teacher_manual",
        aiAssistance:active.aiDraft?{
          model:active.aiDraft.model,checkpointSha:active.checkpointSha,
          suggestedScore:active.aiDraft.score,
          criterionScores:active.aiDraft.criteria.map(c=>({name:c.name,score:c.score,maxScore:c.maxScore})),
          generatedAt:serverTimestamp()
        }:null,
        reviewPriority:"teacher_verified",provisionalScore:false,
        teacherReviewNote:reason,
        reviewReasons:[...new Set(state.flags.concat(previous?.reviewReasons || []))].slice(0,60),
        reviewedBy:auth.currentUser?.uid||null,
        reviewedAt:serverTimestamp(),gradedAt:serverTimestamp(),
        ...(active.checkpointSha?{gradedSha:active.checkpointSha}:{}),
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
    message("Teacher-reviewed grade saved as UNPUBLISHED. RepoFetch grading queue will refresh automatically.");
    button.textContent="Saved";
    state.active=null;
    window.dispatchEvent(new CustomEvent("adminerva:manual-grade-saved",{
      detail:{studentId:active.studentId,assessmentId:active.taskId}
    }));
  }catch(error){message("Unable to save: "+error.message,true);button.disabled=false;}
}
function init() {
  el("manualReviewClose").addEventListener("click",close);
  el("manualReviewCancel").addEventListener("click",close);
  el("manualReviewForm").addEventListener("submit",save);
  el("manualReviewAIGenerate").addEventListener("click",()=>{void generateAIDraft();});
  el("manualReviewRefresh").addEventListener("click",()=>{
    if(state.request)void open({...state.request});
  });
  el("manualReviewModal").addEventListener("click",e=>{if(e.target===el("manualReviewModal"))close()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!el("manualReviewModal").classList.contains("hidden"))close()});
}
window.openManualGradeReview=open;
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
else init();
