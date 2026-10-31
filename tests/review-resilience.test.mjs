import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {gradeVersionMatches,assertGradeVersion,nextGradeVersion} from "../js/repo-review/services/grade-version.mjs";
import {createBackoffClient,evaluationJSON,responseCooldown} from "../js/repo-review/services/request-backoff.mjs";
import {publicationCandidates,publicationJournal} from "../js/repo-review/services/publication-queue.mjs";
import {analyzePatchSubstance} from "../js/repo-review/services/commit-substance.mjs";
import {attributeCommit,linkGithubProfile} from "../js/repo-review/services/contribution-resolver.mjs";

test("grade conflict detection ignores map ordering, not material edits or timestamp nanoseconds",()=>{
  const opened={score:0,published:false,gradedAt:{seconds:12,nanoseconds:45},evidenceRevision:2,feedback:"Original",contributionEvidence:{first:1,last:2}};
  assert.ok(gradeVersionMatches(opened,{...opened,gradedAt:{nanoseconds:45,seconds:12},contributionEvidence:{last:2,first:1}}));
  for(const changed of [{score:1},{feedback:"Other teacher edit"},{published:true},{evidenceRevision:3},{gradedAt:{seconds:12,nanoseconds:46}},{gradeVersion:2}])assert.throws(()=>assertGradeVersion({...opened,...changed},opened),/changed after opening/);
  assert.ok(gradeVersionMatches(null,null));assert.ok(!gradeVersionMatches({},null));assert.equal(nextGradeVersion({gradeVersion:2}),3);
});
test("Android self-closing tags and same-line comments preserve meaningful UI changes",()=>{
  for(const code of ['<TextView android:text="Welcome" />','<androidx.constraintlayout.widget.ConstraintLayout />','<!-- note --><Button android:id="@+id/save"/>'])assert.equal(analyzePatchSubstance('+'+code,'screen.xml').substantive,true);
  assert.equal(analyzePatchSubstance('+<!--\n+ explanation\n+-->','screen.xml').substantive,false);
  assert.equal(analyzePatchSubstance('-<TextView android:text="Old"/>\n+<TextView android:text="New"/>','screen.xml').substantive,true);
});
test("CSV usernames require a matching live GitHub profile, never invented ownership verification",()=>{
  const csv={id:"csv",githubUsername:" @Alice ",githubAccountVerified:undefined};
  const linked=linkGithubProfile(csv,{id:71,login:"alice"});assert.equal(linked.githubUserId,71);assert.equal(linked.githubAccountVerified,undefined);
  assert.equal(attributeCommit({author:{id:71,login:"alice"}},linked).status,"verified");
  const conflict=attributeCommit({author:{id:72,login:"alice"}},linked); assert.equal(conflict.status,"review"); assert.equal(conflict.reason,"github_user_id_conflict");
  assert.equal(attributeCommit({author:{login:"alice"}},csv).status,"review");
  assert.throws(()=>linkGithubProfile(csv,{id:72,login:"bob"}));assert.throws(()=>linkGithubProfile({...csv,githubUserId:72},{id:71,login:"alice"}));
  assert.notEqual(attributeCommit({author:{id:0,login:"alice"}},{...csv,githubUserId:""}).status,"verified");
});
test("bounded service retries respect retry-after and recover without erasing inputs",async()=>{
  let clock=1000,calls=0;const delays=[];
  const client=createBackoffClient({now:()=>clock,wait:async delay=>{delays.push(delay);clock+=delay;},fetchImpl:async()=>++calls<3?new Response("{}",{status:503,headers:{"retry-after":"2"}}):Response.json({ready:true})});
  assert.equal((await client.fetch("https://service.test")).ok,true);assert.equal(calls,3);assert.deepEqual(delays,[2000,4000]);
});
test("GitHub secondary limits pause the shared client rather than hammering or changing branches",async()=>{
  let calls=0;const client=createBackoffClient({github:true,now:()=>1000,fetchImpl:async()=>{calls++;return Response.json({message:"secondary rate limit"},{status:403});}});
  await assert.rejects(client.fetch("https://api.github.com/repos/a/b"),error=>error.retryAt>=61000);
  await assert.rejects(client.fetch("https://api.github.com/repos/a/b/commits"),/cooling down/);assert.equal(calls,1);
  assert.equal(responseCooldown(new Response("{}",{status:403}),{github:true,now:1000}),0);
});
test("normal access failures are not retried and cancellation prevents new requests",async()=>{
  let calls=0;const client=createBackoffClient({fetchImpl:async()=>{calls++;return new Response("{}",{status:401});}});
  assert.equal((await client.fetch("https://service.test")).status,401);assert.equal(calls,1);
  const controller=new AbortController();controller.abort();await assert.rejects(client.fetch("https://service.test",{signal:controller.signal}),{name:"AbortError"});assert.equal(calls,1);
});
test("provider JSON failures and empty candidates become recoverable manual states",async()=>{
  for(const response of [new Response("broken"),Response.json({candidates:[]}),Response.json({candidates:[{content:{parts:[{text:"[1,2]"}]}}]})])await assert.rejects(evaluationJSON(response),error=>error.code==="invalid-evaluation");
  const data=await evaluationJSON(Response.json({candidates:[{content:{parts:[{text:'```json\n{"score":12}\n```'}]}}]}));assert.equal(data.score,12);
});
test("publication queues include ready and legacy-clean V2 drafts but exclude real review flags",()=>{
  const legacyClean={data:{score:18,published:false,reviewRequired:true,manuallyAdjusted:false,gradeSource:"system_evaluation_draft",reviewPriority:"ready_for_teacher_confirmation",reviewReasons:[],evaluationDraft:{teacherReviewed:false}},schemaVersion:2};
  const entries=[{data:{score:0,published:false,reviewRequired:false},schemaVersion:1},{data:{score:12,published:false,reviewRequired:false},schemaVersion:2},legacyClean,{data:{score:4,published:false,reviewRequired:true,manuallyAdjusted:false,gradeSource:"system_evaluation_draft",reviewPriority:"needs_review",reviewReasons:["Missing evidence"],evaluationDraft:{teacherReviewed:false}},schemaVersion:2},{data:{score:null,published:false,reviewRequired:false}},{data:{score:10,published:true,reviewRequired:false}}];
  entries.forEach(entry=>{entry.maxScore=20;});
  assert.deepEqual(publicationCandidates(entries),[entries[0],entries[1],legacyClean]);assert.deepEqual(publicationCandidates(entries,false),[entries[5]]);
  for(const score of [-1,21,NaN,Infinity])assert.equal(publicationCandidates([{data:{score,maxScore:20,reviewRequired:false}}]).length,0);
});
test("recovery survives refresh, validates stored IDs and never executes an action",()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const journal=publicationJournal(storage,"owner:section");journal.write({pending:["alice_task"],completed:["bob_task"]});
  assert.deepEqual(publicationJournal(storage,"owner:section").read().pending,["alice_task"]);assert.equal(publicationJournal(storage,"other-owner:section").read(),null);
  values.set("owner:section",JSON.stringify({pending:["../forged"],completed:[]}));assert.equal(journal.read(),null);
  assert.equal(publicationJournal({getItem(){throw Error("blocked");},setItem(){throw Error("quota");}},"key").write({}),false);
});
test("teacher evidence approval reuses authorized section reclaim context instead of re-querying per commit",()=>{
  const review=readFileSync("js/repo-review/assessment-evidence-review.mjs","utf8");
  assert.match(review,/state\.sectionClaims/);
  assert.match(review,/state\.claimsReadable/);
  assert.match(review,/if\(reviewerRole==="admin"\)[\s\S]*where\("sha","==",sha\)/);
  assert.match(review,/else\{[\s\S]*state\.sectionClaims\.some/);
});
test("gradebook bulk approval keeps teacher reclaim checks inside the already authorized section query",()=>{
  const source=readFileSync("js/repo-review/gradebook-class-review.mjs","utf8");
  assert.match(source,/claimsReadable=true/);
  assert.match(source,/if\(canDecideClaims\)[\s\S]*where\("sha","==",sha\)/);
  assert.match(source,/else\{[\s\S]*\[\.\.\.claimMap\.values\(\)\]\.some/);
});
test("individual and bulk evidence review scope reclaim reads to the current assessment",()=>{
  const review=readFileSync("js/repo-review/assessment-evidence-review.mjs","utf8");
  const gradebook=readFileSync("js/repo-review/gradebook-class-review.mjs","utf8");
  assert.match(review,/where\("section","==",student\.section\),where\("assessmentId","==",assessment\.id\)/);
  assert.match(gradebook,/where\("section","==",detail\.section\),where\("assessmentId","==",detail\.taskId\)/);
});
test("account registry, own teacher directory and student membership start in parallel",async()=>{
  const started=[],finish=[],user={uid:"parallel",email:"new.teacher@example.edu",emailVerified:true};
  const pending=kind=>{started.push(kind);return new Promise(resolve=>finish.push(()=>resolve(kind==="staff_access"?{exists:()=>true,data:()=>({email:user.email,status:"active",role:"teacher"})}:{docs:[],empty:true})));};
  let remembered;
  const context={auth:{authStateReady:()=>new Promise(()=>{}),currentUser:user},db:{},ADMIN_EMAIL:"admin@example.edu",doc:(_db,kind)=>kind,collection:(_db,kind)=>kind,query:kind=>kind,where:()=>{},getDocFromServer:kind=>pending(kind),getDocsFromServer:kind=>pending(kind),rememberStaff:(_user,profile)=>{remembered=profile;},staffRole:()=>remembered?.status==="active"?"teacher":null};
  const source=readFileSync("js/core/staff-session.mjs","utf8").replace(/^import[^;]+;\s*/gm,"").replace(/\bexport\s+/g,"");
  runInNewContext(source+"\nglobalThis.resolve=resolveAccountAccess;",context);
  const result=context.resolve(user);assert.deepEqual(started,["staff_access","teachers","students"]);finish.forEach(resolve=>resolve());assert.equal((await result).role,"teacher");
});
