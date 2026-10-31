/** Regression coverage: Adminerva module: firestore rules. */
import test, {before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertSucceeds, assertFails}
  from '@firebase/rules-unit-testing';
import {doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  collection, getDocs, query, where, writeBatch, Timestamp}
  from 'firebase/firestore';

let env;
const PROJECT = 'demo-adminerva-security';
const EMAIL_A = 'student-a@example.edu';
const EMAIL_B = 'student-b@example.edu';
const TEACHER = 'josephsixson@mcstayuman.edu.ph';
const ADMIN = 'babaynike2013@gmail.com';
const SHA = 'a'.repeat(40);

test('grade revisions match the transaction and remain immutable even to administrators',async()=>{
  const staff=client('staff',TEACHER),admin=client('admin',ADMIN),student=client('alice',EMAIL_A);
  const grade=doc(staff,'student_grades','alice_peta'),audit=doc(staff,'grade_revisions','first-grade');
  const before={studentId:'alice',taskId:'peta',section:'11-A',score:10,feedback:'Original feedback',published:false};
  await assertSucceeds(setDoc(grade,before));
  const after={...before,score:12,feedback:'Reviewed feedback'};
  const revision={gradeId:'alice_peta',studentId:'alice',taskId:'peta',editorUid:'staff',reason:'Teacher reviewed and adjusted this score',before:{score:10,feedback:before.feedback,published:false},after:{score:12,feedback:after.feedback,published:false},createdAt:serverTimestamp()};
  const batch=writeBatch(staff);batch.set(grade,after);batch.set(audit,revision);await assertSucceeds(batch.commit());
  for(const database of [staff,admin,student]){
    await assertFails(updateDoc(doc(database,'grade_revisions','first-grade'),{reason:'Rewritten audit trail'}));
    await assertFails(deleteDoc(doc(database,'grade_revisions','first-grade')));
  }
  const forged=writeBatch(staff);forged.update(grade,{score:15});forged.set(doc(staff,'grade_revisions','forged'),{...revision,editorUid:'admin'});await assertFails(forged.commit());
  await assertFails(setDoc(doc(staff,'grade_revisions','no-grade-change'),{...revision,before:revision.after,after:revision.after}));
  await assertFails(getDoc(doc(student,'grade_revisions','first-grade')));
});
test('broad staff matches cannot create or mutate arbitrary nested academic audit trails',async()=>{
  for(const database of [client('staff',TEACHER),client('admin',ADMIN)])for(const parts of [['students','alice','revisions','forged'],['assessments','peta','audit','forged'],['student_grades','alice_peta','revisions','forged']])await assertFails(setDoc(doc(database,...parts),{reason:'Forged nested audit'}));
  const admin=client('admin',ADMIN),decision=doc(admin,'commit_claim_decisions','immutable-decision');
  await assertFails(setDoc(decision,{reason:'Administrator claim resolution'}));
  await assertFails(updateDoc(decision,{reason:'Replaced decision'}));await assertFails(deleteDoc(decision));
});
test('a directory-only teacher can inspect its own profile but cannot grant itself staff authority',async()=>{
  await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'teachers','directory-only'),{email:'directory.teacher@example.edu',role:'teacher',uid:'directory-only'}));
  const teacher=client('directory-only','directory.teacher@example.edu');
  await assertSucceeds(getDocs(query(collection(teacher,'teachers'),where('email','==','directory.teacher@example.edu'))));
  await assertFails(updateDoc(doc(teacher,'teachers','directory-only'),{role:'admin'}));
  await assertFails(setDoc(doc(teacher,'staff_workspaces','directory-only','preferences','defaults'),{name:'Unauthorized'}));
  await assertFails(setDoc(doc(teacher,'staff_access','directory.teacher@example.edu'),{role:'teacher',status:'active'}));
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {rules: readFileSync('firestore.rules', 'utf8')}
  });
});
after(async () => {if(env) await env.cleanup()});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db=ctx.firestore();
    await Promise.all([
      setDoc(doc(db,'staff_access',TEACHER),{email:TEACHER,role:'teacher',status:'active',sections:['11-A','11-B']}),
      setDoc(doc(db,'students','alice'),{name:'Alice',email:EMAIL_A,section:'11-A'}),
      setDoc(doc(db,'students','bob'),{name:'Bob',email:EMAIL_B,section:'11-B'}),
      setDoc(doc(db,'assessments','peta'),{ownerUid:'staff',sectionIds:['11-A','11-B'],deployments:[],title:'Practical Exam',quarter:'Q2'}),
      setDoc(doc(db,'assessments','v2'),{ownerUid:'staff',sectionIds:['11-A','11-B'],deployments:[],title:'Mini PETA 1',quarter:'Q3',schemaVersion:2,maxScore:20}),
      setDoc(doc(db,'notifications','alice','items','note-1'),{
        title:'Review update',type:'issue',createdAt:new Date(),readAt:null,
        target:'issues.html',body:'Your report is ready.'
      })
    ]);
  });
});
function client(uid,email){return env.authenticatedContext(uid,{email,email_verified:true}).firestore()}
function activityEvent() { return {ownerUid:'alice',studentId:'alice',sessionId:'a'.repeat(36),page:'playground',action:'active-time',activeSeconds:30,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+30*86400000)}; }
function activityPreference(enabled=true) { return {ownerUid:'alice',studentId:'alice',enabled,updatedAt:serverTimestamp()}; }

