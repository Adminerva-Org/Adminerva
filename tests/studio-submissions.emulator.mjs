import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertSucceeds,assertFails} from "@firebase/rules-unit-testing";
import {doc,getDoc,setDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp,Timestamp} from "firebase/firestore";

const PROJECT="demo-adminerva-security";
const TEACHER="teacher@example.edu",ALICE="alice@example.edu",BOB="bob@example.edu";
const HASH="a".repeat(64),ID="alice_task-studio";
const snapshotJson=JSON.stringify({schemaVersion:1,lang:"java",files:{"Main.java":"class Main{}"},fileOrder:["Main.java"],database:{tables:{},history:[]},design:{},config:{}});
let env;
const client=(uid,email)=>env.authenticatedContext(uid,{email,email_verified:true}).firestore();
before(async()=>{env=await initializeTestEnvironment({projectId:PROJECT,firestore:{rules:readFileSync("firestore.rules","utf8")}});});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await Promise.all([
      setDoc(doc(db,"students","alice"),{email:ALICE,section:"11-A",name:"Alice"}),
      setDoc(doc(db,"students","bob"),{email:BOB,section:"11-B",name:"Bob"}),
      setDoc(doc(db,"staff_access",TEACHER),{email:TEACHER,role:"teacher",status:"active",sections:["11-A"]}),
      setDoc(doc(db,"assessments","task-studio"),{
        ownerUid:"teacher",sectionIds:["11-A"],schemaVersion:3,submissionSource:"studio",title:"Java task",maxScore:20,
        studioWindows:{"11-A":{opensAt:Timestamp.fromMillis(Date.now()-60000),closesAt:Timestamp.fromMillis(Date.now()+86400000)}},
        deployments:[{id:"d1",section:"11-A",postDate:null,deadline:null,deadlineEnabled:false}]
      })
    ]);
  });
});
function saveFirst(db,revision=1,id=ID,studentId="alice",section="11-A"){
  const batch=writeBatch(db),hash=HASH,when=serverTimestamp();
  batch.set(doc(db,"studio_submissions",id,"versions",String(revision)),{
    source:"studio",studentId,assessmentId:"task-studio",ownerUid:studentId,section,revision,
    projectId:"p1",snapshotHash:hash,snapshotJson,submittedAt:when
  });
  batch.set(doc(db,"studio_submissions",id),{
    source:"studio",studentId,assessmentId:"task-studio",ownerUid:studentId,section,revision,
    projectId:"p1",projectTitle:"Library System",snapshotHash:hash,status:"submitted",
    reviewNote:"",reviewedBy:"",submittedAt:when
  });
  return batch.commit();
}
test("student can submit a frozen project and teacher may read; other student cannot",async()=>{
 const alice=client("alice",ALICE),bob=client("bob",BOB),teacher=client("teacher",TEACHER);
 await assertSucceeds(getDoc(doc(alice,"studio_submissions",ID))); // missing document: no leaked content
 await assertSucceeds(saveFirst(alice));
 await assertSucceeds(getDoc(doc(alice,"studio_submissions",ID)));
 await assertSucceeds(getDoc(doc(teacher,"studio_submissions",ID,"versions","1")));
 await assertFails(getDoc(doc(bob,"studio_submissions",ID)));
 await assertFails(getDoc(doc(bob,"studio_submissions",ID,"versions","1")));
 await assertFails(updateDoc(doc(alice,"studio_submissions",ID,"versions","1"),{snapshotJson:"changed"}));
 await assertFails(deleteDoc(doc(teacher,"studio_submissions",ID,"versions","1")));
});
test("wrong owner and expired server-side assignment cannot create a Studio submission",async()=>{
 const bob=client("bob",BOB),alice=client("alice",ALICE);
 await assertFails(saveFirst(bob,1,ID,"alice","11-A"));
 await env.withSecurityRulesDisabled(async context=>{
   const db=context.firestore();
   await updateDoc(doc(db,"assessments","task-studio"),{
     studioWindows:{"11-A":{opensAt:Timestamp.fromMillis(Date.now()-86400000),closesAt:Timestamp.fromMillis(Date.now()-10000)}}
   });
 });
 await assertFails(saveFirst(alice));
});
test("teacher review and grade must refer to the current frozen revision",async()=>{
 const alice=client("alice",ALICE),teacher=client("teacher",TEACHER);
 await assertSucceeds(saveFirst(alice));
 const head=doc(teacher,"studio_submissions",ID),grade=doc(teacher,"student_grades",ID);
 const batch=writeBatch(teacher);
 batch.update(head,{status:"reviewed",reviewNote:"Verified individual Java implementation.",reviewedBy:"teacher",reviewedAt:serverTimestamp()});
 batch.set(grade,{studentId:"alice",taskId:"task-studio",section:"11-A",gradeSource:"studio_teacher_review",
   studioRevision:1,studioSnapshotHash:HASH,score:18,maxScore:20,feedback:"Implementation meets the requested criteria.",reviewRequired:false,published:false,
   reviewedBy:"teacher",teacherReviewNote:"Verified implementation and class requirements.",manuallyAdjusted:true,
   reviewPriority:"ready_to_publish",gradedAt:new Date().toISOString(),gradeVersion:1});
 await assertSucceeds(batch.commit());
 await assertFails(updateDoc(head,{status:"reviewed",reviewNote:"No corresponding private grade change.",reviewedBy:"teacher",reviewedAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(grade,{published:true}));
 await assertFails(updateDoc(grade,{score:19}));
 await assertFails(saveFirst(alice,2));
});
