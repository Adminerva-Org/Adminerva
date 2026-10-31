import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);

const {
  canonicalAlias,canonicalPublicId,normalizeVerifiedProgress,reconcileCurrentSeason,historicalSeasonArchive
}=require("../functions/mcs-canonical-practice-plan.js");
const {
  validateCurrent,flattenStudent
}=require("../functions/mcs-canonical-practice-apply.js");
const {schoolPracticeClassRankId}=require("../functions/school-practice-season-service.js");

test("school Practice aliases and class-ranking IDs are deterministic but school-scoped",()=>{
 const uid="student_1";
 assert.equal(canonicalAlias(uid),
  "Learner-"+createHash("sha256").update("mcs-manila:"+uid).digest("hex").slice(0,7).toUpperCase());
 assert.match(canonicalPublicId(uid),/^mcspr_[a-f0-9]{32}$/);
 assert.equal(schoolPracticeClassRankId("section_a",uid),
  schoolPracticeClassRankId("section_a",uid));
 assert.notEqual(schoolPracticeClassRankId("section_a",uid),
  schoolPracticeClassRankId("section_b",uid));
});

test("verified Practice progress requires reviewed owner and bounded reflection values",()=>{
 const student={uid:"student_1",personId:"person_1"};
 assert.throws(()=>normalizeVerifiedProgress({id:"java",path:"legacy/java",data:{
  ownerUid:"other",courseId:"java",completed:["j1"],reflections:{j1:"ok"}
 }},student),/owner/);
 assert.throws(()=>normalizeVerifiedProgress({id:"java",path:"legacy/java",data:{
  ownerUid:"student_1",courseId:"python",completed:["j1"],reflections:{j1:"ok"}
 }},student),/course ID/);
 const row=normalizeVerifiedProgress({id:"java",path:"legacy/java",data:{
  ownerUid:"student_1",courseId:"java",completed:["j1","j1"],reflections:{j1:"reviewed"}
 }},student);
 assert.deepEqual(row.completed,["j1"]);
 assert.equal(row.ownerUid,"student_1");
});

test("current season score must reconcile with award, mission state and course progress",()=>{
 const student={uid:"student_1",personId:"person_1"},season="2026.1",
  score={path:"legacy/score",data:{ownerUid:student.uid,season,points:50,completedCount:1,optIn:true,alias:"OldAlias"}},
  states=[{id:season+"_m1",path:"legacy/state",data:{
   ownerUid:student.uid,season,courseId:"java",missionId:"m1",completed:true,earnedPoints:50,wrongSubmissions:0
  }}],
  awards=[{id:season+"_m1",path:"legacy/award",data:{
   ownerUid:student.uid,season,courseId:"java",missionId:"m1",points:50,wrongSubmissions:0
  }}],
  progress=[{id:season+"_java",path:"legacy/progress",data:{
   ownerUid:student.uid,season,courseId:"java",completed:["m1"],missionScores:{m1:50}
  }}];
 const result=reconcileCurrentSeason({score,states,awards,progress,currentSeason:season,
  student,sections:new Set(["section_a"])});
 assert.equal(result.blockers.length,0);
 assert.equal(result.current.score.optIn,false);
 assert.equal(result.current.classRankings.length,1);
 assert.equal(result.reviewItems[0].type,"practice_legacy_public_opt_in_not_carried_forward");
 assert.doesNotThrow(()=>validateCurrent(result.current,student,season));
});

test("score mismatch becomes a blocker instead of recalculating silently",()=>{
 const result=reconcileCurrentSeason({
  score:{path:"legacy/score",data:{ownerUid:"student_1",season:"2026.1",points:80,completedCount:1}},
  states:[{id:"2026.1_m1",path:"legacy/state",data:{
   ownerUid:"student_1",season:"2026.1",courseId:"java",missionId:"m1",completed:true,earnedPoints:50
  }}],
  awards:[{id:"2026.1_m1",path:"legacy/award",data:{
   ownerUid:"student_1",season:"2026.1",courseId:"java",missionId:"m1",points:50
  }}],
  progress:[{id:"2026.1_java",path:"legacy/progress",data:{
   ownerUid:"student_1",season:"2026.1",courseId:"java",completed:["m1"],missionScores:{m1:50}
  }}],
  currentSeason:"2026.1",student:{uid:"student_1",personId:"person_1"},sections:new Set()
 });
 assert.equal(result.blockers.some(item=>item.type==="practice_score_points_mismatch"),true);
 assert.equal(result.current.score.points,80);
});

test("previous season head is archived rather than treated as current progress",()=>{
 const student={uid:"student_1",personId:"person_1"};
 const archive=historicalSeasonArchive({
  score:{path:"legacy/score",data:{season:"2025.2",points:120,completedCount:3,alias:"Alias",optIn:true}},
  states:[],awards:[],progress:[],student,currentSeason:"2026.1"
 });
 assert.equal(archive.season,"2025.2");
 assert.match(archive.targetPath,/practice_season_history\/student_1\/seasons\/season_/);
 assert.equal(archive.score.legacyOptIn,true);
});

test("flattened Practice migration never creates a public leaderboard target",()=>{
 const student={uid:"student_1",personId:"person_1",verifiedProgress:[],
  currentSeason:{
   score:{targetPath:"schools/mcs-manila/practice_season_scores/student_1",
    schoolId:"mcs-manila",ownerUid:"student_1",personId:"person_1",season:"2026.1",
    alias:canonicalAlias("student_1"),optIn:false,points:0,completedCount:0,
    publicId:canonicalPublicId("student_1"),migration:{}},
   missionStates:[],awards:[],courses:[],classRankings:[]
  },historicalSeason:null};
 const targets=flattenStudent(student,{planSha256:"a".repeat(64),currentSeason:"2026.1"});
 assert.equal(targets.some(item=>item.path.includes("practice_public_rankings")),false);
 assert.equal(targets.some(item=>item.type==="practice_season_score"),true);
});
