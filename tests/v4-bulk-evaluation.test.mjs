import test from "node:test";
import assert from "node:assert/strict";
import {
  BULK_PACKAGE_FORMAT,BULK_RESPONSE_FORMAT,BULK_MAX_BATCH,BULK_GITHUB_MAX_BATCH,bulkBatchLimit,
  bulkSuggestionState,readBulkExternalResponse,bulkSaveableStages,
  nextBulkSelection,canClearCompletedBulkExchange,
  BULK_COMPACT_PACKAGE_FORMAT,buildCompactBulkExternalEvaluationPackage,
  fitCompactBulkExternalEvaluationPackage,
  BULK_SOURCE_TYPES,BULK_MAX_PACKAGE_CHARACTERS,assertBulkEvidence
} from "../js/repo-review/v4-bulk-evaluation.mjs";
import {
  buildGeneralExternalEvaluationData,buildGeneralExternalEvaluationPackage,
  parseGeneralExternalEvaluationResponse
} from "../js/assessment/general-external-evaluation.mjs";

const task={rubric:[{name:"OOP",points:20},{name:"Correctness",points:20}]};
const suggestion=({
 format:"adminerva-general-external-evaluation-response-v1",
 criteria:[
  {name:"OOP",maximumPoints:20,awardedPoints:18,pendingPoints:0,
   comment:"Inheritance and overriding demonstrated",rationale:"Source contains derived class with override",confidence:"high"},
  {name:"Correctness",maximumPoints:20,awardedPoints:17,pendingPoints:0,
   comment:"Correct conditional behavior",rationale:"Source shows expected logic and outputs",confidence:"moderate"}
 ],
 feedback:"Implementation demonstrates inheritance with generally correct behavior.",
 limitations:"Runtime confirmation may be unavailable."
});
test("bulk response validates exact anonymous batch identity and rubric order",()=>{
 const batchId="batch-one",ref="anonymous-3";
 const rows=readBulkExternalResponse(JSON.stringify({
  format:BULK_RESPONSE_FORMAT,batchId,results:[{ref,response:suggestion}]
 }),{batchId,allowedRefs:new Map([[ref,{recordId:"private-student"}]]),
  task,parseResponse:parseGeneralExternalEvaluationResponse});
 assert.equal(rows.length,1);
 assert.equal(rows[0].review.awarded,35);
 assert.equal(rows[0].review.pending,0);
 assert.equal(rows[0].review.saveEligible,true);
 assert.match(rows[0].review.criteria[0].comment,/Evidence: Source contains derived class/);
 assert.equal(BULK_MAX_BATCH,20);
 assert.equal(BULK_MAX_PACKAGE_CHARACTERS,800000);
 assert.equal(BULK_GITHUB_MAX_BATCH,10);
 assert.equal(bulkBatchLimit("github"),10);
 assert.equal(bulkBatchLimit("studio"),20);
 assert.match(BULK_PACKAGE_FORMAT,/bulk-evaluation-package-v2/);
});
test("zero scores and unresolved rubric points are not eligible for saving",()=>{
 const zero={...suggestion,criteria:suggestion.criteria.map(x=>({...x,awardedPoints:0}))};
 const score=bulkSuggestionState(parseGeneralExternalEvaluationResponse(JSON.stringify(zero),{task}),task);
 assert.equal(score.saveEligible,false);
 assert.match(score.reason,/Zero-score/);
 const pending={...suggestion,criteria:[{...suggestion.criteria[0],pendingPoints:2},
  suggestion.criteria[1]]};
 const held=bulkSuggestionState(parseGeneralExternalEvaluationResponse(JSON.stringify(pending),{task}),task);
 assert.equal(held.saveEligible,false);
 assert.match(held.reason,/Unresolved/);
});
test("rejects wrong batch, duplicate refs, unknown refs and rubric changes",()=>{
 const allowedRefs=new Map([["t1",{}],["t2",{}]]);
 const ctx={batchId:"b1",allowedRefs,task,parseResponse:parseGeneralExternalEvaluationResponse};
 const response=(batchId,results)=>JSON.stringify({format:BULK_RESPONSE_FORMAT,batchId,results});
 assert.throws(()=>readBulkExternalResponse(response("b2",[{ref:"t1",response:suggestion}]),ctx),/batch format|request ID/i);
 assert.throws(()=>readBulkExternalResponse(response("b1",[{ref:"wrong",response:suggestion}]),ctx),/unknown|duplicated/i);
 assert.throws(()=>readBulkExternalResponse(response("b1",[
  {ref:"t1",response:suggestion},{ref:"t1",response:suggestion}
 ]),ctx),/unknown|duplicated/i);
 const wrong={...suggestion,criteria:[{...suggestion.criteria[0],name:"Altered criterion"},
  suggestion.criteria[1]]};
 assert.throws(()=>readBulkExternalResponse(response("b1",[{ref:"t1",response:wrong}]),ctx),/rubric|criterion/i);
});
test("feedback and score validation fail closed without writing grades",()=>{
 const bad={...suggestion,feedback:"Short"};
 assert.throws(()=>bulkSuggestionState(bad,task),/20 characters/);
 const over={...suggestion,criteria:[{awardedPoints:22,pendingPoints:0},suggestion.criteria[1]]};
 assert.throws(()=>bulkSuggestionState(over,task),/Invalid evaluation score/);
});

