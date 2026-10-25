/** Regression coverage: Committed-evidence selection, checkpoint provenance and evidence lifecycle. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRepository,normalizeSelection,evidenceSelectionGuidance,attributionLabel,claimDocumentId,detectedAuthor} from './assessment-evidence.mjs';
const A='a'.repeat(40),B='b'.repeat(40);
test('canonical GitHub repo URLs reject extra path, credentials and non-GitHub hosts',()=>{
  assert.equal(parseRepository('https://github.com/class/team.git').url,'https://github.com/class/team');
  for(const bad of ['https://evil.example/class/team','https://github.com/class/team/commit/a','https://x:pw@github.com/a/b','https://github.com/a/b?x=1']){
    assert.throws(()=>parseRepository(bad));
  }
});
test('selected evidence and the project checkpoint are independent validated revisions',()=>{
  assert.deepEqual(normalizeSelection([A,B,A],B),{selectedCommits:[A,B],checkpointSha:B});
  assert.deepEqual(normalizeSelection([A],B),{selectedCommits:[A],checkpointSha:B});
  assert.throws(()=>normalizeSelection([A],'bad'),/checkpoint/);
  assert.throws(()=>normalizeSelection([],A),/at least one/);
  assert.throws(()=>normalizeSelection(['bad'],A),/SHA/);
  assert.throws(()=>normalizeSelection(Array(21).fill(A),A),/at most/);
});
test('Git identity is detected but not treated as verified ownership',()=>{
  const c={author:{login:'someone'},commit:{author:{name:'Old Laptop',email:'old@example.com'}}};
  assert.match(attributionLabel(c,'student'),/Reclaim/);
  assert.match(attributionLabel(c,'someone'),/staff verification/);
  assert.equal(detectedAuthor(c).name,'Old Laptop');
  assert.equal(claimDocumentId(A,'alice'),A+'_alice');
});

test('evidence selection provides actionable checkpoint guidance',()=>{
  let state=evidenceSelectionGuidance([], '');
  assert.equal(state.ready,false);
  assert.match(state.message,/Include commit/i);
  state=evidenceSelectionGuidance([A], '');
  assert.equal(state.ready,false);
  assert.match(state.message,/Choose a project checkpoint from the repository/i);
  state=evidenceSelectionGuidance([A], B);
  assert.equal(state.ready,true);
  assert.match(state.message,/verify that the checkpoint contains all selected evidence/i);
  state=evidenceSelectionGuidance([A,B], B);
  assert.equal(state.ready,true);
  assert.match(state.message,/Project checkpoint: b{12}/);
  state=evidenceSelectionGuidance([A,A], A);
  assert.equal(state.ready,true);
  assert.match(state.message,/1 evidence commit selected/);
});
test('evidence selection flags more than 20 distinct commits',()=>{
  const many=Array.from({length:21},(_,i)=>String(i).padStart(40,'0'));
  const state=evidenceSelectionGuidance(many,many[0]);
  assert.equal(state.ready,false);
  assert.match(state.message,/no more than 20/i);
});
