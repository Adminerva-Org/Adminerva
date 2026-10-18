/** Regression coverage: Student submissions, practice progress and isolated code workspaces: assessment state. */
import test from "node:test";
import assert from "node:assert/strict";
import {asDate,assessmentStatus,assessmentTargetDetails} from "./assessment-state.mjs";
test("historical Firestore and ISO timestamps are safe",()=>{
  assert.equal(asDate({toDate:()=>new Date("2026-09-13T00:00:00Z")}).getUTCFullYear(),2026);
  assert.equal(asDate("2026-09-13T00:00:00Z").getUTCFullYear(),2026);
  assert.equal(asDate("invalid"),null);
});
test("submitted work is not mislabeled not submitted even after deadline",()=>{
  const input={submitted:true,deadline:"2026-01-01",now:new Date("2026-10-16")};
  assert.equal(assessmentStatus(input).kind,"submitted");
});
test("publication and explicit revision requests take precedence",()=>{
  assert.equal(assessmentStatus({grade:{published:true},submitted:true}).kind,"graded");
  assert.equal(assessmentStatus({grade:{published:true,needsRevision:true}}).kind,"revision");
});
test("missing submission query cannot silently assert non-submission",()=>{
  assert.equal(assessmentStatus({knownSubmissions:false}).kind,"unknown");
});


test('V2 evidence states are independent of legacy submission receipts',()=>{
  assert.deepEqual(assessmentStatus({evidenceStatus:'needs_review'}),{
    kind:'evidence',text:'Evidence discovered — awaiting review'
  });
  assert.deepEqual(assessmentStatus({evidenceStatus:'approved'}),{
    kind:'reviewed',text:'Checkpoint approved'
  });
  assert.deepEqual(assessmentStatus({evidenceStatus:'submitted'}),{
    kind:'submitted',text:'Evidence submitted for review'
  });
});

test("V2 assessment displays targetPaths even when legacy targetPath is absent",()=>{
  assert.deepEqual(assessmentTargetDetails({
    targetPaths:["**/res/layout/*.xml"],expectedExtensions:["xml"]
  }),{paths:"**/res/layout/*.xml",expectedTypes:".xml"});
});
test("expected XML file type never masquerades as a target path",()=>{
  assert.deepEqual(assessmentTargetDetails({targetPaths:[],expectedExtensions:["xml"]}),{
    paths:"Any path",expectedTypes:".xml"
  });
});
test("legacy targetPath remains visible and types are distinct",()=>{
  assert.deepEqual(assessmentTargetDetails({targetPath:"src/Main.java"}),{
    paths:"src/Main.java",expectedTypes:""
  });
});
test("target display trims, joins and deduplicates valid extensions",()=>{
  assert.deepEqual(assessmentTargetDetails({
    targetPaths:[" app/src/main/res/layout/*.xml ","**/res/layout/*.xml",""],
    expectedExtensions:["XML",".xml"," java ","bad!"]
  }),{paths:"app/src/main/res/layout/*.xml, **/res/layout/*.xml",expectedTypes:".xml, .java"});
});
