"use strict";
/**
 * Explicit, school-admin-approved access to an original Repository Management
 * assessment held under a legacy custodian identity. No ownership transfer.
 * This document is a narrowly scoped delegated capability, NOT a membership.
 */
const {createHash}=require("node:crypto");
const {SCHOOL_ID}=require("./legacy-student-identity.js");
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
function validCustody(grant,{schoolId,assessmentId,offeringId,teacherUid,task,section=""}){
 if(!grant||grant.status!=="active"||grant.schoolId!==schoolId||schoolId!==SCHOOL_ID||
    grant.assessmentId!==assessmentId||grant.offeringId!==offeringId||
    grant.teacherUid!==teacherUid||!validId(teacherUid)||
    !grant.reviewedBySchoolAdminUid||grant.reviewedBySchoolAdminUid===teacherUid||
    !task||(task.schoolId&&task.schoolId!==schoolId)||
    grant.originalOwnerUid!==String(task.ownerUid||"")||
    grant.originalTitle!==String(task.title||"")||
    Number(grant.originalMaxScore)!==Number(task.maxScore)||
    grant.originalSubject!==String(task.subject||"")||
    !originalSections(task).some(s=>normalized(s)===normalized(grant.originalSection))||
    (section&&normalized(section)!==normalized(grant.originalSection))||
    !Array.isArray(grant.verifiedLegacyStudentIds)||grant.verifiedLegacyStudentIds.length===0||
    grant.verifiedLegacyStudentIds.length>350||new Set(grant.verifiedLegacyStudentIds).size!==grant.verifiedLegacyStudentIds.length||
    grant.verifiedLegacyStudentIds.some(id=>!validId(id)))return false;
 return true;
}
async function authorizedTeacherCustody({db,schoolId,teacherUid,assessmentId,offeringId,task}){
 const [doc,assignment,offering,membership]=await Promise.all([
   custodyRef(db,schoolId,assessmentId,offeringId).get(),
   db.doc("schools/"+schoolId+"/staff_assignments/"+teacherUid+"_"+offeringId).get(),
   db.doc("schools/"+schoolId+"/course_offerings/"+offeringId).get(),
   db.doc("schools/"+schoolId+"/memberships/"+teacherUid).get()
 ]);
 const grant=doc.exists?doc.data():null;
 if(!validCustody(grant,{schoolId,teacherUid,assessmentId,offeringId,task})||
    !offering.exists||offering.data().schoolId!==schoolId||
    !assignment.exists||assignment.data().schoolId!==schoolId||
    assignment.data().teacherUid!==teacherUid||assignment.data().offeringId!==offeringId||
    assignment.data().status!=="active"||
    !membership.exists||membership.data().status!=="active"||
    membership.data().schoolId!==schoolId||!membership.data().roles?.includes("teacher"))
   return null;
 return {ref:doc.ref,grant};
}
module.exports={custodyId,custodyRef,validCustody,authorizedTeacherCustody,originalSections,normalized};
