import {app,auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {collection,doc,getDoc,getDocs,query,where,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.10";
import {studioDigest,verifyStudioSnapshot} from "../student/studio-assessment-model.mjs?v=1.0.0";

const node=id=>document.getElementById(id);
const variantCall=httpsCallable(getFunctions(app,"asia-southeast1"),"studioAssessmentVariant");
const root=node("studioReviewList"),detail=node("studioReviewDetail"),status=node("studioReviewStatus");
const add=(p,tag,text,classes="")=>{const n=document.createElement(tag);n.textContent=String(text??"");n.className=classes;p.append(n);return n;};
let records=[],role="",session=0,inspectionSequence=0,busy=false,selectedId=null,loading=false,activeUid=null;
const link=new URLSearchParams(location.search);
const deepLink={assessment:link.get("assessment"),section:link.get("section"),student:link.get("student")};
let deepLinkPending=Boolean(deepLink.assessment);
const setStatus=text=>{status.textContent=text;};
function formatDate(value){try{return value?.toDate?.().toLocaleString()||"Date pending";}catch{return "Date unavailable";}}
function render(){
 root.replaceChildren();
 const visible=records.filter(data=>
   (!deepLink.assessment||data.assessmentId===deepLink.assessment)&&
   (!deepLink.section||data.section===deepLink.section)&&
   (node("studioReviewFilter").value==="all"||data.status===node("studioReviewFilter").value));
 const count=node("studioReviewCount");
 if(count)count.textContent=visible.length+" of "+records.length+" submissions shown · "+
   records.filter(item=>item.status==="submitted").length+" awaiting review · "+
   records.filter(item=>item.status==="revision_requested").length+" awaiting revision";
 if(!visible.length){add(root,"p","No matching Studio submissions.","text-sm text-slate-500 p-3");return;}
 for(const item of visible){
   const box=add(root,"button","","av-studio-submission-card border p-3 rounded-lg text-left hover:border-teal-500 focus-visible:outline-teal-600");
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
 root.setAttribute("aria-busy","true");
 const user=auth.currentUser,stamp=++session;inspectionSequence++;
 setStatus("Loading the submissions you are authorized to review…");
 const ending=()=>{root.setAttribute("aria-busy","false");};
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
   if(deepLinkPending){
     deepLinkPending=false;
     const matched=records.find(record=>record.assessmentId===deepLink.assessment&&
       (!deepLink.student||record.studentId===deepLink.student)&&
       (!deepLink.section||record.section===deepLink.section));
     if(matched)selectedId=matched.id;
     else setStatus("No accessible Studio submission matches this assessment and class yet.");
   }
   render();
   if(selectedId){
     const item=records.find(record=>record.id===selectedId);
     if(item)await inspect(item);else{selectedId=null;detail.textContent="Select a submission.";}
   }
 }catch(error){
   if(stamp===session){records=[];render();setStatus("Studio inbox could not load: "+error.message);}
 }finally{if(stamp===session){loading=false;node("studioReviewRefresh").disabled=false;ending();}}
}
async function inspect(item){
 if(busy)return;
 selectedId=item.id;render();detail.replaceChildren();detail.setAttribute("aria-busy","true");add(detail,"p","Loading exact saved revision…");
 const stamp=++inspectionSequence,uid=auth.currentUser?.uid;
 try{
   const [version,task,student,grade]=await Promise.all([
     getDoc(doc(db,"studio_submissions",item.id,"versions",String(item.revision))),
     getDoc(doc(db,"assessments",item.assessmentId)),
     getDoc(doc(db,"students",item.studentId)).catch(()=>null),
     getDoc(doc(db,"student_grades",item.id))
   ]);
   if(stamp!==inspectionSequence||auth.currentUser?.uid!==uid)return;
   if(!version.exists()||!task.exists())throw Error("The submitted revision or assessment is unavailable.");
   const saved=version.data(),assessment=task.data(),snapshot=verifyStudioSnapshot(saved.snapshotJson,saved.snapshotHash);
   const actual=await studioDigest(saved.snapshotJson);
   if(actual!==saved.snapshotHash||saved.snapshotHash!==item.snapshotHash)
     throw Error("The snapshot checksum no longer matches. Do not grade this revision.");
   let assignedVariant=null,variantError="";
   if(assessment.personalizedTask?.enabled===true){
     try{
       const response=await variantCall({action:"inspect",assessmentId:item.assessmentId,
         studentId:item.studentId,attempt:item.revision});
       assignedVariant=response.data;
       if(item.variantId&&assignedVariant.variantId!==item.variantId)
         throw Error("Submitted variant ID does not match the recorded personalized task.");
     }catch(error){assignedVariant=null;variantError=String(error?.message||"Personalized task unavailable.");}
   }
   if(stamp!==inspectionSequence||auth.currentUser?.uid!==uid)return;
   detail.replaceChildren();
   add(detail,"h2",(student?.data()?.name||item.studentId)+" · "+(item.projectTitle||"Studio project"),"text-xl font-extrabold text-slate-900");
   add(detail,"p",(assessment.title||"Assessment")+" · Revision "+item.revision+" · "+formatDate(item.submittedAt),"text-sm text-slate-600 mt-1");
   add(detail,"p","Snapshot SHA-256: "+actual,"font-mono text-[10px] break-all text-teal-800 mt-2");
   add(detail,"h3","Task and published rubric","font-bold mt-5");
   add(detail,"pre",String(assessment.taskContext||"")+'\n\n'+String(assessment.evalCriteria||""),"whitespace-pre-wrap text-xs bg-slate-50 rounded-lg border p-3 mt-2 max-h-60 overflow-auto");
   if(assignedVariant){
     add(detail,"h3","Learner's personalized task · Attempt "+assignedVariant.attempt+" · Variant "+assignedVariant.variantId,"font-bold mt-4 text-violet-950");
     add(detail,"pre",assignedVariant.prompt,"whitespace-pre-wrap text-xs bg-violet-50 text-violet-950 rounded-lg border border-violet-200 p-3 mt-2 max-h-72 overflow-auto");
     if(assignedVariant.evaluationNotes){
       const notes=add(detail,"details","","mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3");
       add(notes,"summary","Private variant evaluation notes","font-semibold text-xs cursor-pointer text-slate-800");
       add(notes,"pre",assignedVariant.evaluationNotes,"whitespace-pre-wrap text-xs text-slate-700 mt-2 max-h-48 overflow-auto");
     }
   }else if(assessment.personalizedTask?.enabled===true){
     add(detail,"p","Personalized task record could not be loaded: "+variantError,"text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3");
   }
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
   if(item.status==="reviewed")add(detail,"p",
     grade.exists()
       ?(grade.data().published?"Published grade: ":"Reviewed private grade: ")+grade.data().score+" / "+grade.data().maxScore
       :"Reviewed submission · grade unavailable",
     "text-sm font-semibold text-teal-900 mt-4");
   if(!["submitted","reviewed"].includes(item.status))return;
   if(item.status==="reviewed"&&grade.exists()&&grade.data().published){
     add(detail,"p","This reviewed Studio grade is published to the learner.","text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3 mt-3");
     const publishedActions=add(detail,"div","","flex flex-wrap gap-2 mt-3");
     const unpublish=add(publishedActions,"button","Unpublish for correction","border border-amber-300 bg-amber-50 text-amber-900 rounded-lg px-4 py-2 font-semibold");
     unpublish.addEventListener("click",async()=>{
       if(busy)return;
       if(!confirm("Unpublish this Studio grade so you can correct it or request a new revision? The learner will stop seeing the published result until you publish again."))return;
       busy=true;unpublish.disabled=true;
       const loading=window.beginLoading?.("Unpublishing Studio grade for correction…")||(()=>{});
       try{
         await runTransaction(db,async tx=>{
           const headRef=doc(db,"studio_submissions",item.id),gradeRef=doc(db,"student_grades",item.id);
           const [latest,latestGrade]=await Promise.all([tx.get(headRef),tx.get(gradeRef)]);
           if(auth.currentUser?.uid!==uid)throw Error("Staff account changed. Unpublish cancelled.");
           if(!latest.exists()||latest.data().status!=="reviewed"||
             latest.data().revision!==item.revision||
             String(latest.data().variantId||"")!==String(item.variantId||""))
             throw Error("The reviewed Studio submission changed. Refresh before editing its grade.");
           if(!latestGrade.exists()||latestGrade.data().published!==true)
             throw Error("This grade is no longer published.");
           const before=latestGrade.data();
           if(before.studentId!==item.studentId||before.taskId!==item.assessmentId||
             before.gradeSource!=="studio_teacher_review"||
             before.studioRevision!==item.revision||
             before.studioSnapshotHash!==item.snapshotHash||
             String(before.studioVariantId||"")!==String(item.variantId||"")||
             before.reviewedBy!==latest.data().reviewedBy||before.reviewRequired!==false)
             throw Error("The published grade no longer matches this reviewed Studio evidence.");
           tx.update(gradeRef,{published:false});
           tx.set(doc(collection(db,"grade_revisions")),{
             gradeId:item.id,studentId:item.studentId,taskId:item.assessmentId,
             editorUid:uid,reason:"Unpublished reviewed Studio grade for correction",
             before:{score:before.score,feedback:before.feedback,published:true},
             after:{score:before.score,feedback:before.feedback,published:false},
             createdAt:serverTimestamp()
           });
         });
         setStatus("Studio grade unpublished. You can now correct the reviewed score or request a new revision.");
         busy=false;await load();
       }catch(error){setStatus("Grade was not unpublished: "+error.message);}
       finally{busy=false;unpublish.disabled=false;loading();}
     });
     return;
   }
   const form=add(detail,"section","","border-t mt-5 pt-4 grid gap-3");
   const reviewedDraft=item.status==="reviewed"&&grade.exists()&&!grade.data().published;
   add(form,"h3",reviewedDraft?"Reviewed Studio grade · correction & publication":"Teacher review · private until publication","font-bold");
   const note=add(form,"textarea","","w-full border rounded-lg p-3 text-sm");
   note.rows=3;note.maxLength=3000;
   note.placeholder=reviewedDraft
     ?"Explain the grade correction or why a new student revision is needed (15+ characters)"
     :"Review explanation, changed features, unresolved criteria or why revision is needed (15+ characters)";
   const max=Number(assessment.maxScore||20);
   const scoreLabel=add(form,"label","Score out of "+max,"text-sm font-bold");
   const score=add(scoreLabel,"input","","border rounded-lg p-2 block w-full mt-1");
   score.type="number";score.min="0";score.max=String(max);score.step=".01";
   const feedbackLabel=add(form,"label","Rubric feedback (20+ characters)","text-sm font-bold");
   const feedback=add(feedbackLabel,"textarea","","border rounded-lg p-3 w-full block mt-1 text-sm");
   feedback.rows=5;feedback.maxLength=6000;
   if(reviewedDraft){
     score.value=String(grade.data().score??"");
     feedback.value=String(grade.data().feedback||"");
   }
   const buttons=add(form,"div","","flex gap-3 flex-wrap");
   const revise=add(buttons,"button","Request revision","border rounded-lg px-4 py-2 text-amber-950 bg-amber-100 font-semibold");
   const gradeBtn=add(buttons,"button",reviewedDraft?"Save grade correction":"Save reviewed grade draft","bg-teal-700 text-white rounded-lg px-4 py-2 font-semibold");
   const publishBtn=add(buttons,"button","Publish reviewed grade","bg-emerald-700 text-white rounded-lg px-4 py-2 font-semibold");
   publishBtn.hidden=!reviewedDraft;
   const publishReviewed=async()=>{
     if(busy||publishBtn.hidden)return;
     if(!confirm("Publish this reviewed Studio grade to the learner now?"))return;
     busy=true;revise.disabled=true;gradeBtn.disabled=true;publishBtn.disabled=true;
     const loading=window.beginLoading?.("Publishing reviewed Studio grade…")||(()=>{});
     try{
       await runTransaction(db,async tx=>{
         const headRef=doc(db,"studio_submissions",item.id),gradeRef=doc(db,"student_grades",item.id);
         const [latest,latestGrade,taskDoc]=await Promise.all([
           tx.get(headRef),tx.get(gradeRef),tx.get(doc(db,"assessments",item.assessmentId))
         ]);
         if(auth.currentUser?.uid!==uid)throw Error("Staff account changed. Publication cancelled.");
         if(!latest.exists()||latest.data().status!=="reviewed"||
           latest.data().revision!==item.revision||
           String(latest.data().variantId||"")!==String(item.variantId||""))
           throw Error("The reviewed Studio submission changed. Refresh before publishing.");
         if(!taskDoc.exists()||taskDoc.data().schemaVersion!==3)
           throw Error("This is no longer a Studio assessment.");
         if(!latestGrade.exists())throw Error("Save a reviewed Studio grade before publishing.");
         const before=latestGrade.data();
         if(before.published===true)return;
         if(before.studentId!==item.studentId||before.taskId!==item.assessmentId||
           before.gradeSource!=="studio_teacher_review"||
           before.studioRevision!==item.revision||
           before.studioSnapshotHash!==item.snapshotHash||
           String(before.studioVariantId||"")!==String(item.variantId||"")||
           before.reviewedBy!==latest.data().reviewedBy||before.reviewRequired!==false)
           throw Error("The grade no longer matches this reviewed Studio evidence.");
         tx.update(gradeRef,{published:true});
         tx.set(doc(collection(db,"grade_revisions")),{
           gradeId:item.id,studentId:item.studentId,taskId:item.assessmentId,
           editorUid:uid,reason:"Published reviewed Studio grade from Studio submissions",
           before:{score:before.score,feedback:before.feedback,published:false},
           after:{score:before.score,feedback:before.feedback,published:true},
           createdAt:serverTimestamp()
         });
       });
       setStatus("Studio grade published to the learner.");
       busy=false;await load();
     }catch(error){setStatus("Grade was not published: "+error.message);}
     finally{busy=false;revise.disabled=false;gradeBtn.disabled=false;publishBtn.disabled=false;loading();}
   };
   const save=async(type)=>{
     if(busy)return;
     const reason=note.value.trim(),points=Number(score.value),text=feedback.value.trim();
     if(reason.length<15)return setStatus("Enter a review or correction explanation of at least 15 characters.");
     if(["reviewed","corrected"].includes(type)&&(score.value.trim()===""||!Number.isFinite(points)||points<0||points>max||text.length<20))
       return setStatus("Enter a score within the assessment maximum and at least 20 characters of rubric feedback.");
     const prompt=type==="reviewed"
       ?"Save this reviewed Studio grade as a private draft?"
       :type==="corrected"
         ?"Save these corrected score and feedback changes as a private reviewed grade?"
         :"Request a new student revision?";
     if(!confirm(prompt))return;
     busy=true;revise.disabled=true;gradeBtn.disabled=true;publishBtn.disabled=true;
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
           String(latest.data().variantId||"")!==String(item.variantId||"")||
           (type==="reviewed"&&latest.data().status!=="submitted")||
           (type==="corrected"&&latest.data().status!=="reviewed")||
           (type==="revision_requested"&&!["submitted","reviewed"].includes(latest.data().status)))
           throw Error("The submitted revision or personalized task changed. Refresh the inbox to review the latest work.");
         if(!taskDoc.exists()||taskDoc.data().schemaVersion!==3||taskDoc.data().maxScore!==max)
           throw Error("The assessment changed. Refresh before grading.");
         if(priorGrade.exists()&&priorGrade.data().published===true)
           throw Error("Published grade protected. Unpublish it from this Studio review before revising.");
         if(type==="reviewed"){
           tx.update(headRef,{status:"reviewed",reviewNote:reason,reviewedBy:uid,reviewedAt:serverTimestamp()});
         }else if(type==="revision_requested"){
           tx.update(headRef,{status:"revision_requested",reviewNote:reason,reviewedBy:uid,reviewedAt:serverTimestamp()});
         }
         if(["reviewed","corrected"].includes(type)){
           const before=priorGrade.exists()?priorGrade.data():null;
           if(type==="corrected"&&(!before||before.published===true))
             throw Error("Only an unpublished reviewed Studio grade can be corrected here.");
           const evidenceReviewer=type==="corrected"?latest.data().reviewedBy:uid;
           const after={
             ...(before||{}),studentId:item.studentId,taskId:item.assessmentId,section:item.section,
             gradeSource:"studio_teacher_review",studioRevision:item.revision,studioSnapshotHash:item.snapshotHash,
             studioVariantId:String(item.variantId||""),
             score:points,maxScore:max,feedback:text,reviewRequired:false,published:false,
             reviewedBy:evidenceReviewer,teacherReviewNote:reason,manuallyAdjusted:true,
             reviewPriority:"ready_to_publish",gradedAt:new Date().toISOString(),
             gradeVersion:(Number(before?.gradeVersion)||0)+1
           };
           tx.set(gradeRef,after);
           tx.set(doc(collection(db,"grade_revisions")),{
             gradeId:item.id,studentId:item.studentId,taskId:item.assessmentId,
             editorUid:uid,reason:type==="corrected"
               ?"Corrected reviewed Studio grade for snapshot revision "+item.revision
               :"Teacher reviewed Studio snapshot revision "+item.revision,
             before:before?{score:before.score,feedback:before.feedback,published:before.published}:null,
             after:{score:points,feedback:text,published:false},createdAt:serverTimestamp()
           });
         }
       });
       setStatus(type==="reviewed"
         ?"Grade saved privately. The reviewed submission is ready to publish here."
         :type==="corrected"
           ?"Grade correction saved privately. Publish the reviewed grade when ready."
           :"Revision requested. The student may resubmit the project before the deadline.");
       busy=false;await load();
     }catch(error){setStatus("Review not saved: "+error.message);}
     finally{busy=false;revise.disabled=false;gradeBtn.disabled=false;publishBtn.disabled=false;loading();}
   };
   revise.addEventListener("click",()=>void save("revision_requested"));
   gradeBtn.addEventListener("click",()=>void save(reviewedDraft?"corrected":"reviewed"));
   publishBtn.addEventListener("click",()=>void publishReviewed());
 }catch(error){
   if(stamp===inspectionSequence){detail.replaceChildren();add(detail,"p","Cannot inspect this submission: "+error.message,"text-rose-700 text-sm");}
 }finally{if(stamp===inspectionSequence)detail.setAttribute("aria-busy","false");}
}
node("studioReviewRefresh").addEventListener("click",()=>void load());
node("studioReviewFilter").addEventListener("change",()=>{
 const filter=node("studioReviewFilter").value;
 if(selectedId&&!records.some(item=>item.id===selectedId&&(filter==="all"||item.status===filter))){
   selectedId=null;inspectionSequence++;detail.textContent="Choose a submission matching the selected status.";
   detail.setAttribute("aria-busy","false");
 }
 render();
});
onAuthStateChanged(auth,user=>{
 session++;inspectionSequence++;loading=false;busy=false;
 node("studioReviewRefresh").disabled=false;
 root.setAttribute("aria-busy","false");
 detail.setAttribute("aria-busy","false");
 if(!user){records=[];selectedId=null;root.replaceChildren();detail.textContent="Sign in to review.";return;}
 void load();
});