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
 * Verify that every selected evidence commit is reachable from the chosen
 * checkpoint. GitHub's commits endpoint scoped to sha=<checkpoint> walks only
 * history that is actually contained in that revision.
 */
export async function verifyCheckpointAncestry({selectedCommits,checkpointSha,fetchPage,maxPages=10}={}){
  if(!Array.isArray(selectedCommits)||typeof checkpointSha!=="string"||typeof fetchPage!=="function")
    throw Error("Invalid checkpoint ancestry request.");
  const commits=[...new Set(selectedCommits.map(value=>String(value||"").toLowerCase()))];
  const checkpoint=String(checkpointSha||"").toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(checkpoint)||commits.some(sha=>!/^[a-f0-9]{40}$/.test(sha)))
    throw Error("Invalid Git commit SHA in checkpoint ancestry request.");
  const remaining=new Set(commits);
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
