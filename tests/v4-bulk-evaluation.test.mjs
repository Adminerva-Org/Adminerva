import test from "node:test";
import assert from "node:assert/strict";
import {
  BULK_PACKAGE_FORMAT,BULK_RESPONSE_FORMAT,BULK_MAX_BATCH,
  bulkSuggestionState,readBulkExternalResponse,bulkSaveableStages,
  nextBulkSelection,canClearCompletedBulkExchange
} from "../js/repo-review/v4-bulk-evaluation.mjs";
import {parseGeneralExternalEvaluationResponse} from
  "../js/assessment/general-external-evaluation.mjs";

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
 assert.equal(BULK_MAX_BATCH,10);
 assert.match(BULK_PACKAGE_FORMAT,/bulk-evaluation-package-v1/);
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

test("the selection never exceeds ten and advances after the first ten have saved grades",()=>{
 const rows=Array.from({length:88},(_,i)=>({
   submissionId:"submitted-"+String(i+1).padStart(3,"0"),
   version:1,status:"submitted",gradeStatus:null
 }));
 const first=nextBulkSelection(rows);
 assert.equal(first.length,10);
 assert.equal(first[0],rows[0].submissionId);
 assert.equal(first.at(-1),rows[9].submissionId);
 for(const row of rows.slice(0,10))row.gradeStatus="draft";
 const next=nextBulkSelection(rows);
 assert.equal(next.length,10);
 assert.equal(next[0],rows[10].submissionId);
 assert.equal(next.at(-1),rows[19].submissionId);
 assert.equal(new Set([...first,...next]).size,20);
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
});
