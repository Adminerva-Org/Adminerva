import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {custodyId,custodyRef,validCustody,authorizedTeacherCustody,originalSections,custodySourceDigest}=
  require("../functions/school-legacy-custody.js");
const {rowKey}=require("../functions/school-academics.js");
const {historicalMapping,mappingMatches,historicalPublishedGrades}=require("../functions/school-class-record-historical.js");
const schoolId="mcs-manila",assessmentId="legacy-ui-xml",offeringId="grade11-programming",
  teacherUid="original-teacher",adminUid="school-admin",oldOwner="historical-custodian";
const task={title:"Mini PETA 1 — UI/XML",ownerUid:oldOwner,maxScore:20,subject:"Computer Programming",
  ownershipBasis:"legacy-administrator-custody-not-original-author",
  deployments:[{section:"St. Carlo Acutis"}]};
const grant={schoolId,assessmentId,offeringId,teacherUid,
  originalOwnerUid:oldOwner,originalTitle:task.title,originalSubject:task.subject,
  originalMaxScore:20,originalSection:"St. Carlo Acutis",sourceDigest:custodySourceDigest(task),
  verifiedLegacyStudentIds:["legacy-one","legacy-two"],status:"active",
  reviewedBySchoolAdminUid:adminUid,reviewReason:"Teacher and original cohort verified"};
const prefix="schools/"+schoolId+"/";
const docs=new Map([
  [prefix+"legacy_assessment_custody/"+custodyId(assessmentId,offeringId),grant],
  [prefix+"staff_assignments/"+rowKey(teacherUid,offeringId),
    {schoolId,teacherUid,offeringId,status:"active"}],
  [prefix+"course_offerings/"+offeringId,{schoolId,status:"active",primaryTeacherUid:teacherUid}],
  [prefix+"memberships/"+teacherUid,{schoolId,status:"active",roles:["teacher"]}]
]);
const db={doc:path=>({path,get:async()=>({exists:docs.has(path),data:()=>docs.get(path),
  ref:{path}})})};
