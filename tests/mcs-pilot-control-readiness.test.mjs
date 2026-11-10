/** Isolated MCS pilot-readiness regression; no live Firebase or learner data. */
import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {EXPECTED_TOTAL,PILOT_SECTIONS,createMcsPilotControlService}=require("../functions/mcs-pilot-control.js");

function fixture({roles=["school_admin","teacher"],schoolOverride={},transactionOverride={},extraRoles=["school_admin"]}={}){
  const school={state:"draft",compatibilityMode:"legacy_allowed",productionAuthorized:false,
    revision:3,pilotRosterRevision:1,firstAdminUid:"pilot-teacher",...schoolOverride};
  const member={schoolId:"mcs-manila",status:"active",roles,revision:1};
  const students=[];
  for(const section of PILOT_SECTIONS)for(let n=0;n<section.expected;n++){
    const id="fake_"+section.sectionId+"_"+n;
    students.push({id,data:()=>({section:section.name,email:id+"@example.edu",status:"active"})});
  }
  const membershipDocs=[
    ...students.map(row=>({id:row.id,data:()=>({schoolId:"mcs-manila",status:"active",roles:["student"]})})),
    {id:"pilot-teacher",data:()=>member},
    {id:"additional-school-admin",data:()=>({schoolId:"mcs-manila",status:"active",roles:extraRoles})}
  ];
  let writes=[];
  const doc=path=>({path,get:async()=>{
    const data=path==="platform_schools/mcs-manila"?school:
      path==="schools/mcs-manila/memberships/pilot-teacher"?member:null;
    return {exists:Boolean(data),data:()=>data};
  }});
  const counts={people:170,memberships:170,course_offerings:8,enrollments:338,staff_assignments:8};
  const collection=path=>{
    if(path==="students")return {get:async()=>({docs:students})};
    if(path==="schools/mcs-manila/memberships")
      return {get:async()=>({docs:membershipDocs,size:membershipDocs.length})};
    return {
      limit:()=>({get:async()=>({docs:[]})}),
      count:()=>({get:async()=>({data:()=>({count:counts[path.split("/").at(-1)]||0})})}),
      doc:()=>({path:path+"/audit-"+writes.length})
    };
  };
  const db={
    doc,collection,
    runTransaction:async callback=>{
      const tx={
        get:async ref=>{
          const snapshot=await ref.get();
          if(ref.path==="platform_schools/mcs-manila"&&Object.keys(transactionOverride).length)
            return {exists:true,data:()=>({...school,...transactionOverride})};
          return snapshot;
        },
        update:(ref,value)=>writes.push({path:ref.path,value}),
        create:(ref,value)=>writes.push({path:ref.path,value}),
        set:(ref,value)=>writes.push({path:ref.path,value})
      };
      return callback(tx);
    }
  };
  const auth={getUsers:async ids=>({users:ids.map(row=>({uid:row.email.split("@")[0],
    email:row.email,emailVerified:true,disabled:false}))})};
  const request={auth:{uid:"pilot-teacher",token:{email_verified:true}},
    data:{action:"start_pilot",scopeReference:"MCS reviewed ICT pilot scope",
      reason:"Reviewed teacher-led controlled pilot",
      acknowledgements:{limitedScopeReviewed:true,legacyCompatibilityRequired:true,
        productionNotAuthorized:true}}};
  return {service:createMcsPilotControlService({db,auth}),request,getWrites:()=>writes};
}

test("approved four-section pilot roster totals 169 students",()=>{
  assert.equal(PILOT_SECTIONS.length,4);
  assert.equal(EXPECTED_TOTAL,169);
});

test("admin without a retained teacher role cannot activate the pilot",async()=>{
  const x=fixture({roles:["school_admin"]});
  await assert.rejects(x.service(x.request),/Resolve every identity and roster-count exception/);
  assert.equal(x.getWrites().length,0);
  const overview=await x.service({...x.request,data:{action:"overview"}});
  assert.ok(overview.blockers.some(x=>x.code==="pilot_teacher_role_missing"));
});

test("non-compatible and production-authorized draft states are blocked",async()=>{
  for(const invalid of [{compatibilityMode:"v4_only"},{productionAuthorized:true}]){
    const x=fixture({schoolOverride:invalid});
    await assert.rejects(x.service(x.request),/Resolve every identity and roster-count exception/);
    assert.equal(x.getWrites().length,0);
  }
});

test("a reviewed roster changing between preview and transaction prevents pilot activation",async()=>{
  const x=fixture({transactionOverride:{pilotRosterRevision:2}});
  await assert.rejects(x.service(x.request),/Pilot scope, account role or reviewed roster changed/);
  assert.equal(x.getWrites().length,0);
});

test("an additional verified school-admin-only account is not a student-count conflict",async()=>{
  const x=fixture();
  const overview=await x.service({...x.request,data:{action:"overview"}});
  assert.equal(overview.canonical.memberships,171);
  assert.equal(overview.canonical.extraStaffMemberships,1);
  assert.equal(overview.canonical.studentMembershipsReady,true);
  assert.equal(overview.canonical.firstAdminDualRoleReady,true);
  assert.equal(overview.canonical.ready,true);
  assert.equal(overview.readyToStart,true);
});

test("unexpected additional student membership blocks pilot readiness",async()=>{
  const x=fixture({extraRoles:["student"]});
  const overview=await x.service({...x.request,data:{action:"overview"}});
  assert.equal(overview.canonical.invalidExtraMemberships,1);
  assert.equal(overview.canonical.ready,false);
  await assert.rejects(x.service(x.request),/Resolve every identity and roster-count exception/);
  assert.equal(x.getWrites().length,0);
});

test("authorized pilot start retains legacy compatibility without authorizing production",async()=>{
  const x=fixture();const result=await x.service(x.request);
  assert.deepEqual(result,{schoolId:"mcs-manila",state:"pilot",compatibilityMode:"legacy_allowed",
    productionAuthorized:false});
  const schoolWrite=x.getWrites().find(row=>row.path==="platform_schools/mcs-manila");
  assert.equal(schoolWrite.value.state,"pilot");
  assert.equal(schoolWrite.value.compatibilityMode,"legacy_allowed");
  assert.equal(schoolWrite.value.productionAuthorized,false);
  assert.equal(schoolWrite.value.pilot.productionAuthorized,false);
});
