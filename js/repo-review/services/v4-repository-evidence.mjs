/**
 * School V4 repository evaluation adapter.
 *
 * The student-submitted frozen GitHub evidence is authoritative. The old RepoFetch
 * commit-substance analyzer is reused, but GitHub metadata is NEVER treated
 * as independently verified individual authorship or deadline evidence.
 * This is read-only preparation: no grade or evidence writes.
 */
import {analyzePatchSubstance} from "./commit-substance.mjs?v=1.3.0";
import {parseGithubRepository} from "./github-evidence-client.mjs?v=1.3.0";

const SOURCE_EXTENSIONS=new Set([
  "java","kt","kts","xml","py","js","jsx","ts","tsx","html","css",
  "c","h","cpp","hpp","cs","go","rs","php","swift","sql","json","yaml","yml"
]);
const SHA=/^[a-f0-9]{40}$/i;
export function classifyCommitAttribution(linkedId,author){
 const linked=String(linkedId||""),actual=String(author?.id||"");
 if(!/^[1-9][0-9]{0,19}$/.test(linked)||!/^[1-9][0-9]{0,19}$/.test(actual))return "unknown";
 return linked===actual?"linked_account_match":"linked_account_differs";
}
const MAX_COMMITS=20,MAX_CHANGED_FILES=100,MAX_SOURCE_PATHS=18;
const fileExtension=path=>String(path||"").split("/").pop().split(".").pop().toLowerCase();
const eligibleSourcePath=path=>SOURCE_EXTENSIONS.has(fileExtension(path))&&
  typeof path==="string"&&path.length<=500&&
  !path.startsWith("/")&&!path.split("/").some(part=>!part||part==="."||part==="..");

/**
 * Keep the transport separate from the evidence builder so the same frozen
 * submission can be exercised with a deterministic GitHub client in tests.
 */
export async function buildHistoricalCheckpointEvaluationSnapshot({snapshot,client}={}){
  if(snapshot?.historical!==true||snapshot.checkpointOnly!==true||snapshot.hasSubmission!==true||
     !["submitted","reviewed","approved"].includes(snapshot.status)||
     !SHA.test(snapshot.checkpointSha||"")||!/^([a-f0-9]{64})$/i.test(snapshot.receiptDigest||"")||
     !Array.isArray(snapshot.selectedCommitShas)||snapshot.selectedCommitShas.length)
    throw Error("A verified original checkpoint receipt is required.");
  if(!client?.listPinnedTree||!client?.loadPinnedSource)throw Error("Pinned source inspection is unavailable.");
  const repository=parseGithubRepository(snapshot.repository?.fullName||"").fullName;
  const checkpointSha=snapshot.checkpointSha.toLowerCase(),scope=String(snapshot.sourcePath||"").replace(/\/+$/,"");
  if(scope&&(scope.length>240||scope.startsWith("/")||scope.split("/").some(part=>!part||part==="."||part==="..")||/[\\\u0000-\u001f\u007f]/.test(scope)))
    throw Error("Original submitted source path is invalid.");
  const tree=await client.listPinnedTree(repository,checkpointSha);
  const entries=tree.entries||[],inScope=path=>!scope||path===scope||path.startsWith(scope+"/");
  if(scope&&!entries.some(entry=>entry.path===scope))
    throw Error("The original submitted path could not be located at its checkpoint. Review manually.");
  const paths=[...new Set(entries.filter(entry=>entry.type==="blob"&&["100644","100755"].includes(entry.mode)&&inScope(entry.path)&&eligibleSourcePath(entry.path)).map(entry=>entry.path))].sort();
  if(!paths.length)throw Error("No supported source files were found at the submitted checkpoint. Review manually.");
  const pinned=await client.loadPinnedSource(repository,checkpointSha,paths.slice(0,MAX_SOURCE_PATHS));
  const files=(pinned.files||[]).filter(file=>paths.slice(0,MAX_SOURCE_PATHS).includes(file.path)&&typeof file.content==="string");
  if(!files.some(file=>file.content.trim()))throw Error("No readable submitted source was recovered. Review manually.");
  const limitations=["Original student-submitted checkpoint only. No selected contribution commits were recorded. Do not infer individual authorship, contribution history, push time or runtime behavior from static files.",
    "Source scope: "+(scope||"submitted repository root")+"."];
  if(!tree.complete)limitations.push("GitHub returned an incomplete repository tree.");
  if(paths.length>MAX_SOURCE_PATHS)limitations.push((paths.length-MAX_SOURCE_PATHS)+" supported source files omitted by the inspection limit.");
  for(const item of pinned.omitted||[])limitations.push("Source unavailable: "+item.path+" ("+item.reason+").");
  return {version:Number(snapshot.version||1),evidenceRevision:Number(snapshot.evidenceRevision||0),
    evidenceDigest:snapshot.receiptDigest,checkpointOnly:true,sourcePath:scope,repository,checkpointSha,
    personalizedTask:snapshot.personalizedTask||null,selectedCommitShas:[],commits:[],
    pinnedSource:files.map(file=>({...file,checkpointSha})),
    analysis:{selectedCount:0,inspectedCount:0,substantiveChanges:0,nonSubstantiveChanges:0,uncertainChanges:0,
      pinnedFileCount:files.length,complete:tree.complete===true&&paths.length===files.length&&!(pinned.omitted||[]).length},
    limitations:limitations.slice(0,80)};
}

