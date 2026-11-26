import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {eligibleNativeWorkspace} from "../js/core/native-session-admission.mjs";
const verified={uid:"student-uid",email:"student@school.example",emailVerified:true};
test("native workspace admission reuses verified school and accepted legacy identity",()=>{
 for(const access of [
  {schoolAdmin:true},{schoolRegistrar:true},{schoolTeacher:true},{schoolStudent:true},
  {platformAdmin:true},{role:"teacher"},{legacyRole:"admin"},{students:[{id:"legacy"}]}
 ])assert.equal(eligibleNativeWorkspace(verified,access),true,JSON.stringify(access));
 for(const access of [
  {},{role:"guest"},{students:[]},{schoolStudent:false},{roles:["school_admin"]},
  {platformAdmin:"true"}
 ])assert.equal(eligibleNativeWorkspace(verified,access),false,JSON.stringify(access));
 for(const user of [
  null,{...verified,emailVerified:false},{...verified,uid:""},{...verified,email:""}
 ])assert.equal(eligibleNativeWorkspace(user,{schoolAdmin:true}),false);
});
test("failed desktop sign-in clears partial Firebase session before continuing",()=>{
 const code=readFileSync(new URL("../js/core/desktop-session.mjs",import.meta.url),"utf8");
 assert.match(code,/eligibleNativeWorkspace\(credential\.user,access\)/);
 assert.match(code,/const credential=await signInWithCustomToken\(auth,token\)/);
 assert.match(code,/signedInUid=credential\.user\.uid/);
 assert.match(code,/auth\.currentUser\?\.uid===signedInUid/);
 assert.match(code,/await signOut\(auth\)/);
 assert.match(code,/native\.confirmSignIn\(\)/);
 assert.doesNotMatch(code,/localStorage\.setItem|sessionStorage\.setItem|createUserWithEmailAndPassword/);
});
test("native logout avoids external login and clears rendered account state",()=>{
 const code=readFileSync(new URL("../js/core/adminerva-nav.js",import.meta.url),"utf8");
 assert.match(code,/desktopBridge\.reportSignedOut\(\)/);
 assert.match(code,/window\.location\.replace\("guest-home\.html"\)/);
 assert.match(code,/adminerva:before-signout/);
});