test("teacher-confirmation confidence is not eligible for automatic bulk saving",()=>{
 const needsReview={...suggestion,criteria:[
  {...suggestion.criteria[0],confidence:"teacher_confirmation"},
  suggestion.criteria[1]
 ]};
 const parsed=parseGeneralExternalEvaluationResponse(JSON.stringify(needsReview),{task});
 const stage=bulkSuggestionState(parsed,task);
 assert.equal(stage.saveEligible,false);
 assert.equal(stage.teacherConfirmation,true);
 assert.match(stage.reason,/teacher confirmation/i);
});

test("external JSON imports remain saveable after the original roster selection is cleared",()=>{
 const staged=new Map([["student-1",{key:"student-1",version:1,review:{
   saveEligible:true,awarded:20,pending:0
 }}]]);
 const saveSelection=new Set(["student-1"]);
 const rows=[{submissionId:"student-1",version:1,status:"submitted",gradeStatus:null}];
 // The original evaluation roster is intentionally not provided. This must
 // remain saveable even when "Clear selection" was clicked after export.
 assert.equal(bulkSaveableStages({staged,saveSelection,rows}).length,1);
 assert.equal(bulkSaveableStages({staged,saveSelection:new Set(),rows}).length,0);
});
test("private-draft save selection excludes existing grades, resubmissions and exceptions",()=>{
 const staged=new Map([
  ["a",{key:"a",version:1,review:{saveEligible:true}}],
  ["b",{key:"b",version:1,review:{saveEligible:true}}],
  ["c",{key:"c",version:1,review:{saveEligible:true}}],
  ["d",{key:"d",version:1,review:{saveEligible:true}}],
  ["e",{key:"e",version:1,review:{saveEligible:false}}]
 ]);
 const saveSelection=new Set(staged.keys());
 const rows=[
  {submissionId:"a",version:1,status:"submitted",gradeStatus:null},
  {submissionId:"b",version:1,status:"reviewed",gradeStatus:"draft"},
  {submissionId:"c",version:2,status:"submitted",gradeStatus:null},
  {submissionId:"d",version:1,status:"reopened",gradeStatus:null},
  {submissionId:"e",version:1,status:"submitted",gradeStatus:null}
 ];
 assert.deepEqual(bulkSaveableStages({staged,saveSelection,rows}).map(x=>x.key),["a"]);
});