export async function buildV4RepositoryEvaluationSnapshot({snapshot,client}={}){
  if(!snapshot||!["submitted","approved","reviewed"].includes(snapshot.status)||
     snapshot.hasSubmission===false)
    throw Error("A student-submitted frozen GitHub evidence version is required for evaluation.");
  if(!client||typeof client.loadCommit!=="function"||typeof client.loadPinnedSource!=="function")
    throw Error("The repository evidence client is unavailable.");
  const repository=parseGithubRepository(snapshot.repository?.fullName||"").fullName;
  const checkpointSha=String(snapshot.checkpointSha||"").toLowerCase();
  const selected=(snapshot.selectedCommitShas||[]).map(value=>String(value).toLowerCase());
  if(!SHA.test(checkpointSha)||!selected.length||selected.length>100||
     selected.some(sha=>!SHA.test(sha))||new Set(selected).size!==selected.length)
    throw Error("The frozen GitHub checkpoint or selected commit list is invalid.");

  const history=await client.listCommits({repository,ref:checkpointSha});
  const reachable=new Set((history.commits||[]).map(item=>String(item.sha||"").toLowerCase()));
  const missing=selected.filter(sha=>!reachable.has(sha));
  if(missing.length)
    throw Error("Cannot verify "+missing.length+" submitted commit(s) in the frozen checkpoint history"+
      (history.historyComplete?"": " (GitHub history pagination was incomplete)")+
      ". Do not infer zero work; request a corrected submission or inspect manually.");
  const commits=[],candidatePaths=new Set(),limitations=[];
  let substantiveChanges=0,uncertainChanges=0,nonSubstantiveChanges=0;
  const checked=selected.slice(0,MAX_COMMITS);
  if(checked.length!==selected.length)
    limitations.push((selected.length-checked.length)+
      " selected commit(s) were not inspected because the bounded evaluation handles up to 20. Review omitted commits before final grading.");
  for(const sha of checked){
    const detail=await client.loadCommit(repository,sha);
    if(String(detail?.sha||"").toLowerCase()!==sha)
      throw Error("GitHub returned a different commit than the frozen selected SHA.");
    const mergeContext=(detail.parents||[]).length>1;
    if(mergeContext)limitations.push("Merge commit "+sha.slice(0,12)+
      " is project context; do not use it alone as individual contribution evidence.");
    if(detail.filesTruncated||!Array.isArray(detail.files))
      limitations.push("Commit "+sha.slice(0,12)+
        " has incomplete changed-file coverage; inspect its full GitHub diff manually.");
    const allFiles=Array.isArray(detail.files)?detail.files:[];
    if(allFiles.length>MAX_CHANGED_FILES)
      limitations.push("Only the first "+MAX_CHANGED_FILES+" changed files from "+sha.slice(0,12)+
        " fit this evaluation package.");
    const files=allFiles.slice(0,MAX_CHANGED_FILES).map(file=>{
      const path=String(file?.filename||"");
      const rawPatch=typeof file?.patch==="string"?file.patch:null;
      const classification=rawPatch===null?
        {kind:"unknown",substantive:null,reason:"GitHub omitted the textual diff"}:
        analyzePatchSubstance(rawPatch,path);
      const substantive=mergeContext?null:classification.substantive;
      if(!mergeContext){
        if(substantive===true)substantiveChanges++;
        else if(substantive===false)nonSubstantiveChanges++;
        else uncertainChanges++;
      }
      if(eligibleSourcePath(path)&&file?.status!=="removed")
        candidatePaths.add(path);
      if(rawPatch===null&&eligibleSourcePath(path))
        limitations.push("Textual diff unavailable for "+sha.slice(0,12)+" · "+path+
          "; pinned source is context, not proof of the omitted change.");
      return {
        path,status:String(file?.status||""),
        additions:Number(file?.additions||0),deletions:Number(file?.deletions||0),
        patch:rawPatch===null?"":rawPatch.slice(0,24000),
        diffIncomplete:rawPatch===null||rawPatch.length>24000,
        mergeContext,substance:classification.kind,substantive
      };
    });
    commits.push({sha,files,attribution:classifyCommitAttribution(snapshot.linkedGithubId,detail.author)});
  }

  const paths=[...candidatePaths].sort();
  if(paths.length>MAX_SOURCE_PATHS)
    limitations.push("Only "+MAX_SOURCE_PATHS+" of "+paths.length+
      " changed source paths can be included. Omitted files require manual review.");
  const pinned=await client.loadPinnedSource(repository,checkpointSha,
    paths.slice(0,MAX_SOURCE_PATHS));
  for(const omitted of pinned.omitted||[])
    limitations.push("Pinned source unavailable: "+omitted.path+" ("+omitted.reason+").");
  if(!paths.length)
    limitations.push("No supported changed source files were detected; manually inspect the repository before scoring.");
  const differing=commits.filter(commit=>commit.attribution==="linked_account_differs").length;
  const unknown=commits.filter(commit=>commit.attribution==="unknown").length;
  if(differing||unknown)limitations.push(differing+" commit(s) use a different linked account; "+unknown+" have unknown attribution. Review suggested; neither status blocks grading.");
  limitations.push("Student-selected commit SHAs and GitHub authorship metadata do not independently prove individual authorship or push time.");
  limitations.push("Pinned files represent the inspected changed paths, not a complete independent test of repository behavior.");

  return {
    version:Number(snapshot.version||0),
    // Preserve the authoritative evidence revision separately from the display
    // version. Historical revisionless records intentionally expose version 1
    // to the UI while their canonical evidence revision remains 0.
    evidenceRevision:Number(snapshot.evidenceRevision??snapshot.version??0),
    personalizedTask:snapshot.personalizedTask||null,
    evidenceDigest:String(snapshot.evidenceDigest||""),
    repository,checkpointSha,selectedCommitShas:selected,commits,
    pinnedSource:(pinned.files||[]).map(file=>({
      path:file.path,content:file.content,checkpointSha
    })),
    analysis:{
      selectedCount:selected.length,inspectedCount:checked.length,
      substantiveChanges,nonSubstantiveChanges,uncertainChanges,
      pinnedFileCount:(pinned.files||[]).length,
      complete:checked.length===selected.length&&paths.length<=MAX_SOURCE_PATHS&&
        !commits.some(commit=>commit.files.some(file=>file.diffIncomplete))&&
        !(pinned.omitted||[]).length&&
        !commits.some(commit=>commit.files.length===MAX_CHANGED_FILES)
    },
    limitations:[...new Set(limitations)].slice(0,80)
  };
}
