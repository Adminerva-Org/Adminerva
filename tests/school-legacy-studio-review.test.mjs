import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";

const text=readFileSync(new URL("../functions/school-legacy-studio-review.js",import.meta.url),"utf8");
const digest=input=>createHash("sha256").update(input).digest("hex");
const ctx={schoolId:"school-one",uid:"teacher-one",roles:["teacher"],platformOverride:false};
const legacyId="mini-peta-3",studentId="student-one",uid="learner-one";
const submittedId=studentId+"_"+legacyId;
function install(){
 const module={exports:{}};
 class TenantAccessError extends Error{
  constructor(code,message){super(message);this.code=code;}
 }
 vm.runInNewContext(text,{module,Buffer,console,Date,require:name=>{
  if(name==="node:crypto")return {createHash};
  if(name==="firebase-admin/firestore")return {
    FieldValue:{serverTimestamp:()=>({testTimestamp:true})},
    FieldPath:{documentId:()=>"__name__"}
  };
  if(name==="./tenant-access.js")return {TenantAccessError};
  throw Error("Unknown dependency "+name);
 }},{filename:"school-legacy-studio-review.js"});
 return module.exports;
}
function data(){
 const snapshot=JSON.stringify({schemaVersion:1,lang:"java",
   files:{"Main.java":"class Main { int value=42; }"},
   fileOrder:["Main.java"],config:{runMode:"console"}});
 const hash=digest(snapshot);
 const head={studentId,ownerUid:uid,assessmentId:legacyId,section:"Grade 12 ICT",
   revision:1,projectId:"school-bell-scheduler",snapshotHash:hash,status:"submitted",
   submittedAt:{toMillis:()=>1000}};
 const frozen={...head,snapshotJson:snapshot};
 const importedId="legacy_"+digest(JSON.stringify([ctx.schoolId,ctx.uid,legacyId])).slice(0,48);
 return {snapshot,head,frozen,hash,importedId};
}
function dbHarness({tamper=false,unauthorized=false,grade=null}={}){
 const example=data(),map=new Map(),writes=[];
 const put=(path,value)=>map.set(path,value);
 put("assessments/"+legacyId,{ownerUid:unauthorized?"another-teacher":ctx.uid,
   schemaVersion:3,submissionSource:"studio",assessmentMode:"personalized",
   maxScore:40,title:"Mini PETA 3",evalCriteria:"Code Quality | 20\nProgram Behavior | 20",
   deployments:[{section:"Grade 12 ICT"}]});
 put("schools/"+ctx.schoolId+"/assessment_blueprints/"+example.importedId,{
   schoolId:ctx.schoolId,ownerUid:ctx.uid,legacyImport:{assessmentId:legacyId}});
 put("studio_submissions/"+submittedId,example.head);
 put("studio_submissions/"+submittedId+"/versions/1",
   tamper?{...example.frozen,snapshotJson:example.frozen.snapshotJson.replace("42","43")}:example.frozen);
 put("students/"+studentId,{name:"Learner One"});
 if(grade)put("student_grades/"+submittedId,grade);
 const doc=(path)=>({
  id:path.split("/").at(-1),path,
  async get(){const value=map.get(path);return {id:path.split("/").at(-1),
    ref:doc(path),exists:value!==undefined,data:()=>value};},
  collection(name){return {doc:id=>doc(path+"/"+name+"/"+id)};}
 });
 let newId=0;
 const db={
  doc,
  collection(path){
   return {
    doc(id){return doc(path+"/"+(id||"revision-"+(++newId)));},
    where(field,op,value){
     assert.equal(op,"==");
     return {orderBy(name){
       assert.equal(name,"__name__");
       let cursor="";
       const query={
        startAfter(value){cursor=typeof value==="string"?value:value.id;return query;},
        limit(n){return {async get(){
         const rows=[...map].filter(([key,row])=>key.startsWith(path+"/")&&
          key.split("/").length===path.split("/").length+1&&row[field]===value&&
          key.split("/").at(-1)>cursor).sort((a,b)=>a[0].localeCompare(b[0]))
          .slice(0,n).map(([key])=>({
           id:key.split("/").at(-1),ref:doc(key),data:()=>map.get(key)
          }));
         return {size:rows.length,docs:rows};
        }};}
       };
       return query;
     }};
    }
   };
  },
  async runTransaction(fn){
   const tx={
    get:ref=>ref.get(),
    set(ref,value){put(ref.path,value);writes.push(["set",ref.path]);},
    update(ref,value){put(ref.path,{...map.get(ref.path),...value});writes.push(["update",ref.path]);},
    create(ref,value){
     if(map.has(ref.path))throw Error("Already exists");
     put(ref.path,value);writes.push(["create",ref.path]);
    }
   };
   return fn(tx);
  }
 };
 return {service:install().createSchoolLegacyStudioReview({db,
   parseLegacyRubric:()=>[{name:"Code Quality",points:20},{name:"Program Behavior",points:20}]}),
   map,writes};
}
const input=action=>({ctx,input:{action,legacyAssessmentId:legacyId}});
test("teacher sees original Studio submissions and their frozen version in V4",async()=>{
 const {service,map}=dbHarness();
 const list=await service(input("legacy_review_inbox"));
 assert.equal(list.submissions.length,1);
 assert.equal(list.submissions[0].studentName,"Learner One");
 assert.equal(list.submissions[0].version,1);
 const inspect=await service({ctx,input:{...input("legacy_review_inspect").input,
   legacySubmissionId:submittedId}});
 assert.equal(inspect.snapshot.files[0].content,"class Main { int value=42; }");
 assert.equal(inspect.snapshot.contentDigest,data().hash);
 assert.equal(map.size,5); // assessment, blueprint, head, version, student
});
test("wrong teacher and wrong school cannot read historical assessment",async()=>{
 const bad=dbHarness({unauthorized:true});
 await assert.rejects(bad.service(input("legacy_review_inbox")),error=>
   error.code==="permission-denied");
 const missing=dbHarness();
 missing.map.delete("schools/"+ctx.schoolId+"/assessment_blueprints/"+data().importedId);
 await assert.rejects(missing.service(input("legacy_review_inbox")),error=>
   error.code==="failed-precondition");
});
test("altered frozen code fails before any grade write",async()=>{
 const {service,writes}=dbHarness({tamper:true});
 await assert.rejects(service({ctx,input:{...input("legacy_review_inspect").input,
   legacySubmissionId:submittedId}}),error=>error.code==="failed-precondition");
 assert.equal(writes.length,0);
});
test("teacher grade and publication use legacy record, not a parallel V4 grade",async()=>{
 const {service,map,writes}=dbHarness();
 const save=await service({ctx,input:{...input("legacy_review_save_draft").input,
   legacySubmissionId:submittedId,
   criteria:[{awardedPoints:18,pendingPoints:0,comment:"Valid"},{awardedPoints:19,pendingPoints:0,comment:"Valid"}],
   feedback:"Verified exact saved Java source and expected runtime behavior."}});
 assert.equal(save.awarded,37);
 const before=map.get("student_grades/"+submittedId);
 assert.equal(before.published,false);
 assert.equal(before.studioSnapshotHash,data().hash);
 const published=await service({ctx,input:{...input("legacy_review_publish").input,
   legacySubmissionId:submittedId,expectedGradeRevision:1}});
 assert.equal(published.published,true);
 assert.equal(map.get("student_grades/"+submittedId).published,true);
 assert.equal(writes.filter(x=>x[1].startsWith("schools/")).length,0);
});
test("zero-score drafts are never bulk-published",async()=>{
 const grade={studentId,taskId:legacyId,gradeSource:"studio_teacher_review",
   studioRevision:1,studioSnapshotHash:data().hash,reviewedBy:ctx.uid,
   score:0,maxScore:40,reviewRequired:false,published:false};
 const {service,map}=dbHarness({grade});
 const result=await service(input("legacy_review_bulk_publish"));
 assert.equal(result.published,0);
 assert.equal(result.zeroSkipped,1);
 assert.equal(map.get("student_grades/"+submittedId).published,false);
});