test("20-learner selection advances to the next 20 ungraded records",()=>{
 const rows=Array.from({length:88},(_,i)=>({
   submissionId:"submitted-"+String(i+1).padStart(3,"0"),
   version:1,status:"submitted",gradeStatus:null
 }));
 const first=nextBulkSelection(rows);
 assert.equal(first.length,20);
 assert.equal(first[0],rows[0].submissionId);
 assert.equal(first.at(-1),rows[19].submissionId);
 for(const row of rows.slice(0,20))row.gradeStatus="draft";
 const next=nextBulkSelection(rows);
 assert.equal(next.length,20);
 assert.equal(next[0],rows[20].submissionId);
 assert.equal(next.at(-1),rows[39].submissionId);
 assert.equal(new Set([...first,...next]).size,40);
});
test("new batches exclude exceptions, staged work and reopened submissions",()=>{
 const rows=[
  {submissionId:"graded",gradeStatus:"published",status:"reviewed"},
  {submissionId:"reopened",gradeStatus:null,status:"reopened"},
  {submissionId:"pending",gradeStatus:null,status:"submitted"},
  {submissionId:"error",gradeStatus:null,status:"submitted"},
  {submissionId:"good",gradeStatus:null,status:"submitted"},
  {recordId:"native",gradeStatus:null,status:"submitted"}
 ];
 assert.deepEqual(nextBulkSelection(rows,{
   excluded:new Set(["pending","error"])
 }),["good","native"]);
 assert.deepEqual(nextBulkSelection(rows,{limit:1}),["pending"]);
 assert.deepEqual(nextBulkSelection(rows,{limit:50}).length,4);
 assert.deepEqual(nextBulkSelection(rows,{limit:0}),[]);
});
test("completed ten-item external batch can clear its package and imported response",()=>{
 const rows=Array.from({length:10},(_,i)=>({
   submissionId:"s"+i,gradeStatus:null
 }));
 const referenceMap=new Map(rows.map((row,i)=>[
   "anonymous"+i,{key:row.submissionId}
 ]));
 const savedIds=new Set(rows.map(row=>row.submissionId));
 assert.equal(canClearCompletedBulkExchange({
   referenceMap,staged:new Map(),rows,savedIds
 }),true);
});
test("partial saves preserve original JSON batch mapping and unsaved graded suggestions",()=>{
 const rows=[{submissionId:"one",gradeStatus:null},{submissionId:"two",gradeStatus:null}];
 const referenceMap=new Map([
  ["ref1",{key:"one"}],["ref2",{key:"two"}]
 ]);
 assert.equal(canClearCompletedBulkExchange({
   referenceMap,staged:new Map(),rows,savedIds:new Set(["one"])
 }),false);
 assert.equal(canClearCompletedBulkExchange({
   referenceMap,
   staged:new Map([["two",{key:"two",review:{saveEligible:false}}]]),
   rows,savedIds:new Set(["one"])
 }),false);
 rows[1].gradeStatus="draft";
 assert.equal(canClearCompletedBulkExchange({
   referenceMap,staged:new Map(),rows,savedIds:new Set(["one"])
 }),true);
 assert.equal(canClearCompletedBulkExchange({
   referenceMap,staged:new Map(),rows:[rows[0]],savedIds:new Set(["one"])
 }),false); // A missing historical receipt must not silently discard its reference.
});

