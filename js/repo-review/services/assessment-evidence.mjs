// Assessment Evidence V2: pure validation shared by the student and teacher UIs.
// Git metadata identifies a detected author, not verified individual authorship.
export const SHA_RE=/^[a-f0-9]{40}$/i;
export function parseRepository(value){
  let u;
  try {u=new URL(String(value||'').trim());}catch{throw Error('Link a valid GitHub repository first.');}
  const parts=u.pathname.replace(/\/$/,'').replace(/\.git$/i,'').split('/').filter(Boolean);
  if(u.protocol!=='https:'||u.hostname.toLowerCase()!=='github.com'||parts.length!==2||
    !parts.every(p=>/^[a-zA-Z0-9_.-]+$/.test(p)&&p!=='.'&&p!=='..')||
    u.search||u.hash||u.port||u.username||u.password)
    throw Error('Use a GitHub repository URL such as https://github.com/owner/repo.');
  return {owner:parts[0],repo:parts[1],url:'https://github.com/'+parts.join('/')};
}
export function validSha(value){return SHA_RE.test(String(value||''));}
export function normalizeSelection(commits,checkpoint,{maximum=20}={}){
  if(!Array.isArray(commits)||commits.length>maximum)throw Error('Select at most '+maximum+' evidence commits.');
  const selected=[...new Set(commits.map(x=>String(x||'').toLowerCase()))];
  if(!selected.length)throw Error('Select at least one evidence commit.');
  if(selected.some(x=>!validSha(x)))throw Error('Invalid Git commit SHA.');
  const sha=String(checkpoint||'').toLowerCase();
  if(!validSha(sha)||!selected.includes(sha))
    throw Error('Choose a project checkpoint from the selected commits.');
  return {selectedCommits:selected,checkpointSha:sha};
}
export function detectedAuthor(commit){
  const git=commit?.commit?.author||{};
  return {name:String(git.name||'Unknown Git author').slice(0,120),
    email:String(git.email||'').slice(0,160),
    login:String(commit?.author?.login||'').slice(0,80),
    date:git.date||null};
}
export function attributionLabel(commit,studentLogin){
  const login=String(commit?.author?.login||'').toLowerCase();
  const expected=String(studentLogin||'').replace(/^@/,'').toLowerCase();
  return login&&expected&&login===expected
    ? 'GitHub login matches — staff verification still required'
    : 'Different or unknown Git identity — Reclaim Commit available';
}
export function claimDocumentId(sha,studentId){
  if(!validSha(sha)||!/^[a-zA-Z0-9_-]{1,160}$/.test(studentId||''))
    throw Error('Invalid claim identity.');
  return sha.toLowerCase()+'_'+studentId;
}
