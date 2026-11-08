"use strict";
/**
 * MCS limited-pilot control plane for the verified MCS school administrator.
 * This service never migrates or edits legacy assessments, grades, evidence,
 * submissions, planning, Practice history, or the legacy students collection.
 */
const {getAuth}=require("firebase-admin/auth");
const {FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const {verifiedUid,TenantAccessError}=require("./tenant-access.js");

const SCHOOL_ID="mcs-manila";
const PILOT_SECTIONS=[
  {sectionId:"shs-g11-techpro-ict-st-isidore-of-seville",name:"St. Isidore of Seville",expected:44},
  {sectionId:"shs-g11-techpro-ict-st-carlo-acutis",name:"St. Carlo Acutis",expected:34},
  {sectionId:"shs-g12-tvl-ict-st-philip-the-apostle",name:"St. Philip the Apostle",expected:45},
  {sectionId:"shs-g12-tvl-ict-st-anselm-of-canterbury",name:"St. Anselm of Canterbury",expected:44}
];
const EXPECTED_TOTAL=PILOT_SECTIONS.reduce((sum,row)=>sum+row.expected,0);

function fail(code,message){throw new TenantAccessError(code,message);}
function text(value,max=200){return typeof value==="string"?value.trim().replace(/\s+/g," ").slice(0,max):"";}
function email(value){
  const normalized=typeof value==="string"?value.trim().toLowerCase():"";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)?normalized:null;
}
function hash(value){return createHash("sha256").update(String(value)).digest("hex");}
const PILOT_ROSTER_EXTRA_FINGERPRINTS=new Set([
  "cf7772b07257f28cd40d7a4312caee77f51bf4679e819c720965ca08f3a450dd",
  "30d7957afbc810af9073fbc9d3f7fda52f9eeaa1f785010de6f05e4e34c70473"
]);
function foldedName(value){
  return text(value,160).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}
