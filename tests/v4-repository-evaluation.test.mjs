import test from "node:test";
import assert from "node:assert/strict";
import {buildV4RepositoryEvaluationSnapshot,buildHistoricalCheckpointEvaluationSnapshot,classifyCommitAttribution} from "../js/repo-review/services/v4-repository-evidence.mjs";
import {createGithubEvidenceClient} from "../js/repo-review/services/github-evidence-client.mjs";
import {buildGeneralExternalEvaluationData,buildGeneralExternalEvaluationPackage,parseGeneralExternalEvaluationResponse} from "../js/assessment/general-external-evaluation.mjs";

const checkpoint="c".repeat(40),changed="a".repeat(40);
const frozen=()=>({
  status:"approved",version:2,evidenceRevision:0,checkpointSha:checkpoint,
  evidenceDigest:"frozen-digest",
  repository:{fullName:"student/example"},
  selectedCommitShas:[changed]
});
function mockClient(){
  return {
    async listCommits({repository,ref}){
      assert.equal(repository,"student/example");assert.equal(ref,checkpoint);
      return {commits:[{sha:checkpoint},{sha:changed}],historyComplete:true};
    },
    async loadCommit(repo,sha){
      assert.equal(repo,"student/example");assert.equal(sha,changed);
      return {sha,parents:[{sha:"b".repeat(40)}],filesTruncated:false,
        files:[{filename:"src/Main.java",status:"modified",additions:2,deletions:0,
          patch:"@@ -0,0 +1,2 @@\n+public class Main {\n+  public static void main(String[] args) {}\n"}]};
    },
    async loadPinnedSource(repo,sha,paths){
      assert.equal(repo,"student/example");assert.equal(sha,checkpoint);
      assert.deepEqual(paths,["src/Main.java"]);
      return {files:[{path:"src/Main.java",content:"public class Main {}"}],omitted:[]};
    }
  };
}
test("V4 repository evaluation reuses substantive-diff analysis and pins source",async()=>{
  const evidence=await buildV4RepositoryEvaluationSnapshot({snapshot:frozen(),client:mockClient()});
  assert.equal(evidence.evidenceRevision,0);
  assert.equal(evidence.analysis.selectedCount,1);
  assert.equal(evidence.analysis.substantiveChanges,1);
  assert.equal(evidence.analysis.complete,true);
  assert.equal(evidence.pinnedSource[0].checkpointSha,checkpoint);
  assert.equal(evidence.commits[0].files[0].substantive,true);
  assert.match(evidence.limitations.join(" " ),/do not independently prove individual authorship/);
  const payload=buildGeneralExternalEvaluationData({
    task:{title:"Java assessment",submissionSource:"github",instructions:"Create a Java class",
      rubric:[{name:"Code correctness",points:5}],maxScore:5},
    snapshot:evidence
  });
  assert.equal(payload.evidence.pinnedSource[0].content,"public class Main {}");
  assert.equal(payload.evidence.commits[0].files[0].path,"src/Main.java");
  assert.equal(payload.evidence.analysis.complete,true);
  assert.match(payload.gradingRules.repositoryBoundary,/independently prove individual authorship/);
});
test("submitted GitHub commits are eligible without approval, but missing receipt or unreachable commits fail closed",async()=>{
  const submitted=await buildV4RepositoryEvaluationSnapshot({
    snapshot:{...frozen(),status:"submitted",hasSubmission:true},client:mockClient()
  });
  assert.equal(submitted.analysis.selectedCount,1);
  await assert.rejects(buildV4RepositoryEvaluationSnapshot({
    snapshot:{...frozen(),hasSubmission:false},client:mockClient()
  }),/student-submitted/);
  await assert.rejects(buildV4RepositoryEvaluationSnapshot({
    snapshot:frozen(),client:{...mockClient(),listCommits:async()=>({
      commits:[{sha:checkpoint}],historyComplete:false})}
  }),/Cannot verify 1 submitted commit/);
  await assert.rejects(
    buildV4RepositoryEvaluationSnapshot({snapshot:frozen(),client:{
      ...mockClient(),loadCommit:async()=>({sha:"b".repeat(40),files:[]})
    }}),/different commit/);
  await assert.rejects(
    buildV4RepositoryEvaluationSnapshot({snapshot:{...frozen(),selectedCommitShas:[changed,changed]},client:mockClient()}),
    /invalid/);
});
test("V4 marks truncated or missing repository changes as incomplete",async()=>{
  const client=mockClient();
  client.loadCommit=async()=>({sha:changed,parents:[{},{}],filesTruncated:true,
    files:[{filename:"src/Main.java",status:"modified"}]});
  client.loadPinnedSource=async()=>({files:[],omitted:[{path:"src/Main.java",reason:"File was removed"}]});
  const evidence=await buildV4RepositoryEvaluationSnapshot({snapshot:frozen(),client});
  assert.equal(evidence.analysis.complete,false);
  assert.equal(evidence.analysis.uncertainChanges,0);
  assert.ok(evidence.limitations.some(x=>/Merge commit/.test(x)));
  assert.ok(evidence.limitations.some(x=>/Pinned source unavailable/.test(x)));
});
test("pinned GitHub source loads only exact immutable SHA and handles missing files",async()=>{
  const source="public class Main {}";
  const requests=[];
  const client=createGithubEvidenceClient({retryCount:0,fetchImpl:async url=>{
    const u=new URL(url);requests.push(u);
    assert.equal(u.searchParams.get("ref"),checkpoint);
    if(u.pathname.endsWith("/Missing.java"))return {status:404,ok:false};
    return {status:200,ok:true,json:async()=>({
      type:"file",path:"src/Main.java",encoding:"base64",
      size:Buffer.byteLength(source),content:Buffer.from(source).toString("base64")
    })};
  }});
  const result=await client.loadPinnedSource("student/example",checkpoint,
    ["src/Main.java","src/Missing.java"]);
  assert.equal(result.files.length,1);
  assert.equal(result.files[0].content,source);
  assert.equal(result.omitted.length,1);
  assert.equal(requests.length,2);
});

