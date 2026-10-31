"use strict";
/**
 * School-specific academic catalog, enrollments and staff teaching grants.
 * Person !== auth user !== enrollment. School and subject/section/year offering
 * references are checked on the server for every mutation or class-roster read.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const CATALOG=new Set(["academic_years","terms","subjects","sections"]);
function deny(code,message){throw new TenantAccessError(code,message)}
function checkId(value,label="Identifier"){
 if(typeof value!=="string"||!ID.test(value))deny("invalid-argument",label+" must contain 1–80 letters, digits, underscores or hyphens.");
 return value;
}
function checkName(value,label="Name"){
 if(typeof value!=="string"||!value.trim()||value.trim().length>140)
  deny("invalid-argument",label+" is required and cannot exceed 140 characters.");
 return value.trim();
}
function rowKey(...values){return values.map(v=>checkId(v)).join("--")}
function createSchoolAcademicsService({db}) {
 const root=id=>db.collection("schools/"+id);
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
  if(input.action==="create_catalog"){
   requireAdmin();
   const kind=input.kind;
   if(!CATALOG.has(kind))deny("invalid-argument","Unknown academic catalog type.");
   const itemId=checkId(input.recordId),name=checkName(input.name),ref=schoolRoot.doc(kind+"/"+itemId);
   const auditRef=schoolRoot.doc("directory_audit/"+schoolRoot.doc().id);
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
   const snap=await schoolRoot.doc(kind+"/_schema_placeholder").parent.orderBy("name").limit(200).get();
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
   const auditRef=schoolRoot.doc("directory_audit/"+schoolRoot.doc().id);
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
    const grants=await schoolRoot.doc("staff_assignments/_schema_placeholder").parent
      .where("teacherUid","==",uid).limit(101).get();
    allowed=new Set(grants.docs.filter(d=>d.data().status==="active").map(d=>d.data().offeringId));
    if(grants.size===101)deny("resource-exhausted","Too many teaching assignments. Contact the school administrator.");
   }
   const snap=await schoolRoot.doc("course_offerings/_schema_placeholder").parent.limit(201).get();
   if(snap.size===201)deny("resource-exhausted","Offering list is too large. Refine the academic year before continuing.");
   return {offerings:snap.docs.filter(doc=>admin||allowed.has(doc.id))
    .map(doc=>({offeringId:doc.id,yearId:doc.data().yearId,termId:doc.data().termId,
      subjectId:doc.data().subjectId,sectionId:doc.data().sectionId,status:doc.data().status}))};
  }
  if(input.action==="enroll_student"){
   requireAdmin();
   const personId=checkId(input.personId,"Person ID"),
     offeringId=checkId(input.offeringId,"Course offering ID");
   const ref=schoolRoot.doc("enrollments/"+rowKey(personId,offeringId));
   const personRef=schoolRoot.doc("people/"+personId);
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId);
   const auditRef=schoolRoot.doc("directory_audit/"+schoolRoot.doc().id);
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
  if(input.action==="assign_teacher"||input.action==="end_teacher_assignment"){
   requireAdmin();
   const teacherUid=checkId(input.teacherUid,"Teacher account UID"),
     offeringId=checkId(input.offeringId,"Course offering ID");
   const ref=schoolRoot.doc("staff_assignments/"+rowKey(teacherUid,offeringId));
   const offeringRef=schoolRoot.doc("course_offerings/"+offeringId),
    teacherMemberRef=schoolRoot.doc("memberships/"+teacherUid);
   const auditRef=schoolRoot.doc("directory_audit/"+schoolRoot.doc().id);
   const ending=input.action==="end_teacher_assignment";
   const reason=ending?checkName(input.reason,"Handover reason"):null;
   await db.runTransaction(async tx=>{
    await checkWriteAuthority(tx);
    const [offering,staff,prior]=await Promise.all([
      tx.get(offeringRef),tx.get(teacherMemberRef),tx.get(ref)
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
      tx.update(ref,{status:"ended",endedByUid:uid,endedAt:FieldValue.serverTimestamp(),
        endReason:reason,revision:(prior.data().revision||1)+1});
    }else{
      if(prior.exists)deny("already-exists","A teaching assignment exists. Use audited recovery rather than replacing its history.");
      if(offering.data().status!=="active")deny("failed-precondition","Cannot assign a closed course offering.");
      tx.create(ref,{schoolId:ctx.schoolId,teacherUid,offeringId,
        yearId:offering.data().yearId,termId:offering.data().termId,
        subjectId:offering.data().subjectId,sectionId:offering.data().sectionId,
        status:"active",revision:1,createdByUid:uid,createdAt:FieldValue.serverTimestamp()});
    }
    tx.create(auditRef,audit(ending?"teacher_assignment_ended":"teacher_assigned",{teacherUid,offeringId}));
   });
   return {teacherUid,offeringId,status:ending?"ended":"active"};
  }
  if(input.action==="class_roster"){
   if(!admin&&!teacher)deny("permission-denied","Class roster access is restricted.");
   const offeringId=checkId(input.offeringId,"Course offering ID");
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
   const snap=await schoolRoot.doc("enrollments/_schema_placeholder").parent
     .where("offeringId","==",offeringId).limit(101).get();
   if(snap.size===101)deny("resource-exhausted","Class roster exceeds the first page. Use paginated school roster.");
   const current=snap.docs.filter(d=>d.data().schoolId===ctx.schoolId&&d.data().status==="active");
   const people=await Promise.all(current.map(record=>schoolRoot.doc("people/"+record.data().personId).get()));
   return {offeringId,students:current.map((record,i)=>({
     personId:record.data().personId,enrollmentId:record.id,
     name:people[i].exists&&people[i].data().schoolId===ctx.schoolId?
       people[i].data().displayName:"Unlinked student record"
   }))};
  }
  deny("invalid-argument","Unknown academic operation.");
 };
}
module.exports={createSchoolAcademicsService,checkId,rowKey};
