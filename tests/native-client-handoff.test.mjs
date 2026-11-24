import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {validFlowId} from "../js/core/native-connect-model.mjs";
const require=createRequire(import.meta.url);
const {generatePairing}=require("../apps/desktop/native-auth-protocol.cjs");
const {createNativeClientHandoffService}=require("../functions/native-client-handoff.js");
const {parse}=JSON;
function fakeDb(){
 const data=new Map();
 const clone=x=>structuredClone(x);
 function ref(path){return {
  path,
  async get(){const row=data.get(path);return {exists:!!row,data:()=>clone(row)};},
  async create(row){if(data.has(path))throw Object.assign(Error("exists"),{code:6});data.set(path,clone(row));}
 };}
 return {
  data,
  doc:ref,
  async runTransaction(fn){
   const updates=[];
   const tx={
    get:r=>r.get(),
    update:(r,fields)=>updates.push([r.path,fields])
   };
   const result=await fn(tx);
   for(const [path,fields] of updates)data.set(path,{...data.get(path),...clone(fields)});
   return result;
  }
 };
}
const Timestamp={fromMillis:ms=>({toMillis:()=>ms})};
const users=new Map([["student-uid",{uid:"student-uid",email:"student@example.edu",emailVerified:true,disabled:false}]]);
const auth={
 async getUser(uid){return users.get(uid)||{uid,disabled:true};},
 async createCustomToken(uid){return "private-custom-token-for-"+uid;}
};
let now=1700000000000;
const clock=()=>now;
const enabled=()=>true;
const signed={auth:{uid:"student-uid",token:{email_verified:true,email:"student@example.edu",auth_time:Math.floor(now/1000)}}};
function service(db,flag=enabled){return createNativeClientHandoffService({db,auth,Timestamp,now:clock,enabled:flag});}
function request(pairing,action,extra={},signedIn=false){
 return {data:{action,flowId:pairing.flowId,...extra},...(signedIn?signed:{})};
}
test("native pairing keeps verifier and confirmation code out of the system-browser link",()=>{
 const p=generatePairing();
 assert.ok(validFlowId(p.flowId));assert.match(p.challenge,/^[A-Za-z0-9_-]{43}$/);
 assert.match(p.confirmationCode,/^\d{8}$/);
 assert.equal(p.browserUrl,"https://adminerva-org.github.io/Adminerva/native-connect.html?flow="+p.flowId);
 assert.doesNotMatch(p.browserUrl,new RegExp(p.verifier+"|"+p.confirmationCode));
 assert.equal(createHash("sha256").update(Buffer.from(p.verifier,"base64url")).digest("base64url"),p.challenge);
});
test("handoff is disabled by default without any Firestore write or token issuance",async()=>{
 const db=fakeDb(),p=generatePairing(),h=service(db,()=>false);
 await assert.rejects(h(request(p,"begin",{clientKind:"desktop",challenge:p.challenge,confirmationCode:p.confirmationCode})),
  {code:"failed-precondition"});
 assert.equal(db.data.size,0);
});
test("fresh verified browser approval and original verifier yield one token, no school state mutation",async()=>{
 const db=fakeDb(),h=service(db),p=generatePairing();
 now=1700000000000;
 const begin=request(p,"begin",{clientKind:"desktop",challenge:p.challenge,confirmationCode:p.confirmationCode});
 assert.equal((await h(begin)).state,"waiting");
 const stored=db.data.get("native_client_handoffs/"+p.flowId);
 assert.equal(stored.authorizedUid,null);assert.equal(stored.challenge,p.challenge);
 assert.equal(stored.confirmationCode,undefined);assert.equal(stored.verifier,undefined);
 assert.equal((await h(request(p,"redeem",{verifier:p.verifier}))).state,"waiting");
 await assert.rejects(h(request(p,"authorize",{confirmationCode:p.confirmationCode},false)),
  {code:"unauthenticated"});
 assert.equal((await h(request(p,"authorize",{confirmationCode:p.confirmationCode},true))).state,"approved");
 const result=await h(request(p,"redeem",{verifier:p.verifier}));
 assert.deepEqual(result,{state:"authorized",customToken:"private-custom-token-for-student-uid"});
 assert.deepEqual(await h(request(p,"redeem",{verifier:p.verifier})),{state:"unavailable"});
 assert.deepEqual([...db.data.keys()],["native_client_handoffs/"+p.flowId]);
});
test("wrong code attempts lock a pairing; a wrong verifier never grants access",async()=>{
 const db=fakeDb(),h=service(db),p=generatePairing();
 await h(request(p,"begin",{clientKind:"desktop",challenge:p.challenge,confirmationCode:p.confirmationCode}));
 for(let i=0;i<5;i++)await assert.rejects(
  h(request(p,"authorize",{confirmationCode:p.confirmationCode==="00000000"?"11111111":"00000000"},true)),
  {code:"permission-denied"});
 await assert.rejects(h(request(p,"authorize",{confirmationCode:p.confirmationCode},true)),
  {code:"resource-exhausted"});
 assert.equal(db.data.get("native_client_handoffs/"+p.flowId).status,"locked");
 const other=generatePairing();
 await h(request(other,"begin",{clientKind:"desktop",challenge:other.challenge,confirmationCode:other.confirmationCode}));
 await h(request(other,"authorize",{confirmationCode:other.confirmationCode},true));
 await assert.rejects(h(request(other,"redeem",{verifier:p.verifier})),{code:"permission-denied"});
 assert.equal((await h(request(other,"redeem",{verifier:other.verifier}))).state,"authorized");
});
test("expired, disabled, stale-session and canceled handoffs cannot issue tokens",async()=>{
 const db=fakeDb(),h=service(db),p=generatePairing();
 now=1700000000000;
 await h(request(p,"begin",{clientKind:"desktop",challenge:p.challenge,confirmationCode:p.confirmationCode}));
 const old=signed.auth.token.auth_time;
 signed.auth.token.auth_time=Math.floor((now-700000)/1000);
 await assert.rejects(h(request(p,"authorize",{confirmationCode:p.confirmationCode},true)),{code:"failed-precondition"});
 signed.auth.token.auth_time=old;
 assert.equal((await h(request(p,"cancel",{verifier:p.verifier}))).state,"canceled");
 assert.equal((await h(request(p,"redeem",{verifier:p.verifier}))).state,"unavailable");
 const expired=generatePairing();
 await h(request(expired,"begin",{clientKind:"desktop",challenge:expired.challenge,confirmationCode:expired.confirmationCode}));
 now+=300001;
 await assert.rejects(h(request(expired,"authorize",{confirmationCode:expired.confirmationCode},true)),{code:"failed-precondition"});
 assert.equal((await h(request(expired,"redeem",{verifier:expired.verifier}))).state,"expired");
 now=1700000000000;
});
test("browser authorization UI never inserts an OS credential into query strings",()=>{
 const html=readFileSync(new URL("../native-connect.html",import.meta.url),"utf8");
 const js=readFileSync(new URL("../js/core/native-connect.mjs",import.meta.url),"utf8");
 assert.match(html,/id="native-pair-code"/);
 assert.match(js,/getFunctions\(app,"asia-southeast1"\)/);
 assert.doesNotMatch(js,/createCustomToken|signInWithCustomToken|localStorage\.setItem/);
 assert.doesNotMatch(html,/auth-guard/);
 assert.match(html,/adminerva-loader\.js/);
});