test('home reminder suppression is private, typed and independent of activity consent',async()=>{
  const alice=client('alice',EMAIL_A),bob=client('bob',EMAIL_B);
  await assertSucceeds(setDoc(doc(alice,'activity_preferences','alice'),{...activityPreference(false),promptDismissed:true}));
  await assertFails(setDoc(doc(alice,'activity_events','hidden-prompt-not-consent'),activityEvent()));
  await assertFails(updateDoc(doc(bob,'activity_preferences','alice'),{promptDismissed:false}));
  await assertFails(setDoc(doc(alice,'activity_preferences','alice'),{...activityPreference(false),promptDismissed:'yes'}));
  await assertSucceeds(setDoc(doc(alice,'activity_preferences','alice'),activityPreference(false)));
});
async function auditedMonitoringControl(db, {actor='admin', changes={}}={}) {
  const ref=doc(db,'monitoring_control','runtime'), current=await getDoc(ref);
  const before=current.exists()?current.data():null;
  const after={cleanupEnabled:false,summaryRefreshEnabled:false,...before,...changes,revision:(before?.revision||0)+1,updatedBy:actor,updatedAt:serverTimestamp(),reason:'School policy and bounded operational budget reviewed.'};
  const batch=writeBatch(db); batch.set(ref,after);
  batch.set(doc(ref,'revisions',String(after.revision)),{before,after,actorUid:actor,reason:after.reason,createdAt:serverTimestamp()});
  return batch.commit();
}
test('automatic monitoring requires verified admin control changes with immutable matching audits',async()=>{
  const admin=client('admin',ADMIN), teacher=client('staff',TEACHER), alice=client('alice',EMAIL_A);
  await assertFails(setDoc(doc(admin,'monitoring_control','runtime'),{cleanupEnabled:true}));
  await assertSucceeds(auditedMonitoringControl(admin,{changes:{cleanupEnabled:true}}));
  await assertSucceeds(auditedMonitoringControl(admin,{changes:{summaryRefreshEnabled:true}}));
  await assertFails(auditedMonitoringControl(admin,{changes:{cleanupEnabled:'true'}}));
  await assertFails(auditedMonitoringControl(admin,{changes:{adminCommands:true}}));
  await assertFails(auditedMonitoringControl(admin,{actor:'staff'}));
  await assertFails(updateDoc(doc(admin,'monitoring_control','runtime'),{cleanupEnabled:false}));
  await assertFails(updateDoc(doc(admin,'monitoring_control','runtime','revisions','1'),{actorUid:'changed'}));
  await assertFails(deleteDoc(doc(admin,'monitoring_control','runtime','revisions','1')));
  await assertFails(deleteDoc(doc(admin,'monitoring_control','runtime')));
  await assertFails(getDoc(doc(teacher,'monitoring_control','runtime')));
  await assertFails(getDoc(doc(alice,'monitoring_control','runtime','revisions','1')));
  await assertFails(setDoc(doc(teacher,'monitoring_control','runtime'),{cleanupEnabled:true}));
  await assertFails(setDoc(doc(admin,'monitoring_status','runtime'),{state:'completed'}));
  await assertFails(getDoc(doc(teacher,'monitoring_status','runtime')));
  await assertFails(getDocs(collection(admin,'monitoring_status')));
});
test('roster changes and expired snapshots revoke teacher engagement access until refreshed',async()=>{
  const teacher=client('staff',TEACHER),admin=client('admin',ADMIN);
  await assertSucceeds(setDoc(doc(admin,'analytics_rosters',TEACHER),{teacherEmail:TEACHER,sections:['11-A'],updatedBy:'admin',updatedAt:serverTimestamp()}));
  const snapshot={teacherEmail:TEACHER,sections:['11-A'],rows:[],windowDays:7,eventLimit:500,publishedBy:'admin',publishedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(admin,'analytics_views',TEACHER),snapshot));
  await assertSucceeds(getDoc(doc(teacher,'analytics_views',TEACHER)));
  await assertSucceeds(updateDoc(doc(admin,'analytics_rosters',TEACHER),{sections:['11-B'],updatedAt:serverTimestamp()}));
  await assertFails(getDoc(doc(teacher,'analytics_views',TEACHER)));
  await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'analytics_views',TEACHER),{...snapshot,sections:['11-B'],publishedAt:Timestamp.fromMillis(Date.now()-31*86400000)}));
  await assertFails(getDoc(doc(teacher,'analytics_views',TEACHER)));
});
test('a student profile reassignment invalidates old activity preferences for new event writes',async()=>{
  const alice=client('alice',EMAIL_A),admin=client('admin',ADMIN);
  await assertSucceeds(setDoc(doc(alice,'activity_preferences','alice'),activityPreference()));
  await assertSucceeds(updateDoc(doc(admin,'students','alice'),{email:EMAIL_B}));
  await assertFails(setDoc(doc(alice,'activity_events','old-owner'),activityEvent()));
});
test('activity requires own informed opt-in; raw records stay admin-only and immutable', async()=>{
  const alice=client('alice',EMAIL_A), teacher=client('staff',TEACHER), admin=client('admin',ADMIN);
  await assertFails(setDoc(doc(alice,'activity_events','missing-consent'),activityEvent()));
  await assertFails(setDoc(doc(alice,'activity_preferences','bob'),activityPreference()));
  await assertFails(setDoc(doc(alice,'activity_preferences','alice'),{...activityPreference(),studentId:'bob'}));
  await assertSucceeds(setDoc(doc(alice,'activity_preferences','alice'),activityPreference()));
  await assertSucceeds(setDoc(doc(alice,'activity_events','valid'),activityEvent()));
  await assertSucceeds(getDoc(doc(admin,'activity_events','valid')));
  await assertFails(getDoc(doc(teacher,'activity_events','valid')));
  await assertFails(getDoc(doc(client('bob',EMAIL_B),'activity_preferences','alice')));
  await assertFails(getDocs(collection(teacher,'activity_preferences')));
  await assertFails(updateDoc(doc(alice,'activity_events','valid'),{activeSeconds:60}));
  await assertFails(updateDoc(doc(admin,'activity_events','valid'),{activeSeconds:60}));
  for (const change of [{password:'secret'}, {activeSeconds:61}, {page:'https://private'}, {ownerUid:'bob'}, {createdAt:Timestamp.now()}, {expiresAt:Timestamp.fromMillis(Date.now()+365*86400000)}]) await assertFails(setDoc(doc(alice,'activity_events','invalid'),{...activityEvent(),...change}));
  await assertSucceeds(setDoc(doc(alice,'activity_preferences','alice'),activityPreference(false)));
  await assertFails(setDoc(doc(alice,'activity_events','stopped'),activityEvent()));
  await assertFails(deleteDoc(doc(teacher,'activity_events','valid')));
  await assertSucceeds(deleteDoc(doc(admin,'activity_events','valid')));
});
test('diagnostic trails cannot leak through teacher reports, spoof owners or carry free text',async()=>{
  const alice=client('alice',EMAIL_A),admin=client('admin',ADMIN),teacher=client('staff',TEACHER);
  const trail={ownerUid:'alice',pages:['playground'],actions:['run'],createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+30*86400000)};
  await assertFails(setDoc(doc(alice,'issue_diagnostics','ticket'),trail));
  await assertSucceeds(setDoc(doc(alice,'issues','ticket'),report()));
  await assertSucceeds(setDoc(doc(alice,'issue_diagnostics','ticket'),trail));
  await assertFails(getDoc(doc(teacher,'issue_diagnostics','ticket')));
  await assertSucceeds(getDoc(doc(admin,'issue_diagnostics','ticket')));
  await assertFails(updateDoc(doc(admin,'issue_diagnostics','ticket'),{pages:['home']}));
  await assertFails(setDoc(doc(client('bob',EMAIL_B),'issue_diagnostics','ticket'),{...trail,ownerUid:'bob'}));
  await assertSucceeds(setDoc(doc(alice,'issues','class'),{...report(),category:'Feature',audience:'teacher',studentId:'alice',section:'11-A'}));
  await assertFails(setDoc(doc(alice,'issue_diagnostics','class'),trail));
  await assertSucceeds(setDoc(doc(alice,'issues','extra'),report()));
  for (const change of [{pages:['password=secret']}, {actions:['typed text']}, {pages:Array(21).fill('home'),actions:Array(21).fill('run')}, {actions:[]}]) await assertFails(setDoc(doc(alice,'issue_diagnostics','extra'),{...trail,...change}));
});
test('teacher summaries and assignments are admin-controlled; teachers cannot access others or raw diagnostics',async()=>{
  const teacher=client('staff',TEACHER), admin=client('admin',ADMIN),alice=client('alice',EMAIL_A);
  const roster={teacherEmail:TEACHER,sections:['11-A'],updatedBy:'admin',updatedAt:serverTimestamp()};
  await assertFails(setDoc(doc(teacher,'analytics_rosters',TEACHER),roster));
  await assertSucceeds(setDoc(doc(admin,'analytics_rosters',TEACHER),roster));
  const summary={teacherEmail:TEACHER,sections:['11-A'],rows:[{studentId:'alice',visits:2,days:2,activeSeconds:60,modules:{playground:60}}],windowDays:7,eventLimit:500,publishedBy:'admin',publishedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(admin,'analytics_views',TEACHER),summary));
  await assertSucceeds(getDoc(doc(teacher,'analytics_views',TEACHER)));
  await assertFails(getDoc(doc(teacher,'analytics_views','other@example.edu')));
  await assertFails(getDoc(doc(alice,'analytics_views',TEACHER)));
  await assertFails(setDoc(doc(teacher,'analytics_views',TEACHER),{...summary,publishedBy:'staff'}));
  await assertFails(setDoc(doc(admin,'analytics_views',TEACHER),{...summary,sections:['11-B']}));
  await assertFails(setDoc(doc(admin,'analytics_views',TEACHER),{...summary,rows:Array(101).fill({})}));
  await assertFails(getDocs(collection(teacher,'analytics_views')));
  await assertFails(getDoc(doc(env.authenticatedContext('unverified',{email:ADMIN,email_verified:false}).firestore(),'activity_events','any')));
});
test('practice class registration requires own roster identity and does not permit self-scoring',async()=>{
  const alice=client('alice',EMAIL_A),bob=client('bob',EMAIL_B);
  const profile={ownerUid:'alice',studentId:'alice',section:'11-A',alias:'Learner One',leaderboardOptIn:true,updatedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(alice,'practice_profiles','alice'),profile));
  await assertFails(setDoc(doc(alice,'practice_profiles','bob'),{...profile,ownerUid:'bob'}));
  await assertFails(updateDoc(doc(alice,'practice_profiles','alice'),{studentId:'bob',section:'11-B'}));
  await assertFails(getDoc(doc(bob,'practice_profiles','alice')));
  await assertFails(setDoc(doc(alice,'practice_scores','alice'),{points:160}));
  await assertFails(setDoc(doc(alice,'practice_boards','alice'),{rows:[]}));
});
test('reviewed practice points require verified staff, exact mission totals and immutable audits',async()=>{
  const teacher=client('staff',TEACHER),alice=client('alice',EMAIL_A),bob=client('bob',EMAIL_B);
  const score={studentId:'alice',section:'11-A',verifiedMissionIds:['j1'],points:10,reviewedBy:'staff',reviewNote:'Reviewed implementation and explanation independently.',revision:1,updatedAt:serverTimestamp()};
  const ref=doc(teacher,'practice_scores','alice');
  await assertFails(setDoc(ref,score));
  const batch=writeBatch(teacher);batch.set(ref,score);batch.set(doc(ref,'revisions','1'),{before:null,after:score,actorUid:'staff',createdAt:serverTimestamp()});await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(alice,'practice_scores','alice')));await assertFails(getDoc(doc(bob,'practice_scores','alice')));
  await assertFails(updateDoc(doc(ref,'revisions','1'),{actorUid:'changed'}));
  await assertFails(updateDoc(ref,{points:999}));
  const before=(await getDoc(ref)).data(),after={...before,verifiedMissionIds:['j1','j2'],points:20,revision:2,updatedAt:serverTimestamp()};
  const revision=writeBatch(teacher);revision.set(ref,after);revision.set(doc(ref,'revisions','2'),{before,after,actorUid:'staff',createdAt:serverTimestamp()});await assertSucceeds(revision.commit());
  await assertFails(deleteDoc(doc(client('admin',ADMIN),'practice_scores','alice','revisions','1')));
  const unverified=env.authenticatedContext('unverified',{email:TEACHER,email_verified:false}).firestore();
  await assertFails(getDoc(doc(unverified,'practice_scores','alice')));
});
test('class snapshots are private to their roster owner and staff cannot target another section',async()=>{
  const teacher=client('staff',TEACHER),alice=client('alice',EMAIL_A),bob=client('bob',EMAIL_B);
  const board={section:'11-A',rows:[{alias:'Learner One',points:10,rank:1}],publishedBy:'staff',publishedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(teacher,'practice_boards','alice'),board));
  await assertFails(setDoc(doc(teacher,'practice_boards','bob'),board));
  await assertSucceeds(getDoc(doc(alice,'practice_boards','alice')));await assertFails(getDoc(doc(bob,'practice_boards','alice')));
});
async function auditedEvidence(db,changes,{actor='alice',reason='Evidence reviewed and updated by owner'}={}){
  const ref=doc(db,'assessment_evidence','alice_v2');
  const before=(await getDoc(ref)).data();
  const revision=(before.revision||0)+1;
  const after={...before,...changes,revision,updatedAt:serverTimestamp()};
  const batch=writeBatch(db);
  batch.set(ref,after);
  batch.set(doc(ref,'revisions',String(revision)),{before,after,actorUid:actor,reason,createdAt:serverTimestamp()});
  return batch.commit();
}
function approval(){return {status:'approved',reviewedBy:'staff',reviewedAt:serverTimestamp(),
  approvedCheckpointSha:SHA,verifiedContributionCommits:[SHA],contributionScope:'Assigned welcome screen; observed implementation by student.',
  verificationNote:'Checked the selected source and individual contributions.'};}

