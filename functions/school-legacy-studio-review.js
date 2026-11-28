"use strict";
/**
 * Read-through compatibility adapter for historic Repository Management Studio
 * submissions inside the canonical V4 Review & Grade UI.
 *
 * The legacy submissions and grades remain authoritative. This adapter never
 * clones assessment submissions into school collections or assigns a school
 * identity from a name/email guess. Native V4 deployments are unchanged.
 */
const {createHash}=require("node:crypto");
const {FieldValue,FieldPath}=require("firebase-admin/firestore");
const {TenantAccessError}=require("./tenant-access.js");
const deny=(code,message)=>{throw new TenantAccessError(code,message);};
const digest=text=>createHash("sha256").update(text,"utf8").digest("hex");
const safeId=(value,label,max=256)=>{
  const id=String(value||"");
  if(!id||id.length>max||!/^[A-Za-z0-9_-]+$/.test(id))
    deny("invalid-argument",label+" is invalid.");
  return id;
};
// Old Repository Management student document IDs are not always Firebase Auth
// UIDs or alphanumeric IDs. The original Studio evidence identity deliberately
// permits email-like IDs and punctuation (but never path separators).
// Validate an existing Firestore *document segment*; do not transform an ID.
const legacyDocumentId=(value,label,max=300)=>{
  if(typeof value!=="string"||!value||value.length>max||
     Buffer.byteLength(value,"utf8")>1500||
     value==="."||value===".."||/[\\/\u0000-\u001f\u007f]/.test(value)||
     /^__.*__$/.test(value))
    deny("invalid-argument",label+" is invalid.");
  return value;
};
const validSnapshot=(head,version)=>{
  if(!head||!version||version.ownerUid!==head.ownerUid||
    version.assessmentId!==head.assessmentId||
    version.studentId!==head.studentId||
    version.projectId!==head.projectId||
    version.revision!==head.revision||
    String(version.variantId||"")!==String(head.variantId||"")||
    version.snapshotHash!==head.snapshotHash||
    typeof version.snapshotJson!=="string"||
    Buffer.byteLength(version.snapshotJson,"utf8")>320000||
    !/^[a-f0-9]{64}$/.test(head.snapshotHash||"")||
    digest(version.snapshotJson)!==head.snapshotHash)
    deny("failed-precondition","Frozen Studio evidence no longer matches the submitted revision.");
  let value;
  try{value=JSON.parse(version.snapshotJson);}catch{
    deny("failed-precondition","Frozen Studio submission is malformed.");
  }
  const files=value?.files,order=value?.fileOrder;
  if(value?.schemaVersion!==1||!files||typeof files!=="object"||Array.isArray(files)||
     !Array.isArray(order)||order.length<1||order.length>100||
     Object.keys(files).length!==order.length||new Set(order).size!==order.length||
     order.some(path=>typeof path!=="string"||!path||path.length>220||
       path.startsWith("/")||path.split("/").some(p=>!p||p==="."||p==="..")||
       typeof files[path]!=="string"))
    deny("failed-precondition","Frozen Studio files are incomplete or invalid.");
  if(!Object.values(files).some(content=>content.trim()))
    deny("failed-precondition","Frozen Studio source has no recoverable code.");
  return {
    version:head.revision,status:head.status==="revision_requested"?"reopened":head.status||"submitted",
    files:order.map(path=>({path,content:files[path]})),
    artifacts:{database:value.database||{},design:value.design||{},
      config:value.config||{},executionEvidence:value.executionEvidence||{}},
    sourceLanguage:value.lang||"java",contentDigest:head.snapshotHash,
    sourceDigest:value.sourceDigest||"",
    automaticVerification:version.verification||null
  };
};
function validateCriteria(entries,rubric){
  if(!Array.isArray(entries)||entries.length!==rubric.length)
    deny("invalid-argument","Every published rubric criterion needs a score.");
  let awarded=0,pending=0;
  const criteria=entries.map((entry,index)=>{
    const maximum=Number(rubric[index].points),a=entry?.awardedPoints,p=entry?.pendingPoints;
    if(!Number.isFinite(maximum)||maximum<=0||typeof a!=="number"||typeof p!=="number"||!Number.isFinite(a)||!Number.isFinite(p)||a<0||p<0||
       a+p>maximum||a>maximum)
      deny("invalid-argument","One criterion exceeds its published maximum.");
    const comment=String(entry?.comment||"").slice(0,1000);
    awarded+=a;pending+=p;
    return {name:rubric[index].name,maximum,awardedPoints:a,pendingPoints:p,comment};
  });
  return {criteria,awarded,pending,total:rubric.reduce((sum,x)=>sum+Number(x.points),0)};
}
const gradeSummary=grade=>{
  if(!grade)return null;
  const score=Number(grade.score),total=Number(grade.maxScore);
  const criteria=Array.isArray(grade.criteria)?grade.criteria:[];
  return {status:grade.published===true?"published":"draft",
    gradeSchema:criteria.length?"rubric_v1":"legacy_scalar_v1",
    criteria,awarded:Number.isFinite(score)?score:0,
    total:Number.isFinite(total)?total:0,pending:Number(grade.pending||0),
    feedback:String(grade.feedback||""),draftSource:grade.gradeSource==="external_evaluation_draft"?"external_ai":
      grade.gradeSource==="system_evaluation_draft"?"internal_ai":"teacher",
    revision:Number(grade.gradeVersion||1),version:grade.studioRevision||null,
    publishedAt:grade.publishedAt?.toMillis?.()||null};
};
function createSchoolLegacyStudioReview({db,parseLegacyRubric}){
  async function run({ctx,input}){
    const legacyAssessmentId=safeId(input.legacyAssessmentId,"Legacy assessment",128);
    const taskRef=db.doc("assessments/"+legacyAssessmentId),task=await taskRef.get();
    if(!task.exists||task.data().ownerUid!==ctx.uid||(task.data().schoolId&&task.data().schoolId!==ctx.schoolId))
      deny("permission-denied","Only the original assessment owner can review these historical submissions.");
    const original=task.data();
    if(!(original.schemaVersion===3||original.submissionSource==="studio"||
         original.assessmentFormat==="studio_code"))
      deny("failed-precondition","This historical assessment is not an Adminerva Studio submission.");
    const importedId="legacy_"+digest(JSON.stringify([ctx.schoolId,ctx.uid,legacyAssessmentId])).slice(0,48);
    const schoolCopy=await db.doc("schools/"+ctx.schoolId+"/assessment_blueprints/"+importedId).get();
    if(!schoolCopy.exists||schoolCopy.data().schoolId!==ctx.schoolId||
       schoolCopy.data().ownerUid!==ctx.uid||
       schoolCopy.data().legacyImport?.assessmentId!==legacyAssessmentId)
      deny("failed-precondition","Import this assessment blueprint into the selected school before reviewing its historical work here.");
    const rubric=parseLegacyRubric(original.evalCriteria,Number(original.maxScore||20));
    // Original class assignments may have been archived or edited after
    // submission. An owner-verified frozen receipt must not vanish from V4
    // merely because it is no longer in the current deployment array.
    const linkedSections=new Set((original.deployments||[]).map(x=>String(x?.section||"")).filter(Boolean));
    const allowedHead=data=>data.assessmentId===legacyAssessmentId&&
      typeof data.studentId==="string"&&data.studentId.length>0&&
      typeof data.ownerUid==="string"&&data.ownerUid.length>0&&
      typeof data.section==="string"&&data.section.length>0;
    const taskInfo={
      taskId:"legacy:"+legacyAssessmentId,legacyCompatibility:true,
      legacyAssessmentId,title:String(original.title||"Historical Studio assessment").slice(0,140),
      description:String(original.description||"").slice(0,2000),
      instructions:String(original.taskContext||original.description||"").slice(0,20000),
      assessmentType:String(original.type||"Assessment").slice(0,80),
      rubric,submissionSource:"studio",
      personalizedTask:{enabled:original.assessmentMode==="personalized"||
        original.personalizedTask?.enabled===true},
      status:"deployed",published:original.published===true,
      dueAt:null
    };
    const validateHead=(head,submissionId)=>{
      if(!allowedHead(head)||!Number.isInteger(head.revision)||head.revision<1||
         head.revision>30||!head.projectId||!head.snapshotHash)
        deny("failed-precondition","The historical receipt cannot be verified against the original assessment.");
      const expected=head.studentId+"_"+legacyAssessmentId;
      if(submissionId!==expected)
        deny("failed-precondition","The submitted record identity does not match the learner and assessment.");
    };
    const inspectRaw=async submissionId=>{
      const id=legacyDocumentId(submissionId,"Submitted Studio revision",300);
      const ref=db.doc("studio_submissions/"+id),head=await ref.get();
      if(!head.exists)deny("not-found","Historical Studio submission not found.");
      validateHead(head.data(),id);
      const frozen=await ref.collection("versions").doc(String(head.data().revision)).get();
      if(!frozen.exists)deny("failed-precondition","The exact submitted version is unavailable.");
      const snapshot=validSnapshot(head.data(),frozen.data());
      return {id,head:head.data(),snapshot};
    };
    const inspectWithVariant=async raw=>{
      const variantId=String(raw.head.variantId||"");
      if(!variantId)return {...raw.snapshot,personalizedTask:null};
      // Original Repository Management supports 16–64-character frozen variant
      // digests; V4 cannot assume its own newer 24-character variant format.
      if(!/^[a-f0-9]{16,64}$/.test(variantId))
        deny("failed-precondition","The submitted personalized variant ID is invalid.");
      const student=legacyDocumentId(raw.head.studentId,"Student",160);
      const assignment=await db.doc("studio_assessment_variants/"+
        student+"_"+legacyAssessmentId+"/attempts/"+raw.head.revision).get();
      const assigned=assignment.exists?assignment.data():null;
      const assignedValid=assigned&&
        assigned.assessmentId===legacyAssessmentId&&assigned.studentId===student&&
        assigned.attempt===raw.head.revision&&assigned.variantId===variantId&&
        typeof assigned.prompt==="string"&&assigned.prompt.trim().length>=20;
      let value=assignedValid?assigned:null,source="exact_attempt_assignment";
      if(!value){
        const privateVariant=await db.doc("assessment_private/"+legacyAssessmentId+
          "/variants/"+variantId).get();
        const data=privateVariant.exists?privateVariant.data():null;
        if(data&&data.variantId===variantId&&typeof data.prompt==="string"&&
           data.prompt.trim().length>=20){
          value=data;source="exact_private_variant";
        }
      }
      return {...raw.snapshot,
        personalizedTask:value?{
          variantId,prompt:value.prompt,
          evaluationNotes:String(value.evaluationNotes||""),
          source
        }:null,
        legacyVariantWarning:value?null:
          "The exact historical personalized task could not be recovered. The original frozen source remains available; AI evaluation is disabled."
      };
    };
    const gradeRef=id=>db.doc("student_grades/"+id);
    async function submissionPage(cursor="",pageSize=80){
      const base=db.collection("studio_submissions")
        .where("assessmentId","==",legacyAssessmentId)
        .orderBy(FieldPath.documentId());
      const query=cursor?base.startAfter(cursor).limit(pageSize):base.limit(pageSize);
      const snap=await query.get();
      return {docs:snap.docs,nextCursor:snap.size===pageSize?
        snap.docs[snap.docs.length-1].id:null};
    }
    async function allSubmissionHeads(){
      let cursor="",rows=[],scanned=0;
      for(;;){
        const page=await submissionPage(cursor);
        scanned+=page.docs.length;
        rows.push(...page.docs.filter(doc=>allowedHead(doc.data())));
        if(scanned>1000)
          deny("resource-exhausted","Historical Studio review exceeds 1,000 source records and needs a narrower indexed view.");
        if(!page.nextCursor)return rows;
        cursor=page.nextCursor;
      }
    }
    if(input.action==="legacy_review_inbox"){
      const rows=await allSubmissionHeads();
      const students=[],grades=[];
      for(let start=0;start<rows.length;start+=80){
        const batch=rows.slice(start,start+80);
        const [names,scores]=await Promise.all([
          Promise.all(batch.map(row=>db.doc("students/"+
            legacyDocumentId(row.data().studentId,"Student",160)).get())),
          Promise.all(batch.map(row=>gradeRef(row.id).get()))
        ]);
        students.push(...names);grades.push(...scores);
      }
      const submissions=rows.map((doc,index)=>{
        const data=doc.data(),grade=grades[index].exists?grades[index].data():null,
          student=students[index].exists?students[index].data():null;
        return {submissionId:doc.id,studentUid:data.ownerUid,studentName:String(student?.name||data.studentId),
          legacyStudentId:data.studentId,section:data.section||"",
          historicSectionUnlisted:!linkedSections.has(data.section||""),
          status:data.status==="revision_requested"?"reopened":data.status||"submitted",
          version:data.revision,
          gradeStatus:grade?grade.published===true?"published":"draft":null,
          gradeRevision:grade?Number(grade.gradeVersion||1):0,reviewSuggested:!!grade&&grade.published!==true&&(grade.reviewSuggested===true||grade.score===0||Number(grade.pending||0)>0),
          awarded:grade?Number(grade.score||0):null,maxScore:grade?Number(grade.maxScore||original.maxScore||20):null,pending:grade?Number(grade.pending||0):0,
          updatedAt:data.submittedAt?.toMillis?.()||null};
      });
      const drafts=submissions.filter(x=>x.gradeStatus==="draft");
      return {task:taskInfo,submissions,
        publishableDrafts:drafts.filter(x=>Number.isFinite(x.awarded)&&x.awarded>=0&&x.pending===0).length,
        zeroDrafts:drafts.filter(x=>x.awarded===0).length};
    }
    if(input.action==="legacy_review_inspect"){
      const raw=await inspectRaw(input.legacySubmissionId);
      const [snapshot,grade,privateTask]=await Promise.all([
        inspectWithVariant(raw),gradeRef(raw.id).get(),
        db.doc("assessment_private/"+legacyAssessmentId).get()
      ]);
      const privateData=privateTask.exists&&privateTask.data().ownerUid===ctx.uid?
        privateTask.data():{};
      const extraRules=Array.isArray(privateData.rules)?privateData.rules.slice(0,40)
        .map(rule=>String((rule?.type?rule.type+": ":"")+String(rule?.value||"")).slice(0,400)):[];
      return {task:taskInfo,snapshot,
        grade:grade.exists?gradeSummary(grade.data()):null,
        checkingInstructions:[
          String(privateData.systemPersona||"").slice(0,6000),
          extraRules.length?"Legacy checking rules: "+extraRules.join("; "):"",
          String(schoolCopy.data().checkingInstructions||"").slice(0,5000)
        ].filter(Boolean).join("\n\n").slice(0,8000)};
    }
    if(input.action==="legacy_review_history"){
      const raw=await inspectRaw(input.legacySubmissionId),grade=await gradeRef(raw.id).get();
      if(grade.exists&&(grade.data().studentId!==raw.head.studentId||grade.data().taskId!==legacyAssessmentId))
        deny("permission-denied","Grade history is outside the verified review context.");
      return require("./school-grade-revision-history.js").readLegacyGradeHistory({
        db,schoolId:ctx.schoolId,taskId:legacyAssessmentId,studentId:raw.head.studentId,gradeId:raw.id
      });
    }
    // All mutations stay in the original legacy grade and submission records.
    if(!["legacy_review_save_draft","legacy_review_publish","legacy_review_bulk_publish","legacy_review_correct_published"].includes(input.action))
      deny("invalid-argument","Unknown historical Studio review operation.");
    async function publishOne(submissionId,expectedGradeRevision=null){
      const id=legacyDocumentId(submissionId,"Studio submission",300),ref=db.doc("studio_submissions/"+id),
        grade=gradeRef(id),audit=db.collection("grade_revisions").doc();
      let published=false;
      await db.runTransaction(async tx=>{
        const [current,currentGrade]=await Promise.all([tx.get(ref),tx.get(grade)]);
        if(!current.exists||!currentGrade.exists)return;
        validateHead(current.data(),id);
        const before=currentGrade.data();
        if(before.published===true)return;
        if(expectedGradeRevision!==null&&
           Number(before.gradeVersion||1)!==expectedGradeRevision)
          deny("failed-precondition","The private grade was updated after it was opened. Refresh before publishing.");
        if(before.gradeSource!=="studio_teacher_review"||before.studentId!==current.data().studentId||
           before.taskId!==legacyAssessmentId||before.studioRevision!==current.data().revision||
           before.studioSnapshotHash!==current.data().snapshotHash||
           String(before.studioVariantId||"")!==String(current.data().variantId||"")||
           Number(before.maxScore)!==rubric.reduce((sum,row)=>sum+Number(row.points),0)||
           Number(before.pending||0)!==0||
           before.reviewedBy!==ctx.uid||
           current.data().status!=="reviewed"||
           !(Number.isFinite(before.score)&&before.score>=0&&before.score<=Number(original.maxScore||20)))
          return;
        const frozen=await tx.get(ref.collection("versions").doc(String(current.data().revision)));
        if(!frozen.exists||!validSnapshot(current.data(),frozen.data()))return;
        tx.update(grade,{published:true});
        tx.create(audit,{gradeId:id,studentId:before.studentId,taskId:legacyAssessmentId,
          editorUid:ctx.uid,reason:"Published verified historical Studio grade from unified V4 review",
          before:{score:before.score,published:false},after:{score:before.score,published:true},
          createdAt:FieldValue.serverTimestamp()});
        published=true;
      });
      return published;
    }
    if(input.action==="legacy_review_bulk_publish"){
      const cursor=input.cursor?legacyDocumentId(input.cursor,"Pagination cursor",300):"";
      const page=await submissionPage(cursor,40);
      let published=0,failed=0,zeroSkipped=0;
      for(const row of page.docs.filter(d=>allowedHead(d.data()))){
        const grade=await gradeRef(row.id).get();
        if(!grade.exists||grade.data().published===true)continue;

        try{if(await publishOne(row.id))published++;else failed++;}
        catch{failed++;}
      }
      return {published,failed,zeroSkipped,nextCursor:page.nextCursor,
        hasMore:Boolean(page.nextCursor)};
    }
    const raw=await inspectRaw(input.legacySubmissionId),id=raw.id;
    if(input.action==="legacy_review_correct_published"){
      const expectedRevision=input.expectedGradeRevision,expectedVersion=input.expectedSubmissionVersion;
      if(!Number.isInteger(expectedRevision)||expectedRevision<1||expectedVersion!==raw.head.revision||
         input.expectedSnapshotHash!==raw.head.snapshotHash)
        deny("failed-precondition","Reload the exact historical grade and frozen submission before correcting.");
      const feedback=String(input.feedback||"").trim();
      if(feedback.length>5000)deny("invalid-argument","Feedback is too long.");
      const scores=validateCriteria(input.criteria,rubric);
      if(scores.pending!==0)deny("failed-precondition","Complete all numerical scores before correcting a published grade.");
      const grade=gradeRef(id),audit=db.collection("grade_revisions").doc(),
        headRef=db.doc("studio_submissions/"+id);
      let result;
      await db.runTransaction(async tx=>{
        const [freshTask,freshCopy,head,prior,version]=await Promise.all([
          tx.get(taskRef),tx.get(db.doc("schools/"+ctx.schoolId+"/assessment_blueprints/"+importedId)),
          tx.get(headRef),tx.get(grade),tx.get(db.doc("studio_submissions/"+id+"/versions/"+expectedVersion))
        ]);
        if(!freshTask.exists||freshTask.data().ownerUid!==ctx.uid||
           freshTask.data().evalCriteria!==original.evalCriteria||freshTask.data().maxScore!==original.maxScore||
           (freshTask.data().schoolId&&freshTask.data().schoolId!==ctx.schoolId)||
           !freshCopy.exists||freshCopy.data().schoolId!==ctx.schoolId||freshCopy.data().ownerUid!==ctx.uid||
           freshCopy.data().legacyImport?.assessmentId!==legacyAssessmentId)
          deny("permission-denied","Historical assessment ownership or original scoring context changed.");
        if(!head.exists||!version.exists)deny("failed-precondition","Original frozen evidence is unavailable.");
        const current=head.data();
        validateHead(current,id);
        if(current.status!=="reviewed"||current.revision!==expectedVersion||
           current.snapshotHash!==input.expectedSnapshotHash||current.studentId!==raw.head.studentId||
           current.ownerUid!==raw.head.ownerUid||current.section!==raw.head.section)
          deny("failed-precondition","Original reviewed submission changed.");
        validSnapshot(current,version.data());
        const before=prior.exists?prior.data():null;
        if(!before||before.published!==true||before.studentId!==current.studentId||
           before.taskId!==legacyAssessmentId||Number(before.gradeVersion||1)!==expectedRevision||
           before.studioRevision!==current.revision||before.studioSnapshotHash!==current.snapshotHash||
           String(before.studioVariantId||"")!==String(current.variantId||"")||
           typeof before.score!=="number"||!Number.isFinite(before.score)||before.score<0||
           before.score>scores.total||Number(before.maxScore)!==scores.total)
          deny("failed-precondition","Published grade identity, revision, score maximum or evidence changed.");
        const now=FieldValue.serverTimestamp(),revision=expectedRevision+1;
        const corrected={score:scores.awarded,maxScore:scores.total,pending:0,criteria:scores.criteria,
          feedback,published:true,reviewRequired:false,reviewSuggested:false,gradeVersion:revision,
          reviewedBy:ctx.uid,lastCorrectedByUid:ctx.uid,lastCorrectedAt:now,manuallyAdjusted:true};
        tx.update(grade,corrected);
        tx.create(audit,{gradeId:id,studentId:current.studentId,taskId:legacyAssessmentId,schoolId:ctx.schoolId,
          editorUid:ctx.uid,reason:"Historical Studio published grade corrected",
          before:{score:before.score,maxScore:before.maxScore,published:true,gradeVersion:expectedRevision,
            feedback:before.feedback||"",criteria:before.criteria||[],pending:before.pending||0},
          after:{score:scores.awarded,maxScore:scores.total,published:true,gradeVersion:revision,feedback,criteria:scores.criteria,pending:0},
          evidenceRevision:current.revision,studioSnapshotHash:current.snapshotHash,createdAt:now});
        result={status:"published",published:true,corrected:true,revision,awarded:scores.awarded,total:scores.total};
      });
      return result;
    }
    if(input.action==="legacy_review_save_draft"){
      const feedback=String(input.feedback||"").trim();
      if(feedback.length<20||feedback.length>5000)
        deny("invalid-argument","Provide 20–5,000 characters of feedback.");
      const scores=validateCriteria(input.criteria,rubric);
      const draftSource=["teacher","internal_ai","external_ai"].includes(String(input.draftSource||""))?
        String(input.draftSource):"teacher";
      const grade=gradeRef(id),audit=db.collection("grade_revisions").doc();
      let saved=false;
      await db.runTransaction(async tx=>{
        const [head,prior]=await Promise.all([
          tx.get(db.doc("studio_submissions/"+id)),tx.get(grade)
        ]);
        if(!head.exists||!["submitted","reviewed"].includes(head.data().status)||
           head.data().revision!==raw.head.revision||
           head.data().snapshotHash!==raw.head.snapshotHash)
          deny("failed-precondition","The learner submitted a newer revision. Reload before grading.");
        if(input.expectedDraftRevision!==undefined&&(!Number.isInteger(input.expectedDraftRevision)||input.expectedDraftRevision<1||
           !prior.exists||prior.data().published===true||Number(prior.data().gradeVersion||1)!==input.expectedDraftRevision))
          deny("failed-precondition","The original draft changed during re-evaluation.");
        if(input.onlyIfUngraded===true||input.expectedDraftRevision!==undefined){
          if(input.onlyIfUngraded===true&&prior.exists)
            deny("failed-precondition","An existing grade was saved while bulk evaluation was running. No grade was replaced.");
          if(input.expectedSubmissionVersion!==raw.head.revision||
             input.expectedSnapshotHash!==raw.head.snapshotHash)
            deny("failed-precondition","The bulk evaluation does not match this exact frozen submission.");
        }
        if(prior.exists&&prior.data().published===true)
          deny("failed-precondition","Published grades require a separate audited correction.");
        const version=await tx.get(db.doc("studio_submissions/"+id+"/versions/"+raw.head.revision));
        if(!version.exists)deny("failed-precondition","Frozen source is missing.");
        validSnapshot(head.data(),version.data());
        const before=prior.exists?prior.data():null;
        const updated={
          ...(before||{}),studentId:raw.head.studentId,taskId:legacyAssessmentId,
          section:raw.head.section,gradeSource:"studio_teacher_review",
          studioRevision:raw.head.revision,studioSnapshotHash:raw.head.snapshotHash,
          studioVariantId:String(raw.head.variantId||""),
          score:scores.awarded,maxScore:scores.total,pending:scores.pending,
          criteria:scores.criteria,feedback,reviewRequired:scores.pending>0,reviewSuggested:scores.awarded===0||scores.pending>0||input.reviewSuggested===true,published:false,
          reviewedBy:ctx.uid,teacherReviewNote:"Reviewed exact frozen Studio evidence in unified V4 gradebook",
          manuallyAdjusted:true,evaluationSource:draftSource,
          gradeVersion:Number(before?.gradeVersion||0)+1,
          gradedAt:new Date().toISOString()
        };
        tx.set(grade,updated);
        tx.update(db.doc("studio_submissions/"+id),{
          status:"reviewed",reviewedBy:ctx.uid,reviewedAt:FieldValue.serverTimestamp()
        });
        tx.create(audit,{
          gradeId:id,studentId:raw.head.studentId,taskId:legacyAssessmentId,editorUid:ctx.uid,
          reason:"Saved verified historical Studio grade draft in unified V4 review",
          before:before?{score:before.score,published:Boolean(before.published)}:null,
          after:{score:scores.awarded,published:false},createdAt:FieldValue.serverTimestamp()
        });
        saved=true;
      });
      return {saved,status:"draft",awarded:scores.awarded,total:scores.total};
    }
    const expectedGradeRevision=Number(input.expectedGradeRevision);
    if(!Number.isInteger(expectedGradeRevision)||expectedGradeRevision<1)
      deny("invalid-argument","Reload the current grade draft before publishing.");
    const success=await publishOne(id,expectedGradeRevision);
    if(!success)deny("failed-precondition","This grade is not eligible for publication. Refresh and check its frozen evidence.");
    return {published:true,awarded:raw.head.revision?Number((await gradeRef(id).get()).data().score):0,
      total:Number(original.maxScore||20)};
  }
  return run;
}
module.exports={createSchoolLegacyStudioReview,validSnapshot,validateCriteria};
