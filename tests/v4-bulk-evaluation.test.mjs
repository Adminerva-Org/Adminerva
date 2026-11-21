import test from "node:test";
import assert from "node:assert/strict";
import {
  BULK_PACKAGE_FORMAT,BULK_RESPONSE_FORMAT,BULK_MAX_BATCH,
  bulkSuggestionState,readBulkExternalResponse
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
