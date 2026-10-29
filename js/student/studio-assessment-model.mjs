/**
 * Adminerva Studio assessment source: portable and deterministic snapshot preparation.
 * No mutable working-project reference may substitute for a submitted snapshot.
 */
export const STUDIO_MAX_SNAPSHOT_BYTES=320000;
export function studioEvidenceId(studentId,assessmentId){
  for(const id of [studentId,assessmentId]){
    if(typeof id!=="string"||!id||id.length>160||id==="."||id===".."||/[\\/\u0000-\u001f\u007f]/.test(id))
      throw Error("Invalid assessment or student record identity.");
  }
  return studentId+"_"+assessmentId;
}
export function studioSubmissionAllowed(assessment,section,now=Date.now()){
  if(assessment?.schemaVersion!==3||assessment?.submissionSource!=="studio")
    return {allowed:false,reason:"This task is not configured for Adminerva Studio submissions."};
  const assignment=(assessment.deployments||[]).find(item=>item.section===section);
  if(!assignment)return {allowed:false,reason:"This assessment is not deployed to your class."};
  const open=assignment.postDate?Date.parse(assignment.postDate):0;
  const due=assignment.deadlineEnabled===false||!assignment.deadline?Infinity:Date.parse(assignment.deadline);
  if(!Number.isFinite(open)||Number.isNaN(due))return {allowed:false,reason:"The teacher's submission schedule is invalid."};
  if(now<open)return {allowed:false,reason:"This assessment is not open yet."};
  if(now>due)return {allowed:false,reason:"The submission deadline has passed. Ask your teacher for an extension."};
  return {allowed:true,reason:"Submission window open."};
}
export function snapshotStudioProject(project,liveState){
  if(!project?.id||!project?.title||!liveState||!liveState.files||!Array.isArray(liveState.fileOrder))
    throw Error("Open and save a named Studio project before submission.");
  const files=liveState.files;
  const names=Object.keys(files);
  if(!names.length||names.length>100||liveState.fileOrder.length!==names.length||new Set(liveState.fileOrder).size!==names.length||
      !liveState.fileOrder.every(name=>Object.hasOwn(files,name))||
      names.some(name=>typeof files[name]!=="string"||!name||name.length>220||name.startsWith("/")||
        name.split("/").some(part=>part===".."||part==="."||!part)))
    throw Error("The project contains invalid or missing files. Fix the project before submitting.");
  const snapshot={
    schemaVersion:1,lang:liveState.lang,files,
    fileOrder:[...liveState.fileOrder],
    database:project.database||{tables:{},history:[]},
    design:project.design||{},
    config:project.config||{}
  };
  if(!["java","python","web","csharp","cpp","dart"].includes(snapshot.lang))
    throw Error("Unsupported Studio language.");
  const json=JSON.stringify(snapshot);
  const bytes=new TextEncoder().encode(json).length;
  if(bytes>STUDIO_MAX_SNAPSHOT_BYTES)
    throw Error("The project snapshot is too large for an assessment ("+Math.ceil(bytes/1024)+" KB). Export a backup and reduce project data first.");
  return {json,bytes,fileCount:names.length};
}
export async function studioDigest(json){
  const bytes=new TextEncoder().encode(json);
  if(!globalThis.crypto?.subtle)throw Error("Secure hashing is unavailable. Use HTTPS and retry.");
  const digest=await globalThis.crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}
export function verifyStudioSnapshot(json,expectedHash){
  if(typeof json!=="string"||new TextEncoder().encode(json).length>STUDIO_MAX_SNAPSHOT_BYTES)
    throw Error("Submitted snapshot is missing or oversized.");
  const parsed=JSON.parse(json);
  if(!parsed||parsed.schemaVersion!==1||!parsed.files||typeof parsed.files!=="object"||
    !Array.isArray(parsed.fileOrder)||parsed.fileOrder.length!==Object.keys(parsed.files).length)
    throw Error("Submitted snapshot is malformed.");
  if(!/^[a-f0-9]{64}$/.test(expectedHash||""))throw Error("Snapshot checksum is invalid.");
  return parsed;
}
