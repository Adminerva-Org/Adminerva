import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require=createRequire(import.meta.url);
const {
  catalogArchiveDependencySpecs,
  assessmentBlocksOfferingArchive,
  academicPeriodFitsYear
}=require("../functions/school-academics.js");

test("academic catalog archive dependencies protect canonical active relationships",()=>{
  assert.deepEqual(catalogArchiveDependencySpecs("subjects"),[
    ["course_offerings","subjectId","course offering"]
  ]);
  assert.deepEqual(catalogArchiveDependencySpecs("sections"),[
    ["course_offerings","sectionId","course offering"],
    ["student_registrations","sectionId","student registration"],
    ["section_advisers","sectionId","section adviser"]
  ]);
  assert.deepEqual(catalogArchiveDependencySpecs("academic_programs"),[
    ["terms","programId","academic period"],
    ["sections","programId","section"],
    ["course_offerings","programId","course offering"],
    ["student_registrations","programId","student registration"]
  ]);
});

test("class retirement is blocked by an open or future published assessment",()=>{
  const now=1_000_000;
  const future={toMillis:()=>now+60_000},past={toMillis:()=>now-60_000};
  assert.equal(assessmentBlocksOfferingArchive({manualAccessState:"open",published:false,dueAt:past},now),true);
  assert.equal(assessmentBlocksOfferingArchive({manualAccessState:"closed",published:true,dueAt:future,lifecycle:"active"},now),true);
  assert.equal(assessmentBlocksOfferingArchive({manualAccessState:"closed",published:true,dueAt:past,lifecycle:"active"},now),false);
  assert.equal(assessmentBlocksOfferingArchive({manualAccessState:"closed",published:true,dueAt:future,lifecycle:"archived"},now),false);
  assert.equal(assessmentBlocksOfferingArchive({published:false,dueAt:future,lifecycle:"active"},now),false);
});


test("academic periods must remain within their parent school year dates",()=>{
  const year={startDate:"2026-06-01",endDate:"2027-03-31"};
  assert.equal(academicPeriodFitsYear({startDate:"2026-06-01",endDate:"2026-10-31"},year),true);
  assert.equal(academicPeriodFitsYear({startDate:"2026-05-31",endDate:"2026-10-31"},year),false);
  assert.equal(academicPeriodFitsYear({startDate:"2027-01-01",endDate:"2027-04-01"},year),false);
  assert.equal(academicPeriodFitsYear({startDate:null,endDate:null},year),true);
});


test("section adviser lifecycle mutations use the reviewed active assignment revision",()=>{
  const backend=readFileSync(new URL("../functions/school-academics.js",import.meta.url),"utf8");
  const frontend=readFileSync(new URL("../js/school-admin/classes-scheduling.mjs",import.meta.url),"utf8");
  assert.match(backend,/expectedRevision=Number\(input\.expectedRevision\)/);
  assert.match(backend,/currentRevision!==expectedRevision[\s\S]*section adviser changed after you opened this class/);
  assert.match(frontend,/set_section_adviser[\s\S]*expectedRevision:Number\(existing\?\.revision\)\|\|0/);
  assert.match(frontend,/end_section_adviser[\s\S]*expectedRevision:Number\(adviser\.revision\)\|\|1/);
});
