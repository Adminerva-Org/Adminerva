/** Student submissions, practice progress and isolated code workspaces: assessment state. */
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
  if(evidenceStatus==="withdrawn")return {kind:"revision",text:"Evidence withdrawn — resubmission available"};
  if(evidenceStatus==="reopened")return {kind:"revision",text:"Evidence reopened — resubmit for approval"};
  if(submitted)
    return {kind:"submitted",text:"Submitted for review"};
  if(!knownSubmissions)
    return {kind:"unknown",text:"Submission status unavailable"};
  const due=asDate(deadline);
  if(due&&due.getTime()<now.getTime())
    return {kind:"pastdue",text:"Past due — not submitted"};
  return {kind:"notSubmitted",text:"Not submitted"};
}

/**
 * Present V2 target path patterns separately from expected file extensions.
 * File types are guidance and must not be presented as an enforced path.
 * Legacy blueprints stored a single targetPath instead of targetPaths[].
 */
export function assessmentTargetDetails(assessment={}) {
  const paths=Array.isArray(assessment.targetPaths)
    ? assessment.targetPaths.filter(p=>typeof p==="string"&&p.trim()).map(p=>p.trim())
    : [];
  if(!paths.length&&typeof assessment.targetPath==="string"&&assessment.targetPath.trim()){
    paths.push(assessment.targetPath.trim());
  }
  const expectedTypes=Array.isArray(assessment.expectedExtensions)
    ? [...new Set(assessment.expectedExtensions
      .filter(e=>typeof e==="string"&&/^[a-z0-9]{1,12}$/i.test(e.trim().replace(/^\./,"")))
      .map(e=>"."+e.trim().replace(/^\./,"").toLowerCase()))].join(", ")
    : "";
  return {paths:paths.length?paths.join(", "):"Any path",expectedTypes};
}
