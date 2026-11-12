import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {
  ownerEmailHash,lessonClientKey,presentationClientKey,safeDeck,
  lessonContent,presentationContent,explicitOwner,revisionList
}=require("../functions/mcs-canonical-planning-plan.js");
const {deterministicId}=require("../functions/school-planning.js");
const {validateResource}=require("../functions/mcs-canonical-planning-apply.js");

test("planning owner email fingerprint matches identity-candidate SHA-256 convention",()=>{
 const email="Teacher@Example.edu";
 assert.equal(ownerEmailHash(email),
  createHash("sha256").update("teacher@example.edu").digest("hex"));
});
test("lesson and presentation client keys match the live school editor bridge contracts",()=>{
 assert.equal(lessonClientKey({
  school_year:"2026-2027",grade_level:"Grade 11",subject_title:"Programming",
  academic_term:"1st Quarter",course_week:"Week 2"
 }),JSON.stringify(["2026-2027","Grade 11","Programming","1st Quarter","Week 2"]));
 assert.equal(presentationClientKey({plan_id:"lesson-id",session_index:1}),
  JSON.stringify(["lesson-id","1"]));
});
test("planning ownership never falls back to teacher display names",()=>{
 const uid="teacher_1",teachers=new Map([[uid,{uid}]]),
  hash=ownerEmailHash("teacher@example.edu"),emails=new Map([[hash,uid]]);
 assert.deepEqual(explicitOwner({ownerUid:uid},teachers,emails),
  {ok:true,uid,source:"saved_owner_uid"});
 assert.deepEqual(explicitOwner({ownerEmail:"teacher@example.edu"},teachers,emails),
  {ok:true,uid,source:"verified_owner_email"});
 assert.equal(explicitOwner({teacher_name:"Teacher One"},teachers,emails).ok,false);
});
test("legacy presentation HTML with executable surface is blocked rather than rewritten silently",()=>{
 assert.equal(safeDeck([{content:"<h1>Safe</h1>",layout:"standard"}]).ok,true);
 assert.equal(safeDeck([{content:'<img src=x onerror="alert(1)">'}]).reason,
  "presentation_html_requires_review");
 assert.equal(safeDeck([{content:'<a href="javascript:alert(1)">x</a>'}]).ok,false);
});
test("lesson and presentation content convert to current school planning schemas",()=>{
 const lesson=lessonContent({
  teacher_name:"Teacher",subject_title:"Programming",school_year:"2026-2027",
  academic_term:"Q1",course_week:"Week 1",grade_level:"Grade 11",
  weekly_overview:{topic:"Intro"},sessions:[{session_name:"Session 1",objectives:"Learn"}]
 });
 assert.equal(lesson.ok,true);
 assert.equal(lesson.content.schema,"adminerva-school-lesson-v1");
 const presentation=presentationContent({
  plan_id:"legacy-plan",source_lesson_version:2,session_index:0,
  subject:"Programming",grade:"Grade 11",
  deck:[{layout:"standard",content:"<h1>Intro</h1>"}]
 },"resource_lesson","Session 1");
 assert.equal(presentation.ok,true);
 assert.equal(presentation.content.sourceLesson.canonicalLessonResourceId,"resource_lesson");
});
test("revision history refuses missing historical versions",()=>{
 const current={version:3,sessions:[{session_name:"Current"}]};
 const row={data:current,revisions:[
  {id:"1",path:"r1",data:{version:1,sessions:[{session_name:"Old"}]}}
 ]};
 const result=revisionList(row,data=>({ok:true,content:{schema:"x",data}}));
 assert.equal(result.ok,false);
 assert.equal(result.reason,"planning_revision_history_incomplete");
});
test("planning apply validation requires private deterministic runtime identity",()=>{
 const uid="teacher_1",clientKey=JSON.stringify(["2026-2027","Grade 11","Programming","Q1","Week 1"]),
  resourceId=deterministicId({schoolId:"mcs-manila",uid},"lesson",clientKey);
 const row={resourceId,kind:"lesson",ownerUid:uid,clientKey,title:"Lesson",status:"active",
  visibility:"private",sharedWithUids:[],revision:1,revisions:[],
  content:{schema:"adminerva-school-lesson-v1",plan:{sessions:[{session_name:"One"}]}}};
 assert.doesNotThrow(()=>validateResource(row));
 assert.throws(()=>validateResource({...row,visibility:"school_teachers"}));
});
