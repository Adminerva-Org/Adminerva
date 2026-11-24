import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {HISTORICAL_SOURCE,historicalSubjectMatches,historicalSections,historicalMapping,verifiedHistoricalSectionMapping,mappingMatches,projectedGrade,
  resolveHistoricalRoster,historicalPublishedGrades}=require("../functions/school-class-record-historical.js");
const {cleanColumns,matchesAssessmentTitle,canDiscloseAssessmentSource,legacyRepositoryDeploymentSections,legacyRepositoryMetadataCandidate}=require("../functions/school-class-record.js");
const schoolId="mcs-manila",offeringId="offering-q3",ownerUid="teacher1";
const offering={schoolId,yearId:"year",termId:"q3",sectionId:"section",subjectId:"subject"};
const labels={yearName:"2026-2027",termName:"Quarter 3",sectionName:"Section A",subjectName:"Computer Programming"};
const task={ownerUid,subject:"Computer Programming",deployments:[{section:"Section A"}],maxScore:20};
const args={task,taskId:"legacy-task",schoolId,ownerUid,offering,offeringId,labels};
const mapping=historicalMapping(args);
const row={studentId:"old_student",taskId:"legacy-task",section:"Section A",published:true,score:17,maxScore:20,gradeVersion:3};
const column={columnId:"col1",kind:"assessment",taskId:"legacy-task",assessmentSource:HISTORICAL_SOURCE,
  label:"Historical activity",category:"Performance Task",maxPoints:20,historicalMapping:mapping};
test("earlier assessment title finder recognizes Mini PETA variants without unrelated matches",()=>{
  assert.equal(matchesAssessmentTitle("Mini PETA 1","Mini PETA #1 — UI/XML"),true);
  assert.equal(matchesAssessmentTitle("UI XML","Mini PETA 1: UI / XML"),true);
  assert.equal(matchesAssessmentTitle("Mini PETA 1","Mini PETA 2 — UI/XML"),false);
  assert.equal(matchesAssessmentTitle("UI/XML","Q3 Mini PETA — UI Interaction"),false);
  assert.equal(matchesAssessmentTitle("", "Mini PETA 1"),false);
  assert.equal(matchesAssessmentTitle("@@", "Mini PETA 1"),false);
});
test("earlier assessment source search cannot disclose another teacher or school",()=>{
  const school={schoolId,ownerUid,reviewerUid:"different-reviewer"};
  assert.equal(canDiscloseAssessmentSource("school_assessment",school,schoolId,ownerUid),true);
  assert.equal(canDiscloseAssessmentSource("school_assessment",school,schoolId,"different-reviewer"),true);
  assert.equal(canDiscloseAssessmentSource("school_assessment",school,schoolId,"stranger"),false);
  assert.equal(canDiscloseAssessmentSource("school_assessment",school,"other-school",ownerUid),false);
  assert.equal(canDiscloseAssessmentSource("imported_blueprint",school,schoolId,ownerUid),true);
  assert.equal(canDiscloseAssessmentSource("imported_blueprint",school,schoolId,"different-reviewer"),false);
  assert.equal(canDiscloseAssessmentSource("original_assessment",task,schoolId,ownerUid),true);
  assert.equal(canDiscloseAssessmentSource("original_assessment",task,"other-school",ownerUid),false);
  assert.equal(canDiscloseAssessmentSource("original_assessment",{...task,schoolId:"other-school"},schoolId,ownerUid),false);
  assert.equal(canDiscloseAssessmentSource("original_assessment",task,schoolId,"stranger"),false);
  assert.equal(canDiscloseAssessmentSource("unknown",school,schoolId,ownerUid),false);
});

