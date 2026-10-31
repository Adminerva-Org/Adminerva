import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {parseLegacyRubric,legacySubmissionSource,deploymentWindow,offeringFor}=
  require("../functions/mcs-canonical-assessment-plan.js");

test("generated legacy point rubrics convert only when totals match",()=>{
 const parsed=parseLegacyRubric(
  "1. Task requirements — 40 points: Requested features\n2. Correctness — 30 points\n3. Clarity — 30 points",100);
 assert.equal(parsed.ok,true);
 assert.deepEqual(parsed.rubric.map(row=>row.points),[40,30,30]);
 assert.equal(parseLegacyRubric("Excellent work",100).ok,false);
 assert.equal(parseLegacyRubric("1. Correctness — 30 points",100).reason,"rubric_total_mismatch");
});
test("legacy submission source maps V2 to GitHub and V3 to Studio only",()=>{
 assert.equal(legacySubmissionSource({schemaVersion:2,evidenceMode:"commit_selection"}),"github");
 assert.equal(legacySubmissionSource({schemaVersion:3,submissionSource:"studio"}),"studio");
 assert.equal(legacySubmissionSource({schemaVersion:1}),null);
});
test("deployment window preserves exact ISO dates and explicit no-deadline semantics",()=>{
 const timed=deploymentWindow({},{
  section:"ICT A",deadlineEnabled:true,
  postDate:"2026-10-01T00:00:00.000Z",deadline:"2026-10-10T23:59:59.999Z"
 });
 assert.equal(timed.ok,true);assert.equal(timed.source,"deployment_iso");
 const open=deploymentWindow({},{section:"ICT A",deadlineEnabled:false});
 assert.equal(open.ok,true);assert.equal(open.legacyNoDeadline,true);
 assert.equal(open.dueAt,Date.parse("2100-01-01T00:00:00.000Z"));
});
test("offering mapping requires exactly one approved section/subject course offering",()=>{
 const approval={academic:{
  sections:[{approved:true,legacyLabel:"ICT A",targetId:"sec_a"}],
  subjects:[{approved:true,legacyLabel:"Programming",targetId:"sub_prog"}],
  terms:[],years:[]
 }};
 const approved={offerings:[
  {offeringId:"off_a",sectionId:"sec_a",subjectId:"sub_prog",termId:"term_1",yearId:"yr_1"}
 ]};
 const result=offeringFor({assessment:{subject:"Programming"},deployment:{section:"ICT A"},approval,approved});
 assert.equal(result.ok,true);assert.equal(result.offeringId,"off_a");
 approved.offerings.push({offeringId:"off_b",sectionId:"sec_a",subjectId:"sub_prog",termId:"term_2",yearId:"yr_1"});
 assert.equal(offeringFor({assessment:{subject:"Programming"},deployment:{section:"ICT A"},approval,approved}).reason,
  "offering_mapping_ambiguous");
});
