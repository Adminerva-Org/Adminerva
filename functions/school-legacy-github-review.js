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
const {authorizedTeacherCustody,validCustody,normalized}=require("./school-legacy-custody.js");
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
function gradeSummary(grade,rubric){
 if(!grade)return null;
 const awarded=Number(grade.score),total=Number(grade.maxScore);
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
function createSchoolLegacyGithubReview({db,parseLegacyRubric}){
 return async function review({ctx,input}){
   const id=input.legacyAssessmentId;
   if(!validAssessmentId(id))deny("invalid-argument","Invalid historical assessment identifier.");
   const taskRef=db.doc("assessments/"+id),task=await taskRef.get();
   if(!task.exists)deny("not-found","Original historical assessment not found.");
   const taskData=task.data();
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
       normalized(section)===normalized(custody.grant.originalSection);
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
   const total=Number(taskData.maxScore||20);
   if(!Number.isFinite(total)||total<=0||total>2000)
     deny("failed-precondition","Historical assessment maximum is invalid.");
   const rubric=parseLegacyRubric(taskData.evalCriteria,total);
   const taskInfo={
     taskId:legacyOfferingId&&custody?"legacy:"+id+"@"+legacyOfferingId:"legacy:"+id,
     legacyAssessmentId:id,legacyCompatibility:true,
     ...(custody?{legacyOfferingId,custodyApproved:true,originalSection:custody.grant.originalSection}:{ }),
     submissionSource:"github",title:clean(taskData.title||"Historical GitHub assessment",140),
     description:clean(taskData.description,2000),
     instructions:clean(taskData.taskContext||taskData.description,16000),
     rubric,rubricText:clean(taskData.evalCriteria,3500),
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
   function checkGrade(grade,studentId){
     if(grade&&(grade.studentId!==studentId||grade.taskId!==id))
       deny("failed-precondition","Historical grade belongs to a different learner or assessment.");
   }
   if(input.action==="legacy_github_bulk_publish"){
     // Publish only teacher-reviewed, non-zero original grade drafts whose
     // immutable student-submitted SHA receipt still passes the *same*
     // transactional checks used by publishing a single learner. Pagination
     // is bounded and idempotent: already published scores remain untouched.
     const cursor=input.cursor?legacyDocumentId(input.cursor,"Historical publication cursor"):null;
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
       if(Number(grade.score)===0){zeroSkipped++;continue;}
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
         const meta=approvedEvidence(data,id,doc.id);
         rows.push({evidenceId:doc.id,studentId:meta.studentId,studentUid:meta.studentId,
           section:clean(data.section,160),status:data.status||"submitted",
           version:meta.revision||1,updatedAt:data.submittedAt?.toMillis?.()||null,
           selectedCount:meta.selected.length,verifiedCount:meta.verified.length,
           approved:meta.approved,hasSubmission:meta.hasSubmission,
           discoveryOnly:meta.discoveryOnly});
         if(!inScope(meta.studentId,data.section))rows.pop();
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
         checkGrade(grade,row.studentId);
         results.push({...row,studentName:clean(person.name||row.studentId,160),
           gradeStatus:grade?.published===true?"published":grade?"draft":null,
           awarded:grade?Number(grade.score):null});
       }
     }
     // Original scalar grades can outlive evidence or use a different receipt
     // key. Show them as protected outcomes, but NEVER treat such rows as new
     // student-submitted evidence or enable edits without a verified receipt.
     const gradePage=await db.collection("student_grades").where("taskId","==",id).limit(1001).get();
     if(gradePage.size>=1001)
       deny("resource-exhausted","The original grade ledger requires pagination.");
     const seen=new Set(results.map(row=>row.studentId));
     let gradeOnly=0,publishedCount=0,draftCount=0;
     for(const doc of gradePage.docs){
       const grade=doc.data();
       if(grade.taskId!==id||typeof grade.studentId!=="string"||
          !inScope(grade.studentId,grade.section))continue;
       const awarded=Number(grade.score),maximum=Number(grade.maxScore||total);
       if(!Number.isFinite(awarded)||!Number.isFinite(maximum)||awarded<0||
          awarded>maximum||maximum<=0)continue;
       if(grade.published===true)publishedCount++;else draftCount++;
       if(seen.has(grade.studentId))continue;
       seen.add(grade.studentId);gradeOnly++;
       const person=await db.doc("students/"+grade.studentId).get();
       results.push({evidenceId:null,studentId:grade.studentId,studentUid:grade.studentId,
         studentName:clean(person.exists?person.data().name:grade.studentId,160),
         section:clean(grade.section,160),status:"grade_only",
         gradeOnly:true,hasSubmission:false,discoveryOnly:false,
         gradeStatus:grade.published===true?"published":"draft",awarded,
         maxScore:maximum});
     }
     return {task:taskInfo,evidence:results,coverage:{
       evidenceCount:rows.length,gradeCount:publishedCount+draftCount,
       publishedCount,draftCount,gradeOnly,evidenceWithoutGrade:
         results.filter(row=>!row.gradeStatus&&!row.gradeOnly).length
     }};
   }
   const recordId=legacyDocumentId(input.legacyEvidenceId,"Historical submission ID");
   const record=await verifiedRecord(recordId);
   const meta=record.meta;
   if(input.action==="legacy_github_inspect"){
     const [grade,privateTask]=await Promise.all([
       gradeRef(recordId).get(),db.doc("assessment_private/"+id).get()
     ]);
     checkGrade(grade.exists?grade.data():null,meta.studentId);
     const cfg=privateTask.exists&&privateTask.data().ownerUid===ctx.uid?privateTask.data():{};
     const rules=Array.isArray(cfg.rules)?cfg.rules.slice(0,40)
       .map(rule=>clean((rule?.type?rule.type+": ":"")+String(rule?.value||""),400)):[];
     const checkingInstructions=[clean(cfg.systemPersona||taskData.systemPersona,6000),
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
         historical:true},
       grade:grade.exists?gradeSummary(grade.data(),rubric):null,
       checkingInstructions};
   }
   if(!["legacy_github_save_draft","legacy_github_publish"].includes(input.action))
     deny("invalid-argument","Unknown historical repository review operation.");
   // The original student-selected SHA receipt is authoritative. A teacher's
   // forced discovery or optional checkpoint approval does not create a grade.
   approvedEvidence(record.data,id,recordId,{requireSubmitted:true});
   const expectedRevision=Number(input.expectedEvidenceRevision);
   const expectedSha=String(input.expectedCheckpointSha||"").toLowerCase();
   const bulkSave=input.action==="legacy_github_save_draft"&&input.onlyIfUngraded===true;
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
   const gradeDocument=gradeRef(recordId);
   const expectedGradeVersion=Number(input.expectedGradeRevision);
   if(!Number.isInteger(expectedGradeVersion)||expectedGradeVersion<0)
     deny("invalid-argument","Reload the current historical grade before changing it.");
   const auditRef=db.collection("grade_revisions").doc();
   let outcome;
   await db.runTransaction(async tx=>{
     const [freshTask,freshImport,freshEvidence,prior,freshCustody,freshAssignment,freshMembership]=await Promise.all([
       tx.get(taskRef),tx.get(importRef),tx.get(record.ref),tx.get(gradeDocument),
       custody?tx.get(custody.ref):Promise.resolve(null),
       custody?tx.get(db.doc(prefix+"staff_assignments/"+require("./school-academics.js").rowKey(ctx.uid,legacyOfferingId))):Promise.resolve(null),
       custody?tx.get(db.doc(prefix+"memberships/"+ctx.uid)):Promise.resolve(null)
     ]);
     const sourceUnchanged=freshTask.exists&&
       freshTask.data().evalCriteria===taskData.evalCriteria&&
       Number(freshTask.data().maxScore||20)===total;
     const ownerActive=sourceUnchanged&&isOwner&&freshTask.data().ownerUid===ctx.uid&&
       freshImport.exists&&freshImport.data().schoolId===ctx.schoolId&&
       freshImport.data().ownerUid===ctx.uid&&freshImport.data().legacyImport?.assessmentId===id;
     const approvedCustody=sourceUnchanged&&!!custody&&
       validCustody(freshCustody?.exists?freshCustody.data():null,{
         schoolId:ctx.schoolId,assessmentId:id,offeringId:legacyOfferingId,
         teacherUid:ctx.uid,task:freshTask.data(),section:record.data.section
       })&&freshAssignment?.exists&&freshAssignment.data().status==="active"&&
       freshAssignment.data().teacherUid===ctx.uid&&
       freshAssignment.data().offeringId===legacyOfferingId&&
       freshMembership?.exists&&freshMembership.data().status==="active"&&
       freshMembership.data().roles?.includes("teacher")&&
       freshCustody.data().verifiedLegacyStudentIds.includes(meta.studentId);
     if(!ownerActive&&!approvedCustody)
       deny("permission-denied","Historical assessment ownership or verified school custody changed.");
     const latest=approvedEvidence(freshEvidence.exists?freshEvidence.data():null,id,recordId,
       {requireSubmitted:true});
     if(latest.revision!==expectedCanonicalRevision||latest.checkpointSha!==expectedSha||
        latest.repository.fullName.toLowerCase()!==meta.repository.fullName.toLowerCase()||
        latest.contributionScope!==meta.contributionScope||
        JSON.stringify(latest.selected)!==JSON.stringify(meta.selected)||
        JSON.stringify(latest.verified)!==JSON.stringify(meta.verified))
       deny("failed-precondition","The frozen student-submitted repository evidence changed during review.");
     const before=prior.exists?prior.data():null;
     checkGrade(before,meta.studentId);
     const priorVersion=before?Number(before.gradeVersion||1):0;
     if(priorVersion!==expectedGradeVersion)
       deny("failed-precondition","Historical grade changed. Reload before saving or publishing.");
     if(input.action==="legacy_github_save_draft"&&input.onlyIfUngraded===true&&prior.exists)
       deny("failed-precondition","An original historical grade already exists. Bulk evaluation cannot replace a draft or published result.");
     if(before?.published===true)
       deny("failed-precondition","A published historical grade is protected from ordinary edits.");
     if(input.action==="legacy_github_save_draft"){
       const reviewNote=clean(input.reviewNote,3000);
       if(reviewNote.length<15)
         deny("invalid-argument","Explain your verification of the historical repository evidence (15–3000 characters).");
       const feedback=clean(input.feedback,5000);
       if(!feedback||String(input.feedback||"").trim().length>5000)
         deny("invalid-argument","Historical GitHub grading requires feedback within 5000 characters.");
       const scores=validateCriteria(input.criteria,rubric);
       const revision=priorVersion+1,now=FieldValue.serverTimestamp();
       const draftSource=["internal_ai","external_ai"].includes(input.draftSource)?
         input.draftSource:"teacher";
       const values={studentId:meta.studentId,taskId:id,
         section:clean(record.data.section,160),score:scores.awarded,maxScore:scores.total,
         criteria:scores.criteria,pending:scores.pending,
         feedback,published:false,reviewRequired:scores.pending>0,manuallyAdjusted:true,
         gradeVersion:revision,gradeSource:draftSource==="teacher"?"teacher_manual":"teacher_ai_reviewed",
         evaluationSource:draftSource,
         reviewedBy:ctx.uid,reviewedAt:now,gradedAt:now,
         teacherReviewNote:reviewNote,gradedSha:latest.checkpointSha,
         evidenceRevision:latest.revision,
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
       tx.create(auditRef,{gradeId:recordId,studentId:meta.studentId,taskId:id,editorUid:ctx.uid,
         reason:"Historical GitHub rubric draft saved from unified V4 Review & Grade",
         before:before?{score:before.score,published:false,gradeVersion:priorVersion}:null,
         after:{score:scores.awarded,published:false,gradeVersion:revision},
         schoolId:ctx.schoolId,evidenceRevision:latest.revision,createdAt:now});
       outcome={status:"draft",awarded:scores.awarded,total:scores.total,revision};
       return;
     }
     if(!before||before.gradeSource!=="teacher_manual"&&
        before.gradeSource!=="teacher_ai_reviewed"||
        before.reviewedBy!==ctx.uid||!Array.isArray(before.criteria)||
        before.gradedSha!==latest.checkpointSha||
        Number(before.evidenceRevision||0)!==latest.revision||
        !before.teacherReviewNote||Number(before.score)<=0||
        Number(before.pending||0)!==0||before.reviewRequired===true)
       deny("failed-precondition","Save a fully reviewed, non-zero, current historical GitHub rubric draft before publication.");
     const scores=validateCriteria(before.criteria,rubric);
     if(scores.pending!==0||scores.awarded!==Number(before.score)||scores.total!==Number(before.maxScore))
       deny("failed-precondition","Historical rubric scores no longer reconcile with the grade.");
     if(before.contributionEvidence?.repository?.toLowerCase()!==latest.repository.fullName.toLowerCase()||
        JSON.stringify(before.contributionEvidence?.selectedCommits||[])!==JSON.stringify(latest.selected)||
        JSON.stringify(before.verifiedContributionCommits||[])!==JSON.stringify(latest.verified))
       deny("failed-precondition","Grade provenance no longer matches the approved frozen evidence.");
     const now=FieldValue.serverTimestamp();
     tx.update(gradeDocument,{published:true,publishedAt:now});
     tx.create(auditRef,{gradeId:recordId,studentId:meta.studentId,taskId:id,editorUid:ctx.uid,
       reason:"Teacher published exact historical GitHub grade through V4",
       before:{score:before.score,published:false,gradeVersion:priorVersion},
       after:{score:before.score,published:true,gradeVersion:priorVersion},
       schoolId:ctx.schoolId,evidenceRevision:latest.revision,createdAt:now});
     outcome={status:"published",published:true,awarded:scores.awarded,total:scores.total};
   });
   return outcome;
 };
}
module.exports={createSchoolLegacyGithubReview,approvedEvidence,validateCriteria};
