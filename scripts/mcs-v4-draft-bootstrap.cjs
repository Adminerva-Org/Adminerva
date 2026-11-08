"use strict";
/**
 * One-purpose MCS V4 draft bootstrap. This does not start a pilot, migrate
 * student data, grant platform-admin authority, or change legacy compatibility.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {getAuth}=require("firebase-admin/auth");
const {createHash}=require("node:crypto");

const SCHOOL_ID="mcs-manila";
const EXPECTED_UID_HASH="c1af15b90b3408eb96ad8ffa0ca6d470005036aefbe754a98bf8db7784681879";
const FIRST_ADMIN_EMAIL="babaynike2013@gmail.com";
const digest=value=>createHash("sha256").update(String(value)).digest("hex");

async function main(){
  if(!getApps().length)initializeApp({credential:applicationDefault()});
  const db=getFirestore(),auth=getAuth(),user=await auth.getUserByEmail(FIRST_ADMIN_EMAIL);
  if(digest(user.uid)!==EXPECTED_UID_HASH||user.disabled||user.emailVerified!==true)
    throw Error("Reviewed first-school-admin identity no longer matches the verified account.");

  const uid=user.uid,schoolRef=db.doc("platform_schools/"+SCHOOL_ID),
    memberRef=db.doc("schools/"+SCHOOL_ID+"/memberships/"+uid),
    indexRef=db.doc("platform_users/"+uid+"/memberships/"+SCHOOL_ID),
    auditRef=db.collection("platform_audit").doc();

  await db.runTransaction(async tx=>{
    const [school,member,index]=await Promise.all([tx.get(schoolRef),tx.get(memberRef),tx.get(indexRef)]);
    if(school.exists&&school.data().state!=="draft")
      throw Error("MCS already advanced beyond draft; refusing bootstrap.");
    if(school.exists&&school.data().productionAuthorized===true)
      throw Error("MCS production authorization is already active; refusing bootstrap.");
    if(school.exists&&school.data().firstAdminUid&&school.data().firstAdminUid!==uid)
      throw Error("MCS first school-admin identity conflicts with the reviewed account.");

    const now=FieldValue.serverTimestamp();
    if(!school.exists){
      tx.create(schoolRef,{
        displayName:"Manila Cathedral School",state:"draft",revision:1,
        compatibilityMode:"legacy_allowed",productionAuthorized:false,
        dataLocation:{type:"shared_firestore_namespace",database:"(default)",path:"schools/"+SCHOOL_ID},
        firstAdminUid:uid,aiEnabled:false,storageEnabled:false,readiness:{},
        createdByUid:uid,createdAt:now,updatedAt:now
      });
    }
    const existingRoles=member.exists&&Array.isArray(member.data().roles)?member.data().roles:[];
    const roles=[...new Set([...existingRoles,"school_admin"])].sort(),
      revision=Math.max(Number(member.data()?.revision)||0,Number(index.data()?.revision)||0)+1;
    tx.set(memberRef,{schoolId:SCHOOL_ID,status:"active",roles,revision,updatedByUid:uid,updatedAt:now},{merge:true});
    tx.set(indexRef,{schoolId:SCHOOL_ID,status:"active",roles,revision,updatedAt:now},{merge:true});
    tx.create(auditRef,{schoolId:SCHOOL_ID,actorUid:uid,targetUid:uid,
      action:"mcs_v4_draft_school_bootstrapped",compatibilityMode:"legacy_allowed",
      productionAuthorized:false,createdAt:now});
  });

  const [school,member]=await Promise.all([schoolRef.get(),memberRef.get()]);
  console.log("MCS_V4_BOOTSTRAP "+JSON.stringify({
    schoolState:school.data().state,
    compatibilityMode:school.data().compatibilityMode,
    productionAuthorized:school.data().productionAuthorized===true,
    schoolAdminActive:member.data().status==="active"&&member.data().roles.includes("school_admin"),
    pilotStarted:school.data().state==="pilot"
  }));
}
if(require.main===module)main().catch(error=>{console.error("MCS_V4_BOOTSTRAP_ERROR",error.message);process.exitCode=1;});