function displayName(data,fallback="Legacy student"){
  const direct=text(data?.displayName||data?.name||data?.fullName||data?.studentName,140);
  if(direct)return direct;
  const first=text(data?.firstName||data?.firstname||data?.first_name,70);
  const last=text(data?.lastName||data?.lastname||data?.last_name,70);
  return text([first,last].filter(Boolean).join(" "),140)||fallback;
}
function active(data){
  return !["archived","suspended","inactive","disabled","deleted"].includes(text(data?.status||"active",40).toLowerCase());
}
function sectionFor(data){
  const raw=text(data?.section||data?.sectionName||data?.classSection,240);
  if(!raw)return null;
  const tokens=raw.split(",").map(value=>text(value,160).toLowerCase()).filter(Boolean);
  return PILOT_SECTIONS.find(section=>tokens.includes(section.name.toLowerCase()))||null;
}
function reason(value,label="Reason"){
  const result=text(value,500);
  if(result.length<12)fail("invalid-argument",label+" must contain at least 12 characters.");
  return result;
}
async function schoolAdminContext(db,request){
  const uid=verifiedUid(request);
  const [school,member]=await Promise.all([
    db.doc("platform_schools/"+SCHOOL_ID).get(),
    db.doc("schools/"+SCHOOL_ID+"/memberships/"+uid).get()
  ]);
  const schoolData=school.exists?school.data():null,memberData=member.exists?member.data():null;
  if(!schoolData||!["draft","pilot","active"].includes(schoolData.state)||
     memberData?.schoolId!==SCHOOL_ID||memberData?.status!=="active"||
     !Array.isArray(memberData.roles)||!memberData.roles.includes("school_admin"))
    fail("permission-denied","Verified MCS school-administrator access is required.");
  return {uid,school:schoolData};
}
async function authUsersByEmail(auth,emails){
  const result=new Map(),values=[...new Set(emails.filter(Boolean))];
  for(let start=0;start<values.length;start+=100){
    const chunk=values.slice(start,start+100);
    const response=await auth.getUsers(chunk.map(value=>({email:value})));
    for(const user of response.users){
      const normalized=email(user.email);
      if(normalized)result.set(normalized,user);
    }
  }
  return result;
}
async function pilotSnapshot({db,auth,ctx,includeSectionRecords=true}){
  const [students,reviewDocs,exclusionDocs]=await Promise.all([
    db.collection("students").get(),
    db.collection("schools/"+SCHOOL_ID+"/pilot_identity_reviews").limit(300).get(),
    db.collection("schools/"+SCHOOL_ID+"/pilot_roster_exclusions").limit(100).get()
  ]);
  const reviews=new Map(reviewDocs.docs.filter(doc=>doc.data()?.status==="approved")
    .map(doc=>[doc.id,doc.data()]));
  const exclusions=new Map(exclusionDocs.docs.filter(doc=>doc.data()?.status==="excluded")
    .map(doc=>[doc.id,doc.data()]));
  const selected=[];
  for(const doc of students.docs){
    const data=doc.data(),section=sectionFor(data);
    if(!section||!active(data))continue;
    selected.push({legacyStudentId:doc.id,data,section});
  }
  const sourceEmails=selected.map(row=>email(row.data.email)).filter(Boolean);
  const usersByEmail=await authUsersByEmail(auth,sourceEmails);
  const uidRows=new Map(),records=[];
  for(const row of selected){
    const reviewed=reviews.get(row.legacyStudentId),legacyEmail=email(row.data.email),
      legacyUser=legacyEmail?usersByEmail.get(legacyEmail):null,
      verifiedLegacyUser=legacyUser&&legacyUser.emailVerified&&!legacyUser.disabled?legacyUser:null,
      linkedUid=reviewed?.authUid||verifiedLegacyUser?.uid||null,
      excluded=exclusions.has(row.legacyStudentId);
    if(linkedUid&&!excluded){
      const list=uidRows.get(linkedUid)||[];list.push(row.legacyStudentId);uidRows.set(linkedUid,list);
    }
    const studentDisplayName=displayName(row.data,"Legacy student "+row.legacyStudentId.slice(0,8));
    records.push({
      legacyStudentId:row.legacyStudentId,
      displayName:studentDisplayName,
      sectionId:row.section.sectionId,sectionName:row.section.name,
      excluded,linkedUid,linkSource:reviewed?"reviewed":verifiedLegacyUser?"legacy_email":"unresolved",
      rosterReviewHint:PILOT_ROSTER_EXTRA_FINGERPRINTS.has(hash(foldedName(studentDisplayName)))?
        "protected_roster_no_name_match":null
    });
  }
  const duplicateLinks=[...uidRows.entries()].filter(([,ids])=>ids.length>1)
    .map(([,ids])=>({legacyStudentIds:ids.slice(0,10),count:ids.length}));
  const included=records.filter(row=>!row.excluded);
  const counts=PILOT_SECTIONS.map(section=>{
    const observed=records.filter(row=>row.sectionId===section.sectionId).length;
    const includedCount=included.filter(row=>row.sectionId===section.sectionId).length;
    return {...section,observed,included:includedCount,delta:includedCount-section.expected};
  });
  const unresolved=included.filter(row=>!row.linkedUid).map(row=>({
    legacyStudentId:row.legacyStudentId,displayName:row.displayName,
    sectionId:row.sectionId,sectionName:row.sectionName,
    issue:"No verified Firebase account is linked to this legacy student record."
  }));
  const countMismatch=counts.filter(row=>row.included!==row.expected);
  const [peopleCount,membershipCount,offeringCount,enrollmentCount,assignmentCount]=await Promise.all([
    db.collection("schools/"+SCHOOL_ID+"/people").count().get(),
    db.collection("schools/"+SCHOOL_ID+"/memberships").count().get(),
    db.collection("schools/"+SCHOOL_ID+"/course_offerings").count().get(),
    db.collection("schools/"+SCHOOL_ID+"/enrollments").count().get(),
    db.collection("schools/"+SCHOOL_ID+"/staff_assignments").count().get()
  ]);
  const canonical={
    people:peopleCount.data().count,memberships:membershipCount.data().count,
    offerings:offeringCount.data().count,enrollments:enrollmentCount.data().count,
    teacherAssignments:assignmentCount.data().count
  };
  canonical.ready=canonical.people===168&&canonical.memberships===168&&canonical.offerings===8&&
    canonical.enrollments===334&&canonical.teacherAssignments===8;
  const blockers=[];
  if(unresolved.length)blockers.push({code:"identity_unresolved",label:unresolved.length+" student identit"+(unresolved.length===1?"y":"ies")+" need review."});
  if(countMismatch.length)blockers.push({code:"roster_count_mismatch",label:"Pilot roster counts do not yet match the protected four-section roster."});
  if(duplicateLinks.length)blockers.push({code:"duplicate_identity",label:duplicateLinks.length+" account link conflict(s) need review."});
  if(!canonical.ready)blockers.push({code:"canonical_migration_pending",label:"Reviewed V4 pilot migration has not been applied yet."});
  const readyToStart=blockers.length===0&&included.length===EXPECTED_TOTAL;
  const mismatchSectionIds=new Set(countMismatch.map(row=>row.sectionId));
  return {
    schoolId:SCHOOL_ID,schoolState:ctx.school.state,
    compatibilityMode:ctx.school.compatibilityMode||"legacy_allowed",
    productionAuthorized:ctx.school.productionAuthorized===true,
    expectedTotal:EXPECTED_TOTAL,observedTotal:records.length,includedTotal:included.length,
    excludedTotal:records.length-included.length,
    counts,unresolved,duplicateLinks,canonical,blockers,readyToStart,
    deferredHistory:true,
    sectionRecords:includeSectionRecords?records.filter(row=>mismatchSectionIds.has(row.sectionId)).map(row=>({
      legacyStudentId:row.legacyStudentId,displayName:row.displayName,
      sectionId:row.sectionId,sectionName:row.sectionName,
      excluded:row.excluded,linked:Boolean(row.linkedUid),linkSource:row.linkSource,
      rosterReviewHint:row.rosterReviewHint
    })):[]
  };
}
async function findPilotStudent(db,studentId){
  if(typeof studentId!=="string"||!/^[A-Za-z0-9_-]{1,160}$/.test(studentId))
    fail("invalid-argument","Choose a valid legacy student record.");
  const doc=await db.doc("students/"+studentId).get();
  if(!doc.exists||!active(doc.data())||!sectionFor(doc.data()))
    fail("failed-precondition","That record is not an active student in the four-section MCS pilot scope.");
  return {doc,data:doc.data(),section:sectionFor(doc.data())};
}
function createMcsPilotControlService({db,auth=getAuth()}){
  return async request=>{
    const input=request.data||{},ctx=await schoolAdminContext(db,request),action=input.action||"overview";
    if(action==="overview")return pilotSnapshot({db,auth,ctx});

    if(action==="resolve_identity"){
      if(ctx.school.state!=="draft")fail("failed-precondition","Identity exceptions are reviewed before the controlled pilot starts.");
      const target=await findPilotStudent(db,input.legacyStudentId),accountEmail=email(input.accountEmail);
      if(!accountEmail)fail("invalid-argument","Enter the student's verified Firebase account email.");
      let user;
      try{user=await auth.getUserByEmail(accountEmail);}
      catch(error){if(error?.code==="auth/user-not-found")fail("not-found","No Firebase account uses that email.");throw error;}
      if(user.disabled||!user.emailVerified)fail("failed-precondition","The selected Firebase account must be active and email-verified.");
      const why=reason(input.reason,"Identity review reason");
      const [allStudents,reviews,exclusions]=await Promise.all([
        db.collection("students").get(),
        db.collection("schools/"+SCHOOL_ID+"/pilot_identity_reviews").limit(300).get(),
        db.collection("schools/"+SCHOOL_ID+"/pilot_roster_exclusions").limit(100).get()
      ]);
      const approvedById=new Map(reviews.docs.filter(d=>d.data()?.status==="approved").map(d=>[d.id,d.data()])),
        excludedIds=new Set(exclusions.docs.filter(d=>d.data()?.status==="excluded").map(d=>d.id));
      const sourceEmails=[];
      const scoped=[];
      for(const doc of allStudents.docs){
        const section=sectionFor(doc.data());
        if(!section||!active(doc.data())||doc.id===input.legacyStudentId||excludedIds.has(doc.id))continue;
        const e=email(doc.data().email);if(e)sourceEmails.push(e);
        scoped.push({id:doc.id,data:doc.data(),legacyEmail:e});
      }
      const users=await authUsersByEmail(auth,sourceEmails);
      for(const row of scoped){
        const reviewed=approvedById.get(row.id),sourceUser=row.legacyEmail?users.get(row.legacyEmail):null,
          uid=reviewed?.authUid||(sourceUser&&sourceUser.emailVerified&&!sourceUser.disabled?sourceUser.uid:null);
        if(uid===user.uid)fail("already-exists","That Firebase account is already linked to another current pilot student. Review the duplicate before continuing.");
      }
      const ref=db.doc("schools/"+SCHOOL_ID+"/pilot_identity_reviews/"+input.legacyStudentId),
        audit=db.collection("schools/"+SCHOOL_ID+"/pilot_audit").doc(),now=FieldValue.serverTimestamp();
      await db.runTransaction(async tx=>{
        const [school,member]=await Promise.all([
          tx.get(db.doc("platform_schools/"+SCHOOL_ID)),
          tx.get(db.doc("schools/"+SCHOOL_ID+"/memberships/"+ctx.uid))
        ]);
        if(!school.exists||school.data().state!=="draft"||member.data()?.status!=="active"||
           !Array.isArray(member.data()?.roles)||!member.data().roles.includes("school_admin"))
          fail("failed-precondition","Pilot administration state changed. Refresh before saving.");
        tx.set(ref,{
          schoolId:SCHOOL_ID,legacyStudentId:input.legacyStudentId,status:"approved",
          authUid:user.uid,emailHash:hash(accountEmail),displayNameSnapshot:displayName(target.data),
          sectionId:target.section.sectionId,reviewedByUid:ctx.uid,reviewedAt:now,reason:why
        },{merge:false});
        tx.create(audit,{schoolId:SCHOOL_ID,actorUid:ctx.uid,action:"pilot_identity_link_reviewed",
          legacyStudentId:input.legacyStudentId,sectionId:target.section.sectionId,createdAt:now});
      });
      return {saved:true,legacyStudentId:input.legacyStudentId};
    }

    if(action==="clear_identity"){
      if(ctx.school.state!=="draft")fail("failed-precondition","Identity review can only be changed before pilot start.");
      const target=await findPilotStudent(db,input.legacyStudentId),why=reason(input.reason,"Identity review reason"),
        ref=db.doc("schools/"+SCHOOL_ID+"/pilot_identity_reviews/"+input.legacyStudentId),
        audit=db.collection("schools/"+SCHOOL_ID+"/pilot_audit").doc(),now=FieldValue.serverTimestamp();
      await db.runTransaction(async tx=>{
        tx.set(ref,{schoolId:SCHOOL_ID,legacyStudentId:input.legacyStudentId,status:"cleared",
          displayNameSnapshot:displayName(target.data),sectionId:target.section.sectionId,
          reviewedByUid:ctx.uid,reviewedAt:now,reason:why},{merge:false});
        tx.create(audit,{schoolId:SCHOOL_ID,actorUid:ctx.uid,action:"pilot_identity_link_cleared",
          legacyStudentId:input.legacyStudentId,createdAt:now});
      });
      return {saved:true};
    }

    if(action==="exclude_legacy_record"||action==="restore_legacy_record"){
      if(ctx.school.state!=="draft")fail("failed-precondition","Pilot roster exceptions can only be changed before pilot start.");
      const target=await findPilotStudent(db,input.legacyStudentId),why=reason(input.reason,"Roster review reason"),
        excluding=action==="exclude_legacy_record",
        ref=db.doc("schools/"+SCHOOL_ID+"/pilot_roster_exclusions/"+input.legacyStudentId),
        audit=db.collection("schools/"+SCHOOL_ID+"/pilot_audit").doc(),now=FieldValue.serverTimestamp();
      await db.runTransaction(async tx=>{
        tx.set(ref,{schoolId:SCHOOL_ID,legacyStudentId:input.legacyStudentId,
          status:excluding?"excluded":"restored",displayNameSnapshot:displayName(target.data),
          sectionId:target.section.sectionId,reviewedByUid:ctx.uid,reviewedAt:now,reason:why},{merge:false});
        tx.create(audit,{schoolId:SCHOOL_ID,actorUid:ctx.uid,
          action:excluding?"pilot_legacy_record_excluded":"pilot_legacy_record_restored",
          legacyStudentId:input.legacyStudentId,sectionId:target.section.sectionId,createdAt:now});
      });
      return {saved:true,excluded:excluding};
    }

    if(action==="start_pilot"){
      if(ctx.school.state!=="draft")fail("failed-precondition","Only a draft MCS school can start the controlled pilot.");
      const ack=input.acknowledgements||{};
      for(const key of ["limitedScopeReviewed","legacyCompatibilityRequired","productionNotAuthorized"])
        if(ack[key]!==true)fail("failed-precondition","Confirm all controlled-pilot safeguards.");
      const why=reason(input.reason,"Pilot reason"),
        snapshot=await pilotSnapshot({db,auth,ctx,includeSectionRecords:false});
      if(!snapshot.readyToStart)fail("failed-precondition","Resolve every identity and roster-count exception before starting the controlled pilot.");
      const scopeReference=text(input.scopeReference,240)||"Adminerva 4.0 MCS SHS ICT pilot";
      await db.runTransaction(async tx=>{
        const schoolRef=db.doc("platform_schools/"+SCHOOL_ID),
          memberRef=db.doc("schools/"+SCHOOL_ID+"/memberships/"+ctx.uid),
          audit=db.collection("platform_audit").doc(),
          [school,member]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
        if(!school.exists||school.data().state!=="draft"||member.data()?.status!=="active"||
           !Array.isArray(member.data()?.roles)||!member.data().roles.includes("school_admin"))
          fail("failed-precondition","Pilot administration state changed. Refresh and review again.");
        const now=FieldValue.serverTimestamp();
        tx.update(schoolRef,{
          state:"pilot",compatibilityMode:"legacy_allowed",productionAuthorized:false,
          pilot:{status:"active",scopeReference,productionAuthorized:false,
            institutionalApprovalStatus:"pending",startedByUid:ctx.uid,startedAt:now},
          revision:(Number(school.data().revision)||0)+1,updatedAt:now
        });
        tx.create(audit,{schoolId:SCHOOL_ID,actorUid:ctx.uid,action:"school_controlled_pilot_started",
          scopeReference,reason:why,createdAt:now});
      });
      return {schoolId:SCHOOL_ID,state:"pilot",compatibilityMode:"legacy_allowed",productionAuthorized:false};
    }

    fail("invalid-argument","Unknown MCS controlled-pilot operation.");
  };
}
module.exports={SCHOOL_ID,PILOT_SECTIONS,EXPECTED_TOTAL,createMcsPilotControlService,displayName,sectionFor};
