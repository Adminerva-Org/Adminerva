/**
 * Device recovery for verified-school written and link assessment drafts.
 * This is NOT a submission or a grade. The server is authoritative; local
 * copies are isolated by login UID, school, assessment and response type.
 */
export function assessmentDraftKey({uid,schoolId,taskId,source}){
  if(!uid||!schoolId||!taskId||!["text","link"].includes(source))
    throw Error("A verified school, learner and supported task are required.");
  return "Adminerva_School_Assessment_Draft_v1_"+[uid,schoolId,taskId,source]
    .map(value=>encodeURIComponent(String(value))).join("_");
}
export function draftPayload(source,payload={}){
  if(source==="text")return {response:String(payload.response??"")};
  if(source==="link")return {
    url:String(payload.url??""),note:String(payload.note??"")
  };
  throw Error("Unsupported response draft type.");
}
export function sameDraftPayload(source,first,second){
  const a=draftPayload(source,first),b=draftPayload(source,second);
  return JSON.stringify(a)===JSON.stringify(b);
}
export function readDeviceAssessmentDraft(storage,context){
  try{
    const raw=storage.getItem(assessmentDraftKey(context));
    const row=raw?JSON.parse(raw):null;
    if(!row||row.schemaVersion!==1||row.uid!==context.uid||
       row.schoolId!==context.schoolId||row.taskId!==context.taskId||
       row.source!==context.source||!row.payload)return null;
    const payload=draftPayload(context.source,row.payload);
    if(payload.response?.length>50000||payload.url?.length>4096||
       payload.note?.length>10000)return null;
    return {...row,payload};
  }catch{return null;}
}
export function writeDeviceAssessmentDraft(storage,context,{payload,pending,revision=0,submissionVersion=0}={}){
  const value={schemaVersion:1,...context,payload:draftPayload(context.source,payload),
    pending:pending===true,revision,submissionVersion,updatedAt:Date.now()};
  try{storage.setItem(assessmentDraftKey(context),JSON.stringify(value));return true;}
  catch{return false;}
}
export function preserveRecoveryAssessmentDraft(storage,context,row){
  // Keep the losing side of an explicit device/cloud conflict as an archive,
  // never silently remove a learner's only copy of unfinished work.
  try{
    storage.setItem(assessmentDraftKey(context)+"_recovery",
      JSON.stringify({...row,archivedAt:Date.now()}));
    return true;
  }catch{return false;}
}
export function clearDeviceAssessmentDraft(storage,context){
  try{storage.removeItem(assessmentDraftKey(context));}catch{}
}
