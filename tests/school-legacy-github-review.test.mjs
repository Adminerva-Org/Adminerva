import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const source=readFileSync(new URL("../functions/school-legacy-github-review.js",import.meta.url),"utf8");
const digest=(...items)=>createHash("sha256").update(JSON.stringify(items)).digest("hex");
const ctx={schoolId:"school-one",uid:"teacher-one",roles:["teacher"],platformOverride:false};
const taskId="oop-assessment",studentId="student@school.ph";
const evidenceId=studentId+"_"+taskId,checkpoint="c".repeat(40),commit="a".repeat(40);
const blueprintId="legacy_"+digest(ctx.schoolId,ctx.uid,taskId).slice(0,48);
function install(){
 const module={exports:{}};
 class TenantAccessError extends Error{constructor(code,message){super(message);this.code=code;}}
 vm.runInNewContext(source,{module,console,Buffer,Date,URL,require:name=>{
   if(name==="node:crypto")return {createHash};
   if(name==="firebase-admin/firestore")return {
     FieldValue:{serverTimestamp:()=>({serverTimestamp:true})},
     FieldPath:{documentId:()=>"__name__"}
   };
   if(name==="./tenant-access.js")return {TenantAccessError};
   if(name==="./school-legacy-custody.js")return {
     authorizedTeacherCustody:async()=>null,validCustody:()=>false,
     normalized:value=>String(value||"").trim().toLowerCase()
   };
   throw Error("Unrecognized dependency "+name);
 }},{filename:"school-legacy-github-review.js"});
 return module.exports;
}
function fixture({published=false,grade=null,approval=true,discovery=false,
  studentResubmitted=false,zeroCommits=false,revision=7,omitRevision=false,scalarOnly=false}={}){
 const map=new Map(),writes=[];
 const put=(path,value)=>map.set(path,value);
 put("assessments/"+taskId,{ownerUid:ctx.uid,title:"Java OOP",
   schemaVersion:2,submissionSource:"github",maxScore:40,
   evalCriteria:"Code quality | 20\nProgram behavior | 20",
   taskContext:"Build a Java OOP program",deployments:[{section:"Grade 12 ICT"}]});
 put("schools/"+ctx.schoolId+"/assessment_blueprints/"+blueprintId,{
   schoolId:ctx.schoolId,ownerUid:ctx.uid,legacyImport:{
     assessmentId:taskId,origin:"repository_management"
   }
 });
 put("assessment_evidence/"+evidenceId,{
   studentId,assessmentId:taskId,section:"Grade 12 ICT",
   repository:"https://github.com/learner/java-classes",
   status:approval?"approved":studentResubmitted?"submitted":discovery?"needs_review":"submitted",
   ...(!omitRevision?{revision}:{}),
   source:discovery?"teacher_discovered":"student_submitted",
   checkpointSha:checkpoint,approvedCheckpointSha:approval?checkpoint:null,
   selectedCommits:zeroCommits?[]:[commit],
   verifiedContributionCommits:zeroCommits?[]:approval?[commit]:[],
   contributionScope:"Instructor verified this learner's implementation",
   ...(!discovery||studentResubmitted?{submittedAt:{toMillis:()=>1234}}:{})
 });
 put("students/"+studentId,{name:"Original Student Name"});
 if(grade)put("student_grades/"+evidenceId,{...grade,published});
 const doc=path=>({
   id:path.split("/").at(-1),path,
   get:async()=>({id:path.split("/").at(-1),ref:doc(path),
     exists:map.has(path),data:()=>map.get(path)})
 });
 let count=0;
 const db={doc,
   collection(path){return {
     doc:id=>doc(path+"/"+(id||"audit-"+(++count))),
     where(field,op,value){assert.equal(op,"==");
       const page=(limit,last="")=>{
         const records=[...map].filter(([key,data])=>
           key.startsWith(path+"/")&&key.split("/").length===2&&
           data[field]===value&&key.slice(path.length+1)>last)
           .slice(0,limit).map(([key,data])=>({
             id:key.split("/").at(-1),data:()=>data
           }));
         return {docs:records,size:records.length};
       };
       return {
         limit(n){return {get:async()=>page(n)};},
         orderBy(){let last="";return {
           startAfter(v){last=v;return this;},
           limit(n){return {get:async()=>page(n,last)};}
         };}
       };
     }
   };},
   async runTransaction(fn){const tx={
     get:ref=>ref.get(),
     create(ref,value){assert.ok(!map.has(ref.path));put(ref.path,value);writes.push(["create",ref.path]);},
     set(ref,value){put(ref.path,value);writes.push(["set",ref.path]);},
     update(ref,value){assert.ok(map.has(ref.path));put(ref.path,{...map.get(ref.path),...value});writes.push(["update",ref.path]);}
   };return fn(tx);}
 };
 const service=install().createSchoolLegacyGithubReview({db,
   parseLegacyRubric:()=>[{name:"Code quality",points:20},{name:"Program behavior",points:20}],
   ...(scalarOnly?{parseVerifiedLegacyRubric:()=>null}:{})});
 const request=(action,extra={})=>({ctx,input:{action,legacyAssessmentId:taskId,...extra}});
 const gradeArgs={legacyEvidenceId:evidenceId,expectedEvidenceRevision:revision,
   expectedCheckpointSha:checkpoint,expectedGradeRevision:0,
   criteria:[{awardedPoints:18,pendingPoints:0,comment:"Relevant code"},
     {awardedPoints:17,pendingPoints:0,comment:"Output checked"}],
   feedback:"Verified OOP source against the submitted rubric.",
   reviewNote:"Teacher inspected exact approved commits and checked the student's work."};
 return {service,db,map,writes,request,gradeArgs};
}
test("historical GitHub V4 inbox and inspect read through original school-owned records",async()=>{
 const f=fixture();
 const inbox=await f.service(f.request("legacy_github_inbox"));
 assert.equal(inbox.evidence.length,1);
 assert.equal(inbox.evidence[0].studentName,"Original Student Name");
 assert.equal(inbox.evidence[0].verifiedCount,1);
 const result=await f.service(f.request("legacy_github_inspect",{legacyEvidenceId:evidenceId}));
 assert.equal(result.snapshot.checkpointSha,checkpoint);
 assert.deepEqual([...result.snapshot.selectedCommitShas],[commit]);
 assert.deepEqual([...result.snapshot.verifiedContributionCommits],[commit]);
 assert.equal(result.task.rubric.length,2);
 assert.equal(f.writes.length,0);
});
test("legacy Review & Grade discovers grade-only original rows without inventing submission evidence",async()=>{
 const f=fixture();
 const extraStudent="historical.grade.only@example.edu.ph";
 f.map.set("student_grades/"+extraStudent+"_"+taskId,{
   taskId,studentId:extraStudent,section:"Grade 12 ICT",
   score:18,maxScore:40,published:true,gradeSource:"teacher_manual"
 });
 const response=await f.service(f.request("legacy_github_inbox"));
 assert.equal(response.coverage.evidenceCount,1);
 assert.equal(response.coverage.gradeCount,1);
 assert.equal(response.coverage.publishedCount,1);
 assert.equal(response.coverage.gradeOnly,1);
 assert.equal(response.coverage.evidenceWithoutGrade,1);
 const row=response.evidence.find(item=>item.studentId===extraStudent);
 assert.equal(row.gradeOnly,true);
 assert.equal(row.hasSubmission,false);
 assert.equal(row.evidenceId,null);
 assert.equal(row.awarded,18);
 assert.equal(row.gradeStatus,"published");
 assert.equal(f.writes.length,0,"reconciliation must never copy or mutate a grade");
});
test("V4 grade save and publish update ONLY original grade and audit records",async()=>{
 const f=fixture();
 const saved=await f.service(f.request("legacy_github_save_draft",f.gradeArgs));
 assert.equal(saved.awarded,35);
 assert.equal(f.map.get("student_grades/"+evidenceId).gradeVersion,1);
 assert.equal(f.map.get("student_grades/"+evidenceId).gradedSha,checkpoint);
 const published=await f.service(f.request("legacy_github_publish",{
   legacyEvidenceId:evidenceId,expectedEvidenceRevision:7,
   expectedCheckpointSha:checkpoint,expectedGradeRevision:1
 }));
 assert.equal(published.published,true);
 assert.equal(f.map.get("student_grades/"+evidenceId).published,true);
 assert.equal(f.writes.filter(([,path])=>path.startsWith("schools/")).length,0);
 assert.equal(f.writes.filter(([,path])=>path.startsWith("grade_revisions/")).length,2);
});
test("student-submitted historical commits can be graded without a teacher contribution approval",async()=>{
 const f=fixture({approval:false});
 const result=await f.service(f.request("legacy_github_inspect",{legacyEvidenceId:evidenceId}));
 assert.equal(result.snapshot.status,"submitted");
 assert.equal(result.snapshot.hasSubmission,true);
 const saved=await f.service(f.request("legacy_github_save_draft",f.gradeArgs));
 assert.equal(saved.awarded,35);
 assert.equal(f.map.get("student_grades/"+evidenceId).gradeVersion,1);
});
test("teacher-forced discovery, even if approved or zero-commit, never generates a new grade",async()=>{
 for(const zeroCommits of [false,true]){
  const f=fixture({discovery:true,approval:true,zeroCommits});
  const inbox=await f.service(f.request("legacy_github_inbox"));
  assert.equal(inbox.evidence[0].hasSubmission,false);
  assert.equal(inbox.evidence[0].discoveryOnly,true);
  const inspect=await f.service(f.request("legacy_github_inspect",{
    legacyEvidenceId:evidenceId
  }));
  assert.equal(inspect.snapshot.hasSubmission,false);
  await assert.rejects(f.service(f.request("legacy_github_save_draft",f.gradeArgs)),
    error=>error.code==="failed-precondition"&&/No student-submitted/.test(error.message));
  assert.equal(f.writes.length,0);
 }
});
test("a student's genuine resubmission after force discovery is eligible, even when legacy source remained stale",async()=>{
 const f=fixture({discovery:true,studentResubmitted:true,approval:false});
 const inbox=await f.service(f.request("legacy_github_inbox"));
 assert.equal(inbox.evidence[0].hasSubmission,true);
 const saved=await f.service(f.request("legacy_github_save_draft",f.gradeArgs));
 assert.equal(saved.status,"draft");
});
test("historical blueprint imports predating origin metadata remain compatible",async()=>{
 const f=fixture();
 delete f.map.get("schools/"+ctx.schoolId+"/assessment_blueprints/"+blueprintId).legacyImport.origin;
 const res=await f.service(f.request("legacy_github_inbox"));
 assert.equal(res.evidence.length,1);
});
test("wrong school and assessment owner cannot expose original evidence",async()=>{
 const f=fixture();
 f.map.delete("schools/"+ctx.schoolId+"/assessment_blueprints/"+blueprintId);
 await assert.rejects(f.service(f.request("legacy_github_inbox")),error=>error.code==="failed-precondition");
 const other=fixture();other.map.get("assessments/"+taskId).ownerUid="another-teacher";
 await assert.rejects(other.service(other.request("legacy_github_inbox")),error=>error.code==="permission-denied");
});
test("stale evidence, duplicate source identity and existing published grade block writes",async()=>{
 const f=fixture();
 await assert.rejects(f.service(f.request("legacy_github_save_draft",{
   ...f.gradeArgs,expectedEvidenceRevision:6})),error=>error.code==="failed-precondition");
 f.map.get("assessment_evidence/"+evidenceId).studentId="different-student";
 await assert.rejects(f.service(f.request("legacy_github_inspect",{
   legacyEvidenceId:evidenceId})),error=>error.code==="failed-precondition");
 const g=fixture({grade:{studentId,taskId,score:33,maxScore:40,gradeVersion:2},published:true});
 await assert.rejects(g.service(g.request("legacy_github_save_draft",{
   ...g.gradeArgs,expectedGradeRevision:2})),error=>error.code==="failed-precondition");
 assert.equal(f.writes.length,0);assert.equal(g.writes.length,0);
});
test("revisionless historical bulk saves recover safely without weakening real revision 1",async()=>{
 const old=fixture({omitRevision:true,revision:0});
 const inspect=await old.service(old.request("legacy_github_inspect",{legacyEvidenceId:evidenceId}));
 assert.equal(inspect.snapshot.version,1);
 assert.equal(inspect.snapshot.evidenceRevision,0);
 const saved=await old.service(old.request("legacy_github_save_draft",{
   ...old.gradeArgs,expectedEvidenceRevision:1,onlyIfUngraded:true
 }));
 assert.equal(saved.status,"draft");
 assert.equal(old.map.get("student_grades/"+evidenceId).evidenceRevision,0);

 const current=fixture({revision:1});
 await assert.rejects(current.service(current.request("legacy_github_save_draft",{
   ...current.gradeArgs,expectedEvidenceRevision:1,onlyIfUngraded:true
 })),error=>error.code==="failed-precondition"&&/evidence changed/i.test(error.message));
 const canonical=await current.service(current.request("legacy_github_save_draft",{
   ...current.gradeArgs,expectedEvidenceRevision:1,expectedEvidenceRevisionMode:"canonical",
   onlyIfUngraded:true
 }));
 assert.equal(canonical.status,"draft");
 assert.equal(current.map.get("student_grades/"+evidenceId).evidenceRevision,1);
});
test("bulk GitHub save cannot overwrite an existing original grade draft",async()=>{
 const f=fixture({grade:{studentId,taskId,score:33,maxScore:40,gradeVersion:2},published:false});
 await assert.rejects(f.service(f.request("legacy_github_save_draft",{
   ...f.gradeArgs,expectedGradeRevision:2,onlyIfUngraded:true
 })),error=>error.code==="failed-precondition");
 assert.equal(f.map.get("student_grades/"+evidenceId).score,33);
 assert.equal(f.writes.length,0);
});
test("zero or unresolved points cannot be published, and stale versions cannot publish",async()=>{
 const f=fixture();
 await f.service(f.request("legacy_github_save_draft",{
   ...f.gradeArgs,criteria:[
     {awardedPoints:0,pendingPoints:0,comment:"Missing"},
     {awardedPoints:0,pendingPoints:0,comment:"Missing"}
   ]
 }));
 await assert.rejects(f.service(f.request("legacy_github_publish",{
   legacyEvidenceId:evidenceId,expectedEvidenceRevision:7,
   expectedCheckpointSha:checkpoint,expectedGradeRevision:1
 })),error=>error.code==="failed-precondition");
 await assert.rejects(f.service(f.request("legacy_github_publish",{
   legacyEvidenceId:evidenceId,expectedEvidenceRevision:7,
   expectedCheckpointSha:checkpoint,expectedGradeRevision:0
 })),error=>error.code==="failed-precondition");
 assert.equal(f.map.get("student_grades/"+evidenceId).published,false);
});

