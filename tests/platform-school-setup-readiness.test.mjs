import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {standardSetupStatus}=require("../functions/platform-schools.js");

function doc(id,data){return {id,exists:true,data:()=>data};}
function missing(){return {exists:false,data:()=>undefined};}
function snapshot(rows){return {docs:rows,size:rows.length,empty:rows.length===0};}

function dbFixture({termProgram="program-1",offeringProgram="program-1"}={}){
  const schoolId="school-one",prefix="schools/"+schoolId+"/";
  const docs=new Map([
    [prefix+"memberships/admin-1",doc("admin-1",{schoolId,status:"active",roles:["school_admin"]})],
    [prefix+"configuration/profile",doc("profile",{schoolId,revision:1})]
  ]);
  const collections=new Map([
    [prefix+"academic_programs",snapshot([doc("program-1",{schoolId,status:"active"})])],
    [prefix+"academic_years",snapshot([doc("year-1",{schoolId,status:"active"})])],
    [prefix+"terms",snapshot([doc("term-1",{schoolId,status:"active",yearId:"year-1",programId:termProgram})])],
    [prefix+"subjects",snapshot([doc("subject-1",{schoolId,status:"active"})])],
    [prefix+"sections",snapshot([doc("section-1",{schoolId,status:"active",programId:"program-1"})])],
    [prefix+"course_offerings",snapshot([doc("offering-1",{schoolId,status:"active",
      yearId:"year-1",programId:offeringProgram,termId:"term-1",subjectId:"subject-1",sectionId:"section-1"})])]
  ]);
  return {
    schoolId,
    db:{
      doc:path=>({get:async()=>docs.get(path)||missing()}),
      collection:path=>({
        where(){return this;},
        limit(){return this;},
        async get(){return collections.get(path)||snapshot([]);}
      })
    }
  };
}

test("standard activation readiness requires one coherent active academic offering",async()=>{
  const {db,schoolId}=dbFixture();
  const result=await standardSetupStatus({db,schoolId,schoolData:{
    firstAdminUid:"admin-1",state:"draft",compatibilityMode:"v4_only",provisioningMode:"standard"
  }});
  assert.equal(result.ready,true);
  assert.equal(result.coherentOfferingId,"offering-1");
  assert.equal(result.checks.find(check=>check.id==="offering").ok,true);
});

test("independent active catalog rows do not pass when the offering context is inconsistent",async()=>{
  const {db,schoolId}=dbFixture({termProgram:"program-other"});
  const result=await standardSetupStatus({db,schoolId,schoolData:{
    firstAdminUid:"admin-1",state:"draft",compatibilityMode:"v4_only",provisioningMode:"standard"
  }});
  assert.equal(result.ready,false);
  assert.equal(result.coherentOfferingId,null);
  assert.equal(result.checks.find(check=>check.id==="offering").ok,false);
  assert.match(result.checks.find(check=>check.id==="offering").detail,/internally consistent/i);
});
