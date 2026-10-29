import test from "node:test";
import assert from "node:assert/strict";
import {studioEvidenceId,studioSubmissionAllowed,snapshotStudioProject,verifyStudioSnapshot} from "./studio-assessment-model.mjs";

const assessment={schemaVersion:3,submissionSource:"studio",deployments:[
  {section:"12-A",postDate:"2026-10-30T00:00:00Z",deadline:"2026-11-02T00:00:00Z",deadlineEnabled:true}
]};
const project={id:"p1",title:"Library System",database:{tables:{},history:[]},design:{classDiagram:"classDiagram"},config:{runMode:"console"}};
const state={lang:"java",files:{"Main.java":"public class Main{}"},fileOrder:["Main.java"]};
test("Studio dates disallow wrong class, closed, not opened and repository-only tasks",()=>{
  assert.equal(studioSubmissionAllowed(assessment,"12-A",Date.parse("2026-10-31")).allowed,true);
  assert.equal(studioSubmissionAllowed(assessment,"12-A",Date.parse("2026-10-29")).allowed,false);
  assert.equal(studioSubmissionAllowed(assessment,"12-A",Date.parse("2026-11-03")).allowed,false);
  assert.equal(studioSubmissionAllowed(assessment,"12-B",Date.parse("2026-10-31")).allowed,false);
  assert.equal(studioSubmissionAllowed({...assessment,schemaVersion:2},"12-A",Date.parse("2026-10-31")).allowed,false);
});
test("Studio snapshots retain files, schema and design independent of future project edits",()=>{
  const result=snapshotStudioProject(project,state);
  const original=JSON.parse(result.json);
  state.files["Main.java"]="changed after submission";
  project.database.tables.users={columns:[],rows:[]};
  assert.equal(original.files["Main.java"],"public class Main{}");
  assert.deepEqual(original.database.tables,{});
  assert.equal(verifyStudioSnapshot(result.json,"a".repeat(64)).lang,"java");
});
test("reject path traversal, duplicate file order and oversized snapshots",()=>{
  assert.throws(()=>snapshotStudioProject(project,{...state,files:{"../secret.txt":"bad"},fileOrder:["../secret.txt"]}),/invalid/);
  assert.throws(()=>snapshotStudioProject(project,{...state,fileOrder:["Main.java","Main.java"]}),/invalid/);
  assert.throws(()=>snapshotStudioProject(project,{...state,files:{"Main.java":"x".repeat(350000)},fileOrder:["Main.java"]}),/too large/);
});
test("identity rejects slash and empty records",()=>{
  assert.equal(studioEvidenceId("student@school.edu","task.1"),"student@school.edu_task.1");
  assert.throws(()=>studioEvidenceId("student/x","task"),/identity/);
});