test("stale historical grade version cannot be published",async()=>{
 const grade={studentId,taskId:legacyId,gradeSource:"studio_teacher_review",
   studioRevision:1,studioSnapshotHash:data().hash,reviewedBy:ctx.uid,
   studioVariantId:"",score:30,maxScore:40,pending:0,
   reviewRequired:false,published:false,gradeVersion:5};
 const {service,writes}=dbHarness({grade});
 await assert.rejects(service({ctx,input:{...input("legacy_review_publish").input,
   legacySubmissionId:submittedId,expectedGradeRevision:4}}),error=>
   error.code==="failed-precondition");
 assert.equal(writes.length,0);
});

test("historical inbox pages through more than 100 learner receipts without dropping any",async()=>{
 const {service,map}=dbHarness();
 const seed=data();
 for(let i=2;i<=195;i++){
   const student="student-"+String(i).padStart(3,"0"),ref=student+"_"+legacyId;
   map.set("studio_submissions/"+ref,{...seed.head,studentId:student,
     ownerUid:"learner-"+i,projectId:"project-"+i});
   map.set("students/"+student,{name:"Learner "+i});
 }
 const result=await service(input("legacy_review_inbox"));
 assert.equal(result.submissions.length,195);
 const keys=new Set(result.submissions.map(row=>row.submissionId));
 assert.equal(keys.size,195);
});

