import test from "node:test";
import assert from "node:assert/strict";
import tenant from "../functions/tenant-access.js";
const request={auth:{uid:"uid1",token:{email_verified:true}}};
const records={
  "platform_schools/mcs-manila":{state:"active",displayName:"Manila Cathedral School"},
  "platform_schools/school-b":{state:"active",displayName:"School B"},
  "schools/mcs-manila/memberships/uid1":{schoolId:"mcs-manila",status:"active",roles:["teacher"]},
  "schools/school-b/memberships/uid1":{schoolId:"school-b",status:"revoked",roles:["teacher"]}
};
const db={
  doc(path){return {get:async()=>({exists:Boolean(records[path]),data:()=>records[path]})};},
  collection(){return {limit(){return {get:async()=>({docs:[{id:"mcs-manila"},{id:"school-b"}]})}}};}
};
test("a server-verified account is required",async()=>{
  await assert.rejects(tenant.getSchoolContext({db,request:{},schoolId:"mcs-manila"}),{code:"unauthenticated"});
});
test("disabled membership cannot be selected",async()=>{
  await assert.rejects(tenant.getSchoolContext({db,request,schoolId:"school-b"}),{code:"permission-denied"});
  const choices=await tenant.listVerifiedSchools({db,request});
  assert.deepEqual(choices.map(entry=>entry.schoolId),["mcs-manila"]);
});
test("same-school teacher cannot act as school admin",async()=>{
  await assert.rejects(tenant.getSchoolContext({db,request,schoolId:"mcs-manila",roles:["school_admin"]}),{code:"permission-denied"});
});
