"use strict";
// A document draft is not a statutory form. Preserve the canonical grade
// revision and source references; never calculate or overwrite grades here.
const {createHash}=require("node:crypto");
const {FieldValue}=require("firebase-admin/firestore");
const {TenantAccessError}=require("./tenant-access.js");
const ACTIONS=new Set(["academic_record_packet","get_certificate_template","save_certificate_template","prepare_enrollment_certificate","get_enrollment_certificate","issue_enrollment_certificate","revoke_enrollment_certificate","verify_enrollment_certificate"]);
function canonicalValue(value){
  if(Array.isArray(value))return value.map(canonicalValue);
  if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalValue(value[key])]));
  return value;
}
const hash=(...parts)=>createHash("sha256").update(JSON.stringify(canonicalValue(parts))).digest("hex");
const certificateDigest=value=>hash(value);
function deny(code,message){throw new TenantAccessError(code,message);}
function id(raw,max=128){if(typeof raw!=="string"||!new RegExp("^[A-Za-z0-9][A-Za-z0-9_-]{0,"+(max-1)+"}$").test(raw))deny("invalid-argument","Invalid record identifier.");return raw;}
function str(raw,label,max=160,required=true){const s=typeof raw==="string"?raw.trim():"";if((required&&!s)||s.length>max)deny("invalid-argument","Review "+label+".");return s;}
function revision(value,min=1){if(!Number.isSafeInteger(value)||value<min)deny("invalid-argument","Refresh the record before continuing.");return value;}
function own(doc,schoolId){return doc.exists&&doc.data().schoolId===schoolId;}
function certificateTemplate(input){
  return {signatoryName:str(input.signatoryName,"signatory name"),signatoryTitle:str(input.signatoryTitle,"signatory title",100),
    schoolAddress:str(input.schoolAddress,"school address",220,false),schoolIdentifier:str(input.schoolIdentifier,"school identifier",80,false)};
}
function releasedGrade(row,schoolId,personId,offeringId,releasedRevision){
  return Boolean(row&&row.schoolId===schoolId&&row.personId===personId&&row.offeringId===offeringId&&row.status==="finalized"&&
    Number(row.finalizationRevision)===releasedRevision&&typeof row.finalGrade==="number"&&Number.isFinite(row.finalGrade));
}
async function registrarCredentialAction({db,ctx,input,requireMembership,student}){
  const root="schools/"+ctx.schoolId+"/",schoolRef=db.doc("platform_schools/"+ctx.schoolId),
    memberRef=db.doc(root+"memberships/"+ctx.uid),
    templateRef=db.doc(root+"configuration/registrar_enrollment_certificate");
  await requireMembership(ref=>ref.get());
  const audit=(personId,action,extra={})=>({schoolId:ctx.schoolId,personId,actorUid:ctx.uid,action,...extra,createdAt:FieldValue.serverTimestamp()});
  function template(doc){
    if(!doc.exists)return {revision:0,signatoryName:"",signatoryTitle:"",schoolAddress:"",schoolIdentifier:""};
    if(!own(doc,ctx.schoolId)||!Number.isSafeInteger(doc.data().revision)||doc.data().revision<1)deny("data-loss","Certificate template ownership or revision is inconsistent.");
    return {revision:doc.data().revision,...certificateTemplate(doc.data())};
  }
  async function bounded(query,max,label,read=ref=>ref.get()){
    const snap=await read(query.limit(max+1));if(snap.size>max)deny("resource-exhausted",label+" exceeds the safe preparation limit. Select a narrower academic year or contact the Registrar.");
    return snap.docs.filter(doc=>own(doc,ctx.schoolId));
  }
  async function label(read,collection,recordId){
    if(!recordId)return "";
    const doc=await read(db.doc(root+collection+"/"+id(recordId,330)));
    return own(doc,ctx.schoolId)?String(doc.data().name||recordId).slice(0,160):"";
  }
  if(input.action==="academic_record_packet"){
    const personId=id(input.personId),yearId=input.yearId?id(input.yearId):null,mode=input.mode;
    if(!["sf9","sf10"].includes(mode)||(mode==="sf9"&&!yearId))deny("invalid-argument","Choose an academic record type and academic year for SF9 preparation.");
    const a=await student(personId),profile=await db.doc(root+"student_registrar_profiles/"+personId).get();
    if(profile.exists&&(!own(profile,ctx.schoolId)||profile.data().personId!==personId))deny("data-loss","Student profile ownership mismatch.");
    const q=collection=>{let query=db.collection(root+collection).where("personId","==",personId);if(yearId)query=query.where("yearId","==",yearId);return query;};
    const [registrations,enrollments,gradeDocs]=await Promise.all([
      bounded(q("student_registrations"),100,"Registration history"),
      bounded(q("enrollments"),250,"Class enrollment history"),
      bounded(q("class_record_period_grades"),250,"Grade history")
    ]);
    const blockers=[],gradeMap=new Map(),ambiguousGradeIds=new Set(),enrollmentMap=new Map(),ambiguousEnrollmentIds=new Set(),registrationMap=new Map(registrations.map(doc=>[doc.id,doc.data()]));
    for(const doc of enrollments){
      const row=doc.data();if(row.personId!==personId)continue;
      if(row.offeringId){if(enrollmentMap.has(row.offeringId))ambiguousEnrollmentIds.add(row.offeringId);else enrollmentMap.set(row.offeringId,row);}
    }
    for(const doc of gradeDocs){
      const row=doc.data();if(row.personId!==personId)continue;
      if(row.offeringId){if(gradeMap.has(row.offeringId)||doc.id!==hash(row.offeringId,personId))ambiguousGradeIds.add(row.offeringId);if(!gradeMap.has(row.offeringId)||doc.id===hash(row.offeringId,personId))gradeMap.set(row.offeringId,doc);}
    }
    if(!registrations.length)blockers.push("No official registration history in the selected scope.");
    if(!own(profile,ctx.schoolId)||profile.data().lrnState!=="verified"||!/^\d{12}$/.test(profile.data().lrn||""))blockers.push("Verified learner reference number is missing.");
    // Include historical grade records even after section movement or ended enrollment.
    // Do not treat an ended class without a grade as completed.
    const offeringIds=[...new Set([...enrollmentMap.keys(),...gradeMap.keys()])];
    if(offeringIds.length>250)deny("resource-exhausted","Academic evidence scope exceeds 250 class offerings. Select a single academic year.");
    const rows=await Promise.all(offeringIds.map(async offeringId=>{
      id(offeringId,330);
      const [offering,finalization]=await Promise.all([db.doc(root+"course_offerings/"+offeringId).get(),db.doc(root+"class_record_finalizations/"+offeringId).get()]);
      const enrollment=enrollmentMap.get(offeringId),gradeDoc=gradeMap.get(offeringId),revision=own(finalization,ctx.schoolId)?Number(finalization.data().releasedRevision)||0:0;
      const placement=own(offering,ctx.schoolId)?offering.data():gradeDoc?.data()||enrollment||{};
      const [yearName,termName,subjectName,sectionName]=await Promise.all([
        label(ref=>ref.get(),"academic_years",placement.yearId),label(ref=>ref.get(),"terms",placement.termId),
        label(ref=>ref.get(),"subjects",placement.subjectId),label(ref=>ref.get(),"sections",placement.sectionId)]);
      const base={offeringId,yearId:placement.yearId||"",termId:placement.termId||"",subjectId:placement.subjectId||"",sectionId:placement.sectionId||"",
        yearName,termName,subjectName,sectionName,registrationId:enrollment?.registrationId||null,enrollmentStatus:enrollment?.status||"not_found"};
      if(ambiguousGradeIds.has(offeringId)||ambiguousEnrollmentIds.has(offeringId))return {...base,state:"ambiguous_evidence",releasedRevision:null,finalGrade:null};
      if((yearId&&placement.yearId!==yearId)||!yearName||!termName||!subjectName||!sectionName||!own(offering,ctx.schoolId))
        return {...base,state:"unresolved_placement",releasedRevision:null,finalGrade:null};
      if(!enrollment||!enrollment.registrationId||!registrationMap.has(enrollment.registrationId))
        return {...base,state:"unresolved_registration",releasedRevision:null,finalGrade:null};
      const reg=registrationMap.get(enrollment.registrationId);
      if(reg.yearId!==placement.yearId||reg.termId!==placement.termId||enrollment.yearId!==placement.yearId||enrollment.termId!==placement.termId)
        return {...base,state:"unresolved_registration",releasedRevision:null,finalGrade:null};
      if(!Number.isSafeInteger(revision)||revision<1||!gradeDoc)return {...base,state:"missing_released_grade",releasedRevision:null,finalGrade:null};
      const current=gradeDoc.data(),evidence=Number(current.finalizationRevision)===revision?gradeDoc:await gradeDoc.ref.collection("revisions").doc(String(revision)).get();
      const grade=evidence.exists?evidence.data():null;
      if(!releasedGrade(grade,ctx.schoolId,personId,offeringId,revision)||grade.yearId!==placement.yearId||grade.termId!==placement.termId||grade.subjectId!==placement.subjectId||grade.sectionId!==placement.sectionId)
        return {...base,state:"unresolved_released_revision",releasedRevision:revision,finalGrade:null};
      return {...base,state:"released",releasedRevision:revision,gradeRecordId:gradeDoc.id,finalGrade:grade.finalGrade,
        initialGrade:Number.isFinite(grade.initialGrade)?grade.initialGrade:null,periodGrade:Number.isFinite(grade.periodGrade)?grade.periodGrade:null};
    }));
    for(const doc of registrations){
      const reg=doc.data(),owned=enrollments.filter(e=>e.data().registrationId===doc.id&&e.data().yearId===reg.yearId&&e.data().termId===reg.termId&&e.data().sectionId===reg.sectionId);
      if(!owned.length||owned.length<Number(reg.courseCount||0))blockers.push("Registration "+doc.id+" has incomplete or legacy class-ownership evidence.");
    }
    const unresolved=rows.filter(row=>row.state!=="released").length;
    if(unresolved)blockers.push(unresolved+" class result(s) have unresolved placement or released-grade evidence.");
    if(!rows.length)blockers.push("No class result evidence found.");
    const years=[...new Set(registrations.map(doc=>doc.data().yearId).filter(Boolean))];
    return {mode,personId,yearId,studentName:a.data.displayName||"",studentNumber:a.data.studentNumber||"",
      lrnVerified:own(profile,ctx.schoolId)&&profile.data().lrnState==="verified",academicYears:years,
      rows:rows.sort((a,b)=>a.yearName.localeCompare(b.yearName)||a.termName.localeCompare(b.termName)||a.subjectName.localeCompare(b.subjectName)),
      blockers,completeWithinScope:blockers.length===0,officialForm:false,generatedAt:Date.now()};
  }
  if(input.action==="get_certificate_template")return template(await templateRef.get());
  if(input.action==="save_certificate_template"){
    const details=certificateTemplate(input),expected=revision(input.expectedRevision,0),reason=str(input.reason,"change reason",500);
    if(reason.length<8)deny("invalid-argument","Record a template change reason.");
    await db.runTransaction(async tx=>{
      await requireMembership(ref=>tx.get(ref));
      const [member,current]=await Promise.all([tx.get(memberRef),tx.get(templateRef)]);
      if(!own(member,ctx.schoolId)||!member.data().roles?.includes("school_admin"))deny("permission-denied","Only a verified School Administrator may configure signatories.");
      const previous=template(current);if(previous.revision!==expected)deny("failed-precondition","Template changed. Refresh.");
      const now=FieldValue.serverTimestamp(),payload={schoolId:ctx.schoolId,...details,revision:expected+1,updatedAt:now,updatedByUid:ctx.uid};
      if(current.exists)tx.update(templateRef,payload);else tx.create(templateRef,payload);
      tx.create(db.collection(root+"student_records_audit").doc(),audit(null,"certificate_template_saved",{reason,revision:expected+1}));
    });
    return {...details,revision:expected+1};
  }
  if(input.action==="verify_enrollment_certificate"){
    const reference=str(input.reference,"certificate reference",100).toUpperCase();
    if(!/^COE-[A-Z0-9]{20,64}$/.test(reference))deny("invalid-argument","Enter the certificate's Adminerva reference.");
    const snap=await db.collection(root+"student_document_requests").where("releaseReference","==",reference).limit(2).get();
    if(snap.size!==1||!own(snap.docs[0],ctx.schoolId)||snap.docs[0].data().generationMode!=="institutional")return {state:"not_found"};
    const row=snap.docs[0].data();if(row.status!=="released"||!row.issuedCertificate)return {state:"not_found"};
    if(row.issuedDigest!==certificateDigest(row.issuedCertificate))deny("data-loss","Certificate snapshot integrity check failed.");
    await db.collection(root+"student_records_audit").add(audit(row.personId,"enrollment_certificate_reference_checked",{requestId:snap.docs[0].id}));
    return {state:row.credentialState==="revoked"?"revoked":"recorded",reference,issuedAt:row.issuedAt?.toMillis?.()||null,
      studentName:row.issuedCertificate.studentName,yearName:row.issuedCertificate.yearName,termName:row.issuedCertificate.termName,
      signatureVerified:false};
  }
  const requestId=id(input.requestId),requestRef=db.doc(root+"student_document_requests/"+requestId);
  function checkRequest(doc){
    if(!own(doc,ctx.schoolId)||doc.data().type!=="certificate_of_enrollment"||doc.data().generationMode!=="institutional")
      deny("not-found","Institutional certificate request not found.");
    return doc.data();
  }
  async function snapshot(row,registrationId,read){
    const personId=id(row.personId),[person,school,config,reg]=await Promise.all([
      read(db.doc(root+"people/"+personId)),read(schoolRef),read(templateRef),read(db.doc(root+"student_registrations/"+id(registrationId)))
    ]);
    if(!own(person,ctx.schoolId)||person.data().kind!=="student"||person.data().status!=="active"||
       !own(reg,ctx.schoolId)||reg.data().personId!==personId||reg.data().status!=="active")
      deny("failed-precondition","A current active official registration is required for this certificate.");
    if(!school.exists||!["active","pilot"].includes(school.data().state))deny("failed-precondition","School is not active.");
    const t=template(config);if(!t.revision)deny("failed-precondition","School Administrator must configure the certificate signatory first.");
    const r=reg.data(),[yearName,termName,programName,sectionName]=await Promise.all([
      label(read,"academic_years",r.yearId),label(read,"terms",r.termId),label(read,"academic_programs",r.programId),label(read,"sections",r.sectionId)]);
    if(!yearName||!termName||!programName||!sectionName)deny("failed-precondition","Official placement labels are incomplete.");
    return {templateRevision:t.revision,registrationId,registrationRevision:Number(r.revision)||1,personRevision:Number(person.data().revision)||1,
      schoolName:str(school.data().displayName||school.data().name,"school name"),schoolAddress:t.schoolAddress,schoolIdentifier:t.schoolIdentifier,
      studentName:str(person.data().displayName,"student name"),studentNumber:person.data().studentNumber||"",yearName,termName,programName,sectionName,
      gradeLevel:r.gradeLevel||"",purpose:row.purpose||"",signatoryName:t.signatoryName,signatoryTitle:t.signatoryTitle};
  }
  if(input.action==="get_enrollment_certificate"){
    const row=checkRequest(await requestRef.get());
    await student(id(row.personId));
    if(row.status==="released"&&row.issuedCertificate){
      if(row.issuedDigest!==certificateDigest(row.issuedCertificate))deny("data-loss","Certificate snapshot integrity check failed.");
      return {state:row.credentialState||"issued",reference:row.releaseReference,issuedAt:row.issuedAt?.toMillis?.()||null,certificate:row.issuedCertificate,revision:Number(row.revision)||1};
    }
    const placements=await bounded(db.collection(root+"student_registrations").where("personId","==",row.personId).where("status","==","active"),50,"Active placements");
    return {state:row.status,revision:Number(row.revision)||1,certificate:row.certificateDraft||null,
      placements:await Promise.all(placements.map(async doc=>({registrationId:doc.id,label:[await label(ref=>ref.get(),"academic_years",doc.data().yearId),await label(ref=>ref.get(),"terms",doc.data().termId),await label(ref=>ref.get(),"sections",doc.data().sectionId)].join(" · ")})))};
  }
  const expected=revision(input.expectedRevision);
  if(input.action==="prepare_enrollment_certificate"){
    const registrationId=id(input.registrationId);
    let draft;
    await db.runTransaction(async tx=>{
      await requireMembership(ref=>tx.get(ref));
      const row=checkRequest(await tx.get(requestRef));
      if(Number(row.revision)!==expected||!["in_review","ready"].includes(row.status))deny("failed-precondition","Start review and refresh the request.");
      draft=await snapshot(row,registrationId,ref=>tx.get(ref));
      const now=FieldValue.serverTimestamp();
      tx.update(requestRef,{certificateDraft:draft,certificateDraftDigest:certificateDigest(draft),status:"in_review",revision:expected+1,updatedAt:now,updatedByUid:ctx.uid});
      tx.create(requestRef.collection("certificate_revisions").doc(String(expected+1)),{schoolId:ctx.schoolId,personId:row.personId,state:"draft",certificate:draft,digest:certificateDigest(draft),createdAt:now,actorUid:ctx.uid});
      tx.create(db.collection(root+"student_records_audit").doc(),audit(row.personId,"enrollment_certificate_prepared",{requestId,revision:expected+1}));
    });
    return {certificate:draft,revision:expected+1,state:"in_review"};
  }
  if(input.action==="issue_enrollment_certificate"){
    const reason=str(input.reason,"release confirmation",500);
    if(reason.length<12||input.confirmRelease!==true)deny("invalid-argument","Confirm that the certificate is ready for institutional release.");
    const reference="COE-"+hash(ctx.schoolId,requestId).slice(0,32).toUpperCase();
    let issued;
    await db.runTransaction(async tx=>{
      await requireMembership(ref=>tx.get(ref));
      const row=checkRequest(await tx.get(requestRef));
      if(Number(row.revision)!==expected||row.status!=="ready"||!row.certificateDraft)deny("failed-precondition","Prepare and approve the certificate before release.");
      issued=await snapshot(row,row.certificateDraft.registrationId,ref=>tx.get(ref));
      if(certificateDigest(issued)!==row.certificateDraftDigest)deny("failed-precondition","Source registration, student or template changed. Prepare and approve a new draft.");
      const now=FieldValue.serverTimestamp();
      tx.update(requestRef,{status:"released",credentialState:"issued",issuedCertificate:issued,issuedDigest:certificateDigest(issued),releaseReference:reference,
        issuedAt:now,issuedByUid:ctx.uid,releasedAt:now,releasedByUid:ctx.uid,revision:expected+1,updatedAt:now,updatedByUid:ctx.uid});
      tx.create(requestRef.collection("certificate_revisions").doc(String(expected+1)),{schoolId:ctx.schoolId,personId:row.personId,state:"issued",certificate:issued,digest:certificateDigest(issued),reference,createdAt:now,actorUid:ctx.uid});
      tx.create(db.collection(root+"student_records_audit").doc(),audit(row.personId,"enrollment_certificate_issued",{requestId,reference,reason,revision:expected+1}));
    });
    return {state:"issued",reference,certificate:issued,revision:expected+1};
  }
  if(input.action==="revoke_enrollment_certificate"){
    const reason=str(input.reason,"revocation reason",500);if(reason.length<12)deny("invalid-argument","Record the reason for revocation.");
    await db.runTransaction(async tx=>{
      await requireMembership(ref=>tx.get(ref));
      const row=checkRequest(await tx.get(requestRef));
      if(Number(row.revision)!==expected||row.status!=="released"||row.credentialState!=="issued")deny("failed-precondition","Only a current issued certificate can be revoked.");
      const now=FieldValue.serverTimestamp();
      tx.update(requestRef,{credentialState:"revoked",revokedAt:now,revokedByUid:ctx.uid,revocationReason:reason,revision:expected+1,updatedAt:now});
      tx.create(db.collection(root+"student_records_audit").doc(),audit(row.personId,"enrollment_certificate_revoked",{requestId,reason,revision:expected+1}));
    });
    return {state:"revoked",revision:expected+1};
  }
  deny("invalid-argument","Unknown institutional record action.");
}
module.exports={ACTIONS,registrarCredentialAction,releasedGrade,certificateTemplate,certificateDigest};
