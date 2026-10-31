"use strict";
/**
 * Read-only MCS enrollment and teaching-assignment planner.
 *
 * Converts approved canonical people/catalog/offering mappings plus the
 * non-authoritative legacy roster/staff scope hints into explicit review
 * candidates. Nothing here grants class access.
 */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const {validatePlan,validateApproval}=require("./mcs-canonical-foundation-apply.js");

const SCHEMA="adminerva-v4-mcs-canonical-academic-access-plan-v1";
const sha=value=>createHash("sha256").update(value).digest("hex");
function clean(value,max=140){return typeof value==="string"?value.trim().replace(/\s+/g," ").slice(0,max):"";}
function pathTail(path,root){
 const marker="/legacy_roots/"+root+"/documents/";
 const index=String(path||"").indexOf(marker);
 if(index<0)return null;
 const tail=String(path).slice(index+marker.length);
 return tail&&!tail.includes("/")?tail:null;
}
function approvedLabelMap(rows){
 const result=new Map();
 for(const row of rows||[]){
  if(row.approved!==true)continue;
  const label=clean(row.legacyLabel).toLocaleLowerCase("en");
  if(!label)continue;
  if(result.has(label)&&result.get(label)!==row.targetId)
   throw Error("One legacy academic label has multiple approved targets.");
  result.set(label,row.targetId);
 }
 return result;
}
function identityByUid(identity){
 if(identity?.schema!=="adminerva-v4-mcs-identity-candidates-v1"||
    identity.schoolId!==SCHOOL_ID||identity.readOnly!==true||identity.grantsCreated!==false)
  throw Error("Use a current read-only MCS identity candidate report.");
 return new Map((identity.candidates||[]).map(row=>[row.uid,row]));
}
function buildAcademicAccessPlan({foundationPlan,foundationPlanRaw,foundationApproval,identity,identitySha256}){
 const approved=validateApproval(validatePlan(foundationPlan),foundationPlanRaw,foundationApproval);
 const identities=identityByUid(identity);
 const sections=approvedLabelMap(foundationApproval.academic?.sections);
 const years=approvedLabelMap(foundationApproval.academic?.years);
 const subjects=approvedLabelMap(foundationApproval.academic?.subjects);
 const offerings=approved.offerings;
 const enrollments=[],assignments=[],blockers=[],reviewItems=[];
 const enrollmentKeys=new Set(),assignmentKeys=new Set();

 const approvedStudents=approved.memberships.filter(row=>row.roles.includes("student"));
 for(const member of approvedStudents){
  const identityRow=identities.get(member.uid);
  const person=approved.people.find(row=>row.uid===member.uid);
  if(!identityRow||!person){
   blockers.push({type:"student_access_identity_missing",uid:member.uid});continue;
  }
  const sourceIds=new Set(person.sourcePaths.map(path=>pathTail(path,"students")).filter(Boolean));
  const histories=(identityRow.legacyStudentIds||[]).filter(row=>sourceIds.has(row.studentId));
  if(!histories.length){
   blockers.push({type:"student_roster_history_missing",uid:member.uid,personId:person.personId});continue;
  }
  for(const history of histories){
   const sectionLabel=clean(history.section),yearLabel=clean(history.year);
   if(!sectionLabel){
    blockers.push({type:"student_section_missing",uid:member.uid,studentId:history.studentId});continue;
   }
   const sectionId=sections.get(sectionLabel.toLocaleLowerCase("en"));
   if(!sectionId){
    blockers.push({type:"student_section_unmapped",uid:member.uid,studentId:history.studentId,sectionLabel});continue;
   }
   const yearId=yearLabel?years.get(yearLabel.toLocaleLowerCase("en")):null;
   if(yearLabel&&!yearId){
    blockers.push({type:"student_year_unmapped",uid:member.uid,studentId:history.studentId,yearLabel});continue;
   }
   let matches=offerings.filter(row=>row.sectionId===sectionId);
   if(yearId)matches=matches.filter(row=>row.yearId===yearId);
   if(!matches.length){
    blockers.push({type:"student_section_has_no_offering",uid:member.uid,studentId:history.studentId,
      sectionId,yearId});continue;
   }
   const active=!["archived","suspended","inactive","disabled","deleted"].includes(clean(history.status,40).toLowerCase());
   for(const offering of matches){
    const key=person.personId+"|"+offering.offeringId;
    if(enrollmentKeys.has(key)){
     reviewItems.push({type:"duplicate_historical_roster_relationship",uid:member.uid,
       personId:person.personId,offeringId:offering.offeringId,studentId:history.studentId});
     continue;
    }
    enrollmentKeys.add(key);
    enrollments.push({
     enrollmentId:"mcsenr_"+sha(key).slice(0,40),
     targetPath:"schools/"+SCHOOL_ID+"/enrollments/mcsenr_"+sha(key).slice(0,40),
     personId:person.personId,studentUid:member.uid,offeringId:offering.offeringId,
     yearId:offering.yearId,termId:offering.termId,sectionId:offering.sectionId,subjectId:offering.subjectId,
     status:active?"active":"ended",requiresApproval:true,
     source:{legacyStudentId:history.studentId,legacySection:sectionLabel,legacyYear:yearLabel||null,
       legacyStatus:clean(history.status,40)||"active"}
    });
   }
  }
 }

 const approvedTeachers=approved.memberships.filter(row=>row.roles.includes("teacher"));
 for(const member of approvedTeachers){
  const identityRow=identities.get(member.uid),person=approved.people.find(row=>row.uid===member.uid);
  if(!identityRow||!person){blockers.push({type:"teacher_access_identity_missing",uid:member.uid});continue;}
  const scopes=(identityRow.legacyStaffScopes||[]).filter(scope=>
   scope.role==="teacher"&&scope.status==="active");
  if(!scopes.length){
   blockers.push({type:"teacher_assignment_scope_missing",uid:member.uid,personId:person.personId});continue;
  }
  let any=false;
  for(const scope of scopes){
   if(!Array.isArray(scope.sections)||!scope.sections.length){
    blockers.push({type:"teacher_section_scope_missing",uid:member.uid,staffRecordId:scope.recordId});continue;
   }
   for(const sectionLabelRaw of scope.sections){
    const sectionLabel=clean(sectionLabelRaw),sectionId=sections.get(sectionLabel.toLocaleLowerCase("en"));
    if(!sectionId){
     blockers.push({type:"teacher_section_unmapped",uid:member.uid,staffRecordId:scope.recordId,sectionLabel});continue;
    }
    const subjectIds=[];
    for(const subjectLabelRaw of Array.isArray(scope.subjects)?scope.subjects:[]){
     const subjectLabel=clean(subjectLabelRaw),subjectId=subjects.get(subjectLabel.toLocaleLowerCase("en"));
     if(!subjectId){
      blockers.push({type:"teacher_subject_unmapped",uid:member.uid,staffRecordId:scope.recordId,subjectLabel});
      continue;
     }
     subjectIds.push(subjectId);
    }
    let matches=offerings.filter(row=>row.sectionId===sectionId);
    if(subjectIds.length)matches=matches.filter(row=>subjectIds.includes(row.subjectId));
    if(!matches.length){
     blockers.push({type:"teacher_scope_has_no_offering",uid:member.uid,staffRecordId:scope.recordId,
       sectionId,subjectIds});continue;
    }
    for(const offering of matches){
     const key=member.uid+"|"+offering.offeringId;
     if(assignmentKeys.has(key))continue;
     assignmentKeys.add(key);any=true;
     assignments.push({
      assignmentId:"mcsasg_"+sha(key).slice(0,40),
      targetPath:"schools/"+SCHOOL_ID+"/staff_assignments/mcsasg_"+sha(key).slice(0,40),
      teacherUid:member.uid,personId:person.personId,offeringId:offering.offeringId,
      yearId:offering.yearId,termId:offering.termId,sectionId:offering.sectionId,subjectId:offering.subjectId,
      status:"active",requiresApproval:true,
      source:{legacyStaffRecordId:scope.recordId,legacySection:sectionLabel,
       legacySubjects:Array.isArray(scope.subjects)?scope.subjects:[]}
     });
    }
   }
  }
  if(!any&&!blockers.some(row=>row.uid===member.uid))
   blockers.push({type:"teacher_assignment_unresolved",uid:member.uid});
 }
 return {
  schema:SCHEMA,schoolId:SCHOOL_ID,readOnly:true,generatedAt:new Date().toISOString(),
  foundationPlanSha256:sha(foundationPlanRaw),identitySha256,
  enrollments,assignments,blockers,reviewItems,readyForApply:false,
  summary:{enrollmentCandidates:enrollments.length,teacherAssignmentCandidates:assignments.length,
   blockers:blockers.length,reviewItems:reviewItems.length},
  nextRequiredReview:[
   "Approve each proposed enrollment; section membership is not permission to invent an elective enrollment.",
   "Approve each teacher-course assignment. Empty legacy subject focus means the old section authorization applied to all configured offerings in that section.",
   "Ended historical student rows stay ended and must not be restored merely because the account is active.",
   "Resolve duplicate historical roster relationships before canonical apply."
  ]
 };
}
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function read(path){const raw=readFileSync(path),data=JSON.parse(raw.toString("utf8"));return {raw,data};}
function main(){
 const args=process.argv.slice(2),foundationPath=arg(args,"foundation-plan"),
  approvalPath=arg(args,"foundation-approval"),identityPath=arg(args,"identity"),output=arg(args,"output");
 const foundation=read(foundationPath),approval=read(approvalPath),identity=read(identityPath);
 const plan=buildAcademicAccessPlan({foundationPlan:foundation.data,foundationPlanRaw:foundation.raw,
  foundationApproval:approval.data,identity:identity.data,identitySha256:sha(identity.raw)});
 writeFileSync(output,JSON.stringify(plan,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({academicAccessPlanCreated:true,schoolId:SCHOOL_ID,summary:plan.summary,readyForApply:false}));
}
if(require.main===module)try{main();}catch(error){
 console.error("MCS canonical academic-access planning failed:",error.code||error.message);process.exitCode=1;
}
module.exports={SCHEMA,pathTail,approvedLabelMap,identityByUid,buildAcademicAccessPlan};
