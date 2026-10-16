// Normalize legacy Firestore timestamps, ISO dates, and current Date objects.
export function asDate(value){
  if(!value)return null;
  try{
    const candidate=value instanceof Date?value:
      typeof value.toDate==="function"?value.toDate():new Date(value);
    return Number.isFinite(candidate.getTime())?candidate:null;
  }catch{return null}
}
export function assessmentStatus({grade,submitted,evidenceStatus=null,deadline,now=new Date(),knownSubmissions=true}={}){
  if(grade?.needsRevision===true||grade?.revisionRequested===true)
    return {kind:"revision",text:"Revision requested"};
  if(grade?.published===true)
    return {kind:"graded",text:"Score published"};
  if(evidenceStatus==="approved")return {kind:"reviewed",text:"Checkpoint approved"};
  if(evidenceStatus==="needs_review")return {kind:"evidence",text:"Evidence discovered — awaiting review"};
  if(evidenceStatus==="submitted")return {kind:"submitted",text:"Evidence submitted for review"};
  if(submitted)
    return {kind:"submitted",text:"Submitted for review"};
  if(!knownSubmissions)
    return {kind:"unknown",text:"Submission status unavailable"};
  const due=asDate(deadline);
  if(due&&due.getTime()<now.getTime())
    return {kind:"pastdue",text:"Past due — not submitted"};
  return {kind:"notSubmitted",text:"Not submitted"};
}
