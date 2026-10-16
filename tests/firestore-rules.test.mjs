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
    category:'Bug',priority:'Medium',images:[],
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
});
test('only staff can triage or change report priority and lock state',async()=>{
  const db=client('alice',EMAIL_A);
  await assertSucceeds(setDoc(doc(db,'issues','ticket'),report()));
  await assertFails(updateDoc(doc(db,'issues','ticket'),{priority:'Critical'}));
  await assertFails(updateDoc(doc(db,'issues','ticket'),{status:'Resolved'}));
  await assertFails(updateDoc(doc(db,'issues','ticket'),{locked:true}));
  await assertSucceeds(updateDoc(doc(client('staff',TEACHER),'issues','ticket'),{status:'Resolved'}));
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


test('new public issue and comment records do not require exposed student email',async()=>{
  const alice=client('alice',EMAIL_A);
  const ticket=doc(alice,'issues','private-contact');
  await assertSucceeds(setDoc(ticket,{...report(),reporterEmail:''}));
  const publicView=await getDoc(doc(client('bob',EMAIL_B),'issues','private-contact'));
  assert.equal(publicView.data().reporterEmail,'');
  assert.equal(publicView.data().reporterUid,'alice');
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
    await setDoc(doc(ctx.firestore(),'issues','legacy'),{locked:false});
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
