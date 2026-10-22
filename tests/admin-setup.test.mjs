import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {assertPendingRequest} from "../js/core/admission-model.mjs";

// Exercise the real transaction with an in-memory Firestore adapter: no credentials or network.
function admissionHarness(prior){
  const actor={uid:"admin",email:"admin@example.edu"},writes=new Map();
  const request={ownerUid:"guest",email:"teacher@example.edu",displayName:"Teacher",requestedRole:"teacher",status:"pending",revision:0};
  const context={auth:{currentUser:actor},db:{},resolveStaffRole:async()=>"admin",assertPendingRequest,
    serverTimestamp:()=>"timestamp",doc:(base,...segments)=>(typeof base==="string"?[base,...segments]:segments).join("/"),
    runTransaction:async(_db,callback)=>callback({
      get:async ref=>({exists:()=>ref==="account_requests/guest"||Boolean(prior),data:()=>ref==="account_requests/guest"?request:prior}),
      set:(ref,data)=>writes.set(ref,data)
    })};
  const source=readFileSync(new URL("../js/core/admission-service.mjs",import.meta.url),"utf8")
    .replace(/^import .*;\r?$/gm,"").replaceAll("export async function ","async function ");
  vm.runInNewContext(source,context);
  return {approve:()=>context.decideAdmission(request,{role:"teacher",reason:"Verified school teacher identity.",decision:"approved"}),writes,request};
}

test("approving a pending teacher request preserves the existing exact section assignments and audits them",async()=>{
  const sections=["Grade 11 - ICT A","12 / STEM B"],prior={email:"teacher@example.edu",role:"teacher",status:"active",revision:4,sections};
  const harness=admissionHarness(prior);await harness.approve();
  const saved=harness.writes.get("staff_access/teacher@example.edu"),audit=harness.writes.get("staff_access/teacher@example.edu/revisions/5");
  assert.deepEqual(Array.from(saved.sections),sections);assert.equal(saved.revision,5);
  assert.equal(audit.before,prior);assert.equal(audit.after,saved);assert.equal(audit.actorUid,"admin");
  assert.notEqual(saved.sections,prior.sections);assert.deepEqual(prior.sections,sections);
  assert.equal(harness.writes.has("analytics_rosters/teacher@example.edu"),false);
});

test("first teacher approval grants no inferred sections",async()=>{
  const harness=admissionHarness(null);await harness.approve();
  const saved=harness.writes.get("staff_access/teacher@example.edu");
  assert.equal(saved.status,"active");assert.equal(saved.sections.length,0);
  assert.equal(harness.writes.get("account_requests/guest").approvedRole,"teacher");
});
