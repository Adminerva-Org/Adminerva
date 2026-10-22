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
import {getFirestore as getAdminFirestore, Timestamp, FieldValue} from "firebase-admin/firestore";
import monitoringWorker from "../../functions/monitoring-service.js";
import practiceBackend from "../../functions/practice-service.js";
import teachingBackend from "../../functions/teaching-access-service.js";
import {personalPlanId} from "../../js/lesson-review/workspace-model.mjs";
import {releasePresentation} from "../../js/core/release-version.mjs";
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

test("teacher and students complete the V2 evidence lifecycle using real Auth and Firestore emulators",{timeout:600000},async()=>{
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
  let modelRequests=0,providerOutage=true,providerMalformed=false;
  let omitSavedCommit=false;
  let interceptSummaryConfirmation=null;
  try{
    await environment.clearFirestore();
    const authAdmin=getAuth(adminApp);
    const practiceService=practiceBackend.createPracticeService({db:getAdminFirestore(adminApp),Timestamp,resolveUser:uid=>authAdmin.getUser(uid)});
    const users=await authAdmin.listUsers();
    if(users.users.length)await authAdmin.deleteUsers(users.users.map(user=>user.uid));
    for(const account of Object.values(accounts))await authAdmin.createUser({...account,password,emailVerified:true});
    await environment.withSecurityRulesDisabled(async context=>{
      const db=context.firestore();
      await Promise.all([
        setDoc(doc(db,"staff_access",accounts.teacher.email),{email:accounts.teacher.email,displayName:"Fixture instructor",role:"teacher",status:"active",sections:["fixture-11-A"],revision:1}),
        ...["alice","bob"].map(studentId=>setDoc(doc(db,"students",studentId),{
          name:"Fixture "+studentId,email:accounts[studentId].email,section:"fixture-11-A",githubUsername:"fixture-"+studentId,repoUrl:repository
        })),
        setDoc(doc(db,"assessments","fixture-v2"),assessment),
        setDoc(doc(db,"assessment_private","fixture-v2"),{ownerUid:accounts.teacher.uid,sectionIds:["fixture-11-A"],systemPersona:"Private fixture instructions"})
      ]);
    });
    const teachingService=teachingBackend.createTeachingAccessService({db:getAdminFirestore(adminApp),Timestamp});
    await Promise.all(["alice","bob"].map(studentId=>teachingService.synchronize(studentId)));
    const assets=new Map(),editorAssets=new Map();
    for(const url of ["https://cdn.quilljs.com/1.3.6/quill.min.js","https://cdn.quilljs.com/1.3.6/quill.snow.css",
      "https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs@3.12.0/libs/jszip.min.js","https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs@3.12.0/dist/pptxgen.min.js",
      "https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js","https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css",
      "https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js",
      "https://cdn.jsdelivr.net/npm/flatpickr","https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css",
      "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/loader.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"]){
      const response=await fetch(url);assert.equal(response.ok,true);assets.set(url,await response.text());
    }
    for(const name of ["firebase-app.js","firebase-auth.js","firebase-firestore.js","firebase-functions.js"]){
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
        const practiceAction={practiceSession:"acquire",practiceStart:"start",practicePredict:"predict",practiceComplete:"complete"}[pathname.split("/").at(-1)];
        if(practiceAction&&pathname.startsWith("/"+projectId+"/asia-southeast1/")){
          response.setHeader("Content-Type","application/json");
          try{
            assert.equal(request.method,"POST");
            const token=await authAdmin.verifyIdToken(String(request.headers.authorization||"").replace(/^Bearer /,""));
            let body="";for await(const chunk of request){body+=chunk;if(body.length>16000)throw Error("Request too large");}
            const result=await practiceService[practiceAction]({auth:{uid:token.uid,token},data:JSON.parse(body).data});
            response.end(JSON.stringify({result}));
          }catch(error){response.statusCode=400;response.end(JSON.stringify({error:{status:(error.code||"internal").toUpperCase().replaceAll("-","_"),message:error.message,details:error.details}}));}
          return;
        }
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
      await context.addInitScript(({role,port})=>{
        if(location.protocol!=="http:")return;
        localStorage.setItem("fixture-role",role);
        window.ADMINERVA_PRACTICE_EMULATOR=port;
        localStorage.setItem("Adminerva_Role",role.startsWith("teacher")?"teacher":role==="admin"?"superadmin":"student");
        if(role==="teacher")localStorage.setItem("Adminerva_gemini_token","fixture-key-never-valid-in-production");
      },{role,port:server.address().port});
      await context.route("**/*",async route=>{
        const url=route.request().url(),parsed=new URL(url);
        if(assets.has(url))return route.fulfill({contentType:url.endsWith(".css")?"text/css":"text/javascript",body:assets.get(url)});
        if(url.startsWith("https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/")){
          if(!editorAssets.has(url))editorAssets.set(url,fetch(url,{signal:AbortSignal.timeout(20000)}).then(async response=>{
            assert.equal(response.ok,true,"Could not load the pinned code editor asset: "+url);
            return {body:Buffer.from(await response.arrayBuffer()),contentType:response.headers.get("content-type")||"application/octet-stream",headers:{"Access-Control-Allow-Origin":"*"}};
          }));
          return route.fulfill(await editorAssets.get(url));
        }
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
          if(prompt.startsWith("Summarize ONLY")){
            assert.match(prompt,/Never infer individual roles/);
            return route.fulfill({json:{candidates:[{content:{parts:[{text:JSON.stringify({concept:"Sampled Android layout prototype.",feedback:"Review layout behavior on a device; source samples do not prove runtime completeness."})}]}}]}});
          }
          assert.match(prompt,/Do not deduct points from an individual for teammates' missing screens/);
          assert.match(prompt,new RegExp(homePath.replaceAll(".","\\.")));
          assert.ok(!prompt.includes("SELECTED COMMIT: "+groupSha),"Teammate changes must not be attributed to Alice");
          if(providerOutage)return route.fulfill({status:503,json:{error:{message:"Fixture provider outage"}}});
          if(providerMalformed)return route.fulfill({json:{candidates:[{content:{parts:[{text:"invalid response"}]}}]}});
          return route.fulfill({json:{candidates:[{content:{parts:[{text:JSON.stringify(providerDraft)}]}}]}});
        }
        if(parsed.hostname==="127.0.0.1"||parsed.hostname==="localhost")return route.continue();
        if(url==="https://accounts.google.com/gsi/client"||url==="https://cdn.jsdelivr.net/npm/html-docx-js/dist/html-docx.min.js")return route.fulfill({contentType:"text/javascript",body:""});
        blockedRequests.push(url);return route.abort("blockedbyclient");
      });
      context.on("page",page=>{
        page.on("pageerror",error=>errors.push(error.message));
        page.on("dialog",async dialog=>{
          dialogs.push(dialog.message());
          if(interceptSummaryConfirmation&&dialog.message().startsWith("Replace the teacher's engagement summary")){
            const action=interceptSummaryConfirmation;interceptSummaryConfirmation=null;await action();
          }
          await dialog.accept(dialog.type()==="prompt"?"Fixture teacher reviewed the evidence and documented this deliberate revision.":undefined);
        });
      });
      return context;
    }
    const student=await (await newIdentity("alice")).newPage();
    const teacherContext=await newIdentity("teacher");
    let teacherPinnedReads=0;
    teacherContext.on("request",request=>{
      const url=new URL(request.url());
      if(url.hostname==="api.github.com"&&(/\/commits\/[a-f0-9]{40}$/.test(url.pathname)||url.pathname.includes("/git/trees/")))teacherPinnedReads++;
    });
    const teacher=await teacherContext.newPage();
    const gradebook=await teacherContext.newPage();
    const peer=await (await newIdentity("bob")).newPage();
    await student.goto(origin+"/student-home.html");
    await expect(student.locator("#activity-preferences-dialog")).toBeVisible();
    assert.equal((await browserRecord(student,"activity_preferences/"+accounts.alice.uid)).exists,false);
    await expect(student.locator("#activity-share")).not.toBeChecked();
    await student.locator("#activity-share").check();
    await student.locator("#activity-never-show").check();
    await student.locator("#activity-dismiss").click();
    const dismissed=await waitRecord(student,"activity_preferences/"+accounts.alice.uid,"promptDismissed",true);
    assert.equal(dismissed.enabled,false,"Hiding the reminder must not save an unsaved sharing choice");
    await student.reload();await expect(student.locator("#activity-save")).toBeEnabled();
    await expect(student.locator("#activity-preferences-dialog")).not.toBeVisible();
    const otherDevice=await (await newIdentity("alice")).newPage();await otherDevice.goto(origin+"/student-home.html");
    await expect(otherDevice.locator("#activity-save")).toBeEnabled();await expect(otherDevice.locator("#activity-preferences-dialog")).not.toBeVisible();
    await otherDevice.goto(origin+"/student-settings.html");await otherDevice.locator("[data-activity-preferences]").click();
    await expect(otherDevice.locator("#activity-save")).toBeEnabled();await otherDevice.locator("#activity-never-show").uncheck();await otherDevice.locator("#activity-save").click();
    await waitRecord(otherDevice,"activity_preferences/"+accounts.alice.uid,"promptDismissed",false);await otherDevice.locator("#activity-dismiss").click();
    await otherDevice.goto(origin+"/student-home.html");await expect(otherDevice.locator("#activity-preferences-dialog")).toBeVisible();
    await otherDevice.locator("#activity-never-show").check();await otherDevice.locator("#activity-dismiss").click();
    await waitRecord(otherDevice,"activity_preferences/"+accounts.alice.uid,"promptDismissed",true);await otherDevice.close();
    await peer.goto(origin+"/student-home.html");await expect(peer.locator("#activity-preferences-dialog")).toBeVisible();
    await peer.locator("#activity-dismiss").click();
    validated("home reminder is account-scoped and dismissal never enables optional sharing");
    async function openStudent(page,taskId="fixture-v2"){
      await page.goto(origin+"/student-assessments.html");
      await expect(page.locator("#assignmentsFeed")).toContainText(assessment.title);
      await page.locator('#assignmentsFeed [onclick*="'+taskId+'"]').first().click();
      await expect(page.locator("#evidenceCommitList input[type=radio]")).toHaveCount(2);
    }
    async function openTeacher(studentId="alice",taskId="fixture-v2"){
      await teacher.goto(origin+"/repofetch.html?section=fixture-11-A&student="+studentId+"&assessment="+taskId);
      await expect(teacher.locator("#manualReviewStudent")).toContainText("Fixture "+studentId);
      await expect(teacher.locator("#integratedEvidencePanel #evidenceTitle")).toContainText(assessment.title);
    }
    function evidenceFrame(){return teacher.locator("#integratedEvidencePanel");}
    async function approve(withContribution=true){
      await teacher.locator("#integratedEvidenceDetails").evaluate(details=>{details.open=true;});
      const frame=evidenceFrame();
      await expect(frame.locator("#evidenceApprove")).toBeEnabled();
      await expect(frame.locator("#evidenceReviewNote")).toBeEnabled();
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
    await expect(teacher.locator("#manualReviewModal iframe")).toHaveCount(0);
    await expect(teacher.locator("#integratedContributionSummary")).toContainText("Detected GitHub account");
    await expect(teacher.locator("#integratedGroupHistory")).toContainText(ownSha.slice(0,12));
    await expect(teacher.locator("#integratedGroupSummary")).toContainText("Fixture alice");
    for(const id of ["integratedEvidencePanel","integratedGroupSummary","integratedGroupHistory","integratedContributionSummary"])
      await expect(teacher.locator("#"+id)).toHaveAttribute("aria-busy","false");
    const readsBeforeExpansion=teacherPinnedReads;
    for(const id of ["integratedGroupDetails","integratedGroupInspectorDetails","integratedInspectorDetails"])
      await teacher.locator("#"+id).evaluate(async details=>{details.open=true;await new Promise(requestAnimationFrame);details.open=false;await new Promise(requestAnimationFrame);});
    assert.equal(teacherPinnedReads,readsBeforeExpansion,"Opening preloaded accordions must not rerun evidence reads");
    await evidenceFrame().locator("#evidenceReviewNote").fill("Unsaved review note must survive a genuine concurrent resubmission.");
    await student.locator("#evidenceSubmit").click();
    await expect(evidenceFrame().locator("#evidenceActionStatus")).toContainText("Evidence changed in another session");
    await expect(evidenceFrame().locator("#evidenceReviewNote")).toHaveValue("Unsaved review note must survive a genuine concurrent resubmission.");
    await expect(evidenceFrame().locator("#evidenceApprove")).toBeDisabled();
    await evidenceFrame().locator("#evidenceReload").click();
    await expect(evidenceFrame().locator("#evidenceApprove")).toBeEnabled();
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
    await expect(teacher.locator("#manualReviewFallback")).toBeVisible();
    await expect(teacher.locator("#manualReviewManual")).toBeEnabled();
    providerOutage=false;
    assert.equal((await browserRecord(teacher,"student_grades/alice_fixture-v2")).exists,false);
    providerMalformed=true;
    await teacher.locator("#manualReviewFeedback").fill("Private teacher notes kept through a service failure.");
    await teacher.locator("#manualReviewRetry").click();
    await expect(teacher.locator("#manualReviewAIStatus")).toContainText("invalid format");
    await expect(teacher.locator("#manualReviewFeedback")).toHaveValue("Private teacher notes kept through a service failure.");
    assert.equal((await browserRecord(teacher,"student_grades/alice_fixture-v2")).exists,false);
    providerMalformed=false;await teacher.locator("#manualReviewFeedback").fill("");
    await teacher.locator("#manualReviewRetry").click();
    await expect(teacher.locator("#manualReviewAIScores")).toContainText("Teacher review needed");
    await expect(teacher.locator("#manualReviewAIScores")).toContainText("13/15");
    await expect(teacher.locator("#manualReviewAIScores")).toContainText("narrow and wide widths");
    await expect(teacher.locator("#manualReviewUseScore")).toBeDisabled();
    await expect(teacher.locator("#manualReviewScore")).toBeEnabled();
    for(const width of [1360,390]){
      await teacher.setViewportSize({width,height:1000});
      const bounds=await teacher.evaluate(()=>{
        const steps=document.getElementById("manualReviewSteps"),body=document.getElementById("manualReviewBody");
        body.scrollTop=200;
        return {headerBottom:steps.previousElementSibling.getBoundingClientRect().bottom,navTop:steps.getBoundingClientRect().top,navBottom:steps.getBoundingClientRect().bottom,bodyTop:body.getBoundingClientRect().top,scroll:body.scrollTop};
      });
      assert.ok(Math.abs(bounds.headerBottom-bounds.navTop)<=1,"Review navigation must meet the header without a gap");
      assert.ok(Math.abs(bounds.navBottom-bounds.bodyTop)<=1,"Only the unified body scrolls beneath the navigation");
      assert.ok(bounds.scroll>0);
    }
    await teacher.screenshot({path:path.join(output,"review-navigation-mobile.png")});
    await teacher.setViewportSize({width:1360,height:1000});
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
    await expect(evidenceFrame().locator("#evidenceActionStatus")).toContainText("Unpublish");
    await waitRecord(teacher,"assessment_evidence/alice_fixture-v2","status","approved");
    await teacher.locator("#manualReviewUnpublish").click();
    await waitRecord(gradebook,"student_grades/alice_fixture-v2","published",false);
    await expect(evidenceFrame().locator("#evidenceTitle")).toContainText(assessment.title);
    await evidenceFrame().locator("#evidenceReviewNote").fill("Instructor reopened at the student's request after explicitly unpublishing the protected grade.");
    await evidenceFrame().locator("#evidenceReopen").click();
    await waitRecord(teacher,"assessment_evidence/alice_fixture-v2","status","reopened");
    await expect(student.locator("#evidenceSubmit")).toBeEnabled();
    await expect(student.locator("#evidenceStatus")).toContainText("reopened");
    const reopenedSelection=student.getByRole("checkbox",{name:"Include commit "+ownSha.slice(0,12)+" as evidence",exact:true});
    await reopenedSelection.uncheck();await expect(reopenedSelection).not.toBeChecked();
    await reopenedSelection.check();await expect(reopenedSelection).toBeChecked();
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
    await getAdminFirestore(adminApp).doc("assessments/fixture-legacy").set({...assessment,title:assessment.title+" — legacy"});
    const legacy={updatedAt:Timestamp.fromMillis(1000),submittedAt:Timestamp.fromMillis(900),status:"approved",approvedCheckpointSha:groupSha,
      checkpointSha:groupSha,selectedCommits:[ownSha,groupSha],repository,section:"fixture-11-A",assessmentId:"fixture-legacy",studentId:"alice"};
    await getAdminFirestore(adminApp).doc("assessment_evidence/alice_fixture-legacy").set(legacy);
    await openTeacher("alice","fixture-legacy");
    await expect(teacher.locator("#manualReviewAIGenerate")).toBeDisabled();
    await teacher.locator("#manualReviewVerifyContributions").click();
    await evidenceFrame().locator('[data-contribution-sha="'+ownSha+'"]').check();
    await evidenceFrame().locator("#evidenceContributionScope").fill(fixtureScope);
    await evidenceFrame().locator("#evidenceReviewNote").fill("Complete the old checkpoint approval with independently verified individual contributions.");
    await evidenceFrame().locator("#evidenceConfirm").check();
    await evidenceFrame().locator("#evidenceApprove").click();
    await expect(teacher.locator("#manualReviewAIGenerate")).toBeEnabled();
    const legacyUpdated=await waitRecord(teacher,"assessment_evidence/alice_fixture-legacy","revision",1);
    assert.deepEqual(legacyUpdated.selectedCommits,legacy.selectedCommits);
    assert.deepEqual(legacyUpdated.verifiedContributionCommits,[ownSha]);
    const legacyAudit=(await browserRecord(teacher,"assessment_evidence/alice_fixture-legacy/revisions/1")).data;
    assert.equal(legacyAudit.before.status,"approved");assert.equal(legacyAudit.before.verifiedContributionCommits,undefined);
    await teacher.locator("#manualReviewAIGenerate").click();
    await expect(teacher.locator("#manualReviewAIScores")).toContainText("Teacher review needed");
    assert.equal((await browserRecord(teacher,"student_grades/alice_fixture-legacy")).exists,false);
    await teacher.locator("#manualReviewAISection").scrollIntoViewIfNeeded();
    await teacher.screenshot({path:path.join(output,"inline-legacy-evaluation.png"),fullPage:true});
    validated("inline parallel review, real stale-edit protection, live reopened checkboxes and audited legacy contribution verification enable evaluation");
    await getAdminFirestore(adminApp).doc("assessments/fixture-proposal").set({...assessment,title:assessment.title+" — proposal"});
    await getAdminFirestore(adminApp).doc("assessment_evidence/alice_fixture-proposal").set({studentId:"alice",assessmentId:"fixture-proposal",section:"fixture-11-A",repository,
      selectedCommits:[ownSha,groupSha],checkpointSha:groupSha,status:"needs_review",source:"teacher_discovered",discoveredBy:accounts.teacher.uid,recordedAt:Timestamp.now(),updatedAt:Timestamp.now()});
    await openStudent(student,"fixture-proposal");await expect(student.locator("#evidenceSubmit")).toBeDisabled();
    await openTeacher("alice","fixture-proposal");
    await evidenceFrame().locator("#evidenceReviewNote").fill("Release this historical proposal so the student can choose their own actual changes.");
    await evidenceFrame().locator("#evidenceReopen").click();
    const released=await waitRecord(teacher,"assessment_evidence/alice_fixture-proposal","status","reopened");
    assert.equal(released.submittedAt,undefined);
    await expect(student.locator("#evidenceSubmit")).toBeEnabled();
    await student.getByRole("checkbox",{name:"Include commit "+ownSha.slice(0,12)+" as evidence",exact:true}).uncheck();
    await student.locator("#evidenceSubmit").click();
    const adopted=await waitRecord(teacher,"assessment_evidence/alice_fixture-proposal","status","submitted");
    assert.deepEqual(adopted.selectedCommits,[groupSha]);assert.equal(adopted.revision,2);assert.ok(adopted.submittedAt);
    assert.equal((await browserRecord(teacher,"student_grades/alice_fixture-proposal")).exists,false);
    validated("historical proposals require instructor release and a real student submission before approval");
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
    await getAdminFirestore(adminApp).doc("student_practice_progress/"+accounts.alice.uid+"/courses/java").set({ownerUid:accounts.alice.uid,courseId:"java",completed:["j1"],reflections:{j1:"I predicted the value, ran the example and explained the observed result."},updatedAt:Timestamp.now()});
    await student.goto(origin+"/student-practice.html");
    await student.locator("#av-alert-toggle").click();await expect(student.locator("#av-alert-list")).toContainText("Adminerva update");await student.locator("#av-alert-toggle").click();
    await expect(student.locator("#practiceClass option")).toContainText(["fixture-11-A"]);
    await expect(student.locator("#practiceOverview")).toContainText("0 / 300");
    await expect(student.locator("#practiceCourseList [data-practice-module]")).toHaveCount(20);
    assert.equal(await student.locator("#practiceOptIn,#practiceSavePreferences").count(),0);
    await expect(student.locator("#practiceSessionStatus")).toContainText("Connected");
    await student.locator("#practiceCourseList [data-practice-module]").first().evaluate(element=>{element.open=true;});
    await student.locator("#practiceCourseList [data-practice-module] button").first().click();
    await expect(student.locator("#practiceChoices input")).toHaveCount(4);
    const practiceDatabase=getAdminFirestore(adminApp);
    const lease=(await practiceDatabase.doc("practice_sessions/"+accounts.alice.uid).get()).data();
    const challenge=(await practiceDatabase.doc("practice_attempts/"+lease.activeAttemptId).get()).data();
    await student.locator('#practiceChoices input[value="'+challenge.question.correct+'"]').check();
    await student.locator("#practiceReasoning").fill("I traced the changes to the variable in sequence and predicted the final result.");
    await student.locator("#practiceCheckBtn").click();
    await expect(student.locator("#practiceExperimentPanel")).toBeVisible();
    await student.evaluate(async({uid,attemptId,correctChoice,question})=>{
      const {makeCheckedPracticeTransfer,practiceBridgeKey,recordPracticeRun}=await import("/js/student/practice-playground-bridge.mjs");
      const transfer=makeCheckedPracticeTransfer(uid,{state:"predicted",attemptId,courseId:"java",missionId:"j1",correctChoice,question});
      sessionStorage.setItem(practiceBridgeKey(uid),JSON.stringify(transfer));
      recordPracticeRun(sessionStorage,uid,"Fixture sandbox execution attempt");
    },{uid:accounts.alice.uid,attemptId:challenge.attemptId,correctChoice:challenge.question.correct,question:challenge.question});
    await student.goto(origin+"/student-practice.html?course=java&mission=j1");
    await expect(student.locator("#practiceReflectionPanel")).toBeVisible();
    await student.locator("#practiceObservation").fill("I compared the variable changes and printed result with the prediction in the sandbox.");
    const predictedAttempt=(await practiceDatabase.doc("practice_attempts/"+challenge.attemptId).get()).data();
    assert.equal(predictedAttempt.state,"predicted");
    await expect.poll(()=>Date.now()-predictedAttempt.predictedAt.toMillis()).toBeGreaterThan(3200);
    await student.locator("#practiceFinishBtn").click();
    await expect(student.locator("#practiceStatus")).toContainText("Mission complete!");
    await waitRecord(student,"practice_rankings/alice","points",10);
    assert.equal((await browserRecord(student,"student_practice_progress/"+accounts.alice.uid+"/courses/java")).data.studentId,undefined,"Old self-reported progress must remain untouched");
    const transferDevice=await (await newIdentity("alice")).newPage();
    await transferDevice.goto(origin+"/student-practice.html");
    await expect(transferDevice.locator("#practiceSessionStatus")).toContainText("active on another device");
    await transferDevice.locator("#practiceTransferBtn").click();
    await expect(transferDevice.locator("#practiceSessionStatus")).toContainText("moved to this device");
    await student.goto(origin+"/student-practice.html?course=java&mission=j2");
    await expect(student.locator("#practiceSessionStatus")).toContainText("active on another device");
    await expect(student.locator("#practiceCheckBtn")).toBeHidden();
    await expect(student.locator("#practiceFeedback")).toContainText("active on another device");
    await student.locator("#practiceSyncBtn").click();
    await expect(student.locator("#practiceSessionStatus")).toContainText("active on another device");
    assert.equal((await browserRecord(student,"practice_rankings/alice")).data.points,10,"Transfers must not erase or penalize saved XP");
    await transferDevice.close();
    assert.equal((await browserRecord(student,"activity_preferences/"+accounts.alice.uid)).data.enabled,false);
    assert.equal((await browserRecord(student,"practice_profiles/"+accounts.alice.uid)).data.leaderboardOptIn,false);
    await expect(student.locator("#practiceReviewedPoints")).toContainText("10 XP");
    const classAlias=await student.locator("#practiceAlias").textContent();
    await expect(student.locator("#practiceStandings .av-rank-current")).toContainText(classAlias);
    await peer.goto(origin+"/student-practice.html");await expect(peer.locator("#practiceStandings")).toContainText(classAlias);
    assert.equal((await browserRecord(peer,"student_practice_progress/"+accounts.alice.uid+"/courses/java")).error,"permission-denied");
    await student.locator("#av-information-toggle").click();await student.locator("[data-information-help]").click();
    await expect(student.locator("#page-help-dialog")).toBeVisible();
    await student.locator("#page-help-dialog").getByText("Close help",{exact:true}).click();
    await teacher.goto(origin+"/practice-analytics.html");
    await teacher.locator("#av-alert-toggle").click();await expect(teacher.locator("#av-alert-list")).toContainText("Adminerva update");await teacher.locator("#av-alert-toggle").click();
    await expect(teacher.locator("#practiceAnalyticsSection option")).toContainText(["fixture-11-A"]);
    await teacher.locator("#practiceAnalyticsLoad").click();
    await teacher.locator("#practiceAnalyticsList article").filter({hasText:"Fixture alice"}).getByRole("button").click();
    await teacher.locator('[data-reviewed-mission][value="j1"]').check();
    await teacher.locator("#practicePointsNote").fill("Teacher observed the mission implementation and independently reviewed the student's explanation.");
    await teacher.locator("#practiceAcceptPoints").click();await waitRecord(teacher,"practice_scores/alice","points",10);
    assert.equal((await browserRecord(student,"practice_boards/alice")).exists,false,"Automatic class XP does not require publishing legacy reviewed snapshots");
    await student.reload();await expect(student.locator("#practiceReviewedPoints")).toContainText("10 XP");await expect(student.locator("#practiceStandings")).toContainText(classAlias);
    await student.screenshot({path:path.join(output,"practice-class-points.png")});
    assert.equal((await browserRecord(peer,"practice_scores/alice")).error,"permission-denied");
    await student.goto(origin+"/patch-notes.html");await expect(student.locator("#patchList")).toContainText("Review & Grade");
    validated("300 structured missions, server-checked predictions, resumed sandbox handoff fixture, automatic class-only XP, controlled device transfer without penalties, private reflections and consolidated help");
    await student.goto(origin+"/student-settings.html");
    await expect(student.locator("#activity-save")).toBeEnabled();
    const beforeConsent=await browserRecord(student,"activity_preferences/"+accounts.alice.uid);
    assert.equal(beforeConsent.data.enabled,false);
    await student.locator("[data-activity-preferences]").click();
    await student.locator("#activity-share").check();await student.locator("#activity-diagnostics").check();await student.locator("#activity-save").click();
    await waitRecord(student,"activity_preferences/"+accounts.alice.uid,"enabled",true);
    await student.locator("#activity-dismiss").click();
    await student.goto(origin+"/student-xml-lab.html");
    await student.locator("#xmlRender").click();
    await student.evaluate(()=>{window.fixtureLoading=[window.beginLoading("First operation",document.querySelector("main")),window.beginLoading("Second operation",document.querySelector("main"))];window.hideSubtleLoader();});
    await expect(student.locator("#subtleLoader")).toBeVisible();
    await student.evaluate(()=>window.fixtureLoading[0]());await expect(student.locator("#subtleLoaderText")).toContainText("Second operation");
    assert.equal(await student.locator("main").getAttribute("aria-busy"),"true");
    await student.evaluate(()=>{window.fixtureLoading[1]();window.fixtureLoading[1]();});await expect(student.locator("#subtleLoader")).toBeHidden();
    assert.equal(await student.locator("main").getAttribute("aria-busy"),null);
    await student.locator('#av-information-toggle').click();await student.locator('[data-information-report]').click();
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
    await teacher.locator("#learning-activity summary").click();
    const backendDb=getAdminFirestore(adminApp);
    const savedSnapshot=(await backendDb.doc("analytics_views/"+accounts.teacher.email).get()).data();
    await backendDb.doc("analytics_views/"+accounts.teacher.email).update({rows:null});
    await expect(teacher.locator("#engagement-status")).toContainText("incomplete");
    await expect(teacher.locator("#academic-status")).toContainText("Academic records loaded");
    await backendDb.doc("analytics_views/"+accounts.teacher.email).set(savedSnapshot);
    const maintenance=monitoringWorker.createMonitoringService({db:backendDb,Timestamp,FieldValue,resolveUsers:async uids=>(await authAdmin.getUsers(uids.map(uid=>({uid})))).users});
    await expect(admin.locator("#maintenance-cleanup")).not.toBeChecked();await expect(admin.locator("#maintenance-summary")).not.toBeChecked();
    assert.equal((await maintenance.runScheduled()).state,"disabled");
    await admin.locator("#maintenance-cleanup").check();await admin.locator("#maintenance-summary").check();
    await admin.locator("#maintenance-reason").fill("Fixture school privacy and bounded monitoring budget reviewed.");await admin.locator("#save-maintenance").click();
    await expect(admin.locator("#admin-analytics-status")).toContainText("Maintenance policy saved");
    assert.equal((await browserRecord(admin,"monitoring_control/runtime/revisions/1")).data.after.cleanupEnabled,true);
    await backendDb.doc("activity_events/expired-fixture").set({ownerUid:accounts.alice.uid,studentId:"alice",sessionId:"c".repeat(36),page:"xml-lab",action:"page-open",activeSeconds:0,createdAt:Timestamp.fromMillis(Date.now()-31*86400000),expiresAt:Timestamp.fromMillis(Date.now()-1)});
    const maintained=await maintenance.runScheduled();assert.equal(maintained.eventsRemoved,1);assert.equal(maintained.summaryRefreshed,true);
    await expect(teacher.locator("#engagement-status")).toContainText("System refresh");await expect(teacher.locator("#engagement-rows")).toContainText("alice");
    assert.equal(await teacher.locator("#bug-count").count(),0);
    await teacher.screenshot({path:path.join(output,"teacher-analytics.png")});
    await admin.goto(origin+"/teacher-analytics.html");await expect(admin.locator("#analytics-teacher")).toBeEnabled();
    await expect(admin.locator("#engagement-rows")).toContainText("alice");
    await admin.goto(origin+"/issues.html?issue="+issueId);await expect(admin.locator("#issue-diagnostics")).toContainText("xml-lab → run");
    await teacher.goto(origin+"/admin-analytics.html");await expect(teacher.locator("#admin-analytics-status")).toContainText("No monitoring records were requested");await expect(teacher.locator("#operations")).toBeHidden();
    await teacher.goto(origin+"/teacher-analytics.html");await expect(teacher.locator("#engagement-rows")).toContainText("alice");
    interceptSummaryConfirmation=async()=>{
      await student.goto(origin+"/student-settings.html");await student.locator("[data-activity-preferences]").click();await expect(student.locator("#activity-save")).toBeEnabled();await student.locator("#activity-share").uncheck();await student.locator("#activity-save").click();await waitRecord(student,"activity_preferences/"+accounts.alice.uid,"enabled",false);
      assert.equal(await maintenance.applyConsentChange(accounts.alice.uid,"alice"),1);
      await expect(teacher.locator("#engagement-rows tr")).toHaveCount(0);
    };
    await admin.goto(origin+"/admin-analytics.html");await expect(admin.locator("#admin-analytics-status")).toContainText("Refreshed");await admin.locator("#publish-engagement").click();await expect(admin.locator("#admin-analytics-status")).toContainText("Teacher summary refreshed");
    const summary=await browserRecord(admin,"analytics_views/"+accounts.teacher.email);assert.deepEqual(summary.data.rows,[]);
    await expect(teacher.locator("#engagement-rows tr")).toHaveCount(0);
    await admin.locator("#maintenance-cleanup").uncheck();await admin.locator("#maintenance-summary").uncheck();await admin.locator("#maintenance-reason").fill("Fixture maintenance disabled after verification.");await admin.locator("#save-maintenance").click();await expect(admin.locator("#admin-analytics-status")).toContainText("Maintenance policy saved");
    assert.equal((await maintenance.runScheduled()).state,"disabled");
    const guest=await (await newIdentity("guest")).newPage();const guestRequests=[];guest.on("request",request=>guestRequests.push(request.url()));
    await guest.goto(origin+"/wiki.html");await expect(guest.locator("h1")).toContainText("Find your next step");await guest.locator("#page-help-open").click();await expect(guest.locator("#activity-save")).toHaveCount(0);
    assert.ok(!guestRequests.some(url=>url.includes("firebase")||url.includes("activity_events")),"Guest help must not initialize tracking or Firebase");
    await guest.locator("#page-help-dialog").getByText("Close help",{exact:true}).click();
    await guest.setViewportSize({width:390,height:844});await expect.poll(()=>guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await guest.screenshot({path:path.join(output,"public-wiki-mobile.png"),fullPage:true});
    validated("opt-in activity, admin-only trails, audited maintenance, real worker cleanup, live teacher summaries, consent race protection, public wiki, legacy redirects and concurrent loaders");
    await admin.goto(origin+"/teacher-accounts.html");
    await expect(admin.locator("#staff-account-controls")).toBeVisible();
    await admin.locator("#staff-email").fill(accounts.teacher2.email);
    await admin.locator("#staff-name").fill("Second fixture teacher");
    await admin.locator("#staff-section-picker input[value='fixture-11-A']").check();
    await admin.locator("#staff-reason").fill("Authorize the second instructor and assign the fixture teaching section.");
    await admin.locator('#staff-account-form button[type="submit"]').click();
    await expect(admin.locator("#staff-account-status")).toContainText("Saved teacher access");
    assert.equal((await browserRecord(admin,"staff_access/"+accounts.teacher2.email)).data.status,"active");
    const secondContext=await newIdentity("teacher2"),secondTeacher=await secondContext.newPage(),staleLesson=await secondContext.newPage();
    const lessonTerm="FIRST SEMESTER/FIRST QUARTER";
    const lessonId=personalPlanId({grade:"Grade 11",subject:"Fixture subject",term:lessonTerm,week:"Week 1",schoolYear:"2026-2027"});
    const lessonBase={school_year:"2026-2027",grade_level:"Grade 11",subject_title:"Fixture subject",teacher_name:"Second fixture teacher",academic_term:lessonTerm,course_week:"Week 1",date_range:"Fixture dates",timestamp:new Date().toISOString(),version:1,
      document_settings:{subject_title:"Fixture subject",teacher_name:"Second fixture teacher",sig_grade_coord:"Saved Grade 11 coordinator",sig_grade_coord_title:"Grade 11 Coordinator"},
      weekly_overview:{topic:"Personal lesson",content_standard:"Fixture standard",performance_standard:"Fixture performance",materials:"Fixture materials"},
      sessions:[{session_name:"Session 1",competencies:"Fixture competency",objectives:"Fixture objective",learning_activities:"Fixture activity",evaluation:"Fixture evaluation",remarks:""}]};
    await environment.withSecurityRulesDisabled(async context=>{
      await setDoc(doc(context.firestore(),"staff_workspaces",accounts.teacher2.uid,"lesson_plans",lessonId),{...lessonBase,ownerUid:accounts.teacher2.uid});
      await setDoc(doc(context.firestore(),"staff_workspaces",accounts.admin.uid,"lesson_plans",lessonId),{...lessonBase,ownerUid:accounts.admin.uid,weekly_overview:{...lessonBase.weekly_overview,topic:"Administrator's separate lesson"}});
    });
    for(const page of [secondTeacher,staleLesson]){
      await page.goto(origin+"/lesson-planner.html");
      await page.waitForFunction(()=>typeof window.openLoadPlanModal==="function");
      await page.evaluate(()=>window.openLoadPlanModal());
      await expect(page.locator("#savedPlansListContainer")).not.toContainText("Account changed or not ready");
      await expect(page.locator("#savedPlansListContainer")).toContainText("Fixture subject");
      await page.evaluate(()=>window.closeLoadPlanModal());
      await page.evaluate(async record=>{await (await import("/js/core/staff-session.mjs?v=2026.10.20.1")).staffSessionReady;window.loadSpecificPlan(record);},{...lessonBase,id:lessonId,ownerUid:accounts.teacher2.uid});
      await expect(page.locator("#lpGradeLevel")).toHaveValue("Grade 11");
      await page.evaluate(()=>window.openMiniSettings());await expect(page.locator("#sigGradeCoord")).toHaveValue("Saved Grade 11 coordinator");
      await page.evaluate(()=>window.closeMiniSettings());
    }
    await secondTeacher.locator('[data-weekly-field="topic"]').fill("Second teacher's reviewed topic");
    assert.equal(await secondTeacher.evaluate(()=>window.saveLessonPlan()),true);
    const personalPath="staff_workspaces/"+accounts.teacher2.uid+"/lesson_plans/"+lessonId;
    assert.equal((await browserRecord(secondTeacher,personalPath)).data.weekly_overview.topic,"Second teacher's reviewed topic");
    assert.equal((await browserRecord(secondTeacher,personalPath)).data.document_settings.sig_grade_coord,"Saved Grade 11 coordinator");
    await staleLesson.locator('[data-weekly-field="topic"]').fill("Stale tab must not replace the newer topic");
    assert.equal(await staleLesson.evaluate(()=>window.saveLessonPlan()),false);
    assert.equal((await browserRecord(secondTeacher,personalPath)).data.version,2);
    assert.equal((await browserRecord(admin,"staff_workspaces/"+accounts.admin.uid+"/lesson_plans/"+lessonId)).data.weekly_overview.topic,"Administrator's separate lesson");
    await secondTeacher.goto(origin+"/teacher-analytics.html");
    await expect(secondTeacher.locator("#sectionSelect")).toHaveValue("fixture-11-A");
    await expect(secondTeacher.locator("#instructor-selection")).toBeHidden();
    await expect(secondTeacher.locator("#academic-status")).not.toContainText("could not load");
    await teacher.goto(origin+"/assessment-evidence-review.html?student=alice&assessment=fixture-v2");
    await expect(teacher.locator("#evidenceStudent")).toHaveValue("alice");
    await teacher.locator("#evidenceStudentSearch").fill("bob");await expect(teacher.locator("#evidenceSearchStatus")).toContainText("1 matching");
    await expect(teacher.locator("#evidenceStudent")).toHaveValue("alice");
    await teacher.locator("#evidenceStudentSearch").fill("no-match");await expect(teacher.locator("#evidenceSearchStatus")).toContainText("0 matching");
    await secondTeacher.goto(origin+"/settings.html");await secondTeacher.locator("[data-activity-preferences]").click();
    await expect(secondTeacher.locator("#activity-share")).not.toBeChecked();await expect(secondTeacher.locator("#activity-save")).toBeEnabled();
    await secondTeacher.locator("#activity-never-show").check();await secondTeacher.locator("#activity-save").click();
    const staffPreferences=await waitRecord(secondTeacher,"activity_preferences/"+accounts.teacher2.uid,"promptDismissed",true);assert.equal(staffPreferences.enabled,false);
    await secondTeacher.locator("#activity-dismiss").click();await secondTeacher.goto(origin+"/teacher-home.html");
    await expect(secondTeacher.locator("#activity-save")).toBeEnabled();await expect(secondTeacher.locator("#activity-preferences-dialog")).not.toBeVisible();
    await teacher.goto(origin+"/presentation.html");
    await expect(teacher.locator(".ql-toolbar").first()).toBeVisible();
    const login=await teacherContext.newPage();await login.goto(origin+"/login.html");
    for(const width of [320,360,390,640,768,1024]){
      await teacher.setViewportSize({width,height:900});
      const layout=await teacher.evaluate(()=>{
        const brand=document.querySelector("#adminerva-nav summary"),controls=document.getElementById("av-account-controls");
        return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,brandRight:brand?.getBoundingClientRect().right||0,controlsLeft:controls?.getBoundingClientRect().left||0};
      });
      assert.ok(layout.scrollWidth<=width,"Navigation must fit width "+width+": "+JSON.stringify(layout));
      assert.ok(layout.brandRight<=layout.controlsLeft+1,"Brand and account controls must not overlap at "+width);
      const bell=teacher.locator("#adminerva-notifications button").first();await bell.click();
      const inbox=teacher.locator("#av-alert-panel");await expect(inbox).toBeVisible();
      const bounds=await inbox.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,"Notification inbox must stay inside the viewport");await bell.click();
      await teacher.locator("#av-information-toggle").click();
      await expect(teacher.locator("#av-information-panel")).toBeVisible();
      await bell.click();await expect(teacher.locator("#av-information-panel")).toBeHidden();
      assert.equal(await teacher.locator("#av-alert-panel").evaluate(panel=>{
        const rect=panel.getBoundingClientRect();return panel.contains(document.elementFromPoint(rect.x+rect.width/2,Math.min(rect.bottom-10,rect.y+200)));
      }),true,"Slide tools must not paint above the inbox");
      await teacher.keyboard.press("Escape");await expect(bell).toHaveAttribute("aria-expanded","false");
      await login.setViewportSize({width,height:900});
      await expect(login.locator("#adminerva-help a[href='wiki.html#privacy']")).toBeVisible();
      assert.equal(await login.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    await login.setViewportSize({width:390,height:844});
    await login.screenshot({path:path.join(output,"login-footer-mobile.png"),fullPage:true});
    await secondTeacher.goto(origin+"/teacher-analytics.html");await expect(secondTeacher.locator("#academic-status")).toContainText("Academic records loaded");
    await secondTeacher.screenshot({path:path.join(output,"teacher-analytics-personal.png"),fullPage:true});
    await teacher.setViewportSize({width:1360,height:900});await teacher.locator("#av-alert-toggle").click();
    await teacher.screenshot({path:path.join(output,"slide-navigation-layers.png")});await teacher.keyboard.press("Escape");
    await admin.screenshot({path:path.join(output,"teacher-accounts-admin.png"),fullPage:true});
    await teacher.setViewportSize({width:390,height:844});await openTeacher();
    await expect(teacher.locator("#manualReviewModal")).toBeVisible();
    const saveBounds=await teacher.locator("#manualReviewSave").boundingBox();
    assert.ok(saveBounds.x>=0&&saveBounds.x+saveBounds.width<=390&&saveBounds.y+saveBounds.height<=844,"Review save actions must remain reachable on mobile");
    await teacher.screenshot({path:path.join(output,"review-grade-mobile.png"),fullPage:true});
    validated("audited second teacher admission, isolated same-week lesson saves, stale-tab protection, scoped analytics, responsive navigation and privacy footer");
    await getAdminFirestore(adminApp).doc("assessments/fixture-reviewed").set({...assessment,schemaVersion:1,title:"Fixture reviewed legacy draft"});
    await getAdminFirestore(adminApp).doc("student_grades/alice_fixture-reviewed").set({studentId:"alice",section:"fixture-11-A",taskId:"fixture-reviewed",score:11,maxScore:20,feedback:"# Welcome screen\nReviewed individual changes.\n<script>unsafe()</script>",reviewRequired:false,published:false,gradedAt:Timestamp.now()});
    await getAdminFirestore(adminApp).doc("student_grades/bob_fixture-reviewed").set({studentId:"bob",section:"fixture-11-A",taskId:"fixture-reviewed",score:9,maxScore:20,feedback:"Still awaiting individual review.",reviewRequired:true,published:false});
    await gradebook.setViewportSize({width:390,height:844});
    await gradebook.goto(origin+"/gradebook.html");
    await gradebook.locator("#gbQuarterSection").selectOption("fixture-11-A");await gradebook.locator("#gbQuarter").selectOption("Q3");
    await expect(gradebook.locator("#gbQuarterPublish")).toHaveText("Publish (1 Drafts)");
    await gradebook.locator("#gbQuarterTable button").filter({hasText:"11 / 20"}).click();
    await expect(gradebook.locator("#gbDetailModal")).toBeVisible();
    assert.equal(await gradebook.locator("#gbFeedbackPreview script").count(),0);
    const drawerBounds=await gradebook.locator("#gbDetailModal>div").boundingBox();assert.ok(drawerBounds.width<=390&&drawerBounds.height<=844);
    await gradebook.screenshot({path:path.join(output,"grade-feedback-drawer-mobile.png")});
    await gradebook.locator("#gbDetailClose").click();
    await gradebook.locator("#gbQuarterPublish").click();
    await waitRecord(gradebook,"student_grades/alice_fixture-reviewed","published",true);
    assert.equal((await browserRecord(gradebook,"student_grades/bob_fixture-reviewed")).data.published,false);
    await expect(gradebook.locator("#gbQuarterPublish")).toHaveText("Publish (0 Drafts)");
    const publicationAudits=await getAdminFirestore(adminApp).collection("grade_revisions").where("gradeId","==","alice_fixture-reviewed").get();assert.equal(publicationAudits.size,1);
    await gradebook.reload();await expect(gradebook.locator("#gbQuarterSection option")).toContainText(["fixture-11-A"]);
    await gradebook.locator("#gbQuarter").selectOption("Q3");await expect(gradebook.locator("#gbQuarterPublish")).toBeDisabled();
    await gradebook.locator("#gbViewSingle").click();await expect(gradebook.locator("#gbSection option")).toContainText(["fixture-11-A"]);
    await gradebook.locator("#gbSection").selectOption("fixture-11-A");await gradebook.locator("#gbAssessment").selectOption("fixture-reviewed");
    await gradebook.locator("#gbTableBody .av-feedback-chip").first().click();
    await expect(gradebook.locator("#feedbackDrawer")).toBeVisible();
    await expect(gradebook.locator("#feedbackDrawerBody")).toContainText("Reviewed individual changes");
    assert.equal(await gradebook.locator("#feedbackDrawerBody script").count(),0);
    await gradebook.locator("#feedbackDrawerClose").click();
    await expect(gradebook.locator("#subtleLoader")).toBeHidden();
    validated("safe mobile feedback drawers, persistent draft counts, audited deliberate batch publication, review exclusions and refresh without automatic replay");
    const pending=await (await newIdentity("pending")).newPage();
    await pending.goto(origin+"/guest-home.html");await expect(pending.locator("#guest-content")).toBeVisible();
    await expect(pending.locator("#guest-status")).toContainText("Pending administrator review");
    assert.equal((await browserRecord(pending,"account_requests/"+accounts.pending.uid)).data.status,"pending");
    assert.equal((await browserRecord(pending,"staff_access/"+accounts.pending.email)).exists,false);
    assert.equal((await browserRecord(pending,"students/alice")).error,"permission-denied");
    await pending.goto(origin+"/guest-playground.html");await expect(pending.locator("#guest-content")).toBeVisible();
    await pending.locator("#guest-source").fill("<h1>Local guest draft</h1>");await pending.locator("#guest-save").click();await pending.reload();await expect(pending.locator("#guest-source")).toHaveValue("<h1>Local guest draft</h1>");
    await pending.locator("#guest-run").click();await expect(pending.frameLocator("#guest-preview").locator("h1")).toHaveText("Local guest draft");
    await pending.goto(origin+"/guest-practice.html");await expect(pending.locator("#guest-missions section")).toHaveCount(15);await expect(pending.locator("#guest-module option")).toHaveCount(5);
    assert.equal((await browserRecord(pending,"practice_progress/"+accounts.pending.uid)).error,"permission-denied");
    await pending.goto(origin+"/guest-home.html");await expect(pending.locator("#guest-request")).toBeVisible();await pending.locator("#guest-role").selectOption("teacher");await pending.locator("#guest-request button").click();await waitRecord(pending,"account_requests/"+accounts.pending.uid,"requestedRole","teacher");
    await admin.goto(origin+"/users.html");await expect(admin.locator("#admissions")).toBeVisible();await admin.locator("#admission-list button").filter({hasText:accounts.pending.email}).click();
    await expect(admin.locator("#admission-form")).toBeVisible();await admin.locator("#admission-role").selectOption("teacher");await admin.locator("#admission-reason").fill("School verified this new teacher's sign-in and requested access.");await admin.locator("#admission-form button[value='approved']").click();
    await waitRecord(pending,"account_requests/"+accounts.pending.uid,"status","approved");await expect(pending.locator("#guest-approved")).toBeVisible();await pending.locator("#guest-approved").click();await expect(pending).toHaveURL(/teacher-home\.html$/);
    assert.equal((await browserRecord(admin,"account_requests/"+accounts.pending.uid+"/revisions/1")).data.actorUid,accounts.admin.uid);
    await admin.goto(origin+"/manage-sections.html");await expect(admin.locator("#catalog-roster-sections")).toContainText("fixture-11-A");await admin.locator("#catalog-name").fill("fixture-12-B");await admin.locator("#catalog-gradeLevel").fill("Grade 12");await admin.locator("#catalog-schoolYear").fill("2026-2027");await admin.locator("#catalog-save").click();await expect(admin.locator("#catalog-status")).toContainText("Saved.");
    await admin.goto(origin+"/teacher-accounts.html");await expect(admin.locator("#staff-sections option[value='fixture-12-B']")).toHaveCount(1);
    await guest.goto(origin+"/wiki.html");await guest.locator("#wikiSearch").fill("checkpoint");await expect(guest.locator("#wikiSearchStatus")).toContainText("matching guides");await guest.locator("#wikiClear").click();
    const releaseManifest=JSON.parse(await readFile(path.join(root,"site-release.json"),"utf8"));
    await guest.goto(origin+"/patch-notes.html");await expect(guest.locator(".av-version-label").first()).toHaveText(releasePresentation(releaseManifest).label);
    await guest.screenshot({path:path.join(output,"versioned-patch-notes-mobile.png"),fullPage:true});
    await admin.goto(origin+"/manage-subjects.html");await admin.screenshot({path:path.join(output,"manage-subjects-admin.png"),fullPage:true});
    validated("limited local guest tools, private verified requests, audited teacher approval, school catalog integration, public guide search and stable versioned release history");
    const evidenceBefore=(await browserRecord(teacher,"assessment_evidence/alice_fixture-v2")).data;
    const overviewPath="teacher_materials/"+accounts.teacher.uid+"/repobank/review:fixture-group%2Fandroid";
    await teacher.goto(origin+"/repobank.html");await expect(teacher.locator("#repobankStatus")).toContainText("linked groups loaded");
    const group=teacher.locator("#repobankContainer article").first();await group.getByRole("button",{name:"Refresh system overview",exact:true}).click();
    await expect(group).toContainText("System overview draft");
    assert.equal((await browserRecord(teacher,overviewPath)).exists,false,"Generating an overview must not save it");
    await expect(group.locator("textarea").first()).toHaveValue("Sampled Android layout prototype.");
    await group.getByRole("button",{name:"Save reviewed overview",exact:true}).click();await expect(group).toContainText("Reviewed overview saved");
    const savedOverview=(await browserRecord(teacher,overviewPath)).data.overview;assert.equal(savedOverview.checkpoint,groupSha);assert.equal(savedOverview.reviewedBy,accounts.teacher.uid);
    const generated=modelRequests;await group.getByRole("button",{name:"Refresh system overview",exact:true}).click();await expect(group).toContainText("no provider request was sent");assert.equal(modelRequests,generated);
    assert.equal((await browserRecord(teacher,"assessment_evidence/alice_fixture-v2")).data.revision,evidenceBefore.revision);
    await teacher.screenshot({path:path.join(output,"repobank-reviewed-overview.png"),fullPage:true});
    validated("pinned sampled system project overview, explicit save, unchanged-checkpoint token reuse and independent approved individual evidence without grade mutations");
    const publicRoutes=["index.html","login.html","wiki.html","patch-notes.html"];
    for (const [page, routes] of [[login,publicRoutes],[admin,["users.html","manage-sections.html","teacher-accounts.html","manage-subjects.html","manage-programs.html","admin-analytics.html","issues.html"]],[teacher,["teacher-home.html","settings.html","repofetch.html","lesson-planner.html","library.html","schedule.html","presentation.html","repobank.html","gradebook.html","grading.html","activity-grader.html","assessment-studio.html","submissions.html","assessment-evidence-review.html","contribution-inspector.html","group-inspector.html","teacher-analytics.html","practice-analytics.html"]],[student,["student-home.html","student-practice.html","student-xml-lab.html","student-dashboard.html","student-assessments.html","student-settings.html","student-playground.html"]]]) {
      for (const route of routes) {
        await page.setViewportSize({width:390,height:844});await page.goto(origin+"/"+route);
        if(!publicRoutes.includes(route)) {
          await expect(page.locator("#adminerva-nav nav")).toBeVisible();
          if(await page.locator("#pageBody").count())await expect(page.locator("#pageBody")).toBeVisible();
        }
        if(route.endsWith("home.html")) {
          await expect(page.locator("#activity-save")).toBeEnabled();
          if(await page.locator("#activity-preferences-dialog").isVisible())await page.locator("#activity-dismiss").click();
        }
        if(route.startsWith("manage-"))await expect(page.locator("#catalog-status")).not.toContainText("Loading catalog");
        if(route==="teacher-accounts.html")await expect(page.locator("#staff-account-status")).toContainText("Teacher directory loaded");
        if(route==="student-playground.html") {
          await expect(page.locator("#editorLoading")).toBeHidden();await expect(page.locator(".monaco-editor")).toBeVisible();
          await page.locator("#languageSelect").selectOption("web");await page.locator("#runBtn").click();
          await expect(page.frameLocator("#webPreviewFrame").locator("h1")).toHaveText("Hello, Adminerva Web!");
        }
        await expect(page.locator("#subtleLoader")).toBeHidden();
        await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),{message:route+" must fit a phone screen"}).toBe(true);
        await page.screenshot({path:path.join(output,"ux-mobile-"+route.replace(".html",".png")),fullPage:true});
        if(route==="teacher-home.html") {
          await page.locator("#av-information-toggle").click();await page.locator("[data-information-report]").click();
          await expect(page.locator("#bug-modal")).toBeVisible();await expect(page.locator("#bug-title")).toBeFocused();
          await page.locator("#bug-title").fill("Unsent keyboard navigation check");await page.keyboard.press("Tab");
          assert.equal(await page.evaluate(()=>document.getElementById("bug-modal").contains(document.activeElement)),true);
          await page.keyboard.press("Escape");await expect(page.locator("#bug-modal")).toBeHidden();
          await expect(page.locator("#av-information-toggle")).toBeFocused();
          await page.locator("#av-information-toggle").click();await page.locator("[data-information-report]").click();
          await expect(page.locator("#bug-title")).toHaveValue("Unsent keyboard navigation check");await page.keyboard.press("Escape");
        }
        if(["index.html","teacher-home.html","manage-sections.html","student-home.html"].includes(route)) {
          await page.setViewportSize({width:1360,height:900});await page.screenshot({path:path.join(output,"ux-desktop-"+route.replace(".html",".png")),fullPage:true});
        }
      }
    }
    validated("responsive public, student, teaching and administration route sweep with shared navigation and accessible setup");
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
