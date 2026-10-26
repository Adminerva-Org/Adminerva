/** Pure eligibility and display rules for assessment-scoped class evidence actions. */
export const awaitingBulkApproval=evidence=>["submitted","needs_review"].includes(evidence?.status);
export const mayBulkReopen=evidence=>["submitted","approved","needs_review"].includes(evidence?.status);

export function bulkApproveCandidates(students,evidenceMap){
  return students.filter(student=>awaitingBulkApproval(evidenceMap.get(student.id)));
}
export function bulkReopenCandidates(students,evidenceMap,grades={}){
  return students.filter(student=>mayBulkReopen(evidenceMap.get(student.id))&&grades?.[student.id]?.published!==true);
}
export function wasResubmittedAfterReopening(evidence){
  return evidence?.status==="submitted"&&Boolean(evidence.reopenedBy||evidence.reopenedAt);
}
export function currentGradeForEvidence(grade,evidence){
  return Boolean(grade&&evidence?.status==="approved"&&
    grade.gradedSha===evidence.approvedCheckpointSha&&
    Number(grade.evidenceRevision)===Number(evidence.revision||0));
}
