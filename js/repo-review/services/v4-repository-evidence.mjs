/**
 * School V4 repository evaluation adapter.
 *
 * The approved V4 evidence version is authoritative. The old RepoFetch
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
const MAX_COMMITS=20,MAX_CHANGED_FILES=100,MAX_SOURCE_PATHS=18;
const fileExtension=path=>String(path||"").split("/").pop().split(".").pop().toLowerCase();
const eligibleSourcePath=path=>SOURCE_EXTENSIONS.has(fileExtension(path))&&
  typeof path==="string"&&path.length<=500&&
  !path.startsWith("/")&&!path.split("/").some(part=>!part||part==="."||part==="..");

/**
 * Keep the transport separate from the evidence builder so the same frozen
 * submission can be exercised with a deterministic GitHub client in tests.
 */
export async function buildV4RepositoryEvaluationSnapshot({snapshot,client}={}){
  if(!snapshot||!["approved","reviewed"].includes(snapshot.status))
    throw Error("Approve this exact frozen GitHub evidence version before evaluation.");
  if(!client||typeof client.loadCommit!=="function"||typeof client.loadPinnedSource!=="function")
    throw Error("The repository evidence client is unavailable.");
  const repository=parseGithubRepository(snapshot.repository?.fullName||"").fullName;
  const checkpointSha=String(snapshot.checkpointSha||"").toLowerCase();
  const selected=(snapshot.selectedCommitShas||[]).map(value=>String(value).toLowerCase());
  if(!SHA.test(checkpointSha)||!selected.length||selected.length>100||
     selected.some(sha=>!SHA.test(sha))||new Set(selected).size!==selected.length)
    throw Error("The frozen GitHub checkpoint or selected commit list is invalid.");

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
    commits.push({sha,files});
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
  limitations.push("Selected commit SHAs and their authors do not independently prove student identity, authorship or push time.");
  limitations.push("Pinned files represent the inspected changed paths, not a complete independent test of repository behavior.");

  return {
    version:Number(snapshot.version||0),
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
