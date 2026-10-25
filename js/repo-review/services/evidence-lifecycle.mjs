/** Assessment authoring, repository evidence, individual review and protected grading: evidence lifecycle. */
import {normalizeSelection} from "./assessment-evidence.mjs?v=1.4.3";

export function studentMayChangeEvidence(evidence){
  return !evidence || evidence.status==="reopened" ||
    (["submitted","withdrawn"].includes(evidence.status)&&
      (evidence.source!=="teacher_discovered"||typeof evidence.reopenedBy==="string"));
}

export function evidenceRevision(evidence){return Number(evidence?.revision||0);}

function canonicalEvidence(value){
  if(value instanceof Date)return ["date",value.getTime()];
  if(Array.isArray(value))return value.map(canonicalEvidence);
  if(value&&typeof value==="object")return Object.keys(value).sort().map(key=>[key,canonicalEvidence(value[key])]);
  return [typeof value,value];
}

export function sameEvidence(first,second){
  return Boolean(first&&second&&JSON.stringify(canonicalEvidence(first))===JSON.stringify(canonicalEvidence(second)));
}

export function assertSameEvidence(current,opened){
  if(!current||!opened||evidenceRevision(current)!==evidenceRevision(opened)||
    !sameEvidence(current,opened)){
    const error=Error("Evidence changed. Reload before continuing; your unsaved review has been kept.");
    error.code="evidence-changed";throw error;
  }
}

export function approvalContribution(selection,verifiedCommits,scope){
  // Instructor-discovered deadline snapshots may intentionally contain no
  // individually attributable commits while still pinning project state.
  const normalized=normalizeSelection(selection.selectedCommits,selection.checkpointSha,{allowEmpty:true});
  if(!Array.isArray(verifiedCommits)||verifiedCommits.some(sha=>!normalized.selectedCommits.includes(sha)))
    throw Error("Verified contributions must belong to the selected evidence.");
  const responsibility=String(scope||"").trim();
  if(responsibility.length<15||responsibility.length>3000)
    throw Error("Describe the student's assigned responsibilities and attribution basis (15–3,000 characters), including when no contribution is verified.");
  return {verifiedContributionCommits:[...new Set(verifiedCommits)],contributionScope:responsibility};
}

export function gradeMatchesEvidence(grade,evidence){
  return evidence?.status==="approved"&&grade?.gradedSha===evidence.approvedCheckpointSha&&
    grade?.evidenceRevision===evidenceRevision(evidence);
}
