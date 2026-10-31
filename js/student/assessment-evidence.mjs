/** Committed-evidence selection, checkpoint provenance and evidence lifecycle. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {doc,getDoc,getDocs,setDoc,updateDoc,runTransaction,collection,query,where,serverTimestamp,onSnapshot}
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {parseRepository,normalizeSelection,evidenceSelectionGuidance,detectedAuthor,attributionLabel,claimDocumentId,validSha}
  from "../repo-review/services/assessment-evidence.mjs?v=1.3.3";
import {commitPagePath,appendUniqueCommits,hasOlderCommitPage,resolveSubmissionCheckpoint} from "../repo-review/services/commit-history.mjs?v=1.3.2";
import {studentMayChangeEvidence,sameEvidence} from "../repo-review/services/evidence-lifecycle.mjs?v=1.3.1";
import {changeEvidence} from "../repo-review/services/evidence-transaction.mjs?v=1.3.0";

const el=id=>document.getElementById(id);
let context=null,commits=[],selected=new Set(),checkpoint="",claims=new Map(),saved=null,loadSequence=0;
let historyPage=0,hasOlderCommits=false,historyLoading=false,historyHeadSha="",commitFilter="all",reclaimTarget=null,reclaimBusy=false;
let evidenceBusy=false;
let stopEvidence=null,stopClaims=null,selectionDirty=false,evidenceSyncing=true,claimsReadable=false;
const status=text=>{el("evidenceStatus").textContent=text;};
function stopLiveEvidence(){stopEvidence?.();stopEvidence=null;}
function stopLiveClaims(){stopClaims?.();stopClaims=null;}
function currentClaims(records,repository,assessmentId){
  return new Map(records.map(record=>({id:record.id,...record.data()}))
    .filter(claim=>claim.repository===repository&&claim.assessmentId===assessmentId)
    .map(claim=>[String(claim.sha||"").toLowerCase(),claim]));
}
function watchClaims(studentId,repository,assessmentId,sequence){
  stopLiveClaims();
  const owned=query(collection(db,"commit_reclaims"),where("studentId","==",studentId));
  stopClaims=onSnapshot(owned,{includeMetadataChanges:true},snapshot=>{
    if(sequence!==loadSequence||snapshot.metadata.hasPendingWrites)return;
    claimsReadable=!snapshot.metadata.fromCache;
    claims=currentClaims(snapshot.docs,repository,assessmentId);
    render();
    if(snapshot.metadata.fromCache)
      status("Checking current attribution-request status with the server. Reclaim actions resume when connected.");
  },error=>{
    if(sequence!==loadSequence)return;
    claimsReadable=false;render();
    status("Cannot verify attribution-request status: "+error.message+". Evidence selection is still available, but reclaim actions are disabled until refresh succeeds.");
  });
}
function watchEvidence(ref,sequence){
  stopLiveEvidence();
  const owned=query(collection(db,"assessment_evidence"),where("studentId","==",context.profile.id),where("assessmentId","==",context.task.id));
  stopEvidence=onSnapshot(owned,{includeMetadataChanges:true},snapshot=>{
    if(sequence!==loadSequence||snapshot.metadata.hasPendingWrites)return;
    evidenceSyncing=snapshot.metadata.fromCache;
    const record=snapshot.docs.find(item=>item.id===ref.id);
    const latest=record?record.data():null;
    const changed=Boolean(saved&&!sameEvidence(saved,latest));
    saved=latest;
    if(!selectionDirty){selected=new Set(saved?.selectedCommits||[]);checkpoint=saved?.checkpointSha||"";}
    for(const sha of [...selected,checkpoint].filter(validSha))if(!commits.some(commit=>commit.sha.toLowerCase()===sha))
      commits.push({sha,unavailable:true,commit:{message:"Saved evidence selection"}});
    render();
    if(evidenceSyncing)return status("Checking current evidence status with the server. Editing resumes when connected.");
    if(changed){
      status(saved?.status==="reopened"?"Your instructor reopened this evidence"+(saved.reopenReason?": "+saved.reopenReason:"")+". Change the commit checkboxes or checkpoint, then resubmit for fresh approval.":
        saved?.status==="approved"?"Checkpoint approved. Selection is protected until your instructor reopens it.":
        "Evidence status updated: "+(saved?.status||"not submitted")+". "+(selectionDirty?"Your unsaved selection was kept; review it before resubmitting.":"You can revise editable evidence."));
      window.dispatchEvent(new CustomEvent("adminerva:evidence-status",{detail:{assessmentId:context.task.id,studentId:context.profile.id,evidenceStatus:saved?.status||null}}));
    }
  },error=>{if(sequence===loadSequence){evidenceSyncing=true;render();status("Cannot verify evidence status: "+error.message+". Reconnect or reload before editing.");}});
}
function refreshHistoryControl(){
  const button=el("evidenceLoadOlder");
  if(!button)return;
  button.classList.toggle("hidden",!hasOlderCommits);
  button.disabled=historyLoading;
  button.textContent=historyLoading?"Loading older commits…":"Load older commits";
}
function add(parent,tag,text,className=""){
  const node=document.createElement(tag);node.textContent=String(text??"");
  if(className)node.className=className;parent.append(node);return node;
}
async function github(path){
  const headers={Accept:"application/vnd.github+json"};
  const token=String(context?.profile?.githubToken||"").trim();
  if(token)headers.Authorization="Bearer "+token;
  const response=await fetch("https://api.github.com"+path,{headers});
  if(!response.ok){
    const hint=response.status===401||response.status===403
      ?" Reconnect GitHub in your student settings and make sure the linked account can read this repository."
      :response.status===404?" Check the repository URL and the linked GitHub account's access.":"";
    throw Error("GitHub HTTP "+response.status+"."+hint);
  }
  return response.json();
}
const repositoryPath=r=>"/repos/"+encodeURIComponent(r.owner)+"/"+encodeURIComponent(r.repo);
function contextForStudent(){
  const data=window.__adminervaSubmissionContext?.(),user=auth.currentUser;
  if(!data?.profile||!data?.task||!user ||
    String(data.profile.email||"").toLowerCase()!==String(user.email||"").toLowerCase())
    throw Error("Select an assessment under your own signed-in student profile.");
  return data;
}
function render(){
  const list=el("evidenceCommitList");list.replaceChildren();
  el("evidenceSelectedCount").textContent=selected.size+" selected";
  for(const button of document.querySelectorAll("[data-evidence-filter]")){
    const active=button.dataset.evidenceFilter===commitFilter;
    button.setAttribute("aria-pressed",String(active));
    button.classList.toggle("bg-indigo-50",active);
    button.classList.toggle("border-indigo-400",active);
    button.classList.toggle("text-indigo-900",active);
    button.classList.toggle("border-slate-200",!active);
  }
  const editable=studentMayChangeEvidence(saved)&&!evidenceSyncing;
  el("evidenceEditability").textContent=evidenceSyncing?"Checking current server status…":evidenceBusy?"Saving evidence…":editable?
    "Editing enabled · "+(saved?.status==="reopened"?"Instructor reopened this evidence. Change the boxes and resubmit.":"Choose your commits and checkpoint, then submit."):
    saved?.status==="approved"?"Approved · Ask your instructor to reopen before changing selections.":"Instructor release required for this historical proposal.";
  el("evidenceSubmit").disabled=!editable||evidenceBusy;
  el("evidenceSubmit").textContent=evidenceBusy?"Saving evidence…":saved?"Resubmit selected evidence":"Submit selected evidence";
  el("evidenceWithdraw").disabled=!editable||!saved||saved.status==="withdrawn"||evidenceBusy||
    (saved.status==="reopened"&&!saved.selectedCommits?.length);
  if(el("evidenceClear"))el("evidenceClear").disabled=!editable||evidenceBusy;
  const guidance=evidenceSelectionGuidance([...selected],checkpoint);
  const summary=el("evidenceSelectionSummary");
  if(summary)summary.textContent=guidance.message;
  if(!commits.length){add(list,"p","No commits returned. The repository may be empty or inaccessible.");return;}
  const linked=String(context?.profile?.githubUsername||"").trim().replace(/^@/,"").toLowerCase();
  const visible=commits.filter(commit=>{
    const sha=String(commit.sha||"").toLowerCase();
    if(commitFilter==="selected")return selected.has(sha);
    if(commitFilter==="mine")return Boolean(linked)&&String(commit?.author?.login||"").toLowerCase()===linked ||
      ["pending","approved","shared"].includes(claims.get(sha)?.status);
    return true;
  });
  el("evidenceFilteredCount").textContent=visible.length+" of "+commits.length+" shown";
  if(!visible.length){
    add(list,"p",commitFilter==="mine"?
      "No commits matched your linked GitHub login. Select All commits to view shared-account work and request attribution review.":
      "No selected commits in this view. Switch to All commits to add work.",
      "text-sm text-slate-600 rounded-lg border border-dashed p-4");
  }
  for(const commit of visible){
    const sha=String(commit.sha||"").toLowerCase();
    if(!validSha(sha))continue;
    const author=detectedAuthor(commit);
    const evidenceSelected=selected.has(sha),checkpointSelected=checkpoint===sha;
    const row=add(list,"div","",
      "rounded-xl border p-3 transition "+(evidenceSelected||checkpointSelected
        ?"border-indigo-300 bg-indigo-50/40":"border-slate-200 hover:border-indigo-300"));
    const top=add(row,"div","","flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3");
    const summary=add(top,"div","","min-w-0 flex-1");
    const heading=add(summary,"div","","flex flex-wrap items-center gap-2");
    add(heading,"span",sha.slice(0,12),"font-mono text-xs text-indigo-800");
    add(heading,"strong",String(commit.commit?.message||"No message").split("\n")[0].slice(0,170),
      "text-xs break-words");
    const actions=add(top,"div","","flex flex-wrap gap-2 sm:justify-end sm:shrink-0");
    const include=add(actions,"button",evidenceSelected?"✓ Evidence selected":"Select as evidence",
      "min-h-10 rounded-lg border px-3 py-2 text-xs font-bold transition "+
      (evidenceSelected?"border-indigo-600 bg-indigo-600 text-white":"border-slate-300 bg-white text-slate-800 hover:border-indigo-400 hover:bg-indigo-50"));
    include.type="button";include.disabled=!editable||evidenceBusy;
    include.setAttribute("aria-pressed",String(evidenceSelected));
    include.setAttribute("aria-label",(evidenceSelected?"Remove ":"Select ")+sha.slice(0,12)+(evidenceSelected?" from":" as")+" evidence");
    include.addEventListener("click",()=>{selectionDirty=true;if(selected.has(sha))selected.delete(sha);else selected.add(sha);render();});
    const checkpointButton=add(actions,"button",checkpointSelected?"✓ Project checkpoint":"Use as checkpoint",
      "min-h-10 rounded-lg border px-3 py-2 text-xs font-bold transition "+
      (checkpointSelected?"border-emerald-700 bg-emerald-700 text-white":"border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-50"));
    checkpointButton.type="button";checkpointButton.disabled=!editable||evidenceBusy;
    checkpointButton.setAttribute("aria-pressed",String(checkpointSelected));
    checkpointButton.setAttribute("aria-label","Set commit "+sha.slice(0,12)+" as project checkpoint");
    checkpointButton.addEventListener("click",()=>{selectionDirty=true;checkpoint=sha;render();});
    if(commit.unavailable)add(row,"p","Saved commit unavailable from GitHub. You can remove it, or ask your teacher to inspect the repository.","text-xs text-amber-800");
    add(row,"p",author.name+" · "+(author.login?"@"+author.login:"Git login unavailable")+
      " · "+(author.date?new Date(author.date).toLocaleString():"Unknown date"),
      "text-xs text-slate-600 mt-1 break-words");
    add(row,"p",attributionLabel(commit,context?.profile?.githubUsername),
      "text-xs text-slate-500 mt-1");
    const controls=add(row,"div","","flex flex-wrap gap-3 mt-2");
    const view=add(controls,"button","Preview changed files","text-xs text-indigo-700 font-bold underline");
    view.type="button";view.addEventListener("click",()=>{void window.withLoading("Loading commit changes…",()=>preview(commit),{button:view});});
    const claim=claims.get(sha);
    if(claim){
      const label=claim.status==="approved"
        ?"Attribution approved · teacher must verify this commit for grading"
        :claim.status==="shared"?"Shared contribution accepted · teacher confirms individual work"
        :claim.status==="rejected"?"Attribution rejected · ask staff for clarification"
        :claim.status==="pending"?"Attribution pending administrator review"
        :"Attribution request withdrawn";
      add(controls,"span",label,
        "text-xs font-semibold "+(claim.status==="approved"?"text-emerald-800":
          claim.status==="rejected"?"text-rose-800":"text-amber-800"));
      if(claim.status==="pending"){
        const withdraw=add(controls,"button","Withdraw reclaim","text-xs text-rose-700 underline");
        withdraw.type="button";withdraw.disabled=!claimsReadable;
        withdraw.addEventListener("click",()=>{void window.withLoading("Updating attribution request…",()=>withdrawClaim(sha),{button:withdraw});});
      }else if(claim.status==="withdrawn"){
        const retry=add(controls,"button","Resubmit reclaim","text-xs text-amber-800 font-bold underline");
        retry.type="button";retry.disabled=!claimsReadable;
        retry.addEventListener("click",()=>{void reclaimCommit(commit);});
      }
    }else if(!claimsReadable){
      add(controls,"span","Attribution-request status unavailable · refresh before requesting review",
        "text-xs font-semibold text-amber-800");
    }else{
      const reclaim=add(controls,"button","Request attribution review","text-xs text-amber-800 font-bold underline");
      reclaim.type="button";reclaim.addEventListener("click",()=>{void reclaimCommit(commit);});
    }
  }
}
function closeReclaimForm(){
  reclaimTarget=null;
  el("evidenceReclaimEditor").classList.add("hidden");
  el("evidenceReclaimStatus").textContent="";
}
function openReclaimForm(commit){
  if(!context||reclaimBusy)return;
  const sha=String(commit?.sha||"").toLowerCase(),previous=claims.get(sha);
  if(!validSha(sha))return status("Choose a valid Git commit before requesting attribution.");
  if(previous&&previous.status!=="withdrawn")
    return status("This commit already has a pending or decided attribution request.");
  reclaimTarget=commit;
  el("evidenceReclaimReason").value="";
  el("evidenceReclaimSubject").textContent="Commit "+sha.slice(0,12)+
    " · "+detectedAuthor(commit).name+(previous?" · Resubmit withdrawn request":"");
  el("evidenceReclaimSave").textContent=previous?"Resubmit attribution request":"Send for administrator review";
  el("evidenceReclaimStatus").textContent="Describe what you personally implemented. A request does not automatically transfer credit or approve evidence.";
  el("evidenceReclaimEditor").classList.remove("hidden");
  el("evidenceReclaimEditor").scrollIntoView({block:"nearest",behavior:"smooth"});
  el("evidenceReclaimReason").focus({preventScroll:true});
}
async function preview(commit){
  const node=el("evidencePreview");
  const details=el("evidencePreviewDetails");details.classList.remove("hidden");details.open=true;
  node.textContent="Fetching commit details…";
  try{
    const repo=parseRepository(context.profile.repoUrl);
    const detail=await github(repositoryPath(repo)+"/commits/"+encodeURIComponent(commit.sha));
    const chunks=[
      "Commit: "+commit.sha,"Message: "+(detail.commit?.message||""),
      "Detected author: "+(detail.commit?.author?.name||"Unknown"),
      "GitHub login: "+(detail.author?.login||"Unlinked"),
      "Changed files: "+(detail.files?.length??0),
      "Additions: "+(detail.stats?.additions??"?")+" · Deletions: "+(detail.stats?.deletions??"?")
    ];
    for(const file of (detail.files||[]).slice(0,30)){
      chunks.push("\n--- "+file.filename+" ("+file.status+") ---\n"+
        (typeof file.patch==="string"?file.patch.slice(0,6000):"No textual diff available."));
    }
    if((detail.files||[]).length>30)chunks.push("Only first 30 files shown. Open the full commit on GitHub.");
    const link=repo.url+"/commit/"+commit.sha;
    node.textContent=chunks.join("\n")+"\n\nFull commit: "+link+
      "\nThis diff is for review, not proof of individual authorship.";
  }catch(error){node.textContent="Unable to preview: "+error.message;}
}
async function loadClaims(studentId,repository,assessmentId){
  const results=await getDocs(query(collection(db,"commit_reclaims"),where("studentId","==",studentId)));
  return currentClaims(results.docs,repository,assessmentId);
}
async function reclaimCommit(commit){
  if(!context||reclaimBusy)return;
  if(!claimsReadable)return status("Attribution-request status is unavailable. Refresh this assessment before requesting review.");
  openReclaimForm(commit);
}
async function sendReclaim(){
  if(!context||!reclaimTarget||reclaimBusy)return;
  if(!claimsReadable)return status("Attribution-request status is unavailable. Refresh before sending a reclaim request.");
  const active=context,commit=reclaimTarget,sha=String(commit.sha).toLowerCase();
  const profile=active.profile,previous=claims.get(sha);
  const explanation=el("evidenceReclaimReason").value.trim();
  const inline=text=>{el("evidenceReclaimStatus").textContent=text;};
  if(explanation.length<10||explanation.length>1500){
    inline("Please explain your work in 10–1,500 characters before sending.");return;
  }
  const author=detectedAuthor(commit);
  reclaimBusy=true;el("evidenceReclaimSave").disabled=true;
  inline("Saving your attribution request…");
  try{
    const ref=doc(db,"commit_reclaims",previous?.id||claimDocumentId(sha,profile.id,active.task.id));
    if(previous){
      await runTransaction(db,async tx=>{
        const snapshot=await tx.get(ref);
        if(!snapshot.exists()||snapshot.data().status!=="withdrawn")
          throw Error("Reclaim changed. Refresh the evidence panel before trying again.");
        const before=snapshot.data(),revision=Number(before.revision||0)+1;
        const after={...before,status:"pending",explanation,revision,resubmittedAt:serverTimestamp()};
        tx.set(doc(ref,"revisions",String(revision)),{before,after,
          actorUid:auth.currentUser.uid,reason:explanation,createdAt:serverTimestamp()});
        tx.set(ref,after);
      });
    }else{
      await setDoc(ref,{
        studentId:profile.id,assessmentId:active.task.id,section:active.section,
        repository:profile.repoUrl,sha,detectedAuthorName:author.name,
        detectedAuthorLogin:author.login,explanation,
        status:"pending",createdAt:serverTimestamp()
      });
    }
    const confirmed=await getDoc(ref);
    if(!confirmed.exists())throw Error("The attribution request was not found after saving.");
    const confirmedClaim={id:confirmed.id,...confirmed.data()};
    if(confirmedClaim.studentId!==profile.id||confirmedClaim.assessmentId!==active.task.id||
      confirmedClaim.repository!==profile.repoUrl||confirmedClaim.status!=="pending")
      throw Error("The saved attribution request does not match this assessment. Refresh and try again.");
    if(context!==active)return;
    claimsReadable=true;claims.set(sha,confirmedClaim);
    render();
    inline("Request sent and confirmed on the server. Status: Pending administrator review. You may still submit selected evidence, but teacher approval is separate from this claim.");
    status("Commit attribution request saved. An administrator will review it; your selected evidence has not changed.");
  }catch(error){
    if(context===active)inline("Could not send your attribution request: "+error.message+
      ". Your explanation is preserved. If the account or student record was recently updated, refresh this assessment and retry.");
  }finally{
    reclaimBusy=false;el("evidenceReclaimSave").disabled=false;
  }
}
async function withdrawClaim(sha){
  if(!claimsReadable)return status("Attribution-request status is unavailable. Refresh before withdrawing.");
  if(!confirm("Withdraw your pending reclaim request?"))return;
  try{
    const active=context,previous=claims.get(String(sha).toLowerCase());
    if(!previous?.id)throw Error("The current reclaim request could not be identified. Refresh and try again.");
    const ref=doc(db,"commit_reclaims",previous.id);
    await updateDoc(ref,{status:"withdrawn",withdrawnAt:serverTimestamp()});
    const confirmed=await getDoc(ref);
    if(!confirmed.exists()||confirmed.data().status!=="withdrawn")
      throw Error("The withdrawal could not be confirmed on the server.");
    if(context!==active)return;
    claims.set(String(sha).toLowerCase(),{id:confirmed.id,...confirmed.data()});render();
    status("Reclaim withdrawal confirmed. Use Resubmit reclaim to send an updated explanation for administrator review.");
  }catch(error){status("Unable to withdraw: "+error.message);}
}
async function load(){
  stopLiveEvidence();stopLiveClaims();
  const seq=++loadSequence,raw=window.__adminervaSubmissionContext?.();
  const v2=raw?.task?.schemaVersion===2&&raw?.task?.evidenceMode==="commit_selection";
  el("evidencePanel").classList.toggle("hidden",!v2);
  if(v2)el("evidencePanel").parentElement?.prepend(el("evidencePanel"));
  el("legacySubmitPanel").classList.toggle("hidden",v2);
  if(!v2){hasOlderCommits=false;refreshHistoryControl();return;}
  context=null;commits=[];selected=new Set();checkpoint="";saved=null;claims=new Map();claimsReadable=false;
  commitFilter="all";reclaimTarget=null;reclaimBusy=false;
  el("evidenceReclaimEditor").classList.add("hidden");
  el("evidenceReclaimSave").disabled=false;
  el("evidencePreviewDetails").classList.add("hidden");
  el("evidencePreviewDetails").open=false;
  evidenceBusy=false;
  selectionDirty=false;evidenceSyncing=true;
  historyPage=0;hasOlderCommits=false;historyLoading=false;historyHeadSha="";refreshHistoryControl();
  el("evidenceCommitList").replaceChildren();el("evidencePreview").textContent="";
  const summary=el("evidenceSelectionSummary");if(summary)summary.textContent="No evidence commits selected yet.";
  status("Loading your linked repository's commits…");
  try{
    const active=contextForStudent(),repo=parseRepository(active.profile.repoUrl);
    context=active;
    const docId=active.profile.id+"_"+active.task.id;
    try{
      const prior=await getDoc(doc(db,"assessment_evidence",docId));
      if(seq!==loadSequence)return;
      if(prior.exists()){
        saved=prior.data();selected=new Set(saved.selectedCommits||[]);
        checkpoint=saved.checkpointSha||"";
      }
    }catch(error){if(error?.code!=="permission-denied")throw error;}
    watchEvidence(doc(db,"assessment_evidence",docId),seq);
    const [claimResult,commitResult]=await Promise.allSettled([
      loadClaims(active.profile.id,active.profile.repoUrl,active.task.id),
      github(commitPagePath(repositoryPath(repo),1))
    ]);
    if(commitResult.status!=="fulfilled")throw commitResult.reason;
    const result=commitResult.value;
    let claimWarning="";
    if(claimResult.status==="fulfilled"){
      claimsReadable=true;claims=claimResult.value;
      watchClaims(active.profile.id,active.profile.repoUrl,active.task.id,seq);
    }else{
      claimsReadable=false;claims=new Map();
      claimWarning=" Attribution-request status could not be loaded ("+claimResult.reason?.message+"). Reclaim actions are disabled until refresh succeeds.";
    }
    if(seq!==loadSequence)return;
    commits=appendUniqueCommits([],result);
    const missing=[...new Set([...selected,checkpoint].filter(validSha))].filter(sha=>!commits.some(commit=>commit.sha.toLowerCase()===sha));
    const restored=await Promise.all(missing.map(async sha=>{
      try{return await github(repositoryPath(repo)+"/commits/"+sha);}
      catch{return {sha,unavailable:true,commit:{message:"Saved evidence selection"}};}
    }));
    if(seq!==loadSequence)return;
    commits=appendUniqueCommits(restored,commits);
    // Keep the actual branch head separate from restored older evidence commits.
    historyHeadSha=validSha(result[0]?.sha)?String(result[0].sha).toLowerCase():"";
    if(!checkpoint&&historyHeadSha)checkpoint=historyHeadSha;
    historyPage=1;hasOlderCommits=hasOlderCommitPage(historyPage,result.length);
    refreshHistoryControl();render();
    const loadMessage=hasOlderCommits
      ?"Showing "+commits.length+" recent commits. Your latest project revision is suggested as the checkpoint; select only your own relevant commits as evidence. Use Load older commits to find historical evidence."
      :"Select your own relevant commits, then use the latest suitable project revision as the checkpoint. The checkpoint may belong to a teammate. Reclaims remain pending staff review.";
    status(loadMessage+claimWarning);
    if(saved?.status==="approved")status("Checkpoint approved. Ask your instructor to reopen it before resubmitting or withdrawing. Your current evidence and grade remain protected.");
    else if(saved?.status==="reopened")status("Your instructor reopened this evidence"+(saved.reopenReason?": "+saved.reopenReason:"")+". Update your selection and resubmit for fresh approval. Previous evidence remains in the audit history.");
    else if(saved?.status==="withdrawn")status("Evidence withdrawn. You may revise and resubmit; the previous submission remains in the audit history.");
    else if(saved?.status==="submitted")status("Evidence submitted. Before approval you may revise and resubmit, or withdraw. Resubmission records a new server time and preserves prior evidence.");
    else if(saved?.status==="needs_review")status("Your teacher proposed historical evidence, not a student submission. Ask them to reopen it for student changes if you need to choose your own evidence commits and checkpoint before approval.");
    if(evidenceSyncing)status("Checking current evidence status with the server. Editing resumes when connected.");
  }catch(error){if(seq===loadSequence)status("Unable to load evidence: "+error.message);}
}
async function loadOlderCommits(){
  if(historyLoading||!hasOlderCommits||!context)return;
  const seq=loadSequence,active=context;
  historyLoading=true;refreshHistoryControl();
  try{
    const repo=parseRepository(active.profile.repoUrl);
    const page=historyPage+1;
    const batch=await github(commitPagePath(repositoryPath(repo),page));
    if(seq!==loadSequence||context!==active)return;
    commits=appendUniqueCommits(commits,batch);
    historyPage=page;hasOlderCommits=hasOlderCommitPage(historyPage,batch.length);
    render();
    status("Loaded "+commits.length+" unique commits. Selected evidence and checkpoint remain unchanged."+
      (!hasOlderCommits&&batch.length===100?" History review limit reached; contact staff for older history.":""));
  }catch(error){
    if(seq===loadSequence)status("Could not load older commits: "+error.message);
  }finally{
    if(seq===loadSequence){historyLoading=false;refreshHistoryControl();}
  }
}
async function submit(){
  if(!context||evidenceBusy||evidenceSyncing)return;
  const active=context,sequence=loadSequence;
  try{
    const guidance=evidenceSelectionGuidance([...selected],checkpoint);
    if(!guidance.ready){status(guidance.message);return;}
    const {selectedCommits,checkpointSha}=normalizeSelection([...selected],checkpoint);
    evidenceBusy=true;render();status("Checking that the project checkpoint contains all selected evidence…");
    const repo=parseRepository(active.profile.repoUrl);
    const compatible=await resolveSubmissionCheckpoint({
      selectedCommits,checkpointSha,latestCheckpointSha:historyHeadSha,
      fetchPage:(sha,page)=>github(repositoryPath(repo)+"/commits?sha="+encodeURIComponent(sha)+"&per_page=100&page="+page)
    });
    if(sequence!==loadSequence||context!==active)return;
    if(!compatible.ok)throw Error("The saved checkpoint and latest repository revision do not contain selected commit"+
      (compatible.missing.length===1?" ":"s ")+compatible.missing.map(sha=>sha.slice(0,12)).join(", ")+
      ". Check that these commits are on the same repository branch. If you recently pushed work, refresh the evidence list and retry; withdrawing evidence is not necessary.");
    const submissionCheckpointSha=compatible.checkpointSha;
    if(compatible.advanced){
      checkpoint=submissionCheckpointSha;
      selectionDirty=true;render();
      status("New commits require a newer project checkpoint. The latest repository revision "+
        submissionCheckpointSha.slice(0,12)+" was verified to contain all selected commits. Confirm to resubmit.");
    }
    if(!confirm((compatible.advanced
      ?"Your previous checkpoint did not contain all selected commits. Adminerva verified a newer project checkpoint: "+submissionCheckpointSha.slice(0,12)+".\n\n"
      :"")+"Submit "+selectedCommits.length+" evidence commit"+(selectedCommits.length===1?"":"s")+
      " using project checkpoint "+submissionCheckpointSha.slice(0,12)+
      "? The checkpoint may be a teammate's later project commit; it is project context, not individual credit."))return;
    if(sequence!==loadSequence||context!==active)return;
    const wasReopened=saved?.status==="reopened";
    status(wasReopened?"Resubmitting reopened evidence…":"Submitting selected evidence…");
    const ref=doc(db,"assessment_evidence",active.profile.id+"_"+active.task.id);
    const common={selectedCommits,checkpointSha:submissionCheckpointSha,updatedAt:serverTimestamp()};
    if(saved){
      if(!studentMayChangeEvidence(saved))throw Error("Ask your instructor to reopen approved evidence first.");
      await changeEvidence(ref,saved,{...common,status:"submitted",submittedAt:serverTimestamp()},"Student resubmitted selected evidence");
    }else{
      await setDoc(ref,{
        ...common,studentId:active.profile.id,assessmentId:active.task.id,
        section:active.section,repository:active.profile.repoUrl,status:"submitted",
        submittedAt:serverTimestamp()
      });
    }
    const result=(await getDoc(ref)).data();
    if(context!==active)return;
    saved=result;selectionDirty=false;
    render();
    status(wasReopened?"Resubmission saved. Status: Submitted — awaiting fresh teacher approval. Your previously reopened evidence is no longer awaiting student changes.":"Evidence submitted for teacher verification. Status: Submitted — awaiting teacher approval. This is not an approved contribution or grade.");
    window.dispatchEvent(new CustomEvent("adminerva:submission-recorded",{
      detail:{assessmentId:active.task.id,studentId:active.profile.id,revisionSha:submissionCheckpointSha,evidenceStatus:"submitted"}
    }));
  }catch(error){if(context===active)status("Evidence submission failed: "+error.message);}
  finally{if(context===active){evidenceBusy=false;render();}}
}
async function withdrawEvidence(){
  if(!context||evidenceBusy||!saved||!studentMayChangeEvidence(saved)||saved.status==="withdrawn")return;
  const active=context;
  if(!confirm("Withdraw this evidence from review? Previous commits and submission times remain in the audit history. You can resubmit before approval."))return;
  try{
    evidenceBusy=true;render();status("Withdrawing evidence…");
    const ref=doc(db,"assessment_evidence",active.profile.id+"_"+active.task.id);
    await changeEvidence(ref,saved,{status:"withdrawn"},"Student withdrew evidence before approval");
    const result=(await getDoc(ref)).data();if(context!==active)return;
    saved=result;selectionDirty=false;render();
    status("Evidence withdrawn; previous submission retained. Revise and resubmit when ready.");
    window.dispatchEvent(new CustomEvent("adminerva:submission-recorded",{
      detail:{assessmentId:active.task.id,studentId:active.profile.id,evidenceStatus:"withdrawn"}
    }));
  }catch(error){if(context===active)status("Unable to withdraw: "+error.message);}
  finally{if(context===active){evidenceBusy=false;render();}}
}
window.addEventListener("adminerva:assessment-opened",()=>{void load();});
el("evidenceSubmit")?.addEventListener("click",()=>{void window.withLoading("Checking and submitting evidence…",submit,{button:el("evidenceSubmit")});});
el("evidenceLoadOlder")?.addEventListener("click",()=>{void window.withLoading("Loading older commits…",loadOlderCommits,{button:el("evidenceLoadOlder")});});
el("evidenceFilterBar")?.addEventListener("click",event=>{
  const button=event.target.closest?.("[data-evidence-filter]");
  if(!button)return;
  commitFilter=button.dataset.evidenceFilter;render();
});
el("evidenceReclaimSave")?.addEventListener("click",()=>{void window.withLoading("Submitting attribution request…",sendReclaim,{button:el("evidenceReclaimSave")});});
el("evidenceReclaimCancel")?.addEventListener("click",()=>{if(!reclaimBusy)closeReclaimForm();});
el("evidenceRefresh")?.addEventListener("click",()=>{
  if(evidenceBusy)return;
  if(selectionDirty&&!confirm("Reload saved evidence and discard your unsaved commit selection?"))return;
  void window.withLoading("Refreshing commit evidence…",load,{button:el("evidenceRefresh")});
});
el("evidenceWithdraw")?.addEventListener("click",()=>{void window.withLoading("Updating submitted evidence…",withdrawEvidence,{button:el("evidenceWithdraw")});});
el("evidenceClear")?.addEventListener("click",()=>{
  if(!studentMayChangeEvidence(saved)||evidenceBusy)return;
  if(!confirm("Clear this editable selection? Saved evidence and audit history are unchanged until you resubmit."))return;
  selected.clear();checkpoint="";selectionDirty=true;render();status("Selection cleared locally. Choose your commits and a new checkpoint, then resubmit.");
});
new MutationObserver(()=>{
  if(el("assessmentModal").classList.contains("hidden")){stopLiveEvidence();stopLiveClaims();loadSequence++;context=null;}
}).observe(el("assessmentModal"),{attributes:true,attributeFilter:["class"]});
