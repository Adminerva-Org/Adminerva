import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {createSchoolPracticeSeasonService}=require("../functions/school-practice-season-service.js");

const doc=(id,data)=>({id,exists:true,data:()=>data});
const snap=docs=>({docs,size:docs.length,empty:docs.length===0});

test("Global Games leaderboard includes every active student membership, including zero-XP and non-opted-in players",async()=>{
  const collections=new Map([
    ["platform_schools",snap([
      doc("school-a",{state:"active"}),
      doc("school-b",{state:"pilot"}),
      doc("school-c",{state:"suspended"})
    ])],
    ["schools/school-a/memberships",snap([
      doc("u1",{schoolId:"school-a",status:"active",roles:["student"]}),
      doc("u2",{schoolId:"school-a",status:"active",roles:["student"]}),
      doc("u3",{schoolId:"school-a",status:"active",roles:["teacher"]}),
      doc("u4",{schoolId:"school-a",status:"inactive",roles:["student"]})
    ])],
    ["schools/school-a/practice_season_scores",snap([
      doc("u1",{schoolId:"school-a",ownerUid:"u1",season:"season-1",alias:"Player One",optIn:false,points:100,completedCount:4})
    ])],
    ["schools/school-a/legacy_roots/practice_season_scores/documents",snap([])],
    ["schools/school-b/memberships",snap([
      doc("u5",{schoolId:"school-b",status:"active",roles:["student"]})
    ])],
    ["schools/school-b/practice_season_scores",snap([])],
    ["schools/school-b/legacy_roots/practice_season_scores/documents",snap([
      doc("u5",{season:"season-1",alias:"Pilot Five",optIn:true,points:200,completedCount:8})
    ])],
    ["schools/school-c/memberships",snap([
      doc("u6",{schoolId:"school-c",status:"active",roles:["student"]})
    ])],
    ["schools/school-c/practice_season_scores",snap([
      doc("u6",{schoolId:"school-c",ownerUid:"u6",season:"season-1",alias:"Suspended Six",points:300,completedCount:9})
    ])],
    ["schools/school-c/legacy_roots/practice_season_scores/documents",snap([])]
  ]);
  const db={collection(path){return {get:async()=>collections.get(path)||snap([])};}};
  const service=createSchoolPracticeSeasonService({
    db,
    Timestamp:{fromMillis:value=>value},
    resolveUser:async()=>({}),
    seasonRules:async()=>({PRACTICE_SEASON:"season-1"})
  });

  const result=await service.publicLeaderboard();

  assert.equal(result.season,"season-1");
  assert.equal(result.rows.length,3);
  assert.equal(result.rows[0].alias,"Pilot Five");
  assert.equal(result.rows[0].points,200);
  assert.match(result.rows[1].alias,/^Learner-[A-F0-9]{7}$/);
  assert.equal(result.rows[1].points,100);
  assert.match(result.rows[2].alias,/^Learner-[A-F0-9]{7}$/);
  assert.equal(result.rows[2].points,0);
  assert.equal(result.rows[2].completedCount,0);
  assert.equal("ownerUid" in result.rows[0],false);
  assert.equal(result.rows.some(row=>row.alias==="Suspended Six"),false);
});
