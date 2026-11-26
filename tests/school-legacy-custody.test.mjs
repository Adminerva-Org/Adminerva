import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {custodyId,custodyRef,validCustody,authorizedTeacherCustody,originalSections}=
  require("../functions/school-legacy-custody.js");
const {rowKey}=require("../functions/school-academics.js");
const {historicalMapping,mappingMatches}=require("../functions/school-class-record-historical.js");
const schoolId="mcs-manila",assessmentId="legacy-ui-xml",offeringId="grade11-programming",
  teacherUid="original-teacher",adminUid="school-admin",oldOwner="historical-custodian";
const task={title:"Mini PETA 1 — UI/XML",ownerUid:oldOwner,maxScore:20,subject:"Computer Programming",
  ownershipBasis:"legacy-administrator-custody-not-original-author",
  deployments:[{section:"St. Carlo Acutis"}]};
const grant={schoolId,assessmentId,offeringId,teacherUid,
  originalOwnerUid:oldOwner,originalTitle:task.title,originalSubject:task.subject,
  originalMaxScore:20,originalSection:"St. Carlo Acutis",
  verifiedLegacyStudentIds:["legacy-one","legacy-two"],status:"active",
  reviewedBySchoolAdminUid:adminUid,reviewReason:"Teacher and original cohort verified"};
const prefix="schools/"+schoolId+"/";
const docs=new Map([
  [prefix+"legacy_assessment_custody/"+custodyId(assessmentId,offeringId),grant],
  [prefix+"staff_assignments/"+rowKey(teacherUid,offeringId),
    {schoolId,teacherUid,offeringId,status:"active"}],
  [prefix+"course_offerings/"+offeringId,{schoolId,status:"active"}],
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
