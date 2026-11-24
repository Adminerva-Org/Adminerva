import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {HISTORICAL_SOURCE,historicalSubjectMatches,historicalMapping,mappingMatches,projectedGrade,
  resolveHistoricalRoster,historicalPublishedGrades}=require("../functions/school-class-record-historical.js");
const {cleanColumns}=require("../functions/school-class-record.js");
const schoolId="mcs-manila",offeringId="offering-q3",ownerUid="teacher1";
const offering={schoolId,yearId:"year",termId:"q3",sectionId:"section",subjectId:"subject"};
const labels={yearName:"2026-2027",termName:"Quarter 3",sectionName:"Section A",subjectName:"Computer Programming"};
const task={ownerUid,subject:"Computer Programming",deployments:[{section:"Section A"}],maxScore:20};
const args={task,taskId:"legacy-task",schoolId,ownerUid,offering,offeringId,labels};
const mapping=historicalMapping(args);
const row={studentId:"old_student",taskId:"legacy-task",section:"Section A",published:true,score:17,maxScore:20,gradeVersion:3};
const column={columnId:"col1",kind:"assessment",taskId:"legacy-task",assessmentSource:HISTORICAL_SOURCE,
  label:"Historical activity",category:"Performance Task",maxPoints:20,historicalMapping:mapping};
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
