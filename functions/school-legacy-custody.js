"use strict";
/**
 * Explicit, school-admin-approved access to an original Repository Management
 * assessment held under a legacy custodian identity. No ownership transfer.
 * This document is a narrowly scoped delegated capability, NOT a membership.
 */
const {createHash}=require("node:crypto");
const {SCHOOL_ID}=require("./legacy-student-identity.js");
const {rowKey}=require("./school-academics.js");
const {TenantAccessError}=require("./tenant-access.js");
const deny=(code,message)=>{throw new TenantAccessError(code,message)};
const normalized=value=>String(value||"").trim().toLocaleLowerCase("en").replace(/\s+/g," ");
const validId=value=>typeof value==="string"&&value.length>0&&value.length<=330&&
  !/[\\/\u0000-\u001f\u007f]/.test(value)&&value!=="."&&value!==".."&&!/^__.*__$/.test(value);
function custodyId(assessmentId,offeringId){
 if(!validId(assessmentId)||!validId(offeringId))deny("invalid-argument","Invalid legacy source or offering ID.");
 return createHash("sha256").update(JSON.stringify([assessmentId,offeringId])).digest("hex");
}
function custodyRef(db,schoolId,assessmentId,offeringId){
 if(schoolId!==SCHOOL_ID)deny("permission-denied","Original Repository Management custody is restricted to its verified originating school.");
 return db.doc("schools/"+schoolId+"/legacy_assessment_custody/"+custodyId(assessmentId,offeringId));
}
function originalSections(task){
 const values=[...(Array.isArray(task?.sectionIds)?task.sectionIds:[]),
   ...(Array.isArray(task?.targetSections)?task.targetSections:[]),
   ...(Array.isArray(task?.deployments)?task.deployments.map(row=>row?.section):[])];
 return [...new Map(values.filter(x=>typeof x==="string"&&x.trim().length&&x.trim().length<=160)
   .map(x=>[normalized(x),x.trim()])).values()];
}
function custodySourceDigest(task){
 return createHash("sha256").update(JSON.stringify([
   String(task?.evalCriteria||""),String(task?.taskContext||""),
   String(task?.assessmentFormat||""),Number(task?.schemaVersion||0),
   String(task?.submissionSource||""),String(task?.ownershipBasis||"")
 ])).digest("hex");
}
function historicalCustodianRecord(task){
  // Delegate only unattributed early sources or records explicitly marked
  // as administrator-held custody. Ordinary teacher-private preparations
  // must never be reassigned through this administrative recovery route.
  return !!task&&(task.ownerUid===undefined||task.ownerUid===null||task.ownerUid===""||
    String(task.ownershipBasis||"").startsWith("legacy-administrator-custody"));
}
// Never infer a maximum from the highest awarded mark or a default of 20.
function missingOriginalMaximum(task){
 return task?.maxScore===undefined||task.maxScore===null||task.maxScore==="";
}
function validMaximum(value){
 const n=Number(value);
 return Number.isFinite(n)&&n>0&&n<=10000?n:null;
}
function verifiedOriginalMaximum(task,gradeRows,assessmentId,eligibleIds){
 if(!missingOriginalMaximum(task)){
   const maximum=validMaximum(task.maxScore);
   return maximum?{maximum,proof:"original_assessment"}:null;
 }
 const values=new Set(),support=new Set(),allowed=new Set(eligibleIds||[]);
 for(const row of gradeRows){
   if(row?.taskId!==assessmentId||!validId(row.studentId))continue;
   if(row.maxScore===undefined||row.maxScore===null||row.maxScore==="")continue;
   const maximum=validMaximum(row.maxScore);
   if(!maximum)return null;
   values.add(maximum);
   if(row.score===undefined||row.score===null||row.score==="")continue;
   const score=Number(row.score);
   if(!Number.isFinite(score)||score<0||score>maximum)return null;
   if(allowed.has(row.studentId))support.add(row.studentId);
 }
 return values.size===1&&support.size>=2?
   {maximum:[...values][0],proof:"consistent_original_grade_maxima"}:null;
}
function custodyMaximum(task,grant=null){
 if(!missingOriginalMaximum(task))return Number(task.maxScore);
 return grant?.maximumProof==="consistent_original_grade_maxima"?
   validMaximum(grant.originalMaxScore):null;
}
function identityOnlyCustody(grant){
 return grant?.sectionProof==="assessment_student_identity";
}
function custodySectionMatches(grant,section){
 return identityOnlyCustody(grant)||normalized(section)===normalized(grant?.originalSection);
}
function validCustody(grant,{schoolId,assessmentId,offeringId,teacherUid,task,section=""}){
 if(!grant||grant.status!=="active"||grant.schoolId!==schoolId||schoolId!==SCHOOL_ID||
    grant.assessmentId!==assessmentId||grant.offeringId!==offeringId||
    grant.teacherUid!==teacherUid||!validId(teacherUid)||
    !grant.reviewedBySchoolAdminUid||grant.reviewedBySchoolAdminUid===teacherUid||
    !task||!historicalCustodianRecord(task)||(task.schoolId&&task.schoolId!==schoolId)||
    grant.originalOwnerUid!==String(task.ownerUid||"")||
    grant.originalTitle!==String(task.title||"")||
    !validMaximum(grant.originalMaxScore)||
    Number(grant.originalMaxScore)!==custodyMaximum(task,grant)||
    (missingOriginalMaximum(task)&&grant.maximumProof!=="consistent_original_grade_maxima")||
    grant.originalSubject!==String(task.subject||"")||
    grant.sourceDigest!==custodySourceDigest(task)||
    (identityOnlyCustody(grant)?
      (originalSections(task).length!==0||grant.originalSection!==""||
       !Number.isInteger(grant.verifiedPersonCount)||grant.verifiedPersonCount<1):
      !originalSections(task).some(s=>normalized(s)===normalized(grant.originalSection)))||
    (section&&!custodySectionMatches(grant,section))||
    !Array.isArray(grant.verifiedLegacyStudentIds)||grant.verifiedLegacyStudentIds.length===0||
    grant.verifiedLegacyStudentIds.length>350||new Set(grant.verifiedLegacyStudentIds).size!==grant.verifiedLegacyStudentIds.length||
    grant.verifiedLegacyStudentIds.some(id=>!validId(id)))return false;
 return true;
}
async function authorizedTeacherCustody({db,schoolId,teacherUid,assessmentId,offeringId,task}){
 const [doc,assignment,offering,membership]=await Promise.all([
   custodyRef(db,schoolId,assessmentId,offeringId).get(),
   db.doc("schools/"+schoolId+"/staff_assignments/"+rowKey(teacherUid,offeringId)).get(),
   db.doc("schools/"+schoolId+"/course_offerings/"+offeringId).get(),
   db.doc("schools/"+schoolId+"/memberships/"+teacherUid).get()
 ]);
 const grant=doc.exists?doc.data():null;
 if(!validCustody(grant,{schoolId,teacherUid,assessmentId,offeringId,task})||
    !offering.exists||offering.data().schoolId!==schoolId||
    offering.data().primaryTeacherUid!==teacherUid||
    !assignment.exists||assignment.data().schoolId!==schoolId||
    assignment.data().teacherUid!==teacherUid||assignment.data().offeringId!==offeringId||
    assignment.data().status!=="active"||
    !membership.exists||membership.data().status!=="active"||
    membership.data().schoolId!==schoolId||!membership.data().roles?.includes("teacher"))
   return null;
 return {ref:doc.ref,grant};
}
module.exports={custodyId,custodyRef,validCustody,authorizedTeacherCustody,originalSections,normalized,historicalCustodianRecord,custodySourceDigest,identityOnlyCustody,custodySectionMatches,verifiedOriginalMaximum,custodyMaximum};
