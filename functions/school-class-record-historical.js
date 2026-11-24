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
const courseName=value=>canonical(value).replace(/\s+/g," ").trim();
/**
 * Earlier Repository Management assessments were recorded under the generic
 * subject "Computer Programming", before the official SIS catalog split it
 * into Computer Programming 1 and Computer Programming 2. This is a *narrow*
 * historical catalog alias, not a prefix or fuzzy subject match. Ownership,
 * migration origin and original section still must match independently.
 */
function historicalSubjectMatches(originalSubject,offeringSubject){
  const source=courseName(originalSubject),target=courseName(offeringSubject);
  return !!source&&!!target&&(source===target||
    (source==="computer programming"&&/^computer programming (?:1|2|i|ii)$/.test(target)));
}
const validId=value=>typeof value==="string"&&value.length>0&&value.length<=220&&
  value!=="."&&value!==".."&&!/[\\/\u0000-\u001f\u007f]/.test(value)&&!/^__.*__$/.test(value);
const ms=value=>value?.toMillis?.()||(typeof value==="string"?Date.parse(value):Number(value))||0;
function validOrigin(task,schoolId){
  return schoolId===SCHOOL_ID&&task&&(!task.schoolId||task.schoolId===schoolId);
}
function historicalSections(task){
  const sections=[...(Array.isArray(task?.sectionIds)?task.sectionIds:[]),
    ...(Array.isArray(task?.deployments)?task.deployments.map(d=>d?.section):[])];
  const distinct=new Map();
  for(const raw of sections){
    if(typeof raw!=="string"||raw.trim().length===0||raw.trim().length>160)continue;
    const value=raw.trim(),key=canonical(value);
    if(!distinct.has(key))distinct.set(key,value);
  }
  return [...distinct.values()];
}
function historicalMapping({task,taskId,schoolId,ownerUid,offering,offeringId,labels,
  sourceSectionName="",verifiedSection=false}){
  if(!validId(taskId)||!validOrigin(task,schoolId)||task.ownerUid!==ownerUid||
     !labels.sectionName||!labels.subjectName||!labels.termName||!labels.yearName||
     !offering.termId||!offering.yearId||!offering.sectionId||!offering.subjectId||
     !historicalSubjectMatches(task.subject,labels.subjectName))return null;
  const sections=historicalSections(task),requested=String(sourceSectionName||labels.sectionName).trim();
  const section=sections.find(s=>canonical(s)===canonical(requested));
  if(!section||canonical(section)!==canonical(labels.sectionName)&&verifiedSection!==true)return null;
  const maximum=Number(task.maxScore);
  if(!Number.isFinite(maximum)||maximum<=0||maximum>10000)return null;
  return {schoolId,offeringId,yearId:offering.yearId,termId:offering.termId,
    sectionId:offering.sectionId,subjectId:offering.subjectId,
    sectionName:section,offeringSectionName:labels.sectionName,
    subjectName:labels.subjectName,ownerUid};
}
/**
 * A historical section name can differ after SIS adoption or placement changes.
 * Never infer equivalence from similar labels. For a deliberate teacher-selected
 * original section, require verifiable current roster identities in the original
 * school students collection. Only the server can grant this mapping.
 */
async function verifiedHistoricalSectionMapping({db,schoolId,roster,resolveUsers,
  task,taskId,ownerUid,offering,offeringId,labels,sourceSectionName}){
  const candidate=historicalMapping({task,taskId,schoolId,ownerUid,offering,offeringId,
    labels,sourceSectionName,verifiedSection:true});
  if(!candidate)return null;
  if(canonical(candidate.sectionName)===canonical(labels.sectionName))return candidate;
  if(!Array.isArray(roster)||!roster.length)return null;
  const resolved=await resolveHistoricalRoster({db,schoolId,roster,resolveUsers});
  const studentIds=[...resolved.keys()];
  if(!studentIds.length||studentIds.length>300)return null;
  const matched=new Set();
  for(let offset=0;offset<studentIds.length;offset+=100){
    const ids=studentIds.slice(offset,offset+100);
    const docs=await db.getAll(...ids.map(id=>db.doc("students/"+id)));
    docs.forEach((doc,index)=>{
      if(!doc.exists)return;
      const data=doc.data();
      if(canonical(data?.section||data?.sectionName||data?.classSection)===canonical(candidate.sectionName))
        matched.add(resolved.get(ids[index]));
    });
  }
  const required=roster.length===1?1:Math.max(2,Math.ceil(roster.length/3));
  return matched.size>=required?{...candidate,identityVerifiedCount:matched.size,
    identityProof:"original_student_section"}:null;
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
    if(!validOrigin(original,schoolId)||original.ownerUid!==mapping.ownerUid||
       !historicalSections(original).some(section=>canonical(section)===canonical(mapping.sectionName))||
       !historicalSubjectMatches(original.subject,mapping.subjectName))continue;
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
module.exports={HISTORICAL_SOURCE,validOrigin,historicalSubjectMatches,historicalSections,historicalMapping,verifiedHistoricalSectionMapping,mappingMatches,projectedGrade,
  resolveHistoricalRoster,historicalPublishedGrades};
