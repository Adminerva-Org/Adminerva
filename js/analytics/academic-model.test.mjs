import test from "node:test";
import assert from "node:assert/strict";
import {academicGradeEligible,queryGroups} from "./academic-model.mjs";
test("published grade analytics exclude drafts and missing scores, but preserve a real zero",()=>{
  assert.equal(academicGradeEligible({score:10,maxScore:20,published:false}),false);
  assert.equal(academicGradeEligible({score:10,maxScore:20,published:false},null,true),true);
  assert.equal(academicGradeEligible({score:null,maxScore:20,published:true}),false);
  assert.equal(academicGradeEligible({score:0,maxScore:20,published:true}),true);
  assert.equal(academicGradeEligible({score:21,maxScore:20,published:true}),false);
  assert.equal(academicGradeEligible({score:10,published:true},{maxScore:0}),false);
});
test("teacher queries are deduplicated, bounded groups rather than global student and grade scans",()=>{
  const groups=queryGroups([...Array.from({length:23},(_,index)=>"student-"+index),"student-1",null,""]);
  assert.deepEqual(groups.map(group=>group.length),[10,10,3]);assert.deepEqual(queryGroups([]),[]);
});
