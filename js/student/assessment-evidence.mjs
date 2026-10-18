import {auth,db} from "../core/firebase-core.js";
import {doc,getDoc,getDocs,setDoc,updateDoc,collection,query,where,serverTimestamp}
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {parseRepository,normalizeSelection,evidenceSelectionGuidance,detectedAuthor,attributionLabel,claimDocumentId,validSha}
  from "../repo-review/services/assessment-evidence.mjs?v=2026.10.18.1";
import {commitPagePath,appendUniqueCommits,hasOlderCommitPage} from "../repo-review/services/commit-history.mjs";

const el=id=>document.getElementById(id);
let context=null,commits=[],selected=new Set(),checkpoint="",claims=new Map(),saved=null,loadSequence=0;
let historyPage=0,hasOlderCommits=false,historyLoading=false;
const status=text=>{el("evidenceStatus").textContent=text;};
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
  const response=await fetch("https://api.github.com"+path,{
    headers:{Accept:"application/vnd.github+json"}});
  if(!response.ok)throw Error("GitHub HTTP "+response.status+
    ". This preview currently requires a publicly accessible repository.");
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
  el("evidenceSubmit").disabled=Boolean(saved&&saved.status!=="submitted");
  const guidance=evidenceSelectionGuidance([...selected],checkpoint);
  const summary=el("evidenceSelectionSummary");
  if(summary)summary.textContent=guidance.message;
  if(!commits.length){add(list,"p","No commits returned. The repository may be empty or inaccessible.");return;}
  for(const commit of commits){
    const sha=String(commit.sha||"").toLowerCase();
    if(!validSha(sha))continue;
    const author=detectedAuthor(commit);
    const row=add(list,"div","","rounded-lg border border-slate-200 p-3");
    const top=add(row,"div","","flex flex-wrap items-center gap-3");
    const includeLabel=add(top,"label","","inline-flex items-center gap-1 text-xs text-slate-700 font-semibold cursor-pointer");
    const check=document.createElement("input");check.type="checkbox";check.checked=selected.has(sha);
    check.disabled=saved?.status==="approved";check.setAttribute("aria-label","Include commit "+sha.slice(0,12)+" as evidence");
    check.addEventListener("change",()=>{if(check.checked)selected.add(sha);
      else {selected.delete(sha);if(checkpoint===sha)checkpoint="";}
      render();});includeLabel.append(check);
    add(includeLabel,"span","Include commit");
    const checkpointLabel=add(top,"label","","inline-flex items-center gap-1 text-xs text-indigo-800 font-semibold cursor-pointer");
    const radio=document.createElement("input");radio.type="radio";radio.name="assessmentCheckpoint";
    radio.checked=checkpoint===sha;radio.disabled=saved?.status==="approved";
    radio.setAttribute("aria-label","Set commit "+sha.slice(0,12)+" as project checkpoint");
    radio.addEventListener("change",()=>{checkpoint=sha;selected.add(sha);render();});
    checkpointLabel.append(radio);
    add(checkpointLabel,"span","Project checkpoint");
    add(top,"span",sha.slice(0,12),"font-mono text-xs text-indigo-800");
    add(top,"strong",String(commit.commit?.message||"No message").split("\n")[0].slice(0,170),
      "text-xs break-words");
    add(row,"p",author.name+" · "+(author.login?"@"+author.login:"Git login unavailable")+
      " · "+(author.date?new Date(author.date).toLocaleString():"Unknown date"),
      "text-xs text-slate-600 mt-2 break-words");
    add(row,"p",attributionLabel(commit,context?.profile?.githubUsername),
      "text-xs text-slate-500 mt-1");
    const controls=add(row,"div","","flex flex-wrap gap-3 mt-2");
    const view=add(controls,"button","Preview changed files","text-xs text-indigo-700 font-bold underline");
    view.type="button";view.addEventListener("click",()=>{void preview(commit);});
    const claim=claims.get(sha);
    if(claim){
      add(controls,"span","Reclaim: "+claim.status,"text-xs font-semibold text-amber-800");
      if(claim.status==="pending"){
        const withdraw=add(controls,"button","Withdraw reclaim","text-xs text-rose-700 underline");
        withdraw.type="button";withdraw.addEventListener("click",()=>{void withdrawClaim(sha);});
      }
    }else{
      const reclaim=add(controls,"button","Reclaim Commit","text-xs text-amber-800 font-bold underline");
      reclaim.type="button";reclaim.addEventListener("click",()=>{void reclaimCommit(commit);});
    }
  }
}
async function preview(commit){
  const node=el("evidencePreview");node.textContent="Fetching commit details…";
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
async function loadClaims(studentId){
  const results=await getDocs(query(collection(db,"commit_reclaims"),where("studentId","==",studentId)));
  claims=new Map(results.docs.map(d=>[d.data().sha,d.data()]));
}
async function reclaimCommit(commit){
  if(!context)return;
  const explanation=prompt("Explain why this Git commit should be attributed to you. Staff must verify the claim.");
  if(explanation===null)return;
  if(explanation.trim().length<10||explanation.length>1500){
    status("Provide an explanation between 10 and 1,500 characters.");return;
  }
  const sha=commit.sha.toLowerCase(),profile=context.profile;
  const author=detectedAuthor(commit);
  try{
    await setDoc(doc(db,"commit_reclaims",claimDocumentId(sha,profile.id)),{
      studentId:profile.id,assessmentId:context.task.id,section:context.section,
      repository:profile.repoUrl,sha,detectedAuthorName:author.name,
      detectedAuthorLogin:author.login,explanation:explanation.trim(),
      status:"pending",createdAt:serverTimestamp()
    });
    claims.set(sha,{sha,status:"pending"});render();
    status("Reclaim request recorded. No attribution was changed; staff review is required.");
  }catch(error){status("Could not record reclaim: "+error.message);}
}
async function withdrawClaim(sha){
  if(!confirm("Withdraw your pending reclaim request?"))return;
  try{
    await updateDoc(doc(db,"commit_reclaims",claimDocumentId(sha,context.profile.id)),{
      status:"withdrawn",withdrawnAt:serverTimestamp()
    });
    claims.set(sha,{sha,status:"withdrawn"});render();
    status("Reclaim withdrawn. Contact your instructor if you need to resubmit a claim.");
  }catch(error){status("Unable to withdraw: "+error.message);}
}
async function load(){
  const seq=++loadSequence,raw=window.__adminervaSubmissionContext?.();
  const v2=raw?.task?.schemaVersion===2&&raw?.task?.evidenceMode==="commit_selection";
  el("evidencePanel").classList.toggle("hidden",!v2);
  el("legacySubmitPanel").classList.toggle("hidden",v2);
  if(!v2){hasOlderCommits=false;refreshHistoryControl();return;}
  context=null;commits=[];selected=new Set();checkpoint="";saved=null;claims=new Map();
  historyPage=0;hasOlderCommits=false;historyLoading=false;refreshHistoryControl();
  el("evidenceCommitList").replaceChildren();el("evidencePreview").textContent="";
  const summary=el("evidenceSelectionSummary");if(summary)summary.textContent="No evidence commits selected yet.";
  status("Loading your linked repository's commits…");
  try{
    const active=contextForStudent(),repo=parseRepository(active.profile.repoUrl);
    context=active;
    const docId=active.profile.id+"_"+active.task.id;
    try{
      const prior=await getDoc(doc(db,"assessment_evidence",docId));
      if(prior.exists()){
        saved=prior.data();selected=new Set(saved.selectedCommits||[]);
        checkpoint=saved.checkpointSha||"";
      }
    }catch(error){if(error?.code!=="permission-denied")throw error;}
    await loadClaims(active.profile.id);
    const result=await github(commitPagePath(repositoryPath(repo),1));
    if(seq!==loadSequence)return;
    commits=appendUniqueCommits([],result);
    historyPage=1;hasOlderCommits=hasOlderCommitPage(historyPage,result.length);
    refreshHistoryControl();render();
    status(hasOlderCommits
      ?"Showing "+commits.length+" recent commits. Select Load older commits to find historical evidence."
      :"Select relevant commits, choose a project checkpoint, and submit. Reclaims remain pending staff review.");
    if(saved?.status==="approved")status("An instructor approved this checkpoint. Evidence is locked.");
    else if(saved?.status==="needs_review")status("Your teacher discovered historical evidence for review. It is not a student submission, and it cannot be edited here.");
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
  if(!context)return;
  try{
    const guidance=evidenceSelectionGuidance([...selected],checkpoint);
    if(!guidance.ready){status(guidance.message);return;}
    const {selectedCommits,checkpointSha}=normalizeSelection([...selected],checkpoint);
    if(!commits.some(c=>c.sha.toLowerCase()===checkpointSha))
      throw Error("Checkpoint not found in the loaded GitHub history.");
    if(!confirm("Submit "+selectedCommits.length+" commits as evidence at checkpoint "+checkpointSha.slice(0,12)+
      "? This is not a graded result."))return;
    const ref=doc(db,"assessment_evidence",context.profile.id+"_"+context.task.id);
    const common={selectedCommits,checkpointSha,updatedAt:serverTimestamp()};
    if(saved){
      if(saved.status!=="submitted")throw Error("This evidence has been reviewed and is locked.");
      await updateDoc(ref,{...common,submittedAt:serverTimestamp()});
    }else{
      await setDoc(ref,{
        ...common,studentId:context.profile.id,assessmentId:context.task.id,
        section:context.section,repository:context.profile.repoUrl,status:"submitted",
        submittedAt:serverTimestamp()
      });
    }
    saved={...(saved||{}),status:"submitted",selectedCommits,checkpointSha};
    render();
    status("Evidence submitted for teacher verification. This is not an approved contribution or grade.");
    window.dispatchEvent(new CustomEvent("adminerva:submission-recorded",{
      detail:{assessmentId:context.task.id,studentId:context.profile.id,revisionSha:checkpointSha}
    }));
  }catch(error){status("Evidence submission failed: "+error.message);}
}
window.addEventListener("adminerva:assessment-opened",()=>{void load();});
el("evidenceSubmit")?.addEventListener("click",()=>{void submit();});
el("evidenceLoadOlder")?.addEventListener("click",()=>{void loadOlderCommits();});