test("historical custody is deterministic and restricted to the original pilot school",()=>{
  assert.equal(custodyId(assessmentId,offeringId),custodyId(assessmentId,offeringId));
  assert.notEqual(custodyId(assessmentId,offeringId),custodyId(assessmentId,"different-class"));
  assert.equal(custodyRef(db,schoolId,assessmentId,offeringId).path,
    prefix+"legacy_assessment_custody/"+custodyId(assessmentId,offeringId));
  assert.throws(()=>custodyRef(db,"other-school",assessmentId,offeringId));
  assert.deepEqual(originalSections({...task,targetSections:["St. Carlo Acutis"]}),["St. Carlo Acutis"]);
});
test("school custody must be explicitly approved and preserve unchanged original source metadata",()=>{
  const args={schoolId,assessmentId,offeringId,teacherUid,task,section:grant.originalSection};
  assert.equal(validCustody(grant,args),true);
  assert.equal(validCustody(grant,{...args,task:{...task,evalCriteria:"Changed source rubric"}}),false);
  assert.equal(validCustody({...grant,sourceDigest:"f".repeat(64)},args),false);
  assert.equal(validCustody(grant,{...args,task:{...task,ownershipBasis:""}}),false,
    "an ordinary private teacher-created assessment can never be delegated administratively");
  for(const [key,val] of [
    ["status","revoked"],["schoolId","other-school"],["teacherUid","another-teacher"],
    ["originalOwnerUid","different-owner"],["originalTitle","Different task"],
    ["originalMaxScore",25],["originalSubject","Other course"],
    ["originalSection","Other section"],["reviewedBySchoolAdminUid",teacherUid]
  ])assert.equal(validCustody({...grant,[key]:val},args),false,key+" must not be accepted");
  assert.equal(validCustody({...grant,verifiedLegacyStudentIds:["legacy-one","legacy-one"]},args),false);
  assert.equal(validCustody({...grant,verifiedLegacyStudentIds:[]},args),false);
  assert.equal(validCustody(grant,{...args,section:"St. Philip the Apostle"}),false);
});
test("delegated V4 Review & Grade requires an active school teacher appointment and membership",async()=>{
  const opts={db,schoolId,teacherUid,assessmentId,offeringId,task};
  const access=await authorizedTeacherCustody(opts);
  assert.equal(access.grant.verifiedLegacyStudentIds.length,2);
  assert.equal(await authorizedTeacherCustody({...opts,schoolId:"other-school"}).catch(()=>null),null);
  assert.equal(await authorizedTeacherCustody({...opts,teacherUid:"stranger"}),null);
  const key=prefix+"staff_assignments/"+rowKey(teacherUid,offeringId);
  docs.set(key,{...docs.get(key),status:"archived"});
  assert.equal(await authorizedTeacherCustody(opts),null);
  docs.set(key,{schoolId,teacherUid,offeringId,status:"active"});
});
test("custody review requires the current explicit Primary Teacher even if the former lead is still assigned",async()=>{
  const opts={db,schoolId,teacherUid,assessmentId,offeringId,task};
  const key=prefix+"course_offerings/"+offeringId;
  const original=docs.get(key);
  try {
    assert.ok(await authorizedTeacherCustody(opts));
    docs.set(key,{...original,primaryTeacherUid:"new-primary"});
    assert.equal(await authorizedTeacherCustody(opts),null);
    docs.set(key,{...original,primaryTeacherUid:""});
    assert.equal(await authorizedTeacherCustody(opts),null);
  } finally { docs.set(key,original); }
});
test("Class Record historical linkage cannot be forged from another original owner",()=>{
  const offering={yearId:"year",termId:"q3",sectionId:"section",subjectId:"course"};
  const labels={yearName:"AY 2026",termName:"Q3",sectionName:"St. Carlo Acutis",
    subjectName:"Computer Programming 1"};
  const args={task,taskId:assessmentId,schoolId,ownerUid:teacherUid,offering,offeringId,labels,
    sourceSectionName:"St. Carlo Acutis",verifiedSection:true,verifiedSubject:true};
  assert.equal(historicalMapping(args),null);
  const mapping=historicalMapping({...args,custodyGrant:grant});
  assert.equal(mapping.ownerUid,teacherUid);
  assert.equal(mapping.originalOwnerUid,undefined,"custodian UID is not exposed through Class Record");
  assert.equal(mapping.custodyGrantId,custodyId(assessmentId,offeringId));
  assert.equal(mappingMatches(mapping,schoolId,offeringId,offering),true);
  assert.equal(historicalMapping({...args,custodyGrant:{...grant,status:"revoked"}}),null);
  assert.equal(historicalMapping({...args,custodyGrant:{...grant,originalSection:"Another section"}}),null);
});

