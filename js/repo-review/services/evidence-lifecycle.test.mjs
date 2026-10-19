/** Regression coverage: Assessment authoring, repository evidence, individual review and protected grading: evidence lifecycle. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {studentMayChangeEvidence,approvalContribution,assertSameEvidence,gradeMatchesEvidence} from './evidence-lifecycle.mjs';

const checkpoint='a'.repeat(40),other='b'.repeat(40);

test('legacy evidence equality ignores map ordering, not timestamps, fields or selected commits',()=>{
  const opened={status:'submitted',selectedCommits:[checkpoint,other],checkpointSha:other,updatedAt:{seconds:100,nanoseconds:5},nested:{first:1,second:2}};
  const reordered={nested:{second:2,first:1},updatedAt:{nanoseconds:5,seconds:100},checkpointSha:other,selectedCommits:[checkpoint,other],status:'submitted'};
  assert.doesNotThrow(()=>assertSameEvidence(reordered,opened));
  for(const changes of [{status:'withdrawn'},{updatedAt:{seconds:100,nanoseconds:6}},{selectedCommits:[other,checkpoint]},{extra:true}])
    assert.throws(()=>assertSameEvidence({...reordered,...changes},opened),error=>error.code==='evidence-changed');
});
test('student changes require instructor reopening after approval and discovery stays locked',()=>{
  assert.equal(studentMayChangeEvidence(null),true);
  for(const status of ['submitted','withdrawn','reopened'])assert.equal(studentMayChangeEvidence({status}),true);
  for(const status of ['approved','needs_review','rejected'])assert.equal(studentMayChangeEvidence({status}),false);
  assert.equal(studentMayChangeEvidence({status:'submitted',source:'teacher_discovered'}),false);
  assert.equal(studentMayChangeEvidence({status:'reopened',source:'teacher_discovered'}),true);
});
test('checkpoint approval does not automatically verify a contribution',()=>{
  const selection={selectedCommits:[checkpoint],checkpointSha:checkpoint};
  assert.deepEqual(approvalContribution(selection,[],'No contribution verified; instructor will investigate.'),{
    verifiedContributionCommits:[],contributionScope:'No contribution verified; instructor will investigate.'});
  assert.throws(()=>approvalContribution(selection,[other],'Assigned the welcome screen implementation.'),/selected evidence/);
  assert.throws(()=>approvalContribution(selection,[checkpoint],''),/responsibilities/);
});
test('reopening then reapproving the same SHA invalidates the old grade draft',()=>{
  const grade={gradedSha:checkpoint,evidenceRevision:1};
  const approved={status:'approved',approvedCheckpointSha:checkpoint,revision:1};
  assert.equal(gradeMatchesEvidence(grade,approved),true);
  assert.equal(gradeMatchesEvidence(grade,{...approved,status:'reopened'}),false);
  assert.equal(gradeMatchesEvidence(grade,{...approved,revision:4}),false);
  assert.equal(gradeMatchesEvidence({gradedSha:checkpoint},approved),false);
  assert.throws(()=>assertSameEvidence({...approved,revision:4},approved),/changed/);
});