test('legacy approved checkpoints can be reverified only by instructors with immutable audits and no published grade',async()=>{
  const staff=client('staff',TEACHER),alice=client('alice',EMAIL_A);
  const repository='https://github.com/example/project';
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'assessment_evidence','alice_v2'),{
    studentId:'alice',assessmentId:'v2',section:'11-A',repository,selectedCommits:[SHA],checkpointSha:SHA,
    approvedCheckpointSha:SHA,status:'approved',submittedAt:new Date(),updatedAt:new Date()}));
  await assertFails(auditedEvidence(alice,approval(),{actor:'alice'}));
  await assertFails(updateDoc(doc(staff,'assessment_evidence','alice_v2'),approval()));
  await assertFails(auditedEvidence(staff,{...approval(),selectedCommits:['b'.repeat(40)]},{actor:'staff'}));
  await assertFails(auditedEvidence(staff,{...approval(),verifiedContributionCommits:['b'.repeat(40)]},{actor:'staff'}));
  await assertSucceeds(auditedEvidence(staff,approval(),{actor:'staff'}));
  const ref=doc(staff,'assessment_evidence','alice_v2');
  assert.equal((await getDoc(ref)).data().revision,1);
  assert.deepEqual((await getDoc(ref)).data().selectedCommits,[SHA]);
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'student_grades','alice_v2'),{studentId:'alice',section:'11-A',taskId:'v2',published:true,score:18,feedback:'Protected'}));
  await assertFails(auditedEvidence(staff,approval(),{actor:'staff'}));
  await assertFails(deleteDoc(doc(staff,'assessment_evidence','alice_v2','revisions','1')));
});

test('an instructor may release a historical proposal for audited student revision before approval',async()=>{
  const staff=client('staff',TEACHER),alice=client('alice',EMAIL_A),repository='https://github.com/example/project';
  await env.withSecurityRulesDisabled(async ctx=>{
    await updateDoc(doc(ctx.firestore(),'students','alice'),{repoUrl:repository});
    await setDoc(doc(ctx.firestore(),'assessment_evidence','alice_v2'),{
      studentId:'alice',assessmentId:'v2',section:'11-A',repository,selectedCommits:[SHA],checkpointSha:SHA,
      source:'teacher_discovered',status:'needs_review',discoveredBy:'staff',recordedAt:new Date(),updatedAt:new Date()});
  });
  await assertFails(auditedEvidence(alice,{status:'submitted',submittedAt:serverTimestamp()}));
  await assertSucceeds(auditedEvidence(staff,{status:'reopened',approvedCheckpointSha:null,verifiedContributionCommits:[],contributionScope:'',reviewedBy:null,reviewedAt:null,verificationNote:'',
    reopenedBy:'staff',reopenedAt:serverTimestamp(),reopenReason:'Let the student choose their own committed evidence.'},{actor:'staff'}));
  const correctedSha='b'.repeat(40);
  await assertSucceeds(auditedEvidence(alice,{status:'submitted',selectedCommits:[correctedSha],
    checkpointSha:correctedSha,submittedAt:serverTimestamp()}));
  const corrected=(await getDoc(doc(alice,'assessment_evidence','alice_v2'))).data();
  assert.equal(corrected.revision,2);
  assert.deepEqual(corrected.selectedCommits,[correctedSha]);
  assert.equal(corrected.checkpointSha,correctedSha);
});
function report(uid='alice',email=EMAIL_A){
  return {
    title:'Compiler stops working',description:'The editor fails after selecting Run.',
    category:'Bug',audience:'admin',priority:'Medium',images:[],
    reporterUid:uid,reporterEmail:email,reporterRole:'reporter',
    urlContext:'https://example.com/student-playground.html',
    status:'Open',upvotes:[],locked:false,createdAt:serverTimestamp(),
    module:'Playground',reproductionSteps:'Open editor and select Run.',
    expectedBehavior:'Run code',actualBehavior:'Unexpected error',clientContext:'Browser'
  };
}
function submission(studentId='alice',section='11-A'){
  return {
    studentId,section,assessmentId:'peta',submittedByUid:'alice',
    studentName:'Alice',assessmentTitle:'Practical Exam',
    repoUrl:'https://github.com/example/project',
    githubLogin:'alice',sourcePath:'app/src',
    revisionSha:SHA,submittedAt:serverTimestamp()
  };
}

