/** Repository-free activity marking inside the shared teacher workspace. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {doc,getDoc,getDocs,collection,query,where,limit,runTransaction,serverTimestamp} from "../core/teaching-firestore.mjs?v=1.3.0";
export function mountManualActivity({root,students,assessment,onSaved=()=>{}}){
  root.innerHTML=`<section class="rounded-xl border bg-white p-4 space-y-4"><div><h3 class="font-extrabold text-slate-900">Manual activity grade</h3><p class="text-sm text-slate-600 mt-1">Record an observed activity, demonstration, or offline task. A repository is optional. Each learner keeps an individual score.</p></div><form data-activity-form class="space-y-3"><label class="block text-sm font-semibold">Learner<select data-activity-student class="mt-1 w-full rounded-lg border p-2"></select></label><div class="grid sm:grid-cols-2 gap-3"><label class="block text-sm font-semibold">Score<input data-activity-score type="number" min="0" step="0.5" required class="mt-1 w-full rounded-lg border p-2"></label><label class="block text-sm font-semibold">Maximum<input data-activity-max type="number" min="1" max="1000" required class="mt-1 w-full rounded-lg border p-2"></label></div><label class="block text-sm font-semibold">Feedback <span class="font-normal">(optional for drafts)</span><textarea data-activity-feedback rows="3" maxlength="6000" class="mt-1 w-full rounded-lg border p-2" placeholder="What went well, and what should the learner try next?"></textarea></label><div class="flex flex-wrap gap-2"><button data-activity-save type="submit" class="rounded-lg bg-indigo-700 text-white px-4 py-2 font-bold">Save private draft</button><button data-activity-publish type="button" class="rounded-lg bg-emerald-700 text-white px-4 py-2 font-bold" disabled>Publish saved grade</button><button data-activity-unpublish type="button" class="rounded-lg border px-4 py-2 font-bold" hidden>Unpublish for revision</button></div><p data-activity-status role="status" class="text-sm text-slate-600"></p></form></section>`;
  const el=name=>root.querySelector("[data-activity-"+name+"]");
  const owner=auth.currentUser?.uid;let active=students[0],opened=null,loadedReference=null,dirty=false,destroyed=false,busy=false,ready=false,sequence=0;
  const status=text=>{if(!destroyed)el("status").textContent=text;};
  function reference(){return loadedReference||doc(db,"activity_grades",active.id+"_"+assessment.id+"_manual");}
  function controls(){
    const protectedGrade=opened?.published===true;
    for(const id of ["score","max","feedback","save"])el(id).disabled=busy||protectedGrade||!ready;
    el("student").disabled=busy;
    el("publish").disabled=busy||dirty||!opened||protectedGrade;el("publish").hidden=protectedGrade;el("unpublish").hidden=!protectedGrade;el("unpublish").disabled=busy;
  }
  async function load(){
    if(!active)return status("Choose a learner before recording a grade.");
    const generation=++sequence;busy=true;ready=false;opened=null;loadedReference=null;controls();status("Loading saved activity grade…");
    const end=window.beginLoading?.("Loading learner activity grade…",el("form"))||(()=>{});
    try{
      let snapshot=await getDoc(reference());
      if(!snapshot.exists()){
        const previous=await getDocs(query(collection(db,"activity_grades"),where("studentId","==",active.id),where("activity","==",String(assessment.title||assessment.id).slice(0,300)),limit(3)));
        const legacy=previous.docs.filter(record=>!record.data().taskId||record.data().taskId===assessment.id);
        if(legacy.length===1)snapshot=legacy[0];
      }
      if(destroyed||generation!==sequence)return;
      loadedReference=snapshot.ref;
      opened=snapshot.exists()?snapshot.data():null;el("score").value=opened?.score??"";el("max").value=opened?.maxScore||assessment.maxScore||20;el("score").max=el("max").value;el("feedback").value=opened?.feedback||"";dirty=false;ready=true;
      status(opened?.published?"Published grade. Unpublish before changing it.":opened?"Private draft loaded. Publish when ready.":"No activity grade saved yet. Enter a score to begin.");
    }catch(error){status("The saved grade could not load: "+error.message);return;}finally{busy=false;controls();end();}
  }
  async function write(published,unpublishReason=""){
    if(busy||destroyed)return;
    if(auth.currentUser?.uid!==owner)return status("Account changed. Reload this workspace.");
    if(!active||!assessment?.id)return status("Choose a class, assessment, and learner.");
    const raw=el("score").value,score=Number(raw),maxScore=Number(el("max").value),feedback=el("feedback").value.trim();
    if(!raw.trim()||!Number.isFinite(score)||!Number.isFinite(maxScore)||score<0||score>maxScore||maxScore<=0||maxScore>1000)return status("Enter a score between 0 and the maximum (up to 1,000).");
    if(published&&!feedback)return status("Add feedback for the student before publishing.");
    if(opened?.published&&!unpublishReason)return status("Unpublish the protected grade before changing it.");
    if(published&&!confirm("Publish this saved activity score and feedback to "+(active.name||active.id)+"?"))return;
    const ref=reference(),prior=opened;busy=true;controls();status(published?"Publishing saved activity grade…":"Saving activity grade…");
    const end=window.beginLoading?.(published?"Publishing learner activity grade…":unpublishReason?"Unpublishing learner activity grade…":"Saving learner activity draft…",el("form"))||(()=>{});
    try{
      await runTransaction(db,async transaction=>{
        const snapshot=await transaction.get(ref),current=snapshot.exists()?snapshot.data():null;
        if(auth.currentUser?.uid!==owner)throw Error("Account changed.");
        if((current?.gradeVersion||0)!==(prior?.gradeVersion||0)||Boolean(current?.published)!==Boolean(prior?.published))throw Error("This grade changed in another session. Reload before saving.");
        const after={studentId:active.id,section:active.section,githubUsername:active.githubUsername||"",activity:String(assessment.title||assessment.id).slice(0,300),taskId:assessment.id,score,maxScore,feedback,published,gradeVersion:(current?.gradeVersion||0)+1,gradedAt:new Date().toISOString(),reviewedBy:owner,reviewNote:unpublishReason||"Teacher recorded and reviewed this activity score and feedback.",updatedAt:serverTimestamp()};
        transaction.set(doc(ref,"versions",String(after.gradeVersion)),{before:current,after,actorUid:owner,createdAt:serverTimestamp()});transaction.set(ref,after);
      });
      if(destroyed)return;const fresh=await getDoc(ref);opened=fresh.data();dirty=false;status(published?"Activity grade published.":unpublishReason?"Grade unpublished. You can revise the private draft.":"Private activity grade saved. Publish separately when ready.");onSaved({studentId:active.id,assessmentId:assessment.id,activity:true});
    }catch(error){status("Activity grade unchanged: "+error.message);}finally{busy=false;controls();}
  }
  for(const student of students){const option=document.createElement("option");option.value=student.id;option.textContent=student.name||student.id;el("student").append(option);}
  el("student").onchange=()=>{const next=el("student").value;if(dirty&&!confirm("Discard this learner's unsaved activity grade?")){el("student").value=active.id;return;}active=students.find(student=>student.id===next);void load();};
  el("form").onsubmit=event=>{event.preventDefault();void write(false);};
  el("form").addEventListener("input",()=>{dirty=true;el("score").max=el("max").value;controls();});
  el("publish").onclick=()=>void write(true);
  el("unpublish").onclick=()=>{const reason=prompt("Reason for unpublishing this activity grade:");if(reason===null)return;if(reason.trim().length<15)return status("Enter a reason of at least 15 characters.");void write(false,reason.trim().slice(0,3000));};
  void load();
  return {hasUnsavedChanges:()=>dirty,destroy(){destroyed=true;sequence++;}};
}
