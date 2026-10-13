import assert from 'node:assert/strict';
import test from 'node:test';
import { matchPath, classifyFile, attributeCommit, resolveContributions, scopeAssessmentFiles, isGradableSource } from './contribution-resolver.mjs';

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


// Legacy blueprint fallback: only author-linked changes may become evidence.
// Alternative files can get a provisional score, but uncertain work never gets an invented score.
async function inspectFallback(files, patterns=['**/quarter2/practicalexam/**/*.java']) {
  return resolveContributions({
    repository: project, student,
    assessment:{id:'practical_exam',title:'Grade 11 Q2 Practical Exam',
      targetPaths:patterns,expectedExtensions:['java','xml'],investigationFallback:true},
    commits:[commit('my-work',323893681,'Belo-mcs')],historyComplete:true,
    loadCommit:async()=>({parents:[{sha:'parent'}],files})
  });
}
test('ordinary in-scope Java code stays primary even if alternative Kotlin exists',async()=>{
 const result=await inspectFallback([
  {filename:'app/quarter2/practicalexam/Main.java',patch:'@@ +1 @@\n+public class Main { void run(){} }',status:'added'},
  {filename:'other/Practical_Exam.kt',patch:'@@ +1 @@\n+fun run() { println(1) }',status:'added'}
 ],['**/quarter2/practicalexam/**']);
 assert.equal(result.relevantFiles.length,1);
 assert.equal(result.fallback.status,'not_needed');
 assert.deepEqual(result.fallback.selected,[]);
});
test('finds Kotlin implementation saved in differently named folder',async()=>{
 const result=await inspectFallback([
  {filename:'other-folder/Practical_Exam.kt',status:'added',patch:'@@ +1 @@\n+fun main() { println(42) }'}
 ]);
 assert.equal(result.relevantFiles.length,0);
 assert.equal(result.fallback.status,'candidate_found');
 assert.equal(result.status,'requires_review');
 assert.equal(result.fallback.selected[0].unexpectedExtension,true);
 assert.match(result.fallback.selected[0].reasons.join(' '),/Unexpected file type/);
});
test('finds code saved as txt without treating plain explanations as executable work',async()=>{
 const good=await inspectFallback([
  {filename:'other/practical-exam.txt',status:'added',
   patch:'@@ +1 @@\n+public class StudentExam { public static void main(String[] args) {} }'}]);
 assert.equal(good.fallback.status,'candidate_found');
 const prose=await inspectFallback([
  {filename:'other/practical-exam.txt',status:'added',
   patch:'@@ +1 @@\n+I think this is the right answer because it should work.'}]);
 assert.equal(prose.fallback.status,'none');
 assert.equal(prose.fallback.selected.length,0);
});
test('unrelated coding tasks are suggestions, not automatically selected',async()=>{
 const result=await inspectFallback([
  {filename:'other/LoginActivity.kt',status:'added',patch:'@@ +1 @@\n+fun login() { return true }'}
 ]);
 assert.equal(result.fallback.status,'weak_candidates');
 assert.equal(result.fallback.selected.length,0);
 assert.equal(result.fallback.suggestions.length,1);
});
test('other students commits are not searched by the fallback',async()=>{
 let detailsCalls=0;
 const result=await resolveContributions({
  repository:project,student,assessment:{id:'practical_exam',title:'Practical Exam',
    targetPaths:['**/quarter2/practicalexam/**'],investigationFallback:true},
  historyComplete:true,commits:[commit('someone-else',789,'Teammate')],
  loadCommit:async()=>{detailsCalls++;return {parents:[{sha:'parent'}],files:[
    {filename:'other/PracticalExam.kt',patch:'+fun main() { return 0 }'}]}}
 });
 assert.equal(detailsCalls,0);
 assert.equal(result.fallback.selected.length,0);
});
test('too many similarly plausible alternative files require teacher selection',async()=>{
 const files=Array.from({length:16},(_,i)=>({
  filename:'misc/Practical_Exam_'+i+'.kt',
  status:'added',patch:'@@ +1 @@\n+fun exam() { println(1) }'
 }));
 const result=await inspectFallback(files);
 assert.equal(result.fallback.status,'ambiguous');
 assert.equal(result.fallback.selected.length,0);
 assert.equal(result.fallback.overflow,true);
});
test('deleted-only alternative files are not submitted for provisional grading',async()=>{
 const result=await inspectFallback([
  {filename:'other/Practical_Exam.kt',status:'removed',
   patch:'@@ -1 +0,0 @@\n-fun main() { println(1) }'}
 ]);
 assert.equal(result.fallback.selected.length,0);
});
test('missing fallback patches are not promoted to gradable evidence',async()=>{
 const result=await inspectFallback([
  {filename:'other/Practical_Exam.kt',status:'added'}
 ]);
 assert.equal(result.fallback.selected.length,0);
});


