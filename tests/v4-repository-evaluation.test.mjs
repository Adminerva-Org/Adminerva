import test from "node:test";
import assert from "node:assert/strict";
import {buildV4RepositoryEvaluationSnapshot} from "../js/repo-review/services/v4-repository-evidence.mjs";
import {createGithubEvidenceClient} from "../js/repo-review/services/github-evidence-client.mjs";
import {buildGeneralExternalEvaluationData} from "../js/assessment/general-external-evaluation.mjs";

const checkpoint="c".repeat(40),changed="a".repeat(40);
const frozen=()=>({
  status:"approved",version:2,checkpointSha:checkpoint,
  evidenceDigest:"frozen-digest",
  repository:{fullName:"student/example"},
  selectedCommitShas:[changed]
});
function mockClient(){
  return {
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
  assert.equal(evidence.analysis.selectedCount,1);
  assert.equal(evidence.analysis.substantiveChanges,1);
  assert.equal(evidence.analysis.complete,true);
  assert.equal(evidence.pinnedSource[0].checkpointSha,checkpoint);
  assert.equal(evidence.commits[0].files[0].substantive,true);
  assert.match(evidence.limitations.join(" " ),/do not independently prove student identity/);
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
test("V4 refuses unapproved GitHub evidence and mismatched commit objects",async()=>{
  await assert.rejects(
    buildV4RepositoryEvaluationSnapshot({snapshot:{...frozen(),status:"submitted"},client:mockClient()}),
    /Approve this exact frozen/);
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
