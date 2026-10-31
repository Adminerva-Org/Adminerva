"use strict";
/**
 * School-specific academic catalog, enrollments and staff teaching grants.
 * Person !== auth user !== enrollment. School and subject/section/year offering
 * references are checked on the server for every mutation or class-roster read.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const {writeSchoolNotification}=require("./school-notifications.js");
const CATALOG=new Set(["academic_years","terms","subjects","sections"]);
function deny(code,message){throw new TenantAccessError(code,message)}
function checkId(value,label="Identifier",max=80){
 if(typeof value!=="string"||value.length>max||!new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,"+(max-1)+"}$").test(value))deny("invalid-argument",label+" must contain 1–80 letters, digits, underscores or hyphens.");
 return value;
}
function checkName(value,label="Name"){
 if(typeof value!=="string"||!value.trim()||value.trim().length>140)
  deny("invalid-argument",label+" is required and cannot exceed 140 characters.");
 return value.trim();
}
function rowKey(...values){
 const checked=values.map(v=>checkId(v,"Key segment",330));
 return createHash("sha256").update(JSON.stringify(checked)).digest("hex");
}
function createSchoolAcademicsService({db}) {
 const root=id=>({doc:path=>db.doc("schools/"+id+"/"+path)});
 return async request=>{
  const input=request.data||{},ctx=await getSchoolContext({db,request,schoolId:input.schoolId});
  const schoolRoot=root(ctx.schoolId),uid=ctx.uid;
  const admin=ctx.roles.includes("school_admin"),teacher=ctx.roles.includes("teacher");
  const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
  const memberRef=db.doc("schools/"+ctx.schoolId+"/memberships/"+uid);
  function requireAdmin(){if(!admin)deny("permission-denied","School administration is required.");}
  async function checkWriteAuthority(tx){
   const [school,membership]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
   if(!school.exists||school.data().state!=="active"||!membership.exists||
    membership.data().schoolId!==ctx.schoolId||membership.data().status!=="active"||
    !Array.isArray(membership.data().roles)||!membership.data().roles.includes("school_admin"))
    deny("permission-denied","Your school administration permission has changed.");
  }
  const audit=(action,extra={})=>({schoolId:ctx.schoolId,actorUid:uid,action,
    ...extra,createdAt:FieldValue.serverTimestamp()});
  if(input.action==="list_teachers"){
   requireAdmin();
   const snap=await db.collection("schools/"+ctx.schoolId+"/memberships")
     .where("roles","array-contains","teacher").limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Teacher directory requires pagination.");
   return {teachers:snap.docs.filter(doc=>doc.data().status==="active"&&doc.data().schoolId===ctx.schoolId)
     .map(doc=>({uid:doc.id,name:typeof doc.data().displayName==="string"?
       doc.data().displayName:"Teacher "+doc.id.slice(0,8)}))};
  }
  if(input.action==="list_students"){
   requireAdmin();
   const snap=await db.collection("schools/"+ctx.schoolId+"/people")
     .where("kind","==","student").limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Student picker requires paginated school directory search.");
   return {students:snap.docs.filter(doc=>doc.data().status==="active"&&doc.data().schoolId===ctx.schoolId)
     .map(doc=>({personId:doc.id,name:doc.data().displayName}))};
  }
  if(input.action==="create_catalog"){
   requireAdmin();
   const kind=input.kind;
   if(!CATALOG.has(kind))deny("invalid-argument","Unknown academic catalog type.");
   const itemId=checkId(input.recordId),name=checkName(input.name),ref=schoolRoot.doc(kind+"/"+itemId);
   const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   const parentYear=input.yearId?checkId(input.yearId,"Academic year ID"):null;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    if((await tx.get(ref)).exists)deny("already-exists","An academic catalog record with this ID exists.");
    if(kind==="terms"){
     if(!parentYear)deny("invalid-argument","Term requires academic year ID.");
     const year=await tx.get(schoolRoot.doc("academic_years/"+parentYear));
     if(!year.exists||year.data().schoolId!==ctx.schoolId)
      deny("failed-precondition","Academic year does not exist in this school.");
    }
    const now=FieldValue.serverTimestamp();
    tx.create(ref,{schoolId:ctx.schoolId,name,status:"active",
      yearId:kind==="terms"?parentYear:null,revision:1,createdByUid:uid,
      createdAt:now,updatedAt:now});
    tx.create(auditRef,audit("academic_catalog_created",{kind,recordId:itemId}));
   });
   return {recordId:itemId,kind,status:"active"};
  }
  if(input.action==="list_catalog"){
   requireAdmin();
   const kind=input.kind;
   if(!CATALOG.has(kind))deny("invalid-argument","Unknown academic catalog type.");
   const snap=await db.collection("schools/"+ctx.schoolId+"/"+kind).orderBy("name").limit(200).get();
   return {items:snap.docs.map(doc=>({id:doc.id,name:doc.data().name,
    yearId:doc.data().yearId,status:doc.data().status})),truncated:snap.size===200};
  }
  if(input.action==="create_offering"){
   requireAdmin();
   const yearId=checkId(input.yearId,"Academic year"),termId=checkId(input.termId,"Term"),
    subjectId=checkId(input.subjectId,"Subject"),sectionId=checkId(input.sectionId,"Section");
   const offeringId=rowKey(yearId,termId,sectionId,subjectId);
   const ref=schoolRoot.doc("course_offerings/"+offeringId);
   const refs=[
    schoolRoot.doc("academic_years/"+yearId),
    schoolRoot.doc("terms/"+termId),
    schoolRoot.doc("subjects/"+subjectId),
    schoolRoot.doc("sections/"+sectionId)
   ];
   const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const catalog=await Promise.all(refs.map(ref=>tx.get(ref)));
    if(catalog.some(doc=>!doc.exists||doc.data().schoolId!==ctx.schoolId||doc.data().status!=="active"))
      deny("failed-precondition","Offering references must be active catalog records at this school.");
    if(catalog[1].data().yearId!==yearId)
      deny("failed-precondition","The selected term belongs to another academic year.");
    if((await tx.get(ref)).exists)deny("already-exists","This school course offering already exists.");
    tx.create(ref,{schoolId:ctx.schoolId,yearId,termId,subjectId,sectionId,
      status:"active",revision:1,createdByUid:uid,createdAt:FieldValue.serverTimestamp()});
    tx.create(auditRef,audit("course_offering_created",{offeringId}));
   });
   return {offeringId,status:"active"};
  }
  if(input.action==="list_offerings"){
   if(!admin&&!teacher)deny("permission-denied","Teaching access is required.");
   let allowed=null;
   if(!admin) {
    const grants=await db.collection("schools/"+ctx.schoolId+"/staff_assignments")
      .where("teacherUid","==",uid).limit(101).get();
    allowed=new Set(grants.docs.filter(d=>d.data().status==="active").map(d=>d.data().offeringId));
    if(grants.size===101)deny("resource-exhausted","Too many teaching assignments. Contact the school administrator.");
   }
   const snap=await db.collection("schools/"+ctx.schoolId+"/course_offerings").limit(201).get();
   if(snap.size===201)deny("resource-exhausted","Offering list is too large. Refine the academic year before continuing.");
   return {offerings:snap.docs.filter(doc=>admin||allowed.has(doc.id))
    .map(doc=>({offeringId:doc.id,yearId:doc.data().yearId,termId:doc.data().termId,
      subjectId:doc.data().subjectId,sectionId:doc.data().sectionId,status:doc.data().status}))};
  }
  if(input.action==="bulk_enroll_students"){
   requireAdmin();
   const offeringId=checkId(input.offeringId,"Course offering ID",330);
   const personIds=Array.isArray(input.personIds)?[...new Set(input.personIds.map(value=>checkId(value,"Person ID",128)))]:[];
   if(!personIds.length||personIds.length>80)
    deny("invalid-argument","Select between 1 and 80 students for a bulk enrollment.");
   const reason=checkName(input.reason,"Bulk enrollment reason");
   if(reason.length<12)deny("invalid-argument","Explain the bulk enrollment in at least 12 characters.");
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId);
   const personRefs=personIds.map(personId=>schoolRoot.doc("people/"+personId));
   const enrollmentRefs=personIds.map(personId=>schoolRoot.doc("enrollments/"+rowKey(personId,offeringId)));
   const auditRefs=personIds.map(()=>db.collection("schools/"+ctx.schoolId+"/directory_audit").doc());
   let result;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const [offering,...records]=await Promise.all([
      tx.get(offeringRef),
      ...personRefs.map(ref=>tx.get(ref)),
      ...enrollmentRefs.map(ref=>tx.get(ref))
    ]);
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||offering.data().status!=="active")
      deny("failed-precondition","Select an active school course offering.");
    const people=records.slice(0,personIds.length),existing=records.slice(personIds.length);
    if(people.some(person=>!person.exists||person.data().schoolId!==ctx.schoolId||
       person.data().kind!=="student"||person.data().status!=="active"))
      deny("failed-precondition","Every selected person must be an active student in this school.");
    const now=FieldValue.serverTimestamp();let created=0,alreadyActive=0,historyExists=0;
    personIds.forEach((personId,index)=>{
      const prior=existing[index];
      if(prior.exists){
        if(prior.data().schoolId!==ctx.schoolId||prior.data().personId!==personId||
           prior.data().offeringId!==offeringId)
          deny("failed-precondition","An enrollment key collision requires manual review.");
        if(prior.data().status==="active")alreadyActive++;
        else historyExists++;
        return;
      }
      created++;
      tx.create(enrollmentRefs[index],{schoolId:ctx.schoolId,personId,offeringId,
        yearId:offering.data().yearId,termId:offering.data().termId,
        sectionId:offering.data().sectionId,subjectId:offering.data().subjectId,
        status:"active",revision:1,createdByUid:uid,createdAt:now});
      tx.create(auditRefs[index],audit("student_bulk_enrolled",{personId,offeringId,reason}));
    });
    result={offeringId,selected:personIds.length,created,alreadyActive,historyExists};
   });
   return result;
  }
  if(input.action==="bulk_assign_teachers"){
   requireAdmin();
   const offeringId=checkId(input.offeringId,"Course offering ID",330);
   const teacherUids=Array.isArray(input.teacherUids)?[...new Set(input.teacherUids.map(value=>
     checkId(value,"Teacher account UID",128)))]:[];
   if(!teacherUids.length||teacherUids.length>30)
    deny("invalid-argument","Select between 1 and 30 teachers for a bulk class assignment.");
   const reason=checkName(input.reason,"Bulk teacher assignment reason");
   if(reason.length<12)deny("invalid-argument","Explain the bulk teacher assignment in at least 12 characters.");
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId);
   const memberRefs=teacherUids.map(teacherUid=>schoolRoot.doc("memberships/"+teacherUid));
   const assignmentRefs=teacherUids.map(teacherUid=>schoolRoot.doc("staff_assignments/"+rowKey(teacherUid,offeringId)));
   const auditRefs=teacherUids.map(()=>db.collection("schools/"+ctx.schoolId+"/directory_audit").doc());
   let result;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const [offering,...records]=await Promise.all([
      tx.get(offeringRef),
      ...memberRefs.map(ref=>tx.get(ref)),
      ...assignmentRefs.map(ref=>tx.get(ref))
    ]);
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||offering.data().status!=="active")
      deny("failed-precondition","Select an active school course offering.");
    const members=records.slice(0,teacherUids.length),existing=records.slice(teacherUids.length);
    if(members.some(member=>!member.exists||member.data().schoolId!==ctx.schoolId||
       member.data().status!=="active"||!Array.isArray(member.data().roles)||
       !member.data().roles.includes("teacher")))
      deny("permission-denied","Every selected account must be an active teacher in this school.");
    const now=FieldValue.serverTimestamp();let created=0,alreadyActive=0,historyExists=0;
    teacherUids.forEach((teacherUid,index)=>{
      const prior=existing[index];
      if(prior.exists){
        if(prior.data().schoolId!==ctx.schoolId||prior.data().teacherUid!==teacherUid||
           prior.data().offeringId!==offeringId)
          deny("failed-precondition","A teaching-assignment key collision requires manual review.");
        if(prior.data().status==="active")alreadyActive++;
        else historyExists++;
        return;
      }
      created++;
      tx.create(assignmentRefs[index],{schoolId:ctx.schoolId,teacherUid,offeringId,
        yearId:offering.data().yearId,termId:offering.data().termId,
        subjectId:offering.data().subjectId,sectionId:offering.data().sectionId,
        status:"active",revision:1,createdByUid:uid,createdAt:now});
      tx.create(auditRefs[index],audit("teacher_bulk_assigned",{teacherUid,offeringId,reason}));
    });
    result={offeringId,selected:teacherUids.length,created,alreadyActive,historyExists};
   });
   return result;
  }
  if(input.action==="enroll_student"){
   requireAdmin();
   const personId=checkId(input.personId,"Person ID"),
     offeringId=checkId(input.offeringId,"Course offering ID",330);
   const ref=schoolRoot.doc("enrollments/"+rowKey(personId,offeringId));
   const personRef=schoolRoot.doc("people/"+personId);
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId);
   const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const [person,offering,prior]=await Promise.all([
      tx.get(personRef),tx.get(offeringRef),tx.get(ref)
    ]);
    if(!person.exists||person.data().schoolId!==ctx.schoolId||person.data().kind!=="student"||
       person.data().status!=="active")
      deny("failed-precondition","Select an active student person in this school.");
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||offering.data().status!=="active")
      deny("failed-precondition","Select an active school course offering.");
    if(prior.exists)deny("already-exists","The student already has an enrollment for this offering. Preserve its history.");
    tx.create(ref,{schoolId:ctx.schoolId,personId,offeringId,
      yearId:offering.data().yearId,termId:offering.data().termId,
      sectionId:offering.data().sectionId,subjectId:offering.data().subjectId,
      status:"active",revision:1,createdByUid:uid,createdAt:FieldValue.serverTimestamp()});
    tx.create(auditRef,audit("student_enrolled",{personId,offeringId}));
   });
   return {personId,offeringId,status:"active"};
  }

  if(input.action==="handover_offering"){
   requireAdmin();
   const offeringId=checkId(input.offeringId,"Course offering ID",330),
    fromTeacherUid=checkId(input.fromTeacherUid,"Current teacher UID",128),
    toTeacherUid=checkId(input.toTeacherUid,"Replacement teacher UID",128),
    reason=checkName(input.reason,"Teacher handover reason");
   if(fromTeacherUid===toTeacherUid)
    deny("invalid-argument","Choose a different replacement teacher.");
   if(reason.length<12)
    deny("invalid-argument","Explain the teacher handover in at least 12 characters.");
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId),
    fromRef=schoolRoot.doc("staff_assignments/"+rowKey(fromTeacherUid,offeringId)),
    toRef=schoolRoot.doc("staff_assignments/"+rowKey(toTeacherUid,offeringId)),
    toMemberRef=schoolRoot.doc("memberships/"+toTeacherUid),
    directoryAudit=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc(),
    assessmentAudit=db.collection("schools/"+ctx.schoolId+"/assessment_audit").doc();
   let result;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const taskQuery=db.collection("schools/"+ctx.schoolId+"/assessments")
      .where("offeringId","==",offeringId).limit(101);
    const [offering,fromAssignment,toAssignment,toMember,tasks]=await Promise.all([
      tx.get(offeringRef),tx.get(fromRef),tx.get(toRef),tx.get(toMemberRef),tx.get(taskQuery)
    ]);
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId||
       offering.data().status!=="active")
      deny("failed-precondition","Teacher handover requires an active course offering.");
    if(!fromAssignment.exists||fromAssignment.data().schoolId!==ctx.schoolId||
       fromAssignment.data().teacherUid!==fromTeacherUid||
       fromAssignment.data().offeringId!==offeringId||
       fromAssignment.data().status!=="active")
      deny("failed-precondition","The current teacher does not have an active assignment for this offering.");
    if(!toMember.exists||toMember.data().schoolId!==ctx.schoolId||
       toMember.data().status!=="active"||!Array.isArray(toMember.data().roles)||
       !toMember.data().roles.includes("teacher"))
      deny("permission-denied","The replacement account must be an active verified teacher in this school.");
    if(tasks.size===101)
      deny("resource-exhausted","This offering has more than 100 assessment deployments. Use a paginated handover workflow.");
    if(toAssignment.exists&&
       (toAssignment.data().schoolId!==ctx.schoolId||
        toAssignment.data().teacherUid!==toTeacherUid||
        toAssignment.data().offeringId!==offeringId))
      deny("failed-precondition","The replacement teaching-assignment key conflicts with another record.");
    const applicable=tasks.docs.filter(doc=>{
      const data=doc.data(),reviewerUid=data.reviewerUid||data.ownerUid;
      return data.schoolId===ctx.schoolId&&reviewerUid===fromTeacherUid&&
        data.lifecycle!=="cancelled";
    });
    const now=FieldValue.serverTimestamp();
    tx.update(fromRef,{status:"ended",endedByUid:uid,endedAt:now,
      endReason:reason,revision:(fromAssignment.data().revision||1)+1});
    let replacementAssignmentState;
    if(!toAssignment.exists){
      replacementAssignmentState="created";
      tx.create(toRef,{schoolId:ctx.schoolId,teacherUid:toTeacherUid,offeringId,
        yearId:offering.data().yearId,termId:offering.data().termId,
        subjectId:offering.data().subjectId,sectionId:offering.data().sectionId,
        status:"active",revision:1,createdByUid:uid,createdAt:now});
    }else if(toAssignment.data().status==="ended"){
      replacementAssignmentState="restored";
      tx.update(toRef,{status:"active",restoredByUid:uid,restoredAt:now,
        restoreReason:reason,revision:(toAssignment.data().revision||1)+1});
    }else if(toAssignment.data().status==="active"){
      replacementAssignmentState="already_active";
    }else{
      deny("failed-precondition","The replacement teacher assignment is in an unsupported state.");
    }
    for(const task of applicable){
      const data=task.data(),revision=data.revision||1;
      tx.update(task.ref,{
        reviewerUid:toTeacherUid,
        handoverFromUid:fromTeacherUid,
        handoverByUid:uid,
        handoverAt:now,
        handoverReason:reason,
        revision:revision+1,
        updatedAt:now
      });
    }
    tx.create(directoryAudit,audit("teacher_offering_handed_over",{
      offeringId,fromTeacherUid,toTeacherUid,reason,
      replacementAssignmentState,assessmentCount:applicable.length
    }));
    tx.create(assessmentAudit,{
      schoolId:ctx.schoolId,actorUid:uid,action:"assessment_review_responsibility_handover",
      offeringId,fromTeacherUid,toTeacherUid,taskIds:applicable.map(doc=>doc.id),
      assessmentCount:applicable.length,reason,createdAt:now
    });
    result={offeringId,fromTeacherUid,toTeacherUid,
      replacementAssignmentState,assessmentCount:applicable.length};
   });
   await writeSchoolNotification({
    db,schoolId:ctx.schoolId,uid:toTeacherUid,
    id:"teacher_handover_"+offeringId+"_"+fromTeacherUid+"_"+toTeacherUid,
    title:"Class responsibility assigned",
    body:"You are now responsible for this course offering and its existing deployed assessment reviews.",
    type:"assessment",sourceId:offeringId,target:"teacher-assessment-library.html"
   }).catch(()=>{});
   return result;
  }

  if(["assign_teacher","end_teacher_assignment","restore_teacher_assignment"].includes(input.action)){
   requireAdmin();
   const teacherUid=checkId(input.teacherUid,"Teacher account UID",128),
     offeringId=checkId(input.offeringId,"Course offering ID",330);
   const ref=schoolRoot.doc("staff_assignments/"+rowKey(teacherUid,offeringId));
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId),
    teacherMemberRef=schoolRoot.doc("memberships/"+teacherUid);
   const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   const ending=input.action==="end_teacher_assignment";
   const restoring=input.action==="restore_teacher_assignment";
   const reason=(ending||restoring)?checkName(input.reason,restoring?"Restore reason":"Handover reason"):null;
   if(reason&&reason.length<12)deny("invalid-argument","Explain the teaching assignment change in at least 12 characters.");
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const taskQuery=ending?db.collection("schools/"+ctx.schoolId+"/assessments")
      .where("offeringId","==",offeringId).limit(101):null;
    const [offering,staff,prior,responsibilities]=await Promise.all([
      tx.get(offeringRef),tx.get(teacherMemberRef),tx.get(ref),
      taskQuery?tx.get(taskQuery):Promise.resolve(null)
    ]);
    if(!offering.exists||offering.data().schoolId!==ctx.schoolId)
      deny("failed-precondition","Course offering is not in this school.");
    if(!ending&&(!staff.exists||staff.data().schoolId!==ctx.schoolId||
       staff.data().status!=="active"||!Array.isArray(staff.data().roles)||
       !staff.data().roles.includes("teacher")))
      deny("permission-denied","The account is not an active teacher of this school.");
    if(ending) {
      if(!prior.exists||prior.data().status!=="active")
        deny("failed-precondition","There is no active appointment to end.");
      if(responsibilities?.size===101)
        deny("resource-exhausted","This class has more than 100 assessment deployments. Review handover before ending the teacher assignment.");
      const outstanding=(responsibilities?.docs||[]).filter(doc=>{
        const data=doc.data();
        return data.schoolId===ctx.schoolId&&(data.reviewerUid||data.ownerUid)===teacherUid&&
          data.lifecycle!=="cancelled";
      });
      if(outstanding.length)
        deny("failed-precondition","This teacher still has review responsibility for deployed assessments. Use Teacher handover so submissions and Gradebook access are not stranded.");
      tx.update(ref,{status:"ended",endedByUid:uid,endedAt:FieldValue.serverTimestamp(),
        endReason:reason,revision:(prior.data().revision||1)+1});
    }else if(restoring){
      if(!prior.exists||prior.data().status!=="ended")
        deny("failed-precondition","Only an ended teaching assignment can be restored.");
      if(offering.data().status!=="active")
        deny("failed-precondition","A teacher cannot be restored to a closed course offering.");
      tx.update(ref,{status:"active",restoredByUid:uid,restoredAt:FieldValue.serverTimestamp(),
        restoreReason:reason,revision:(prior.data().revision||1)+1});
    }else{
      if(prior.exists)deny("already-exists","A teaching assignment already has history. Restore an ended assignment instead of replacing it.");
      if(offering.data().status!=="active")deny("failed-precondition","Cannot assign a closed course offering.");
      tx.create(ref,{schoolId:ctx.schoolId,teacherUid,offeringId,
        yearId:offering.data().yearId,termId:offering.data().termId,
        subjectId:offering.data().subjectId,sectionId:offering.data().sectionId,
        status:"active",revision:1,createdByUid:uid,createdAt:FieldValue.serverTimestamp()});
    }
    tx.create(auditRef,audit(ending?"teacher_assignment_ended":
      restoring?"teacher_assignment_restored":"teacher_assigned",{teacherUid,offeringId,reason}));
   });
   return {teacherUid,offeringId,status:ending?"ended":"active"};
  }
  if(["end_enrollment","restore_enrollment"].includes(input.action)){
   requireAdmin();
   const enrollmentId=checkId(input.enrollmentId,"Enrollment ID",128);
   const reason=checkName(input.reason,input.action==="end_enrollment"?"Enrollment end reason":"Enrollment restore reason");
   if(reason.length<12)deny("invalid-argument","Explain the enrollment change in at least 12 characters.");
   const ref=schoolRoot.doc("enrollments/"+enrollmentId);
   const auditRef=db.collection("schools/"+ctx.schoolId+"/directory_audit").doc();
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const record=await tx.get(ref);
    if(!record.exists||record.data().schoolId!==ctx.schoolId)
      deny("not-found","The enrollment is not in this school.");
    const data=record.data(),ending=input.action==="end_enrollment";
    if(ending&&data.status!=="active")
      deny("failed-precondition","Only an active enrollment can be ended.");
    if(!ending&&data.status!=="ended")
      deny("failed-precondition","Only an ended enrollment can be restored.");
    if(!ending){
      const [person,offering]=await Promise.all([
        tx.get(schoolRoot.doc("people/"+data.personId)),
        tx.get(schoolRoot.doc("course_offerings/"+data.offeringId))
      ]);
      if(!person.exists||person.data().schoolId!==ctx.schoolId||
         person.data().kind!=="student"||person.data().status!=="active"||
         !offering.exists||offering.data().schoolId!==ctx.schoolId||
         offering.data().status!=="active")
        deny("failed-precondition","The student and course offering must both be active before restoring enrollment.");
    }
    const now=FieldValue.serverTimestamp(),revision=(data.revision||1)+1;
    tx.update(ref,ending?
      {status:"ended",endedByUid:uid,endedAt:now,endReason:reason,revision}:
      {status:"active",restoredByUid:uid,restoredAt:now,restoreReason:reason,revision});
    tx.create(auditRef,audit(ending?"student_enrollment_ended":"student_enrollment_restored",{
      enrollmentId,personId:data.personId,offeringId:data.offeringId,reason
    }));
   });
   return {enrollmentId,status:input.action==="end_enrollment"?"ended":"active"};
  }
  if(input.action==="class_roster"){
   if(!admin&&!teacher)deny("permission-denied","Class roster access is restricted.");
   const offeringId=checkId(input.offeringId,"Course offering ID",330);
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId);
   const offering=await offeringRef.get();
   if(!offering.exists||offering.data().schoolId!==ctx.schoolId)
    deny("not-found","Course offering is unavailable.");
   if(!admin){
    const grant=await schoolRoot.doc("staff_assignments/"+rowKey(uid,offeringId)).get();
    if(!grant.exists||grant.data().status!=="active"||grant.data().schoolId!==ctx.schoolId||
      grant.data().teacherUid!==uid)
      deny("permission-denied","Only an assigned teacher can read this class roster.");
   }
   const [snap,staffSnap]=await Promise.all([
    db.collection("schools/"+ctx.schoolId+"/enrollments").where("offeringId","==",offeringId).limit(101).get(),
    admin?db.collection("schools/"+ctx.schoolId+"/staff_assignments").where("offeringId","==",offeringId).limit(101).get():Promise.resolve(null)
   ]);
   if(snap.size===101||staffSnap?.size===101)
    deny("resource-exhausted","Class roster exceeds the first page. Use paginated school roster.");
   const rows=snap.docs.filter(d=>d.data().schoolId===ctx.schoolId&&(admin||d.data().status==="active"));
   const people=await Promise.all(rows.map(record=>schoolRoot.doc("people/"+record.data().personId).get()));
   let staff=[];
   if(admin&&staffSnap){
    const grants=staffSnap.docs.filter(d=>d.data().schoolId===ctx.schoolId);
    const memberships=await Promise.all(grants.map(record=>schoolRoot.doc("memberships/"+record.data().teacherUid).get()));
    staff=grants.map((record,i)=>({
      assignmentId:record.id,teacherUid:record.data().teacherUid,status:record.data().status,
      name:memberships[i].exists&&memberships[i].data().schoolId===ctx.schoolId?
        memberships[i].data().displayName||("Teacher "+record.data().teacherUid.slice(0,8)):
        "Teacher "+record.data().teacherUid.slice(0,8)
    }));
   }
   return {offeringId,students:rows.map((record,i)=>({
     personId:record.data().personId,enrollmentId:record.id,status:record.data().status,
     name:people[i].exists&&people[i].data().schoolId===ctx.schoolId?
       people[i].data().displayName:"Unlinked student record"
   })),teachers:staff};
  }
  deny("invalid-argument","Unknown academic operation.");
 };
}
module.exports={createSchoolAcademicsService,checkId,rowKey};
