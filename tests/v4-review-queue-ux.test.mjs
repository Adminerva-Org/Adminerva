import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {queueMatches,nextUngradedRow,gradeFormFingerprint} from "../js/repo-review/services/review-queue.mjs";
const queue=[
 {row:{studentUid:"a"},search:"alice section a",gradeStatus:"draft",attention:true},
 {row:{studentUid:"b"},search:"bob section a",gradeStatus:"ungraded",attention:false},
 {row:{studentUid:"c"},search:"cara section b",gradeStatus:"published",attention:false},
 {row:{studentUid:"d"},search:"dan section b",gradeStatus:"ungraded",attention:true}
];
test("queue search combines learner or section with exact grading state",()=>{
 assert.deepEqual(queue.filter(item=>queueMatches(item," SECTION A ","ungraded")).map(item=>item.row.studentUid),["b"]);
 assert.deepEqual(queue.filter(item=>queueMatches(item,"","attention")).map(item=>item.row.studentUid),["a","d"]);
 assert.equal(queueMatches(queue[2],"cara","draft"),false);
});
test("next ungraded respects visible reviewable learners and wraps without selecting the current learner",()=>{
 const rows=queue.map(item=>item.row);
 assert.equal(nextUngradedRow(rows,queue,"a").studentUid,"b");
 assert.equal(nextUngradedRow(rows,queue,"d").studentUid,"b");
 assert.equal(nextUngradedRow([rows[1]],queue,"b"),undefined);
 assert.equal(nextUngradedRow([rows[0],rows[2]],queue,"a"),undefined);
});
test("unscored and legitimate zero inputs are different and feedback edits mark the grade dirty",()=>{
 const saved=gradeFormFingerprint(["0","0","initial"]);
 assert.notEqual(saved,gradeFormFingerprint(["","0","initial"]));
 assert.notEqual(saved,gradeFormFingerprint(["0","0","changed"]));
 assert.equal(saved,gradeFormFingerprint(["0","0","initial"]));
});
test("the canonical review markup has unique persistent controls and separate disclosures",()=>{
 const html=readFileSync("school-gradebook.html","utf8");
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(ids.length,new Set(ids).size);
 for(const id of ["gbV4QueueSearch","gbV4QueueFilter","gbV4Previous","gbV4Next","gbV4NextUngraded","gbV4GradeHistory","gbV4EvidenceColumn","gbV4GradeColumn","gbV4ConversationPanel","gbV4RevisionPanel"])assert.ok(ids.includes(id),id);
 assert.match(html,/<footer[^>]*>[\s\S]*?id="gbV4SaveDraft"[\s\S]*?id="gbV4Publish"[\s\S]*?id="gbV4NextUngraded"[\s\S]*?<\/footer>/);
 assert.doesNotMatch(html,/id="gbV4PageDescription"/);
 assert.match(html,/@media\(max-width:480px\)/);
});

test("all-assessment queue uses bounded school-scoped reads and direct learner handoffs",()=>{
 const js=readFileSync("js/repo-review/v4-gradebook.mjs","utf8");
 assert.match(js,/allTasks\.slice\(allOffset,allOffset\+4\)/);
 assert.match(js,/token!==generation\|\|taskSelect\.value!==ALL_TASKS/);
 assert.match(js,/pendingStudentDeepLink=row\.studentUid/);
 assert.match(js,/bulkEvaluator\?\.hasUnsaved\(\)/);
});
