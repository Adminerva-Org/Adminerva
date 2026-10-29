import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,doc,getDoc,getDocs,query,where,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.10";
import {studioDigest,verifyStudioSnapshot} from "../student/studio-assessment-model.mjs?v=1.0.0";

const node=id=>document.getElementById(id);
const root=node("studioReviewList"),detail=node("studioReviewDetail"),status=node("studioReviewStatus");
const add=(p,tag,text,classes="")=>{const n=document.createElement(tag);n.textContent=String(text??"");n.className=classes;p.append(n);return n;};
let records=[],role="",session=0,inspectionSequence=0,busy=false,selectedId=null,loading=false,activeUid=null;
const setStatus=text=>{status.textContent=text;};
function formatDate(value){try{return value?.toDate?.().toLocaleString()||"Date pending";}catch{return "Date unavailable";}}
function render(){
 root.replaceChildren();
 const visible=records.filter(data=>node("studioReviewFilter").value==="all"||
   data.status===node("studioReviewFilter").value);
 if(!visible.length){add(root,"p","No matching Studio submissions.","text-sm text-slate-500 p-3");return;}
 for(const item of visible){
   const box=add(root,"button","","border p-3 rounded-lg text-left hover:border-teal-500 focus-visible:outline-teal-600");
   box.type="button";
   box.setAttribute("aria-current",String(item.id===selectedId));
   add(box,"strong",item.projectTitle||"Studio project","block text-sm text-slate-900");
   add(box,"span",item.section+" · Revision "+item.revision+" · "+item.status,"block text-xs text-slate-600 mt-1");
   add(box,"span",formatDate(item.submittedAt),"block text-[11px] text-slate-500 mt-1");
   box.addEventListener("click",()=>void inspect(item));
 }
}
async function load(){
 if(loading)return;loading=true;node("studioReviewRefresh").disabled=true;
 const user=auth.currentUser,stamp=++session,ending=window.beginLoading?.("Loading Studio assessment submissions…")||(()=>{});
 try{
   if(!user?.uid)throw Error("Sign in with your teacher or administrator account.");
   const kind=await resolveStaffRole(user);
   if(!["teacher","admin"].includes(kind))throw Error("Teacher or administrator access required.");
   role=kind;activeUid=user.uid;
   let snapshots=[];
   if(kind==="admin")snapshots=[await getDocs(collection(db,"studio_submissions"))];
   else{
     const access=await getDoc(doc(db,"staff_access",String(user.email||"").toLowerCase()));
     const sections=access.exists()&&access.data().status==="active"?
       [...new Set((access.data().sections||[]).filter(x=>typeof x==="string"&&x))]:[];
     snapshots=await Promise.all(sections.map(section=>getDocs(query(collection(db,"studio_submissions"),where("section","==",section)))));
   }
   if(stamp!==session||auth.currentUser?.uid!==user.uid)return;
   const map=new Map();
   snapshots.forEach(snap=>snap.docs.forEach(record=>map.set(record.id,{id:record.id,...record.data()})));
   records=[...map.values()].sort((a,b)=>(b.submittedAt?.seconds||0)-(a.submittedAt?.seconds||0));
   setStatus(records.length+" Studio submissions found. Open a snapshot to review its exact submitted revision.");
   render();
   if(selectedId){
     const item=records.find(record=>record.id===selectedId);
     if(item)await inspect(item);else{selectedId=null;detail.textContent="Select a submission.";}
   }
 }catch(error){
   if(stamp===session){records=[];render();setStatus("Studio inbox could not load: "+error.message);}
 }finally{if(stamp===session)loading=false;node("studioReviewRefresh").disabled=false;ending();}
}
async function inspect(item){
 if(busy)return;
 selectedId=item.id;render();detail.replaceChildren();add(detail,"p","Loading exact saved revision…");
 const stamp=++inspectionSequence,uid=auth.currentUser?.uid;
 try{
   const [version,task,student,grade]=await Promise.all([
     getDoc(doc(db,"studio_submissions",item.id,"versions",String(item.revision))),
     getDoc(doc(db,"assessments",item.assessmentId)),
     getDoc(doc(db,"students",item.studentId)),
     getDoc(doc(db,"student_grades",item.id))
   ]);
   if(stamp!==inspectionSequence||auth.currentUser?.uid!==uid)return;
   if(!version.exists()||!task.exists())throw Error("The submitted revision or assessment is unavailable.");
   const saved=version.data(),assessment=task.data(),snapshot=verifyStudioSnapshot(saved.snapshotJson,saved.snapshotHash);
   const actual=await studioDigest(saved.snapshotJson);
   if(actual!==saved.snapshotHash||saved.snapshotHash!==item.snapshotHash)
     throw Error("The snapshot checksum no longer matches. Do not grade this revision.");
   detail.replaceChildren();
   add(detail,"h2",(student.data()?.name||item.studentId)+" · "+(item.projectTitle||"Studio project"),"text-xl font-extrabold text-slate-900");
   add(detail,"p",(assessment.title||"Assessment")+" · Revision "+item.revision+" · "+formatDate(item.submittedAt),"text-sm text-slate-600 mt-1");
   add(detail,"p","Snapshot SHA-256: "+actual,"font-mono text-[10px] break-all text-teal-800 mt-2");
   add(detail,"h3","Task and published rubric","font-bold mt-5");
   add(detail,"pre",String(assessment.taskContext||"")+'\n\n'+String(assessment.evalCriteria||""),"whitespace-pre-wrap text-xs bg-slate-50 rounded-lg border p-3 mt-2 max-h-60 overflow-auto");
   const files=add(detail,"section","","mt-4");
   add(files,"h3","Frozen project files ("+Object.keys(snapshot.files).length+")","font-bold");
   const selector=add(files,"select","","w-full border p-2 rounded-lg mt-2 mb-2 text-sm");
   for(const name of snapshot.fileOrder)selector.add(new Option(name,name));
   const source=add(files,"pre","","bg-slate-950 text-cyan-100 rounded-lg text-xs whitespace-pre-wrap break-words p-4 overflow-auto max-h-[340px]");
   const showFile=()=>{source.textContent=snapshot.files[selector.value]||"";};
   selector.addEventListener("change",showFile);showFile();
   if(snapshot.database?.tables){
     const dbInfo=add(detail,"details","","mt-4 border rounded-lg p-3");
     add(dbInfo,"summary","Database tables (submitted data)","font-semibold cursor-pointer");
     const counts=Object.entries(snapshot.database.tables).map(([name,table])=>name+": "+(table.rows||[]).length+" row(s)");
     add(dbInfo,"pre",counts.join("\n")||"No database tables.","whitespace-pre-wrap text-xs mt-2");
   }
   if(snapshot.design&&Object.keys(snapshot.design).length){
     const designs=add(detail,"details","","mt-3 border rounded-lg p-3");
     add(designs,"summary","Submitted system designs","font-semibold cursor-pointer");
     add(designs,"pre",JSON.stringify(snapshot.design,null,2),"whitespace-pre-wrap text-xs mt-2 overflow-auto max-h-48");
   }
   if(item.status==="reviewed")add(detail,"p","Reviewed. Existing private grade: "+(grade.exists()?grade.data().score+" / "+grade.data().maxScore:"Unavailable"),"text-sm font-semibold text-teal-900 mt-4");
   if(!["submitted","reviewed"].includes(item.status))return;
   if(item.status==="reviewed"&&grade.exists()&&grade.data().published){
     add(detail,"p","Published grade protected. Unpublish in Gradebook before requesting a revision.","text-sm text-amber-900 mt-2");
     return;
   }
   const form=add(detail,"section","","border-t mt-5 pt-4 grid gap-3");
   add(form,"h3","Teacher review (private until Gradebook publication)","font-bold");
   const note=add(form,"textarea","","w-full border rounded-lg p-3 text-sm");
   note.rows=3;note.maxLength=3000;note.placeholder="Review explanation, changed features, unresolved criteria or why revision is needed (15+ characters)";
   const max=Number(assessment.maxScore||20);
   const scoreLabel=add(form,"label","Score out of "+max,"text-sm font-bold");
   const score=add(scoreLabel,"input","","border rounded-lg p-2 block w-full mt-1");
   score.type="number";score.min="0";score.max=String(max);score.step=".01";
   const feedbackLabel=add(form,"label","Rubric feedback (20+ characters)","text-sm font-bold");
   const feedback=add(feedbackLabel,"textarea","","border rounded-lg p-3 w-full block mt-1 text-sm");
   feedback.rows=5;feedback.maxLength=6000;
   const buttons=add(form,"div","","flex gap-3 flex-wrap");
   const revise=add(buttons,"button","Request revision","border rounded-lg px-4 py-2 text-amber-950 bg-amber-100 font-semibold");
   const gradeBtn=add(buttons,"button","Save reviewed grade draft","bg-teal-700 text-white rounded-lg px-4 py-2 font-semibold");
   if(item.status==="reviewed"){
     gradeBtn.hidden=true;scoreLabel.hidden=true;feedbackLabel.hidden=true;
     note.placeholder="Explain why you are reopening this reviewed Studio submission. The current private grade becomes stale until the new revision is reviewed.";
   }
   const save=async(type)=>{
     if(busy)return;
     const reason=note.value.trim(),points=Number(score.value),text=feedback.value.trim();
     if(reason.length<15)return setStatus("Enter a review explanation of at least 15 characters.");
     if(type==="reviewed"&&(score.value.trim()===""||!Number.isFinite(points)||points<0||points>max||text.length<20))
       return setStatus("Enter a score within the assessment maximum and at least 20 characters of rubric feedback.");
     if(!confirm(type==="reviewed"?"Save this grade privately for Gradebook publication?":"Request a new student revision?"))return;
     busy=true;revise.disabled=true;gradeBtn.disabled=true;
     const loading=window.beginLoading?.("Recording Studio review…")||(()=>{});
     try{
       await runTransaction(db,async tx=>{
         const headRef=doc(db,"studio_submissions",item.id);
         const gradeRef=doc(db,"student_grades",item.id);
         const [latest,priorGrade,taskDoc]=await Promise.all([
           tx.get(headRef),tx.get(gradeRef),tx.get(doc(db,"assessments",item.assessmentId))
         ]);
         if(auth.currentUser?.uid!==uid)throw Error("Staff account changed. Review cancelled.");
         if(!latest.exists()||latest.data().revision!==item.revision||
           (type==="reviewed"&&latest.data().status!=="submitted")||
           (type==="revision_requested"&&!["submitted","reviewed"].includes(latest.data().status)))
           throw Error("The submitted revision changed. Refresh the inbox to review the latest work.");
         if(!taskDoc.exists()||taskDoc.data().schemaVersion!==3||taskDoc.data().maxScore!==max)
           throw Error("The assessment changed. Refresh before grading.");
         if(priorGrade.exists()&&priorGrade.data().published===true)
           throw Error("Published grade protected. Unpublish in Gradebook before revising.");
         tx.update(headRef,{status:type==="reviewed"?"reviewed":"revision_requested",
           reviewNote:reason,reviewedBy:uid,reviewedAt:serverTimestamp()});
         if(type==="reviewed"){
           const before=priorGrade.exists()?priorGrade.data():null;
           const after={
             ...(before||{}),studentId:item.studentId,taskId:item.assessmentId,section:item.section,
             gradeSource:"studio_teacher_review",studioRevision:item.revision,studioSnapshotHash:item.snapshotHash,
             score:points,maxScore:max,feedback:text,reviewRequired:false,published:false,
             reviewedBy:uid,teacherReviewNote:reason,manuallyAdjusted:true,
             reviewPriority:"ready_to_publish",gradedAt:new Date().toISOString(),
             gradeVersion:(Number(before?.gradeVersion)||0)+1
           };
           tx.set(gradeRef,after);
           tx.set(doc(collection(db,"grade_revisions")),{
             gradeId:item.id,studentId:item.studentId,taskId:item.assessmentId,
             editorUid:uid,reason:"Teacher reviewed Studio snapshot revision "+item.revision,
             before:before?{score:before.score,feedback:before.feedback,published:before.published}:null,
             after:{score:points,feedback:text,published:false},createdAt:serverTimestamp()
           });
         }
       });
       setStatus(type==="reviewed"?"Grade saved privately. Open Gradebook to publish it.":"Revision requested. The student may resubmit the project before the deadline.");
       busy=false;await load();
     }catch(error){setStatus("Review not saved: "+error.message);}
     finally{busy=false;revise.disabled=false;gradeBtn.disabled=false;loading();}
   };
   revise.addEventListener("click",()=>void save("revision_requested"));
   gradeBtn.addEventListener("click",()=>void save("reviewed"));
 }catch(error){
   if(stamp===inspectionSequence){detail.replaceChildren();add(detail,"p","Cannot inspect this submission: "+error.message,"text-rose-700 text-sm");}
 }
}
node("studioReviewRefresh").addEventListener("click",()=>void load());
node("studioReviewFilter").addEventListener("change",render);
onAuthStateChanged(auth,user=>{
 if(!user){session++;inspectionSequence++;records=[];selectedId=null;root.replaceChildren();detail.textContent="Sign in to review.";return;}
 void load();
});