test("pre-owner Repository Management assessments are diagnosable only with verified original student sections",()=>{
  // The Oct 2026 v1 author saved title/targetSections/createdAt but no
  // ownerUid, subject or maxScore. This source may not be graded or linked.
  const v1={
    title:"Mini PETA #1 — UI/XML",
    targetSections:["11 TechPro - St. Carlo Acutis"],
    type:"Mini PETA"
  };
  const section="11 techpro - st. carlo acutis";
  const verified=new Map([[section,new Set(["person1","person2"])]]);
  const args={task:v1,schoolId,titleQuery:"Mini PETA 1",
    originalSectionPeople:verified,rosterSize:35,currentTeacherUid:ownerUid};
  assert.deepEqual(legacyRepositoryDeploymentSections(v1),["11 TechPro - St. Carlo Acutis"]);
  const match=legacyRepositoryMetadataCandidate(args);
  assert.equal(match.title,v1.title);
  assert.equal(match.maximum,null);
  assert.equal(match.originalOwnerStatus,"owner_not_recorded");
  assert.deepEqual(match.originalSections,["11 TechPro - St. Carlo Acutis"]);
  assert.equal(legacyRepositoryMetadataCandidate({...args,task:{...v1,schoolId:"another-school"}}),null);
  assert.equal(legacyRepositoryMetadataCandidate({...args,titleQuery:"Mini PETA 2"}),null);
  assert.equal(legacyRepositoryMetadataCandidate({...args,task:{...v1,ownerUid}}),null);
  assert.equal(legacyRepositoryMetadataCandidate({...args,task:{...v1,deployments:[],targetSections:[]}}),null,
    "undelivered preparation resources cannot appear in diagnostics");
  assert.equal(legacyRepositoryMetadataCandidate({...args,originalSectionPeople:
    new Map([[section,new Set(["person1"])]])}),null,"one student cannot identify a cohort of 35");
  assert.equal(legacyRepositoryMetadataCandidate({...args,originalSectionPeople:
    new Map([["another section",new Set(["person1","person2"])]])}),null);
  assert.equal(legacyRepositoryMetadataCandidate({...args,task:{...v1,schemaVersion:3}}),null);
});
test("legacy diagnostic never confuses different historical owners with teacher authorization",()=>{
  const legacy={
    title:"Mini PETA 1 — XML",
    deployments:[{section:"11 TechPro - St. Carlo Acutis"}],
    ownerUid:"older_login_uid"
  };
  const section=new Map([["11 techpro - st. carlo acutis",new Set(["p1","p2"])]]);
  const input={task:legacy,schoolId,titleQuery:"Mini PETA 1",
    originalSectionPeople:section,rosterSize:35,currentTeacherUid:ownerUid};
  const found=legacyRepositoryMetadataCandidate(input);
  assert.equal(found.originalOwnerStatus,"different_account");
  assert.equal(found.title,legacy.title);
  assert.equal(found.ownerUid,undefined,"historical owner IDs must never be disclosed in diagnostic summaries");
  assert.equal(found.canGrade,undefined,"candidate metadata is not a grade permission");
  assert.equal(legacyRepositoryMetadataCandidate({...input,schoolId:"another-school"}),null);
  assert.equal(legacyRepositoryMetadataCandidate({...input,task:{...legacy,ownerUid:ownerUid}}),null);
  assert.equal(legacyRepositoryMetadataCandidate({...input,task:{...legacy,deployments:[]}}),null);
});

test("historical link needs the original owner, verified school, section, subject and explicit period",()=>{
  assert.equal(mapping.termId,"q3");
  assert.equal(historicalMapping({...args,schoolId:"school-b"}),null);
  assert.equal(historicalMapping({...args,task:{...task,schoolId:"school-b"}}),null);
  assert.equal(historicalMapping({...args,ownerUid:"other"}),null);
  assert.equal(historicalMapping({...args,labels:{...labels,sectionName:"Section B"}}),null);
  assert.equal(historicalMapping({...args,labels:{...labels,subjectName:"Different subject"}}),null);
  assert.equal(historicalMapping({...args,labels:{...labels,termName:""}}),null);
  assert.equal(mappingMatches(mapping,schoolId,offeringId,{...offering,termId:"q2"}),false);
});
test("historical generic course title maps narrowly to official Computer Programming 1/2",()=>{
  for(const subject of ["Computer Programming","Computer Programming 1","Computer Programming 2","computer programming i"," COMPUTER   PROGRAMMING II "])
    assert.equal(historicalSubjectMatches("Computer Programming",subject),true,subject);
  for(const subject of ["Computer Science","Computer Programming 3","Computer Programming Advanced","Computer Programming 2 Laboratory","Computer Programming 2 / Science",""])
    assert.equal(historicalSubjectMatches("Computer Programming",subject),false,subject);
  assert.equal(historicalSubjectMatches("Computer Programming 1","Computer Programming 2"),false);
  assert.equal(historicalSubjectMatches("Science","Computer Programming 2"),false);
  const officialCourse={...args,labels:{...labels,subjectName:"Computer Programming 2"}};
  assert.ok(historicalMapping(officialCourse),"verified owner/section may use the known legacy catalog alias");
  assert.equal(historicalMapping({...officialCourse,ownerUid:"unrelated-owner"}),null);
  assert.equal(historicalMapping({...officialCourse,schoolId:"unrelated-school"}),null);
  assert.equal(historicalMapping({...officialCourse,labels:{...officialCourse.labels,sectionName:"another section"}}),null);
});

