import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {
  checkedEvent,createPilotStudioResearchService,platformPilotResearchOverview,RETENTION_DAYS
}=require("../functions/pilot-studio-research.js");

const UID="test_user_001",SCHOOL="pilot-school";
const EVENT_ID="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_ID="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIXED=Date.UTC(2026,10,23,10,0,0);
const ts=ms=>({toMillis:()=>ms});
const Timestamp={fromMillis:ts};
const FieldValue={serverTimestamp:()=>ts(FIXED)};
const request=(uid=UID,data={})=>({auth:{uid,token:{email:"test@example.com",email_verified:true}},data});

function database(){
  const docs=new Map([
    ["platform_schools/"+SCHOOL,{state:"pilot",displayName:"Pilot School"}],
    ["schools/"+SCHOOL+"/memberships/"+UID,{schoolId:SCHOOL,status:"active",roles:["student"]}],
    ["platform_test_accounts/"+UID,{kind:"student",status:"active",revision:1}]
  ]);
  const counts=new Map([
    ["people",19],["memberships",17],["enrollments",16],["assessments",8],
    ["studio_submissions",12],["github_evidence",13],["student_grades",14]
  ]);
  const snapshot=path=>({id:path.split("/").at(-1),exists:docs.has(path),
    data:()=>docs.get(path)});
  const db={
    records:docs,
    doc(path){return {path,get:async()=>snapshot(path)};},
    runTransaction:async callback=>callback({
      get:async ref=>snapshot(ref.path),
      set:(ref,data)=>docs.set(ref.path,data),
      create:(ref,data)=>{assert.equal(docs.has(ref.path),false);docs.set(ref.path,data);}
    }),
    collection(path){
      if(path==="platform_schools")return {
        limit:n=>({get:async()=>({size:1,docs:[{id:SCHOOL,data:()=>docs.get("platform_schools/"+SCHOOL)}]})})
      };
      if(path.startsWith("schools/"+SCHOOL+"/")){
        const category=path.split("/").at(-1);
        return {
          count:()=>({get:async()=>({data:()=>({count:counts.get(category)||0})})}),
          orderBy:()=>({limit:n=>({get:async()=>({size:1,docs:[{
            data:()=>({type:"run_finished",ownerUid:UID,createdAt:ts(FIXED-1000)})
          }]})})})
        };
      }
      if(["students","assessments","student_grades","student_submissions","assessment_evidence","activity_events"].includes(path))
        return {count:()=>({get:async()=>({data:()=>({count:2})})})};
      throw Error("Unexpected collection "+path);
    }
  };
  return db;
}

test("pilot events are strict metadata without source or typed text",()=>{
  assert.deepEqual(checkedEvent({
    eventId:EVENT_ID,sessionId:SESSION_ID,projectId:"demo_1",
    type:"run_finished",mode:"console",outcome:"compile_error"
  }).outcome,"compile_error");
  for(const leaked of ["code","stdout","stdin","clipboard","fileName","grade"]){
    assert.throws(()=>checkedEvent({
      eventId:EVENT_ID,sessionId:SESSION_ID,projectId:"demo_1",
      type:"project_open",[leaked]:"private data"
    }),/only approved metadata/);
  }
  assert.throws(()=>checkedEvent({
    eventId:EVENT_ID,sessionId:SESSION_ID,projectId:"demo_1",
    type:"editor_activity",editCount:251
  }),/bounded change count/);
});

test("only active designated test students can record and retries are idempotent",async()=>{
  const db=database(),api=createPilotStudioResearchService({db,FieldValue,Timestamp,now:()=>FIXED});
  assert.equal((await api(request(UID,{action:"status",schoolId:SCHOOL}))).enabled,true);
  const event={eventId:EVENT_ID,sessionId:SESSION_ID,projectId:"demo_1",type:"project_open"};
  assert.deepEqual(await api(request(UID,{action:"record",schoolId:SCHOOL,event})),{recorded:true,duplicate:false});
  assert.deepEqual(await api(request(UID,{action:"record",schoolId:SCHOOL,event})),{recorded:true,duplicate:true});
  const recorded=db.records.get("schools/"+SCHOOL+"/pilot_research_events/"+UID+"_"+EVENT_ID);
  assert.equal(recorded.schoolId,SCHOOL);
  assert.equal(recorded.ownerUid,UID);
  assert.equal(recorded.expiresAt.toMillis(),FIXED+RETENTION_DAYS*86400000);
  assert.equal(Object.hasOwn(recorded,"source"),false);
  db.records.set("platform_test_accounts/"+UID,{kind:"student",status:"retired"});
  assert.equal((await api(request(UID,{action:"status",schoolId:SCHOOL}))).enabled,false);
  await assert.rejects(api(request(UID,{action:"record",schoolId:SCHOOL,event})),/restricted to designated test/);
});

test("active school membership is mandatory even for test-designated identities",async()=>{
  const db=database(),api=createPilotStudioResearchService({db,FieldValue,Timestamp,now:()=>FIXED});
  db.records.set("schools/"+SCHOOL+"/memberships/"+UID,
    {schoolId:SCHOOL,status:"suspended",roles:["student"]});
  await assert.rejects(api(request(UID,{action:"status",schoolId:SCHOOL})),/access to this school is not active/);
});

test("platform overview returns only cross-school aggregates to platform authority",async()=>{
  const db=database();
  await assert.rejects(platformPilotResearchOverview({db,request:request(UID),now:()=>FIXED}),
    /Platform Administrator access is required/);
  db.records.set("platform_admins/platform_admin_001",{role:"platform_admin",status:"active"});
  const result=await platformPilotResearchOverview({db,request:request("platform_admin_001"),now:()=>FIXED});
  assert.equal(result.scope,"aggregate_only");
  assert.equal(result.schools[0].counts.studio_submissions,12);
  assert.equal(result.schools[0].pilotSample.observedAccounts,1);
  assert.equal(result.schools[0].pilotSample.eventsByType.run_finished,1);
  const encoded=JSON.stringify(result);
  assert.equal(encoded.includes(UID),false);
  assert.equal(encoded.includes("private data"),false);
});
