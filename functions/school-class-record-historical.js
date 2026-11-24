"use strict";
/**
 * Read-only historical Class Record projection. Root legacy data belongs to the
 * verified MCS migration origin; other tenants need an explicit provenance
 * mapping before root records may be exposed. No compatibility-mode write
 * access is restored by this adapter.
 */
const {legacyStudentRecordsForAccount,SCHOOL_ID}=require("./legacy-student-identity.js");
const HISTORICAL_SOURCE="legacy_historical";
const canonical=value=>String(value||"").trim().toLocaleLowerCase("en");
const validId=value=>typeof value==="string"&&value.length>0&&value.length<=220&&
  value!=="."&&value!==".."&&!/[\\/\u0000-\u001f\u007f]/.test(value)&&!/^__.*__$/.test(value);
const ms=value=>value?.toMillis?.()||(typeof value==="string"?Date.parse(value):Number(value))||0;
function validOrigin(task,schoolId){
  return schoolId===SCHOOL_ID&&task&&(!task.schoolId||task.schoolId===schoolId);
}
function historicalMapping({task,taskId,schoolId,ownerUid,offering,offeringId,labels}){
  if(!validId(taskId)||!validOrigin(task,schoolId)||task.ownerUid!==ownerUid||
     !labels.sectionName||!labels.subjectName||!labels.termName||!labels.yearName||
     !offering.termId||!offering.yearId||!offering.sectionId||!offering.subjectId||
     canonical(task.subject)!==canonical(labels.subjectName))return null;
  const sections=[...(Array.isArray(task.sectionIds)?task.sectionIds:[]),
    ...(Array.isArray(task.deployments)?task.deployments.map(d=>d?.section):[])];
  if(!sections.some(s=>canonical(s)===canonical(labels.sectionName)))return null;
  const maximum=Number(task.maxScore);
  if(!Number.isFinite(maximum)||maximum<=0||maximum>10000)return null;
  return {schoolId,offeringId,yearId:offering.yearId,termId:offering.termId,
    sectionId:offering.sectionId,subjectId:offering.subjectId,
    sectionName:labels.sectionName,subjectName:labels.subjectName,ownerUid};
}
function mappingMatches(mapping,schoolId,offeringId,offering){
  return !!mapping&&mapping.schoolId===schoolId&&mapping.offeringId===offeringId&&
    mapping.yearId===offering.yearId&&mapping.termId===offering.termId&&
    mapping.sectionId===offering.sectionId&&mapping.subjectId===offering.subjectId&&
    !!mapping.sectionName&&!!mapping.subjectName&&validId(mapping.ownerUid);
}
function projectedGrade(data,{taskId,studentId,sectionName}){
  if(!data||data.published!==true||data.taskId!==taskId||data.studentId!==studentId||
     canonical(data.section)!==canonical(sectionName))return null;
  if(data.score===null||data.score===undefined||data.maxScore===null||data.maxScore===undefined)return null;
  const awarded=Number(data.score),total=Number(data.maxScore);
  if(!Number.isFinite(awarded)||!Number.isFinite(total)||total<=0||awarded<0||awarded>total)return null;
  return {awarded,total,revision:Number(data.gradeVersion)||1,
    publishedAt:ms(data.publishedAt)||ms(data.updatedAt)||ms(data.gradedAt)};
}
async function resolveHistoricalRoster({db,schoolId,roster,resolveUsers}){
  const mapped=new Map(),conflicts=new Set();
  if(schoolId!==SCHOOL_ID)return mapped;
  const pending=roster.filter(row=>row.authUid&&(!Array.isArray(row.legacyStudentIds)||!row.legacyStudentIds.length));
  let users=[];
  if(pending.length&&typeof resolveUsers==="function"){
    try{users=await resolveUsers([...new Set(pending.map(row=>row.authUid))]);}catch{
      // Direct canonical IDs remain valid; unresolved identities stay blank.
    }
  }
  const byUid=new Map(users.map(u=>[u.uid,u]));
  const resolveUser=typeof resolveUsers==="function"?async uid=>{
    const found=await resolveUsers([uid]);
    return found?.find(u=>u.uid===uid)||null;
  }:null;
  for(const row of roster){
    if(!row.personId||!row.authUid)continue;
    let ids=Array.isArray(row.legacyStudentIds)?[...new Set(row.legacyStudentIds.filter(validId))]:[];
    if(!ids.length&&(!Array.isArray(row.legacyStudentIds)||!row.legacyStudentIds.length)){
      const user=byUid.get(row.authUid);
      try{
        const result=await legacyStudentRecordsForAccount({db,schoolId,uid:row.authUid,
          email:user?.emailVerified===true?user.email:"",resolveUser,maxRecords:50});
        if(["canonical_person","canonical_previous_access","canonical_account_history"].includes(result.source)||
           (result.source==="canonical_email_fallback"&&result.records.length===1))
          ids=result.records.map(record=>record.id).filter(validId);
      }catch{/* Unverified account history never creates a guessed grade. */}
    }
    for(const id of new Set(ids)){
      if(mapped.has(id)&&mapped.get(id)!==row.personId)conflicts.add(id);
      else mapped.set(id,row.personId);
    }
  }
  for(const id of conflicts)mapped.delete(id);
  return mapped;
}
async function historicalPublishedGrades({db,schoolId,offeringId,offering,columns,roster,resolveUsers}){
  const linked=columns.filter(c=>c.kind==="assessment"&&c.assessmentSource===HISTORICAL_SOURCE&&
    validId(c.taskId)&&mappingMatches(c.historicalMapping,schoolId,offeringId,offering));
  if(!linked.length||schoolId!==SCHOOL_ID)return [];
  const students=await resolveHistoricalRoster({db,schoolId,roster,resolveUsers});
  if(!students.size)return [];
  const output=[];
  for(const column of linked){
    const mapping=column.historicalMapping,task=await db.doc("assessments/"+column.taskId).get();
    const original=task.exists?task.data():null;
    if(!validOrigin(original,schoolId)||original.ownerUid!==mapping.ownerUid)continue;
    const pairs=[...students.entries()],matches=new Map(),ambiguous=new Set();
    // Exact original grade document IDs, not a school-wide legacy grade scan.
    for(let i=0;i<pairs.length;i+=100){
      const batch=pairs.slice(i,i+100);
      const snapshots=await db.getAll(...batch.map(([studentId])=>db.doc("student_grades/"+studentId+"_"+column.taskId)));
      snapshots.forEach((snapshot,index)=>{
        if(!snapshot.exists)return;
        const [studentId,personId]=batch[index];
        const grade=projectedGrade(snapshot.data(),{taskId:column.taskId,studentId,sectionName:mapping.sectionName});
        if(!grade)return;
        if(matches.has(personId))ambiguous.add(personId);
        else matches.set(personId,{...grade,sourceType:HISTORICAL_SOURCE,taskId:column.taskId,personId});
      });
    }
    for(const [personId,grade] of matches)if(!ambiguous.has(personId))output.push(grade);
  }
  return output;
}
module.exports={HISTORICAL_SOURCE,validOrigin,historicalMapping,mappingMatches,projectedGrade,
  resolveHistoricalRoster,historicalPublishedGrades};
