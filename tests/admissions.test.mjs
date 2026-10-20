import test from "node:test";
import assert from "node:assert/strict";
import {registrationProfile,assertPendingRequest,admissionDestination,guestStorageKey} from "../js/core/admission-model.mjs";
import {captureLessonSettings,savedLessonSettings} from "../js/lesson-review/lesson-settings.mjs";
import {validReleaseId,releasePresentation,releaseMatches} from "../js/core/release-version.mjs";
import {publicReleases,releaseNotifications} from "../js/core/patch-history.mjs";
import {verifiedMemberEvidence,validateOverview,overviewPrompt,overviewFingerprint,collectOverview} from "../js/repo-review/services/repobank-model.mjs";
const user={uid:"new-guest",email:"Guest@Example.edu",emailVerified:true,displayName:"New guest"};
test("registration is a verified request, never self-assigned school authority",()=>{
 const request=registrationProfile(user,"teacher");assert.equal(request.status,"pending");assert.equal(request.email,"guest@example.edu");assert.equal(request.role,undefined);
 assert.throws(()=>registrationProfile({...user,emailVerified:false}));assert.throws(()=>registrationProfile(user,"admin"));
 assert.equal(admissionDestination({role:"teacher",students:[]}),"teacher-home.html");assert.equal(admissionDestination({role:null,students:[{}]}),"student-home.html");assert.equal(admissionDestination({role:null,students:[]}),"guest-home.html");
});
test("stale admissions cannot override a decided request and local guest drafts are account-isolated",()=>{
 const request=registrationProfile(user);assert.doesNotThrow(()=>assertPendingRequest(request,request));
 assert.throws(()=>assertPendingRequest({...request,status:"approved",revision:1},request),/changed/);
 assert.throws(()=>assertPendingRequest({...request,requestedRole:"teacher"},request),/changed/);
 assert.throws(()=>assertPendingRequest({...request,displayName:"Changed after review"},request),/changed/);
 assert.notEqual(guestStorageKey("one","practice"),guestStorageKey("two","practice"));assert.throws(()=>guestStorageKey("../other","practice"));assert.throws(()=>guestStorageKey("one","grades"));
});
test("saved lesson settings preserve blank signatories and original subject without mutating defaults",()=>{
 const defaults=new Map([["Adminerva_defaultSubject","Current subject"],["Adminerva_sig3Name","Grade 12 coordinator"]]);
 const storage={getItem:key=>defaults.get(key)??null};
 const snapshot=captureLessonSettings(storage,{subject_title:"Grade 11 subject",sig_grade_coord:"Grade 11 coordinator",sig_principal:""});
 const opened=savedLessonSettings({subject_title:"Grade 11 subject",teacher_name:"Original teacher",document_settings:snapshot});
 assert.equal(opened.sig_grade_coord,"Grade 11 coordinator");assert.equal(opened.sig_principal,"");assert.equal(defaults.get("Adminerva_sig3Name"),"Grade 12 coordinator");assert.equal(snapshot.header_image_base64,undefined);
 assert.equal(savedLessonSettings({subject_title:"Older subject"}).sig_grade_coord,undefined);
});
test("semantic versions retain notification identities and unpublished drafts stay private",()=>{
 const release={version:"2026.10.20.1",displayVersion:"1.0.0",releasedAt:"2026-10-20",status:"published",public:true,title:"Release",summary:"Public update",changes:[{type:"Fixed",area:"Review",text:"Clearer controls"}]};
 const [projected]=publicReleases({releases:[release,{...release,version:"1.1.0",status:"draft"}]},Date.parse("2026-10-22"));
 assert.equal(releaseNotifications([projected])[0].key,"release:2026.10.20.1");assert.equal(releasePresentation(projected).label,"v1.0.0");
 assert.equal(validReleaseId("1.01.0"),false);assert.equal(validReleaseId("1.2.3"),true);assert.equal(releasePresentation({version:"1.2.0"}).type,"minor");assert.equal(releasePresentation({version:"1.2.1"}).type,"patch");assert.equal(releaseMatches(projected,{text:"review clearer"}),true);
});
test("RepoBank only displays explicitly verified approved individual evidence, at its own checkpoint",()=>{
 const own="a".repeat(40),checkpoint="b".repeat(40),record={studentId:"one",repository:"https://github.com/group/app.git",assessmentId:"task",status:"approved",checkpointSha:checkpoint,approvedCheckpointSha:checkpoint,selectedCommits:[own],verifiedContributionCommits:[own],contributionScope:"Instructor verified the welcome layout only.",revision:2};
 assert.equal(verifiedMemberEvidence([record],"one","https://github.com/Group/App")[0].commits.length,1);
 for(const invalid of [{...record,studentId:"two"},{...record,status:"reopened"},{...record,approvedCheckpointSha:own},{...record,verifiedContributionCommits:[checkpoint]}])assert.equal(verifiedMemberEvidence([invalid],"one",record.repository).length,0);
 assert.equal(verifiedMemberEvidence([{...record,verifiedContributionCommits:[]}],"one",record.repository)[0].commits.length,0);
 assert.throws(()=>validateOverview({concept:"Overview",feedback:"Feedback",members:{one:"Worked on everything"}}));
 assert.match(overviewPrompt([]),/Never infer individual/);assert.notEqual(overviewFingerprint(own,"model-a"),overviewFingerprint(own,"model-b"));
});
test("overview source reads pin a full SHA once, handle slash branches and explicitly report partial coverage",async()=>{
 const checkpoint="b".repeat(40),paths=[];
 const requests={json:async route=>{paths.push(route);if(route.endsWith("/app"))return {default_branch:"feature/ui"};if(route.includes("/commits/"))return {sha:checkpoint};if(route.includes("/git/trees/"))return {truncated:true,tree:[{type:"blob",path:"res/layout/a.xml"},{type:"blob",path:"res/layout/unavailable.xml"}]};if(route.includes("unavailable"))throw Error("unavailable");return {encoding:"base64",size:30,content:btoa("<TextView />")};}};
 const sample=await collectOverview(requests,"https://github.com/group/app");assert.equal(sample.checkpoint,checkpoint);assert.equal(sample.coverage.failed,1);assert.equal(sample.coverage.truncated,true);
 assert.ok(paths.some(route=>route.includes("feature%2Fui")));assert.ok(paths.filter(route=>route.includes("/contents/")).every(route=>route.endsWith("?ref="+checkpoint)));
 await assert.rejects(collectOverview({json:async()=>({})},"https://github.com/group/app"),/no default branch/);
});