test("historical GitHub bulk publishing uses the same frozen evidence checks and is idempotent",async()=>{
 const f=fixture();
 await f.service(f.request("legacy_github_save_draft",f.gradeArgs));
 const result=await f.service(f.request("legacy_github_bulk_publish"));
 assert.equal(result.published,1);
 assert.equal(result.failed,0);
 assert.equal(result.zeroSkipped,0);
 assert.equal(f.map.get("student_grades/"+evidenceId).published,true);
 const repeated=await f.service(f.request("legacy_github_bulk_publish"));
 assert.equal(repeated.published,0);
 assert.equal(f.writes.filter(([,path])=>path.startsWith("grade_revisions/")).length,2,
   "retry cannot duplicate a completed publication or audit event");
});
test("historical GitHub bulk publication excludes zero points and teacher-only discoveries",async()=>{
 const zero=fixture();
 await zero.service(zero.request("legacy_github_save_draft",{
   ...zero.gradeArgs,
   criteria:[{awardedPoints:0,pendingPoints:0,comment:"No qualifying source"},
     {awardedPoints:0,pendingPoints:0,comment:"No qualifying behavior"}]
 }));
 const zeroResult=await zero.service(zero.request("legacy_github_bulk_publish"));
 assert.equal(zeroResult.published,0);
 assert.equal(zeroResult.zeroSkipped,1);
 assert.equal(zero.map.get("student_grades/"+evidenceId).published,false);
 const discovered=fixture({discovery:true,approval:true,
   grade:{studentId,taskId,score:35,maxScore:40,gradeVersion:1,pending:0}});
 const noReceipt=await discovered.service(discovered.request("legacy_github_bulk_publish"));
 assert.equal(noReceipt.published,0);
 assert.equal(noReceipt.unverifiedSkipped,1);
 assert.equal(discovered.map.get("student_grades/"+evidenceId).published,false);
 assert.equal(discovered.writes.length,0);
});
test("historical GitHub bulk publication cannot publish a stale checkpoint or altered source",async()=>{
 const f=fixture();
 await f.service(f.request("legacy_github_save_draft",f.gradeArgs));
 f.map.get("assessment_evidence/"+evidenceId).checkpointSha="f".repeat(40);
 const result=await f.service(f.request("legacy_github_bulk_publish"));
 assert.equal(result.published,0);
 assert.equal(result.failed,1);
 assert.equal(f.map.get("student_grades/"+evidenceId).published,false);
 assert.equal(f.writes.filter(([,path])=>path.startsWith("grade_revisions/")).length,1,
   "only the original private draft may be audited, never a stale publication");
});


