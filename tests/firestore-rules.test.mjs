import test, {before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertSucceeds, assertFails}
  from '@firebase/rules-unit-testing';
import {doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
  collection, getDocs, query, where}
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
      setDoc(doc(db,'assessments','v2'),{title:'Mini PETA 1',quarter:'Q3',schemaVersion:2}),
      setDoc(doc(db,'notifications','alice','items','note-1'),{
        title:'Review update',type:'issue',createdAt:new Date(),readAt:null,
        target:'issues.html',body:'Your report is ready.'
      })
    ]);
  });
});
function client(uid,email){return env.authenticatedContext(uid,{email}).firestore()}
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
  await assertSucceeds(updateDoc(ref,{selectedCommits:[SHA],checkpointSha:SHA,updatedAt:serverTimestamp()}));
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
  await assertSucceeds(updateDoc(doc(staff,'assessment_evidence','alice_v2'),
    {status:'approved',reviewedBy:'staff'}));
  await assertFails(updateDoc(ref,{selectedCommits:[SHA],updatedAt:serverTimestamp()}));
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
