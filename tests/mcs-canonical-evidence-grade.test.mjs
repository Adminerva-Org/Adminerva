import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);

const {
  v4Key,normalizeGithubFrozen,convertStudioSnapshot,
  legacyGradeCriteria,gradeCandidate
}=require("../functions/mcs-canonical-evidence-grade-plan.js");
const {
  validateExtension,validateGithub,validateStudio,validateGrade,MAX_EXTENSION_MS
}=require("../functions/mcs-canonical-evidence-grade-apply.js");
const {digestEvidence}=require("../functions/school-github-evidence.js");
const {digestProject}=require("../functions/school-studio-projects.js");

const sha=value=>createHash("sha256").update(value).digest("hex");

test("canonical evidence and grade IDs match runtime hash contracts",()=>{
  const school="mcs-manila",task="task_1",uid="uid_1";
  assert.equal(v4Key(school,task,uid),
    createHash("sha256").update(JSON.stringify([school,task,uid])).digest("hex"));
  assert.equal(v4Key(task,uid),
    createHash("sha256").update(JSON.stringify([task,uid])).digest("hex"));
});

test("GitHub frozen evidence normalizes repository and verifies canonical digest",()=>{
  const checkpoint="a".repeat(40),selected=["b".repeat(40),checkpoint];
  const frozen=normalizeGithubFrozen({
    repository:"https://github.com/Adminerva-Org/Adminerva",
    selectedCommits:selected,checkpointSha:checkpoint
  });
  assert.equal(frozen.ok,true);
  assert.equal(frozen.repository.fullName,"Adminerva-Org/Adminerva");
  assert.equal(frozen.evidenceDigest,
    digestEvidence(frozen.repository,frozen.selectedCommitShas,checkpoint));
});

test("Studio snapshot checksum converts to current files/artifact digest without mutation",()=>{
  const snapshot={
    schemaVersion:1,lang:"java",
    files:{"Main.java":"class Main {}","README.md":"Test"},
    fileOrder:["Main.java","README.md"],
    database:{tables:{},history:[]},design:{theme:"plain"},config:{entry:"Main.java"}
  };
  const json=JSON.stringify(snapshot),converted=convertStudioSnapshot({
    snapshotJson:json,snapshotHash:sha(json)
  });
  assert.equal(converted.ok,true);
  assert.deepEqual(converted.files.map(file=>file.path),["Main.java","README.md"]);
  assert.equal(converted.contentDigest,digestProject(converted.files,converted.artifacts));
  assert.equal(convertStudioSnapshot({snapshotJson:json,snapshotHash:"0".repeat(64)}).ok,false);
});

test("multi-criterion manual scalar grade is preserved as compatibility data, not invented criteria",()=>{
  const task={taskId:"task_1",ownerUid:"teacher_1",offeringId:"offer_1",
    submissionSource:"github",
    rubric:[{name:"Correctness",points:60},{name:"Clarity",points:40}]};
  const raw={score:87,maxScore:100,published:true,feedback:"Reviewed.",gradedSha:"c".repeat(40),evidenceRevision:3};
  assert.equal(legacyGradeCriteria(raw,task).reason,"grade_criterion_breakdown_missing");
  const github={evidenceId:v4Key("mcs-manila","task_1","student_1"),
    currentVersion:1,evidenceDigest:"d".repeat(64),checkpointSha:"c".repeat(40),
    status:"approved",migration:{legacyRevision:3}};
  const candidate=gradeCandidate({
    row:{path:"legacy/grade",id:"legacy_grade",data:raw},task,
    student:{uid:"student_1",personId:"person_1"},github,studio:null,revisions:[]
  });
  assert.equal(candidate.ok,true);
  assert.equal(candidate.gradeSchema,"legacy_scalar_v1");
  assert.deepEqual(candidate.criteria,[]);
  assert.equal(candidate.awarded,87);
  assert.equal(candidate.total,100);
});

test("migration revision extensions are explicit, future-dated and capped at 30 days",()=>{
  const now=Date.parse("2026-10-31T07:00:00.000Z");
  assert.equal(validateExtension({requiresRevisionExtension:false,revisionExtensionDueAt:""},now),null);
  assert.equal(validateExtension({
    requiresRevisionExtension:true,
    revisionExtensionDueAt:new Date(now+7*24*60*60*1000).toISOString()
  },now),now+7*24*60*60*1000);
  assert.throws(()=>validateExtension({
    requiresRevisionExtension:true,
    revisionExtensionDueAt:new Date(now-1000).toISOString()
  },now));
  assert.throws(()=>validateExtension({
    requiresRevisionExtension:true,
    revisionExtensionDueAt:new Date(now+MAX_EXTENSION_MS+1).toISOString()
  },now));
});

test("apply candidate validators reject stale immutable heads",()=>{
  const repo={owner:"Adminerva-Org",repo:"Adminerva",fullName:"Adminerva-Org/Adminerva",
    url:"https://github.com/Adminerva-Org/Adminerva"};
  const checkpoint="a".repeat(40),selected=[checkpoint],evidenceDigest=digestEvidence(repo,selected,checkpoint);
  const evidenceId=v4Key("mcs-manila","task","student");
  const github={evidenceId,taskId:"task",studentUid:"student",currentVersion:1,
    versions:[{version:1,repository:repo,selectedCommitShas:selected,checkpointSha:checkpoint,evidenceDigest}],
    repository:repo,selectedCommitShas:selected,checkpointSha:checkpoint,evidenceDigest,status:"submitted"};
  assert.doesNotThrow(()=>validateGithub(github));
  assert.throws(()=>validateGithub({...github,evidenceDigest:"0".repeat(64)}));

  const files=[{path:"Main.java",content:"class Main {}"}],
    artifacts={database:{tables:{},history:[]},design:{},config:{},evidence:{events:[],runs:[]}},
    contentDigest=digestProject(files,artifacts);
  const submissionId=v4Key("mcs-manila","task","student");
  const studio={submissionId,taskId:"task",studentUid:"student",currentVersion:1,
    versions:[{version:1,files,artifacts,contentDigest}],contentDigest};
  assert.doesNotThrow(()=>validateStudio(studio));
  assert.throws(()=>validateStudio({...studio,contentDigest:"0".repeat(64)}));

  assert.doesNotThrow(()=>validateGrade({
    gradeId:v4Key("task","student"),taskId:"task",studentUid:"student",
    gradeSchema:"legacy_scalar_v1",criteria:[],awarded:75,pending:0,total:100
  }));
});
