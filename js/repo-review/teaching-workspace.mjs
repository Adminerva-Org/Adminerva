/** Inline panels share one selected assessment, group and learner. No page applications are embedded. */
import {createReviewRequests} from "./services/review-requests.mjs?v=1.3.0";
import {validSha} from "./services/assessment-evidence.mjs?v=1.3.0";
const make=(tag,text,classes="")=>{const element=document.createElement(tag);element.textContent=text; element.className=classes;return element;};
export function mountTeachingWorkspace(root){
 let context=null,student=null,view="grade",activity=null,activityKey="",reviewKey="",requests=null,abort=null,revision=0;
 const manual=document.getElementById("manualReviewModal");
 const panels=Object.fromEntries([...root.querySelectorAll("[data-teaching-panel]")].map(panel=>[panel.dataset.teachingPanel,panel]));
 if(manual){manual.dataset.inlineReview="true";panels.review.append(manual);}
 const member=root.querySelector("[data-review-member]"),status=root.querySelector("[data-workspace-status]");
 const name=learner=>learner.name||learner.id;
 const updateStatus=text=>{status.textContent=text;};
 const evidenceBadge=root.querySelector("[data-review-evidence-status]");
 function updateEvidenceBadge(){
  if(!evidenceBadge)return;
  const evidence=student&&context?.evidence?.get(student.id);
  const state=evidence?.status;
  const submittedAfterReopen=state==="submitted"&&Boolean(evidence.reopenedAt||evidence.reopenedBy);
  const label=state==="reopened"?"Reopened — awaiting student resubmission":
    submittedAfterReopen?"Resubmitted — awaiting teacher approval":
    state==="submitted"?"Submitted — awaiting teacher approval":
    state==="approved"?"Evidence approved":
    state==="withdrawn"?"Withdrawn — not awaiting approval":
    state==="needs_review"?"Teacher-discovered evidence — review needed":
    "No evidence submission";
  const tone=state==="approved"?"border-emerald-300 bg-emerald-50 text-emerald-900":
    state==="submitted"?"border-blue-300 bg-blue-50 text-blue-900":
    state==="reopened"||state==="needs_review"?"border-amber-300 bg-amber-50 text-amber-950":
    "border-slate-300 bg-slate-50 text-slate-700";
  evidenceBadge.textContent=label;
  evidenceBadge.className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold mt-2 "+tone;
  evidenceBadge.title=state==="reopened"?"A GitHub push or submission receipt does not change this status. The learner must resubmit selected evidence.":
    state==="submitted"?"Open evidence review to verify the new selection. Refresh status if another session changed it.":"Current saved evidence state.";
  evidenceBadge.hidden=false;
 }
 function dirty(){return Boolean(activity?.hasUnsavedChanges?.()||window.manualReviewHasUnsavedChanges?.());}
 function canLeave(){return !dirty()||confirm("Discard unsaved review changes and change the selected learner or task?");}
 function clear({force=false}={}){
  if(!force&&!canLeave())return false;
  revision++;abort?.abort();activity?.destroy();activity=null;activityKey="";reviewKey="";
  window.closeManualGradeReview?.({force:true,silent:true});context=null;student=null;root.hidden=true;return true;
 }
 function reviewState(learner){
  const evidence=context.evidence.get(learner.id),grade=context.grades.get(learner.id),activityGrade=context.activities.get(learner.id);
  if(activityGrade?.published||grade?.published)return {label:"Published",tone:"success",action:"View reviewed result",next:context.repository?"grade":"activity"};
  if(activityGrade)return {label:"Private grade draft",tone:"attention",action:"Continue activity grade",next:"activity"};
  if(grade)return {label:"Private grade draft",tone:"attention",action:"Continue review & grade",next:"grade"};
  if(!context.repository)return {label:"No repository",tone:"attention",action:"Record observed activity",next:"activity"};
  if(evidence?.status==="approved")return {label:"Evidence approved",tone:"success",action:"Grade approved evidence",next:"grade"};
  if(evidence?.status==="submitted"||evidence?.status==="needs_review")return {label:"Needs review",tone:"attention",action:"Review submission",next:"grade"};
  if(evidence?.status==="reopened")return {label:"Returned for changes",tone:"attention",action:"Review current status",next:"grade"};
  if(evidence?.status==="withdrawn")return {label:"Withdrawn",tone:"attention",action:"Review current status",next:"grade"};
  return {label:"Not reviewed",tone:"neutral",action:"Start review",next:"grade"};
 }
 function summary(){
  const box=panels.inbox;box.replaceChildren();if(!context)return;
  box.append(make("h3","Review queue","font-bold text-lg"),make("p",(context.assessment.title||context.assessment.id)+" · choose a learner and continue the next review step.","text-sm text-slate-600"));
  if(context.sourceWarnings?.length)box.append(make("p","Some saved statuses are unavailable: "+context.sourceWarnings.join(", ")+". Refresh the queue to retry; unavailable results are not zero scores.","av-status-message"));
  const description=context.assessment.instructions||context.assessment.description||context.assessment.prompt;
  if(description){const details=make("details","","border rounded-lg p-3 my-3");details.append(make("summary","Assessment instructions","font-semibold"),make("p",String(description),"whitespace-pre-wrap text-sm mt-3"));box.append(details);}
  for(const learner of context.students){
   const evidence=context.evidence.get(learner.id),grade=context.grades.get(learner.id),activityGrade=context.activities.get(learner.id),receipts=context.receipts.filter(item=>item.studentId===learner.id);
   const card=make("article","","av-workspace-inbox-card");card.append(make("strong",name(learner)),make("p","Evidence: "+(evidence?.status||"No selected evidence record")+" · "+(evidence?.selectedCommits?.length||0)+" selected commits","text-sm"));
   if(evidence?.checkpointSha)card.append(make("p","Checkpoint: "+evidence.checkpointSha,"font-mono text-xs break-all"));
   for(const receipt of receipts.slice(-3))card.append(make("p","Submission receipt · "+(receipt.revisionSha||"No revision")+(receipt.sourcePath?" · "+receipt.sourcePath:""),"text-xs break-all"));
   if(!receipts.length)card.append(make("p","No repository submission receipt is loaded.","text-xs text-slate-500"));
   for(const [label,saved]of [["Repository grade",grade],["Activity grade",activityGrade]])if(saved)card.append(make("p",label+": "+saved.score+" / "+saved.maxScore+" · "+(saved.published?"Published":"Private draft"),"text-sm font-semibold"));
   const next=reviewState(learner),nextRow=make("div","","av-review-next");
   const nextInfo=make("div","");const state=make("span",next.label,"av-review-state");state.dataset.tone=next.tone;nextInfo.append(state,make("strong","Next: "+next.action,"block mt-1"));
   const button=make("button",next.action,"av-primary-button");button.type="button";button.onclick=()=>{if(student?.id!==learner.id&&!canLeave())return;selectMember(learner);void show(next.next);};
   nextRow.append(nextInfo,button);card.append(nextRow);box.append(card);
  }
 }
 function selectMember(next){
  if(student?.id===next.id)return;
  window.closeManualGradeReview?.({force:true,silent:true});reviewKey="";
  activity?.destroy();activity=null;activityKey="";
  student=next;member.value=student.id;updateEvidenceBadge();
  root.querySelector("[data-review-individual]").textContent="Individual review: "+name(student)+". Scores remain separate for each learner.";
 }
 async function openReview(){
  if(!context?.repository){updateStatus("This target has no linked repository. Use Observed activity to record a teacher-observed task.");return;}
  const key=context.assessment.id+":"+student.id;
  if(reviewKey===key&&!manual.classList.contains("hidden"))return;
  if(typeof window.openManualGradeReview!=="function"){
    updateStatus("Loading the review editor…");
    const expectedKey=key;
    const retry=()=>{if(context&&view==="grade"&&student&&context.assessment.id+":"+student.id===expectedKey)void openReview();};
    window.addEventListener("adminerva:manual-review-ready",retry,{once:true});
    return;
  }
  reviewKey=key;
  const end=window.beginLoading?.("Opening "+name(student)+"’s review…")||(()=>{});
  try{
    const result=await window.openManualGradeReview({studentId:student.id,taskId:context.assessment.id,owner:context.repository.owner,repo:context.repository.repo});
    if(result===false)reviewKey="";
  }finally{end();}
 }
 async function repository(){
  const box=panels.repository,generation=revision;box.replaceChildren();
  if(!context?.repository){box.append(make("p","No repository is linked to this target. Observed activity is available."));return;}
  const repo=context.repository,evidence=context.evidence.get(student.id),checkpoint=validSha(evidence?.checkpointSha)?evidence.checkpointSha:null;
  box.append(make("h3",repo.owner+"/"+repo.repo,"font-bold text-lg"),make("p",checkpoint?"Files at selected checkpoint "+checkpoint.slice(0,12):"Repository discovery view · current default branch. This is not verified student evidence.","text-sm text-slate-600"));
  const browser=make("div","","mt-4"),output=make("div","","mt-4");box.append(browser,output);
  const api="/repos/"+encodeURIComponent(repo.owner)+"/"+encodeURIComponent(repo.repo);
  async function directory(path=""){
   browser.replaceChildren(make("p","Loading repository files…","text-sm"));output.replaceChildren();
   try{
    const result=await requests.json(api+"/contents/"+path.split("/").map(encodeURIComponent).join("/")+(checkpoint?"?ref="+checkpoint:""));if(generation!==revision)return;
    browser.replaceChildren();
    if(path){const up=make("button","← Parent folder","av-secondary-button mb-3");up.type="button";up.onclick=()=>void directory(path.split("/").slice(0,-1).join("/"));browser.append(up);}
    if(!Array.isArray(result)){await file(result.path);return;}
    for(const entry of result.slice(0,100)){
     const button=make("button",(entry.type==="dir"?"Folder · ":"File · ")+entry.name,"av-workspace-file");button.type="button";button.onclick=()=>void(entry.type==="dir"?directory(entry.path):file(entry.path));browser.append(button);
    }
    if(result.length>100)browser.append(make("p","Showing the first 100 entries in this folder.","text-xs"));
   }catch(error){if(generation===revision)browser.replaceChildren(make("p","Files could not load: "+error.message+". Select Repository again to retry.","av-status-message"));}
  }
  async function file(path){
   output.replaceChildren(make("p","Loading "+path+"…","text-sm"));
   try{
    const result=await requests.json(api+"/contents/"+path.split("/").map(encodeURIComponent).join("/")+(checkpoint?"?ref="+checkpoint:""));if(generation!==revision)return;
    output.replaceChildren(make("h4",path,"font-semibold break-all"));
    if(result.size>200000||result.encoding!=="base64"||!result.content){output.append(make("p","This file is binary, empty, or larger than the 200 KB inline preview limit. Select another source file.","text-sm"));return;}
    const bytes=Uint8Array.from(atob(result.content.replace(/\s/g,"")),character=>character.charCodeAt(0));output.append(make("pre",new TextDecoder().decode(bytes),"av-workspace-source"));
   }catch(error){if(generation===revision)output.replaceChildren(make("p","Source unavailable: "+error.message,"av-status-message"));}
  }
  await directory();
 }
 async function contributions(){
  const box=panels.contributions,generation=revision;box.replaceChildren();
  if(!context?.repository){box.append(make("p","No repository is linked. Record observed work in Observed activity."));return;}
  const evidence=context.evidence.get(student.id),commits=evidence?.selectedCommits||[];
  box.append(make("h3","Selected contribution diffs · "+name(student),"font-bold text-lg"),make("p","Detected Git identities and change counts are investigation aids. They do not establish individual authorship. Verify contributions in Evidence before evaluation.","text-sm text-slate-600"));
  if(!commits.length){box.append(make("p","No commits are selected for this learner. Open Evidence to review a submission or discover historical evidence.","av-status-message"));return;}
  const api="/repos/"+encodeURIComponent(context.repository.owner)+"/"+encodeURIComponent(context.repository.repo);
  for(const sha of commits.slice(0,10)){
   if(!validSha(sha))continue;
   const details=make("details","","border rounded-lg p-3 mt-3");details.append(make("summary",sha.slice(0,12)+(evidence?.verifiedContributionCommits?.includes(sha)?" · Teacher verified":" · Requires verification"),"font-semibold"));box.append(details);
   try{const result=await requests.json(api+"/commits/"+sha+"?per_page=100");if(generation!==revision)return;
    details.append(make("p",result.commit?.message||"Commit message unavailable","text-sm whitespace-pre-wrap mt-2"),make("p","Detected GitHub account: "+(result.author?.login||"Unlinked")+" · Git author: "+(result.commit?.author?.name||"Unknown"),"text-xs mt-2"));
    for(const file of (result.files||[]).slice(0,30)){const section=make("details","","mt-2 border rounded p-2");section.append(make("summary",file.filename,"font-mono text-xs"),make("pre",file.patch||"Diff unavailable or binary file. No contribution inference was made.","av-workspace-source"));details.append(section);}
   }catch(error){if(generation===revision)details.append(make("p","Diff unavailable: "+error.message,"text-sm text-amber-800"));}
  }
  if(commits.length>10)box.append(make("p","Showing the first 10 selected commit diffs in this summary. Evidence retains the full selection.","text-xs"));
 }
 async function show(next){
  if(!context)return;
  if((next==="evidence"||next==="grade")&&!context.repository)next="activity";
  view=next;
  if(next==="evidence")next="grade";
  const review=next==="grade";
  for(const [key,panel]of Object.entries(panels))panel.hidden=key!==(review?"review":next);
  for(const button of root.querySelectorAll("[data-teaching-tab]")){const active=button.dataset.teachingTab===next;button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1;}
  manual.dataset.workspaceView=next;
  panels.review.setAttribute("aria-labelledby","teaching-tab-grade");
  updateStatus((context.assessment.title||context.assessment.id)+" · "+context.target.label+" · "+name(student));
  if(next==="inbox")summary();
  else if(review){await openReview();if(context.assessment.schemaVersion!==2)updateStatus("This assessment uses a repository submission receipt. Review the receipt and enter the teacher score below.");}
  else if(next==="repository")await repository();
  else if(next==="contributions")await contributions();
  else if(next==="activity")await mountActivity();
 }
 async function mountActivity(){
  const key=context.assessment.id+":"+context.target.id;if(activity&&activityKey===key)return;
  activity?.destroy();activityKey=key;const generation=revision;
  const module=await import("./manual-activity.mjs?v=1.3.0");if(generation!==revision)return;
  const students=[student,...context.students.filter(item=>item.id!==student.id)];
  activity=module.mountManualActivity({root:panels.activity,students,assessment:context.assessment,onSaved:()=>window.dispatchEvent(new CustomEvent("adminerva:activity-grade-saved"))});
 }
 function setContext(next){
  const changed=!context||context.assessment.id!==next.assessment.id||context.target.id!==next.target.id;
  if(changed){clear({force:true});context=next;student=next.students.find(item=>item.id===next.requestedStudent)||next.students[0];abort=new AbortController();let token="";try{token=localStorage.getItem("Adminerva_github_token")||"";}catch{}requests=createReviewRequests({token,signal:abort.signal});view="grade";}
  else context=next;
  root.hidden=false;root.querySelector("[data-review-context]").textContent=(next.assessment.title||next.assessment.id)+" · "+next.target.label;
  member.replaceChildren(...next.students.map(item=>new Option(name(item),item.id)));member.value=student.id;member.disabled=next.students.length<2;updateEvidenceBadge();
  root.querySelector("[data-review-individual]").textContent="Individual review: "+name(student)+". Scores remain separate for each learner.";
  void show(view);
 }
 member.onchange=()=>{const previous=student;if(!canLeave()){member.value=previous.id;return;}selectMember(context.students.find(item=>item.id===member.value));void show("grade");};
 for(const button of root.querySelectorAll("[data-teaching-tab]"))button.onclick=()=>void show(button.dataset.teachingTab);
 root.querySelector("[role=tablist]").addEventListener("keydown",event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;const buttons=[...root.querySelectorAll("[data-teaching-tab]")],index=buttons.indexOf(document.activeElement);let next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;event.preventDefault();buttons[next].focus();void show(buttons[next].dataset.teachingTab);});
 root.addEventListener("click",event=>{const target=event.target.closest("[data-review-step],#manualReviewVerifyContributions");if(target)void show(target.dataset.reviewStep==="integratedEvidence"||target.id==="manualReviewVerifyContributions"?"evidence":"grade");},true);
  panels.activity.addEventListener("change",event=>{if(event.target.matches("[data-activity-student]")){const next=context?.students.find(item=>item.id===event.target.value);if(next){student=next;member.value=next.id;reviewKey="";updateEvidenceBadge();root.querySelector("[data-review-individual]").textContent="Individual review: "+name(student)+". Scores remain separate for each learner.";}}});
 window.addEventListener("adminerva:manual-review-closed",()=>{reviewKey="";if(context&&view==="grade")void show("inbox");});
 return {setContext,canLeave,clear,show};
}
