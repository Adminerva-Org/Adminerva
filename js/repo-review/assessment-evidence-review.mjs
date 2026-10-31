import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.0";
/** Instructor checkpoint approval, reopening and contribution verification. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,doc,getDoc,getDocFromServer,getDocs,setDoc,query,where,updateDoc,runTransaction,serverTimestamp,onSnapshot}
  from "../core/teaching-firestore.mjs?v=1.3.0";
import {parseRepository,normalizeSelection,validSha}
  from "./services/assessment-evidence.mjs?v=1.4.4";
import {commitPagePath,appendUniqueCommits,hasOlderCommitPage,verifyCheckpointAncestry} from "./services/commit-history.mjs?v=1.4.3";
import {approvalContribution,sameEvidence} from "./services/evidence-lifecycle.mjs?v=1.4.3";
import {changeEvidence} from "./services/evidence-transaction.mjs?v=1.3.1";
import {loadReviewSnapshot} from "./services/review-snapshot.mjs?v=1.3.0";

import {evidenceReviewMarkup} from "./evidence-review-view.mjs?v=1.3.6";
import {searchStudents} from "./services/student-search.mjs?v=1.3.0";
import {decideReclaim} from "./services/reclaim-decision.mjs?v=1.3.2";

export function createEvidenceReview({root=document,inlineContext=null,requests=null,onChange=()=>{}}={}){
const el=id=>root.querySelector("#"+id);
const state={students:[],assessments:[],evidence:null,student:null,assessment:null,claims:[],loaded:false,busy:false,sequence:0,editing:false,verificationEditing:false};
let stopEvidence=null,watchedId=null,destroyed=false,resolveInitial=null,initialTimer=null,initialSnapshot=null,hasServerSnapshot=false;
const discovery={commits:[],selected:new Set(),locked:new Set(),checkpoint:"",page:0,hasOlder:false,loading:false,sequence:0,branch:"",mode:"create"};
const embedded=new URLSearchParams(location.search).get("embedded")==="1";
if(embedded&&!inlineContext){
  document.body.classList.add("evidence-embedded");
  document.body.style.minHeight="0";
  document.getElementById("adminerva-nav")?.remove();
  document.querySelector("main > header")?.remove();
  document.querySelector("main > section")?.classList.add("hidden");
  new ResizeObserver(()=>{
    const height=Math.ceil(el("pageBody").getBoundingClientRect().height)+20;
    window.parent.postMessage({type:"adminerva:evidence-height",height},location.origin);
  }).observe(el("pageBody"));
}
function notifyWorkspace(){
  if(inlineContext){onChange(state.evidence);return;}
  if(embedded)window.parent.postMessage({type:"adminerva:evidence-changed",studentId:state.student.id,assessmentId:state.assessment.id},location.origin);
}
function updateDiscoveryPaging(){
  const button=el("evidenceFindOlder");if(!button)return;
  button.classList.toggle("hidden",!discovery.hasOlder);
  button.disabled=discovery.loading;
  button.textContent=discovery.loading?"Loading older commits…":"Load older commits";
}
function configureDiscovery(mode="create"){
  discovery.mode=mode;
  const augment=mode==="augment";
  if(el("evidenceDiscoveryTitle"))el("evidenceDiscoveryTitle").textContent=augment?"Add unmatched repository commit":"Discover historical GitHub evidence";
  if(el("evidenceDiscoveryHelp"))el("evidenceDiscoveryHelp").textContent=augment
    ?"Select only commit(s) you inspected and can attribute to this learner despite a different or unlinked GitHub identity. Existing selected evidence stays locked. Choose a checkpoint containing all selected commits. Added commits still require explicit contribution verification before evaluation."
    :"For assessments already assigned in class: select relevant commits from the linked repository without asking the student to resubmit. This records an instructor-discovered proposal, not a student submission or proof of on-time work.";
  if(el("evidenceFindCommits"))el("evidenceFindCommits").textContent=augment?"Load repository commits":"Find repository commits";
  if(el("evidenceSaveDiscovery"))el("evidenceSaveDiscovery").textContent=augment?"Add selected commit(s) to evidence":"Save proposed historical evidence";
  for(const id of ["evidenceDiscoveryNoteLabel","evidenceDiscoveryNote"])el(id)?.classList.toggle("hidden",!augment);
}
function add(parent,tag,text,style=""){
  const x=document.createElement(tag);x.textContent=String(text??"");if(style)x.className=style;
  parent.append(x);return x;
}
function status(t){if(el("evidenceReviewStatus"))el("evidenceReviewStatus").textContent=t;if(el("evidenceActionStatus"))el("evidenceActionStatus").textContent=t;}
function timeText(timestamp){
  const date=timestamp?.toDate?.()||((timestamp instanceof Date)?timestamp:null);
  return date && !Number.isNaN(date.getTime())?date.toLocaleString():"time unavailable";
}
function isResubmitted(evidence){
  if(evidence?.status!=="submitted"||!evidence.reopenedAt)return false;
  const submitted=evidence.submittedAt?.toMillis?.(),reopened=evidence.reopenedAt?.toMillis?.();
  return submitted!=null&&reopened!=null?submitted>=reopened:Boolean(evidence.reopenedBy);
}
function showLifecycle(evidence,{stale=false}={}){
  const banner=el("evidenceLifecycleBanner"),label=el("evidenceLifecycleLabel"),help=el("evidenceLifecycleHelp");
  if(!banner||!label||!help)return;
  let tone="slate",title="No submission",description="There is no selected evidence to approve.";
  if(stale){tone="amber";title="New evidence detected — refresh required";
    description="The learner's saved evidence changed while this review was open. Refresh status to read the latest server record before approval. Unsaved review text will be discarded after confirmation.";
  }else if(evidence?.status==="reopened"){tone="amber";title="Reopened — waiting for student";
    description="This evidence is still marked Reopened in the saved record. Approval is unavailable until the student submits selected evidence again. A repository push or submission receipt is not the same as resubmitting selected evidence."+
      (evidence.reopenReason?" Teacher reason: "+evidence.reopenReason:"");
  }else if(evidence?.status==="submitted"){tone="blue";
    title=isResubmitted(evidence)?"Resubmitted — awaiting teacher approval":"Submitted — awaiting teacher approval";
    description="Saved "+timeText(evidence.submittedAt)+". The learner's selected commits are ready for teacher review. Check attribution and checkpoint ancestry, then verify and approve.";
  }else if(evidence?.status==="approved"){tone="emerald";title="Approved";
    description="Checkpoint approved. To change student-selected evidence, reopen it first. Individual grading and grade publication are separate steps.";
  }else if(evidence?.status==="needs_review"){tone="amber";title="Teacher-discovered — needs verification";
    description="This is an instructor proposal, not a student resubmission. Inspect and approve, or return it for the student to choose their own evidence.";
  }else if(evidence?.status==="withdrawn"){tone="slate";title="Withdrawn — awaiting resubmission";
    description="The learner withdrew evidence. They must submit selected commits again before teacher approval.";
  }else if(evidence){tone="amber";title="Evidence state: "+String(evidence.status||"unknown");
    description="Refresh the record to confirm the current status before taking action.";
  }
  const tones={slate:"border-slate-300 bg-slate-50 text-slate-900",amber:"border-amber-300 bg-amber-50 text-amber-950",
    blue:"border-blue-300 bg-blue-50 text-blue-950",emerald:"border-emerald-300 bg-emerald-50 text-emerald-950"};
  banner.className="rounded-lg border px-4 py-3 flex flex-wrap items-start justify-between gap-3 "+tones[tone];
  label.textContent=title;help.textContent=description;
}
function link(parent,title,url){
  const a=add(parent,"a",title,"font-semibold text-indigo-700 hover:underline break-all");
  a.href=url;a.target="_blank";a.rel="noopener noreferrer";return a;
}
function syncBulkVerification(){
  const bulk=el("evidenceVerifyAll");if(!bulk)return;
  const inputs=[...root.querySelectorAll("[data-contribution-sha]")];
  const checked=inputs.filter(input=>input.checked).length;
  bulk.checked=Boolean(inputs.length&&checked===inputs.length);
  bulk.indeterminate=checked>0&&checked<inputs.length;
}
async function github(route){
  if(requests)return requests.json(route);
  const headers={Accept:"application/vnd.github+json"};
  const token=localStorage.getItem("Adminerva_github_token");if(token)headers.Authorization="Bearer "+token;
  const res=await fetch("https://api.github.com"+route,{headers});
  if(!res.ok)throw Error("GitHub HTTP "+res.status+" — verify the repository is publicly accessible.");
  return res.json();
}
function api(repo){return "/repos/"+encodeURIComponent(repo.owner)+"/"+encodeURIComponent(repo.repo);}
function selection(){
  if(inlineContext)return inlineContext;
  const student=state.students.find(s=>s.id===el("evidenceStudent").value);
  const assessment=state.assessments.find(a=>a.id===el("evidenceAssessment").value);
  if(!student||!assessment)throw Error("Choose a student and V2 assessment.");
  if(!assessment.deployments?.some(d=>d.section===student.section))
    throw Error("Assessment is not deployed to the student's section.");
  return {student,assessment};
}
function option(parent,value,label){
  const x=add(parent,"option",label);x.value=value;
}
async function loadDirectory(){
  const [students,assessments]=await Promise.all([
    getDocs(collection(db,"students")),getDocs(collection(db,"assessments"))]);
  state.students=students.docs.map(d=>({id:d.id,...d.data()}));
  state.assessments=assessments.docs.map(d=>({id:d.id,...d.data()})).filter(a=>a.schemaVersion===2);
  const select=el("evidenceStudent");
  const sections=el("evidenceSection");
  if(sections){sections.replaceChildren();option(sections,"","All sections");for(const section of [...new Set(state.students.map(student=>student.section).filter(Boolean))].sort())option(sections,section,section);}
  renderStudentSearch();
  const ass=el("evidenceAssessment");ass.replaceChildren();option(ass,"","Select V2 assessment");
  for(const item of state.assessments)option(ass,item.id,item.title||item.id);
  const url=new URLSearchParams(location.search);
  if(state.students.some(s=>s.id===url.get("student")))renderStudentSearch(url.get("student"));
  if(state.assessments.some(a=>a.id===url.get("assessment")))ass.value=url.get("assessment");
  if(select.value&&ass.value)await loadEvidence();
  else status("Select a student and V2 assessment.");
}
function renderStudentSearch(selected=el("evidenceStudent")?.value||""){
  const select=el("evidenceStudent");if(!select)return;
  const result=searchStudents(state.students,{section:el("evidenceSection")?.value,text:el("evidenceStudentSearch")?.value,selected});
  select.replaceChildren();option(select,"","Select student");
  for(const student of result.rows)option(select,student.id,(student.name||student.id)+" · "+(student.section||"No section"));
  select.value=selected;
  if(el("evidenceSearchStatus"))el("evidenceSearchStatus").textContent=result.total+" matching students. "+(result.truncated?"Showing the first 40; choose a section or refine your search. ":"")+ (selected?"Current selection is retained until you choose another student. Evidence only changes when you load it.":"");
}
async function loadEvidence(initialRecord){
  const sequence=++state.sequence;
  state.editing=false;state.verificationEditing=false;
  state.loaded=false;state.evidence=null;el("evidenceDetails").classList.add("hidden");
  for(const id of ["evidenceContributionScope","evidenceReviewNote","evidenceConfirm","evidenceVerifyAll","evidenceApprove","evidenceReopen","evidenceEditVerification"])el(id).disabled=true;
  discovery.sequence++;discovery.hasOlder=false;discovery.page=0;discovery.loading=false;updateDiscoveryPaging();
  el("evidenceDiscovery").classList.add("hidden");
  try{
    const {student,assessment}=selection();state.student=student;state.assessment=assessment;
    const documentId=student.id+"_"+assessment.id;
    if(watchedId!==documentId){stopEvidence?.();resolveInitial?.(null);clearTimeout(initialTimer);stopEvidence=null;watchedId=documentId;}
    let record=initialRecord;
    if(!stopEvidence){
      hasServerSnapshot=false;
      let waiting=true,rejectInitial,finishInitial;
      const initial=new Promise((resolve,reject)=>{finishInitial=resolve;resolveInitial=resolve;rejectInitial=reject;});
      initialSnapshot=initial;
      const timer=setTimeout(()=>rejectInitial(Error("Live evidence confirmation timed out. Reload before approving; no evidence was changed.")),10000);initialTimer=timer;
      stopEvidence=onSnapshot(doc(db,"assessment_evidence",student.id+"_"+assessment.id),snapshot=>{
        if(destroyed||watchedId!==documentId||snapshot.metadata.hasPendingWrites||snapshot.metadata.fromCache)return;
        const current=snapshot.exists()?snapshot.data():null;
        if(waiting){waiting=false;hasServerSnapshot=true;clearTimeout(timer);finishInitial(current);return;}
        if(state.busy)return;
        if((!current&&!state.evidence)||sameEvidence(current,state.evidence))return;
        onChange(current);
        if(state.editing){
          state.loaded=false;el("evidenceApprove").disabled=true;
          el("evidenceReopen").disabled=true;
          showLifecycle(current,{stale:true});
          status("Evidence changed in another session. Review text was kept. Choose Refresh status to load the current submission; approval is blocked until you refresh.");
        }else void loadEvidence(current);
      },error=>{clearTimeout(timer);rejectInitial(error);status("Live evidence status unavailable: "+error.message+". Reload before approving.");});
      record=await initial;
    }else if(!hasServerSnapshot){
      record=await initialSnapshot;
    }else if(initialRecord===undefined){
      const snapshot=await getDocFromServer(doc(db,"assessment_evidence",documentId));
      record=snapshot.exists()?snapshot.data():null;
    }
    if(destroyed||sequence!==state.sequence)return;
    onChange(record);
    if(!record){
      showLifecycle(null);
      configureDiscovery("create");
      el("evidenceDiscovery").classList.remove("hidden");
      el("evidenceDiscoverList").replaceChildren();
      el("evidenceDiscoveryNote").value="";
      discovery.commits=[];discovery.selected=new Set();discovery.locked=new Set();discovery.checkpoint="";
      status("No student submission. You may discover historical commits without changing the student's GitHub history.");
      return;
    }
    const evidence=record;
    normalizeSelection(evidence.selectedCommits,evidence.checkpointSha,{allowEmpty:evidence.source==="teacher_discovered"});
    if(evidence.studentId!==student.id||evidence.assessmentId!==assessment.id||
       evidence.repository!==student.repoUrl)throw Error("Submission identity or repository does not match the roster.");
    state.evidence=evidence;
    showLifecycle(evidence);
    const previews=[showSnapshot(evidence,assessment)];
    el("evidenceContributionScope").value=evidence.contributionScope||"";
    el("evidenceContributionScope").disabled=evidence.status==="approved";
    el("evidenceReviewNote").value="";el("evidenceConfirm").checked=false;
    // Section-scoped query satisfies teacher Firestore permissions without
    // requiring a composite index for studentId + section.
    const claims=await getDocs(query(collection(db,"commit_reclaims"),where("section","==",student.section)));
    if(destroyed||sequence!==state.sequence)return;
    state.claims=claims.docs.filter(d=>d.data().studentId===student.id &&
      d.data().repository===evidence.repository &&
      (d.data().assessmentId===assessment.id || evidence.selectedCommits.includes(d.data().sha)))
      .map(d=>({id:d.id,...d.data()}));
    const unresolved=state.claims.filter(claim=>claim.status==="pending"&&evidence.selectedCommits.includes(claim.sha));
    if(unresolved.length){
      el("evidenceLifecycleHelp").textContent+=" Approval blocked: "+unresolved.length+
        " selected commit attribution claim(s) remain pending administrator review. See Reclaim requests below.";
      el("evidenceLifecycleBanner").className="rounded-lg border border-amber-300 bg-amber-50 text-amber-950 px-4 py-3 flex flex-wrap items-start justify-between gap-3";
    }
    const repo=parseRepository(evidence.repository),base=repo.url;
    el("evidenceTitle").textContent=(student.name||student.id)+" — "+(assessment.title||assessment.id);
    el("evidenceMetadata").textContent="Status: "+evidence.status+
      " · Section: "+student.section+" · Project checkpoint: "+evidence.checkpointSha+
      " · Individual evidence commits: "+evidence.selectedCommits.length+
      (evidence.discoveryCutoff?" · Gather cutoff: "+new Date(evidence.discoveryCutoff).toLocaleString():"");
    const links=el("evidenceLinks");links.replaceChildren();
    link(links,"Project at checkpoint ↗",base+"/tree/"+encodeURIComponent(evidence.checkpointSha));
    if(!embedded&&!inlineContext)link(links,"Open grading in RepoFetch →","repofetch.html?section="+
      encodeURIComponent(student.section)+"&student="+encodeURIComponent(student.id)+
      "&assessment="+encodeURIComponent(assessment.id));
    if(!embedded&&!inlineContext)link(links,"Contribution Inspector ↗","contribution-inspector.html?section="+
      encodeURIComponent(student.section)+"&student="+encodeURIComponent(student.id)+
      "&assessment="+encodeURIComponent(assessment.id));
    const rows=el("evidenceCommitDetails");rows.replaceChildren();
    const checks=el("evidenceContributionChecks");checks.replaceChildren();
    const claimBySha=new Map(state.claims.map(claim=>[String(claim.sha||"").toLowerCase(),claim]));
    const priorVerified=new Set(evidence.verifiedContributionCommits||[]);
    for(const sha of evidence.selectedCommits){
      const p=add(rows,"div","","rounded-lg border p-3 flex flex-wrap items-center gap-3");
      link(p,sha.slice(0,12)+" · View on GitHub ↗",base+"/commit/"+encodeURIComponent(sha));
      const preview=add(p,"button","Preview changes","text-xs underline text-indigo-700");
      preview.type="button";
      preview.addEventListener("click",()=>{void previewCommit(repo,sha,p,preview);});
      const label=add(checks,"label","","flex gap-2 items-start text-xs rounded border p-2");
      const verified=document.createElement("input");verified.type="checkbox";
      verified.dataset.contributionSha=sha;
      const claim=claimBySha.get(String(sha).toLowerCase());
      const hasApprovedClaim=claim?.status==="approved";
      verified.checked=priorVerified.has(sha) ||
        (evidence.status!=="approved"&&hasApprovedClaim);
      verified.disabled=evidence.status==="approved"||claim?.status==="rejected";
      label.append(verified);
      const claimHint=claim?.status==="approved"
        ?" · approved attribution claim; verify its changed files before grading"
        :claim?.status==="shared"?" · shared contribution claim; verify only the student's own changes"
        :claim?.status==="pending"?" · attribution pending administrator decision"
        :claim?.status==="rejected"?" · attribution claim rejected; excluded from individual verification":"";
      add(label,"span",sha.slice(0,12)+" · verify this selected commit for individual credit"+claimHint);
      if(claim?.status==="rejected")label.classList.add("bg-rose-50","border-rose-300");
      else if(hasApprovedClaim)label.classList.add("bg-emerald-50","border-emerald-300");
      else if(claim?.status==="pending")label.classList.add("bg-amber-50","border-amber-300");
    }
    syncBulkVerification();
    await renderClaims();
    if(destroyed||sequence!==state.sequence)return;
    el("evidenceApprove").disabled=!["submitted","needs_review"].includes(evidence.status);
    el("evidenceApprove").title=evidence.status==="reopened"
      ?"Waiting for the student's selected evidence resubmission. Choose Refresh status to verify a recent resubmission."
      :evidence.status==="withdrawn"?"Withdrawn evidence must be resubmitted before approval."
      :evidence.status==="approved"?"Already approved; reopen or revise verification when necessary."
      :"Review the current selected commits and approve after verification.";
    const canReopen=["submitted","approved","needs_review"].includes(evidence.status);
    const reviewLabel=el("evidenceReviewNoteLabel"),reviewNote=el("evidenceReviewNote");
    el("evidenceReopen").classList.toggle("hidden",!canReopen);
    el("evidenceReopen").disabled=false;
    el("evidenceReopen").textContent=evidence.status==="submitted"?"Return for student changes":"Reopen for student changes";
    if(reviewLabel)reviewLabel.textContent=canReopen?(evidence.status==="submitted"?"Reason for returning submission to student (required)":"Reason for reopening / allowing student changes (required)"):"Additional review note (optional for approval)";
    if(reviewNote)reviewNote.placeholder=canReopen
      ?(evidence.status==="submitted"?"Example: Selected evidence is not contained in the chosen checkpoint. Choose a newer checkpoint and resubmit.":"Example: Student has new commits and needs to replace the previous evidence selection.")
      :"Approval records your inspection automatically.";
    el("evidenceEditVerification").classList.toggle("hidden",evidence.status!=="approved");
    el("evidenceAuditSummary").textContent="Evidence revision: "+(evidence.revision||0)+". Changes preserve the previous record and reviewer identity. Reopening invalidates draft eligibility; published grades must be unpublished first.";
    el("evidenceApprove").textContent=evidence.status==="approved"?"Checkpoint approved":"Verify and approve checkpoint";
    el("evidenceDetails").classList.remove("hidden");
    state.loaded=true;
    const mayAddUnmatched=["submitted","needs_review","approved"].includes(evidence.status);
    el("evidenceAttributionOverride")?.classList.toggle("hidden",!mayAddUnmatched);
    if(el("evidenceAddCommit"))el("evidenceAddCommit").disabled=!mayAddUnmatched;
    el("evidenceContributionScope").disabled=evidence.status==="approved";
    el("evidenceReviewNote").disabled=false;el("evidenceConfirm").disabled=false;el("evidenceVerifyAll").disabled=evidence.status==="approved";el("evidenceEditVerification").disabled=false;
    status(evidence.selectedCommits.length
      ?"Loaded "+evidence.selectedCommits.length+" selected commits. Approval will verify checkpoint ancestry and the contribution choices."
      :"Loaded a checkpoint-only teacher snapshot. No individual commit is attributed to this learner; you may approve the checkpoint as project context, but system evaluation remains unavailable until individual contribution is verified.");
    if(evidence.status==="reopened")status("Reopened: the student can change commit selections now. They must resubmit before a new approval. Contribution checks here verify authorship; they do not edit the student's selected commits.");
    else if(evidence.status==="submitted")status(isResubmitted(evidence)?"Student resubmitted evidence after reopening. Check the selected commits and attribution claims, then approve the new revision.":"Student evidence is awaiting review. If approval fails or the selection needs correction, enter a reason below and choose Return for student changes.");
    else if(evidence.status==="approved")status(evidence.verifiedContributionCommits?.length?"Approved. To let the student submit different commits, enter a reopening reason below and choose Reopen for student changes.":"Approved checkpoint has no verified individual contributions. To let the student change commits, enter a reopening reason below and choose Reopen for student changes.");
    else if(evidence.status==="needs_review")status("This is an instructor-discovered evidence proposal, so the student cannot edit it yet. To let the student choose different commits and a new checkpoint, enter a reason below and choose Reopen for student changes.");
    void Promise.all(previews);
  }catch(error){if(!destroyed&&sequence===state.sequence)status("Unable to load evidence: "+error.message);}
}
async function previewCommit(repo,sha,row,button){
  let section=row.querySelector("[data-commit-preview]");
  if(section){
    section.open=!section.open;
    return;
  }
  section=add(row,"details","","w-full rounded-lg border border-slate-200 bg-slate-50 mt-3");
  section.dataset.commitPreview="true";
  const summary=add(section,"summary","Changes in "+sha.slice(0,12)+" · click to collapse",
    "cursor-pointer px-3 py-2 text-sm font-bold text-slate-800");
  const box=add(section,"pre","Loading commit diffs…",
    "whitespace-pre-wrap break-words text-xs bg-slate-50 p-3 m-2 border rounded overflow-auto");
  box.style.maxHeight="min(24rem, 55vh)";
  box.style.maxWidth="100%";
  section.open=true;
  const sync=()=>{
    button.textContent=section.open?"Hide changes":"Preview changes";
    button.setAttribute("aria-expanded",String(section.open));
  };
  section.addEventListener("toggle",sync);
  sync();
  const end=window.beginLoading?.("Loading selected commit changes…",section)||(()=>{});
  button.disabled=true;
  try{
    const data=await github(api(repo)+"/commits/"+sha+"?per_page=100");
    const details=["Message: "+(data.commit?.message||""),
      "Git author: "+(data.commit?.author?.name||"Unknown"),
      "GitHub account: "+(data.author?.login||"Unknown"),
      "Changed files: "+(data.files?.length||0)];
    for(const f of (data.files||[]).slice(0,30))
      details.push("\n--- "+f.filename+" ---\n"+
        (typeof f.patch==="string"?f.patch.slice(0,5000):"Binary or unavailable diff"));
    if(section.isConnected)box.textContent=details.join("\n");
  }catch(e){if(section.isConnected)box.textContent="Unable to preview commit: "+e.message;}
  finally{button.disabled=false;end();sync();}
}
async function showSnapshot(evidence,assessment){
  const target=el("evidenceSnapshot");target.textContent="Loading matching files at the pinned checkpoint…";
  try{
    const snapshot=await loadReviewSnapshot(evidence.repository,evidence.checkpointSha,assessment,{token:localStorage.getItem("Adminerva_github_token"),fetchImpl:requests?.fetch||globalThis.fetch});
    if(state.evidence!==evidence)return;
    target.replaceChildren();add(target,"p",snapshot.paths.length+" matching files at checkpoint "+evidence.checkpointSha.slice(0,12)+". Shared source is project context, not individual credit.","text-xs font-semibold");
    for(const file of snapshot.files){const details=add(target,"details","","border rounded p-2 mt-2");add(details,"summary",file.path,"font-mono text-xs cursor-pointer");add(details,"pre",file.error||file.text,"whitespace-pre-wrap break-words text-xs max-h-64 overflow-auto mt-2");}
    if(snapshot.partial)add(target,"p","Partial preview: at most 12 files and 30 KB per file. Unshown or unreadable files are not missing screens. Inspect remaining files at the pinned repository link.","text-xs text-amber-900 mt-2");
  }catch(error){if(state.evidence===evidence)target.textContent="Pinned source preview unavailable: "+error.message+" No conclusion about missing work can be drawn.";}
}
async function renderClaims(){
  const target=el("evidenceReclaims");target.replaceChildren();
  if(!state.claims.length){add(target,"p","No reclaim requests for this student's assessment.","text-sm text-slate-600");return;}
  const mayDecide=state.claims.some(c=>c.status==="pending") &&
    await resolveStaffRole(auth.currentUser)==="admin";
  for(const claim of state.claims){
    const box=add(target,"div","","border rounded-lg p-3");
    add(box,"p",claim.sha.slice(0,12)+" — "+claim.status,"text-sm font-bold");
    add(box,"p","Detected Git author: "+claim.detectedAuthorName+
      (claim.detectedAuthorLogin?" (@"+claim.detectedAuthorLogin+")":""),
      "text-xs text-slate-600");
    add(box,"p",claim.explanation,"text-sm mt-1 whitespace-pre-wrap");
    if(claim.status!=="pending")continue;
    if(!mayDecide){
      add(box,"p","Administrator decision required. Teachers can inspect the claim, but cannot decide it.","text-xs text-amber-700 mt-1");continue;
    }
    const group=add(box,"div","","flex flex-wrap gap-2 mt-2");
    for(const [result,label] of [["approved","Approve reclaim"],["shared","Accept shared contribution"],["rejected","Reject reclaim"]]){
      const b=add(group,"button",label,"rounded bg-slate-800 text-white text-xs px-3 py-2");
      b.type="button";b.addEventListener("click",()=>{void decideClaim(claim,result);});
    }
    const conflict=add(box,"button","Find other claims for this commit","text-xs text-indigo-700 underline mt-3");
    conflict.type="button";conflict.addEventListener("click",()=>{void showConflicts(claim.sha,box);});
  }
}
async function showConflicts(sha,box){
  try{
    const snap=await getDocs(query(collection(db,"commit_reclaims"),where("sha","==",sha)));
    const results=snap.docs.map(d=>d.data()).filter(c=>c.repository===state.evidence.repository);
    add(box,"p","Claim records for this commit: "+results.length+
      " ("+results.map(x=>x.studentId+": "+x.status).join("; ")+")",
      "text-xs text-amber-900 break-words mt-2");
  }catch(e){status("Unable to check overlapping claims: "+e.message);}
}
async function decideClaim(claim,decision){
  if(await resolveStaffRole(auth.currentUser)!=="admin")return status("Administrator access is required to decide reclaims.");
  const explanation=prompt("Administrative decision note (10–2,000 characters; recorded permanently):");
  if(explanation===null)return;
  const end=window.beginLoading?.("Recording commit attribution decision…")||(()=>{});
  try{
    status("Recording audited reclaim decision…");
    await decideReclaim({claimId:claim.id,decision,reason:explanation});
    status("Reclaim decision recorded. Student evidence and grades have not been changed.");
    await loadEvidence();
  }catch(e){status("Unable to decide reclaim: "+e.message);}finally{end();}
}
async function verifyAncestry(repo,checkpoint,selected){
  const result=await verifyCheckpointAncestry({
    selectedCommits:selected,checkpointSha:checkpoint,
    fetchPage:page=>github(api(repo)+"/commits?sha="+encodeURIComponent(checkpoint)+"&per_page=100&page="+page)
  });
  if(result.ok)return;
  throw Error("Project checkpoint "+checkpoint.slice(0,12)+" does not contain selected evidence commit"+(result.missing.length===1?" ":"s ")+result.missing.map(sha=>sha.slice(0,12)).join(", ")+". Reopen the submission so the student can choose a newer project checkpoint.");
}
async function approve(){
  if(state.busy||!state.loaded||(!["submitted","needs_review"].includes(state.evidence?.status)&&!(state.evidence?.status==="approved"&&state.verificationEditing)))return;
  const opened=state.evidence;
  const sequence=state.sequence,studentId=state.student.id,assessmentId=state.assessment.id;
  const note=el("evidenceReviewNote").value.trim()||"Teacher inspected the selected changes and project checkpoint before approving this evidence.";
  if(note.length>3000||!el("evidenceConfirm").checked){
    status("Confirm that you inspected the selected evidence before approving.");return;
  }
  const pending=new Set(state.claims.filter(c=>c.status==="pending").map(c=>c.sha));
  if(state.evidence.selectedCommits.some(sha=>pending.has(sha))){
    status("Resolve pending reclaim requests involving selected commits before approving.");return;
  }
  state.busy=true;el("evidenceApprove").disabled=true;
  const end=window.beginLoading?.("Verifying selected commits and approving checkpoint…",el("evidenceDetails"))||(()=>{});
  try{
    const repo=parseRepository(state.evidence.repository);
    const selection=normalizeSelection(state.evidence.selectedCommits,state.evidence.checkpointSha,{allowEmpty:state.evidence.source==="teacher_discovered"});
    const verified=[...root.querySelectorAll("[data-contribution-sha]:checked")].map(node=>node.dataset.contributionSha);
    const rejected=new Set(state.claims.filter(claim=>claim.status==="rejected").map(claim=>claim.sha));
    if(verified.some(sha=>rejected.has(sha)))
      throw Error("A rejected attribution claim is selected for individual credit. Refresh review and remove it before approval.");
    const scope=el("evidenceContributionScope").value.trim()||(verified.length?"Instructor verified "+verified.length+" selected commit(s) for "+(state.student.name||state.student.id)+" at checkpoint "+selection.checkpointSha+". Individual review is limited to these selected changes; shared project features are context only.":"No individual contributing commits were verified. This checkpoint approval records shared project context only.");
    const contribution=approvalContribution(selection,verified,scope);
    status("Checking for competing pending reclaim requests…");
    await Promise.all(selection.selectedCommits.map(async sha=>{
      const reviewerRole=await resolveStaffRole(auth.currentUser);
      const claimQuery=reviewerRole==="admin"
        ?query(collection(db,"commit_reclaims"),where("sha","==",sha))
        :query(collection(db,"commit_reclaims"),where("section","==",state.evidence.section));
      const competing=await getDocs(claimQuery);
      if(competing.docs.some(d=>d.data().sha===sha &&
        d.data().repository===state.evidence.repository&&d.data().status==="pending"))
        throw Error("A selected commit has an unresolved reclaim request. Ask the administrator to review the attribution before approving this student's checkpoint.");
    }));
    status("Verifying checkpoint ancestry with GitHub…");
    await verifyAncestry(repo,selection.checkpointSha,selection.selectedCommits);
    if(destroyed||sequence!==state.sequence)return;
    const ref=doc(db,"assessment_evidence",studentId+"_"+assessmentId);
    await changeEvidence(ref,opened,{status:"approved",reviewedBy:auth.currentUser.uid,
        reviewedAt:serverTimestamp(),verificationNote:note,
        approvedCheckpointSha:selection.checkpointSha,...contribution},note);
    await loadEvidence();
    notifyWorkspace();
    status(contribution.verifiedContributionCommits.length?"Checkpoint approved and the review controls refreshed. Evaluate is available for verified individual contributions; grades remain unpublished.":"Checkpoint approved with no verified individual contributions. No shared-project credit is inferred; use manual review. Grades remain unpublished.");
  }catch(e){if(e.code==="evidence-changed")state.loaded=false;status("Approval failed: "+e.message);}
  finally{end();state.busy=false;el("evidenceApprove").disabled=!state.loaded||(!["submitted","needs_review"].includes(state.evidence?.status)&&!(state.evidence?.status==="approved"&&state.verificationEditing));}
}
async function reopen(){
  if(state.busy||!state.loaded||!["submitted","approved","needs_review"].includes(state.evidence?.status)){status("This evidence cannot be returned from its current state. Reload evidence and try again.");return;}
  const reason=el("evidenceReviewNote").value.trim();
  if(reason.length<15||reason.length>3000)return status("Enter a reopening reason of 15–3,000 characters in the teacher review note.");
  const proposal=state.evidence.status==="needs_review";
  const submitted=state.evidence.status==="submitted";
  if(!confirm(proposal
    ?"Allow this student to replace the proposed evidence with their own commit selection? The proposal remains in audit history and the student must submit again."
    :submitted
      ?"Return this submission to the student for changes? The current evidence remains in audit history and the student must resubmit."
      :"Reopen this approved evidence for student changes? The approval is revoked, existing draft grades require fresh review, and prior evidence is retained."))return;
  state.busy=true;
  const end=window.beginLoading?.("Reopening learner evidence…",el("evidenceDetails"))||(()=>{});
  try{
    await changeEvidence(doc(db,"assessment_evidence",state.student.id+"_"+state.assessment.id),state.evidence,{
      status:"reopened",approvedCheckpointSha:null,verifiedContributionCommits:[],contributionScope:"",
      reviewedBy:null,reviewedAt:null,verificationNote:"",
      reopenedBy:auth.currentUser.uid,reopenedAt:serverTimestamp(),reopenReason:reason
    },reason);
    await loadEvidence();notifyWorkspace();status("Reopened for student changes. A new submission and approval are required before grading.");
  }catch(error){status("Unable to reopen: "+error.message);}
  finally{state.busy=false;end();}
}

async function findHistoricalCommits({preserve=false}={}){
  const student=state.student;if(!student)return status("Choose student and assessment.");
  const sequence=++discovery.sequence;
  discovery.loading=true;discovery.hasOlder=false;updateDiscoveryPaging();
  const end=window.beginLoading?.(discovery.mode==="augment"?"Loading commits for attribution review…":"Finding historical repository commits…")||(()=>{});
  try{
    const repo=parseRepository(student.repoUrl);
    const info=await github(api(repo));
    if(sequence!==discovery.sequence)return;
    const branch=String(info.default_branch||"main");
    const commits=await github(commitPagePath(api(repo),1,{branch}));
    if(sequence!==discovery.sequence)return;
    discovery.commits=appendUniqueCommits([],commits);
    if(!preserve){discovery.selected=new Set();discovery.locked=new Set();discovery.checkpoint="";}
    discovery.page=1;discovery.branch=branch;
    discovery.hasOlder=hasOlderCommitPage(1,commits.length);
    updateDiscoveryPaging();renderHistorical();
    status("Showing "+discovery.commits.length+" commits. Use Load older commits for earlier work; Git author dates are not verified push dates.");
  }catch(error){if(sequence===discovery.sequence)status("Historical discovery failed: "+error.message);}
  finally{end();if(sequence===discovery.sequence){discovery.loading=false;updateDiscoveryPaging()}}
}
async function loadOlderHistorical(){
  if(discovery.loading||!discovery.hasOlder||!state.student)return;
  discovery.loading=true;updateDiscoveryPaging();
  const end=window.beginLoading?.("Loading older historical commits…")||(()=>{});
  const sequence=discovery.sequence;
  try{
    const repo=parseRepository(state.student.repoUrl);
    const page=discovery.page+1;
    const batch=await github(commitPagePath(api(repo),page,{branch:discovery.branch}));
    if(sequence!==discovery.sequence)return;
    discovery.commits=appendUniqueCommits(discovery.commits,batch);
    discovery.page=page;
    discovery.hasOlder=hasOlderCommitPage(page,batch.length);
    renderHistorical();
    status("Showing "+discovery.commits.length+" unique commits. Existing selected evidence is preserved."+
      (!discovery.hasOlder&&batch.length===100?" History limit reached; inspect GitHub manually for earlier commits.":""));
  }catch(error){if(sequence===discovery.sequence)status("Could not load older history: "+error.message)}
  finally{end();if(sequence===discovery.sequence){discovery.loading=false;updateDiscoveryPaging()}}
}
function renderHistorical(){
  const list=el("evidenceDiscoverList");list.replaceChildren();
  for(const commit of discovery.commits){
    const sha=String(commit.sha||"").toLowerCase();if(!validSha(sha))continue;
    const row=add(list,"div","","p-3 border rounded-lg");
    const line=add(row,"div","","flex flex-wrap items-center gap-3");
    const check=document.createElement("input");check.type="checkbox";
    const locked=discovery.locked.has(sha);
    check.checked=discovery.selected.has(sha);
    check.disabled=locked;
    check.setAttribute("aria-label",(locked?"Already selected commit ":"Select commit ")+sha.slice(0,12)+" as evidence");
    check.addEventListener("change",()=>{if(check.checked)discovery.selected.add(sha);
      else{discovery.selected.delete(sha);if(discovery.checkpoint===sha)discovery.checkpoint="";}
      renderHistorical();});
    line.append(check);
    if(locked)add(line,"span","Already selected","text-[11px] font-bold text-slate-500");
    const radio=document.createElement("input");radio.type="radio";
    radio.name="historicalCheckpoint";radio.checked=discovery.checkpoint===sha;
    radio.setAttribute("aria-label","Use "+sha.slice(0,12)+" as project checkpoint");
    radio.addEventListener("change",()=>{discovery.checkpoint=sha;renderHistorical();});
    line.append(radio);
    add(line,"span",sha.slice(0,12),"text-xs font-mono text-indigo-700");
    add(line,"strong",String(commit.commit?.message||"").split("\n")[0].slice(0,180),
      "text-xs break-words");
    const detectedLogin=String(commit.author?.login||"").toLowerCase();
    const expectedLogin=String(state.student?.githubUsername||"").replace(/^@/,"").toLowerCase();
    add(row,"p",(commit.commit?.author?.name||"Unknown author")+" · "+
      (commit.author?.login?"@"+commit.author.login:"GitHub login unknown"),
      "text-xs text-slate-600 mt-2");
    if(discovery.mode==="augment"&&(!detectedLogin||!expectedLogin||detectedLogin!==expectedLogin))
      add(row,"p","Identity differs from the learner's linked GitHub account. Inspect the diff before attributing this commit.","text-xs font-semibold text-amber-800 mt-1");
    const preview=add(row,"button","Preview changed files","text-xs text-indigo-700 underline mt-2");
    preview.type="button";
    preview.addEventListener("click",()=>{void previewCommit(parseRepository(state.student.repoUrl),sha,row,preview);});
  }
}
async function startAttributionOverride(){
  const evidence=state.evidence;
  if(state.busy||!evidence||!["submitted","needs_review","approved"].includes(evidence.status))
    return status("Commit attribution can only be amended while evidence is submitted, awaiting review, or approved.");
  configureDiscovery("augment");
  discovery.commits=[];
  discovery.selected=new Set(evidence.selectedCommits||[]);
  discovery.locked=new Set(evidence.selectedCommits||[]);
  discovery.checkpoint=evidence.checkpointSha||"";
  discovery.page=0;discovery.hasOlder=false;discovery.branch="";
  el("evidenceDiscoveryNote").value="";
  el("evidenceDiscoverList").replaceChildren();
  el("evidenceDiscovery").classList.remove("hidden");
  el("evidenceDiscovery").scrollIntoView({behavior:"smooth",block:"start"});
  await findHistoricalCommits({preserve:true});
}
async function saveDiscovery(){
  const student=state.student,assessment=state.assessment;
  if(!student||!assessment)return status("Choose a student and assessment.");
  try{
    const selection=normalizeSelection([...discovery.selected],discovery.checkpoint);
    if(!discovery.commits.some(c=>String(c.sha||"").toLowerCase()===selection.checkpointSha))
      throw Error("Checkpoint must belong to the retrieved repository commits.");
    if(discovery.mode==="augment"){
      const opened=state.evidence;
      if(!opened||!["submitted","needs_review","approved"].includes(opened.status))
        throw Error("Current evidence changed. Refresh before adding an unmatched commit.");
      const existing=new Set(opened.selectedCommits||[]);
      if([...existing].some(sha=>!selection.selectedCommits.includes(sha)))
        throw Error("Teacher attribution may add commits but cannot remove the learner's existing selected evidence.");
      const added=selection.selectedCommits.filter(sha=>!existing.has(sha));
      if(!added.length)throw Error("Select at least one additional repository commit to attribute.");
      const note=el("evidenceDiscoveryNote").value.trim();
      if(note.length<10||note.length>3000)
        throw Error("Enter a teacher attribution note of 10–3,000 characters explaining why the added commit belongs to this learner.");
      if(!confirm("Add "+added.length+" inspected commit"+(added.length===1?"":"s")+" to this learner's evidence? This records an audited teacher attribution amendment. The commit still requires contribution verification before evaluation."))return;
      const endLoading=window.beginLoading?.("Saving teacher-attributed commit evidence…",el("evidenceDiscovery"))||(()=>{});
      try{
        const repo=parseRepository(opened.repository);
        status("Checking that the selected checkpoint contains all evidence commits…");
        await verifyAncestry(repo,selection.checkpointSha,selection.selectedCommits);
        const changes={selectedCommits:selection.selectedCommits,checkpointSha:selection.checkpointSha,status:"needs_review"};
        if(opened.status==="approved")Object.assign(changes,{
          approvedCheckpointSha:null,verifiedContributionCommits:[],contributionScope:"",
          reviewedBy:null,reviewedAt:null,verificationNote:""
        });
        await changeEvidence(doc(db,"assessment_evidence",student.id+"_"+assessment.id),opened,changes,note);
        discovery.mode="create";discovery.locked=new Set();el("evidenceDiscovery").classList.add("hidden");
        await loadEvidence();notifyWorkspace();
        status("Teacher-attributed commit added. Inspect and verify the added commit below, then approve the checkpoint before evaluation.");
      }finally{endLoading();}
      return;
    }
    if(!confirm("Record historical evidence for "+student.name+
      "? This is NOT a student submission, a verified push time, or an approved checkpoint."))return;
    const endLoading=window.beginLoading?.("Saving proposed historical evidence…")||(()=>{});
    try{
      const ref=doc(db,"assessment_evidence",student.id+"_"+assessment.id);
      await runTransaction(db,async tx=>{
        const existing=await tx.get(ref);
        if(existing.exists())throw Error("Evidence was submitted or discovered by someone else. Reload it.");
        tx.set(ref,{
          studentId:student.id,assessmentId:assessment.id,section:student.section,
          repository:student.repoUrl,selectedCommits:selection.selectedCommits,
          checkpointSha:selection.checkpointSha,status:"needs_review",
          source:"teacher_discovered",discoveredBy:auth.currentUser.uid,
          recordedAt:serverTimestamp(),updatedAt:serverTimestamp()
        });
      });
      await loadEvidence();
      status("Historical candidate evidence saved. Independently verify before approving; no submission date was asserted.");
    }finally{endLoading();}
  }catch(error){status("Unable to save evidence: "+error.message);}
}

el("evidenceEditVerification").addEventListener("click",()=>{
  if(state.busy||state.evidence?.status!=="approved")return;
  state.verificationEditing=true;state.editing=true;
  el("evidenceContributionScope").disabled=false;
  const rejectedClaims=new Set(state.claims.filter(claim=>claim.status==="rejected").map(claim=>claim.sha));
  for(const input of root.querySelectorAll("[data-contribution-sha]"))
    input.disabled=rejectedClaims.has(input.dataset.contributionSha);
  el("evidenceVerifyAll").disabled=false;syncBulkVerification();
  el("evidenceApprove").disabled=false;el("evidenceApprove").textContent="Save revised verification";
  el("evidenceReviewNote").value="";el("evidenceConfirm").checked=false;
  status("Verify only this student's changes, describe responsibilities and enter a fresh review note. Saving creates an audit revision and invalidates earlier drafts. Published grades must be unpublished first. Student-selected commits stay unchanged.");
  el("evidenceContributionScope").focus();
});
function reloadEvidence(){
  if(state.busy)return;
  if(state.editing&&!confirm("Refresh current evidence from the server? Unsaved contribution verification and review notes will be discarded. Grade fields remain unchanged."))return;
  state.editing=false;
  stopEvidence?.();resolveInitial?.(null);clearTimeout(initialTimer);stopEvidence=null;
  void window.withLoading("Checking latest student evidence status…",loadEvidence);
}
el("evidenceReload").addEventListener("click",reloadEvidence);
el("evidenceReloadTop").addEventListener("click",reloadEvidence);
root.addEventListener("input",event=>{if(event.target.closest?.("#evidenceDetails,#evidenceDiscovery"))state.editing=true;});
el("evidenceVerifyAll").addEventListener("change",()=>{
  for(const input of root.querySelectorAll("[data-contribution-sha]"))if(!input.disabled)input.checked=el("evidenceVerifyAll").checked;
  state.editing=true;syncBulkVerification();
});
root.addEventListener("change",event=>{
  if(event.target?.matches?.("[data-contribution-sha]")){state.editing=true;syncBulkVerification();}
});
el("evidenceFindCommits").addEventListener("click",()=>{void findHistoricalCommits({preserve:discovery.mode==="augment"});});
el("evidenceFindOlder")?.addEventListener("click",()=>{void loadOlderHistorical();});
el("evidenceSaveDiscovery").addEventListener("click",()=>{void saveDiscovery();});
el("evidenceAddCommit")?.addEventListener("click",()=>{void startAttributionOverride();});
el("evidenceStudentSearch")?.addEventListener("input",()=>renderStudentSearch());
el("evidenceSection")?.addEventListener("change",()=>renderStudentSearch());
el("evidenceLoad")?.addEventListener("click",()=>{if(state.editing&&!confirm("Discard unsaved review text and load the selected evidence?"))return;void loadEvidence();});
el("evidenceApprove").addEventListener("click",()=>{void approve();});
el("evidenceReopen").addEventListener("click",()=>{void reopen();});

return {load:loadEvidence,loadDirectory,startAttributionOverride:()=>startAttributionOverride(),focusReview(){
  configureDiscovery("create");
  el("evidenceDiscovery").classList.add("hidden");
  el("evidenceDetails").classList.remove("hidden");
  el("evidenceDetails").scrollIntoView({behavior:"smooth",block:"start"});
  status("Review the selected commits, verify the learner's contribution, then approve this evidence revision.");
},hasUnsavedChanges:()=>state.editing,destroy(){destroyed=true;stopEvidence?.();resolveInitial?.(null);clearTimeout(initialTimer);state.sequence++;state.loaded=false;state.evidence=null;discovery.sequence++;}};
}

if(document.getElementById("evidenceWorkspace")){
  document.getElementById("evidenceWorkspace").innerHTML=evidenceReviewMarkup;
  const review=createEvidenceReview();
  onAuthStateChanged(auth,async user=>{
  if(!await resolveStaffRole(user)){
    document.getElementById("evidenceReviewStatus").textContent="Authorized teacher or administrator sign-in required.";return;
  }
  void review.loadDirectory().catch(error=>{document.getElementById("evidenceReviewStatus").textContent="Directory failed: "+error.message;});
});
}
