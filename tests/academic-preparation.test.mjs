import test from "node:test";
import assert from "node:assert/strict";
import preparation from "../functions/academic-preparation.js";
const record=(collection,id,data)=>({id,path:collection+"/"+id,version:"123:456",data});
function records(){return {students:[record("students","alice",{name:"Alice",email:"alice@example.test",section:"A",githubToken:"not-for-teachers"})],teaching_roster:[],assessments:[],assessment_private:[],student_grades:[]};}
test("preparation copies only the credential-free roster fields and never rewrites scores",()=>{
  const source=records();source.student_grades.push(record("student_grades","alice_task",{studentId:"alice",score:17,feedback:"Protected",published:true}));
  const plan=preparation.planAcademicAccess(source,"administrator");
  assert.equal(plan.blockers.length,0);assert.equal(plan.changes[0].patch.githubToken,undefined);
  const grade=plan.changes.find(change=>change.path.startsWith("student_grades/"));assert.deepEqual(grade.patch,{section:"A"});
  assert.equal(grade.sourcePath,"students/alice");
});
test("legacy custody is explicit, preserves known owners and never claims original authorship",()=>{
  const source=records();source.assessments.push(record("assessments","task",{deployments:[{section:"A"}]}));
  source.assessment_private.push(record("assessment_private","task",{systemPersona:"Private"}));
  const plan=preparation.planAcademicAccess(source,"administrator");
  const task=plan.changes.find(change=>change.path==="assessments/task");
  assert.equal(task.patch.ownerUid,"administrator");assert.match(task.patch.ownershipBasis,/not-original-authorship/);
  assert.ok(plan.changes.findIndex(change=>change.path==="assessment_private/task")<plan.changes.indexOf(task));
  source.assessments[0].data.ownerUid="original-owner";
  assert.equal(preparation.planAcademicAccess(source,"administrator").changes.find(change=>change.path==="assessments/task").patch.ownerUid,undefined);
});
test("invalid scope types, oversized deployments and orphan grades require manual review",()=>{
  const source=records();source.assessments.push(record("assessments","bad",{sectionIds:"A"}),record("assessments","too-many",{deployments:Array(21).fill({section:"A"})}));
  source.student_grades.push(record("student_grades","orphan_task",{score:10,studentId:"missing"}));
  const plan=preparation.planAcademicAccess(source,"administrator");assert.equal(plan.blockers.length,3);
  assert.ok(!plan.changes.some(change=>change.path.startsWith("student_grades/")));
});
