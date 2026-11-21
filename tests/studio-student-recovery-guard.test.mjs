import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import vm from "node:vm";

const source=readFileSync(new URL("../functions/school-studio-submissions.js",import.meta.url),"utf8");
const SCHOOL="school-one",TASK="assessment-one",OFFERING="course-one",STUDENT="student-one",PERSON="person-one";
const submissionId=uid=>createHash("sha256").update(JSON.stringify([SCHOOL,TASK,uid])).digest("hex");
const files=[{path:"Main.java",content:"class Main { static void main(String[] args) {} }"}];

function harness({locked=false,missing=false,invalidDigest=false,uid=STUDENT}={}){
  const records=new Map();
  const put=(path,value)=>records.set(path,value);
  const subPath="schools/"+SCHOOL+"/studio_submissions/"+submissionId(STUDENT);
  put("platform_schools/"+SCHOOL,{state:"active"});
  put("schools/"+SCHOOL+"/assessments/"+TASK,{
    schoolId:SCHOOL,offeringId:OFFERING,submissionSource:"studio",status:"deployed",
    published:true,manualOpenRequired:true,manualAccessState:locked?"closed":"open",lifecycle:"active"
  });
  for(const [student,person] of [[STUDENT,PERSON],["student-two","person-two"]]){
    put("schools/"+SCHOOL+"/memberships/"+student,{schoolId:SCHOOL,status:"active",roles:["student"],personId:person});
    put("schools/"+SCHOOL+"/people/"+person,{schoolId:SCHOOL,status:"active",kind:"student",authUid:student});
    put("schools/"+SCHOOL+"/enrollments/"+person+"_"+OFFERING,{schoolId:SCHOOL,status:"active",personId:person,offeringId:OFFERING});
  }
  if(!missing){
    put(subPath,{schoolId:SCHOOL,taskId:TASK,offeringId:OFFERING,studentUid:STUDENT,
      personId:PERSON,currentVersion:1,projectId:"assessment-project",status:"submitted",contentDigest:"valid-digest"});
    put(subPath+"/versions/1",{schoolId:SCHOOL,taskId:TASK,offeringId:OFFERING,studentUid:STUDENT,
      personId:PERSON,version:1,projectId:"assessment-project",sourceLanguage:"java",
      files,artifacts:{assessment:{taskId:TASK,provisionedBy:"assessment-launch"}},
      contentDigest:invalidDigest?"tampered":"valid-digest",variantEvaluationNotes:"PRIVATE CHECKER NOTES",
      submittedAt:{toMillis:()=>1000}});
  }
  const ref=path=>({
    path,
    async get(){const data=records.get(path);return {exists:!!data,data:()=>data};},
    collection:segment=>({doc:id=>ref(path+"/"+segment+"/"+id)})
  });
  const db={
    doc:ref,
    collection:path=>({doc:id=>ref(path+"/"+id)})
  };
  class AccessError extends Error{
    constructor(code,message){super(message);this.code=code;}
  }
  const mockedRequire=name=>{
    if(name==="node:crypto")return {createHash};
    if(name==="firebase-admin/firestore")return {FieldValue:{},Timestamp:{}};
    if(name==="./tenant-access.js")return {
      TenantAccessError:AccessError,
      getSchoolContext:async()=>({schoolId:SCHOOL,uid,roles:["student"],platformOverride:false})
    };
    if(name==="./school-academics.js")return {rowKey:(person,offering)=>person+"_"+offering,
      checkId:value=>{if(typeof value!=="string"||!value)throw Error("Invalid ID");return value;}};
    if(name==="./school-studio-projects.js")return {digestProject:()=> "valid-digest",digestSource:()=> "source-digest"};
    if(name==="./school-notifications.js")return {writeSchoolNotification:async()=>{}};
    throw Error("Unexpected dependency "+name);
  };
  const module={exports:{}};
  vm.runInNewContext(source,{module,require:mockedRequire,console,Date,Buffer},{filename:"school-studio-submissions.js"});
  return module.exports.createSchoolStudioSubmissionService({db});
}
const request={data:{action:"my_snapshot",schoolId:SCHOOL,taskId:TASK}};

test("owner can recover only verified source, not private evaluator notes",async()=>{
  const result=await harness()(request);
  assert.equal(result.found,true);
  assert.equal(result.version,1);
  assert.equal(result.projectId,"assessment-project");
  assert.deepEqual(JSON.parse(JSON.stringify(result.files)),files);
  assert.equal(result.variantEvaluationNotes,undefined);
  assert.equal(JSON.stringify(result).includes("PRIVATE CHECKER NOTES"),false);
});
test("another enrolled student cannot read the owner's submitted source",async()=>{
  const result=await harness({uid:"student-two"})(request);
  assert.equal(result.found,false);
  assert.equal(result.files,undefined);
});
test("teacher-close access state denies project recovery",async()=>{
  await assert.rejects(harness({locked:true})(request),/teacher must open/i);
});
test("tampered frozen source is not returned",async()=>{
  await assert.rejects(harness({invalidDigest:true})(request),/could not be verified/i);
});
test("missing submission does not fabricate a recovery source",async()=>{
  const result=await harness({missing:true})(request);
  assert.equal(result.found,false);
});
