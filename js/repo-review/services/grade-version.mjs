/** Deterministic optimistic concurrency for grade content and publication. */
const fields = ["gradeVersion","gradedAt","editedAt","reviewedAt","published","score","maxScore","feedback","evidenceRevision","gradedSha","reviewRequired","manuallyAdjusted"];
function scalar(value) {
  if (value == null) return null;
  if (value instanceof Date) return [Math.floor(value.getTime()/1000),(value.getTime()%1000)*1000000];
  if (typeof value === "object" && Number.isFinite(value.seconds)) return [value.seconds,value.nanoseconds||0];
  return value;
}
export function gradeVersionMatches(current, opened) {
  if (!current || !opened) return current == null && opened == null;
  return fields.every(field => JSON.stringify(scalar(current[field])) === JSON.stringify(scalar(opened[field])));
}
export function assertGradeVersion(current, opened) {
  if (!gradeVersionMatches(current,opened)) throw Error("Grade changed after opening. Reload before continuing; your edits are still here.");
}
export function nextGradeVersion(previous) {
  return Number.isSafeInteger(previous?.gradeVersion) && previous.gradeVersion > 0 ? previous.gradeVersion+1 : 1;
}
