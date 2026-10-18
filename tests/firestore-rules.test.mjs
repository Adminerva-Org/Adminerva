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
      setDoc(doc(db,'students','alice'),{name:'Alice',email:EMAIL_A,section:'11-A'}),
      setDoc(doc(db,'students','bob'),{name:'Bob',email:EMAIL_B,section:'11-B'}),
      setDoc(doc(db,'assessments','peta'),{title:'Practical Exam',quarter:'Q2'}),
      setDoc(doc(db,'assessments','v2'),{title:'Mini PETA 1',quarter:'Q3',schemaVersion:2,maxScore:20}),
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
  await assertSucceeds(setDoc(doc(alice,'issues','class'),{...report(),category:'Feature',audience:'teacher'}));
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
  const teacherTicket={...report(),category:'Feature',audience:'teacher'};
  await assertSucceeds(setDoc(doc(db,'issues','class-ticket'),teacherTicket));
  await assertSucceeds(updateDoc(doc(client('staff',TEACHER),'issues','class-ticket'),{status:'In Progress'}));
  await assertFails(updateDoc(doc(client('staff',TEACHER),'issues','class-ticket'),{audience:'admin'}));
});
test('teachers can update assigned reports with server timestamps but cannot triage admin reports',async()=>{
  const alice=client('alice',EMAIL_A),teacher=client('staff',TEACHER);
  await assertSucceeds(setDoc(doc(alice,'issues','assigned'),{
    ...report(),category:'Feature',audience:'teacher'
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
    ...report(),category:'Other',audience:'teacher'
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
  const teacherList=await assertSucceeds(getDocs(query(collection(staff,'issues'),where('audience','==','teacher'))));
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
      studentId:'alice',published:false,score:15
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
  const record={studentId:'alice',taskId:'v2',gradedSha:SHA,evidenceRevision:1,score:15,maxScore:20,
    feedback:'Verified assigned screen.',teacherReviewNote:'Inspected actual contribution.',reviewedBy:'staff',manuallyAdjusted:true,reviewRequired:false,published:false};
  await assertFails(setDoc(grade,{...record,published:true}));
  await assertFails(setDoc(grade,{...record,evidenceRevision:0}));
  await assertSucceeds(setDoc(grade,record));
  await assertFails(auditedEvidence(alice,{status:'withdrawn'}));
  const reopen={status:'reopened',approvedCheckpointSha:null,verifiedContributionCommits:[],contributionScope:'',
    reopenedBy:'staff',reopenedAt:serverTimestamp(),reopenReason:'Permit correction to the individual submission.'};
  await assertFails(auditedEvidence(alice,{...reopen,reopenedBy:'alice'}));
  await assertSucceeds(updateDoc(grade,{published:true}));
  await assertFails(updateDoc(grade,{score:19}));
  await assertFails(auditedEvidence(staff,reopen,{actor:'staff'}));
  await assertSucceeds(updateDoc(grade,{published:false}));
  await assertSucceeds(auditedEvidence(staff,reopen,{actor:'staff'}));
  await assertFails(updateDoc(grade,{published:true}));
  await assertSucceeds(auditedEvidence(alice,{status:'submitted',submittedAt:serverTimestamp()}));
  await assertSucceeds(auditedEvidence(staff,approval(),{actor:'staff'}));
  await assertFails(updateDoc(grade,{published:true}));
  await assertSucceeds(updateDoc(grade,{evidenceRevision:4}));
  await assertSucceeds(updateDoc(grade,{published:true}));
  await assertFails(deleteDoc(doc(staff,'assessment_evidence','alice_v2')));
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
    await assertFails(setDoc(doc(unverified,'student_grades','alice_v2'),{studentId:'alice',taskId:'v2',score:20,published:true}));
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

test('student cannot alter discovered evidence until instructor reopening; reopened discovery permits withdrawal and resubmission',async()=>{
  const alice=client('alice',EMAIL_A),staff=client('staff',TEACHER);
  const repository='https://github.com/example/project';
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'students','alice'),{email:EMAIL_A,section:'11-A',repoUrl:repository}));
  await assertSucceeds(setDoc(doc(staff,'assessment_evidence','alice_v2'),{
    studentId:'alice',assessmentId:'v2',section:'11-A',repository,selectedCommits:[SHA],checkpointSha:SHA,
    status:'needs_review',source:'teacher_discovered',discoveredBy:'staff',recordedAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await assertFails(auditedEvidence(alice,{status:'submitted',submittedAt:serverTimestamp()}));
  await assertSucceeds(auditedEvidence(staff,approval(),{actor:'staff'}));
  await assertSucceeds(auditedEvidence(staff,{status:'reopened',approvedCheckpointSha:null,verifiedContributionCommits:[],contributionScope:'',
    reopenedBy:'staff',reopenedAt:serverTimestamp(),reopenReason:'Allow student to correct discovered evidence.'},{actor:'staff'}));
  await assertSucceeds(auditedEvidence(alice,{status:'withdrawn'}));
  await assertSucceeds(auditedEvidence(alice,{status:'submitted',submittedAt:serverTimestamp()}));
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
});

test('instructor-only V2 grading config and admin-only reclaim decisions',async()=>{
  const alice=client('alice',EMAIL_A),teacher=client('staff',TEACHER);
  const admin=client('admin',ADMIN);
  const privateRef=doc(teacher,'assessment_private','v2');
  await assertSucceeds(setDoc(privateRef,{systemPersona:'Internal review instructions',
    rules:[{type:'Required',value:'Activity'}]}));
  await assertSucceeds(getDoc(privateRef));
  await assertFails(getDoc(doc(alice,'assessment_private','v2')));
  await assertFails(setDoc(doc(alice,'assessment_private','forged'),{systemPersona:'hijack'}));
  const decision=doc(teacher,'commit_claim_decisions','audit1');
  await assertFails(setDoc(decision,{reason:'false'}));
  await assertSucceeds(setDoc(doc(admin,'commit_claim_decisions','audit1'),
    {reason:'Verified after classroom review'}));
  await assertFails(getDoc(doc(alice,'commit_claim_decisions','audit1')));
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
  const lesson=doc(staff,'lesson_plans','schoolyear_grade11_q2');
  await assertSucceeds(setDoc(lesson,{grade_level:'Grade 11',school_year:'2026-2027',sessions:[]}));
  const revision=doc(staff,'lesson_plans','schoolyear_grade11_q2','revisions','v1');
  await assertSucceeds(setDoc(revision,{version:1,sessions:[]}));
  await assertFails(getDoc(doc(alice,'lesson_plans','schoolyear_grade11_q2')));
  await assertFails(getDoc(doc(alice,'lesson_plans','schoolyear_grade11_q2','revisions','v1')));
  const presentation=doc(staff,'presentations','plan_session0','revisions','v1');
  await assertSucceeds(setDoc(presentation,{deck:[],version:1}));
  await assertFails(getDoc(doc(alice,'presentations','plan_session0','revisions','v1')));
  const parent=doc(staff,'reference_folders','folder');
  await assertSucceeds(setDoc(parent,{name:'Teacher materials',documents:[]}));
  await assertSucceeds(setDoc(doc(staff,'reference_folders','folder','documents','pdf1'),
    {title:'Chapter 1',text:'Course text'}));
  await assertFails(getDoc(doc(alice,'reference_folders','folder','documents','pdf1')));
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
  const data={ownerUid:'alice',courseId:'java',completed:['j1'],
    reflections:{j1:'I traced the variable updates in order.'},
    updatedAt:serverTimestamp()};
  await assertSucceeds(setDoc(ref,data));
  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(bob,'student_practice_progress','alice','courses','java')));
  await assertFails(setDoc(doc(bob,'student_practice_progress','alice','courses','python'),
    {...data,courseId:'python'}));
  await assertFails(setDoc(ref,{...data,courseId:'python'}));
  await assertFails(deleteDoc(ref));
});
