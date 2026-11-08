"use strict";
const {initializeApp,applicationDefault,getApps}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const SCHOOL_ID="mcs-manila";
const TARGETS=[
 {sectionId:"shs-g11-techpro-ict-st-isidore-of-seville",nameHash:"cf7772b07257f28cd40d7a4312caee77f51bf4679e819c720965ca08f3a450dd"},
 {sectionId:"shs-g11-techpro-ict-st-carlo-acutis",nameHash:"30d7957afbc810af9073fbc9d3f7fda52f9eeaa1f785010de6f05e4e34c70473"}
];
const norm=v=>String(v||"").trim().replace(/\s+/g," ").toLowerCase();
const fold=v=>norm(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const hash=v=>createHash("sha256").update(String(v)).digest("hex");
const active=d=>!["archived","suspended","inactive","disabled","deleted"].includes(norm(d?.status||"active"));
const displayName=d=>String(d?.displayName||d?.name||d?.fullName||d?.studentName||[d?.firstName||d?.firstname||d?.first_name,d?.lastName||d?.lastname||d?.last_name].filter(Boolean).join(" ")||"").trim().replace(/\s+/g," ");
function sectionFor(d){
 const raw=norm(d?.section||d?.sectionName||d?.classSection).split(",").map(norm);
 if(raw.includes(norm("St. Isidore of Seville")))return "shs-g11-techpro-ict-st-isidore-of-seville";
 if(raw.includes(norm("St. Carlo Acutis")))return "shs-g11-techpro-ict-st-carlo-acutis";
 return null;
}
async function main(){
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const db=getFirestore(),school=await db.doc("platform_schools/"+SCHOOL_ID).get();
 if(!school.exists||school.data().state!=="draft")throw Error("MCS must remain draft while correcting roster reconciliation.");
 const students=await db.collection("students").get();
 const selected=[];
 for(const target of TARGETS){
   const matches=students.docs.filter(doc=>active(doc.data())&&sectionFor(doc.data())===target.sectionId&&hash(fold(displayName(doc.data())))===target.nameHash);
   if(matches.length!==1)throw Error("Target record fingerprint is no longer unique.");
   selected.push(matches[0]);
 }
 const batch=db.batch(),now=FieldValue.serverTimestamp();
 for(const doc of selected){
   batch.set(db.doc("schools/"+SCHOOL_ID+"/pilot_roster_exclusions/"+doc.id),{
     schoolId:SCHOOL_ID,legacyStudentId:doc.id,status:"restored",
     displayNameSnapshot:displayName(doc.data()),sectionId:sectionFor(doc.data()),
     reviewedByUid:"migration",reviewedAt:now,
     reason:"Restored: valid student access must be reconciled rather than excluded from the V4 pilot."
   },{merge:false});
 }
 batch.create(db.collection("schools/"+SCHOOL_ID+"/pilot_audit").doc(),{
   schoolId:SCHOOL_ID,actorUid:"migration",action:"pilot_extra_records_restored_for_reconciliation",
   restoredCount:selected.length,accountsChanged:0,membershipsChanged:0,legacyAcademicRecordsChanged:0,
   pilotStarted:false,createdAt:now
 });
 await batch.commit();
 console.log("MCS_EXTRA_RECORD_RESTORE "+JSON.stringify({restored:2,accountsChanged:0,membershipsChanged:0,legacyAcademicRecordsChanged:0,pilotStarted:false}));
}
main().catch(e=>{console.error("MCS_EXTRA_RECORD_RESTORE_ERROR",e.message);process.exitCode=1});