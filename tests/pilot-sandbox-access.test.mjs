import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../functions/pilot-sandbox-access.js",import.meta.url),"utf8");
class TenantAccessError extends Error{
  constructor(code,message){super(message);this.code=code;}
}
const sandbox={module:{exports:{}},require(spec){
  if(spec==="./tenant-access.js")return {TenantAccessError,
    getSchoolContext:async()=>{throw new TenantAccessError("permission-denied","No canonical school role.");}};
  throw Error("Unexpected dependency: "+spec);
}};
vm.runInNewContext(source,sandbox);
const {approvedPilotTeacher,pilotTeacherContext}=sandbox.module.exports;
function fixture({schoolState="pilot",staffStatus="active",approvedRole="teacher",guestStatus="approved",canonical=null,staffEmail="staff@example.edu.ph"}={}){
  const stored=new Map([
    ["platform_schools/mcs-manila",{state:schoolState,compatibilityMode:"legacy_allowed"}],
    ["staff_access/"+staffEmail,{email:staffEmail,role:"teacher",status:staffStatus}],
    ["account_requests/viewer",{email:staffEmail,status:guestStatus,approvedRole}],
  ]);
  if(canonical)stored.set("schools/mcs-manila/memberships/viewer",canonical);
  const db={doc(path){return {async get(){const data=stored.get(path);return {exists:Boolean(data),data:()=>data};}}}};
  const users={viewer:{uid:"viewer",email:staffEmail,emailVerified:true,disabled:false},
    owner:{uid:"owner",email:"josephsixson@mcstayuman.edu.ph",emailVerified:true,disabled:false}};
  const auth={async getUser(uid){return users[uid]||null;}};
  const request={auth:{uid:"viewer",token:{email:staffEmail,email_verified:true}}};
  return {db,auth,request,users};
}
test("approved guest teacher can enter private MCS sandbox, not canonical V4 authority",async()=>{
  const f=fixture();
  const ctx=await pilotTeacherContext({...f,schoolId:"mcs-manila"});
  assert.equal(ctx.uid,"viewer");
  assert.equal(ctx.pilotAccess,"verified_legacy_teacher");
  assert.equal(ctx.productionAuthorized,false);
});
test("student or rejected access decisions cannot become pilot teacher permissions",async()=>{
  for(const input of [{approvedRole:"student"},{guestStatus:"rejected"},{staffStatus:"disabled"}]){
    const f=fixture(input);
    assert.equal(await approvedPilotTeacher({...f,schoolId:"mcs-manila",uid:"viewer"}),false);
  }
});
test("explicit canonical suspension prevents legacy fallback",async()=>{
  const f=fixture({canonical:{schoolId:"mcs-manila",status:"suspended",roles:["teacher"]}});
  assert.equal(await approvedPilotTeacher({...f,schoolId:"mcs-manila",uid:"viewer"}),false);
  await assert.rejects(()=>pilotTeacherContext({...f,schoolId:"mcs-manila"}),{code:"permission-denied"});
});
test("original MCS teacher remains eligible without duplicating school memberships",async()=>{
  const f=fixture();
  assert.equal(await approvedPilotTeacher({...f,schoolId:"mcs-manila",uid:"owner"}),true);
});
test("sandbox never admits unverified accounts or non-pilot schools",async()=>{
  const f=fixture();
  f.users.viewer.emailVerified=false;
  await assert.rejects(()=>pilotTeacherContext({...f,schoolId:"mcs-manila"}),{code:"permission-denied"});
  const other=fixture();
  await assert.rejects(()=>pilotTeacherContext({...other,schoolId:"other-school"}),{code:"invalid-argument"});
  const blocked=fixture({schoolState:"suspended"});
  await assert.rejects(()=>pilotTeacherContext({...blocked,schoolId:"mcs-manila"}),{code:"failed-precondition"});
});