const compactAssessment={
 title:"Quarter 3 Java OOP individualized performance task",
 description:"Build a scenario-specific Java console information system.",
 instructions:"Demonstrate encapsulation, inheritance, polymorphism, abstraction and an interface. Use the assigned scenario. Do not assume a GUI.",
 personalizedTask:{enabled:true},submissionSource:"studio",
 rubric:[{name:"OOP principles",points:10},{name:"Program behavior",points:10}],
 rubricMax:20
};
function compactExample(index,{checking="Use the published rubric and inspect all frozen files."}={}){
 const snapshot={
   version:1,contentDigest:"c".repeat(64),sourceDigest:"d".repeat(64),
   sourceLanguage:"java",
   files:[{path:"Main.java",content:"public class Main { // project "+index+
     "\n  public static void main(String[] args) { System.out.println("+index+"); }\n}"}],
   personalizedTask:{
     variantId:"variant-"+index,
     prompt:"Build a console management system for scenario "+index+" with the five required OOP skills.",
     evaluationNotes:"Verify scenario "+index+" applies the published rubric."
   },
   automaticVerification:{matchesSubmittedSource:true,status:"success",
     compile:{attempted:true,succeeded:true,status:"compiled"}},
   executionEvidence:{runs:[]}
 };
 return {ref:"anonymous-ref-"+index,evaluationData:buildGeneralExternalEvaluationData({
   task:compactAssessment,snapshot,checkingInstructions:checking
 }),snapshot,checking};
}
test("compact batch stores the published rubric and checking rules once while preserving every personalized source",()=>{
 const originals=Array.from({length:10},(_,i)=>compactExample(i));
 const pack=buildCompactBulkExternalEvaluationPackage({
   batchId:"batch-compact",entries:originals,task:compactAssessment
 });
 assert.equal(pack.format,BULK_COMPACT_PACKAGE_FORMAT);
 assert.equal(pack.shared.assessment.instructions,compactAssessment.instructions);
 assert.deepEqual(pack.shared.assessment.rubric,compactAssessment.rubric);
 assert.equal(pack.shared.teacherCheckingInstructions,originals[0].checking);
 assert.equal(pack.shared.requiredRules.length,9);
 assert.equal(pack.items.length,10);
 for(let i=0;i<10;i++){
   assert.equal(pack.items[i].ref,originals[i].ref);
   assert.match(pack.items[i].personalizedTask.prompt,new RegExp("scenario "+i));
   assert.match(pack.items[i].frozenEvidence.files[0].content,new RegExp("println\\("+i+"\\)"));
   assert.equal(pack.items[i].frozenEvidence.contentDigest,"c".repeat(64));
   assert.equal(pack.items[i].frozenEvidence.automaticVerification.matchesSubmittedSource,true);
   assert.equal("interpretation" in pack.items[i].frozenEvidence.executionEvidence,false);
   assert.equal("evaluationInstructions" in pack.items[i],false);
   assert.equal("assessment" in pack.items[i],false);
 }
 const serialized=JSON.stringify(pack);
 assert.equal(serialized.split(compactAssessment.instructions).length-1,1);
 assert.equal(serialized.split(originals[0].checking).length-1,1);
 const formerPackage=JSON.stringify({items:originals.map(item=>({
   ref:item.ref,evaluationInstructions:buildGeneralExternalEvaluationPackage({
     task:compactAssessment,snapshot:item.snapshot,checkingInstructions:item.checking
   })
 }))});
 assert.ok(serialized.length<formerPackage.length*0.65,
   "Batch should be materially shorter than ten repeated single-student packages");
});
test("compact package keeps different teacher notes attached to their own student without broadening shared guidance",()=>{
 const items=[
  compactExample(1,{checking:"Check scenario one using its original submitted source only."}),
  compactExample(2,{checking:"Check scenario two independently using its original submitted source."})
 ];
 const pack=buildCompactBulkExternalEvaluationPackage({
   batchId:"batch-different-notes",entries:items,task:compactAssessment
 });
 assert.equal(pack.shared.teacherCheckingInstructions,"");
 assert.equal(pack.items[0].teacherCheckingInstructions,items[0].checking);
 assert.equal(pack.items[1].teacherCheckingInstructions,items[1].checking);
 assert.equal(pack.items[0].personalizedTask.prompt.includes("scenario 2"),false);
});
test("compact package refuses mixed task/rubric, duplicate refs and missing personalized tasks",()=>{
 const a=compactExample(1),b=compactExample(2);
 const options={batchId:"batch-valid",task:compactAssessment};
 assert.throws(()=>buildCompactBulkExternalEvaluationPackage({
   ...options,entries:[a,{...b,ref:a.ref}]
 }),/duplicate anonymous reference/);
 const modified=JSON.parse(JSON.stringify(b));
 modified.evaluationData.assessment.rubric[0].points=9;
 assert.throws(()=>buildCompactBulkExternalEvaluationPackage({
   ...options,entries:[a,modified]
 }),/mixes different assessment/);
 const without=JSON.parse(JSON.stringify(a));
 without.evaluationData.evidence.personalizedTask=null;
 assert.throws(()=>buildCompactBulkExternalEvaluationPackage({
   ...options,entries:[without]
 }),/missing the exact assigned task/);
 assert.throws(()=>buildCompactBulkExternalEvaluationPackage({
   ...options,entries:Array.from({length:21},(_,i)=>compactExample(i))
 }),/1–20/);
});
test("new compact package keeps the original response JSON contract and single-submission export intact",()=>{
 const item=compactExample(1);
 const compact=buildCompactBulkExternalEvaluationPackage({
   batchId:"batch-v2",entries:[item],task:compactAssessment
 });
 const compatibleSuggestion={...suggestion,criteria:suggestion.criteria.map((row,i)=>({
   ...row,name:compactAssessment.rubric[i].name,maximumPoints:10,
   awardedPoints:i===0?8:7
 }))};
 const parsed=readBulkExternalResponse({
   format:BULK_RESPONSE_FORMAT,batchId:compact.batchId,
   results:[{ref:item.ref,response:compatibleSuggestion}]
 },{
   batchId:compact.batchId,
   allowedRefs:new Map([[item.ref,{key:"private-student-record"}]]),
   task:compactAssessment,
   parseResponse:parseGeneralExternalEvaluationResponse
 });
 assert.equal(parsed.length,1);
 assert.equal(parsed[0].review.awarded,15); // Existing response format preserved.
 const oldSingle=buildGeneralExternalEvaluationPackage({
   task:compactAssessment,snapshot:item.snapshot,
   checkingInstructions:item.checking
 });
 assert.match(oldSingle,/ADMINERVA GENERAL ASSESSMENT EXTERNAL EVALUATION PACKAGE/);
 assert.match(oldSingle,/REQUIRED RESPONSE JSON/);
 assert.match(oldSingle,/scenario 1/);
});

