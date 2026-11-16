"use strict";
/**
 * Standard roster activation for Manila Cathedral School.
 *
 * This intentionally does not replace the legacy-compatible MCS pilot flow.
 * A student must already exist in the standard school directory with a
 * school-admin supplied activationEmailHash. The authenticated verified email
 * is matched server-side; no reusable link by itself grants access.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {TenantAccessError,checkedSchoolId,verifiedUid}=require("./tenant-access.js");
const {normalizedRosterEmail,rosterEmailHash}=require("./school-roster-identity.js");

const STANDARD_MCS_SCHOOL_ID="manila-cathedral-school";

function enabledStandardMcs(schoolId,school){
  return schoolId===STANDARD_MCS_SCHOOL_ID &&
    school?.compatibilityMode==="v4_only" &&
    (school?.provisioningMode||"standard")==="standard";
}
function createSchoolRosterActivationService({db}){
  return async request=>{
    const uid=verifiedUid(request),input=request.data||{};
    const schoolId=checkedSchoolId(input.schoolId);
    if(schoolId!==STANDARD_MCS_SCHOOL_ID)
      throw new TenantAccessError("failed-precondition",
        "Roster activation is available only for Manila Cathedral School standard onboarding.");

    const email=normalizedRosterEmail(request.auth?.token?.email);
    if(!email||request.auth?.token?.email_verified!==true)
      throw new TenantAccessError("unauthenticated","Use a verified school email account.");

    const schoolRef=db.doc("platform_schools/"+schoolId);
    const school=await schoolRef.get();
    if(!school.exists||!["active","pilot"].includes(school.data().state)||!enabledStandardMcs(schoolId,school.data()))
      throw new TenantAccessError("failed-precondition",
        "Manila Cathedral School roster activation is not enabled for this school state.");

    const activationEmailHash=rosterEmailHash(email);
    const matches=await db.collection("schools/"+schoolId+"/people")
      .where("activationEmailHash","==",activationEmailHash).limit(3).get();
    const candidates=matches.docs.filter(doc=>{
      const data=doc.data();
      return data.schoolId===schoolId&&data.kind==="student"&&data.status==="active";
    });
    if(!candidates.length)
      throw new TenantAccessError("permission-denied",
        "No active Manila Cathedral School student record matches this verified email. Ask the School Administrator to check the roster email.");
    if(candidates.length!==1)
      throw new TenantAccessError("failed-precondition",
        "More than one student record matches this email. School administration must resolve the duplicate before activation.");

    const personRef=candidates[0].ref,personId=candidates[0].id;
    const memberRef=db.doc("schools/"+schoolId+"/memberships/"+uid);
    const indexRef=db.doc("platform_users/"+uid+"/memberships/"+schoolId);
    const auditRef=db.collection("schools/"+schoolId+"/directory_audit").doc();
    const registrations=await db.collection("schools/"+schoolId+"/student_registrations")
      .where("personId","==",personId).limit(30).get();
    let alreadyActive=false,displayName="Student";

    await db.runTransaction(async tx=>{
      const [freshSchool,person,member,...registrationDocs]=await Promise.all([
        tx.get(schoolRef),tx.get(personRef),tx.get(memberRef),
        ...registrations.docs.map(doc=>tx.get(doc.ref))
      ]);
      if(!freshSchool.exists||!["active","pilot"].includes(freshSchool.data().state)||
         !enabledStandardMcs(schoolId,freshSchool.data()))
        throw new TenantAccessError("failed-precondition","School onboarding mode changed. Ask the School Administrator to review access.");
      if(!person.exists||person.data().schoolId!==schoolId||person.data().kind!=="student"||
         person.data().status!=="active"||person.data().activationEmailHash!==activationEmailHash)
        throw new TenantAccessError("failed-precondition","Your roster identity changed. Ask the School Administrator to review the student record.");
      if(person.data().authUid&&person.data().authUid!==uid)
        throw new TenantAccessError("failed-precondition","This student record is already linked to another account.");

      const prior=member.exists?member.data():null;
      if(prior&&prior.schoolId!==schoolId)
        throw new TenantAccessError("failed-precondition","The existing membership belongs to another school.");
      if(prior?.status==="suspended")
        throw new TenantAccessError("failed-precondition","Your previous school access is suspended and requires administrator recovery.");
      if(prior?.personId&&prior.personId!==personId)
        throw new TenantAccessError("failed-precondition","This account is already linked to a different school person record.");
      const priorRoles=Array.isArray(prior?.roles)?prior.roles:[];
      if(priorRoles.some(role=>role!=="student"))
        throw new TenantAccessError("failed-precondition",
          "This account already has a staff or administrator role in this school. Use a separate student account for student testing.");

      displayName=String(person.data().displayName||"Student").slice(0,140);
      if(prior?.status==="active"&&priorRoles.includes("student")&&person.data().authUid===uid){
        alreadyActive=true;return;
      }
      const revision=(prior?.revision||0)+1,now=FieldValue.serverTimestamp(),roles=["student"];
      tx.set(memberRef,{schoolId,personId,status:"active",roles,revision,displayName,
        activationSource:"verified_roster_email",updatedByUid:uid,updatedAt:now},{merge:true});
      tx.set(indexRef,{schoolId,status:"active",roles,revision,updatedAt:now});
      tx.update(personRef,{authUid:uid,linkedAt:now,updatedAt:now,
        revision:(person.data().revision||0)+1});
      for(const registration of registrationDocs){
        if(!registration.exists||registration.data().schoolId!==schoolId||
           registration.data().personId!==personId||registration.data().status!=="active")continue;
        tx.update(registration.ref,{accountLinked:true,updatedAt:now,
          revision:(registration.data().revision||0)+1});
      }
      tx.create(auditRef,{schoolId,actorUid:uid,personId,
        action:"student_roster_email_activated",createdAt:now});
    });

    return {schoolId,personId,displayName,status:"active",role:"student",alreadyActive};
  };
}
module.exports={createSchoolRosterActivationService,enabledStandardMcs,STANDARD_MCS_SCHOOL_ID};