test("incompatible historical evidence does not interrupt another learner's grading",async()=>{
 const f=fixture();
 const old="older-student",oldId=old+"_"+taskId;
 f.map.set("assessment_evidence/"+oldId,{studentId:old,assessmentId:taskId,section:"Grade 12 ICT",repository:"https://github.com/learner/older"});
 f.map.set("student_grades/"+oldId,{studentId:old,taskId,section:"Grade 12 ICT",score:31,maxScore:40,published:true});
 const result=await f.service(f.request("legacy_github_inbox"));
 const row=result.evidence.find(row=>row.studentId===old);
 assert.equal(row.evidenceException,true);assert.equal(row.hasSubmission,false);
 assert.equal(row.gradeStatus,"published");assert.equal(row.awarded,31);
 assert.equal(result.coverage.evidenceExceptions,1);
 assert.equal((await f.service(f.request("legacy_github_save_draft",f.gradeArgs))).awarded,35);
 assert.equal(f.map.get("student_grades/"+oldId).score,31);
});
test("alternate original grade IDs cannot silently produce duplicate grades",async()=>{
 const f=fixture();
 f.map.set("student_grades/old-grade-key",{studentId,taskId,section:"Grade 12 ICT",score:32,maxScore:40,published:false});
 const result=await f.service(f.request("legacy_github_inbox"));
 assert.equal(result.evidence[0].gradeException,true);
 assert.equal(result.evidence[0].hasSubmission,false);
 await assert.rejects(f.service(f.request("legacy_github_save_draft",f.gradeArgs)),error=>error.code==="failed-precondition");
 assert.equal(f.writes.length,0);
});