test("student-submitted GitHub evidence is selected without a teacher approval, while discoveries and zero commits are skipped",()=>{
 const rows=[
  {evidenceId:"teacher-discovery",status:"approved",hasSubmission:false,selectedCount:3,bulkReady:false,version:1},
  {evidenceId:"no-commits",status:"approved",hasSubmission:false,selectedCount:0,bulkReady:false,version:1},
  {evidenceId:"submitted-1",status:"submitted",hasSubmission:true,selectedCount:3,bulkReady:true,version:1},
  {evidenceId:"submitted-2",status:"submitted",hasSubmission:true,selectedCount:1,bulkReady:true,version:1},
  {evidenceId:"already-graded",status:"approved",hasSubmission:true,selectedCount:2,bulkReady:true,
   gradeStatus:"published",version:1}
 ];
 assert.deepEqual(nextBulkSelection(rows),["submitted-1","submitted-2"]);
 const items=new Map([["teacher-discovery",{key:"teacher-discovery",version:1,review:{saveEligible:true}}],
   ["submitted-1",{key:"submitted-1",version:1,review:{saveEligible:true}}]]);
 assert.deepEqual(bulkSaveableStages({
   staged:items,saveSelection:new Set(["teacher-discovery","submitted-1"]),rows
 }).map(x=>x.key),["submitted-1"]);
});
test("staged suggestions are no longer saveable when frozen GitHub approval is revoked",()=>{
 const stages=new Map([["github-1",{key:"github-1",version:2,
   review:{saveEligible:true}}]]);
 const rows=[{evidenceId:"github-1",version:2,status:"submitted",bulkReady:false,
   gradeStatus:null}];
 assert.equal(bulkSaveableStages({staged:stages,saveSelection:new Set(["github-1"]),rows}).length,0);
 rows[0].status="approved";rows[0].bulkReady=true;
 assert.equal(bulkSaveableStages({staged:stages,saveSelection:new Set(["github-1"]),rows}).length,1);
});
test("bulk selection and stage lookup support GitHub evidence IDs without changing student IDs",()=>{
 const rows=[
   {evidenceId:"github-1",studentUid:"old-uid",status:"approved",version:2,bulkReady:true},
   {evidenceId:"github-2",studentUid:"old-uid-2",status:"submitted",version:1,bulkReady:false},
   {submissionId:"essay-1",status:"submitted",version:1,bulkReady:true}
 ];
 assert.deepEqual(nextBulkSelection(rows),["github-1","essay-1"]);
 const staged=new Map([["github-1",{key:"github-1",version:2,
   review:{saveEligible:true}}]]);
 assert.equal(bulkSaveableStages({staged,saveSelection:new Set(["github-1"]),rows}).length,1);
 assert.equal(canClearCompletedBulkExchange({referenceMap:new Map([["ref",{key:"github-1"}]]),
   staged:new Map(),rows,savedIds:new Set(["github-1"])}),true);
});

