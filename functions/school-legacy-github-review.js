"use strict";
/**
 * Historical Repository Management GitHub review through the V4 teacher UI.
 *
 * This adapter never migrates legacy evidence/grades or invents V4 students,
 * enrollments, class offerings, or authoritative grade rows. The historical
 * evidence and student_grades documents remain the source of truth. Only the
 * original assessment owner within the explicitly imported school context
 * may inspect and grade, with immutable checkpoint/revision checks on writes.
 */
const {createHash}=require("node:crypto");
const {FieldValue,FieldPath}=require("firebase-admin/firestore");
const {TenantAccessError}=require("./tenant-access.js");
const {authorizedTeacherCustody,validCustody,custodySectionMatches,custodyMaximum,verifiedOriginalMaximum}=require("./school-legacy-custody.js");
const {originalReceipt,originalActivityGrade}=require("./school-legacy-recovery-sources.js");
const deny=(code,message)=>{throw new TenantAccessError(code,message)};
const hash=(...items)=>createHash("sha256").update(JSON.stringify(items)).digest("hex");
const validSha=value=>typeof value==="string"&&/^[a-f0-9]{40}$/i.test(value);
const validAssessmentId=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const legacyDocumentId=(value,label,max=500)=>{
 if(typeof value!=="string"||!value||value.length>max||Buffer.byteLength(value,"utf8")>1500||
    value==="."||value===".."||/[\\/\u0000-\u001f\u007f]/.test(value)||/^__.*__$/.test(value))
   deny("invalid-argument",label+" is invalid.");
 return value;
};
const clean=(value,max=5000)=>String(value??"").trim().slice(0,max);
function repoInfo(value){
 let url;
 try{url=new URL(String(value||""));}catch{deny("failed-precondition","Historical repository URL is invalid.");}
 const parts=url.pathname.replace(/\/$/,"").replace(/\.git$/i,"").split("/").filter(Boolean);
 if(url.protocol!=="https:"||url.hostname.toLowerCase()!=="github.com"||parts.length!==2||
    parts.some(x=>!(/^[A-Za-z0-9_.-]+$/.test(x))||x==="."||x==="..")||
    url.username||url.password||url.port||url.search||url.hash)
   deny("failed-precondition","Historical evidence must reference a valid GitHub repository.");
 return {fullName:parts.join("/"),url:"https://github.com/"+parts.join("/")};
}
function approvedEvidence(evidence,assessmentId,documentId,{requireSubmitted=false}={}){
 const studentId=legacyDocumentId(evidence?.studentId,"Historical student",220);
 if(evidence.assessmentId!==assessmentId||documentId!==studentId+"_"+assessmentId)
   deny("failed-precondition","Historical evidence belongs to a different learner or assessment.");
 const repository=repoInfo(evidence.repository);
 const selected=Array.isArray(evidence.selectedCommits)?evidence.selectedCommits:[];
 if(!validSha(evidence.checkpointSha)||selected.length>20||
    selected.some(sha=>!validSha(sha))||new Set(selected.map(sha=>sha.toLowerCase())).size!==selected.length)
   deny("failed-precondition","Historical selected commits or checkpoint are invalid.");
 const revision=Number(evidence.revision||0);
 if(!Number.isInteger(revision)||revision<0)
   deny("failed-precondition","Historical evidence revision is invalid.");
 const approved=evidence.status==="approved"&&validSha(evidence.approvedCheckpointSha)&&
   evidence.approvedCheckpointSha.toLowerCase()===evidence.checkpointSha.toLowerCase();
 const verified=Array.isArray(evidence.verifiedContributionCommits)?
   evidence.verifiedContributionCommits:[];
 if(verified.some(sha=>!validSha(sha)||!selected.some(x=>x.toLowerCase()===sha.toLowerCase()))||
    new Set(verified.map(x=>x.toLowerCase())).size!==verified.length)
   deny("failed-precondition","Verified individual contributions do not match the frozen commit selection.");
 // A teacher-discovered snapshot is NOT a student submission even if it was
 // subsequently teacher-approved. A historical student-resubmission may retain
 // source="teacher_discovered", so require the submittedAt receipt, not source.
 const hasSubmission=Boolean(evidence.submittedAt)&&selected.length>0&&
   ["submitted","approved","reviewed"].includes(evidence.status);
 if(requireSubmitted&&!hasSubmission)
   deny("failed-precondition","No student-submitted selected commits exist. Teacher-discovered snapshots cannot create grades.");
 return {studentId,repository,selected:selected.map(x=>x.toLowerCase()),
   verified:verified.map(x=>x.toLowerCase()),revision,
   checkpointSha:evidence.checkpointSha.toLowerCase(),approved,
   hasSubmission,discoveryOnly:!evidence.submittedAt&&evidence.source==="teacher_discovered",
   contributionScope:clean(evidence.contributionScope,3000)};
}
function validateCriteria(entries,rubric){
 if(!Array.isArray(entries)||entries.length!==rubric.length)
   deny("invalid-argument","Score every published rubric criterion.");
 let awarded=0,pending=0;
 const criteria=entries.map((entry,index)=>{
   const max=Number(rubric[index]?.points),score=entry?.awardedPoints,wait=entry?.pendingPoints;
   if(!Number.isFinite(max)||max<=0||typeof score!=="number"||!Number.isFinite(score)||
      typeof wait!=="number"||!Number.isFinite(wait)||score<0||wait<0||score+wait>max+0.000001)
     deny("invalid-argument","Criterion "+(index+1)+" exceeds its published maximum.");
   const comment=clean(entry?.comment,1000);
   awarded+=score;pending+=wait;
   return {name:String(rubric[index].name),maximum:max,awardedPoints:score,pendingPoints:wait,comment};
 });
 return {criteria,awarded,pending,total:rubric.reduce((sum,r)=>sum+Number(r.points),0)};
}
function gradeSummary(grade,rubric,verifiedMaximum=null){
 if(!grade)return null;
 const awarded=Number(grade.score),total=Number(grade.maxScore??verifiedMaximum);
 if(grade.score===null||grade.score===undefined||grade.score==="")
   deny("failed-precondition","Historical grade has no recorded score.");
 if(!Number.isFinite(awarded)||!Number.isFinite(total)||total<=0||awarded<0||awarded>total)
   deny("failed-precondition","Historical grade has invalid score bounds.");
 const prior=Array.isArray(grade.criteria)?grade.criteria:[];
 let matched=prior.length===rubric.length;
 if(matched)for(let i=0;i<rubric.length;i++){
   const item=prior[i];
   if(item?.name!==rubric[i].name||Number(item.maximum)!==Number(rubric[i].points)||
      !Number.isFinite(Number(item.awardedPoints))||!Number.isFinite(Number(item.pendingPoints))){
     matched=false;break;
   }
 }
 return {status:grade.published===true?"published":"draft",
   gradeSchema:matched?"rubric_v1":"legacy_scalar_v1",
   criteria:matched?prior:[],awarded,total,pending:Number(grade.pending||0),
   feedback:clean(grade.feedback,5000),
   draftSource:grade.evaluationSource==="external_ai"?"external_ai":
     grade.evaluationSource==="internal_ai"?"internal_ai":"teacher",
   revision:Number(grade.gradeVersion||1),
   version:Number(grade.evidenceRevision||0),
   publishedAt:grade.publishedAt?.toMillis?.()||null};
}
function createSchoolLegacyGithubReview({db,parseLegacyRubric,parseVerifiedLegacyRubric=parseLegacyRubric}){
 return async function review({ctx,input}){
   const id=input.legacyAssessmentId;
   if(!validAssessmentId(id))deny("invalid-argument","Invalid historical assessment identifier.");
   const taskRef=db.doc("assessments/"+id),task=await taskRef.get();
   if(!task.exists)deny("not-found","Original historical assessment not found.");
   const taskData=task.data();
   if(taskData.schoolId&&taskData.schoolId!==ctx.schoolId)deny("permission-denied","Original assessment is outside the selected school.");
   const isOwner=taskData.ownerUid===ctx.uid;
   const legacyOfferingId=String(input.legacyOfferingId||"");
   const custody=!isOwner&&legacyOfferingId?await authorizedTeacherCustody({
     db,schoolId:ctx.schoolId,teacherUid:ctx.uid,assessmentId:id,
     offeringId:legacyOfferingId,task:taskData
   }):null;
   if(!isOwner&&!custody)
     deny("permission-denied","Original assessment ownership or School Admin-approved class custody is required.");
   const grantedStudentIds=custody?new Set(custody.grant.verifiedLegacyStudentIds):null;
   function inScope(studentId,section){
     return !custody||grantedStudentIds.has(studentId)&&
       custodySectionMatches(custody.grant,section);
   }
   if(taskData.schemaVersion===3||taskData.submissionSource==="studio"||
      taskData.assessmentFormat==="studio_code")
     deny("failed-precondition","This historical assessment uses the Studio review adapter.");
   const prefix="schools/"+ctx.schoolId+"/";
   const importRef=db.doc(prefix+"assessment_blueprints/legacy_"+hash(ctx.schoolId,ctx.uid,id).slice(0,48));
   const imported=await importRef.get();
   if(isOwner&&(!imported.exists||imported.data().schoolId!==ctx.schoolId||
      imported.data().ownerUid!==ctx.uid||imported.data().legacyImport?.assessmentId!==id))
     deny("failed-precondition","Import this original assessment blueprint into the selected school before using V4 historical review.");
   const total=custody?custodyMaximum(taskData,custody.grant):Number(taskData.maxScore||20);
   if(!Number.isFinite(total)||total<=0||total>2000)
     deny("failed-precondition","Historical assessment maximum is invalid.");
   const verifiedRubric=parseVerifiedLegacyRubric(taskData.evalCriteria,total);
   const scalarOnly=!verifiedRubric;
   const rubric=verifiedRubric||[{name:"Original total score",points:total}];
   const taskInfo={
     taskId:legacyOfferingId&&custody?"legacy:"+id+"@"+legacyOfferingId:"legacy:"+id,
     legacyAssessmentId:id,legacyCompatibility:true,
     ...(custody?{legacyOfferingId,custodyApproved:true,originalSection:custody.grant.originalSection}:{ }),
     submissionSource:"github",title:clean(taskData.title||"Historical GitHub assessment",140),
     description:clean(taskData.description,2000),
     instructions:clean(taskData.taskContext||taskData.description,16000),
     rubric,historicalRubricMode:scalarOnly?"scalar_manual":"verified_rubric",rubricText:clean(taskData.evalCriteria,3500),
     maxScore:total,assessmentType:clean(taskData.type||"Assessment",80),
     subject:clean(taskData.subject||"Computer Programming",120),
     status:"deployed",published:taskData.published===true,
     personalizedTask:{enabled:taskData.assessmentMode==="personalized"||
       taskData.personalizedTask?.enabled===true},
     legacyReadThrough:true
   };
   const gradeRef=recordId=>db.doc("student_grades/"+recordId);
   async function verifiedRecord(recordId,read=ref=>ref.get()){
     const safe=legacyDocumentId(recordId,"Historical evidence document");
     const ref=db.doc("assessment_evidence/"+safe),snapshot=await read(ref);
     if(!snapshot.exists)deny("not-found","The original GitHub submission could not be found.");
     const data=snapshot.data();
     const meta=approvedEvidence(data,id,safe);
     if(!inScope(meta.studentId,data.section))
       deny("permission-denied","This student evidence is outside the verified historical class.");
     return {ref,snapshot,data,meta};
   }
   function checkpointMeta(snapshot){
     const receipt=originalReceipt(snapshot,id);
     if(!receipt)deny("failed-precondition","Original checkpoint receipt is invalid.");
     return {studentId:receipt.studentId,repository:repoInfo(receipt.repository),
       checkpointSha:receipt.checkpointSha,revision:0,selected:[],verified:[],approved:false,
       hasSubmission:true,discoveryOnly:false,contributionScope:"",
       receipt,receiptDigest:hash(receipt.receiptId,receipt.studentId,receipt.section,
         receipt.repository,receipt.checkpointSha,receipt.sourcePath,receipt.submittedAt,snapshot.data().submittedByUid)};
   }
   function newestReceipt(page,studentId){
     if(page.size>=1001)deny("resource-exhausted","Original receipt reconciliation requires pagination.");
     const rows=page.docs.map(doc=>originalReceipt(doc,id)).filter(row=>row&&row.studentId===studentId)
       .sort((a,b)=>b.submittedAt-a.submittedAt||a.receiptId.localeCompare(b.receiptId));
     if(rows.length>1&&rows[0].submittedAt===rows[1].submittedAt)return null;
     return rows[0]||null;
   }
   async function verifiedCheckpoint(recordId){
     const receiptId=legacyDocumentId(recordId.slice("receipt:".length),"Original checkpoint receipt",500);
     const ref=db.doc("student_submissions/"+receiptId),snapshot=await ref.get();
     if(!snapshot.exists)deny("not-found","Original checkpoint receipt not found.");
     const meta=checkpointMeta(snapshot),canonicalId=legacyDocumentId(meta.studentId+"_"+id,"Original grade");
     if(!inScope(meta.studentId,meta.receipt.section))
       deny("permission-denied","Original checkpoint is outside the verified class.");
     const [modern,page]=await Promise.all([db.doc("assessment_evidence/"+canonicalId).get(),
       db.collection("student_submissions").where("assessmentId","==",id).limit(1001).get()]);
     if(modern.exists||newestReceipt(page,meta.studentId)?.receiptId!==receiptId)
       deny("failed-precondition","A newer or conflicting submission exists. Reconcile the original evidence.");
     return {ref,snapshot,data:snapshot.data(),meta,canonicalId,checkpointOnly:true};
   }
   function checkGrade(grade,studentId){
     if(grade&&(grade.studentId!==studentId||grade.taskId!==id||(grade.schoolId&&grade.schoolId!==ctx.schoolId)))
       deny("failed-precondition","Historical grade belongs to a different learner or assessment.");
   }
   if(input.action==="legacy_github_bulk_publish"){
     // Publish only teacher-reviewed, non-zero original grade drafts whose
     // immutable student-submitted SHA receipt still passes the *same*
     // transactional checks used by publishing a single learner. Pagination
     // is bounded and idempotent: already published scores remain untouched.
     const cursor=input.cursor?legacyDocumentId(input.cursor,"Historical publication cursor"):null;
     if(input.checkpointOnly===true){
       const query=db.collection("student_grades").where("taskId","==",id).orderBy(FieldPath.documentId());
       const page=await (cursor?query.startAfter(cursor).limit(40):query.limit(40)).get();
       let published=0,failed=0;
       for(const doc of page.docs){
         const grade=doc.data();
         if(grade.published===true||!grade.checkpointReceiptId||!grade.checkpointReceiptDigest||!inScope(grade.studentId,grade.section))continue;
         if(doc.id!==grade.studentId+"_"+id){failed++;continue;}
         try{await review({ctx,input:{action:"legacy_github_publish",legacyAssessmentId:id,legacyEvidenceId:"receipt:"+grade.checkpointReceiptId,
           ...(custody?{legacyOfferingId}:{}),expectedEvidenceRevision:0,expectedCheckpointSha:grade.gradedSha,
           expectedReceiptDigest:grade.checkpointReceiptDigest,expectedGradeRevision:Number(grade.gradeVersion||0)}});published++;}catch{failed++;}
       }
       return {published,failed,zeroSkipped:0,unverifiedSkipped:0,hasMore:page.size===40,nextCursor:page.size===40?page.docs.at(-1).id:null};
     }
     const base=db.collection("assessment_evidence").where("assessmentId","==",id)
       .orderBy(FieldPath.documentId());
     const page=await (cursor?base.startAfter(cursor).limit(40):base.limit(40)).get();
     let published=0,failed=0,zeroSkipped=0,unverifiedSkipped=0;
     for(const row of page.docs){
       let evidence;
       try{evidence=approvedEvidence(row.data(),id,row.id,{requireSubmitted:true});}
       catch{unverifiedSkipped++;continue;}
       if(!inScope(evidence.studentId,row.data().section))continue;
       const current=await gradeRef(row.id).get();
       if(!current.exists||current.data().published===true)continue;
       const grade=current.data();
       if(grade.studentId!==evidence.studentId||grade.taskId!==id){failed++;continue;}

       try{
         await review({ctx,input:{
           action:"legacy_github_publish",legacyAssessmentId:id,legacyEvidenceId:row.id,
           ...(custody?{legacyOfferingId}:{}),
           expectedEvidenceRevision:evidence.revision,
           expectedCheckpointSha:evidence.checkpointSha,
           expectedGradeRevision:Number(grade.gradeVersion||0)
         }});
         published++;
       }catch{failed++;}
     }
     return {published,failed,zeroSkipped,unverifiedSkipped,
       nextCursor:page.size===40?page.docs[page.docs.length-1].id:null,
       hasMore:page.size===40};
   }
   if(input.action==="legacy_github_inbox"){
     const queryBase=db.collection("assessment_evidence").where("assessmentId","==",id)
       .orderBy(FieldPath.documentId());
     let cursor="",rows=[],scanned=0;
     for(;;){
       const q=cursor?queryBase.startAfter(cursor).limit(80):queryBase.limit(80);
       const page=await q.get();
       scanned+=page.docs.length;
       if(scanned>1000)deny("resource-exhausted","Historical repository inbox needs a narrower paginated view.");
       for(const doc of page.docs){
         const data=doc.data();
         // Authorize the exact original identity before parsing evidence. A
         // malformed older receipt is an exception, not an inbox-wide failure.
         let studentId;
         try{studentId=legacyDocumentId(data?.studentId,"Historical student",220);}
         catch{continue;}
         if(data.assessmentId!==id||doc.id!==studentId+"_"+id||!inScope(studentId,data.section))continue;
         let meta;
         try{meta=approvedEvidence(data,id,doc.id);}
         catch(error){
           if(!(error instanceof TenantAccessError))throw error;
           rows.push({evidenceId:doc.id,studentId,studentUid:studentId,
             section:clean(data.section,160),status:"historical_evidence_exception",
             evidenceException:true,hasSubmission:false,discoveryOnly:false});
           continue;
         }
         rows.push({evidenceId:doc.id,studentId:meta.studentId,studentUid:meta.studentId,
           section:clean(data.section,160),status:data.status||"submitted",
           version:meta.revision||1,updatedAt:data.submittedAt?.toMillis?.()||null,
           selectedCount:meta.selected.length,verifiedCount:meta.verified.length,
           approved:meta.approved,hasSubmission:meta.hasSubmission,
           discoveryOnly:meta.discoveryOnly});
       }
       if(page.size<80)break;
       cursor=page.docs[page.docs.length-1].id;
     }
     // Only records belonging to the owner's original evidence are returned;
     // names are descriptive, not a basis for school identity or enrollment.
     const results=[];
     for(let offset=0;offset<rows.length;offset+=40){
       const batch=rows.slice(offset,offset+40);
       const [people,grades]=await Promise.all([
         Promise.all(batch.map(row=>db.doc("students/"+row.studentId).get())),
         Promise.all(batch.map(row=>gradeRef(row.evidenceId).get()))
       ]);
       for(let i=0;i<batch.length;i++){
         const row=batch[i],person=people[i].exists?people[i].data():{},
           grade=grades[i].exists?grades[i].data():null;
         let gradeException=false;
         try{
           checkGrade(grade,row.studentId);
           if(grade&&!inScope(row.studentId,grade.section||row.section))
             deny("failed-precondition","Historical grade is outside this class.");
           if(grade)gradeSummary(grade,rubric,custody?total:null);
         }catch(error){
           if(!(error instanceof TenantAccessError))throw error;
           gradeException=true;
         }
         results.push({...row,studentName:clean(person.name||row.studentId,160),
           ...(gradeException?{gradeException:true,hasSubmission:false}:{}),
           gradeStatus:gradeException?null:grade?.published===true?"published":grade?"draft":null,
           reviewSuggested:!gradeException&&!!grade&&grade.published!==true,
           gradeRevision:gradeException||!grade?0:Number(grade.gradeVersion||1),
           awarded:gradeException||!grade?null:Number(grade.score),
           maxScore:gradeException||!grade?null:Number(grade.maxScore??(custody?total:null)),
           pending:gradeException||!grade?0:Number(grade.pending||0)});
       }
     }
     // Original scalar grades can outlive evidence or use a different receipt
     // key. Show them as protected outcomes, but NEVER treat such rows as new
     // student-submitted evidence or enable edits without a verified receipt.
     const [gradePage,earlierReceipts,activityPage]=await Promise.all([
       db.collection("student_grades").where("taskId","==",id).limit(1001).get(),
       db.collection("student_submissions").where("assessmentId","==",id).limit(1001).get(),
       db.collection("activity_grades").where("taskId","==",id).limit(1001).get()
     ]);
     if([gradePage,earlierReceipts,activityPage].some(page=>page.size>=1001))
       deny("resource-exhausted","The original submission or grade ledger requires pagination.");
     const seen=new Set(results.map(row=>row.studentId));
     let gradeOnly=0,publishedCount=0,draftCount=0;
     const byStudent=new Map(results.map(row=>[row.studentId,row]));
     for(const doc of gradePage.docs){
       const grade=doc.data();
       if(grade.taskId!==id||typeof grade.studentId!=="string"||
          !inScope(grade.studentId,grade.section)||(grade.schoolId&&grade.schoolId!==ctx.schoolId))continue;
       try{legacyDocumentId(grade.studentId,"Historical student",220);}catch{continue;}
       const existing=byStudent.get(grade.studentId);
       if(existing&&doc.id!==existing.evidenceId){
         // Do not create a parallel grade when the original used another key.
         existing.gradeException=true;existing.hasSubmission=false;
         existing.gradeStatus=null;existing.awarded=null;
         continue;
       }
       if(grade.score===null||grade.score===undefined||grade.score==="")continue;
       const awarded=Number(grade.score),maximum=Number(grade.maxScore||total);
       if(!Number.isFinite(awarded)||!Number.isFinite(maximum)||awarded<0||
          awarded>maximum||maximum<=0)continue;
       if(grade.published===true)publishedCount++;else draftCount++;
       if(seen.has(grade.studentId))continue;
       seen.add(grade.studentId);gradeOnly++;
       const person=await db.doc("students/"+grade.studentId).get();
       const gradeRow={evidenceId:null,studentId:grade.studentId,studentUid:grade.studentId,
         studentName:clean(person.exists?person.data().name:grade.studentId,160),
         section:clean(grade.section,160),status:"grade_only",
         gradeOnly:true,hasSubmission:false,discoveryOnly:false,
         gradeStatus:grade.published===true?"published":"draft",reviewSuggested:grade.published!==true,awarded,
         maxScore:maximum,pending:Number(grade.pending||0),gradeRevision:Number(grade.gradeVersion||1),
         originalGradeId:doc.id,checkpointReceiptId:grade.checkpointReceiptId||null};
       results.push(gradeRow);byStudent.set(grade.studentId,gradeRow);
     }
     const primaryIds=new Set(gradePage.docs.map(doc=>doc.data()).filter(row=>row.taskId===id).map(row=>row.studentId));
     const modernIds=new Set(rows.map(row=>row.studentId));
     async function ensureRow(studentId,section){
       if(byStudent.has(studentId))return byStudent.get(studentId);
       const person=await db.doc("students/"+studentId).get();
       const row={evidenceId:null,studentId,studentUid:studentId,studentName:clean(person.exists?person.data().name:studentId,160),
         section:clean(section,160),hasSubmission:false,gradeStatus:null,awarded:null};
       results.push(row);byStudent.set(studentId,row);return row;
     }
     // Keep earlier submitted checkpoint receipts as original, inspectable
     // evidence. Never convert a checkpoint into a student-selected commit.
     const receiptsByStudent=new Map();
     for(const doc of earlierReceipts.docs){
       const receipt=originalReceipt(doc,id);
       if(!receipt||!inScope(receipt.studentId,receipt.section))continue;
       const list=receiptsByStudent.get(receipt.studentId)||[];
       list.push(receipt);receiptsByStudent.set(receipt.studentId,list);
     }
     for(const [studentId,list] of receiptsByStudent){
       list.sort((a,b)=>b.submittedAt-a.submittedAt||a.receiptId.localeCompare(b.receiptId));
       const row=await ensureRow(studentId,list[0].section);
       row.originalReceipts=list.slice(0,20);
       row.originalReceiptCount=list.length;
       if(!row.hasSubmission){
         row.receiptOnly=true;row.status="historical_checkpoint_receipt";
         const canonicalId=studentId+"_"+id;
         if(!modernIds.has(studentId)&&!row.evidenceId&&!row.gradeException&&
            (list.length===1||list[0].submittedAt!==list[1].submittedAt)&&
            (!primaryIds.has(studentId)||(row.originalGradeId===canonicalId&&row.checkpointReceiptId===list[0].receiptId))){
           row.checkpointGradeable=true;row.version=1;row.evidenceId="receipt:"+list[0].receiptId;
           row.gradeOnly=false;
         }
       }
     }
     // An activity score is an original result, not a new grade. Do not
     // prefer it over any primary student_grades record, even an invalid one.
     const activitiesByStudent=new Map();
     for(const doc of activityPage.docs){
       const data=doc.data();
       if(data.taskId!==id||typeof data.studentId!=="string"||!inScope(data.studentId,data.section))continue;
       try{legacyDocumentId(data.studentId,"Historical student",220);}catch{continue;}
       const list=activitiesByStudent.get(data.studentId)||[];
       list.push({id:doc.id,grade:data.schoolId&&data.schoolId!==ctx.schoolId?null:originalActivityGrade(doc,id)});activitiesByStudent.set(data.studentId,list);
     }
     let activityGradeCount=0;
     for(const [studentId,list] of activitiesByStudent){
       if(primaryIds.has(studentId))continue;
       const row=await ensureRow(studentId,list[0]?.grade?.section||"");
       if(list.length!==1||!list[0]?.grade){
         row.gradeException=true;row.hasSubmission=false;row.checkpointGradeable=false;continue;
       }
       const grade=list[0].grade;
       let validId=true;try{legacyDocumentId("activity:"+list[0].id,"Original activity reference");}catch{validId=false;}
       const editable=validId&&grade.maxScore===total&&grade.pending===0&&Number.isSafeInteger(grade.gradeVersion??0)&&(grade.gradeVersion??0)>=0&&(!grade.schoolId||grade.schoolId===ctx.schoolId);
       Object.assign(row,{activityOnly:true,activityEditable:editable,activityGradeId:list[0].id,
         ...(editable?{evidenceId:"activity:"+list[0].id,gradeOnly:false}:{}),gradeStatus:grade.published===true?"published":"draft",
         awarded:grade.score,maxScore:grade.maxScore,pending:grade.pending,reviewSuggested:grade.published!==true,
         gradeRevision:Number(grade.gradeVersion||1),hasSubmission:false,checkpointGradeable:false});
       activityGradeCount++;if(grade.published===true)publishedCount++;else draftCount++;
     }
     for(const row of results){
       if(row.gradeOnly&&row.originalGradeId&&!row.gradeException&&!row.activityOnly){
         try{legacyDocumentId("grade:"+row.originalGradeId,"Original grade history reference");row.gradeHistoryOnly=true;row.evidenceId="grade:"+row.originalGradeId;}catch{}
       }
     }
     return {task:taskInfo,evidence:results,coverage:{
       evidenceCount:rows.length,gradeCount:publishedCount+draftCount,
       originalReceiptCount:[...receiptsByStudent.values()].reduce((sum,list)=>sum+list.length,0),activityGradeCount,
       evidenceExceptions:results.filter(row=>row.evidenceException).length,
       gradeExceptions:results.filter(row=>row.gradeException).length,
       publishedCount,draftCount,gradeOnly,evidenceWithoutGrade:
         results.filter(row=>!row.gradeStatus&&!row.gradeOnly).length
     }};
   }
   const recordId=legacyDocumentId(input.legacyEvidenceId,"Historical submission ID");
   if(recordId.startsWith("grade:")){
     if(!["legacy_github_inspect","legacy_github_history"].includes(input.action))
       deny("failed-precondition","Original grade-only records cannot be edited without verified evidence.");
     const gradeId=legacyDocumentId(recordId.slice("grade:".length),"Original grade ID");
     const source=await gradeRef(gradeId).get(),grade=source.exists?source.data():null;
     if(!grade||grade.taskId!==id||typeof grade.studentId!=="string"||
        !inScope(grade.studentId,grade.section)||(grade.schoolId&&grade.schoolId!==ctx.schoolId))
       deny("permission-denied","Original score is outside the verified assessment and class.");
     const page=await db.collection("student_grades").where("taskId","==",id).limit(1001).get();
     if(page.size>=1001||page.docs.filter(doc=>doc.data().studentId===grade.studentId).length!==1)
       deny("failed-precondition","Original grade identity requires reconciliation.");
     const summary=gradeSummary(grade,rubric,custody?total:null);
     if(input.action==="legacy_github_history")return require("./school-grade-revision-history.js").readLegacyGradeHistory({
       db,schoolId:ctx.schoolId,taskId:id,studentId:grade.studentId,gradeId
     });
     return {task:taskInfo,snapshot:{gradeHistoryOnly:true,status:"recorded",version:summary.revision,hasSubmission:false},
       grade:summary};
   }
   if(recordId.startsWith("activity:")){
     if(!["legacy_github_inspect","legacy_github_history","legacy_github_activity_edit"].includes(input.action))
       deny("failed-precondition","Original activity scores use individual score editing, not submission grading.");
     const activityId=legacyDocumentId(recordId.slice("activity:".length),"Original activity grade ID");
     const ref=db.doc("activity_grades/"+activityId);
     const stateDigest=data=>hash(data.studentId,data.taskId,data.schoolId||null,data.section||null,
       data.score,data.maxScore,data.pending??0,data.published??null,data.gradeVersion??0,
       data.feedback??null,data.reviewedBy??null,data.gradedAt??null);
     return db.runTransaction(async tx=>{
       const [freshTask,freshImport,source,primaryPage,activityPage,freshCustody,freshAssignment,freshMembership,freshOffering]=await Promise.all([
         tx.get(taskRef),tx.get(importRef),tx.get(ref),
         tx.get(db.collection("student_grades").where("taskId","==",id).limit(1001)),
         tx.get(db.collection("activity_grades").where("taskId","==",id).limit(1001)),
         custody?tx.get(custody.ref):Promise.resolve(null),
         custody?tx.get(db.doc(prefix+"staff_assignments/"+require("./school-academics.js").rowKey(ctx.uid,legacyOfferingId))):Promise.resolve(null),
         custody?tx.get(db.doc(prefix+"memberships/"+ctx.uid)):Promise.resolve(null),
         custody?tx.get(db.doc(prefix+"course_offerings/"+legacyOfferingId)):Promise.resolve(null)
       ]);
       const before=source.exists?source.data():null;
       const original=originalActivityGrade(source,id);
       if(!original||!inScope(original.studentId,original.section)||(original.schoolId&&original.schoolId!==ctx.schoolId))
         deny("permission-denied","Activity grade is outside the verified historical assessment.");
       const sourceUnchanged=freshTask.exists&&(!freshTask.data().schoolId||freshTask.data().schoolId===ctx.schoolId)&&
         freshTask.data().evalCriteria===taskData.evalCriteria&&
         (custody?custodyMaximum(freshTask.data(),freshCustody?.data()):Number(freshTask.data().maxScore||20))===total;
       const ownerActive=sourceUnchanged&&isOwner&&freshTask.data().ownerUid===ctx.uid&&freshImport.exists&&
         freshImport.data().schoolId===ctx.schoolId&&freshImport.data().ownerUid===ctx.uid&&freshImport.data().legacyImport?.assessmentId===id;
       const approved=sourceUnchanged&&!!custody&&validCustody(freshCustody?.exists?freshCustody.data():null,{
         schoolId:ctx.schoolId,assessmentId:id,offeringId:legacyOfferingId,teacherUid:ctx.uid,task:freshTask.data(),section:original.section
       })&&freshOffering?.exists&&freshOffering.data().schoolId===ctx.schoolId&&freshOffering.data().primaryTeacherUid===ctx.uid&&
         freshAssignment?.exists&&freshAssignment.data().schoolId===ctx.schoolId&&freshAssignment.data().status==="active"&&
         freshAssignment.data().teacherUid===ctx.uid&&freshAssignment.data().offeringId===legacyOfferingId&&
         freshMembership?.exists&&freshMembership.data().schoolId===ctx.schoolId&&freshMembership.data().status==="active"&&
         freshMembership.data().roles?.includes("teacher")&&freshCustody.data().verifiedLegacyStudentIds.includes(original.studentId);
       if(!ownerActive&&!approved)deny("permission-denied","Original ownership or verified class custody changed.");
       if(primaryPage.size>=1001||activityPage.size>=1001)deny("resource-exhausted","Original grades require reconciliation before editing.");
       if(primaryPage.docs.some(doc=>doc.data().studentId===original.studentId)||
          activityPage.docs.filter(doc=>doc.data().studentId===original.studentId).length!==1)
         deny("failed-precondition","Conflicting original grade records require reconciliation.");
       if(custody?.grant.maximumProof==="consistent_original_grade_maxima"){
         const basis=verifiedOriginalMaximum(freshTask.data(),primaryPage.docs.map(doc=>doc.data()),id,freshCustody.data().verifiedLegacyStudentIds);
         if(basis?.maximum!==total||basis.proof!==custody.grant.maximumProof)
           deny("failed-precondition","Original maximum proof changed.");
       }
       const version=before.gradeVersion??0;
       if(original.maxScore!==total||original.pending!==0||!Number.isSafeInteger(version)||version<0)
         deny("failed-precondition","Original activity maximum, pending points or revision requires reconciliation.");
       if(input.action==="legacy_github_history"){
         const page=await tx.get(db.collection("activity_grades/"+activityId+"/versions").limit(201));
         return {entries:page.size>=201?[]:require("./school-grade-revision-history.js").activityRevisionRows(page.docs,{
           schoolId:ctx.schoolId,taskId:id,studentId:original.studentId,gradeId:activityId
         }),limitReached:page.size>=201};
       }
       if(input.action==="legacy_github_inspect")return {task:taskInfo,
         snapshot:{activityOnly:true,activityDigest:stateDigest(before),version,status:"recorded",hasSubmission:false},
         grade:{status:before.published===true?"published":"draft",gradeSchema:"activity_scalar_v1",
           awarded:original.score,total:original.maxScore,pending:0,revision:version,
           criteria:[{name:"Activity score",maximum:total,awardedPoints:original.score,pendingPoints:0,comment:""}],
           feedback:clean(before.feedback,5000),draftSource:"teacher"}};
       if(input.expectedActivityDigest!==stateDigest(before)||input.expectedGradeRevision!==version)
         deny("failed-precondition","Activity score changed. Reload before editing.");
       if(typeof input.score!=="number"||!Number.isFinite(input.score)||input.score<0||input.score>total||
          typeof input.feedback!=="string"||input.feedback.length>5000)
         deny("invalid-argument","Enter a valid original activity score and feedback.");
       const now=FieldValue.serverTimestamp(),revision=version+1;
       const changes={score:input.score,feedback:input.feedback.trim(),gradeVersion:revision,
         reviewedBy:ctx.uid,updatedAt:now,lastCorrectedByUid:ctx.uid,lastCorrectedAt:now};
       const auditState=data=>({studentId:data.studentId,taskId:data.taskId,section:data.section||"",
         score:Number(data.score),maxScore:Number(data.maxScore),published:data.published===true,gradeVersion:data.gradeVersion??0,
         feedback:clean(data.feedback,5000),pending:Number(data.pending??0)});
       tx.create(db.doc("activity_grades/"+activityId+"/versions/"+revision),{
         schoolId:ctx.schoolId,gradeId:activityId,taskId:id,studentId:original.studentId,
         actorUid:ctx.uid,createdAt:now,before:auditState(before),after:auditState({...before,...changes})
       });
       tx.update(ref,changes);
       return {status:before.published===true?"published":"draft",revision,awarded:input.score,total};
     });
   }
   const checkpointOnly=recordId.startsWith("receipt:");
   const record=checkpointOnly?await verifiedCheckpoint(recordId):await verifiedRecord(recordId);
   const meta=record.meta,canonicalId=checkpointOnly?record.canonicalId:recordId;
   if(input.action==="legacy_github_history"){
     const grade=await gradeRef(canonicalId).get();
     if(grade.exists){
       checkGrade(grade.data(),meta.studentId);
       if(!inScope(meta.studentId,grade.data().section||record.data.section))
         deny("permission-denied","Grade history is outside the verified class.");
     }
     return require("./school-grade-revision-history.js").readLegacyGradeHistory({
       db,schoolId:ctx.schoolId,taskId:id,studentId:meta.studentId,gradeId:canonicalId
     });
   }
   if(input.action==="legacy_github_inspect"){
     const [grade,privateTask]=await Promise.all([
       gradeRef(canonicalId).get(),db.doc("assessment_private/"+id).get()
     ]);
     checkGrade(grade.exists?grade.data():null,meta.studentId);
     if(checkpointOnly&&grade.exists&&grade.data().checkpointReceiptId!==meta.receipt.receiptId)
       deny("failed-precondition","Existing original grade has different evidence provenance.");
     const cfg=privateTask.exists&&privateTask.data().ownerUid===ctx.uid?privateTask.data():{};
     const rules=Array.isArray(cfg.rules)?cfg.rules.slice(0,40)
       .map(rule=>clean((rule?.type?rule.type+": ":"")+String(rule?.value||""),400)):[];
     const checkingInstructions=[clean(isOwner?(cfg.systemPersona||taskData.systemPersona):"",6000),
       rules.length?"Legacy checking rules: "+rules.join("; "):"",
       clean(imported.exists?imported.data().checkingInstructions:"",5000)].filter(Boolean).join("\n\n").slice(0,8000);
     return {task:taskInfo,
       snapshot:{status:record.data.status||"submitted",version:meta.revision||1,
         hasSubmission:meta.hasSubmission,discoveryOnly:meta.discoveryOnly,
         repository:meta.repository,checkpointSha:meta.checkpointSha,
         selectedCommitShas:meta.selected,verifiedContributionCommits:meta.verified,
         contributionScope:meta.contributionScope,
         approvedCheckpointSha:meta.approved?meta.checkpointSha:null,
         evidenceRevision:meta.revision,
         historical:true,...(checkpointOnly?{checkpointOnly:true,receiptDigest:meta.receiptDigest,sourcePath:meta.receipt.sourcePath,submittedAt:meta.receipt.submittedAt}:{})},
       grade:grade.exists?gradeSummary(grade.data(),rubric,custody?total:null):null,
       checkingInstructions};
   }
   if(!["legacy_github_save_draft","legacy_github_publish","legacy_github_correct_published"].includes(input.action))
     deny("invalid-argument","Unknown historical repository review operation.");
   // The original student-selected SHA receipt is authoritative. A teacher's
   // forced discovery or optional checkpoint approval does not create a grade.
   if(!checkpointOnly)approvedEvidence(record.data,id,recordId,{requireSubmitted:true});
   else if(input.expectedReceiptDigest!==meta.receiptDigest)
     deny("failed-precondition","Checkpoint grading requires the current original receipt.");
   const expectedRevision=Number(input.expectedEvidenceRevision);
   const expectedSha=String(input.expectedCheckpointSha||"").toLowerCase();
   const bulkSave=input.action==="legacy_github_save_draft"&&input.onlyIfUngraded===true;
   if(scalarOnly&&input.action==="legacy_github_save_draft"&&(bulkSave||["internal_ai","external_ai"].includes(input.draftSource)))
     deny("failed-precondition","Original rubric unavailable. Use manually reviewed numerical grading.");
   const revisionField=record.data.revision;
   const revisionlessRecord=meta.revision===0&&
     (revisionField===undefined||revisionField===null||Number(revisionField)===0);
   // Older bulk clients accidentally replaced evidenceRevision=0 with the
   // synthetic display version 1 after repository preparation. Accept that
   // exact compatibility case only while the stored record is still truly
   // revisionless. A real revision-1 bulk save must identify itself as
   // canonical so a stale revisionless batch cannot silently cross 0 -> 1.
   const revisionlessBulkCompat=bulkSave&&revisionlessRecord&&expectedRevision===1&&
     input.expectedEvidenceRevisionMode!=="canonical";
   const canonicalRevisionMatch=expectedRevision===meta.revision&&
     (!bulkSave||expectedRevision!==1||input.expectedEvidenceRevisionMode==="canonical");
   if(!Number.isInteger(expectedRevision)||(!revisionlessBulkCompat&&!canonicalRevisionMatch)||
      expectedSha!==meta.checkpointSha)
     deny("failed-precondition","The frozen historical evidence changed. Refresh before grading.");
   const expectedCanonicalRevision=revisionlessBulkCompat?0:expectedRevision;
   const gradeDocument=gradeRef(canonicalId);
   const expectedGradeVersion=Number(input.expectedGradeRevision);
   if(!Number.isInteger(expectedGradeVersion)||expectedGradeVersion<0)
     deny("invalid-argument","Reload the current historical grade before changing it.");
   const auditRef=db.collection("grade_revisions").doc();
   let outcome;
   await db.runTransaction(async tx=>{
     const [freshTask,freshImport,freshEvidence,prior,freshCustody,freshAssignment,freshMembership,freshOffering,originalGrades,activityGrades,modernEvidence,receiptPage]=await Promise.all([
       tx.get(taskRef),tx.get(importRef),tx.get(record.ref),tx.get(gradeDocument),
       custody?tx.get(custody.ref):Promise.resolve(null),
       custody?tx.get(db.doc(prefix+"staff_assignments/"+require("./school-academics.js").rowKey(ctx.uid,legacyOfferingId))):Promise.resolve(null),
       custody?tx.get(db.doc(prefix+"memberships/"+ctx.uid)):Promise.resolve(null),
       custody?tx.get(db.doc(prefix+"course_offerings/"+legacyOfferingId)):Promise.resolve(null),
       tx.get(db.collection("student_grades").where("taskId","==",id).limit(1001)),
       tx.get(db.collection("activity_grades").where("taskId","==",id).limit(1001)),
       checkpointOnly?tx.get(db.doc("assessment_evidence/"+canonicalId)):Promise.resolve(null),
       checkpointOnly?tx.get(db.collection("student_submissions").where("assessmentId","==",id).limit(1001)):Promise.resolve(null)
     ]);
     const sourceUnchanged=freshTask.exists&&
       freshTask.data().evalCriteria===taskData.evalCriteria&&
       (custody?custodyMaximum(freshTask.data(),freshCustody?.data()):Number(freshTask.data().maxScore||20))===total;
     const ownerActive=sourceUnchanged&&isOwner&&freshTask.data().ownerUid===ctx.uid&&
       freshImport.exists&&freshImport.data().schoolId===ctx.schoolId&&
       freshImport.data().ownerUid===ctx.uid&&freshImport.data().legacyImport?.assessmentId===id;
     const approvedCustody=sourceUnchanged&&!!custody&&
       validCustody(freshCustody?.exists?freshCustody.data():null,{
         schoolId:ctx.schoolId,assessmentId:id,offeringId:legacyOfferingId,
         teacherUid:ctx.uid,task:freshTask.data(),section:freshEvidence.data()?.section
       })&&freshOffering?.exists&&freshOffering.data().schoolId===ctx.schoolId&&
       freshOffering.data().primaryTeacherUid===ctx.uid&&
       freshAssignment?.exists&&freshAssignment.data().schoolId===ctx.schoolId&&freshAssignment.data().status==="active"&&
       freshAssignment.data().teacherUid===ctx.uid&&
       freshAssignment.data().offeringId===legacyOfferingId&&
       freshMembership?.exists&&freshMembership.data().schoolId===ctx.schoolId&&freshMembership.data().status==="active"&&
       freshMembership.data().roles?.includes("teacher")&&
       freshCustody.data().verifiedLegacyStudentIds.includes(meta.studentId);
     if(!ownerActive&&!approvedCustody)
       deny("permission-denied","Historical assessment ownership or verified school custody changed.");
     const latest=checkpointOnly?checkpointMeta(freshEvidence):approvedEvidence(freshEvidence.exists?freshEvidence.data():null,id,recordId,
       {requireSubmitted:true});
     if(checkpointOnly&&(modernEvidence.exists||latest.receiptDigest!==meta.receiptDigest||
        newestReceipt(receiptPage,meta.studentId)?.receiptId!==meta.receipt.receiptId))
       deny("failed-precondition","Original checkpoint evidence changed. Reload before grading.");
     if(latest.revision!==expectedCanonicalRevision||latest.checkpointSha!==expectedSha||
        latest.repository.fullName.toLowerCase()!==meta.repository.fullName.toLowerCase()||
        latest.contributionScope!==meta.contributionScope||
        JSON.stringify(latest.selected)!==JSON.stringify(meta.selected)||
        JSON.stringify(latest.verified)!==JSON.stringify(meta.verified))
       deny("failed-precondition","The frozen student-submitted repository evidence changed during review.");
     if(originalGrades.size>=1001)
       deny("resource-exhausted","Original grade identity reconciliation requires pagination.");
     if(custody?.grant.maximumProof==="consistent_original_grade_maxima"){
       const basis=verifiedOriginalMaximum(freshTask.data(),originalGrades.docs.map(doc=>doc.data()),id,freshCustody.data().verifiedLegacyStudentIds);
       if(basis?.maximum!==total||basis.proof!==custody.grant.maximumProof)
         deny("failed-precondition","The recovered score maximum changed. Reconcile original grade records before continuing.");
     }
     if(originalGrades.docs.some(doc=>doc.id!==canonicalId&&doc.data().studentId===meta.studentId))
       deny("failed-precondition","An original grade exists under another document ID. Reconcile it before grading.");
     if(activityGrades.size>=1001)deny("resource-exhausted","Original activity grade reconciliation requires pagination.");
     if(!prior.exists&&activityGrades.docs.some(doc=>doc.data().taskId===id&&doc.data().studentId===meta.studentId))
       deny("failed-precondition","An original activity grade exists. Reconcile that result instead of creating a duplicate grade.");
     const before=prior.exists?prior.data():null;
     checkGrade(before,meta.studentId);
     if(checkpointOnly&&before&&(before.checkpointReceiptId!==latest.receipt.receiptId||before.checkpointReceiptDigest!==latest.receiptDigest))
       deny("failed-precondition","Existing grade is tied to different original evidence.");
     if(!checkpointOnly&&before?.checkpointReceiptId)
       deny("failed-precondition","Existing grade is tied to an earlier checkpoint receipt. Reconcile before changing evidence.");
     const priorVersion=before?Number(before.gradeVersion||1):0;
     if(priorVersion!==expectedGradeVersion||input.expectedDraftRevision!==undefined&&(!Number.isInteger(input.expectedDraftRevision)||input.expectedDraftRevision!==priorVersion||!prior.exists||before.published===true))
       deny("failed-precondition","Historical grade changed. Reload before saving or publishing.");
     if(input.action==="legacy_github_save_draft"&&input.onlyIfUngraded===true&&prior.exists)
       deny("failed-precondition","An original historical grade already exists. Bulk evaluation cannot replace a draft or published result.");
     const correcting=input.action==="legacy_github_correct_published";
     if(correcting&&before?.published!==true)
       deny("failed-precondition","Only a published original grade can be corrected.");
     if(before?.published===true&&!correcting)
       deny("failed-precondition","A published historical grade is protected from ordinary edits.");
     if(correcting){
       gradeSummary(before,rubric,custody?total:null);
       if(before.gradedSha&&String(before.gradedSha).toLowerCase()!==latest.checkpointSha||
          before.evidenceRevision!=null&&Number(before.evidenceRevision)!==latest.revision)
         deny("failed-precondition","Original grade evidence changed. Reconcile before correction.");
     }
     if(input.action==="legacy_github_save_draft"||correcting){
       const reviewNote=clean(input.reviewNote,3000);
       // Teacher feedback is distinct from an optional internal note. The
       // grade action itself records the reviewer and frozen evidence provenance.
       const feedback=clean(input.feedback,5000);
       if(!feedback||String(input.feedback||"").trim().length>5000)
         deny("invalid-argument","Historical GitHub grading requires feedback within 5000 characters.");
       const scores=validateCriteria(input.criteria,rubric);
       if(correcting&&scores.pending!==0)deny("failed-precondition","Complete all numerical scores before correcting a published grade.");
       const revision=priorVersion+1,now=FieldValue.serverTimestamp();
       const draftSource=["internal_ai","external_ai"].includes(input.draftSource)?
         input.draftSource:"teacher";
       const values={studentId:meta.studentId,taskId:id,
         section:clean(record.data.section,160),score:scores.awarded,maxScore:scores.total,
         criteria:scores.criteria,pending:scores.pending,
         feedback,published:correcting,reviewRequired:scores.pending>0,reviewSuggested:!correcting,manuallyAdjusted:true,
         ...(correcting?{lastCorrectedAt:now,lastCorrectedByUid:ctx.uid}:{}),
         gradeVersion:revision,gradeSource:draftSource==="teacher"?"teacher_manual":"teacher_ai_reviewed",
         evaluationSource:draftSource,
         reviewedBy:ctx.uid,reviewedAt:now,gradedAt:now,
         teacherReviewNote:reviewNote||before?.teacherReviewNote||"",gradedSha:latest.checkpointSha,
         evidenceRevision:latest.revision,
         ...(checkpointOnly?{checkpointReceiptId:latest.receipt.receiptId,checkpointReceiptDigest:latest.receiptDigest,checkpointSourcePath:latest.receipt.sourcePath}:{}),
         verifiedContributionCommits:latest.verified,contributionScope:latest.contributionScope,
         contributionEvidence:{...(before?.contributionEvidence||{}),
           repository:latest.repository.fullName,selectedCommits:latest.selected,
           verifiedContributionCommits:latest.verified,
           submittedCheckpointSha:latest.checkpointSha,
           approvedCheckpointSha:latest.approved?latest.checkpointSha:null,
           authorshipIndependentlyProven:false}
       };
       if(prior.exists)tx.set(gradeDocument,{...before,...values});
       else tx.create(gradeDocument,values);
       tx.create(auditRef,{gradeId:canonicalId,studentId:meta.studentId,taskId:id,editorUid:ctx.uid,
         reason:correcting?"Historical published grade corrected":"Historical GitHub draft saved from V4",
         before:before?{score:before.score,published:before.published===true,gradeVersion:priorVersion,feedback:before.feedback||"",criteria:before.criteria||[],pending:before.pending||0}:null,
         after:{score:scores.awarded,published:correcting,gradeVersion:revision,feedback,criteria:scores.criteria,pending:scores.pending},
         schoolId:ctx.schoolId,evidenceRevision:latest.revision,
         ...(checkpointOnly?{checkpointReceiptId:latest.receipt.receiptId,checkpointReceiptDigest:latest.receiptDigest}:{}),createdAt:now});
       outcome={status:correcting?"published":"draft",awarded:scores.awarded,total:scores.total,revision};
       return;
     }
     if(!before||before.gradeSource!=="teacher_manual"&&
        before.gradeSource!=="teacher_ai_reviewed"||
        before.reviewedBy!==ctx.uid||!Array.isArray(before.criteria)||
        before.gradedSha!==latest.checkpointSha||
        Number(before.evidenceRevision||0)!==latest.revision||
        before.score==null||before.score===""||!Number.isFinite(Number(before.score))||Number(before.score)<0||Number(before.pending||0)!==0)
       deny("failed-precondition","Save a complete draft bound to the current submitted evidence before publication.");
     const scores=validateCriteria(before.criteria,rubric);
     if(scores.pending!==0||scores.awarded!==Number(before.score)||scores.total!==Number(before.maxScore))
       deny("failed-precondition","Historical rubric scores no longer reconcile with the grade.");
     if(before.contributionEvidence?.repository?.toLowerCase()!==latest.repository.fullName.toLowerCase()||
        JSON.stringify(before.contributionEvidence?.selectedCommits||[])!==JSON.stringify(latest.selected)||
        JSON.stringify(before.verifiedContributionCommits||[])!==JSON.stringify(latest.verified))
       deny("failed-precondition","Grade provenance no longer matches the approved frozen evidence.");
     const now=FieldValue.serverTimestamp();
     tx.update(gradeDocument,{published:true,publishedAt:now});
     tx.create(auditRef,{gradeId:canonicalId,studentId:meta.studentId,taskId:id,editorUid:ctx.uid,
       reason:"Teacher published exact historical GitHub grade through V4",
       before:{score:before.score,published:false,gradeVersion:priorVersion},
       after:{score:before.score,published:true,gradeVersion:priorVersion},
       schoolId:ctx.schoolId,evidenceRevision:latest.revision,
       ...(checkpointOnly?{checkpointReceiptId:latest.receipt.receiptId,checkpointReceiptDigest:latest.receiptDigest}:{}),createdAt:now});
     outcome={status:"published",published:true,awarded:scores.awarded,total:scores.total};
   });
   return outcome;
 };
}
module.exports={createSchoolLegacyGithubReview,approvedEvidence,validateCriteria};