test("previously submitted code remains listed when a historical section is no longer deployed",async()=>{
 const {service,map}=dbHarness();
 map.set("studio_submissions/"+submittedId,{
   ...map.get("studio_submissions/"+submittedId),section:"Previously Archived ICT Section"
 });
 const result=await service(input("legacy_review_inbox"));
 assert.equal(result.submissions.length,1);
 assert.equal(result.submissions[0].historicSectionUnlisted,true);
});

test("email-like historical student IDs appear in V4 and the exact frozen work opens",async()=>{
 const {service,map,writes}=dbHarness();
 const historicalId="grade11.2024+ict@school.edu";
 const historicalSubmission=historicalId+"_"+legacyId;
 const priorHead=map.get("studio_submissions/"+submittedId);
 const priorFrozen=map.get("studio_submissions/"+submittedId+"/versions/1");
 map.delete("studio_submissions/"+submittedId);
 map.delete("studio_submissions/"+submittedId+"/versions/1");
 map.delete("students/"+studentId);
 map.set("studio_submissions/"+historicalSubmission,{...priorHead,studentId:historicalId});
 map.set("studio_submissions/"+historicalSubmission+"/versions/1",
   {...priorFrozen,studentId:historicalId});
 map.set("students/"+historicalId,{name:"Original Student Record"});
 const inbox=await service(input("legacy_review_inbox"));
 assert.equal(inbox.submissions.length,1);
 assert.equal(inbox.submissions[0].legacyStudentId,historicalId);
 assert.equal(inbox.submissions[0].studentName,"Original Student Record");
 const inspected=await service({ctx,input:{
   ...input("legacy_review_inspect").input,legacySubmissionId:historicalSubmission
 }});
 assert.equal(inspected.snapshot.contentDigest,data().hash);
 assert.equal(inspected.snapshot.files[0].content,"class Main { int value=42; }");
 assert.equal(writes.length,0);
});
test("historical path separators are rejected without querying or changing other student records",async()=>{
 const {service,map,writes}=dbHarness();
 await assert.rejects(service({ctx,input:{
   ...input("legacy_review_inspect").input,legacySubmissionId:"../another-student_"+legacyId
 }}),error=>error.code==="invalid-argument");
 assert.equal(map.has("studio_submissions/"+submittedId),true);
 assert.equal(writes.length,0);
});