test('legacy PETA title scopes quarter folder to its actual task', () => {
  const files = [
    'Quarter2/MiniPeta2/SantosAlyiah_minipeta2.java',
    'Quarter2/MiniPeta3/Runprogram.java',
    'Quarter2/Placeholder.java'
  ].map(path=>({path}));
  const result=scopeAssessmentFiles(files,{title:'Q2 Peta 2',studentName:'Alyiah Kym Santos'});
  assert.deepEqual(result.selected.map(x=>x.path),[files[0].path]);
  assert.equal(result.excluded.length,2);
  assert.equal(result.scoped,true);
});
test('files named for classmates are not automatically credited to a shared uploader', () => {
  const paths=[
    'Quarter2/MiniPeta2/Baltazar_minipeta2.java',
    'Quarter2/MiniPeta2/SantosAlyiah_minipeta2.java',
    'Quarter2/MiniPeta2/SorianoZijan_minipeta2.java'
  ];
  const result=scopeAssessmentFiles(paths.map(path=>({path})),
    {title:'Q2 Peta 2',studentName:'Alyiah Kym Santos'});
  assert.deepEqual(result.selected.map(f=>f.path),[paths[1]]);
  assert.equal(result.excluded.length,2);
  assert.match(result.warnings.join(' '),/individually named/i);
});
test('Q2 Peta 3 title helps find MiniPeta3 even when blueprint expects practicalexam',async()=>{
  const result=await resolveContributions({
    repository:project,student,
    assessment:{id:'q2peta3',title:'Q2 Peta 3',
      targetPaths:['**/quarter2/practicalexam/**'],caseSensitivePaths:false,
      investigationFallback:true},
    historyComplete:true,
    commits:[commit('peta3-change',323893681,'Belo-mcs')],
    loadCommit:async()=>({
      parents:[{sha:'parent'}],
      files:[{filename:'app/src/test/java/com/example/project/Quarter2/MiniPeta3/SantosUserAuthentication.java',
        status:'added',patch:'@@ +1 @@\n+public class SantosUserAuthentication { public boolean verify() { return true; } }'}]
    })
  });
  assert.equal(result.relevantFiles.length,0);
  assert.equal(result.fallback.status,'candidate_found');
  assert.equal(result.fallback.selected.length,1);
  assert.equal(result.status,'requires_review');
});


test('comment-only edits to an existing Java file do not qualify as implementation evidence', async () => {
  const r = await resolveContributions({
    repository: project, student,
    assessment: {id:'comment-only',title:'Practical Exam',targetPaths:['**/*.java'],investigationFallback:true},
    commits:[commit('only-comment',323893681,'Belo-mcs')], historyComplete:true,
    loadCommit:async()=>({parents:[{sha:'base'}],files:[
      {filename:'src/PracticalExam.java',status:'modified',
       patch:'@@ -1 +1 @@\n-// previous note\n+// a new note'}
    ]})
  });
  assert.equal(r.relevantFiles.length,1);
  assert.equal(r.lowSubstanceFiles.length,1);
  assert.equal(r.relevantFiles.some(isGradableSource),false);
  assert.match(r.warnings.join(' '),/whitespace\/comment-only/i);
  assert.equal(r.status,'requires_review');
});
test('substantive implementation from another student is never credited due to a local comment change', async () => {
  const r = await resolveContributions({
    repository: project, student,
    assessment: {id:'comment-only',title:'Practical Exam',targetPaths:['**/*.java']},
    commits:[commit('member-implementation',910000,'Teammate'),commit('local-comment',323893681,'Belo-mcs')],
    historyComplete:true,
    loadCommit:async sha=>({parents:[{sha:'base'}],files:[
      {filename:'src/PracticalExam.java',status:'modified',
       patch:sha==='local-comment'?'@@ -1 +1 @@\n-// old\n+// new':'@@ -1 +1 @@\n-return false;\n+return true;'}
    ]})
  });
  assert.deepEqual(r.acceptedCommits.map(c=>c.sha),['local-comment']);
  assert.equal(r.relevantFiles.some(isGradableSource),false);
});
