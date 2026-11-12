/** Packaged maintenance handler deployment contracts; no production SDK operations. */
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.GCLOUD_PROJECT = "demo-adminerva-contract";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8181";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9199";
const handlers = require("../functions/index.js");

test("existing notifications retain their deployed region instead of creating duplicate regional triggers",()=>{
  for(const handler of Object.values(handlers))assert.deepEqual(handler.__endpoint.region,["asia-southeast1"]);
});

test("scored practice handlers are bounded authenticated callables and roster updates are colocated",()=>{
  for(const name of ["practiceSession","practiceStart","practicePredict","practiceComplete"]){
    assert.equal(typeof handlers[name].run,"function");
    assert.deepEqual(handlers[name].__endpoint.region,["asia-southeast1"]);
    assert.equal(handlers[name].__endpoint.maxInstances,3);
    assert.equal(handlers[name].__endpoint.timeoutSeconds,30);
    assert.ok(handlers[name].__endpoint.callableTrigger);
  }
  assert.equal(handlers.teachingRosterChanged.__endpoint.eventTrigger.eventFilterPathPatterns.document,"students/{studentId}");
});

test("monitoring handlers stay colocated, bounded and independently scoped", () => {
  for (const name of ["monitoringMaintenance", "activityConsentChanged"]) {
    const handler = handlers[name];
    assert.equal(typeof handler.run, "function");
    assert.deepEqual(handler.__endpoint.region, ["asia-southeast1"]);
    assert.equal(handler.__endpoint.maxInstances, 1);
    assert.equal(handler.__endpoint.concurrency, 1);
  }
  assert.equal(handlers.monitoringMaintenance.__endpoint.scheduleTrigger.schedule, "every 60 minutes");
  assert.equal(handlers.monitoringMaintenance.__endpoint.timeoutSeconds, 240);
  assert.equal(handlers.activityConsentChanged.__endpoint.timeoutSeconds, 120);
  assert.equal(handlers.activityConsentChanged.__endpoint.eventTrigger.eventFilterPathPatterns.document, "activity_preferences/{ownerUid}");
});

test("Adminerva 4.0 school workflow callables are packaged in the intended region and bounds",()=>{
  const names=[
    "tenantSchools","teacherBlueprints","peopleDirectory","schoolRosterSource","schoolAcademics",
    "schoolAssessments","schoolStudentProfile","schoolStudioProjects","schoolStudioSubmissions",
    "schoolGradebook","schoolGithubEvidence","schoolReclaims","acceptSchoolInvitation",
    "platformSchools","schoolSupport","schoolFilePolicy","schoolDataExport","schoolAnalytics",
    "schoolPracticeAnalytics","schoolTeacherAnalytics","schoolCutoverReadiness",
    "schoolOnboardingReadiness","schoolPlanning","schoolSchedules","schoolReferences",
    "schoolSharedReferences","schoolAI"
  ];
  for(const name of names){
    const handler=handlers[name];
    assert.ok(handler,name+" must be exported by functions/index.js");
    assert.equal(typeof handler.run,"function",name+" must be a callable handler");
    assert.deepEqual(handler.__endpoint.region,["asia-southeast1"]);
    assert.equal(handler.__endpoint.maxInstances,3);
    assert.equal(handler.__endpoint.concurrency,10);
    assert.equal(handler.__endpoint.timeoutSeconds,120);
    assert.ok(handler.__endpoint.callableTrigger,name+" must remain an HTTPS callable");
  }
  assert.deepEqual(handlers.schoolFileRetentionCleanup.__endpoint.region,["asia-southeast1"]);
  assert.equal(handlers.schoolFileRetentionCleanup.__endpoint.maxInstances,1);
  assert.equal(handlers.schoolFileRetentionCleanup.__endpoint.timeoutSeconds,300);
});