test("the original section is never guessed from a different SIS label",()=>{
  const moved={...task,deployments:[{section:"Original Grade 12 - St. Peter"}]};
  assert.deepEqual(historicalSections(moved),["Original Grade 12 - St. Peter"]);
  assert.equal(historicalMapping({...args,task:moved}),null);
  assert.equal(historicalMapping({...args,task:moved,sourceSectionName:"Original Grade 12 - St. Peter"}),null);
  assert.equal(historicalMapping({...args,task:moved,sourceSectionName:"Another Grade 12",verifiedSection:true}),null);
  const verified=historicalMapping({...args,task:moved,
    sourceSectionName:"Original Grade 12 - St. Peter",verifiedSection:true});
  assert.equal(verified.sectionName,"Original Grade 12 - St. Peter");
  assert.equal(verified.offeringSectionName,"Section A");
});
test("section remapping requires multiple uniquely verified student identities from the original class",async()=>{
  const oldSection="Original Grade 12 - St. Peter";
  const moved={...task,deployments:[{section:oldSection}]};
  const canonicalRoster=[
    {personId:"p1",authUid:"u1",legacyStudentIds:["old1"]},
    {personId:"p2",authUid:"u2",legacyStudentIds:["old2"]},
    {personId:"p3",authUid:"u3",legacyStudentIds:["old3"]},
    {personId:"p4",authUid:"u4",legacyStudentIds:["old4"]},
    {personId:"p5",authUid:"u5",legacyStudentIds:["old5"]},
    {personId:"p6",authUid:"u6",legacyStudentIds:["old6"]}
  ];
  const rows=new Map([["old1",{section:oldSection}],["old2",{section:oldSection}],
    ["old3",{section:"Another Section"}],["old4",{section:"Another Section"}]]);
  const db={doc:path=>({path}),getAll:async(...refs)=>refs.map(ref=>{
    const value=rows.get(ref.path.split("/").at(-1));
    return {exists:Boolean(value),data:()=>value};
  })};
  const input={db,schoolId,roster:canonicalRoster,task:moved,taskId:"legacy-task",ownerUid,
    offering,offeringId,labels,sourceSectionName:oldSection};
  const verified=await verifiedHistoricalSectionMapping(input);
  assert.equal(verified.sectionName,oldSection);
  assert.equal(verified.identityProof,"original_student_section");
  assert.equal(verified.identityVerifiedCount,2);
  rows.delete("old2");
  assert.equal(await verifiedHistoricalSectionMapping(input),null);
  assert.equal(await verifiedHistoricalSectionMapping({...input,schoolId:"foreign-school"}),null);
  assert.equal(await verifiedHistoricalSectionMapping({...input,ownerUid:"different-owner"}),null);
  assert.equal(await verifiedHistoricalSectionMapping({...input,sourceSectionName:"Unknown Section"}),null);
  const ambiguous=[{personId:"p1",authUid:"u1",legacyStudentIds:["old1"]},
    {personId:"p2",authUid:"u2",legacyStudentIds:["old1"]},...canonicalRoster.slice(2)];
  assert.equal(await verifiedHistoricalSectionMapping({...input,roster:ambiguous}),null);
});
test("section-verified historical grades still read only the original publication and section",async()=>{
  const oldSection="Original Grade 12 - St. Peter";
  const original={...task,deployments:[{section:oldSection}]};
  const verified=historicalMapping({...args,task:original,sourceSectionName:oldSection,verifiedSection:true});
  const sourceColumn={...column,historicalMapping:verified};
  const saved=new Map([
    ["assessments/legacy-task",original],
    ["student_grades/old_student_legacy-task",{...row,section:oldSection}]
  ]);
  const db={doc:path=>({path,get:async()=>({exists:saved.has(path),data:()=>saved.get(path)})}),
    getAll:async(...refs)=>Promise.all(refs.map(ref=>ref.get()))};
  const roster=[{personId:"p1",authUid:"u1",legacyStudentIds:["old_student"]}];
  const input={db,schoolId,offering,offeringId,columns:[sourceColumn],roster};
  assert.equal((await historicalPublishedGrades(input))[0].awarded,17);
  saved.set("student_grades/old_student_legacy-task",{...row,section:"Section A"});
  assert.deepEqual(await historicalPublishedGrades(input),[]);
});

