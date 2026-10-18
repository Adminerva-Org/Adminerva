import {normalizeSelection} from "./assessment-evidence.mjs";

export function studentMayChangeEvidence(evidence){
  return !evidence || evidence.status==="reopened" ||
    (["submitted","withdrawn"].includes(evidence.status)&&
      (evidence.source!=="teacher_discovered"||typeof evidence.reopenedBy==="string"));
}

export function evidenceRevision(evidence){return Number(evidence?.revision||0);}

export function assertSameEvidence(current,opened){
  if(!current||!opened||evidenceRevision(current)!==evidenceRevision(opened)||
    JSON.stringify(current)!==JSON.stringify(opened))
    throw Error("Evidence changed. Reload before continuing.");
}

export function approvalContribution(selection,verifiedCommits,scope){
  const normalized=normalizeSelection(selection.selectedCommits,selection.checkpointSha);
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
