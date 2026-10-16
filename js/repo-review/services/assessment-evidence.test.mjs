import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRepository,normalizeSelection,attributionLabel,claimDocumentId,detectedAuthor} from './assessment-evidence.mjs';
const A='a'.repeat(40),B='b'.repeat(40);
test('canonical GitHub repo URLs reject extra path, credentials and non-GitHub hosts',()=>{
  assert.equal(parseRepository('https://github.com/class/team.git').url,'https://github.com/class/team');
  for(const bad of ['https://evil.example/class/team','https://github.com/class/team/commit/a','https://x:pw@github.com/a/b','https://github.com/a/b?x=1']){
    assert.throws(()=>parseRepository(bad));
  }
});
test('selected commits are independent evidence while one selected SHA pins project state',()=>{
  assert.deepEqual(normalizeSelection([A,B,A],B),{selectedCommits:[A,B],checkpointSha:B});
  assert.throws(()=>normalizeSelection([A],B),/checkpoint/);
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
