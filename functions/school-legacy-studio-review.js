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
const {FieldValue}=require("firebase-admin/firestore");
const {TenantAccessError}=require("./tenant-access.js");
const deny=(code,message)=>{throw new TenantAccessError(code,message);};
const digest=text=>createHash("sha256").update(text,"utf8").digest("hex");
const safeId=(value,label,max=256)=>{
  const id=String(value||"");
  if(!id||id.length>max||!/^[A-Za-z0-9_-]+$/.test(id))
    deny("invalid-argument",label+" is invalid.");
  return id;
};
const validSnapshot=(head,version)=>{
  if(!head||!version||version.ownerUid!==head.ownerUid||
    version.assessmentId!==head.assessmentId||
    version.studentId!==head.studentId||
    version.projectId!==head.projectId||
    version.revision!==head.revision||
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
    const maximum=Number(rubric[index].points),a=Number(entry?.awardedPoints),p=Number(entry?.pendingPoints);
    if(!Number.isFinite(a)||!Number.isFinite(p)||a<0||p<0||
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
    if(!task.exists||task.data().ownerUid!==ctx.uid)
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
    const linkedSections=new Set((original.deployments||[]).map(x=>String(x?.section||"")).filter(Boolean));
    const allowedHead=data=>data.assessmentId===legacyAssessmentId&&
      typeof data.studentId==="string"&&data.studentId.length>0&&
      typeof data.ownerUid==="string"&&data.ownerUid.length>0&&
      linkedSections.has(String(data.section||""));
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
      const id=safeId(submissionId,"Submitted Studio revision",300);
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
      if(!/^[a-f0-9]{24}$/.test(variantId))
        deny("failed-precondition","The submitted personalized variant ID is invalid.");
      const variant=await db.doc("assessment_private/"+legacyAssessmentId+
        "/variants/"+variantId).get();
      const variantData=variant.exists?variant.data():null;
      const prompt=String(variantData?.prompt||"");
      const valid=variantData&&variantData.variantId===variantId&&prompt.trim().length>=20;
      return {...raw.snapshot,
        personalizedTask:valid?{
          variantId,prompt,evaluationNotes:String(variantData.evaluationNotes||""),
          source:"exact_legacy_variant"
        }:null,
        legacyVariantWarning:valid?null:"The original personalized prompt is unavailable from the stored private variant. AI evaluation is disabled; original source remains readable."
      };
    };
    const gradeRef=id=>db.doc("student_grades/"+id);
    if(input.action==="legacy_review_inbox"){
      const snap=await db.collection("studio_submissions")
        .where("assessmentId","==",legacyAssessmentId).limit(101).get();
      if(snap.size===101)deny("resource-exhausted","Historical inbox requires pagination.");
      const rows=snap.docs.filter(doc=>allowedHead(doc.data()));
      const [students,grades]=await Promise.all([
        Promise.all(rows.map(row=>db.doc("students/"+safeId(row.data().studentId,"Student",160)).get())),
        Promise.all(rows.map(row=>gradeRef(row.id).get()))
      ]);
      const submissions=rows.map((doc,index)=>{
        const data=doc.data(),grade=grades[index].exists?grades[index].data():null,
          student=students[index].exists?students[index].data():null;
        return {submissionId:doc.id,studentUid:data.ownerUid,studentName:String(student?.name||data.studentId),
          legacyStudentId:data.studentId,section:data.section||"",
          status:data.status==="revision_requested"?"reopened":data.status||"submitted",
          version:data.revision,
          gradeStatus:grade?grade.published===true?"published":"draft":null,
          awarded:grade?Number(grade.score||0):null,
          updatedAt:data.submittedAt?.toMillis?.()||null};
      });
      const drafts=submissions.filter(x=>x.gradeStatus==="draft");
      return {task:taskInfo,submissions,
        publishableDrafts:drafts.filter(x=>x.awarded>0).length,
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
      return {task:taskInfo,snapshot,
        grade:grade.exists?gradeSummary(grade.data()):null,
        checkingInstructions:String(privateData.systemPersona||"").slice(0,6000)};
    }
    // All mutations stay in the original legacy grade and submission records.
    if(!["legacy_review_save_draft","legacy_review_publish","legacy_review_bulk_publish"].includes(input.action))
      deny("invalid-argument","Unknown historical Studio review operation.");
    async function publishOne(submissionId){
      const id=safeId(submissionId,"Studio submission",300),ref=db.doc("studio_submissions/"+id),
        grade=gradeRef(id),audit=db.collection("grade_revisions").doc();
      let published=false;
      await db.runTransaction(async tx=>{
        const [current,currentGrade]=await Promise.all([tx.get(ref),tx.get(grade)]);
        if(!current.exists||!currentGrade.exists)return;
        validateHead(current.data(),id);
        const before=currentGrade.data();
        if(before.published===true)return;
        if(before.gradeSource!=="studio_teacher_review"||before.studentId!==current.data().studentId||
           before.taskId!==legacyAssessmentId||before.studioRevision!==current.data().revision||
           before.studioSnapshotHash!==current.data().snapshotHash||
           before.reviewedBy!==ctx.uid||before.reviewRequired===true||
           current.data().status!=="reviewed"||
           !(Number.isFinite(before.score)&&before.score>0&&before.score<=Number(original.maxScore||20)))
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
      const snap=await db.collection("studio_submissions").where("assessmentId","==",legacyAssessmentId)
        .limit(101).get();
      if(snap.size===101)deny("resource-exhausted","Bulk publication requires pagination.");
      let published=0,failed=0,zeroSkipped=0;
      for(const row of snap.docs.filter(d=>allowedHead(d.data()))){
        const grade=await gradeRef(row.id).get();
        if(!grade.exists||grade.data().published===true)continue;
        if(Number(grade.data().score)===0){zeroSkipped++;continue;}
        try{if(await publishOne(row.id))published++;else failed++;}
        catch{failed++;}
      }
      return {published,failed,zeroSkipped};
    }
    const raw=await inspectRaw(input.legacySubmissionId),id=raw.id;
    if(input.action==="legacy_review_save_draft"){
      const feedback=String(input.feedback||"").trim();
      if(feedback.length<20||feedback.length>5000)
        deny("invalid-argument","Provide 20–5,000 characters of feedback.");
      const scores=validateCriteria(input.criteria,rubric);
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
          criteria:scores.criteria,feedback,reviewRequired:false,published:false,
          reviewedBy:ctx.uid,teacherReviewNote:"Reviewed exact frozen Studio evidence in unified V4 gradebook",
          manuallyAdjusted:true,gradeVersion:Number(before?.gradeVersion||0)+1,
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
    const success=await publishOne(id);
    if(!success)deny("failed-precondition","This reviewed non-zero grade is not eligible for publication. Refresh and check its frozen evidence.");
    return {published:true,awarded:raw.head.revision?Number((await gradeRef(id).get()).data().score):0,
      total:Number(original.maxScore||20)};
  }
  return run;
}
module.exports={createSchoolLegacyStudioReview,validSnapshot,validateCriteria};
