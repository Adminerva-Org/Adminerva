import {auth,db} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,doc,getDoc,getDocs,setDoc,query,where,updateDoc,runTransaction,serverTimestamp}
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {parseRepository,normalizeSelection,validSha}
  from "./services/assessment-evidence.mjs";

const STAFF=new Set(["babaynike2013@gmail.com","josephsixson@mcstayuman.edu.ph"]);
const ADMIN="babaynike2013@gmail.com";
const el=id=>document.getElementById(id);
const state={students:[],assessments:[],evidence:null,student:null,assessment:null,claims:[],loaded:false,busy:false};
const discovery={commits:[],selected:new Set(),checkpoint:""};
function add(parent,tag,text,style=""){
  const x=document.createElement(tag);x.textContent=String(text??"");if(style)x.className=style;
  parent.append(x);return x;
}
function status(t){el("evidenceReviewStatus").textContent=t;}
function link(parent,title,url){
  const a=add(parent,"a",title,"font-semibold text-indigo-700 hover:underline break-all");
  a.href=url;a.target="_blank";a.rel="noopener noreferrer";return a;
}
async function github(route){
  const res=await fetch("https://api.github.com"+route,{headers:{Accept:"application/vnd.github+json"}});
  if(!res.ok)throw Error("GitHub HTTP "+res.status+" — verify the repository is publicly accessible.");
  return res.json();
}
function api(repo){return "/repos/"+encodeURIComponent(repo.owner)+"/"+encodeURIComponent(repo.repo);}
function selection(){const student=state.students.find(s=>s.id===el("evidenceStudent").value);
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
  const select=el("evidenceStudent");select.replaceChildren();option(select,"","Select student");
  for(const student of state.students.sort((a,b)=>(a.name||"").localeCompare(b.name||"")))
    option(select,student.id,(student.name||student.id)+" · "+(student.section||""));
  const ass=el("evidenceAssessment");ass.replaceChildren();option(ass,"","Select V2 assessment");
  for(const item of state.assessments)option(ass,item.id,item.title||item.id);
  const url=new URLSearchParams(location.search);
  if(state.students.some(s=>s.id===url.get("student")))select.value=url.get("student");
  if(state.assessments.some(a=>a.id===url.get("assessment")))ass.value=url.get("assessment");
  if(select.value&&ass.value)await loadEvidence();
  else status("Select a student and V2 assessment.");
}
async function loadEvidence(){
  state.loaded=false;state.evidence=null;el("evidenceDetails").classList.add("hidden");
  el("evidenceDiscovery").classList.add("hidden");
  try{
    const {student,assessment}=selection();state.student=student;state.assessment=assessment;
    const snap=await getDoc(doc(db,"assessment_evidence",student.id+"_"+assessment.id));
    if(!snap.exists()){
      el("evidenceDiscovery").classList.remove("hidden");
      el("evidenceDiscoverList").replaceChildren();
      discovery.commits=[];discovery.selected=new Set();discovery.checkpoint="";
      status("No student submission. You may discover historical commits without changing the student's GitHub history.");
      return;
    }
    const evidence=snap.data();
    normalizeSelection(evidence.selectedCommits,evidence.checkpointSha);
    if(evidence.studentId!==student.id||evidence.assessmentId!==assessment.id||
       evidence.repository!==student.repoUrl)throw Error("Submission identity or repository does not match the roster.");
    state.evidence=evidence;
    const claims=await getDocs(query(collection(db,"commit_reclaims"),where("studentId","==",student.id)));
    state.claims=claims.docs.filter(d=>d.data().assessmentId===assessment.id).map(d=>({id:d.id,...d.data()}));
    const repo=parseRepository(evidence.repository),base=repo.url;
    el("evidenceTitle").textContent=(student.name||student.id)+" — "+(assessment.title||assessment.id);
    el("evidenceMetadata").textContent="Status: "+evidence.status+
      " · Section: "+student.section+" · Project checkpoint: "+evidence.checkpointSha+
      " · Commits submitted: "+evidence.selectedCommits.length;
    const links=el("evidenceLinks");links.replaceChildren();
    link(links,"Project at checkpoint ↗",base+"/tree/"+encodeURIComponent(evidence.checkpointSha));
    link(links,"Contribution Inspector ↗","contribution-inspector.html?section="+
      encodeURIComponent(student.section)+"&student="+encodeURIComponent(student.id)+
      "&assessment="+encodeURIComponent(assessment.id));
    const rows=el("evidenceCommitDetails");rows.replaceChildren();
    for(const sha of evidence.selectedCommits){
      const p=add(rows,"div","","rounded-lg border p-3");
      link(p,sha.slice(0,12)+" · View on GitHub ↗",base+"/commit/"+encodeURIComponent(sha));
      const preview=add(p,"button"," · Preview changes","ml-3 text-xs underline text-indigo-700");
      preview.type="button";
      preview.addEventListener("click",()=>{void previewCommit(repo,sha,p);});
    }
    await renderClaims();
    el("evidenceApprove").disabled=evidence.status==="approved";
    el("evidenceApprove").textContent=evidence.status==="approved"?"Checkpoint approved":"Verify and approve checkpoint";
    el("evidenceDetails").classList.remove("hidden");
    state.loaded=true;
    status("Loaded "+evidence.selectedCommits.length+" selected commits. Approval will verify that they occur in the checkpoint's ancestry.");
  }catch(error){status("Unable to load evidence: "+error.message);}
}
async function previewCommit(repo,sha,row){
  let box=row.querySelector("pre");
  if(!box)box=add(row,"pre","","max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs bg-slate-50 p-3 mt-3");
  box.textContent="Loading commit diffs…";
  try{
    const data=await github(api(repo)+"/commits/"+sha);
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
  // Read commit graph pinned to the checkpoint, not mutable default HEAD.
  const remaining=new Set(selected);
  for(let page=1;page<=10;page++){
    const items=await github(api(repo)+"/commits?sha="+encodeURIComponent(checkpoint)+
      "&per_page=100&page="+page);
    if(!Array.isArray(items))throw Error("Invalid commit ancestry response");
    for(const item of items)remaining.delete(String(item.sha||"").toLowerCase());
    if(!remaining.size)return;
    if(items.length<100)break;
  }
  throw Error("The selected commits could not all be verified in the checkpoint's available ancestry. Choose another revision or inspect manually.");
}
async function approve(){
  if(state.busy||!state.loaded||state.evidence?.status==="approved")return;
  const note=el("evidenceReviewNote").value.trim();
  if(note.length<15||note.length>3000||!el("evidenceConfirm").checked){
    status("Provide a review note (15–3,000 characters) and confirm inspection.");return;
  }
  const pending=new Set(state.claims.filter(c=>c.status==="pending").map(c=>c.sha));
  if(state.evidence.selectedCommits.some(sha=>pending.has(sha))){
    status("Resolve pending reclaim requests involving selected commits before approving.");return;
  }
  state.busy=true;el("evidenceApprove").disabled=true;
  try{
    const repo=parseRepository(state.evidence.repository);
    const selection=normalizeSelection(state.evidence.selectedCommits,state.evidence.checkpointSha);
    status("Verifying checkpoint ancestry with GitHub…");
    await verifyAncestry(repo,selection.checkpointSha,selection.selectedCommits);
    const ref=doc(db,"assessment_evidence",state.student.id+"_"+state.assessment.id);
    await runTransaction(db,async tx=>{
      const current=await tx.get(ref);
      if(!current.exists()||!["submitted","needs_review"].includes(current.data().status)||
        current.data().checkpointSha!==selection.checkpointSha||
        JSON.stringify(current.data().selectedCommits)!==JSON.stringify(selection.selectedCommits))
        throw Error("Student evidence changed; reload before approving.");
      tx.update(ref,{status:"approved",reviewedBy:auth.currentUser.uid,
        reviewedAt:serverTimestamp(),verificationNote:note,
        approvedCheckpointSha:selection.checkpointSha});
    });
    status("Checkpoint approved. Grading remains a separate unpublished teacher step.");
    await loadEvidence();
  }catch(e){status("Approval failed: "+e.message);}
  finally{state.busy=false;el("evidenceApprove").disabled=state.evidence?.status==="approved";}
}
onAuthStateChanged(auth,user=>{
  if(!user||!STAFF.has(String(user.email||"").toLowerCase())){
    status("Authorized teacher or administrator sign-in required.");return;
  }
  void loadDirectory().catch(e=>status("Directory failed: "+e.message));
});
async function findHistoricalCommits(){
  const student=state.student;if(!student)return status("Choose student and assessment.");
  try{
    const repo=parseRepository(student.repoUrl);
    const info=await github(api(repo));
    const commits=await github(api(repo)+"/commits?sha="+encodeURIComponent(info.default_branch||"main")+
      "&per_page=100");
    if(!Array.isArray(commits))throw Error("Unexpected GitHub commits response");
    discovery.commits=commits;discovery.selected=new Set();discovery.checkpoint="";
    renderHistorical();
    status("Showing "+commits.length+" recent commits. Use previews to confirm task relevance. Older commits may require further investigation.");
  }catch(error){status("Historical discovery failed: "+error.message);}
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
    radio.addEventListener("change",()=>{discovery.checkpoint=sha;discovery.selected.add(sha);renderHistorical();});
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
    await setDoc(ref,{
      studentId:student.id,assessmentId:assessment.id,section:student.section,
      repository:student.repoUrl,selectedCommits:selection.selectedCommits,
      checkpointSha:selection.checkpointSha,status:"needs_review",
      source:"teacher_discovered",discoveredBy:auth.currentUser.uid,
      recordedAt:serverTimestamp(),updatedAt:serverTimestamp()
    });
    await loadEvidence();
    status("Historical candidate evidence saved. Independently verify before approving; no submission date was asserted.");
  }catch(error){status("Unable to save historical evidence: "+error.message);}
}
el("evidenceFindCommits").addEventListener("click",()=>{void findHistoricalCommits();});
el("evidenceSaveDiscovery").addEventListener("click",()=>{void saveDiscovery();});
el("evidenceLoad").addEventListener("click",()=>{void loadEvidence();});
el("evidenceApprove").addEventListener("click",()=>{void approve();});
