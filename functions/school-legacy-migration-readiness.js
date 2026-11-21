"use strict";
/**
 * Read-only V4 cutover diagnostic. A historical person is never linked to a
 * school learner by a matching name, email, section nickname or guessed year.
 */
const {TenantAccessError}=require("./tenant-access.js");
const {rowKey}=require("./school-academics.js");
const {validSnapshot}=require("./school-legacy-studio-review.js");
const deny=(code,message)=>{throw new TenantAccessError(code,message);};
const canonical=value=>String(value||"").trim().toLocaleLowerCase("en");
const safeId=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
async function previewLegacyEvidenceMigration({db,ctx,legacyAssessmentId}){
  if(!safeId(legacyAssessmentId))deny("invalid-argument","Invalid historical assessment ID.");
  const legacyRef=db.doc("assessments/"+legacyAssessmentId),legacy=await legacyRef.get();
  if(!legacy.exists||legacy.data().ownerUid!==ctx.uid)
    deny("permission-denied","Only the original assessment owner can preview migration.");
  const schoolPrefix="schools/"+ctx.schoolId+"/";
  const assignments=await db.collection(schoolPrefix+"staff_assignments")
    .where("teacherUid","==",ctx.uid).limit(201).get();
  if(assignments.size===201)
    deny("resource-exhausted","Teaching assignment history requires pagination.");
  const teacherOfferings=[];
  for(const assignment of assignments.docs){
    const grant=assignment.data();
    if(grant.schoolId!==ctx.schoolId||!safeId(grant.offeringId))continue;
    const offering=await db.doc(schoolPrefix+"course_offerings/"+grant.offeringId).get();
    const course=offering.exists?offering.data():null;
    if(!course||course.schoolId!==ctx.schoolId||!safeId(course.sectionId))continue;
    const [section,subject]=await Promise.all([
      db.doc(schoolPrefix+"sections/"+course.sectionId).get(),
      safeId(course.subjectId)?
        db.doc(schoolPrefix+"subjects/"+course.subjectId).get():Promise.resolve(null)
    ]);
    if(!section.exists||section.data().schoolId!==ctx.schoolId)continue;
    teacherOfferings.push({offeringId:grant.offeringId,
      sectionName:canonical(section.data().name),
      subjectName:subject?.exists&&subject.data().schoolId===ctx.schoolId?
        canonical(subject.data().name):"",
      assignmentStatus:grant.status});
  }
  const snap=await db.collection("studio_submissions")
    .where("assessmentId","==",legacyAssessmentId).limit(101).get();
  if(snap.size===101)deny("resource-exhausted","Migration preview requires paginated source inspection.");
  const originalSections=new Set((legacy.data().deployments||[]).map(d=>canonical(d?.section)).filter(Boolean));
  const originalSubject=canonical(legacy.data().subject);
  const rows=[];
  for(const document of snap.docs){
    const head=document.data(),reasons=[];
    if(!originalSections.has(canonical(head.section)))reasons.push("source_section_not_deployed");
    if(head.assessmentId!==legacyAssessmentId||!safeId(head.studentId)||
       !safeId(head.ownerUid)||!Number.isInteger(head.revision)||head.revision<1||
       head.revision>30)
      reasons.push("invalid_submission_identity");
    const matched=teacherOfferings.filter(o=>o.sectionName===canonical(head.section)&&
      originalSubject&&o.subjectName===originalSubject);
    if(matched.length!==1)reasons.push(matched.length?
      "ambiguous_course_offering":"original_subject_or_course_offering_not_verified");
    // Even a unique current section/subject name is not enough to prove the
    // historical academic term. No automatic cutover is authorized by this preview.
    reasons.push("historical_term_requires_explicit_mapping");
    if(matched.length===1&&matched[0].assignmentStatus!=="active")
      reasons.push("historical_teacher_assignment_not_active");
    let personId=null;
    if(safeId(head.ownerUid)){
      const member=await db.doc(schoolPrefix+"memberships/"+head.ownerUid).get();
      const data=member.exists?member.data():null;
      if(!data||data.schoolId!==ctx.schoolId||!safeId(data.personId))
        reasons.push("school_membership_unverified");
      else {
        const person=await db.doc(schoolPrefix+"people/"+data.personId).get();
        if(!person.exists||person.data().schoolId!==ctx.schoolId||
           person.data().kind!=="student"||person.data().authUid!==head.ownerUid)
          reasons.push("student_person_identity_unverified");
        else personId=data.personId;
      }
    }
    if(personId&&matched.length===1){
      const enrolled=await db.doc(schoolPrefix+"enrollments/"+
        rowKey(personId,matched[0].offeringId)).get();
      if(!enrolled.exists||enrolled.data().schoolId!==ctx.schoolId||
         enrolled.data().personId!==personId||
         enrolled.data().offeringId!==matched[0].offeringId)
        reasons.push("official_class_enrollment_unverified");
    }
    if(!reasons.length){
      const version=await document.ref.collection("versions").doc(String(head.revision)).get();
      if(!version.exists)reasons.push("frozen_revision_missing");
      else try{validSnapshot(head,version.data());}catch{
        reasons.push("frozen_source_integrity_unverified");
      }
    }
    const legacyGrade=await db.doc("student_grades/"+document.id).get();
    const grade=legacyGrade.exists?legacyGrade.data():null;
    if(grade&&(
      grade.studentId!==head.studentId||grade.taskId!==legacyAssessmentId||
      !Number.isFinite(Number(grade.score))||
      Number(grade.score)<0||Number(grade.score)>Number(legacy.data().maxScore||20)
    ))reasons.push("grade_identity_or_bounds_invalid");
    rows.push({
      legacySubmissionId:document.id,section:String(head.section||""),
      version:Number(head.revision||0),
      mapped:reasons.length===0,
      offeringId:reasons.length===0?matched[0].offeringId:null,
      personId:reasons.length===0?personId:null,
      hasGrade:Boolean(grade),publishedGrade:grade?.published===true,
      identityAndClassMatched:reasons.length===1&&
        reasons[0]==="historical_term_requires_explicit_mapping",
      blockers:[...new Set(reasons)]
    });
  }
  return {
    legacyAssessmentId,schoolId:ctx.schoolId,checked:rows.length,
    fullyVerified:rows.length>0&&rows.every(row=>row.mapped),
    verified:rows.filter(row=>row.mapped).length,
    identityAndClassMatched:rows.filter(row=>row.identityAndClassMatched).length,
    needsAttention:rows.filter(row=>!row.mapped).length,
    mode:"preview_only_no_writes",rows
  };
}
module.exports={previewLegacyEvidenceMigration};
