/** Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: commit history. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {commitPagePath,appendUniqueCommits,hasOlderCommitPage,MAX_COMMIT_PAGES,resolveSubmissionCheckpoint} from "./commit-history.mjs";
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
  const staffHTML=readFileSync("js/repo-review/evidence-review-view.mjs","utf8");
  assert.ok(studentHTML.includes('id="evidenceLoadOlder"'));
  assert.ok(staffHTML.includes('id="evidenceFindOlder"'));
});

test("reopened submission retains original checkpoint when it contains added commits",async()=>{
  const calls=[];
  const result=await resolveSubmissionCheckpoint({
    selectedCommits:[A,B],checkpointSha:B,latestCheckpointSha:C,
    fetchPage:async(sha,page)=>{calls.push({sha,page});return [{sha:B},{sha:A}];}
  });
  assert.equal(result.ok,true);
  assert.equal(result.advanced,false);
  assert.equal(result.checkpointSha,B);
  assert.deepEqual(calls,[{sha:B,page:1}]);
});

test("reopened submission accepts new commits without withdrawing by verifying a newer checkpoint",async()=>{
  const calls=[];
  const result=await resolveSubmissionCheckpoint({
    selectedCommits:[A,C],checkpointSha:B,latestCheckpointSha:C,
    fetchPage:async(sha,page)=>{
      calls.push({sha,page});
      return sha===B?[{sha:B},{sha:A}]:[{sha:C},{sha:B},{sha:A}];
    }
  });
  assert.equal(result.ok,true);
  assert.equal(result.advanced,true);
  assert.equal(result.checkpointSha,C);
  assert.deepEqual(calls,[{sha:B,page:1},{sha:C,page:1}]);
});

test("checkpoint recovery does not silently include work outside the repository branch",async()=>{
  const D="d".repeat(40);
  const result=await resolveSubmissionCheckpoint({
    selectedCommits:[A,D],checkpointSha:B,latestCheckpointSha:C,
    fetchPage:async sha=>sha===B?[{sha:B},{sha:A}]:[{sha:C},{sha:B},{sha:A}]
  });
  assert.equal(result.ok,false);
  assert.deepEqual(result.missing,[D]);
  assert.equal(result.checkpointSha,B);
});