test("historical assessment without verified rubric supports manual total-score grading only",async()=>{
 const f=fixture({scalarOnly:true});
 const inbox=await f.service(f.request("legacy_github_inbox"));
 assert.equal(inbox.task.historicalRubricMode,"scalar_manual");
 assert.equal(inbox.task.rubric.length,1);assert.equal(inbox.task.rubric[0].points,40);
 const input={...f.gradeArgs,criteria:[{awardedPoints:33,pendingPoints:0,comment:"Original total manually reviewed"}]};
 await assert.rejects(f.service(f.request("legacy_github_save_draft",{...input,draftSource:"external_ai"})),error=>error.code==="failed-precondition");
 await assert.rejects(f.service(f.request("legacy_github_save_draft",{...input,onlyIfUngraded:true})),error=>error.code==="failed-precondition");
 const result=await f.service(f.request("legacy_github_save_draft",input));
 assert.equal(result.awarded,33);assert.equal(result.total,40);
 assert.equal(f.map.get("student_grades/"+evidenceId).score,33);
});


test("historical GitHub draft and publication do not require routine teacher approval notes or advisory review clearance",async()=>{
 const f=fixture({approval:false});
 const input={...f.gradeArgs};delete input.reviewNote;
 const saved=await f.service(f.request("legacy_github_save_draft",input));
 assert.equal(saved.awarded,35);
 const grade=f.map.get("student_grades/"+evidenceId);
 assert.equal(grade.reviewSuggested,true);
 grade.reviewRequired=true;
 const result=await f.service(f.request("legacy_github_publish",{
   legacyEvidenceId:evidenceId,expectedEvidenceRevision:7,expectedCheckpointSha:checkpoint,expectedGradeRevision:1
 }));
 assert.equal(result.published,true);
 assert.equal(f.map.get("student_grades/"+evidenceId).published,true);
 assert.equal(f.writes.filter(([,path])=>path.startsWith("grade_revisions/")).length,2);
});
