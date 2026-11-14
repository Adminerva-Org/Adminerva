"use strict";
// Idempotent production-main operation: never changes grades, memberships, enrollments, or compatibility to v4_only.

const {initializeApp,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");

initializeApp({credential:applicationDefault()});
const db=getFirestore();
const SCHOOL_ID="mcs-manila";

async function main(){
  const schoolRef=db.doc("platform_schools/"+SCHOOL_ID);
  const auditRef=db.collection("platform_audit").doc();
  let outcome="unchanged";
  await db.runTransaction(async tx=>{
    const school=await tx.get(schoolRef);
    if(!school.exists)throw new Error("MCS school record does not exist.");
    const data=school.data()||{};
    if(data.state==="pilot"){
      outcome="already-pilot";
      return;
    }
    if(data.state==="active"){
      outcome="already-active";
      return;
    }
    if(data.state!=="draft")
      throw new Error("Refusing to promote MCS from unexpected state: "+String(data.state));
    const now=FieldValue.serverTimestamp();
    tx.update(schoolRef,{
      state:"pilot",
      compatibilityMode:"legacy_allowed",
      productionAuthorized:false,
      pilot:{
        ...(data.pilot&&typeof data.pilot==="object"?data.pilot:{}),
        status:"active",
        scopeReference:"MCS Adminerva 4.0 production pilot",
        productionAuthorized:false,
        institutionalApprovalStatus:data.pilot?.institutionalApprovalStatus||"pending",
        startedAt:now,
        startedBy:"github-actions-production-main"
      },
      revision:(Number(data.revision)||0)+1,
      updatedAt:now
    });
    tx.create(auditRef,{
      schoolId:SCHOOL_ID,
      actor:"github-actions-production-main",
      action:"mcs_school_promoted_to_v4_pilot",
      reason:"MCS is the designated Adminerva 4.0 pilot school on the existing production interface.",
      compatibilityMode:"legacy_allowed",
      productionAuthorized:false,
      createdAt:now
    });
    outcome="promoted";
  });
  console.log("MCS pilot alignment:",outcome);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