test("a different original subject requires explicit teacher attestation AND verified original students",async()=>{
  const original={...task,subject:"Legacy Computer Programming II"};
  const previous={...args,task:original};
  assert.equal(historicalMapping(previous),null,"a mismatched subject cannot auto-link");
  assert.equal(await verifiedHistoricalSectionMapping({
    db:{},schoolId,roster:[],task:original,taskId:"legacy-task",ownerUid,
    offering,offeringId,labels,sourceSectionName:"Section A"}),null);
  const roster=[{personId:"p1",authUid:"u1",legacyStudentIds:["old1"]},
    {personId:"p2",authUid:"u2",legacyStudentIds:["old2"]},
    {personId:"p3",authUid:"u3",legacyStudentIds:["old3"]}];
  const rows=new Map([["old1",{section:"Section A"}],["old2",{section:"Section A"}]]);
  const db={doc:path=>({path}),getAll:async(...refs)=>refs.map(ref=>{
    const data=rows.get(ref.path.split("/").at(-1));
    return {exists:Boolean(data),data:()=>data};
  })};
  const options={db,schoolId,roster,task:original,taskId:"legacy-task",ownerUid,
    offering,offeringId,labels,sourceSectionName:"Section A"};
  assert.equal(await verifiedHistoricalSectionMapping(options),null);
  assert.equal(await verifiedHistoricalSectionMapping({...options,confirmOriginalSubject:"Another Subject"}),null);
  assert.equal(await verifiedHistoricalSectionMapping({...options,ownerUid:"other",confirmOriginalSubject:original.subject}),null);
  assert.equal(await verifiedHistoricalSectionMapping({...options,schoolId:"other-school",confirmOriginalSubject:original.subject}),null);
  const mapped=await verifiedHistoricalSectionMapping({...options,confirmOriginalSubject:original.subject});
  assert.equal(mapped.subjectProof,"teacher_confirmed_original_subject_with_roster");
  assert.equal(mapped.originalSubjectName,original.subject);
  assert.equal(mapped.identityVerifiedCount,2);
  const padded={...original,subject:"  "+original.subject+"  "};
  const paddedMap=await verifiedHistoricalSectionMapping({
    ...options,task:padded,confirmOriginalSubject:original.subject
  });
  assert.equal(paddedMap?.originalSubjectName,original.subject,
    "whitespace in legacy subject labels does not invalidate an explicit exact confirmation");
  rows.delete("old2");
  assert.equal(await verifiedHistoricalSectionMapping({...options,confirmOriginalSubject:original.subject}),null,
    "one student among three is below the minimum verified-person threshold");
});
test("subject-reviewed grades remain restricted to the original source subject, student and publication",async()=>{
  const original={...task,subject:"Legacy Computer Programming II"};
  const mapped={...historicalMapping({...args,task:original,verifiedSubject:true}),
    identityProof:"original_student_section",identityVerifiedCount:2,
    subjectProof:"teacher_confirmed_original_subject_with_roster"};
  const sourceColumn={...column,historicalMapping:mapped};
  const records=new Map([["assessments/legacy-task",original],["student_grades/old_student_legacy-task",row]]);
  const db={doc:path=>({path,get:async()=>({exists:records.has(path),data:()=>records.get(path)})}),
    getAll:async(...refs)=>Promise.all(refs.map(ref=>ref.get()))};
  const roster=[{personId:"p1",authUid:"u1",legacyStudentIds:["old_student"]}];
  const input={db,schoolId,offeringId,offering,columns:[sourceColumn],roster};
  assert.equal((await historicalPublishedGrades(input))[0].awarded,17);
  records.set("assessments/legacy-task",{...original,subject:"Changed after assignment"});
  assert.deepEqual(await historicalPublishedGrades(input),[]);
  records.set("assessments/legacy-task",original);
  records.set("student_grades/old_student_legacy-task",{...row,published:false});
  assert.deepEqual(await historicalPublishedGrades(input),[]);
  records.set("student_grades/old_student_legacy-task",{...row,section:"Foreign Section"});
  assert.deepEqual(await historicalPublishedGrades(input),[]);
  const fakeMapping={...mapped,subjectProof:null};
  records.set("student_grades/old_student_legacy-task",row);
  assert.deepEqual(await historicalPublishedGrades({...input,columns:[{...sourceColumn,historicalMapping:fakeMapping}]}),[]);
});

