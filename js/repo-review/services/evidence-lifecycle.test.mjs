import test from 'node:test';
import assert from 'node:assert/strict';
import {studentMayChangeEvidence,approvalContribution,assertSameEvidence,gradeMatchesEvidence} from './evidence-lifecycle.mjs';

const checkpoint='a'.repeat(40),other='b'.repeat(40);
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