test('students can file reports but cannot spoof reporter identity',async()=>{
  const db=client('alice',EMAIL_A);
  await assertSucceeds(setDoc(doc(db,'issues','a1'),report()));
  await assertFails(setDoc(doc(db,'issues','a2'),report('bob',EMAIL_B)));
  await assertFails(setDoc(doc(db,'issues','a3'),{...report(),reporterRole:'admin'}));
  await assertFails(setDoc(doc(db,'issues','a4'),{...report(),audience:'teacher'}));
  const legacyShape=report();delete legacyShape.audience;
  await assertFails(setDoc(doc(db,'issues','a5'),legacyShape));
});
test('teachers only triage teacher-directed reports; admins can triage bugs',async()=>{
  const db=client('alice',EMAIL_A);
  await assertSucceeds(setDoc(doc(db,'issues','ticket'),report()));
  await assertFails(updateDoc(doc(db,'issues','ticket'),{priority:'Critical'}));
  await assertFails(updateDoc(doc(db,'issues','ticket'),{status:'Resolved'}));
  await assertFails(updateDoc(doc(db,'issues','ticket'),{locked:true}));
  await assertFails(updateDoc(doc(client('staff',TEACHER),'issues','ticket'),{status:'Resolved'}));
  await assertSucceeds(updateDoc(doc(client('admin',ADMIN),'issues','ticket'),{status:'Resolved'}));
  const teacherTicket={...report(),category:'Feature',audience:'teacher',studentId:'alice',section:'11-A'};
  await assertSucceeds(setDoc(doc(db,'issues','class-ticket'),teacherTicket));
  await assertSucceeds(updateDoc(doc(client('staff',TEACHER),'issues','class-ticket'),{status:'In Progress'}));
  await assertFails(updateDoc(doc(client('staff',TEACHER),'issues','class-ticket'),{audience:'admin'}));
});
test('teachers can update assigned reports with server timestamps but cannot triage admin reports',async()=>{
  const alice=client('alice',EMAIL_A),teacher=client('staff',TEACHER);
  await assertSucceeds(setDoc(doc(alice,'issues','assigned'),{
    ...report(),category:'Feature',audience:'teacher',studentId:'alice',section:'11-A'
  }));
  const assigned=doc(teacher,'issues','assigned');
  await assertSucceeds(updateDoc(assigned,{status:'In Progress',updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(assigned,{priority:'High',updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(assigned,{locked:true,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(assigned,{status:"Closed (Won't Fix)",updatedAt:new Date('2020-01-01')}));
  await assertFails(updateDoc(assigned,{reporterUid:'staff',updatedAt:serverTimestamp()}));
  await assertSucceeds(setDoc(doc(alice,'issues','admin-only'),report()));
  await assertFails(updateDoc(doc(teacher,'issues','admin-only'),{status:'Resolved',updatedAt:serverTimestamp()}));
});

test("teachers can reopen their own admin-directed reports without seeing anyone else's",async()=>{
  const teacher=client('staff',TEACHER),alice=client('alice',EMAIL_A);
  await assertSucceeds(setDoc(doc(teacher,'issues','own-admin'),{
    ...report('staff',TEACHER),category:'Access',audience:'admin'
  }));
  await assertSucceeds(setDoc(doc(alice,'issues','other-admin'),report()));
  const mine=await assertSucceeds(getDocs(query(collection(teacher,'issues'),where('reporterUid','==','staff'))));
  assert.equal(mine.size,1);
  await assertSucceeds(getDoc(doc(teacher,'issues','own-admin')));
  await assertFails(getDoc(doc(teacher,'issues','other-admin')));
});

test('recipient filtering is enforced for direct reads, list queries, and comments',async()=>{
  const alice=client('alice',EMAIL_A), bob=client('bob',EMAIL_B);
  const staff=client('teacher',TEACHER), admin=client('admin',ADMIN);
  await assertSucceeds(setDoc(doc(alice,'issues','bug'),report()));
  await assertSucceeds(setDoc(doc(alice,'issues','lesson'),{
    ...report(),category:'Other',audience:'teacher',studentId:'alice',section:'11-A'
  }));
  await assertSucceeds(setDoc(doc(alice,'issues','admin-request'),{
    ...report(),category:'Feature',audience:'admin'
  }));
  await assertFails(getDoc(doc(staff,'issues','bug')));
  await assertFails(getDoc(doc(staff,'issues','admin-request')));
  await assertSucceeds(getDoc(doc(staff,'issues','lesson')));
  await assertFails(getDoc(doc(bob,'issues','lesson')));
  await assertSucceeds(getDoc(doc(alice,'issues','bug')));
  await assertSucceeds(getDoc(doc(admin,'issues','bug')));
  await assertFails(getDocs(collection(staff,'issues')));
  const teacherList=await assertSucceeds(getDocs(query(collection(staff,'issues'),where('audience','==','teacher'),where('section','==','11-A'))));
  assert.equal(teacherList.size,1);
  await assertFails(getDocs(collection(bob,'issues')));
  const ownList=await assertSucceeds(getDocs(query(collection(alice,'issues'),where('reporterUid','==','alice'))));
  assert.equal(ownList.size,3);
  await assertFails(getDoc(doc(staff,'issues','bug','comments','c1')));
  await assertFails(setDoc(doc(staff,'issues','bug','comments','c2'),{
    text:'Not authorized',authorEmail:'',authorUid:'teacher',role:'student',createdAt:serverTimestamp()
  }));
});

test('comments must identify their actual author',async()=>{
  const db=client('alice',EMAIL_A);
  await assertSucceeds(setDoc(doc(db,'issues','ticket'),report()));
  const ref=doc(db,'issues','ticket','comments','comment-1');
  const clean={text:'Steps confirmed.',authorEmail:EMAIL_A,authorUid:'alice',
    role:'student',createdAt:serverTimestamp()};
  await assertSucceeds(setDoc(ref,clean));
  await assertFails(setDoc(doc(db,'issues','ticket','comments','fake'),{...clean,authorUid:'bob'}));
  await assertFails(setDoc(doc(db,'issues','ticket','comments','spoof'),{...clean,role:'superadmin'}));
});
test('notification documents can only be read and marked read by recipients',async()=>{
  const own=doc(client('alice',EMAIL_A),'notifications','alice','items','note-1');
  await assertSucceeds(getDoc(own));
  await assertFails(getDoc(doc(client('bob',EMAIL_B),'notifications','alice','items','note-1')));
  await assertFails(setDoc(doc(client('alice',EMAIL_A),'notifications','alice','items','fake'),{
    title:'Forged notification',type:'grade'
  }));
  await assertFails(updateDoc(own,{title:'New forged title'}));
  await assertSucceeds(updateDoc(own,{readAt:serverTimestamp()}));
});
test('students can submit their own pinned revision, not another section or missing assessment',async()=>{
  const db=client('alice',EMAIL_A);
  await assertSucceeds(setDoc(doc(db,'student_submissions','alice_peta_123'),submission()));
  await assertFails(updateDoc(doc(db,'student_submissions','alice_peta_123'),{sourcePath:'changed'}));
  await assertFails(setDoc(doc(db,'student_submissions','wrong-section'),submission('alice','11-B')));
  await assertFails(setDoc(doc(db,'student_submissions','other-student'),submission('bob','11-B')));
  await assertFails(setDoc(doc(db,'student_submissions','missing-assessment'),
    {...submission(),assessmentId:'not-a-real-task'}));
  await assertSucceeds(getDoc(doc(db,'student_submissions','alice_peta_123')));
  await assertFails(getDoc(doc(client('bob',EMAIL_B),'student_submissions','alice_peta_123')));
});
test('students cannot access draft grades belonging to teachers',async()=>{
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'student_grades','alice_peta'),{
      studentId:'alice',taskId:'peta',section:'11-A',published:false,score:15
    });
  });
  const target=doc(client('alice',EMAIL_A),'student_grades','alice_peta');
  await assertFails(getDoc(target));
  await assertSucceeds(updateDoc(doc(client('staff',TEACHER),'student_grades','alice_peta'),{published:true}));
  await assertSucceeds(getDoc(target));
});


test('private reports need no exposed email and other students cannot read them',async()=>{
  const alice=client('alice',EMAIL_A);
  const ticket=doc(alice,'issues','private-contact');
  await assertSucceeds(setDoc(ticket,{...report(),reporterEmail:''}));
  const ownView=await getDoc(ticket);
  assert.equal(ownView.data().reporterEmail,'');
  assert.equal(ownView.data().reporterUid,'alice');
  await assertFails(getDoc(doc(client('bob',EMAIL_B),'issues','private-contact')));
  await assertFails(getDoc(doc(client('staff',TEACHER),'issues','private-contact')));
  await assertSucceeds(getDoc(doc(client('admin',ADMIN),'issues','private-contact')));
  await assertSucceeds(setDoc(doc(alice,'issues','private-contact','comments','c1'),{
    text:'I can reproduce this.',authorEmail:'',authorUid:'alice',
    role:'student',createdAt:serverTimestamp()
  }));
  await assertFails(setDoc(doc(client('bob',EMAIL_B),'issues','private-contact','comments','fake'),{
    text:'Forged comment',authorEmail:'',authorUid:'alice',
    role:'student',createdAt:serverTimestamp()
  }));
});

test('legacy comments without authorUid remain deletable by original author',async()=>{
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'issues','legacy'),{locked:false,reporterEmail:EMAIL_A});
    await setDoc(doc(ctx.firestore(),'issues','legacy','comments','old'),{
      text:'Previous note',authorEmail:EMAIL_A,role:'student'
    });
  });
  await assertFails(deleteDoc(doc(client('bob',EMAIL_B),'issues','legacy','comments','old')));
  await assertSucceeds(deleteDoc(doc(client('alice',EMAIL_A),'issues','legacy','comments','old')));
});