test("layout stores only server-generated mapping and rejects unconfirmed or duplicate historical links",()=>{
  const available=new Map([[HISTORICAL_SOURCE+":legacy-task",{sourceType:HISTORICAL_SOURCE,taskId:"legacy-task",
    title:"Original task",maxPoints:20,linkable:true,historicalMapping:mapping}]]);
  assert.throws(()=>cleanColumns([column],available),/Confirm the selected academic year/);
  const confirmed={...column,confirmHistoricalOffering:offeringId,historicalMapping:{schoolId:"school-b"}};
  const result=cleanColumns([confirmed],available)[0];
  assert.deepEqual(result.historicalMapping,mapping);
  assert.equal("confirmHistoricalOffering" in result,false);
  assert.throws(()=>cleanColumns([confirmed,{...confirmed,columnId:"col2",assessmentSource:"legacy_personalized"}],available),/same assessment/);
  assert.deepEqual(cleanColumns([{...result,label:"Updated"}],new Map(),[result])[0].historicalMapping,mapping);
});
test("only published original grade rows with exact learner, assessment and section are projected",()=>{
  const query={taskId:"legacy-task",studentId:"old_student",sectionName:"Section A"};
  assert.equal(projectedGrade(row,query).awarded,17);
  assert.equal(projectedGrade({...row,score:0},query).awarded,0);
  for(const patch of [{published:false},{taskId:"another"},{studentId:"another"},{section:"Section B"},{score:null},{score:21},{score:-1}])
    assert.equal(projectedGrade({...row,...patch},query),null);
});
test("ambiguous canonical legacy IDs cannot attach scores to two roster people",async()=>{
  const roster=[{personId:"p1",authUid:"u1",legacyStudentIds:["same","unique"]},
    {personId:"p2",authUid:"u2",legacyStudentIds:["same"]}];
  const mapped=await resolveHistoricalRoster({db:{},schoolId,roster});
  assert.equal(mapped.has("same"),false);
  assert.equal(mapped.get("unique"),"p1");
});
test("original read-through never reads unrelated legacy grades or creates a duplicate grade",async()=>{
  const reads=[],records=new Map([["assessments/legacy-task",task],["student_grades/old_student_legacy-task",row],
    ["student_grades/other_student_legacy-task",{...row,studentId:"other_student",section:"Section B"}]]);
  const db={doc:path=>({path,get:async()=>{reads.push(path);return {exists:records.has(path),data:()=>records.get(path)};}}),
    getAll:async(...refs)=>Promise.all(refs.map(ref=>ref.get()))};
  const roster=[{personId:"person1",authUid:"new_uid",legacyStudentIds:["old_student"]},
    {personId:"person2",authUid:"uid2",legacyStudentIds:["other_student"]}];
  const input={db,schoolId,offeringId,offering,columns:[column],roster};
  const results=await historicalPublishedGrades(input);
  assert.equal(results.length,1);
  assert.equal(results[0].personId,"person1");
  assert.equal(results[0].awarded,17);
  assert.deepEqual(reads,["assessments/legacy-task","student_grades/old_student_legacy-task","student_grades/other_student_legacy-task"]);
  reads.length=0;
  assert.deepEqual(await historicalPublishedGrades({...input,schoolId:"school-b"}),[]);
  assert.deepEqual(await historicalPublishedGrades({...input,offering:{...offering,termId:"q2"}}),[]);
  assert.deepEqual(reads,[]);
  records.set("student_grades/old_student_legacy-task",{...row,published:false});
  assert.deepEqual(await historicalPublishedGrades(input),[]);
});