test("source-aware compact evaluation keeps 20 learners for ordinary evidence and 10 for GitHub",()=>{
 assert.deepEqual([...BULK_SOURCE_TYPES],["studio","github","text","link"]);
 const ordinary={...compactAssessment,personalizedTask:{enabled:false}};
 const configs=[
   {source:"studio",task:compactAssessment,entries:Array.from({length:20},(_,i)=>compactExample(i))},
   ...["text","link","github"].map(source=>({
     source,task:{...ordinary,submissionSource:source},
     entries:Array.from({length:source==="github"?10:20},(_,i)=>{
       const snapshot=source==="text"?{version:1,payload:{
         response:"Essay submission #"+i+" with detailed evidence."}}:
         source==="link"?{version:1,payload:{
           url:"https://example.edu/student/"+i,note:"A submitted link."}}:
         {version:1,checkpointSha:"c".repeat(40),selectedCommitShas:["a".repeat(40)],
           commits:[{sha:"a".repeat(40),files:[{path:"src/Main.java",
             patch:"@@ -1 +1 @@\n-public class Old {}\n+public class Main {}",
             substantive:true,mergeContext:false}]}],
           pinnedSource:[{path:"src/Main.java",checkpointSha:"c".repeat(40),
             content:"public class Main {}"}],
           limitations:["Git author does not independently prove learner authorship"]};
       return {ref:source+"-"+i,evaluationData:buildGeneralExternalEvaluationData({
         task:{...ordinary,submissionSource:source},snapshot
       })};
     })
   }))
 ];
 for(const {source,task,entries} of configs){
   const pack=buildCompactBulkExternalEvaluationPackage({
     batchId:"batch-"+source,task,entries
   });
   assert.equal(pack.items.length,bulkBatchLimit(source),source);
   assert.equal(pack.shared.assessment.submissionSource,source);
   assert.equal(pack.shared.assessment.rubric.length,2);
   assert.ok(JSON.stringify(pack).length<BULK_MAX_PACKAGE_CHARACTERS);
   assert.equal("assessment" in pack.items[0],false);
   if(source==="github")assert.equal(pack.items[0].frozenEvidence.pinnedSource.length,1);
   if(source==="text")assert.match(pack.items.at(-1).frozenEvidence.response,/Essay submission #19/);
   if(source==="link")assert.equal(pack.items[0].frozenEvidence.type,"submission_link");
 }
 const github=configs.find(config=>config.source==="github");
 assert.throws(()=>buildCompactBulkExternalEvaluationPackage({
   batchId:"github-too-large",task:github.task,
   entries:[...github.entries,github.entries[0]]
 }),/1–10 verified submissions for github evidence/);
});
test("unverified GitHub, empty essays, missing links and unsupported MCQ are excluded",()=>{
 assert.throws(()=>assertBulkEvidence("github",{type:"github_frozen_commit_evidence",
   version:1,checkpointSha:"c".repeat(40),selectedCommitShas:[],commits:[]}),/approved GitHub/);
 assert.throws(()=>assertBulkEvidence("text",{type:"written_response",version:1,response:""}),/essay/);
 assert.throws(()=>assertBulkEvidence("link",{type:"submission_link",version:1,url:"http://unsafe"}),/submission link/);
 assert.throws(()=>assertBulkEvidence("mcq",{type:"objective_response",version:1}),/No V4 evidence adapter/);
});
test("person-specific task instructions remain bound to frozen essays and never become shared instructions",()=>{
 const personalized={...compactAssessment,submissionSource:"text",
   personalizedTask:{enabled:true}};
 const one=buildGeneralExternalEvaluationData({task:personalized,snapshot:{
   version:1,payload:{response:"My answer to prompt one."},
   personalizedTask:{variantId:"one",prompt:"Explain scenario ONE",
     evaluationNotes:"Look at first scenario"}
 }});
 const two=buildGeneralExternalEvaluationData({task:personalized,snapshot:{
   version:1,payload:{response:"My answer to prompt two."},
   personalizedTask:{variantId:"two",prompt:"Explain scenario TWO",
     evaluationNotes:"Look at second scenario"}
 }});
 const pack=buildCompactBulkExternalEvaluationPackage({
   batchId:"essay-personalized",task:personalized,
   entries:[{ref:"ref-one",evaluationData:one},{ref:"ref-two",evaluationData:two}]
 });
 assert.equal(pack.shared.assessment.personalized,true);
 assert.equal(pack.items[0].personalizedTask.prompt,"Explain scenario ONE");
 assert.equal(pack.items[1].personalizedTask.prompt,"Explain scenario TWO");
 assert.equal(pack.items[0].frozenEvidence.response,"My answer to prompt one.");
 assert.equal(pack.items[1].frozenEvidence.response,"My answer to prompt two.");
 assert.equal("personalizedTask" in pack.shared,false);
 assert.throws(()=>buildGeneralExternalEvaluationData({task:personalized,snapshot:{
   version:1,payload:{response:"No personalized prompt"}
 }}),/missing its exact assigned scenario/);
});
test("external batches larger than 800k characters fail without truncating evidence",()=>{
 const textTask={...compactAssessment,submissionSource:"text",personalizedTask:{enabled:false}};
 const entries=Array.from({length:20},(_,i)=>({
   ref:"essay-"+i,evaluationData:buildGeneralExternalEvaluationData({
     task:textTask,snapshot:{version:1,payload:{response:"S"+i+" "+("a".repeat(60000))}}
   })
 }));
 assert.throws(()=>buildCompactBulkExternalEvaluationPackage({
   batchId:"large",task:textTask,entries
 }),/safe external AI context budget/);
});

test("external packer includes complete evidence up to formatted 800k and defers overflow",()=>{
 const assessment={...compactAssessment,submissionSource:"text",personalizedTask:{enabled:false}};
 const entries=Array.from({length:20},(_,i)=>({
   ref:"ref-"+i,
   evaluationData:buildGeneralExternalEvaluationData({
     task:assessment,snapshot:{version:1,payload:{
       response:"Learner "+i+" "+("x".repeat(49000))
     }}
   })
 }));
 const fitted=fitCompactBulkExternalEvaluationPackage({
   batchId:"bounded-batch",entries,task:assessment
 });
 assert.ok(fitted.included.length>0);
 assert.ok(fitted.included.length<entries.length);
 assert.equal(fitted.included.length+fitted.deferred.length,entries.length);
 assert.equal(fitted.oversized.length,0);
 assert.ok(fitted.serialized.length<=800000);
 assert.deepEqual(fitted.packageData.items.map(item=>item.ref),
   fitted.included.map(entry=>entry.ref));
 for(const item of fitted.packageData.items){
   assert.match(item.frozenEvidence.response,/^Learner /);
   assert.ok(item.frozenEvidence.response.endsWith("x".repeat(49000)));
 }
 assert.ok(fitted.deferred.length>=1);
});

test("external packer skips one individually oversized submission but retains following learners",()=>{
 const assessment={...compactAssessment,submissionSource:"text",personalizedTask:{enabled:false}};
 const entry=(ref,size)=>({ref,evaluationData:buildGeneralExternalEvaluationData({
   task:assessment,snapshot:{version:1,payload:{response:"y".repeat(size)}}
 })});
 const huge=entry("too-large",810000),small=entry("small",1500);
 const result=fitCompactBulkExternalEvaluationPackage({
   batchId:"batch-large-first",entries:[huge,small],task:assessment
 });
 assert.deepEqual(result.included.map(item=>item.ref),["small"]);
 assert.deepEqual(result.oversized.map(item=>item.ref),["too-large"]);
 assert.deepEqual(result.deferred,[]);
 assert.equal(result.packageData.items[0].frozenEvidence.response.length,1500);
 assert.ok(result.serialized.length<=800000);
});

test("external packer never treats invalid student evidence as a size exclusion",()=>{
 const assessment={...compactAssessment,submissionSource:"text",personalizedTask:{enabled:false}};
 const invalid={ref:"invalid",evaluationData:buildGeneralExternalEvaluationData({
   task:assessment,snapshot:{version:1,payload:{response:"A complete written response."}}
 })};
 invalid.evaluationData.evidence.response="";
 assert.throws(()=>fitCompactBulkExternalEvaluationPackage({
   batchId:"invalid-evidence",entries:[invalid],task:assessment
 }),/essay/);
});