const checkpointReceipt=()=>({...frozen(),historical:true,checkpointOnly:true,hasSubmission:true,sourcePath:"src",
 receiptDigest:"d".repeat(64),selectedCommitShas:[],evidenceRevision:0});
test("checkpoint AI reads only regular files within the original submitted path and never fabricates contributions",async()=>{
 const snap=checkpointReceipt();
 const client={listPinnedTree:async(repo,sha)=>{
   assert.equal(repo,"student/example");assert.equal(sha,checkpoint);
   return {complete:true,entries:[{type:"tree",path:"src",mode:"040000"},{type:"blob",path:"src/Main.java",mode:"100644"},
    {type:"blob",path:"src2/Other.java",mode:"100644"},{type:"blob",path:"src/Link.java",mode:"120000"},{type:"blob",path:"secret.json",mode:"100644"}]};
 },loadPinnedSource:async(repo,sha,paths)=>{
   assert.equal(sha,checkpoint);assert.deepEqual(paths,["src/Main.java"]);
   return {files:[{path:"src/Main.java",content:"public class Main {}"}],omitted:[]};
 }};
 const evidence=await buildHistoricalCheckpointEvaluationSnapshot({snapshot:snap,client});
 assert.equal(evidence.checkpointOnly,true);assert.equal(evidence.analysis.complete,true);
 assert.deepEqual(evidence.selectedCommitShas,[]);assert.deepEqual(evidence.commits,[]);
 assert.equal(evidence.pinnedSource[0].checkpointSha,checkpoint);
 const task={title:"Java",submissionSource:"github",instructions:"Build a Java class",rubric:[{name:"Code",points:5}],maxScore:5};
 const payload=buildGeneralExternalEvaluationData({task,snapshot:evidence});
 assert.equal(payload.evidence.type,"github_historical_checkpoint_source");
 assert.equal(payload.evidence.checkpointRef,snap.receiptDigest);
 assert.match(payload.gradingRules.repositoryBoundary,/Do not infer individual authorship/);
 assert.ok(buildGeneralExternalEvaluationPackage({task,snapshot:evidence}).includes(snap.receiptDigest));
 const response={format:"adminerva-general-external-evaluation-response-v1",checkpointRef:snap.receiptDigest,
   criteria:[{name:"Code",maximumPoints:5,awardedPoints:3,pendingPoints:2,comment:"Source inspected",rationale:"src/Main.java",confidence:"moderate"}],feedback:"Review coverage",limitations:"No execution evidence"};
 assert.equal(parseGeneralExternalEvaluationResponse(JSON.stringify(response),{task,expectedCheckpointRef:snap.receiptDigest}).criteria[0].awardedPoints,3);
 assert.throws(()=>parseGeneralExternalEvaluationResponse(JSON.stringify({...response,checkpointRef:"wrong"}),{task,expectedCheckpointRef:snap.receiptDigest}),/different checkpoint/);
 await assert.rejects(buildHistoricalCheckpointEvaluationSnapshot({snapshot:{...snap,sourcePath:"missing"},client}),/could not be located/);
 await assert.rejects(buildHistoricalCheckpointEvaluationSnapshot({snapshot:{...snap,hasSubmission:false},client}),/verified original/);
});
test("pinned tree transport validates the exact commit and tree identity",async()=>{
 const tree="e".repeat(40),requests=[];
 const client=createGithubEvidenceClient({retryCount:0,fetchImpl:async url=>{
   const u=new URL(url);requests.push(u.pathname);
   return {ok:true,status:200,json:async()=>u.pathname.endsWith("/git/commits/"+checkpoint)?
     {sha:checkpoint,tree:{sha:tree}}:{sha:tree,truncated:true,tree:[]}};
 }});
 const result=await client.listPinnedTree("student/example",checkpoint);
 assert.equal(result.complete,false);
 assert.deepEqual(requests,["/repos/student/example/git/commits/"+checkpoint,"/repos/student/example/git/trees/"+tree]);
});

test("GitHub attribution uses verified numeric provider identity only and is advisory",async()=>{
 assert.equal(classifyCommitAttribution("123",{id:123}),"linked_account_match");
 assert.equal(classifyCommitAttribution("123",{id:456}),"linked_account_differs");
 assert.equal(classifyCommitAttribution("123",{login:"same-name"}),"unknown");
 assert.equal(classifyCommitAttribution(null,{id:123}),"unknown");
 const client=mockClient(),load=client.loadCommit;client.loadCommit=async(...args)=>({...await load(...args),author:{id:456}});
 const evidence=await buildV4RepositoryEvaluationSnapshot({snapshot:{...frozen(),linkedGithubId:"123"},client});
 assert.equal(evidence.commits[0].attribution,"linked_account_differs");
 assert.match(evidence.limitations.join(" "),/Review suggested/);
 assert.equal(evidence.analysis.complete,true);
});
