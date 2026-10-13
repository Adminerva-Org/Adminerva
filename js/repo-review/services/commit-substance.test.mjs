import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePatchSubstance, analyzeFileContributions } from './commit-substance.mjs';

test('whitespace-only Java recommit is flagged',()=>{
  const r=analyzePatchSubstance('@@ -1 +1 @@\n-public class App{void run(){}}\n+ public class App { void run() { } }','src/App.java');
  assert.equal(r.substantive,false);
  assert.equal(r.kind,'formatting_only');
});
test('comments-only Java recommit is flagged',()=>{
  const r=analyzePatchSubstance('@@ -1,0 +1 @@\n+ // formatting fix only','src/App.java');
  assert.equal(r.substantive,false);
  assert.equal(r.kind,'comments_or_whitespace');
});
test('new implementation is not flagged',()=>{
  const r=analyzePatchSubstance('@@ -1 +1 @@\n-return false;\n+return true;','src/App.java');
  assert.equal(r.substantive,true);
});
test('Python indentation is not assumed irrelevant',()=>{
  const r=analyzePatchSubstance('@@ -1 +1 @@\n+    return 1\n-return 1','src/app.py');
  assert.equal(r.substantive,true);
});
test('missing patch remains unknown',()=>{
  const r=analyzePatchSubstance(null,'src/App.java');
  assert.equal(r.substantive,null);
});
test('file evidence with comment-only edits is low substance',()=>{
  const r=analyzeFileContributions({
    path:'src/App.java',
    patches:[{sha:'abcd',patch:'@@ -1 +1 @@\n-// old comment\n+// new comment'}]
  });
  assert.equal(r.lowSubstance,true);
  assert.deepEqual(r.flaggedShas,['abcd']);
});
test('files with any actual code change remain substantive',()=>{
  const r=analyzeFileContributions({path:'src/App.kt',patches:[
    {sha:'a',patch:'@@ -1 +1 @@\n- //old\n+ // new'},
    {sha:'b',patch:'@@ -1 +1 @@\n-return false\n+return true'},
  ]});
  assert.equal(r.lowSubstance,false);
  assert.deepEqual(r.flaggedShas,['a']);
});