test('UID upvotes cannot be forged; legacy email votes can be removed',async()=>{
  const alice=client('alice',EMAIL_A), ticket=doc(alice,'issues','vote-test');
  await assertSucceeds(setDoc(ticket,report()));
  await assertSucceeds(updateDoc(ticket,{upvotes:['alice']}));
  await assertFails(updateDoc(ticket,{upvotes:['alice','bob']}));
  await assertSucceeds(updateDoc(ticket,{upvotes:[]}));
  await env.withSecurityRulesDisabled(async ctx=>{
    await updateDoc(doc(ctx.firestore(),'issues','vote-test'),{upvotes:[EMAIL_A]});
  });
  await assertSucceeds(updateDoc(ticket,{upvotes:[]}));
  await assertFails(updateDoc(ticket,{upvotes:[EMAIL_B]}));
});


test('first review submission is creatable without a read preflight; duplicate is immutable',async()=>{
  const db=client('alice',EMAIL_A);
  const receiptRef=doc(db,'student_submissions','alice_peta_'+SHA);
  // No preflight is necessary: Firestore may reject reads of missing records
  // when a read rule checks resource.data.studentId.
  await assertSucceeds(setDoc(receiptRef,submission()));
  await assertSucceeds(getDoc(receiptRef));
  await assertFails(setDoc(receiptRef,{...submission(),sourcePath:'src/changed'}));
  await assertFails(setDoc(receiptRef,{...submission(),sourcePath:'app/src'}));
});


test('V2 evidence is individual, editable while submitted, and cannot self-approve',async()=>{
  const alice=client('alice',EMAIL_A),bob=client('bob',EMAIL_B);
  const record={studentId:'alice',assessmentId:'v2',section:'11-A',
    repository:'https://github.com/example/project',
    selectedCommits:[SHA],checkpointSha:SHA,status:'submitted',
    submittedAt:serverTimestamp(),updatedAt:serverTimestamp()};
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'students','alice'),
    {name:'Alice',email:EMAIL_A,section:'11-A',repoUrl:record.repository}));
  const ref=doc(alice,'assessment_evidence','alice_v2');
  await assertSucceeds(setDoc(ref,record));
  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(bob,'assessment_evidence','alice_v2')));
  await assertFails(setDoc(doc(bob,'assessment_evidence','bob_v2'),record));
  await assertFails(setDoc(doc(alice,'assessment_evidence','alice_peta'),{...record,assessmentId:'peta'}));
  await assertFails(updateDoc(ref,{status:'approved',reviewedBy:'alice'}));
  await assertFails(updateDoc(ref,{repository:'https://github.com/other/repo'}));
  await assertFails(auditedEvidence(alice,{selectedCommits:[SHA,123],submittedAt:serverTimestamp()}));
  await assertFails(auditedEvidence(alice,{selectedCommits:[SHA,'invalid'],submittedAt:serverTimestamp()}));
  await assertFails(auditedEvidence(alice,{selectedCommits:[SHA,SHA],submittedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{selectedCommits:[SHA],checkpointSha:SHA,updatedAt:serverTimestamp()}));
  await assertSucceeds(auditedEvidence(alice,{selectedCommits:[SHA],checkpointSha:SHA,submittedAt:serverTimestamp()}));
});
test('V2 evidence approval is staff-only',async()=>{
  const alice=client('alice',EMAIL_A),staff=client('staff',TEACHER);
  const repository='https://github.com/example/project';
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'students','alice'),
    {name:'Alice',email:EMAIL_A,section:'11-A',repoUrl:repository}));
  const ref=doc(alice,'assessment_evidence','alice_v2');
  await assertSucceeds(setDoc(ref,{studentId:'alice',assessmentId:'v2',section:'11-A',
    repository,selectedCommits:[SHA],checkpointSha:SHA,status:'submitted',
    submittedAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{status:'approved',reviewedBy:'alice'}));
  await assertFails(updateDoc(doc(staff,'assessment_evidence','alice_v2'),approval()));
  await assertSucceeds(auditedEvidence(staff,approval(),{actor:'staff'}));
  await assertFails(updateDoc(ref,{selectedCommits:[SHA],updatedAt:serverTimestamp()}));
});

test('student withdrawal and resubmission preserve immutable audit snapshots',async()=>{
  const alice=client('alice',EMAIL_A),bob=client('bob',EMAIL_B),staff=client('staff',TEACHER);
  const repository='https://github.com/example/project';
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'students','alice'),{email:EMAIL_A,section:'11-A',repoUrl:repository}));
  const ref=doc(alice,'assessment_evidence','alice_v2');
  await assertSucceeds(setDoc(ref,{studentId:'alice',assessmentId:'v2',section:'11-A',repository,
    selectedCommits:[SHA],checkpointSha:SHA,status:'submitted',submittedAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{status:'withdrawn',updatedAt:serverTimestamp()}));
  await assertSucceeds(auditedEvidence(alice,{status:'withdrawn'}));
  const history=doc(ref,'revisions','1');
  const audit=(await assertSucceeds(getDoc(history))).data();
  assert.equal(audit.before.status,'submitted');assert.equal(audit.after.status,'withdrawn');
  await assertFails(getDoc(doc(bob,'assessment_evidence','alice_v2','revisions','1')));
  await assertFails(updateDoc(history,{reason:'Changed the history'}));
  await assertFails(deleteDoc(doc(staff,'assessment_evidence','alice_v2','revisions','1')));
  await assertFails(auditedEvidence(alice,{status:'submitted',submittedAt:new Date('2020-01-01')}));
  await assertSucceeds(auditedEvidence(alice,{status:'submitted',submittedAt:serverTimestamp()}));
  assert.equal((await getDoc(ref)).data().revision,2);
});

test('approved evidence requires instructor reopening; old drafts cannot publish after reapproval',async()=>{
  const alice=client('alice',EMAIL_A),staff=client('staff',TEACHER);
  const repository='https://github.com/example/project';
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'students','alice'),{email:EMAIL_A,section:'11-A',repoUrl:repository});
    await setDoc(doc(ctx.firestore(),'assessment_evidence','alice_v2'),{studentId:'alice',assessmentId:'v2',section:'11-A',repository,
      selectedCommits:[SHA],checkpointSha:SHA,status:'submitted',submittedAt:new Date(),updatedAt:new Date()});
  });
  await assertFails(auditedEvidence(alice,approval()));
  await assertSucceeds(auditedEvidence(staff,approval(),{actor:'staff'}));
  const grade=doc(staff,'student_grades','alice_v2');
  const record={studentId:'alice',section:'11-A',taskId:'v2',gradedSha:SHA,evidenceRevision:1,score:15,maxScore:20,
    feedback:'Verified assigned screen.',teacherReviewNote:'Inspected actual contribution.',reviewedBy:'staff',manuallyAdjusted:true,reviewRequired:false,published:false};
  await assertFails(setDoc(grade,{...record,published:true}));
  await assertFails(setDoc(grade,{...record,evidenceRevision:0}));
  await assertSucceeds(setDoc(grade,record));
  await assertFails(auditedEvidence(alice,{status:'withdrawn'}));
  const reopen={status:'reopened',approvedCheckpointSha:null,verifiedContributionCommits:[],contributionScope:'',reviewedBy:null,reviewedAt:null,verificationNote:'',
    reopenedBy:'staff',reopenedAt:serverTimestamp(),reopenReason:'Permit correction to the individual submission.'};
  await assertFails(auditedEvidence(alice,{...reopen,reopenedBy:'alice'}));
  await assertSucceeds(updateDoc(grade,{published:true}));
  await assertFails(updateDoc(grade,{score:19}));
  await assertFails(auditedEvidence(staff,reopen,{actor:'staff'}));
  await assertSucceeds(updateDoc(grade,{published:false}));
  await assertSucceeds(auditedEvidence(staff,reopen,{actor:'staff'}));
  const reopened=(await getDoc(doc(alice,'assessment_evidence','alice_v2'))).data();
  assert.equal(reopened.reviewedBy,null);
  assert.equal(reopened.reviewedAt,null);
  assert.equal(reopened.verificationNote,'');
  await assertFails(updateDoc(grade,{published:true}));
  await assertSucceeds(auditedEvidence(alice,{status:'submitted',submittedAt:serverTimestamp()}));
  await assertSucceeds(auditedEvidence(staff,approval(),{actor:'staff'}));
  await assertFails(updateDoc(grade,{published:true}));
  await assertSucceeds(updateDoc(grade,{evidenceRevision:4}));
  await assertSucceeds(updateDoc(grade,{published:true}));
  await assertFails(deleteDoc(doc(staff,'assessment_evidence','alice_v2')));
});

