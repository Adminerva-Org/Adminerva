import test from "node:test";
import assert from "node:assert/strict";
import {searchStudents} from "../js/repo-review/services/student-search.mjs";

const students=[{id:"a",name:"José Cruz",section:"A",githubUsername:"jose"},{id:"b",name:"Jose Cruz",section:"B"},
  ...Array.from({length:70},(_,index)=>({id:"other-"+index,name:"Other "+index,section:"B"}))];
test("student search combines normalized names, username and assigned section",()=>{
  assert.deepEqual(searchStudents(students,{section:"A",text:"jose cruz"}).rows.map(student=>student.id),["a"]);
  assert.equal(searchStudents(students,{text:"jose"}).total,2);
  assert.equal(searchStudents(students,{text:"not found"}).total,0);
});
test("bounded search preserves a loaded or deep-linked student without widening the count",()=>{
  const result=searchStudents(students,{section:"B",selected:"a"});
  assert.equal(result.rows.length,41);assert.equal(result.total,71);assert.equal(result.truncated,true);
  assert.equal(result.rows[0].id,"a");
  assert.equal(searchStudents(students,{text:"missing",selected:"a"}).rows[0].id,"a");
});
