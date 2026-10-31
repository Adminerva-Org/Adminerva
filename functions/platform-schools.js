"use strict";
/**
 * Owner-only tenant control plane. The first platform_admins/{uid} grant MUST
 * be installed out of band by a trusted operator; never bootstrap by email.
 */
const {getAuth}=require("firebase-admin/auth");
const {FieldValue}=require("firebase-admin/firestore");
const {TenantAccessError,checkedSchoolId,verifiedUid}=require("./tenant-access.js");
function fail(code,message){throw new TenantAccessError(code,message)}
function phrase(value,min,max,label){
  if(typeof value!=="string"||value.trim().length<min||value.trim().length>max)
    fail("invalid-argument",label+" is missing or outside permitted length.");
  return value.trim();
}
async function ownerContext({db,request}) {
  const uid=verifiedUid(request),doc=await db.doc("platform_admins/"+uid).get();
  if(!doc.exists||doc.data().status!=="active"||doc.data().role!=="platform_admin")
    fail("permission-denied","Only a verified platform administrator may manage institutions.");
  return uid;
}
const requiredAttestations=[
  "institutionalDataAuthority","provenanceVerified","calendarConfigured","privacyPolicyApproved"
];
function createPlatformSchoolService({db,auth=getAuth()}) {
  return async request=>{
    const uid=await ownerContext({db,request}),input=request.data||{};
    const action=input.action;
    if(action==="list") {
      const snap=await db.collection("platform_schools").orderBy("displayName").limit(100).get();
      return {schools:snap.docs.map(doc=>({
        schoolId:doc.id,displayName:doc.data().displayName,state:doc.data().state,
        dataLocation:doc.data().dataLocation,revision:doc.data().revision
      }))};
    }
    const schoolId=checkedSchoolId(input.schoolId),schoolRef=db.doc("platform_schools/"+schoolId);
    const auditRef=db.collection("platform_audit").doc();
    if(action==="create_draft") {
      const displayName=phrase(input.displayName,3,120,"Institution name");
      await db.runTransaction(async tx=>{
        if((await tx.get(schoolRef)).exists)fail("already-exists","The school already exists.");
        tx.create(schoolRef,{
          displayName,state:"draft",revision:1,
          dataLocation:{type:"shared_firestore_namespace",database:"(default)",path:"schools/"+schoolId},
          firstAdminUid:null,aiEnabled:false,storageEnabled:false,
          readiness:{},createdByUid:uid,createdAt:FieldValue.serverTimestamp(),
          updatedAt:FieldValue.serverTimestamp()
        });
        tx.create(auditRef,{actorUid:uid,action:"school_draft_created",schoolId,createdAt:FieldValue.serverTimestamp()});
      });
      return {schoolId,state:"draft"};
    }
    if(action==="grant_school_admin") {
      const targetUid=phrase(input.targetUid,8,128,"Verified administrator UID");
      const reason=phrase(input.reason,12,500,"Reason");
      const target=await auth.getUser(targetUid);
      if(!target.emailVerified || target.disabled)
        fail("failed-precondition","The target account is not a verified active identity.");
      const memberRef=db.doc("schools/"+schoolId+"/memberships/"+targetUid);
      const indexRef=db.doc("platform_users/"+targetUid+"/memberships/"+schoolId);
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef),member=await tx.get(memberRef);
        if(!school.exists||!["draft","active","suspended"].includes(school.data().state))
          fail("failed-precondition","The school must exist and must not be archived.");
        if(member.exists && member.data().status==="suspended")
          fail("failed-precondition","Use reviewed membership recovery for a suspended account.");
        const previous=member.exists?member.data():null;
        const roles=[...new Set([...(Array.isArray(previous?.roles)?previous.roles:[]),"school_admin"])];
        const revision=(previous?.revision||0)+1;
        const grant={schoolId,status:"active",roles,revision,
          updatedAt:FieldValue.serverTimestamp(),updatedByUid:uid};
        tx.set(memberRef,grant,{merge:true});
        tx.set(indexRef,{schoolId,status:"active",roles,revision,
          updatedAt:FieldValue.serverTimestamp()});
        if(!school.data().firstAdminUid)tx.update(schoolRef,{firstAdminUid:targetUid});
        tx.create(auditRef,{schoolId,actorUid:uid,targetUid,action:"school_admin_granted",
          reason,createdAt:FieldValue.serverTimestamp()});
      });
      return {schoolId,adminUid:targetUid,status:"active"};
    }
    if(action==="activate") {
      const attestation=input.attestation||{};
      if(requiredAttestations.some(key=>attestation[key]!==true))
        fail("failed-precondition","Institutional authority, provenance, calendar and privacy approval must be confirmed.");
      const reason=phrase(input.reason,12,500,"Activation reason");
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef);
        if(!school.exists||school.data().state!=="draft")
          fail("failed-precondition","Only a draft institution can be activated.");
        const adminUid=school.data().firstAdminUid;
        if(!adminUid)fail("failed-precondition","Designate the first verified school administrator.");
        const member=await tx.get(db.doc("schools/"+schoolId+"/memberships/"+adminUid));
        if(!member.exists||member.data().status!=="active"||
           !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
          fail("failed-precondition","The first administrator's grant is not active.");
        tx.update(schoolRef,{state:"active",readiness:attestation,
          revision:(school.data().revision||0)+1,updatedAt:FieldValue.serverTimestamp()});
        tx.create(auditRef,{schoolId,actorUid:uid,action:"school_activated",reason,
          attestationKeys:requiredAttestations,createdAt:FieldValue.serverTimestamp()});
      });
      return {schoolId,state:"active"};
    }
    if(action==="suspend") {
      const reason=phrase(input.reason,12,500,"Suspension reason");
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef);
        if(!school.exists||school.data().state!=="active")
          fail("failed-precondition","Only an active school may be suspended.");
        tx.update(schoolRef,{state:"suspended",revision:(school.data().revision||0)+1,
          updatedAt:FieldValue.serverTimestamp()});
        tx.create(auditRef,{schoolId,actorUid:uid,action:"school_suspended",reason,
          createdAt:FieldValue.serverTimestamp()});
      });
      return {schoolId,state:"suspended"};
    }
    fail("invalid-argument","Unknown platform school operation.");
  };
}
module.exports={createPlatformSchoolService,ownerContext};