test('legacy clean system drafts can be normalized and published but real review flags stay private',async()=>{
  const staff=client('staff',TEACHER);
  const evidence={studentId:'alice',assessmentId:'v2',section:'11-A',repository:'https://github.com/example/project',
    selectedCommits:[SHA],checkpointSha:SHA,approvedCheckpointSha:SHA,status:'approved',reviewedBy:'staff',
    reviewedAt:new Date(),verifiedContributionCommits:[SHA],contributionScope:'Verified contribution.',verificationNote:'Verified.',revision:1};
  const base={studentId:'alice',section:'11-A',taskId:'v2',gradedSha:SHA,evidenceRevision:1,score:18,maxScore:20,
    feedback:'Complete evaluation feedback for the learner.',published:false,reviewRequired:true,manuallyAdjusted:false,
    gradeSource:'system_evaluation_draft',reviewReasons:[],evaluationDraft:{teacherReviewed:false}};
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,'assessment_evidence','alice_v2'),evidence);
    await setDoc(doc(db,'student_grades','alice_v2'),{...base,reviewPriority:'ready_for_teacher_confirmation'});
    await setDoc(doc(db,'student_grades','bob_v2'),{...base,studentId:'bob',section:'11-B',reviewPriority:'needs_review',reviewReasons:['Contribution mismatch']});
    await setDoc(doc(db,'assessment_evidence','bob_v2'),{...evidence,studentId:'bob',section:'11-B'});
  });
  await assertSucceeds(updateDoc(doc(staff,'student_grades','alice_v2'),{
    published:true,reviewRequired:false,reviewPriority:'ready_to_publish'
  }));
  await assertFails(updateDoc(doc(staff,'student_grades','bob_v2'),{
    published:true,reviewRequired:false,reviewPriority:'ready_to_publish'
  }));
});

test('instructors cannot bypass evidence transitions or audit history using catch-all privileges',async()=>{
  const staff=client('staff',TEACHER),admin=client('admin',ADMIN);
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'assessment_evidence','alice_v2'),{
    studentId:'alice',assessmentId:'v2',status:'approved',selectedCommits:[SHA],checkpointSha:SHA,approvedCheckpointSha:SHA}));
  for(const db of [staff,admin]){
    await assertFails(updateDoc(doc(db,'assessment_evidence','alice_v2'),{selectedCommits:['b'.repeat(40)]}));
    await assertFails(deleteDoc(doc(db,'assessment_evidence','alice_v2')));
    await assertFails(setDoc(doc(db,'assessment_evidence','alice_v2','revisions','fake'),{reason:'Forged audit'}));
  }
});

test('unverified staff emails do not grant instructor authority',async()=>{
  for(const email of [TEACHER,ADMIN]){
    const unverified=env.authenticatedContext('unverified',{email,email_verified:false}).firestore();
    await assertFails(setDoc(doc(unverified,'assessment_private','v2'),{rules:['Forged configuration']}));
    await assertFails(setDoc(doc(unverified,'student_grades','alice_v2'),{studentId:'alice',section:'11-A',taskId:'v2',score:20,published:true}));
  }
});

test('twenty selected commits can be submitted, audited and approved within rule limits',async()=>{
  const alice=client('alice',EMAIL_A),staff=client('staff',TEACHER);
  const repository='https://github.com/example/project';
  const selectedCommits=[SHA,...Array.from({length:19},(_,index)=>(index+1).toString(16).padStart(40,'0'))];
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'students','alice'),{email:EMAIL_A,section:'11-A',repoUrl:repository}));
  const record={studentId:'alice',assessmentId:'v2',section:'11-A',repository,selectedCommits,
    checkpointSha:SHA,status:'submitted',submittedAt:serverTimestamp(),updatedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(alice,'assessment_evidence','alice_v2'),record));
  await assertSucceeds(auditedEvidence(alice,{submittedAt:serverTimestamp()}));
  await assertFails(auditedEvidence(alice,{selectedCommits:[...selectedCommits,'b'.repeat(40)],submittedAt:serverTimestamp()}));
  await assertSucceeds(auditedEvidence(staff,approval(),{actor:'staff'}));
});

test('discovered evidence requires verified staff access to both the student and assessment',async()=>{
  const email='limited.teacher@example.edu',repository='https://github.com/example/project';
  const limited=client('limited',email);
  const record={studentId:'alice',assessmentId:'v2',section:'11-A',repository,
    selectedCommits:[SHA],checkpointSha:SHA,status:'needs_review',source:'teacher_discovered',
    discoveredBy:'limited',recordedAt:serverTimestamp(),updatedAt:serverTimestamp()};
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,'staff_access',email),{email,role:'teacher',status:'active',sections:['11-A']});
    await updateDoc(doc(db,'students','alice'),{repoUrl:repository});
    await updateDoc(doc(db,'assessments','v2'),{ownerUid:'other',sectionIds:['11-B']});
  });
  // Student scope alone does not grant assessment scope.
  await assertFails(setDoc(doc(limited,'assessment_evidence','alice_v2'),record));
  await env.withSecurityRulesDisabled(async ctx=>{
    await updateDoc(doc(ctx.firestore(),'assessments','v2'),{ownerUid:'limited',sectionIds:[]});
    await updateDoc(doc(ctx.firestore(),'students','alice'),{section:'11-B'});
  });
  // Assessment ownership does not grant access to another teacher's student.
  await assertFails(setDoc(doc(limited,'assessment_evidence','alice_v2'),{...record,section:'11-B'}));
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'students','alice'),{section:'11-A'}));
  const unverified=env.authenticatedContext('limited',{email,email_verified:false}).firestore();
  for(const db of [unverified,client('alice',EMAIL_A),env.unauthenticatedContext().firestore()]){
    await assertFails(setDoc(doc(db,'assessment_evidence','alice_v2'),record));
  }
  for(const selectedCommits of [[SHA,123],[SHA,'invalid'],[SHA,SHA],Array(21).fill(SHA)]){
    await assertFails(setDoc(doc(limited,'assessment_evidence','alice_v2'),{...record,selectedCommits}));
  }
  await assertSucceeds(setDoc(doc(limited,'assessment_evidence','alice_v2'),record));
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'assessments','v2'),{ownerUid:'other',sectionIds:['11-B']}));
  const approve={...approval(),reviewedBy:'limited'};
  await assertFails(auditedEvidence(limited,approve,{actor:'limited'}));
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'assessments','v2'),{sectionIds:['11-A']}));
  await assertSucceeds(auditedEvidence(limited,approve,{actor:'limited'}));
});

