import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.0";
/** Instructor checkpoint approval, reopening and contribution verification. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,doc,getDoc,getDocFromServer,getDocs,setDoc,query,where,updateDoc,runTransaction,serverTimestamp,onSnapshot}
  from "../core/teaching-firestore.mjs?v=1.3.0";
import {parseRepository,normalizeSelection,validSha}
  from "./services/assessment-evidence.mjs?v=1.3.1";
import {commitPagePath,appendUniqueCommits,hasOlderCommitPage,verifyCheckpointAncestry} from "./services/commit-history.mjs?v=1.3.1";
import {approvalContribution,sameEvidence} from "./services/evidence-lifecycle.mjs?v=1.3.1";
import {changeEvidence} from "./services/evidence-transaction.mjs?v=1.3.0";
import {loadReviewSnapshot} from "./services/review-snapshot.mjs?v=1.3.0";

import {evidenceReviewMarkup} from "./evidence-review-view.mjs?v=1.3.2";
import {searchStudents} from "./services/student-search.mjs?v=1.3.0";

export function createEvidenceReview({root=document,inlineContext=null,requests=null,onChange=()=>{}}={}){
const ADMIN="babaynike2013@gmail.com";
const el=id=>root.querySelector("#"+id);
const state={students:[],assessments:[],evidence:null,student:null,assessment:null,claims:[],loaded:false,busy:false,sequence:0,editing:false,verificationEditing:false};
let stopEvidence=null,watchedId=null,destroyed=false,resolveInitial=null,initialTimer=null,initialSnapshot=null,hasServerSnapshot=false;
const discovery={commits:[],selected:new Set(),checkpoint:"",page:0,hasOlder:false,loading:false,sequence:0,branch:""};
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
function add(parent,tag,text,style=""){
  const x=document.createElement(tag);x.textContent=String(text??"");if(style)x.className=style;
  parent.append(x);return x;
}
function status(t){if(el("evidenceReviewStatus"))el("evidenceReviewStatus").textContent=t;if(el("evidenceActionStatus"))el("evidenceActionStatus").textContent=t;}
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
          status("Evidence changed in another session. Your review text is kept. Select Reload evidence before approving; nothing was overwritten.");
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
      el("evidenceDiscovery").classList.remove("hidden");
      el("evidenceDiscoverList").replaceChildren();
      discovery.commits=[];discovery.selected=new Set();discovery.checkpoint="";
      status("No student submission. You may discover historical commits without changing the student's GitHub history.");
      return;
    }
    const evidence=record;
    normalizeSelection(evidence.selectedCommits,evidence.checkpointSha,{allowEmpty:evidence.source==="teacher_discovered"});
    if(evidence.studentId!==student.id||evidence.assessmentId!==assessment.id||
       evidence.repository!==student.repoUrl)throw Error("Submission identity or repository does not match the roster.");
    state.evidence=evidence;
    const previews=[showSnapshot(evidence,assessment)];
    el("evidenceContributionScope").value=evidence.contributionScope||"";
    el("evidenceContributionScope").disabled=evidence.status==="approved";
    el("evidenceReviewNote").value="";el("evidenceConfirm").checked=false;
    const claims=await getDocs(query(collection(db,"commit_reclaims"),where("studentId","==",student.id)));
    if(destroyed||sequence!==state.sequence)return;
    state.claims=claims.docs.filter(d=>d.data().repository===evidence.repository &&
      evidence.selectedCommits.includes(d.data().sha)).map(d=>({id:d.id,...d.data()}));
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
    const priorVerified=new Set(evidence.verifiedContributionCommits||[]);
    for(const sha of evidence.selectedCommits){
      const p=add(rows,"div","","rounded-lg border p-3 flex flex-wrap items-center gap-3");
      link(p,sha.slice(0,12)+" · View on GitHub ↗",base+"/commit/"+encodeURIComponent(sha));
      const preview=add(p,"button","Preview changes","text-xs underline text-indigo-700");
      preview.type="button";
      preview.addEventListener("click",()=>{void previewCommit(repo,sha,p);});
      const label=add(checks,"label","","flex gap-2 items-start text-xs rounded border p-2");
      const verified=document.createElement("input");verified.type="checkbox";
      verified.dataset.contributionSha=sha;
      verified.checked=priorVerified.has(sha);
      verified.disabled=evidence.status==="approved";
      label.append(verified);add(label,"span",sha.slice(0,12)+" · verify this selected commit for individual credit");
    }
    syncBulkVerification();
    await renderClaims();
    if(destroyed||sequence!==state.sequence)return;
    el("evidenceApprove").disabled=!["submitted","needs_review"].includes(evidence.status);
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
    el("evidenceContributionScope").disabled=evidence.status==="approved";
    el("evidenceReviewNote").disabled=false;el("evidenceConfirm").disabled=false;el("evidenceVerifyAll").disabled=evidence.status==="approved";el("evidenceEditVerification").disabled=false;
    status(evidence.selectedCommits.length
      ?"Loaded "+evidence.selectedCommits.length+" selected commits. Approval will verify checkpoint ancestry and the contribution choices."
      :"Loaded a checkpoint-only teacher snapshot. No individual commit is attributed to this learner; you may approve the checkpoint as project context, but system evaluation remains unavailable until individual contribution is verified.");
    if(evidence.status==="reopened")status("Reopened: the student can change commit selections now. They must resubmit before a new approval. Contribution checks here verify authorship; they do not edit the student's selected commits.");
    else if(evidence.status==="submitted")status("Student evidence is awaiting review. If approval fails or the selection needs correction, enter a reason below and choose Return for student changes.");
    else if(evidence.status==="approved")status(evidence.verifiedContributionCommits?.length?"Approved. To let the student submit different commits, enter a reopening reason below and choose Reopen for student changes.":"Approved checkpoint has no verified individual contributions. To let the student change commits, enter a reopening reason below and choose Reopen for student changes.");
    else if(evidence.status==="needs_review")status("This is an instructor-discovered evidence proposal, so the student cannot edit it yet. To let the student choose different commits and a new checkpoint, enter a reason below and choose Reopen for student changes.");
    void Promise.all(previews);
  }catch(error){if(!destroyed&&sequence===state.sequence)status("Unable to load evidence: "+error.message);}
}
async function previewCommit(repo,sha,row){
  let box=row.querySelector("pre");
  if(!box)box=add(row,"pre","","whitespace-pre-wrap break-words text-xs bg-slate-50 p-3 mt-3");
  box.textContent="Loading commit diffs…";
  try{
    const data=await github(api(repo)+"/commits/"+sha+"?per_page=100");
    const details=["Message: "+(data.commit?.message||""),
      "Git author: "+(data.commit?.author?.name||"Unknown"),
      "GitHub account: "+(data.author?.login||"Unknown"),
      "Changed files: "+(data.files?.length||0)];
    for(const f of (data.files||[]).slice(0,30))
      details.push("\n--- "+f.filename+" ---\n"+
        (typeof f.patch==="string"?f.patch.slice(0,5000):"Binary or unavailable diff"));
    box.textContent=details.join("\n");
  }catch(e){box.textContent="Unable to preview commit: "+e.message;}
}
async function showSnapshot(evidence,assessment){
  const target=el("evidenceSnapshot");target.textContent="Loading matching files at the pinned checkpoint…";
  try{
    const snapshot=await loadReviewSnapshot(evidence.repository,evidence.checkpointSha,assessment,{token:localStorage.getItem("Adminerva_github_token"),fetchImpl:requests?.fetch||globalThis.fetch});
    if(state.evidence!==evidence)return;
    target.replaceChildren();add(target,"p",snapshot.paths.length+" matching files at checkpoint "+evidence.checkpointSha.slice(0,12)+". Shared source is project context, not individual credit.","text-xs font-semibold");
    for(const file of snapshot.files){const details=add(target,"details","","border rounded p-2 mt-2");details.open=true;add(details,"summary",file.path,"font-mono text-xs cursor-pointer");add(details,"pre",file.error||file.text,"whitespace-pre-wrap break-words text-xs max-h-64 overflow-auto mt-2");}
    if(snapshot.partial)add(target,"p","Partial preview: at most 12 files and 30 KB per file. Unshown or unreadable files are not missing screens. Inspect remaining files at the pinned repository link.","text-xs text-amber-900 mt-2");
  }catch(error){if(state.evidence===evidence)target.textContent="Pinned source preview unavailable: "+error.message+" No conclusion about missing work can be drawn.";}
}
async function renderClaims(){
  const target=el("evidenceReclaims");target.replaceChildren();
  if(!state.claims.length){add(target,"p","No reclaim requests for this student's assessment.","text-sm text-slate-600");return;}
  for(const claim of state.claims){
    const box=add(target,"div","","border rounded-lg p-3");
    add(box,"p",claim.sha.slice(0,12)+" — "+claim.status,"text-sm font-bold");
    add(box,"p","Detected Git author: "+claim.detectedAuthorName+
      (claim.detectedAuthorLogin?" (@"+claim.detectedAuthorLogin+")":""),
      "text-xs text-slate-600");
    add(box,"p",claim.explanation,"text-sm mt-1 whitespace-pre-wrap");
    if(claim.status!=="pending")continue;
    if((auth.currentUser?.email||"").toLowerCase()!==ADMIN){
      add(box,"p","Pending administrator decision.","text-xs text-amber-700 mt-1");continue;
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
  const explanation=prompt("Administrative decision note (required; visible in audit history):");
  if(explanation===null)return;
  if(explanation.trim().length<10||explanation.length>2000){
    status("A decision reason of 10–2,000 characters is required.");return;
  }
  try{
    const ref=doc(db,"commit_reclaims",claim.id);
    const audit=doc(collection(db,"commit_claim_decisions"));
    await runTransaction(db,async tx=>{
      const current=await tx.get(ref);
      if(!current.exists()||current.data().status!=="pending")throw Error("Claim changed. Reload review.");
      tx.update(ref,{status:decision,reviewedBy:auth.currentUser.uid,
        reviewedAt:serverTimestamp(),reviewNote:explanation.trim()});
      tx.set(audit,{claimId:claim.id,studentId:claim.studentId,
        repository:claim.repository,sha:claim.sha,decision,
        reviewerUid:auth.currentUser.uid,reason:explanation.trim(),
        createdAt:serverTimestamp()});
    });
    status("Reclaim decision recorded; grade and Git history were not modified.");
    await loadEvidence();
  }catch(e){status("Unable to decide claim: "+e.message);}
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
  try{
    const repo=parseRepository(state.evidence.repository);
    const selection=normalizeSelection(state.evidence.selectedCommits,state.evidence.checkpointSha,{allowEmpty:state.evidence.source==="teacher_discovered"});
    const verified=[...root.querySelectorAll("[data-contribution-sha]:checked")].map(node=>node.dataset.contributionSha);
    const scope=el("evidenceContributionScope").value.trim()||(verified.length?"Instructor verified "+verified.length+" selected commit(s) for "+(state.student.name||state.student.id)+" at checkpoint "+selection.checkpointSha+". Individual review is limited to these selected changes; shared project features are context only.":"No individual contributing commits were verified. This checkpoint approval records shared project context only.");
    const contribution=approvalContribution(selection,verified,scope);
    status("Checking for competing pending reclaim requests…");
    await Promise.all(selection.selectedCommits.map(async sha=>{
      const competing=await getDocs(query(collection(db,"commit_reclaims"),where("sha","==",sha)));
      if(competing.docs.some(d=>d.data().repository===state.evidence.repository&&
        d.data().status==="pending"))
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
  finally{state.busy=false;el("evidenceApprove").disabled=!state.loaded||(!["submitted","needs_review"].includes(state.evidence?.status)&&!(state.evidence?.status==="approved"&&state.verificationEditing));}
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
  try{
    await changeEvidence(doc(db,"assessment_evidence",state.student.id+"_"+state.assessment.id),state.evidence,{
      status:"reopened",approvedCheckpointSha:null,verifiedContributionCommits:[],contributionScope:"",
      reopenedBy:auth.currentUser.uid,reopenedAt:serverTimestamp(),reopenReason:reason
    },reason);
    await loadEvidence();notifyWorkspace();status("Reopened for student changes. A new submission and approval are required before grading.");
  }catch(error){status("Unable to reopen: "+error.message);}
  finally{state.busy=false;}
}

async function findHistoricalCommits(){
  const student=state.student;if(!student)return status("Choose student and assessment.");
  const sequence=++discovery.sequence;
  discovery.loading=true;discovery.hasOlder=false;updateDiscoveryPaging();
  try{
    const repo=parseRepository(student.repoUrl);
    const info=await github(api(repo));
    if(sequence!==discovery.sequence)return;
    const branch=String(info.default_branch||"main");
    const commits=await github(commitPagePath(api(repo),1,{branch}));
    if(sequence!==discovery.sequence)return;
    discovery.commits=appendUniqueCommits([],commits);
    discovery.selected=new Set();discovery.checkpoint="";
    discovery.page=1;discovery.branch=branch;
    discovery.hasOlder=hasOlderCommitPage(1,commits.length);
    updateDiscoveryPaging();renderHistorical();
    status("Showing "+discovery.commits.length+" commits. Use Load older commits for earlier work; Git author dates are not verified push dates.");
  }catch(error){if(sequence===discovery.sequence)status("Historical discovery failed: "+error.message);}
  finally{if(sequence===discovery.sequence){discovery.loading=false;updateDiscoveryPaging()}}
}
async function loadOlderHistorical(){
  if(discovery.loading||!discovery.hasOlder||!state.student)return;
  discovery.loading=true;updateDiscoveryPaging();
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
  finally{if(sequence===discovery.sequence){discovery.loading=false;updateDiscoveryPaging()}}
}
function renderHistorical(){
  const list=el("evidenceDiscoverList");list.replaceChildren();
  for(const commit of discovery.commits){
    const sha=String(commit.sha||"").toLowerCase();if(!validSha(sha))continue;
    const row=add(list,"div","","p-3 border rounded-lg");
    const line=add(row,"div","","flex flex-wrap items-center gap-3");
    const check=document.createElement("input");check.type="checkbox";
    check.checked=discovery.selected.has(sha);
    check.setAttribute("aria-label","Select commit "+sha.slice(0,12)+" as historical evidence");
    check.addEventListener("change",()=>{if(check.checked)discovery.selected.add(sha);
      else{discovery.selected.delete(sha);if(discovery.checkpoint===sha)discovery.checkpoint="";}
      renderHistorical();});
    line.append(check);
    const radio=document.createElement("input");radio.type="radio";
    radio.name="historicalCheckpoint";radio.checked=discovery.checkpoint===sha;
    radio.setAttribute("aria-label","Use "+sha.slice(0,12)+" as project checkpoint");
    radio.addEventListener("change",()=>{discovery.checkpoint=sha;renderHistorical();});
    line.append(radio);
    add(line,"span",sha.slice(0,12),"text-xs font-mono text-indigo-700");
    add(line,"strong",String(commit.commit?.message||"").split("\n")[0].slice(0,180),
      "text-xs break-words");
    add(row,"p",(commit.commit?.author?.name||"Unknown author")+" · "+
      (commit.author?.login?"@"+commit.author.login:"GitHub login unknown"),
      "text-xs text-slate-600 mt-2");
    const preview=add(row,"button","Preview changed files","text-xs text-indigo-700 underline mt-2");
    preview.type="button";
    preview.addEventListener("click",()=>{void previewCommit(parseRepository(state.student.repoUrl),sha,row);});
  }
}
async function saveDiscovery(){
  const student=state.student,assessment=state.assessment;
  if(!student||!assessment)return status("Choose a student and assessment.");
  try{
    const selection=normalizeSelection([...discovery.selected],discovery.checkpoint);
    if(!discovery.commits.some(c=>String(c.sha||"").toLowerCase()===selection.checkpointSha))
      throw Error("Checkpoint must belong to the retrieved repository commits.");
    if(!confirm("Record historical evidence for "+student.name+
      "? This is NOT a student submission, a verified push time, or an approved checkpoint."))return;
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
  }catch(error){status("Unable to save historical evidence: "+error.message);}
}
el("evidenceEditVerification").addEventListener("click",()=>{
  if(state.busy||state.evidence?.status!=="approved")return;
  state.verificationEditing=true;state.editing=true;
  el("evidenceContributionScope").disabled=false;
  for(const input of root.querySelectorAll("[data-contribution-sha]"))input.disabled=false;
  el("evidenceVerifyAll").disabled=false;syncBulkVerification();
  el("evidenceApprove").disabled=false;el("evidenceApprove").textContent="Save revised verification";
  el("evidenceReviewNote").value="";el("evidenceConfirm").checked=false;
  status("Verify only this student's changes, describe responsibilities and enter a fresh review note. Saving creates an audit revision and invalidates earlier drafts. Published grades must be unpublished first. Student-selected commits stay unchanged.");
  el("evidenceContributionScope").focus();
});
el("evidenceReload").addEventListener("click",()=>{
  if(state.editing&&!confirm("Reload evidence and discard unsaved verification notes? Grade fields are kept separately."))return;
  stopEvidence?.();resolveInitial?.(null);clearTimeout(initialTimer);stopEvidence=null;void loadEvidence();
});
root.addEventListener("input",event=>{if(event.target.closest?.("#evidenceDetails,#evidenceDiscovery"))state.editing=true;});
el("evidenceVerifyAll").addEventListener("change",()=>{
  for(const input of root.querySelectorAll("[data-contribution-sha]"))if(!input.disabled)input.checked=el("evidenceVerifyAll").checked;
  state.editing=true;syncBulkVerification();
});
root.addEventListener("change",event=>{
  if(event.target?.matches?.("[data-contribution-sha]")){state.editing=true;syncBulkVerification();}
});
el("evidenceFindCommits").addEventListener("click",()=>{void findHistoricalCommits();});
el("evidenceFindOlder")?.addEventListener("click",()=>{void loadOlderHistorical();});
el("evidenceSaveDiscovery").addEventListener("click",()=>{void saveDiscovery();});
el("evidenceStudentSearch")?.addEventListener("input",()=>renderStudentSearch());
el("evidenceSection")?.addEventListener("change",()=>renderStudentSearch());
el("evidenceLoad")?.addEventListener("click",()=>{if(state.editing&&!confirm("Discard unsaved review text and load the selected evidence?"))return;void loadEvidence();});
el("evidenceApprove").addEventListener("click",()=>{void approve();});
el("evidenceReopen").addEventListener("click",()=>{void reopen();});

return {load:loadEvidence,loadDirectory,hasUnsavedChanges:()=>state.editing,destroy(){destroyed=true;stopEvidence?.();resolveInitial?.(null);clearTimeout(initialTimer);state.sequence++;state.loaded=false;state.evidence=null;discovery.sequence++;}};
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
