"use strict";
/** One-time import of already obtained consent into the existing legacy activity preference.
 * Never replaces an existing preference, creates a school identity, grants access or changes research eligibility.
 */
const {TenantAccessError}=require("./tenant-access.js");
const LIMIT=25;
// This is the legacy tenancy boundary already enforced by firestore.rules.
// No flat activity writes are introduced for V4-only schools.
const LEGACY_SCHOOL="mcs-manila";
const validUid=v=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const activeStudent=s=>s?.exists&&(s.data()?.status||"active")==="active";
const emailOf=v=>String(v||"").trim().toLowerCase();
function fail(code,message){throw new TenantAccessError(code,message);}
async function importExistingActivityConsent({db,auth,FieldValue,authority,input}){
 if(!authority?.platformAdmin)fail("permission-denied","System Administrator access is required.");
 const apply=input.action==="initialize_activity_consent";
 if(!apply&&input.action!=="preview_activity_consent")fail("invalid-argument","Unknown consent initialization action.");
 const allowed=apply?["action","uids","consentConfirmed"]:["action","uids"];
 if(Object.keys(input).some(k=>!allowed.includes(k))||!Array.isArray(input.uids)||!input.uids.length||input.uids.length>LIMIT||input.uids.some(v=>!validUid(v)))fail("invalid-argument","Select 1–25 verified existing account IDs per batch.");
 if(apply&&input.consentConfirmed!==true)fail("failed-precondition","Confirm previously obtained consent for the selected accounts.");
 const school=db.doc("platform_schools/"+LEGACY_SCHOOL);
 const rows=[];
 for(const uid of [...new Set(input.uids)]){
   let user;
   try{user=await auth.getUser(uid);}catch(error){if(error?.code==="auth/user-not-found"){rows.push({uid,status:"account_missing"});continue;}throw error;}
   if(user.disabled||user.emailVerified!==true||!emailOf(user.email)){rows.push({uid,status:"account_ineligible"});continue;}
   const preference=db.doc("activity_preferences/"+uid),access=db.doc("student_access/"+uid);
   // Resolve only from verified legacy access projections or matching verified email.
   // Never trust a student ID or role supplied by the administrator.
   const [projected,matches]=await Promise.all([
     access.get(),
     db.collection("students").where("email","==",emailOf(user.email)).limit(25).get()
   ]);
   const ids=[...new Set([...(Array.isArray(projected.data()?.studentIds)?projected.data().studentIds:[]),...matches.docs.map(s=>s.id)])].filter(validUid).slice(0,50);
   const outcome=await db.runTransaction(async tx=>{
     const [mode,saved,projection]=await Promise.all([tx.get(school),tx.get(preference),tx.get(access)]);
     if(mode.data()?.compatibilityMode==="v4_only")return "v4_only_legacy_unavailable";
     if(saved.exists)return saved.data()?.enabled===true?"already_enabled":"existing_choice_preserved";
     const allowedIds=Array.isArray(projection.data()?.studentIds)?projection.data().studentIds:[];
     let studentId="";
     for(const id of ids){
       const student=await tx.get(db.doc("students/"+id));
       if(activeStudent(student)&&(allowedIds.includes(id)||emailOf(student.data()?.email)===emailOf(user.email))){studentId=id;break;}
     }
     if(!studentId)return "no_active_legacy_student";
     if(!apply)return "eligible";
     // Both writes commit atomically with the no-existing-preference check.
     tx.create(preference,{ownerUid:uid,studentId,enabled:true,promptDismissed:true,updatedAt:FieldValue.serverTimestamp()});
     tx.create(db.collection("platform_audit").doc(),{
       actorUid:authority.uid,authoritySource:authority.authoritySource||null,targetUid:uid,
       action:"existing_student_activity_consent_initialized",basis:"administrator_attested_prior_consent",
       createdAt:FieldValue.serverTimestamp()
     });
     return "initialized";
   });
   rows.push({uid,status:outcome});
 }
 return {rows,limit:LIMIT};
}
module.exports={importExistingActivityConsent};
