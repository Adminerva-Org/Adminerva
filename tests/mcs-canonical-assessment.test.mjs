import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {parseLegacyRubric,legacySubmissionSource,deploymentWindow,offeringFor,personalizationPlan}=
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


test("personalized migration requires the exact activated private pool and rewrites only the canonical fingerprint",()=>{
 const legacyFingerprint="a".repeat(64),variantId="b".repeat(24),
  blueprint={title:"Personalized Java task",description:"",instructions:"Build the assigned system.",
    rubric:[{name:"Correctness",points:5},{name:"OOP",points:5}]},
  legacy={
    schemaVersion:3,submissionSource:"studio",
    personalizedTask:{enabled:true,mode:"ai_blueprint_pool_v1",
      poolFingerprint:legacyFingerprint,poolSize:1,poolTarget:10},
    personalization:{mode:"ai_blueprint_pool_v1",fingerprint:legacyFingerprint,
      variantIds:[variantId],guidance:"Vary the domain while keeping the same OOP skills."}
  },
  variantRows:[{id:variantId,path:"mirror/variant",digest:"digest",data:{
    variantId,fingerprint:legacyFingerprint,scenarioKey:"library_system",
    scenarioTitle:"Library System",summary:"Console library workflow",
    prompt:"Create a Java console library system with classes, inheritance, overridden methods, and two required operations.",
    evaluationNotes:"Apply only the published rubric and verify the required OOP behavior."
  }}];
 const result=personalizationPlan({legacy,variantRows,blueprint});
 assert.equal(result.ok,false); // target is intentionally incomplete
 assert.equal(result.reason,"personalization_target_incomplete");
 legacy.personalizedTask.poolTarget=1; // invalid canonical minimum remains rejected
 assert.equal(personalizationPlan({legacy,variantRows,blueprint}).reason,"personalization_target_incomplete");
 // A complete 10-variant activated pool is accepted.
 legacy.personalizedTask.poolTarget=10;
 legacy.personalizedTask.poolSize=10;
 legacy.personalization.variantIds=Array.from({length:10},(_,i)=>
   createRequire(import.meta.url) && (i.toString(16).padStart(2,"0")+"b".repeat(22)));
 const rows=legacy.personalization.variantIds.map((id,index)=>({id,path:"mirror/"+id,digest:"d"+index,data:{
   variantId:id,fingerprint:legacyFingerprint,scenarioKey:"scenario_"+index,
   scenarioTitle:"Scenario "+index,summary:"Variant "+index,
   prompt:"Create a Java console application for scenario "+index+" with inheritance, overriding, validation, and two required operations.",
   evaluationNotes:"Use the published rubric only and verify the required scenario behavior."
 }}));
 const accepted=personalizationPlan({legacy,variantRows:rows,blueprint});
 assert.equal(accepted.ok,true);
 assert.equal(accepted.pool.variantIds.length,10);
 assert.equal(accepted.pool.legacyFingerprint,legacyFingerprint);
 assert.notEqual(accepted.pool.fingerprint,legacyFingerprint);
 assert.equal(accepted.task.poolFingerprint,accepted.pool.fingerprint);
});
