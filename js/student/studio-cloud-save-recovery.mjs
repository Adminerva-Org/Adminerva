/** Classify Studio cloud-save failures without changing academic write authority. */
export function describeStudioCloudSaveError(error,{online=true}={}){
  const code=String(error?.code||"").toLowerCase();
  const detail=String(error?.message||error||"Cloud save was not confirmed.")
    .replace(/^Firebase:\s*/i,"")
    .replace(/\s*\(functions\/[^)]+\)\.?$/,"")
    .trim().slice(0,200);
  const message=detail.toLowerCase();
  if(/exam.*(closed|closing|earlier)|earlier exam session|session.*not open|closing state changed|exam session.*open/i.test(message))
    return {category:"exam-locked",label:"exam session not open",retryable:false,detail};
  if(/revision|changed (in school storage|on another device)|different school-saved revision|different final saved checkpoint/i.test(message))
    return {category:"conflict",label:"cloud revision conflict",retryable:false,detail};
  if(/(?:^|\/)(permission-denied|unauthenticated)$/.test(code)||
      /membership|verified school|sign in with the original|school student identity|school enrollment/i.test(message))
    return {category:"access",label:"school access needs verification",retryable:false,detail};
  if(/(?:^|\/)(invalid-argument|out-of-range)$/.test(code)||
      /exceeds? (?:the |a )?\d|project (?:source|database|design).*limit|invalid file/i.test(message))
    return {category:"validation",label:"project needs review",retryable:false,detail};
  if(!online||/(?:^|\/)(unavailable|deadline-exceeded|internal|unknown)$/.test(code)||
      /network error|failed to fetch|connection (?:lost|interrupted|failed)|offline|timed out|timeout|temporarily unavailable/i.test(message))
    return {category:"temporary",label:"connection interrupted",retryable:true,detail};
  return {category:"rejected",label:"cloud save rejected",retryable:false,detail};
}
export function studioCloudRetryDelay(attempt){
  return Math.min(30000,3000*(2**Math.min(4,Math.max(0,Number.isInteger(attempt)?attempt:0))));
}
