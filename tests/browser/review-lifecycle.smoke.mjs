/** Regression coverage: Adminerva module: review lifecycle.smoke. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFile,mkdir,stat,writeFile} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import http from "node:http";
import {chromium} from "playwright";
import {expect as baseExpect} from "playwright/test";
import {initializeTestEnvironment} from "@firebase/rules-unit-testing";
import {initializeApp,deleteApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {doc,setDoc} from "firebase/firestore";
import {accounts,password,assessment,repository,ownSha,groupSha,homePath,providerDraft,githubFixture} from "./review-fixtures.mjs";

const projectId="demo-adminerva-browser";
const root=process.cwd();
const sdkBase="https://www.gstatic.com/firebasejs/10.13.0/";
const output=path.resolve(process.env.ADMINERVA_TEST_OUTPUT||path.join(tmpdir(),"adminerva-browser-validation"));
const fixtureScope="Alice implements the welcome screen only. Instructor observed the implementation and verified the selected welcome diff; home and feature belong to teammates.";
const expect=baseExpect.configure({timeout:15000});

function localEmulator(name){
  const address=process.env[name];
  assert.match(address||"",/^(?:127\.0\.0\.1|localhost):\d+$/,name+" must identify an explicit local emulator");
  return address;
}
function coreModule(firestoreHost,authHost){
  const [host,port]=firestoreHost.split(":");
  return `import {initializeApp} from "${sdkBase}firebase-app.js";
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword} from "${sdkBase}firebase-auth.js";
import {getFirestore,connectFirestoreEmulator} from "${sdkBase}firebase-firestore.js";
const app=initializeApp({apiKey:"emulator-fixture-key",projectId:"${projectId}",authDomain:"localhost"});
const auth=getAuth(app);connectAuthEmulator(auth,"http://${authHost}",{disableWarnings:true});
const db=getFirestore(app);connectFirestoreEmulator(db,"${host}",${Number(port)});
const accounts=${JSON.stringify(accounts)};
const identity=accounts[localStorage.getItem("fixture-role")];
if(!identity)throw Error("An isolated test identity is required");
await signInWithEmailAndPassword(auth,identity.email,${JSON.stringify(password)});
window.db=db;window.auth=auth;export {app,auth,db};`;
}
async function browserRecord(page,recordPath){
  return page.evaluate(async({recordPath,sdkBase})=>{
    const {db}=await import("/js/core/firebase-core.js");
    const {getDoc,doc}=await import(sdkBase+"firebase-firestore.js");
    try{
      const record=await getDoc(doc(db,...recordPath.split("/")));
      return {exists:record.exists(),data:record.exists()?JSON.parse(JSON.stringify(record.data())):null};
    }catch(error){return {error:error.code};}
  },{recordPath,sdkBase});
}
async function waitRecord(page,recordPath,field,value){
  await expect.poll(async()=>{
    const record=await browserRecord(page,recordPath);
    return record.data?.[field];
  },{message:recordPath+" should have "+field+"="+value}).toEqual(value);
  return (await browserRecord(page,recordPath)).data;
}

test("teacher and students complete the V2 evidence lifecycle using real Auth and Firestore emulators",{timeout:420000},async()=>{
  const firestoreHost=localEmulator("FIRESTORE_EMULATOR_HOST");
  const authHost=localEmulator("FIREBASE_AUTH_EMULATOR_HOST");
  assert.equal(process.env.GCLOUD_PROJECT,projectId,"The Firebase CLI must select the isolated demo project");
  await mkdir(output,{recursive:true});
  const rules=await readFile(path.join(root,"firestore.rules"),"utf8");
  const environment=await initializeTestEnvironment({projectId,firestore:{rules}});
  const adminApp=initializeApp({projectId},"browser-fixture-admin");
  let browser,server;
  const contexts=[],errors=[],blockedRequests=[],dialogs=[],milestones=[];
  function validated(message){milestones.push(message);console.log("Validated: "+message);}
  let modelRequests=0;
  let omitSavedCommit=false;
  try{
    await environment.clearFirestore();
    const authAdmin=getAuth(adminApp);
    const users=await authAdmin.listUsers();
    if(users.users.length)await authAdmin.deleteUsers(users.users.map(user=>user.uid));
    for(const account of Object.values(accounts))await authAdmin.createUser({...account,password,emailVerified:true});
    await environment.withSecurityRulesDisabled(async context=>{
      const db=context.firestore();
      await Promise.all([
        ...["alice","bob"].map(studentId=>setDoc(doc(db,"students",studentId),{
          name:"Fixture "+studentId,email:accounts[studentId].email,section:"fixture-11-A",githubUsername:"fixture-"+studentId,repoUrl:repository
        })),
        setDoc(doc(db,"assessments","fixture-v2"),assessment),
        setDoc(doc(db,"assessment_private","fixture-v2"),{systemPersona:"Private fixture instructions"})
      ]);
    });
    const assets=new Map();
    for(const name of ["firebase-app.js","firebase-auth.js","firebase-firestore.js"]){
      const response=await fetch(sdkBase+name);
      assert.equal(response.ok,true,"Could not load the production-version Firebase SDK");
      assets.set(sdkBase+name,await response.text());
    }
    const stylesheet=await fetch("https://cdn.tailwindcss.com");
    assert.equal(stylesheet.ok,true);
    const tailwind=await stylesheet.text();
    server=http.createServer(async(request,response)=>{
      try{
        const pathname=decodeURIComponent(new URL(request.url,"http://localhost").pathname);
        if(pathname==="/js/core/firebase-core.js"){
          response.setHeader("Content-Type","text/javascript");response.end(coreModule(firestoreHost,authHost));return;
        }
        const file=path.resolve(root,"."+pathname);
        if(path.relative(root,file).startsWith("..")||!(await stat(file)).isFile())throw Error("Unknown fixture route");
        response.setHeader("Content-Type",file.endsWith(".html")?"text/html":file.endsWith(".css")?"text/css":file.endsWith(".json")?"application/json":"text/javascript");
        response.end(await readFile(file));
      }catch{response.writeHead(404);response.end();}
    });
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const origin="http://127.0.0.1:"+server.address().port;
    browser=await chromium.launch({headless:true,...(process.env.ADMINERVA_TEST_BROWSER_PATH?{executablePath:process.env.ADMINERVA_TEST_BROWSER_PATH}:{})});
    async function newIdentity(role){
      const context=await browser.newContext({viewport:{width:1360,height:1000}});contexts.push(context);
      await context.addInitScript(role=>{
        if(location.protocol!=="http:")return;
        localStorage.setItem("fixture-role",role);
        localStorage.setItem("Adminerva_Role",role==="teacher"?"teacher":role==="admin"?"superadmin":"student");
        if(role==="teacher")localStorage.setItem("Adminerva_gemini_token","fixture-key-never-valid-in-production");
      },role);
      await context.route("**/*",async route=>{
        const url=route.request().url(),parsed=new URL(url);
        if(assets.has(url))return route.fulfill({contentType:"text/javascript",body:assets.get(url)});
        if(parsed.hostname==="cdn.tailwindcss.com")return route.fulfill({contentType:"text/javascript",body:tailwind});
        if(url==="https://cdn.jsdelivr.net/npm/chart.js")return route.fulfill({contentType:"text/javascript",body:"window.Chart=class { destroy(){} };"});
        if(url==="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css")return route.fulfill({contentType:"text/css",body:""});
        if(parsed.hostname==="api.github.com"){
          let fixture=githubFixture(url);if(omitSavedCommit&&Array.isArray(fixture))fixture=fixture.filter(commit=>commit.sha!==ownSha);
          return route.fulfill({json:fixture});
        }
        if(parsed.hostname==="generativelanguage.googleapis.com"){
          modelRequests++;
          const prompt=route.request().postDataJSON().contents[0].parts[0].text;
          assert.match(prompt,/Do not deduct points from an individual for teammates' missing screens/);
          assert.match(prompt,new RegExp(homePath.replaceAll(".","\\.")));
          assert.ok(!prompt.includes("SELECTED COMMIT: "+groupSha),"Teammate changes must not be attributed to Alice");
          if(modelRequests===1)return route.fulfill({status:503,json:{error:{message:"Fixture provider outage"}}});
          return route.fulfill({json:{candidates:[{content:{parts:[{text:JSON.stringify(providerDraft)}]}}]}});
        }
        if(parsed.hostname==="127.0.0.1"||parsed.hostname==="localhost")return route.continue();
        blockedRequests.push(parsed.origin);return route.abort("blockedbyclient");
      });
      context.on("page",page=>{
        page.on("pageerror",error=>errors.push(error.message));
        page.on("dialog",async dialog=>{dialogs.push(dialog.message());await dialog.accept(dialog.type()==="prompt"?"Fixture teacher reviewed the evidence and documented this deliberate revision.":undefined);});
      });
      return context;
    }
    const student=await (await newIdentity("alice")).newPage();
    const teacherContext=await newIdentity("teacher");
    const teacher=await teacherContext.newPage();
    const gradebook=await teacherContext.newPage();
    const peer=await (await newIdentity("bob")).newPage();
    async function openStudent(page){
      await page.goto(origin+"/student-assessments.html");
      await expect(page.locator("#assignmentsFeed")).toContainText(assessment.title);
      await page.locator('#assignmentsFeed [onclick*="viewAssessmentDetails"]').first().click();
      await expect(page.locator("#evidenceCommitList input[type=radio]")).toHaveCount(2);
    }
    async function openTeacher(studentId="alice"){
      await teacher.goto(origin+"/repofetch.html?section=fixture-11-A&student="+studentId+"&assessment=fixture-v2");
      await expect(teacher.locator("#manualReviewStudent")).toContainText("Fixture "+studentId);
      await expect(teacher.frameLocator("#integratedEvidenceFrame").locator("#evidenceTitle")).toContainText(assessment.title);
    }
    function evidenceFrame(){return teacher.frameLocator("#integratedEvidenceFrame");}
    async function approve(withContribution=true){
      await teacher.locator("#integratedEvidenceDetails").evaluate(details=>{details.open=true;});
      const frame=evidenceFrame();
      if(withContribution)await frame.locator('[data-contribution-sha="'+ownSha+'"]').check();
      await frame.locator("#evidenceContributionScope").fill(withContribution?fixtureScope:"No independent individual contribution has been verified for Bob; shared screens cannot earn credit.");
      await frame.locator("#evidenceReviewNote").fill("Inspected selected diffs, pinned source and independently verified the individual scope.");
      await frame.locator("#evidenceConfirm").check();
      await frame.locator("#evidenceApprove").click();
      await expect(teacher.locator("#integratedEvidenceStatus")).toContainText("approved");
    }
    async function saveReviewedGrade(){
      await teacher.locator("#manualReviewScore").fill("18");
      await teacher.locator("#manualReviewReason").fill("Observed visual quality directly and verified the student's assigned welcome-screen contribution.");
      await teacher.locator("#manualReviewConfirm").check();
      await teacher.locator("#manualReviewSave").click();
      await expect(teacher.locator("#manualReviewStatus")).toContainText("saved as UNPUBLISHED");
    }
    async function openGrade(){
      await gradebook.goto(origin+"/gradebook.html");
      await expect(gradebook.locator("#gbQuarterSection option")).toContainText(["fixture-11-A"]);
      await gradebook.locator("#gbQuarterSection").selectOption("fixture-11-A");
      await gradebook.locator("#gbQuarter").selectOption("Q3");
      await gradebook.locator("#gbQuarterTable button").filter({hasText:"18 / 20"}).click();
    }
    await openStudent(student);
    await student.locator('#evidenceCommitList input[type=radio]').nth(1).check();
    await student.locator("#evidenceSubmit").click();
    await expect(student.locator("#evidenceStatus")).toContainText("submitted for teacher verification");
    await waitRecord(student,"assessment_evidence/alice_fixture-v2","checkpointSha",ownSha);
    await student.locator('#evidenceCommitList input[type=radio]').first().check();
    await student.locator("#evidenceSubmit").click();
    await expect(student.locator("#evidenceStatus")).toContainText("submitted for teacher verification");
    await waitRecord(student,"assessment_evidence/alice_fixture-v2","revision",1);
    await student.locator("#evidenceWithdraw").click();
    await expect(student.locator("#evidenceStatus")).toContainText("Evidence withdrawn");
    await expect(student.locator("#assignmentsFeed")).toContainText("Evidence withdrawn");
    omitSavedCommit=true;await openStudent(student);
    const savedCommit=student.getByRole("checkbox",{name:"Include commit "+ownSha.slice(0,12)+" as evidence",exact:true});
    await savedCommit.uncheck();await expect(savedCommit).not.toBeChecked();
    await student.locator("#evidenceClear").click();
    await expect(student.locator("#evidenceSelectionSummary")).toContainText("No evidence");
    await student.getByRole("radio",{name:"Set commit "+groupSha.slice(0,12)+" as project checkpoint",exact:true}).check();
    await savedCommit.check();omitSavedCommit=false;
    await student.locator("#evidenceSubmit").click();
    await expect(student.locator("#evidenceStatus")).toContainText("submitted for teacher verification");
    validated("student submit, resubmit, withdraw and resubmit");
    await openTeacher();
    await expect(teacher.locator("#manualReviewSave")).toBeDisabled();
    await expect(teacher.locator("#manualReviewAIGenerate")).toBeDisabled();
    await approve();
    await expect(teacher.locator("#manualReviewAIGenerate")).toBeEnabled();
    let evidence=await waitRecord(teacher,"assessment_evidence/alice_fixture-v2","status","approved");
    assert.deepEqual(evidence.verifiedContributionCommits,[ownSha]);
    assert.equal(evidence.checkpointSha,groupSha);
    assert.equal((await browserRecord(teacher,"student_grades/alice_fixture-v2")).exists,false);
    await openStudent(student);
    await expect(student.locator("#evidenceSubmit")).toBeDisabled();
    await expect(student.locator("#evidenceWithdraw")).toBeDisabled();
    await expect(student.locator("#modalScoreArea")).toBeHidden();
    await teacher.locator("#manualReviewAIGenerate").click();
    await expect(teacher.locator("#manualReviewAIStatus")).toContainText("503");
    assert.equal((await browserRecord(teacher,"student_grades/alice_fixture-v2")).exists,false);
    await teacher.locator("#manualReviewAIGenerate").click();
    await expect(teacher.locator("#manualReviewAIScores")).toContainText("Teacher review needed");
    await expect(teacher.locator("#manualReviewFeedback")).toHaveValue("");
    await teacher.locator("#manualReviewUseFeedback").click();
    await expect(teacher.locator("#manualReviewScore")).toHaveValue("");
    assert.equal((await browserRecord(teacher,"student_grades/alice_fixture-v2")).exists,false);
    await saveReviewedGrade();
    let grade=(await browserRecord(teacher,"student_grades/alice_fixture-v2")).data;
    assert.equal(grade.published,false);assert.equal(grade.score,18);assert.equal(grade.gradedSha,groupSha);
    assert.equal(grade.evidenceRevision,evidence.revision);
    assert.equal((await browserRecord(student,"student_grades/alice_fixture-v2")).error,"permission-denied");
    assert.equal((await browserRecord(student,"assessment_private/fixture-v2")).error,"permission-denied");
    validated("inline teacher approval, provider failure, partial draft and explicit private save");
    await openGrade();await gradebook.locator("#gbDetailPublish").click();
    await waitRecord(gradebook,"student_grades/alice_fixture-v2","published",true);
    await openStudent(student);await expect(student.locator("#modalScoreValue")).toHaveText("18");
    await expect(student.locator("#modalFeedbackProvenance")).toBeVisible();
    await openTeacher();await teacher.locator("#integratedEvidenceDetails").evaluate(details=>{details.open=true;});
    await evidenceFrame().locator("#evidenceReviewNote").fill("Student requested correction; preserve the original published grade and audit history.");
    await evidenceFrame().locator("#evidenceReopen").click();
    await expect(evidenceFrame().locator("#evidenceReviewStatus")).toContainText("Unpublish");
    await waitRecord(teacher,"assessment_evidence/alice_fixture-v2","status","approved");
    await teacher.locator("#manualReviewUnpublish").click();
    await waitRecord(gradebook,"student_grades/alice_fixture-v2","published",false);
    await expect(evidenceFrame().locator("#evidenceTitle")).toContainText(assessment.title);
    await evidenceFrame().locator("#evidenceReviewNote").fill("Instructor reopened at the student's request after explicitly unpublishing the protected grade.");
    await evidenceFrame().locator("#evidenceReopen").click();
    await waitRecord(teacher,"assessment_evidence/alice_fixture-v2","status","reopened");
    await openStudent(student);await expect(student.locator("#evidenceSubmit")).toBeEnabled();
    await student.locator("#evidenceSubmit").click();
    await expect(student.locator("#evidenceStatus")).toContainText("submitted for teacher verification");
    await openTeacher();await approve();
    evidence=(await browserRecord(teacher,"assessment_evidence/alice_fixture-v2")).data;
    assert.notEqual(evidence.revision,grade.evidenceRevision);
    await openGrade();await gradebook.locator("#gbDetailPublish").click();
    await expect.poll(()=>dialogs.some(message=>message.includes("Evidence changed or needs review"))).toBe(true);
    assert.equal((await browserRecord(gradebook,"student_grades/alice_fixture-v2")).data.published,false);
    await saveReviewedGrade();
    await teacher.locator("#manualReviewPublish").click();
    grade=await waitRecord(gradebook,"student_grades/alice_fixture-v2","published",true);
    assert.equal(grade.evidenceRevision,evidence.revision);
    await openStudent(student);await expect(student.locator("#modalScoreValue")).toHaveText("18");
    validated("individual publication, protected reopening, unpublish, reopen and same-SHA stale-grade protection");
    await openStudent(peer);await peer.locator('#evidenceCommitList input[type=radio]').first().check();
    await peer.locator("#evidenceSubmit").click();
    await expect(peer.locator("#evidenceStatus")).toContainText("submitted for teacher verification");
    await openTeacher("bob");await approve(false);
    await expect(teacher.locator("#manualReviewAIGenerate")).toBeDisabled();
    assert.equal((await browserRecord(teacher,"student_grades/bob_fixture-v2")).exists,false);
    assert.equal((await browserRecord(student,"assessment_evidence/bob_fixture-v2")).error,"permission-denied");
    assert.equal((await browserRecord(peer,"student_grades/alice_fixture-v2")).error,"permission-denied");
    const audit=await browserRecord(student,"assessment_evidence/alice_fixture-v2/revisions/1");
    assert.equal(audit.data.before.checkpointSha,ownSha);assert.equal(audit.data.after.checkpointSha,groupSha);
    assert.equal(audit.data.actorUid,accounts.alice.uid);
    validated("noncontributor evaluation blocked, student privacy and immutable revision provenance");
    assert.deepEqual(blockedRequests,[],"Unexpected external requests were blocked");
    assert.deepEqual(errors,[],"Unexpected browser runtime errors");
    await teacher.screenshot({path:path.join(output,"teacher-review.png")});
    await student.setViewportSize({width:390,height:844});
    await expect.poll(()=>student.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),
      {message:"Mobile layout must settle without horizontal overflow"}).toBe(true);
    await student.screenshot({path:path.join(output,"student-mobile.png")});
    await student.setViewportSize({width:1360,height:1000});
    await student.goto(origin+"/student-xml-lab.html");
    await expect(student.locator("#xmlStatus")).toContainText("views translated");
    await student.locator("#xmlEditor").fill('<ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto" android:layout_width="match_parent" android:layout_height="match_parent"><TextView android:layout_width="120dp" android:layout_height="48dp" android:text="Hello &lt;script&gt;" app:layout_constraintTop_toTopOf="parent" app:layout_constraintStart_toStartOf="parent" /></ConstraintLayout>');
    await student.locator("#xmlRender").click();
    await expect(student.locator("#xmlGenerated")).toHaveValue(/Hello &lt;script&gt;/);
    await expect(student.locator("#xmlGenerated")).toHaveValue(/position:absolute/);
    assert.equal(await student.locator("#xmlPreview").getAttribute("sandbox"),"");
    await student.locator("#xmlEditor").fill('<!DOCTYPE view SYSTEM "https://example.com/private"><view/>');
    await student.locator("#xmlRender").click();await expect(student.locator("#xmlStatus")).toContainText("Document types");
    validated("safe Android XML translation, parent constraints and entity rejection");
    await student.goto(origin+"/student-practice.html");
    await student.locator("#av-alert-toggle").click();await expect(student.locator("#av-alert-list")).toContainText("Adminerva update");await student.locator("#av-alert-toggle").click();
    await expect(student.locator("#practiceClass option")).toContainText(["fixture-11-A"]);
    await student.getByText("My practice points and class standings",{exact:true}).click();
    await student.locator("#practiceAlias").fill("Learner One");await student.locator("#practiceOptIn").check();await student.locator("#practiceSavePreferences").click();
    await waitRecord(student,"practice_profiles/"+accounts.alice.uid,"leaderboardOptIn",true);
    await teacher.goto(origin+"/practice-analytics.html");
    await teacher.locator("#av-alert-toggle").click();await expect(teacher.locator("#av-alert-list")).toContainText("Adminerva update");await teacher.locator("#av-alert-toggle").click();
    await expect(teacher.locator("#practiceAnalyticsSection option")).toContainText(["fixture-11-A"]);
    await teacher.locator("#practiceAnalyticsLoad").click();
    await teacher.locator("#practiceAnalyticsList article").filter({hasText:"Fixture alice"}).getByRole("button").click();
    await teacher.locator('[data-reviewed-mission][value="j1"]').check();
    await teacher.locator("#practicePointsNote").fill("Teacher observed the mission implementation and independently reviewed the student's explanation.");
    await teacher.locator("#practiceAcceptPoints").click();await waitRecord(teacher,"practice_scores/alice","points",10);
    await teacher.locator("#practicePublishStandings").click();await waitRecord(student,"practice_boards/alice","section","fixture-11-A");
    await student.reload();await expect(student.locator("#practiceReviewedPoints")).toContainText("10 teacher-reviewed");await expect(student.locator("#practiceStandings")).toContainText("Learner One");
    await student.getByText("My practice points and class standings",{exact:true}).click();await student.screenshot({path:path.join(output,"practice-class-points.png")});
    assert.equal((await browserRecord(peer,"practice_scores/alice")).error,"permission-denied");
    await student.goto(origin+"/patch-notes.html");await expect(student.locator("#patchList")).toContainText("Review & Grade");
    validated("private teacher-reviewed practice points, opt-in alias class snapshot and public patch history");
    await student.goto(origin+"/student-xml-lab.html");
    await expect(student.locator("#activity-save")).toBeEnabled();
    const beforeConsent=await browserRecord(student,"activity_preferences/"+accounts.alice.uid);
    assert.equal(beforeConsent.exists,false);
    await student.locator("#page-help-open").click();
    await student.locator("#page-help-dialog details").evaluate(details=>{details.open=true;});
    await student.locator("#activity-share").check();await student.locator("#activity-diagnostics").check();await student.locator("#activity-save").click();
    await waitRecord(student,"activity_preferences/"+accounts.alice.uid,"enabled",true);
    await student.locator("#page-help-dialog").getByText("Close help",{exact:true}).click();
    await student.locator("#xmlRender").click();
    await student.evaluate(()=>{window.fixtureLoading=[window.beginLoading("First operation",document.querySelector("main")),window.beginLoading("Second operation",document.querySelector("main"))];window.hideSubtleLoader();});
    await expect(student.locator("#subtleLoader")).toBeVisible();
    await student.evaluate(()=>window.fixtureLoading[0]());await expect(student.locator("#subtleLoaderText")).toContainText("Second operation");
    assert.equal(await student.locator("main").getAttribute("aria-busy"),"true");
    await student.evaluate(()=>{window.fixtureLoading[1]();window.fixtureLoading[1]();});await expect(student.locator("#subtleLoader")).toBeHidden();
    assert.equal(await student.locator("main").getAttribute("aria-busy"),null);
    await student.locator('[title="Report Issue"]').click();
    await student.locator("#bug-title").fill("Fixture XML preview problem");await student.locator("#bug-description").fill("After Run, the fixture preview needs investigation.");
    await student.locator("#bug-attach-diagnostics").check();await student.locator("#submit-bug-btn").click();
    await expect(student.locator("#bug-modal")).toBeHidden();
    const issueId=await student.evaluate(async()=>{
      const {db,auth}=await import("/js/core/firebase-core.js");const {getDocs,collection,query,where}=await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
      const reports=await getDocs(query(collection(db,"issues"),where("reporterUid","==",auth.currentUser.uid)));return reports.docs[0].id;
    });
    const admin=await (await newIdentity("admin")).newPage();
    await admin.goto(origin+"/admin-analytics.html");await expect(admin.locator("#admin-analytics-status")).toContainText("Refreshed");
    await expect(admin.locator("#raw-events")).toContainText("xml-lab");
    const trail=await browserRecord(admin,"issue_diagnostics/"+issueId);assert.ok(trail.data.actions.includes("run"));
    assert.equal((await browserRecord(teacher,"issue_diagnostics/"+issueId)).error,"permission-denied");
    await admin.locator("#roster-sections").selectOption(["fixture-11-A"]);await admin.locator("#save-roster").click();await expect(admin.locator("#admin-analytics-status")).toContainText("Assignment saved");
    await admin.locator("#publish-engagement").click();await expect(admin.locator("#admin-analytics-status")).toContainText("Teacher summary refreshed");
    await admin.screenshot({path:path.join(output,"admin-analytics.png"),fullPage:true});
    await teacher.goto(origin+"/reporeviewDashboard.html?range=week#engagement-heading");
    await expect(teacher).toHaveURL(origin+"/teacher-analytics.html?range=week#engagement-heading");
    await expect(teacher.locator("#analytics-teacher")).toBeDisabled();await expect(teacher.locator("#engagement-rows")).toContainText("alice");
    assert.equal(await teacher.locator("#bug-count").count(),0);
    await teacher.screenshot({path:path.join(output,"teacher-analytics.png")});
    await admin.goto(origin+"/teacher-analytics.html");await expect(admin.locator("#analytics-teacher")).toBeEnabled();
    await expect(admin.locator("#engagement-rows")).toContainText("alice");
    await admin.goto(origin+"/issues.html?issue="+issueId);await expect(admin.locator("#issue-diagnostics")).toContainText("xml-lab → run");
    await teacher.goto(origin+"/admin-analytics.html");await expect(teacher.locator("#admin-analytics-status")).toContainText("No monitoring records were requested");await expect(teacher.locator("#operations")).toBeHidden();
    await student.locator("#page-help-open").click();await student.locator("#activity-share").uncheck();await student.locator("#activity-save").click();await waitRecord(student,"activity_preferences/"+accounts.alice.uid,"enabled",false);
    await admin.goto(origin+"/admin-analytics.html");await expect(admin.locator("#admin-analytics-status")).toContainText("Refreshed");await admin.locator("#publish-engagement").click();await expect(admin.locator("#admin-analytics-status")).toContainText("Teacher summary refreshed");
    const summary=await browserRecord(admin,"analytics_views/"+accounts.teacher.email);assert.deepEqual(summary.data.rows,[]);
    const guest=await (await newIdentity("guest")).newPage();const guestRequests=[];guest.on("request",request=>guestRequests.push(request.url()));
    await guest.goto(origin+"/wiki.html");await expect(guest.locator("h1")).toContainText("Adminerva Wiki");await guest.locator("#page-help-open").click();await expect(guest.locator("#activity-save")).toBeDisabled();
    assert.ok(!guestRequests.some(url=>url.includes("firebase")||url.includes("activity_events")),"Guest help must not initialize tracking or Firebase");
    await guest.locator("#page-help-dialog").getByText("Close help",{exact:true}).click();
    await guest.setViewportSize({width:390,height:844});await expect.poll(()=>guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await guest.screenshot({path:path.join(output,"public-wiki-mobile.png"),fullPage:true});
    validated("opt-in minimized activity, admin-only report trails, teacher snapshots, consent refresh, public wiki, legacy redirect and concurrent loaders");
    assert.deepEqual(blockedRequests,[]);assert.deepEqual(errors,[]);
    await writeFile(path.join(output,"result.json"),JSON.stringify({projectId,backend:"real Auth + Firestore emulators",sdkVersion:"10.13.0",externalServices:"GitHub and Gemini fixtures",milestones,modelRequests,errors,blockedRequests},null,2));
    console.log(JSON.stringify({passed:milestones,artifacts:output}));
  }catch(error){
    const layouts=[];
    if(browser)for(const [index,context] of contexts.entries())for(const [pageIndex,page] of context.pages().entries())
    {
      await page.screenshot({path:path.join(output,"failure-"+index+"-"+pageIndex+".png")}).catch(()=>{});
      const layout=await page.evaluate(()=>({
        viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        overflow:[...document.querySelectorAll("body *")].map(element=>{
          const rect=element.getBoundingClientRect();
          return {id:element.id,tag:element.tagName,className:String(element.className).slice(0,220),left:rect.left,right:rect.right};
        }).filter(element=>element.right>innerWidth+1||element.left< -1).slice(0,30)
      })).catch(()=>null);
      layouts.push({context:index,page:pageIndex,layout});
    }
    await writeFile(path.join(output,"failure-layouts.json"),JSON.stringify(layouts,null,2));
    await writeFile(path.join(output,"failure.json"),JSON.stringify({message:error.message,errors,blockedRequests,dialogs,milestones},null,2));
    throw error;
  }finally{
    await browser?.close();
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await environment.cleanup();await deleteApp(adminApp);
  }
});
