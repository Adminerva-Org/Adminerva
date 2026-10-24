import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";

const read=path=>readFileSync(path,"utf8");
const has=(path,text)=>assert.ok(read(path).includes(text),path+" is missing expected reliability change: "+text);
const lacks=(path,text)=>assert.ok(!read(path).includes(text),path+" still contains reverted/regressive pattern: "+text);

has("js/student/assessment-evidence.mjs","verifyCheckpointAncestry");
has("js/student/assessment-evidence.mjs",'headers.Authorization="Bearer "+token');
has("js/core/push-notifications.mjs","localOptOutKey");
has("js/core/push-notifications.mjs","departPushAccount");
has("js/core/push-notifications.mjs","device-opted-out");
has("js/settings/account-preferences.mjs","could not reconnect this device automatically");
lacks("js/settings/account-preferences.mjs","await refreshPush(version);");
has("js/core/teaching-firestore.mjs","void actor().then(async current=>");
has("firebase-messaging-sw.js","assets/adminerva-notification-badge.png");
has("js/core/push-notifications.mjs","assets/adminerva-notification-badge.png");
has("functions/index.js",'badge:pushBaseUrl+"assets/adminerva-notification-badge.png"');
assert.ok(existsSync("assets/adminerva-notification-badge.png"),"notification badge asset is missing");

lacks("js/student/dashboard.js","signInWithPopup(auth, provider)");
has("js/student/dashboard.js","dashboardLoadSequence");
has("js/student/dashboard.js","ensureStudentAccessProjection");
has("js/student/assessments.js","ensureStudentAccessProjection");
has("firestore.rules","mayReadStudentAssessment");
has("firestore.rules","match /student_access/{ownerUid}");
lacks("firestore.rules","(signedIn() && !isInstructor());");
has("functions/index.js","exports.refreshStudentAccess");
has("functions/index.js","exports.studentAccessChanged");

has("js/settings/settings-user.js",'status:"suspended"');
has("js/settings/settings-user.js","stableSection");
lacks("js/settings/settings-user.js",'deleteDoc(doc(db, "students", compositeDocId))');
has("js/core/staff-session.mjs",'["suspended","archived"]');
has("js/student/settings.js",'Adminerva_Gemini_Key_"+ownerUid');
has("js/student/playground.js",'Adminerva_Gemini_Key_"+ownerUid');
has("js/lesson-review/lesson-firebase.js","localScheduleText(lessonStorage");
has("js/settings/settings-presentation.js",'doc(window.db, "staff_workspaces", uid, "preferences", "presentation")');
lacks("js/settings/settings-presentation.js",'doc(window.db, "global_settings", "presentation_config")');
has("js/lesson-review/app-ui.js","Adminerva_lesson_editor_draft_v1");
has("js/lesson-review/app-ui.js","adminerva:lesson-saved");
has("js/settings/settings-core.js",'location.hash==="#notifications"?"account":"security"');
has("js/core/adminerva-loader.js",'<div id="bug-modal" hidden');
has("js/core/adminerva-nav.js","m.hidden=false");

console.log("Focused first-release reliability invariants passed.");
