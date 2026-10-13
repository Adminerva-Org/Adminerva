import assert from 'node:assert/strict';
import test from 'node:test';
import { matchPath, classifyFile, attributeCommit, resolveContributions } from './contribution-resolver.mjs';

const gradeRepoFile = 'app/src/test/java/com/example/gradingmadeeasy/quarter2/minipeta3/MainSystemTest.java';
const campusExam = 'app/src/test/java/com/example/campusvoice/quarter2/PracticalExam/FastFoodMenu.java';
const profileLayout = 'app/src/main/res/layout/activity_profile_editor2.xml';
const commit = (sha,id,login,date='2026-10-08T05:27:51Z') => ({sha,author:{id,login},commit:{author:{name:login,email:''},committer:{date}}});
const student = {id:'test_student',githubUserId:323893681,githubUsername:'Belo-mcs',githubAccountVerified:true};
const project = 'pransin-ca/Group-08';

test('exact paths are distinguished from similarly named files', () => {
  assert.equal(matchPath(gradeRepoFile,[gradeRepoFile]), true);
  assert.equal(matchPath('other/MainSystemTest.java',[gradeRepoFile]), false);
});
test('recursive glob matches Android unit-test sources', () => {
  assert.equal(matchPath(gradeRepoFile,['app/src/test/**/*.java']),true);
  assert.equal(matchPath(campusExam,['app/src/test/**/*.java']),true);
  assert.equal(matchPath(profileLayout,['app/src/test/**/*.java']),false);
});
test('folder pattern and case-sensitive path behavior', () => {
  assert.equal(matchPath(campusExam,['app/src/test/java/com/example/campusvoice/quarter2/']),true);
  assert.equal(matchPath(campusExam,['APP/SRC/TEST/**/*.JAVA']),false);
  assert.equal(matchPath(campusExam,['APP/SRC/TEST/**/*.JAVA'],{caseSensitive:false}),true);
});
test('prevent path traversal in source paths',()=> {
  assert.throws(()=>matchPath('../secrets.txt',['*']),/Unsafe/);
});
test('classify Android XML layout as relevant text resource, not image',()=>{
  assert.equal(classifyFile(profileLayout),'android_resource');
  assert.equal(classifyFile('app/src/main/res/drawable/icon.png'),'asset');
});
test('verify by stable GitHub ID even when display name changes',()=>{
  const c=commit('a',323893681,'completely different name');
  assert.equal(attributeCommit(c,student).status,'verified');
});
test('never attribute someone else’s GitHub user ID',()=>{
  assert.equal(attributeCommit(commit('a',319500163,'Belo-mcs'),student).status,'other');
});
test('unverified GitHub names require review',()=>{
  assert.equal(attributeCommit({sha:'a',author:{login:'Belo-mcs'},commit:{author:{}}},{id:'x',githubUsername:'Belo-mcs'}).status,'review');
});
test('ignore other students and resolve only matching changed files',async()=>{
  const result=await resolveContributions({repository:project,student,
    assessment:{id:'layout',targetPaths:['app/src/main/res/layout/*.xml']},
    commits:[commit('5bfc061d67a4',323893681,'Belo-mcs'),commit('abc-other',319500163,'pransin-ca')],historyComplete:true,
    loadCommit:async()=>({parents:[{sha:'parent'}],files:[
      {filename:'app/src/main/res/drawable/a.png',status:'added'},
      {filename:profileLayout,status:'modified',patch:'@@ -1 +1 @@\n-old\n+new'}]})});
  assert.equal(result.status,'resolved');
  assert.equal(result.relevantFiles.length,1);
  assert.equal(result.relevantFiles[0].path,profileLayout);
  assert.deepEqual(result.acceptedCommits.map(x=>x.sha),['5bfc061d67a4']);
});
test('merge commits are not double-counted as independent work',async()=>{
  const result=await resolveContributions({repository:project,student,
    assessment:{id:'layout',targetPaths:['app/src/main/res/layout/*.xml']},
    commits:[commit('merge',323893681,'Belo-mcs')],historyComplete:true,
    loadCommit:async()=>({parents:[{sha:'a'},{sha:'b'}],files:[{filename:profileLayout,patch:'same code as a teammate'}]})});
  assert.equal(result.status,'requires_review');
  assert.equal(result.relevantFiles.length,0);
  assert.equal(result.reviewCommits[0].reason,'merge_commit_requires_parent_aware_review');
});
test('missing textual patches never silently become success',async()=>{
 const result=await resolveContributions({repository:project,student,
   assessment:{id:'layout',targetPaths:['**/*.xml']},historyComplete:true,
   commits:[commit('binary-patch-missing',323893681,'Belo-mcs')],
   loadCommit:async()=>({parents:[{sha:'p'}],files:[{filename:profileLayout,status:'modified'}]})});
 assert.equal(result.status,'requires_review');
 assert.equal(result.relevantFiles[0].missingPatch,true);
});
test('an unproven deadline snapshot triggers review rather than automatic failure',async()=>{
 const result=await resolveContributions({repository:project,student,
   assessment:{id:'time',deadline:'2026-10-08T23:59:59Z',targetPaths:['**/*.xml']},
   historyComplete:true,commits:[commit('a',323893681,'Belo-mcs')],
   loadCommit:async()=>({parents:[{sha:'p'}],files:[{filename:profileLayout,patch:'+one line'}]})});
 assert.equal(result.status,'requires_review');
 assert.match(result.warnings.join(' '),/timestamps do not prove/);
});
test('rename matching works from previous filenames',async()=>{
 const result=await resolveContributions({repository:project,student,
   assessment:{id:'old',targetPaths:['old/ProfileEditor.java']},
   historyComplete:true,commits:[commit('rename',323893681,'Belo-mcs')],
   loadCommit:async()=>({parents:[{sha:'p'}],files:[{filename:'new/ProfileEditor.java',previous_filename:'old/ProfileEditor.java',status:'renamed',patch:'@@ renamed'}]})});
 assert.equal(result.status,'resolved');
 assert.deepEqual(result.relevantFiles[0].previousPaths,['old/ProfileEditor.java']);
});
test('incomplete commit pagination is never marked clean',async()=>{
 const result=await resolveContributions({repository:project,student,
  assessment:{id:'layout',targetPaths:['**/*.xml']},commits:[commit('a',323893681,'Belo-mcs')],
  loadCommit:async()=>({parents:[{sha:'p'}],files:[{filename:profileLayout,patch:'+x'}]})});
 assert.equal(result.status,'requires_review');
 assert.match(result.warnings[0],/pagination/);
});

