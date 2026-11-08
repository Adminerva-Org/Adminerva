"use strict";
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {getAuth}=require("firebase-admin/auth");

const SCHOOL_ID="mcs-manila";
const LEGACY_ADMIN_EMAIL="babaynike2013@gmail.com";

async function main(){
  if(!getApps().length)initializeApp({credential:applicationDefault()});
  const db=getFirestore(),auth=getAuth(),user=await auth.getUserByEmail(LEGACY_ADMIN_EMAIL);
  if(!user||user.disabled||user.emailVerified!==true)
    throw Error("Legacy Adminerva administrator account is not active and verified.");

  const uid=user.uid,schoolRef=db.doc("platform_schools/"+SCHOOL_ID),
    memberRef=db.doc("schools/"+SCHOOL_ID+"/memberships/"+uid),
    indexRef=db.doc("platform_users/"+uid+"/memberships/"+SCHOOL_ID),
    auditRef=db.collection("platform_audit").doc();

  await db.runTransaction(async tx=>{
    const [school,member,index]=await Promise.all([tx.get(schoolRef),tx.get(memberRef),tx.get(indexRef)]);
    if(!school.exists||!["draft","pilot","active"].includes(school.data().state))
      throw Error("MCS V4 school is unavailable.");
    if(school.data().compatibilityMode==="v4_only")
      throw Error("This access bridge is only for the legacy-compatible pilot period.");
    const roles=[...new Set([...(Array.isArray(member.data()?.roles)?member.data().roles:[]),"school_admin"])].sort();
    const revision=Math.max(Number(member.data()?.revision)||0,Number(index.data()?.revision)||0)+1;
    const now=FieldValue.serverTimestamp();
    tx.set(memberRef,{schoolId:SCHOOL_ID,status:"active",roles,revision,updatedByUid:uid,updatedAt:now},{merge:true});
    tx.set(indexRef,{schoolId:SCHOOL_ID,status:"active",roles,revision,updatedAt:now},{merge:true});
    tx.create(auditRef,{schoolId:SCHOOL_ID,actorUid:uid,targetUid:uid,
      action:"mcs_legacy_admin_v4_school_access_granted",roles,createdAt:now});
  });

  const [school,member]=await Promise.all([schoolRef.get(),memberRef.get()]);
  console.log("MCS_V4_ADMIN_BRIDGE "+JSON.stringify({
    schoolState:school.data().state,
    firstAdminPreserved:Boolean(school.data().firstAdminUid),
    compatibilityMode:school.data().compatibilityMode,
    productionAuthorized:school.data().productionAuthorized===true,
    legacyAdminSchoolAdmin:member.data().status==="active"&&member.data().roles.includes("school_admin")
  }));
}
if(require.main===module)main().catch(error=>{console.error("MCS_V4_ADMIN_BRIDGE_ERROR",error.message);process.exitCode=1;});
