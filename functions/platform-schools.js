"use strict";
/**
 * Owner-only tenant control plane. The first platform_admins/{uid} grant MUST
 * be installed out of band by a trusted operator; never bootstrap by email.
 */
const {getAuth}=require("firebase-admin/auth");
const {FieldValue}=require("firebase-admin/firestore");
const {TenantAccessError,checkedSchoolId,verifiedUid}=require("./tenant-access.js");
const {evaluateSchoolCutoverReadiness}=require("./school-cutover-readiness.js");
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
        dataLocation:doc.data().dataLocation,revision:doc.data().revision,
        compatibilityMode:doc.data().compatibilityMode||"legacy_allowed"
      }))};
    }
    const schoolId=checkedSchoolId(input.schoolId),schoolRef=db.doc("platform_schools/"+schoolId);
    const auditRef=db.collection("platform_audit").doc();
    if(action==="create_draft") {
      const displayName=phrase(input.displayName,3,120,"Institution name");
      await db.runTransaction(async tx=>{
        if((await tx.get(schoolRef)).exists)fail("already-exists","The school already exists.");
        tx.create(schoolRef,{
          displayName,state:"draft",revision:1,compatibilityMode:"v4_only",
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
    if(action==="suspend_school_admin"||action==="restore_school_admin") {
      const targetUid=phrase(input.targetUid,8,128,"School administrator UID");
      const reason=phrase(input.reason,12,500,action==="restore_school_admin"?"Recovery reason":"Suspension reason");
      const target=await auth.getUser(targetUid);
      if(!target.emailVerified||target.disabled)
        fail("failed-precondition","The target account is not a verified active identity.");
      const memberRef=db.doc("schools/"+schoolId+"/memberships/"+targetUid);
      const indexRef=db.doc("platform_users/"+targetUid+"/memberships/"+schoolId);
      const restoring=action==="restore_school_admin";
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef),member=await tx.get(memberRef);
        if(!school.exists||!["draft","active","suspended"].includes(school.data().state))
          fail("failed-precondition","The school must exist and must not be archived.");
        if(!member.exists||member.data().schoolId!==schoolId||
           !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
          fail("failed-precondition","The target is not a school administrator for this institution.");
        if(restoring){
          if(member.data().status!=="suspended")
            fail("failed-precondition","Only a suspended school administrator can be recovered.");
        }else{
          if(member.data().status!=="active")
            fail("failed-precondition","Only an active school administrator can be suspended.");
          const admins=await tx.get(db.collection("schools/"+schoolId+"/memberships")
            .where("roles","array-contains","school_admin").limit(50));
          const otherActive=admins.docs.some(doc=>doc.id!==targetUid&&doc.data().schoolId===schoolId&&
            doc.data().status==="active");
          if(!otherActive)
            fail("failed-precondition","Designate another active school administrator before suspending the last administrator.");
        }
        const now=FieldValue.serverTimestamp(),roles=member.data().roles,
          revision=(member.data().revision||0)+1,status=restoring?"active":"suspended";
        tx.update(memberRef,{status,revision,updatedAt:now,updatedByUid:uid,
          ...(restoring?{restoredAt:now,restoredByUid:uid,restoreReason:reason}:
            {suspendedAt:now,suspendedByUid:uid,suspensionReason:reason})});
        tx.set(indexRef,{schoolId,status,roles,revision,updatedAt:now});
        tx.create(auditRef,{schoolId,actorUid:uid,targetUid,
          action:restoring?"school_admin_recovered":"school_admin_suspended",
          reason,createdAt:now});
      });
      return {schoolId,adminUid:targetUid,status:restoring?"active":"suspended"};
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

    if(action==="set_compatibility_mode"){
      const mode=input.mode;
      if(!["legacy_allowed","v4_only"].includes(mode))
        fail("invalid-argument","Choose a supported school compatibility mode.");
      const reason=phrase(input.reason,12,500,"Compatibility-mode reason");
      if(mode==="v4_only"){
        const readiness=await evaluateSchoolCutoverReadiness({db,schoolId});
        if(!readiness.ready)
          fail("failed-precondition","Resolve the school cutover readiness blockers before retiring legacy compatibility.");
        const attestation=input.attestation||{};
        for(const key of ["continuityBackupCaptured","migrationReconciled","rollbackReviewed","v4RoutesValidated"])
          if(attestation[key]!==true)
            fail("failed-precondition","Continuity backup, migration reconciliation, rollback and V4 route validation must all be confirmed.");
      }
      await db.runTransaction(async tx=>{
        const school=await tx.get(schoolRef);
        if(!school.exists||!["active","suspended"].includes(school.data().state))
          fail("failed-precondition","Compatibility mode can be changed only for an active or suspended school.");
        const before=school.data().compatibilityMode||"legacy_allowed";
        if(before===mode)return;
        const now=FieldValue.serverTimestamp();
        tx.update(schoolRef,{
          compatibilityMode:mode,revision:(school.data().revision||0)+1,updatedAt:now,
          ...(mode==="v4_only"?{
            cutoverAt:now,cutoverByUid:uid,cutoverReason:reason,
            cutoverAttestations:{
              continuityBackupCaptured:true,migrationReconciled:true,
              rollbackReviewed:true,v4RoutesValidated:true
            }
          }:{
            compatibilityRollbackAt:now,compatibilityRollbackByUid:uid,
            compatibilityRollbackReason:reason
          })
        });
        tx.create(auditRef,{schoolId,actorUid:uid,
          action:mode==="v4_only"?"school_v4_cutover_enabled":"school_legacy_compatibility_restored",
          beforeCompatibilityMode:before,afterCompatibilityMode:mode,reason,createdAt:now});
      });
      return {schoolId,compatibilityMode:mode};
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