test('legacy asterisk means entire repository',()=>{
  assert.equal(matchPath(campusExam,['*']),true);
});
test('verified cutoff requires ancestry, not just a SHA string',async()=>{
  const r=await resolveContributions({repository:project,student,
    assessment:{id:'deadline',deadline:'2026-10-08T23:59:59Z',targetPaths:['**/*.xml']},
    commits:[commit('a',323893681,'Belo-mcs')],historyComplete:true,cutoffSnapshotSha:'cutoffSha',
    loadCommit:async()=>({parents:[{sha:'p'}],files:[{filename:profileLayout,patch:'+x'}]})});
  assert.equal(r.status,'requires_review');
});
test('trusted cutoff ancestry excludes newer commits',async()=>{
 const r=await resolveContributions({repository:project,student,
   assessment:{id:'deadline',deadline:'2026-10-08T23:59:59Z',targetPaths:['**/*.xml']},
   commits:[commit('at-cutoff',323893681,'Belo-mcs'),commit('after-cutoff',323893681,'Belo-mcs')],
   historyComplete:true,cutoffSnapshotSha:'trustedSnapshot',verifiedCutoffCommitShas:['at-cutoff'],
   loadCommit:async()=>({parents:[{sha:'p'}],files:[{filename:profileLayout,patch:'+x'}]})});
 assert.equal(r.status,'resolved');
 assert.deepEqual(r.acceptedCommits.map(x=>x.sha),['at-cutoff']);
 assert.ok(r.skipped.some(x=>x.sha==='after-cutoff' && x.reason==='not_in_verified_cutoff_snapshot'));
});
