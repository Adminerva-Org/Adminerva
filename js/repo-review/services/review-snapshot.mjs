/** Assessment authoring, repository evidence, individual review and protected grading: review snapshot. */
import {parseRepository,validSha} from "./assessment-evidence.mjs";
import {relevantAssessmentFile} from "./v2-grading-assistant.mjs?v=2026.10.21.2-dev.1";
export async function loadReviewSnapshot(repository,checkpoint,assessment,{token=null,fetchImpl=globalThis.fetch}={}){
  if(!validSha(checkpoint))throw Error("A pinned checkpoint is required.");
  const repo=parseRepository(repository),base="https://api.github.com/repos/"+encodeURIComponent(repo.owner)+"/"+encodeURIComponent(repo.repo);
  const headers={Accept:"application/vnd.github+json"};if(token)headers.Authorization="Bearer "+token;
  const request=async route=>{const response=await fetchImpl(base+route,{headers});if(!response.ok)throw Error("GitHub HTTP "+response.status+". Check access or API limits.");return response.json();};
  const tree=await request("/git/trees/"+checkpoint+"?recursive=1");
  if(!Array.isArray(tree.tree)||tree.truncated)throw Error("The checkpoint file tree is incomplete. Do not infer project completeness from this preview.");
  const paths=tree.tree.filter(file=>file.type==="blob"&&relevantAssessmentFile(file.path,assessment)).map(file=>file.path);
  const files=[];
  for(const path of paths.slice(0,12)){
    try{
      const data=await request("/contents/"+path.split("/").map(encodeURIComponent).join("/")+"?ref="+checkpoint);
      if(data.encoding!=="base64"||typeof data.content!=="string"||data.size>30000)throw Error("Unavailable text or file exceeds 30 KB.");
      const bytes=Uint8Array.from(atob(data.content.replace(/\s/g,"")),character=>character.charCodeAt(0));
      if(bytes.length>30000)throw Error("File exceeds 30 KB.");
      files.push({path,text:new TextDecoder("utf-8",{fatal:true}).decode(bytes)});
    }catch(error){files.push({path,error:error.message});}
  }
  return {paths,files,partial:paths.length>12||files.some(file=>file.error)};
}
