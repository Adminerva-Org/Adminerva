"use strict";
/** Creates an unapproved review template for MCS enrollments/teacher assignments. */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA,SCHOOL_ID}=require("./mcs-canonical-academic-access-plan.js");
const APPROVAL_SCHEMA="adminerva-v4-mcs-canonical-academic-access-approval-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function createTemplate(plan,raw){
 if(plan?.schema!==SCHEMA||plan.schoolId!==SCHOOL_ID||plan.readOnly!==true||plan.readyForApply!==false)
  throw Error("Use a current MCS academic-access plan.");
 return {
  schema:APPROVAL_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_academic_access_only",
  planSha256:sha(raw),approvedBy:"",approvedAt:"",
  acknowledgements:{
   enrollmentScopesReviewed:false,teacherScopesReviewed:false,
   endedHistoryReviewed:false,excludedRowsExplained:false,
   noImplicitElectiveEnrollment:true,noImplicitTeacherExpansion:true,
   backupsAndRollbackReviewed:false
  },
  enrollments:(plan.enrollments||[]).map(row=>({
   enrollmentId:row.enrollmentId,personId:row.personId,studentUid:row.studentUid,
   offeringId:row.offeringId,status:row.status,source:row.source,
   decision:"pending",exclusionReason:""
  })),
  assignments:(plan.assignments||[]).map(row=>({
   assignmentId:row.assignmentId,teacherUid:row.teacherUid,offeringId:row.offeringId,
   status:row.status,source:row.source,decision:"pending",exclusionReason:""
  })),
  unresolvedBlockers:plan.blockers||[],
  reviewItems:(plan.reviewItems||[]).map(item=>({...item,resolved:false,resolution:""})),
  reviewNotes:"",
  warning:"UNAPPROVED TEMPLATE. Every proposed relationship needs approve/exclude review; this file grants nothing by itself."
 };
}
function main(){
 const args=process.argv.slice(2),planPath=arg(args,"plan"),output=arg(args,"output");
 const raw=readFileSync(planPath),plan=JSON.parse(raw.toString("utf8")),template=createTemplate(plan,raw);
 writeFileSync(output,JSON.stringify(template,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({templateCreated:true,schoolId:SCHOOL_ID,
  enrollments:template.enrollments.length,assignments:template.assignments.length,
  blockers:template.unresolvedBlockers.length,approved:false}));
}
if(require.main===module)try{main();}catch(error){
 console.error("Academic-access approval template failed:",error.message);process.exitCode=1;
}
module.exports={APPROVAL_SCHEMA,createTemplate};
