import test from "node:test";
import assert from "node:assert/strict";
import {
  bulkApproveCandidates,bulkReopenCandidates,mayBulkReopen,
  wasResubmittedAfterReopening,currentGradeForEvidence
} from "./bulk-evidence.mjs";

const learners=["alice","bob","cara","dan","eve"].map(id=>({id}));
const evidence=new Map([
  ["alice",{status:"submitted",reopenedAt:"2026-10-26",reopenedBy:"teacher",revision:4,checkpointSha:"a".repeat(40)}],
  ["bob",{status:"reopened",revision:3}],
  ["cara",{status:"approved",approvedCheckpointSha:"c".repeat(40),revision:1}],
  ["dan",{status:"needs_review",source:"teacher_discovered"}],
  ["eve",{status:"withdrawn"}]
]);

test("resubmitted evidence becomes bulk approvable, but reopened evidence stays excluded",()=>{
  assert.deepEqual(bulkApproveCandidates(learners,evidence).map(s=>s.id),["alice","dan"]);
  assert.equal(wasResubmittedAfterReopening(evidence.get("alice")),true);
  assert.equal(wasResubmittedAfterReopening(evidence.get("bob")),false);
  assert.equal(mayBulkReopen(evidence.get("bob")),false);
});

test("section reopening only includes currently reviewable records without published grades",()=>{
  assert.deepEqual(bulkReopenCandidates(learners,evidence,{}).map(s=>s.id),["alice","cara","dan"]);
  assert.deepEqual(bulkReopenCandidates(learners,evidence,{
    cara:{published:true},alice:{published:false}
  }).map(s=>s.id),["alice","dan"]);
});

test("an earlier unpublished grade is no longer ready after reopened evidence changes",()=>{
  const grade={gradedSha:"c".repeat(40),evidenceRevision:1,published:false};
  assert.equal(currentGradeForEvidence(grade,evidence.get("cara")),true);
  assert.equal(currentGradeForEvidence(grade,evidence.get("alice")),false);
  assert.equal(currentGradeForEvidence(grade,{...evidence.get("cara"),revision:2}),false);
  assert.equal(currentGradeForEvidence(grade,{...evidence.get("cara"),status:"reopened"}),false);
});
