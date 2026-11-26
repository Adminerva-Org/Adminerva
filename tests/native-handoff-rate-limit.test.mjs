import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeHandoffLimiter,LIMITS,WINDOW_MS}=
 require("../functions/native-handoff-rate-limit.js");
function dbFake(){
 const rows=new Map();
 function ref(path){return {path};}
 return {
  rows,doc:ref,
  async runTransaction(fn){
   const staged=[];
   const tx={
    async get(ref){
     const row=rows.get(ref.path);
     return {exists:!!row,data:()=>structuredClone(row)};
    },
    set(ref,value){staged.push([ref.path,structuredClone(value)]);}
   };
   const result=await fn(tx);
   for(const [path,value] of staged)rows.set(path,value);
   return result;
  }
 };
}
const Timestamp={fromMillis:ms=>({ms})};
const secret="unit-test-only-shared-key-that-is-not-a-production-secret";
const now=1700000000000;
function request(ip,uid="learner-one",data={}){return {
 rawRequest:{ip},auth:{uid},data
};}
test("quota refuses absent salt or an untrusted/missing request source",async()=>{
 const db=dbFake();
 await assert.rejects(createNativeHandoffLimiter({db,Timestamp,secret:"weak"})(request("127.0.0.1"),"begin",now),
  {code:"failed-precondition"});
 const check=createNativeHandoffLimiter({db,Timestamp,secret});
 await assert.rejects(check(request(undefined),"begin",now),{code:"failed-precondition"});
 await assert.rejects(check(request("forged:1"),"begin",now),{code:"failed-precondition"});
 assert.equal(db.rows.size,0);
});
test("IP quota is transactional, bounded, renews in a new bucket and never stores raw IP",async()=>{
 const db=dbFake(),check=createNativeHandoffLimiter({db,Timestamp,secret});
 const r=request("203.0.113.24");
 for(let i=0;i<LIMITS.begin.source;i++)await check(r,"begin",now);
 await assert.rejects(check(r,"begin",now),{code:"resource-exhausted"});
 assert.equal(db.rows.size,1);
 const [path,data]=[...db.rows.entries()][0];
 assert.match(path,/^native_client_handoff_rate_limits\/source_begin_[a-f0-9]{48}$/);
 assert.doesNotMatch(JSON.stringify(data)+path,/203\.0\.113\.24|learner-one/);
 assert.equal(data.count,LIMITS.begin.source);
 await check(r,"begin",now+WINDOW_MS);
 assert.equal(db.rows.size,2);
});
test("approval rate limited per account across different IPs and with source budget",async()=>{
 const db=dbFake(),check=createNativeHandoffLimiter({db,Timestamp,secret});
 for(let i=0;i<LIMITS.authorize.account;i++)
  await check(request("203.0.113."+String(i+1)),"authorize",now);
 await assert.rejects(check(request("198.51.100.1"),"authorize",now),
  {code:"resource-exhausted"});
 await check(request("198.51.100.1","another-account"),"authorize",now);
 const docs=[...db.rows.values()];
 assert.ok(docs.some(x=>x.scope==="account"&&x.count===LIMITS.authorize.account));
 assert.ok(docs.every(x=>x.expiresAt.ms>now));
});
test("poll quotas allow reasonable shared classroom use and reject repeated spamming",async()=>{
 const db=dbFake(),check=createNativeHandoffLimiter({db,Timestamp,secret});
 const r=request("2001:db8::abcd");
 for(let i=0;i<100;i++)await check(r,"redeem",now);
 assert.equal([...db.rows.values()].find(x=>x.action==="redeem").count,100);
 assert.equal(LIMITS.redeem.source>=100,true);
 await assert.rejects(check(r,"begin",NaN),{code:"invalid-argument"});
});