for(const commitCount of [1,20]) test(`student cannot alter discovered evidence until instructor reopening; reopened discovery permits withdrawal and resubmission (${commitCount} commits)`,async()=>{
  const alice=client('alice',EMAIL_A),staff=client('staff',TEACHER);
  const repository='https://github.com/example/project';
  const selectedCommits=[SHA,...Array.from({length:commitCount-1},(_,index)=>(index+1).toString(16).padStart(40,'0'))];
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'students','alice'),{email:EMAIL_A,section:'11-A',repoUrl:repository}));
  await assertSucceeds(setDoc(doc(staff,'assessment_evidence','alice_v2'),{
    studentId:'alice',assessmentId:'v2',section:'11-A',repository,selectedCommits,checkpointSha:SHA,
    status:'needs_review',source:'teacher_discovered',discoveredBy:'staff',recordedAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await assertFails(auditedEvidence(alice,{status:'submitted',submittedAt:serverTimestamp()}));
  await assertSucceeds(auditedEvidence(staff,approval(),{actor:'staff'}));
  await assertSucceeds(auditedEvidence(staff,{status:'reopened',approvedCheckpointSha:null,verifiedContributionCommits:[],contributionScope:'',reviewedBy:null,reviewedAt:null,verificationNote:'',
    reopenedBy:'staff',reopenedAt:serverTimestamp(),reopenReason:'Allow student to correct discovered evidence.'},{actor:'staff'}));
  await assertSucceeds(auditedEvidence(alice,{status:'withdrawn'}));
  const correctedSha='b'.repeat(40);
  const correctedCommits=[...selectedCommits.slice(1),correctedSha];
  await assertSucceeds(auditedEvidence(alice,{status:'submitted',selectedCommits:correctedCommits,
    checkpointSha:correctedSha,submittedAt:serverTimestamp()}));
  const evidence=(await getDoc(doc(alice,'assessment_evidence','alice_v2'))).data();
  assert.equal(evidence.status,'submitted');
  assert.equal(evidence.revision,4);
  assert.deepEqual(evidence.selectedCommits,correctedCommits);
  assert.equal(evidence.checkpointSha,correctedSha);
});
test('reclaim is initially pending, owner-private and can only be withdrawn by claimant',async()=>{
  const alice=client('alice',EMAIL_A),bob=client('bob',EMAIL_B),staff=client('staff',TEACHER);
  const repository='https://github.com/example/project';
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'students','alice'),
    {name:'Alice',email:EMAIL_A,section:'11-A',repoUrl:repository}));
  const ref=doc(alice,'commit_reclaims',SHA+'_alice');
  const claim={studentId:'alice',assessmentId:'v2',section:'11-A',
    repository,sha:SHA,detectedAuthorName:'Old Laptop',
    detectedAuthorLogin:'',explanation:'This was created with my old Git identity.',
    status:'pending',createdAt:serverTimestamp()};
  await assertSucceeds(setDoc(ref,claim));
  await assertFails(getDoc(doc(bob,'commit_reclaims',SHA+'_alice')));
  await assertFails(setDoc(doc(bob,'commit_reclaims',SHA+'_bob'),claim));
  await assertFails(updateDoc(ref,{status:'approved'}));
  await assertSucceeds(getDoc(doc(staff,'commit_reclaims',SHA+'_alice')));
  await assertSucceeds(updateDoc(ref,{status:'withdrawn',withdrawnAt:serverTimestamp()}));
  await assertFails(updateDoc(ref,{status:'pending'}));
  const before=(await getDoc(ref)).data();
  const after={...before,status:'pending',explanation:'Updated explanation after confirming my older laptop Git identity.',
    revision:1,resubmittedAt:serverTimestamp()};
  const unsigned=writeBatch(alice);
  unsigned.set(ref,after);
  await assertFails(unsigned.commit());
  const renewed=writeBatch(alice);
  renewed.set(ref,after);
  renewed.set(doc(ref,'revisions','1'),{before,after,actorUid:'alice',
    reason:after.explanation,createdAt:serverTimestamp()});
  await assertSucceeds(renewed.commit());
  assert.equal((await getDoc(ref)).data().status,'pending');
  await assertFails(updateDoc(doc(ref,'revisions','1'),{reason:'Falsified audit'}));
  await assertFails(deleteDoc(doc(ref,'revisions','1')));
  await assertFails(updateDoc(doc(ref,'revisions','1'),{actorUid:'bob'}));
  await assertFails(updateDoc(ref,{status:'rejected',reviewedBy:'alice'}));

});

test('teacher evidence review may list reclaim claims for an assigned section',async()=>{
  const teacher=client('staff',TEACHER);
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,'commit_reclaims',SHA+'_alice'),{
      studentId:'alice',assessmentId:'v2',section:'11-A',
      repository:'https://github.com/example/project',sha:SHA,
      detectedAuthorName:'Alice',detectedAuthorLogin:'alice',
      explanation:'Teacher review fixture for a section-scoped reclaim query.',
      status:'pending',createdAt:Timestamp.now()
    });
  });
  const result=await assertSucceeds(getDocs(query(collection(teacher,'commit_reclaims'),where('section','==','11-A'))));
  assert.equal(result.size,1);
});

test('instructor-only V2 grading config and admin-only reclaim decisions',async()=>{
  const alice=client('alice',EMAIL_A),teacher=client('staff',TEACHER);
  const admin=client('admin',ADMIN);
  const privateRef=doc(teacher,'assessment_private','v2');
  await assertSucceeds(setDoc(privateRef,{ownerUid:'staff',sectionIds:['11-A','11-B'],systemPersona:'Internal review instructions',
    rules:[{type:'Required',value:'Activity'}]}));
  await assertSucceeds(getDoc(privateRef));
  await assertFails(getDoc(doc(alice,'assessment_private','v2')));
  await assertFails(setDoc(doc(alice,'assessment_private','forged'),{systemPersona:'hijack'}));
  const decision=doc(teacher,'commit_claim_decisions','audit1');
  await assertFails(setDoc(decision,{reason:'false'}));
  await assertFails(setDoc(doc(admin,'commit_claim_decisions','audit1'),
    {reason:'Unpaired decisions are not valid attribution reviews'}));
  await assertFails(getDoc(doc(alice,'commit_claim_decisions','audit1')));
});
test('administrator reclaim decision atomically updates claim and immutable audit; teachers cannot decide',async()=>{
  const repository='https://github.com/example/project';
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'students','alice'),{name:'Alice',email:EMAIL_A,section:'11-A',repoUrl:repository});
    await setDoc(doc(db,'commit_reclaims',SHA+'_alice'),{
      studentId:'alice',assessmentId:'v2',section:'11-A',repository,sha:SHA,
      detectedAuthorName:'Shared device',detectedAuthorLogin:'',
      explanation:'Student states this commit was made using a shared machine.',
      status:'pending',createdAt:Timestamp.now()
    });
  });
  const admin=client('admin',ADMIN),staff=client('staff',TEACHER),alice=client('alice',EMAIL_A);
  const claimId=SHA+'_alice',note='I examined the changed files, identity explanation and supporting classroom work.';
  function decisionBatch(db,actor='admin',decision='approved'){
    const batch=writeBatch(db);
    batch.update(doc(db,'commit_reclaims',claimId),{
      status:decision,reviewedBy:actor,reviewedAt:serverTimestamp(),reviewNote:note
    });
    batch.set(doc(db,'commit_claim_decisions',claimId),{
      claimId,studentId:'alice',repository,sha:SHA,
      decision,reviewerUid:actor,reason:note,createdAt:serverTimestamp()
    });
    return batch.commit();
  }
  await assertFails(updateDoc(doc(admin,'commit_reclaims',claimId),{
    status:'approved',reviewedBy:'admin',reviewedAt:serverTimestamp(),reviewNote:note
  }));
  await assertFails(decisionBatch(staff,'staff'));
  await assertFails(decisionBatch(alice,'alice'));
  await assertSucceeds(decisionBatch(admin));
  assert.equal((await getDoc(doc(admin,'commit_reclaims',claimId))).data().status,'approved');
  const audited=(await getDoc(doc(admin,'commit_claim_decisions',claimId))).data();
  assert.equal(audited.sha,SHA);assert.equal(audited.reviewerUid,'admin');
  await assertFails(updateDoc(doc(admin,'commit_claim_decisions',claimId),{decision:'rejected'}));
  await assertFails(updateDoc(doc(admin,'commit_reclaims',claimId),{status:'rejected'}));
  await assertFails(decisionBatch(admin));
  await assertFails(getDoc(doc(alice,'commit_claim_decisions',claimId)));
});
test('cloud Playground versions are immutable and owner-only',async()=>{
  const alice=client('alice',EMAIL_A),bob=client('bob',EMAIL_B);
  const path='student_playground_workspaces/alice/versions/checkpoint1';
  const work={ownerUid:'alice',lang:'java',files:{'Main.java':'class Main{}'},
    fileOrder:['Main.java'],savedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(alice,path),work));
  await assertSucceeds(getDoc(doc(alice,path)));
  await assertFails(getDoc(doc(bob,path)));
  await assertFails(updateDoc(doc(alice,path),{lang:'python'}));
  await assertFails(setDoc(doc(bob,'student_playground_workspaces/alice/versions/forged'),work));
});
test('shared snapshots require explicit visibility and verified ownership',async()=>{
  const alice=client('alice',EMAIL_A),bob=client('bob',EMAIL_B);
  const path='playground_snapshots/link1';
  const state={ownerUid:'alice',visibility:'link',lang:'java',files:{'Main.java':'class Main{}'},fileOrder:['Main.java']};
  await assertSucceeds(setDoc(doc(alice,path),state));
  await assertSucceeds(getDoc(doc(bob,path)));
  await assertFails(setDoc(doc(bob,'playground_snapshots/spoof'),state));
  await assertSucceeds(setDoc(doc(alice,'playground_snapshots/private'),{...state,visibility:'private'}));
  await assertFails(getDoc(doc(bob,'playground_snapshots/private')));
});