test("frozen personalized variant is recovered from the original attempt without changing student work",async()=>{
 const {service,map,writes}=dbHarness();
 const variantId="0123456789abcdef0123456789abcdef";
 const head={...map.get("studio_submissions/"+submittedId),variantId};
 const version={...map.get("studio_submissions/"+submittedId+"/versions/1"),variantId};
 map.set("studio_submissions/"+submittedId,head);
 map.set("studio_submissions/"+submittedId+"/versions/1",version);
 map.set("studio_assessment_variants/"+studentId+"_"+legacyId+"/attempts/1",{
   assessmentId:legacyId,studentId,attempt:1,variantId,
   prompt:"Build a school bell scheduler that demonstrates inheritance.",
   evaluationNotes:"Observe concrete classes and overridden methods."
 });
 const result=await service({ctx,input:{
   ...input("legacy_review_inspect").input,legacySubmissionId:submittedId
 }});
 assert.equal(result.snapshot.personalizedTask.variantId,variantId);
 assert.match(result.snapshot.personalizedTask.prompt,/school bell scheduler/);
 assert.equal(result.snapshot.personalizedTask.source,"exact_attempt_assignment");
 assert.equal(result.snapshot.contentDigest,data().hash);
 assert.equal(writes.length,0);
});
test("mismatched frozen personalized variant fails the integrity check",async()=>{
 const {service,map,writes}=dbHarness();
 map.set("studio_submissions/"+submittedId,{
   ...map.get("studio_submissions/"+submittedId),variantId:"0123456789abcdef0123456789abcdef"
 });
 await assert.rejects(service({ctx,input:{
   ...input("legacy_review_inspect").input,legacySubmissionId:submittedId
 }}),error=>error.code==="failed-precondition");
 assert.equal(writes.length,0);
});

test("bulk evaluation cannot replace an existing private legacy Studio grade",async()=>{
 const oldGrade={studentId,taskId:legacyId,gradeSource:"studio_teacher_review",
   studioRevision:1,studioSnapshotHash:data().hash,
   reviewedBy:ctx.uid,score:32,maxScore:40,pending:0,
   reviewRequired:false,published:false,gradeVersion:3};
 const {service,map,writes}=dbHarness({grade:oldGrade});
 await assert.rejects(service({ctx,input:{
   ...input("legacy_review_save_draft").input,
   legacySubmissionId:submittedId,expectedSubmissionVersion:1,
   expectedSnapshotHash:data().hash,onlyIfUngraded:true,draftSource:"internal_ai",
   criteria:[{awardedPoints:19,pendingPoints:0,comment:"Clear evidence"},
     {awardedPoints:19,pendingPoints:0,comment:"Clear evidence"}],
   feedback:"The student has demonstrated the assigned OOP requirements."
 }}),error=>error.code==="failed-precondition");
 assert.equal(map.get("student_grades/"+submittedId).score,32);
 assert.equal(writes.length,0);
});
test("bulk evaluation refuses an outdated frozen hash before a new grade is created",async()=>{
 const {service,writes}=dbHarness();
 await assert.rejects(service({ctx,input:{
   ...input("legacy_review_save_draft").input,
   legacySubmissionId:submittedId,expectedSubmissionVersion:1,
   expectedSnapshotHash:"outdated-digest",onlyIfUngraded:true,
   criteria:[{awardedPoints:18,pendingPoints:0,comment:"Verified"},
     {awardedPoints:18,pendingPoints:0,comment:"Verified"}],
   feedback:"The frozen work was evaluated, but this request is stale."
 }}),error=>error.code==="failed-precondition");
 assert.equal(writes.length,0);
});
