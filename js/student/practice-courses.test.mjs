import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {COURSES,practiceQuestion,getCourse} from "./practice-courses.mjs";
import {historyDocId,historyRecord,mergeNotificationHistory} from "../core/notification-history.mjs";
import {shouldOfferSiteUpdate} from "../core/site-updates.mjs";

test("four original tracks contain sixteen solvable varied missions",()=>{
  assert.equal(COURSES.length,4);
  assert.deepEqual(COURSES.map(x=>x.id),["java","python","web","logic"]);
  const all=new Set();
  for(const course of COURSES){
    assert.equal(course.missions.length,4);
    assert.equal(getCourse(course.id),course);
    for(const mission of course.missions){
      assert.ok(!all.has(mission.id));all.add(mission.id);
      for(const student of ["student-a","student-b"]){
        for(let attempt=0;attempt<90;attempt++){
          const question=practiceQuestion(student,mission,attempt);
          assert.equal(question.choices.length,4,mission.id+" choices");
          assert.equal(new Set(question.choices).size,4,mission.id+" unique options");
          assert.ok(question.correct>=0&&question.correct<4);
          assert.ok(question.choices[question.correct].length>0);
          assert.ok(question.code && question.prompt && question.why);
        }
      }
    }
  }
  assert.equal(all.size,16);
});
test("opened alerts remain recallable alongside the live unread inbox",()=>{
  const alert={key:"issue:42",type:"issue",title:"Report follow-up",body:"Teacher answered",target:"issues.html",at:9};
  const saved=historyRecord(alert,"alice",true);
  assert.equal(saved.ownerUid,"alice");
  assert.equal(saved.savedForLater,true);
  assert.equal(historyDocId("issue:42"),historyDocId("issue:42"));
  assert.equal(historyDocId("issue:42")===historyDocId("issue:43"),false);
  const items=mergeNotificationHistory([],[{...saved,openedAt:true}],new Set());
  assert.equal(items.length,1);
  assert.equal(items[0].key,alert.key);
  assert.equal(items[0].pinned,true);
  assert.equal(items[0].history,true);
  const merged=mergeNotificationHistory([alert],[{...saved,openedAt:true}],new Set());
  assert.equal(merged.length,1);
  assert.equal(merged[0].pinned,true);
});
test("website update notification is opt-in and version based",()=>{
  assert.equal(shouldOfferSiteUpdate("2026.10.16.1","2026.10.16.2"),true);
  assert.equal(shouldOfferSiteUpdate("2026.10.16.2","2026.10.16.2"),false);
  const source=readFileSync("js/core/site-updates.mjs","utf8");
  assert.match(source,/cache:"no-store"/);
  assert.match(source,/confirm\("Save your edits/);
  assert.doesNotMatch(source,/serviceWorker\.register/);
  const release=JSON.parse(readFileSync("site-release.json","utf8"));
  assert.ok(release.version && release.notes);
});
test("student practice page requires authentication and does not grade exams",()=>{
  const html=readFileSync("student-practice.html","utf8");
  assert.match(html,/auth-guard\.js/);
  assert.match(html,/practiceReasoning/);
  assert.match(html,/practiceMissionPanel/);
  assert.match(html,/not graded exams/);
  const app=readFileSync("js/student/practice.js","utf8");
  assert.match(app,/student_practice_progress/);
  assert.match(app,/serverTimestamp\(\)/);
});