test("original historical grades project only from an active custody grant and verified student identity",async()=>{
 const offering={yearId:"year",termId:"q3",sectionId:"section",subjectId:"course"};
 const labels={yearName:"AY 2026",termName:"Q3",sectionName:"St. Carlo Acutis",
   subjectName:"Computer Programming 1"};
 const mapping=historicalMapping({task,taskId:assessmentId,schoolId,ownerUid:teacherUid,
   offering,offeringId,labels,sourceSectionName:"St. Carlo Acutis",
   verifiedSection:true,custodyGrant:grant});
 const columns=[{kind:"assessment",assessmentSource:"legacy_historical",columnId:"mp1",
   taskId:assessmentId,historicalMapping:mapping,maxPoints:20}];
 const roster=[{personId:"person-one",authUid:"auth-one",legacyStudentIds:["legacy-one"]}];
 const saved=new Map([
   ["assessments/"+assessmentId,task],
   [prefix+"legacy_assessment_custody/"+custodyId(assessmentId,offeringId),grant],
   ["student_grades/legacy-one_"+assessmentId,{taskId:assessmentId,studentId:"legacy-one",
     section:"St. Carlo Acutis",score:17,maxScore:20,published:true}]
 ]);
 const dataSource={
   doc:path=>({path,get:async()=>({exists:saved.has(path),data:()=>saved.get(path)})}),
   getAll:async(...refs)=>refs.map(ref=>({
     exists:saved.has(ref.path),data:()=>saved.get(ref.path)
   }))
 };
 const args={db:dataSource,schoolId,offeringId,offering,columns,roster};
 const published=await historicalPublishedGrades(args);
 assert.equal(published.length,1);
 assert.equal(published[0].awarded,17);
 assert.equal(published[0].personId,"person-one");
 saved.set(prefix+"legacy_assessment_custody/"+custodyId(assessmentId,offeringId),
   {...grant,status:"revoked"});
 assert.deepEqual(await historicalPublishedGrades(args),[],
   "a revoked grant can never continue projecting original grades");
 saved.set(prefix+"legacy_assessment_custody/"+custodyId(assessmentId,offeringId),grant);
 saved.set("student_grades/legacy-one_"+assessmentId,{
   taskId:assessmentId,studentId:"legacy-one",section:"Another section",
   score:17,maxScore:20,published:true
 });
 assert.deepEqual(await historicalPublishedGrades(args),[],
   "a different original student section cannot be used to populate this class");
});


test("sectionless original assessment projects only independently approved exact student identities",async()=>{
 const source={...task,deployments:[],subject:""};
 const scoped={...grant,originalSubject:"",originalSection:"",sectionProof:"assessment_student_identity",
   verifiedPersonCount:2,sourceDigest:custodySourceDigest(source)};
 const offering={yearId:"year",termId:"q3",sectionId:"section",subjectId:"course"};
 const labels={yearName:"AY 2026",termName:"Q3",sectionName:"Current SIS class",subjectName:"Computer Programming 4"};
 const args={task:source,taskId:assessmentId,schoolId,ownerUid:teacherUid,offering,offeringId,labels,
   verifiedSection:true,custodyGrant:scoped};
 assert.equal(historicalMapping({...args,custodyGrant:null}),null);
 assert.equal(validCustody(scoped,{schoolId,assessmentId,offeringId,teacherUid,task:source}),true);
 assert.equal(validCustody(scoped,{schoolId,assessmentId,offeringId,teacherUid,task:{...source,targetSections:["Old class"]}}),false);
 const mapping=historicalMapping(args);
 assert.equal(mapping.sectionProof,"assessment_student_identity");
 const columns=[{kind:"assessment",assessmentSource:"legacy_historical",columnId:"mp1",
   taskId:assessmentId,historicalMapping:mapping,maxPoints:20}];
 const roster=[{personId:"p1",authUid:"auth1",legacyStudentIds:["legacy-one"]},{personId:"p3",authUid:"auth3",legacyStudentIds:["legacy-three"]}];
 const saved=new Map([
   ["assessments/"+assessmentId,source],
   [prefix+"legacy_assessment_custody/"+custodyId(assessmentId,offeringId),scoped],
   ["student_grades/legacy-one_"+assessmentId,{taskId:assessmentId,studentId:"legacy-one",score:17,maxScore:20,published:false}],
   ["student_grades/legacy-three_"+assessmentId,{taskId:assessmentId,studentId:"legacy-three",score:20,maxScore:20,published:true}]
 ]);
 const db={doc:path=>({path,get:async()=>({exists:saved.has(path),data:()=>saved.get(path)})}),
   getAll:async(...refs)=>refs.map(ref=>({exists:saved.has(ref.path),data:()=>saved.get(ref.path)}))};
 const input={db,schoolId,offeringId,offering,columns,roster};
 assert.deepEqual(await historicalPublishedGrades(input),[]);
 const grades=await historicalPublishedGrades({...input,acceptSavedLegacy:true});
 assert.equal(grades.length,1);assert.equal(grades[0].personId,"p1");assert.equal(grades[0].awarded,17);
 assert.equal(grades[0].legacyAccepted,true);
});
