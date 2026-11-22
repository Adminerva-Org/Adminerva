import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  assessmentDraftKey,draftPayload,sameDraftPayload,readDeviceAssessmentDraft,
  writeDeviceAssessmentDraft,preserveRecoveryAssessmentDraft,readRecoveryAssessmentDraft,
  clearDeviceAssessmentDraft
} from "../js/student/assessment-draft-recovery.mjs";

function storage({limit=false}={}){
  const items=new Map();
  return {
    getItem:key=>items.get(key)??null,
    setItem:(key,value)=>{if(limit)throw Error("quota exceeded");items.set(key,value);},
    removeItem:key=>items.delete(key)
  };
}
const context={uid:"learner-uid",schoolId:"school-one",taskId:"task-one",source:"text"};
test("a student recovery draft is distinct per school, login, task and response type",()=>{
  assert.notEqual(assessmentDraftKey(context),assessmentDraftKey({...context,uid:"other"}));
  assert.notEqual(assessmentDraftKey(context),assessmentDraftKey({...context,schoolId:"school-two"}));
  assert.notEqual(assessmentDraftKey(context),assessmentDraftKey({...context,taskId:"other"}));
  assert.notEqual(assessmentDraftKey(context),assessmentDraftKey({...context,source:"link"}));
  const db=storage(),payload={response:"Student code / explanation\nUnicode: ß 一"};
  assert.equal(writeDeviceAssessmentDraft(db,context,{payload,pending:true,revision:2,submissionVersion:0}),true);
  assert.deepEqual(readDeviceAssessmentDraft(db,context).payload,payload);
  assert.equal(readDeviceAssessmentDraft(db,{...context,uid:"other"}),null);
  assert.equal(readDeviceAssessmentDraft(db,{...context,schoolId:"other"}),null);
});
test("unfinished text and links can be saved before they satisfy final submission validation",()=>{
  assert.deepEqual(draftPayload("text",{response:""}),{response:""});
  assert.deepEqual(draftPayload("link",{url:"https://not-complete",note:"not yet done"}),{
    url:"https://not-complete",note:"not yet done"});
  assert.equal(sameDraftPayload("link",{url:"",note:"a"},{url:"",note:"b"}),false);
  assert.equal(sameDraftPayload("text",{response:"a"},{response:"a"}),true);
});
test("losing drafts have discoverable local recovery copies even after active draft clears",()=>{
  const db=storage(),payload={response:"Unsynced draft on computer A"};
  assert.equal(preserveRecoveryAssessmentDraft(db,context,{
    ...context,payload,pending:true,revision:3}),true);
  assert.equal(writeDeviceAssessmentDraft(db,context,{
    payload:{response:"Cloud draft from computer B"},pending:false,revision:4}),true);
  clearDeviceAssessmentDraft(db,context);
  assert.equal(readDeviceAssessmentDraft(db,context),null);
  assert.deepEqual(readRecoveryAssessmentDraft(db,context).payload,payload);
});
test("storage corruption or quota pressure never creates a false confirmed save",()=>{
  const db=storage({limit:true});
  assert.equal(writeDeviceAssessmentDraft(db,context,{
    payload:{response:"Unsent"},pending:true}),false);
  assert.equal(preserveRecoveryAssessmentDraft(db,context,{
    payload:{response:"Unsent"}}),false);
  assert.equal(readDeviceAssessmentDraft(db,context),null);
  const bad=storage();
  bad.setItem(assessmentDraftKey(context),"{incomplete");
  assert.equal(readDeviceAssessmentDraft(bad,context),null);
});
test("school draft and submitted evidence remain server-authoritative and separate",()=>{
  const backend=readFileSync("functions/school-assessment-submissions.js","utf8");
  const rules=readFileSync("firestore.rules","utf8");
  assert.match(backend,/if\(input\.action==="get_draft"\)/);
  assert.match(backend,/if\(input\.action==="save_draft"\)/);
  assert.match(backend,/assessment_response_drafts\//);
  assert.match(backend,/verifyMembership\(tx,"student"\)/);
  assert.match(backend,/rowKey\(personId,offeringId\)/);
  assert.match(backend,/newer cloud draft is already saved/);
  assert.match(backend,/tx\.delete\(draftRef\)/);
  const indexPolicy=JSON.parse(readFileSync("firestore.indexes.json","utf8"));
  assert.deepEqual(indexPolicy.fieldOverrides.find(row=>
    row.collectionGroup==="assessment_response_drafts"&&row.fieldPath==="payload"),{
      collectionGroup:"assessment_response_drafts",fieldPath:"payload",indexes:[]
    });
  assert.match(rules,/match \/schools\/\{schoolId\}\/\{record=\*\*\} \{ allow read, write: if false;/);
});

test("recovered student cloud drafts use canonical person identity and preserve historical submission ownership",()=>{
  const backend=readFileSync("functions/school-assessment-submissions.js","utf8");
  assert.match(backend,/assessment_response_drafts\/"\+hash\(ctx\.schoolId,taskId,personId\)/);
  assert.match(backend,/resolveStudentSubmission\(personId,person\.data\(\),ref=>tx\.get\(ref\)\)/);
  assert.match(backend,/studentRecordUidAllowed\(person\.data\(\),ctx\.uid,submission\.data\(\)\.studentUid\)/);
  assert.match(backend,/tx\.delete\(draftRef\)/);
});
