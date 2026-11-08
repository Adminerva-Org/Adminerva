"use strict";
const {initializeApp,applicationDefault,getApps}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");

const SCHOOL_ID="mcs-manila";
const TARGETS=[
  {sectionId:"shs-g11-techpro-ict-st-isidore-of-seville",sectionName:"St. Isidore of Seville",expectedBefore:45,expectedAfter:44,nameHash:"cf7772b07257f28cd40d7a4312caee77f51bf4679e819c720965ca08f3a450dd",reason:"Confirmed extra legacy/guest-approved record; excluded from current V4 pilot roster."},
  {sectionId:"shs-g11-techpro-ict-st-carlo-acutis",sectionName:"St. Carlo Acutis",expectedBefore:35,expectedAfter:34,nameHash:"30d7957afbc810af9073fbc9d3f7fda52f9eeaa1f785010de6f05e4e34c70473",reason:"Single live record absent from protected current roster; excluded from current V4 pilot roster."}
];
const norm=v=>String(v||"").trim().replace(/\s+/g," ").toLowerCase();
const fold=v=>norm(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const digest=v=>createHash("sha256").update(String(v)).digest("hex");
const active=d=>!["archived","suspended","inactive","disabled","deleted"].includes(norm(d?.status||"active"));
const displayName=d=>String(d?.displayName||d?.name||d?.fullName||d?.studentName||[d?.firstName||d?.firstname||d?.first_name,d?.lastName||d?.lastname||d?.last_name].filter(Boolean).join(" ")||"").trim().replace(/\s+/g," ");
function sectionFor(d){
  const raw=norm(d?.section||d?.sectionName||d?.classSection);
  const parts=raw.split(",").map(norm);
  return TARGETS.find(t=>parts.includes(norm(t.sectionName)))||null;
}
async function main(){
  if(!getApps().length)initializeApp({credential:applicationDefault()});
  const db=getFirestore();
  const school=await db.doc("platform_schools/"+SCHOOL_ID).get();
  if(!school.exists||school.data().state!=="draft"||school.data().compatibilityMode!=="legacy_allowed"||school.data().productionAuthorized===true)
    throw Error("MCS must remain draft, legacy_allowed and non-production.");

  const students=await db.collection("students").get();
  const rows=students.docs.map(doc=>({id:doc.id,data:doc.data(),section:sectionFor(doc.data())}))
    .filter(row=>row.section&&active(row.data));

  const selected=[];
  for(const target of TARGETS){
    const sectionRows=rows.filter(r=>r.section.sectionId===target.sectionId);
    if(sectionRows.length!==target.expectedBefore)
      throw Error(target.sectionName+" live count changed; expected "+target.expectedBefore+" observed "+sectionRows.length+".");
    const matches=sectionRows.filter(r=>digest(fold(displayName(r.data)))===target.nameHash);
    if(matches.length!==1)
      throw Error(target.sectionName+" extra-record fingerprint is no longer unique.");
    selected.push({target,row:matches[0]});
  }

  const batch=db.batch(),now=FieldValue.serverTimestamp();
  for(const {target,row} of selected){
    batch.set(db.doc("schools/"+SCHOOL_ID+"/pilot_roster_exclusions/"+row.id),{
      schoolId:SCHOOL_ID,legacyStudentId:row.id,status:"excluded",
      displayNameSnapshot:displayName(row.data),sectionId:target.sectionId,
      reviewedByUid:"migration",reviewedAt:now,reason:target.reason,
      exclusionScope:"current_v4_pilot_roster_only",
      legacyStudentRecordPreserved:true,historicalAcademicRecordsPreserved:true
    },{merge:false});
  }
  batch.create(db.collection("schools/"+SCHOOL_ID+"/pilot_audit").doc(),{
    schoolId:SCHOOL_ID,actorUid:"migration",action:"pilot_extra_legacy_records_excluded",
    excludedCount:selected.length,legacyStudentDocumentsChanged:0,
    historicalAcademicRecordsChanged:0,pilotStarted:false,createdAt:now
  });
  await batch.commit();

  const exclusions=await db.collection("schools/"+SCHOOL_ID+"/pilot_roster_exclusions").get();
  const excludedIds=new Set(exclusions.docs.filter(d=>d.data()?.status==="excluded").map(d=>d.id));
  const after={};
  for(const target of TARGETS){
    after[target.sectionId]=rows.filter(r=>r.section.sectionId===target.sectionId&&!excludedIds.has(r.id)).length;
    if(after[target.sectionId]!==target.expectedAfter)
      throw Error(target.sectionName+" post-exclusion count is "+after[target.sectionId]+"; expected "+target.expectedAfter+".");
  }
  console.log("MCS_EXTRA_RECORD_EXCLUSION "+JSON.stringify({
    excluded:2,
    isidoreIncluded:after["shs-g11-techpro-ict-st-isidore-of-seville"],
    carloIncluded:after["shs-g11-techpro-ict-st-carlo-acutis"],
    legacyStudentDocumentsChanged:0,
    historicalAcademicRecordsChanged:0,
    pilotStarted:false
  }));
}
main().catch(e=>{console.error("MCS_EXTRA_RECORD_EXCLUSION_ERROR",e.message);process.exitCode=1});
