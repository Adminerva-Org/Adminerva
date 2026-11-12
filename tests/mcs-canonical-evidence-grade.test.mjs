import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);

const {
  v4Key,exactTask,normalizeGithubFrozen,convertStudioSnapshot,studioCandidate,
  legacyReclaimCandidate,legacyGradeCriteria,gradeCandidate
}=require("../functions/mcs-canonical-evidence-grade-plan.js");
const {
  validateExtension,validateGithub,validateStudio,validateReclaim,validateGrade,MAX_EXTENSION_MS
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

test("assessment evidence resolves only one reviewed task in the exact source/section context",()=>{
  const view={tasks:[
    {taskId:"task_a",sourceAssessmentId:"legacy_1",submissionSource:"github",
      migration:{legacySection:"ICT A"}},
    {taskId:"task_b",sourceAssessmentId:"legacy_1",submissionSource:"github",
      migration:{legacySection:"ICT B"}},
    {taskId:"task_c",sourceAssessmentId:"legacy_1",submissionSource:"studio",
      migration:{legacySection:"ICT A"}}
  ]};
  assert.equal(exactTask(view,"legacy_1","ICT A","github")?.taskId,"task_a");
  assert.equal(exactTask(view,"legacy_1","ICT B","github")?.taskId,"task_b");
  assert.equal(exactTask(view,"legacy_1","ICT A","studio")?.taskId,"task_c");
  assert.equal(exactTask(view,"legacy_1","", "github"),null);
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


test("legacy reclaim migration binds the claim to evidence history and preserves decided provenance",()=>{
  const commit="d".repeat(40),repo={owner:"Adminerva-Org",repo:"Adminerva",
    fullName:"Adminerva-Org/Adminerva",url:"https://github.com/Adminerva-Org/Adminerva"},
    task={taskId:"task_1",offeringId:"offer_1"},
    student={uid:"student_1",personId:"person_1"},
    evidence={evidenceId:"evidence_1",taskId:"task_1",studentUid:"student_1",repository:repo,
      versions:[{version:1,selectedCommitShas:[commit]}]},
    row={id:"legacy_claim",path:"commit_reclaims/legacy_claim",data:{
      status:"approved",sha:commit,repository:repo.url,studentId:"legacy_student",
      assessmentId:"legacy_assessment",section:"ICT A",
      explanation:"This commit is my individual contribution.",
      reviewNote:"Verified from the submitted project history."
    }},
    decision={data:{claimId:"legacy_claim",studentId:"legacy_student",sha:commit,
      decision:"approved",reason:"Verified from the submitted project history."}};
  const candidate=legacyReclaimCandidate({row,revisions:[],decision,task,student,evidence});
  assert.equal(candidate.ok,true);
  assert.equal(candidate.evidenceVersion,1);
  assert.equal(candidate.status,"approved");
  assert.doesNotThrow(()=>validateReclaim(candidate));
  assert.equal(legacyReclaimCandidate({
    row,revisions:[],decision:{data:{...decision.data,decision:"rejected"}},task,student,evidence
  }).reason,"reclaim_decision_provenance_mismatch");
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
  const studio={submissionId,schoolId:"mcs-manila",taskId:"task",offeringId:"offer",
    studentUid:"student",personId:"person",currentVersion:1,
    versions:[{schoolId:"mcs-manila",taskId:"task",offeringId:"offer",
      studentUid:"student",personId:"person",version:1,files,artifacts,contentDigest}],contentDigest};
  assert.doesNotThrow(()=>validateStudio(studio));
  assert.throws(()=>validateStudio({...studio,contentDigest:"0".repeat(64)}));
  assert.throws(()=>validateStudio({...studio,versions:[{...studio.versions[0],offeringId:"wrong"}]}));

  assert.doesNotThrow(()=>validateGrade({
    gradeId:v4Key("task","student"),taskId:"task",studentUid:"student",
    gradeSchema:"legacy_scalar_v1",criteria:[],awarded:75,pending:0,total:100
  }));
});


test("personalized Studio migration binds every frozen revision to its issued legacy variant",()=>{
 const variantId="c".repeat(24),legacyFingerprint="d".repeat(64),
  snapshot={schemaVersion:1,lang:"java",files:{"Main.java":"class Main {}"},
    fileOrder:["Main.java"],database:{tables:{},history:[]},design:{},config:{}},
  json=JSON.stringify(snapshot),snapshotHash=sha(json),
  task={taskId:"task_1",sourceAssessmentId:"assessment_1",ownerUid:"teacher_1",
    offeringId:"offer_1",dueAt:Date.now()+86400000,personalizedTask:{
      enabled:true,poolFingerprint:"e".repeat(64),variantIds:[variantId]},
    migration:{legacyPersonalizationFingerprint:legacyFingerprint}},
  student={uid:"student_1",personId:"person_1"},
  row={id:"legacy_student_assessment_1",path:"legacy/studio",data:{
    status:"submitted",ownerUid:"student_1",revision:1,snapshotHash,
    projectId:"project_1",variantId}},
  versions=[{id:"1",path:"legacy/studio/versions/1",data:{
    revision:1,snapshotJson:json,snapshotHash,projectId:"project_1",
    projectRevision:2,variantId,submittedAt:new Date()
  }}],
  assignments=[{id:"1",path:"legacy/variants/attempts/1",data:{
    assessmentId:"assessment_1",studentId:"legacy_student",attempt:1,variantId,
    poolFingerprint:legacyFingerprint,
    prompt:"Build the assigned Java scenario using inheritance, overriding, validation, and the required operations."
  }}];
 const candidate=studioCandidate({row,versions,assignments,task,student,legacyStudentId:"legacy_student"});
 assert.equal(candidate.ok,true);
 assert.equal(candidate.variantId,variantId);
 assert.equal(candidate.versions[0].variantId,variantId);
 assert.match(candidate.versions[0].variantPrompt,/assigned Java scenario/);
 assert.doesNotThrow(()=>validateStudio(candidate));
 assert.equal(studioCandidate({
   row,versions,assignments:[],task,student,legacyStudentId:"legacy_student"
 }).reason,"studio_personalized_attempt_provenance_missing");
});
