/** Assessment authoring, repository evidence, individual review and protected grading: commit history. */
// Bounded GitHub history pagination for V2 evidence review.
// Older commits can be needed for retrospective assignments and reclaim claims.
export const COMMIT_PAGE_SIZE=100;
export const MAX_COMMIT_PAGES=5;
export function commitPagePath(repoPath,page,{branch}={}){
  if(!Number.isInteger(page)||page<1||page>MAX_COMMIT_PAGES)
    throw Error("The review history limit has been reached.");
  const url=repoPath+"/commits?per_page="+COMMIT_PAGE_SIZE+"&page="+page;
  return branch?url+"&sha="+encodeURIComponent(branch):url;
}
export function appendUniqueCommits(existing,incoming){
  if(!Array.isArray(existing)||!Array.isArray(incoming))
    throw Error("GitHub returned an invalid commit list.");
  const found=new Set();
  return [...existing,...incoming].filter(commit=>{
    const sha=String(commit?.sha||"").toLowerCase();
    if(!/^[a-f0-9]{40}$/.test(sha)||found.has(sha))return false;
    found.add(sha);return true;
  });
}
export function hasOlderCommitPage(page,lastBatchLength){
  return page<MAX_COMMIT_PAGES && lastBatchLength===COMMIT_PAGE_SIZE;
}


/**
 * Verify that every selected student evidence commit is reachable from the
 * chosen project checkpoint. The checkpoint may be a different teammate commit.
 */
export async function verifyCheckpointAncestry({selectedCommits,checkpointSha,fetchPage,maxPages=10}={}){
  if(!Array.isArray(selectedCommits)||typeof checkpointSha!=="string"||typeof fetchPage!=="function")
    throw Error("Invalid checkpoint ancestry request.");
  const commits=[...new Set(selectedCommits.map(value=>String(value||"").toLowerCase()))];
  const checkpoint=String(checkpointSha||"").toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(checkpoint)||commits.some(sha=>!/^[a-f0-9]{40}$/.test(sha)))
    throw Error("Invalid Git commit SHA in checkpoint ancestry request.");
  const remaining=new Set(commits);
  if(!remaining.size)return {ok:true,missing:[],checkedPages:0};
  let checkedPages=0;
  for(let page=1;page<=maxPages;page++){
    const items=await fetchPage(page);
    checkedPages=page;
    if(!Array.isArray(items))throw Error("Invalid commit ancestry response.");
    for(const item of items)remaining.delete(String(item?.sha||"").toLowerCase());
    if(!remaining.size)return {ok:true,missing:[],checkedPages};
    if(items.length<COMMIT_PAGE_SIZE)break;
  }
  return {ok:false,missing:[...remaining],checkedPages};
}

/**
 * A reopened evidence selection may include commits newer than its saved
 * project checkpoint. Prefer the pinned checkpoint when it still contains all
 * selected work; otherwise try the repository head before asking the student
 * to change their selection or withdraw the submission.
 *
 * A fallback is accepted only when GitHub proves that it contains every
 * selected commit. This never changes individual attribution.
 */
export async function resolveSubmissionCheckpoint({selectedCommits,checkpointSha,latestCheckpointSha,fetchPage,maxPages=10}={}){
  if(typeof fetchPage!=="function")throw Error("Invalid checkpoint ancestry request.");
  const original=String(checkpointSha||"").toLowerCase();
  const check=sha=>verifyCheckpointAncestry({
    selectedCommits,checkpointSha:sha,maxPages,fetchPage:page=>fetchPage(sha,page)
  });
  const originalResult=await check(original);
  if(originalResult.ok)return {ok:true,checkpointSha:original,advanced:false,missing:[],checkedPages:originalResult.checkedPages};

  const head=String(latestCheckpointSha||"").toLowerCase();
  if(/^[a-f0-9]{40}$/.test(head)&&head!==original){
    const headResult=await check(head);
    if(headResult.ok)return {ok:true,checkpointSha:head,advanced:true,missing:[],checkedPages:headResult.checkedPages};
    return {ok:false,checkpointSha:original,advanced:false,missing:headResult.missing,
      checkedPages:originalResult.checkedPages+headResult.checkedPages};
  }
  return {ok:false,checkpointSha:original,advanced:false,missing:originalResult.missing,
    checkedPages:originalResult.checkedPages};
}
