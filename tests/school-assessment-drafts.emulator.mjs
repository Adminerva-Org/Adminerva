import test,{before,after} from "node:test";
import {readFileSync} from "node:fs";
import {initializeTestEnvironment,assertFails} from "@firebase/rules-unit-testing";
import {doc,getDoc,setDoc,deleteDoc} from "firebase/firestore";

let env;
before(async()=>{
  env=await initializeTestEnvironment({
    projectId:"demo-adminerva-security",
    firestore:{rules:readFileSync("firestore.rules","utf8")}
  });
});
after(async()=>{await env?.cleanup();});
test("school assessment drafts cannot be read or modified directly by other students, the owner, or teachers",async()=>{
  const alice=env.authenticatedContext("student-alice",{email:"alice@example.edu"}).firestore();
  const bob=env.authenticatedContext("student-bob",{email:"bob@example.edu"}).firestore();
  const teacher=env.authenticatedContext("teacher-uid",{email:"teacher@example.edu"}).firestore();
  const path=["schools","school-one","assessment_response_drafts","draft-one"];
  for(const client of [alice,bob,teacher]){
    const ref=doc(client,...path);
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref,{schoolId:"school-one",studentUid:"student-alice",payload:{response:"Private"}}));
    await assertFails(deleteDoc(ref));
  }
});
