import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {commitPagePath,appendUniqueCommits,hasOlderCommitPage,MAX_COMMIT_PAGES} from "./commit-history.mjs";
const A="a".repeat(40),B="b".repeat(40),C="c".repeat(40);
test("GitHub evidence paging is bounded and includes a precise branch for teacher discovery",()=>{
  assert.equal(commitPagePath("/repos/class/team",1),"/repos/class/team/commits?per_page=100&page=1");
  assert.equal(commitPagePath("/repos/class/team",2,{branch:"feature/lesson plan"}),"/repos/class/team/commits?per_page=100&page=2&sha=feature%2Flesson%20plan");
  assert.throws(()=>commitPagePath("/repos/class/team",MAX_COMMIT_PAGES+1),/limit/);
  assert.throws(()=>commitPagePath("/repos/class/team",0));
  assert.equal(hasOlderCommitPage(1,100),true);
  assert.equal(hasOlderCommitPage(1,99),false);
  assert.equal(hasOlderCommitPage(MAX_COMMIT_PAGES,100),false);
});
test("Older GitHub pages keep unique SHAs while preserving previous selection candidates",()=>{
  const first=[{sha:A,commit:{message:"first"}},{sha:B}];
  const second=[{sha:B},{sha:C},{sha:"invalid"}];
  assert.deepEqual(appendUniqueCommits(first,second).map(x=>x.sha),[A,B,C]);
  assert.deepEqual(appendUniqueCommits([],[]),[]);
  assert.throws(()=>appendUniqueCommits({},[]),/invalid/);
});
test("Student and teacher views retain selected evidence while paging",()=>{
  const student=readFileSync("js/student/assessment-evidence.mjs","utf8");
  const teacher=readFileSync("js/repo-review/assessment-evidence-review.mjs","utf8");
  for(const [label,source,button] of [["student",student,"evidenceLoadOlder"],["teacher",teacher,"evidenceFindOlder"]]){
    assert.ok(source.includes('appendUniqueCommits('),label+" deduplicates pagination");
    assert.ok(source.includes('hasOlderCommitPage('),label+" stops at bounded history limit");
    assert.ok(source.includes(button),label+" connects button");
    assert.ok(source.includes("sequence")||source.includes("loadSequence"),label+" guards stale requests");
  }
  assert.match(student,/commits=appendUniqueCommits\(commits,batch\)/);
  assert.match(teacher,/discovery\.commits=appendUniqueCommits\(discovery\.commits,batch\)/);
  const studentHTML=readFileSync("student-assessments.html","utf8");
  const staffHTML=readFileSync("assessment-evidence-review.html","utf8");
  assert.ok(studentHTML.includes('id="evidenceLoadOlder"'));
  assert.ok(staffHTML.includes('id="evidenceFindOlder"'));
});