test('student assessment page can query only its own submission receipts',async()=>{
  const alice=client('alice',EMAIL_A),bob=client('bob',EMAIL_B);
  await assertSucceeds(setDoc(doc(alice,'student_submissions','mine_peta'),submission()));
  const own=query(collection(alice,'student_submissions'),where('studentId','==','alice'));
  await assertSucceeds(getDocs(own));
  const other=query(collection(bob,'student_submissions'),where('studentId','==','alice'));
  await assertFails(getDocs(other));
});


test('teacher lesson and presentation history stays inaccessible to students',async()=>{
  const staff=client('staff',TEACHER),alice=client('alice',EMAIL_A);
  const lesson=doc(staff,'staff_workspaces','staff','lesson_plans','schoolyear_grade11_q2');
  const before={ownerUid:'staff',version:1,subject_title:'Subject',weekly_overview:{},grade_level:'Grade 11',school_year:'2026-2027',sessions:[]};
  await assertSucceeds(setDoc(lesson,before));
  const batch=writeBatch(staff);batch.set(lesson,{...before,version:2});batch.set(doc(lesson,'revisions','1'),{...before,archivedRevisionAt:serverTimestamp()});await assertSucceeds(batch.commit());
  await assertFails(getDoc(doc(alice,'staff_workspaces','staff','lesson_plans','schoolyear_grade11_q2')));
  await assertFails(getDoc(doc(alice,'staff_workspaces','staff','lesson_plans','schoolyear_grade11_q2','revisions','1')));
  const presentation=doc(staff,'staff_workspaces','staff','presentations','plan_session0');
  const deck={ownerUid:'staff',deck:[],version:1};await assertSucceeds(setDoc(presentation,deck));
  const slides=writeBatch(staff);slides.set(presentation,{...deck,version:2});slides.set(doc(presentation,'revisions','1'),{...deck,archivedRevisionAt:serverTimestamp()});await assertSucceeds(slides.commit());
  await assertFails(getDoc(doc(alice,'staff_workspaces','staff','presentations','plan_session0','revisions','1')));
  const parent=doc(staff,'teacher_materials','staff','reference_folders','folder');
  await assertSucceeds(setDoc(parent,{name:'Teacher materials',documents:[]}));
  await assertSucceeds(setDoc(doc(staff,'teacher_materials','staff','reference_folders','folder','documents','pdf1'),
    {title:'Chapter 1',text:'Course text'}));
  await assertFails(getDoc(doc(alice,'teacher_materials','staff','reference_folders','folder','documents','pdf1')));
});

test('notification history is private and save-for-later records persist across sessions',async()=>{
  const alice=client('alice',EMAIL_A),bob=client('bob',EMAIL_B);
  const ref=doc(alice,'notification_history','alice','items','n_issue42');
  const record={
    ownerUid:'alice',sourceKey:'issue:42',type:'issue',
    title:'Report update',body:'Revisit this response',target:'issues.html',
    at:1234,savedForLater:true,
    openedAt:serverTimestamp(),lastInteractedAt:serverTimestamp()
  };
  await assertSucceeds(setDoc(ref,record));
  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(bob,'notification_history','alice','items','n_issue42')));
  await assertFails(setDoc(doc(bob,'notification_history','alice','items','fake'),record));
  await assertFails(deleteDoc(ref));
  await assertFails(setDoc(ref,{...record,ownerUid:'bob'}));
});

test('practice completions are student-private and are not school grades',async()=>{
  const alice=client('alice',EMAIL_A),bob=client('bob',EMAIL_B);
  const ref=doc(alice,'student_practice_progress','alice','courses','java');
  const data={ownerUid:'alice',studentId:'alice',courseId:'java',completed:['j1'],
    reflections:{j1:'I traced the variable updates in order.'},
    updatedAt:serverTimestamp()};
  await assertFails(setDoc(ref,data));
  await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'student_practice_progress','alice','courses','java'),data));
  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(bob,'student_practice_progress','alice','courses','java')));
  await assertFails(setDoc(doc(bob,'student_practice_progress','alice','courses','python'),
    {...data,courseId:'python'}));
  await assertFails(setDoc(ref,{...data,courseId:'python'}));
  await assertFails(deleteDoc(ref));
});


test('student profile email ownership requires a verified authentication claim',async()=>{
  const verified=client('alice',EMAIL_A);
  const unverified=env.authenticatedContext('other-uid',{email:EMAIL_A,email_verified:false}).firestore();
  await assertSucceeds(getDoc(doc(verified,'students','alice')));
  await assertFails(getDoc(doc(unverified,'students','alice')));
  await assertFails(updateDoc(doc(unverified,'students','alice'),{githubUsername:'forged-owner'}));
});

test('a versioned activity grade cannot be downgraded to an unaudited legacy record',async()=>{
  const staff=client('staff',TEACHER),ref=doc(staff,'activity_grades','alice_lab');
  const first={
    studentId:'alice',section:'11-A',githubUsername:'alice',activity:'Lab check',
    score:8,maxScore:10,gradedAt:'2026-10-25T10:00:00+08:00',taskId:'peta',
    feedback:'Initial reviewed result',published:false,gradeVersion:1,
    reviewedBy:'staff',reviewNote:'Initial versioned review',updatedAt:serverTimestamp()
  };
  const create=writeBatch(staff);
  create.set(ref,first);
  create.set(doc(ref,'versions','1'),{before:null,after:first,actorUid:'staff',createdAt:serverTimestamp()});
  await assertSucceeds(create.commit());

  const legacy={
    studentId:'alice',section:'11-A',githubUsername:'alice',activity:'Lab check',
    score:9,maxScore:10,gradedAt:'2026-10-25T10:05:00+08:00',taskId:'peta',
    feedback:'Changed without a version',published:false,reviewNote:'Legacy-shaped replacement'
  };
  await assertFails(setDoc(ref,legacy));

  const before=(await getDoc(ref)).data();
  const second={...before,score:9,feedback:'Audited revision',gradeVersion:2,reviewedBy:'staff',
    reviewNote:'Second versioned review',updatedAt:serverTimestamp()};
  const revise=writeBatch(staff);
  revise.set(ref,second);
  revise.set(doc(ref,'versions','2'),{before,after:second,actorUid:'staff',createdAt:serverTimestamp()});
  await assertSucceeds(revise.commit());
});

test('grading alert updates cannot move a known alert into a teacher section',async()=>{
  const limitedEmail='limited.teacher@example.edu';
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'staff_access',limitedEmail),{email:limitedEmail,role:'teacher',status:'active',sections:['11-A']});
    await setDoc(doc(db,'grading_alerts','known-b'),{studentId:'bob',section:'11-B',message:'Existing section B alert'});
  });
  const limited=client('limited-teacher',limitedEmail);
  await assertFails(getDoc(doc(limited,'grading_alerts','known-b')));
  await assertFails(updateDoc(doc(limited,'grading_alerts','known-b'),{
    studentId:'alice',section:'11-A',message:'Cross-section replacement'
  }));

  const own=doc(limited,'grading_alerts','own-a');
  await assertSucceeds(setDoc(own,{studentId:'alice',section:'11-A',message:'Section A alert'}));
  await assertSucceeds(updateDoc(own,{message:'Updated Section A alert'}));
});
