// Preserve actual historical grade values without writing undefined into Firestore.
// Some grades predate fields such as maxScore; do not invent values in audit records.
export function pickDefinedGradeFields(grade, keys) {
  const result = {};
  if (!grade) return result;
  for (const key of keys) {
    if (grade[key] !== undefined) result[key] = grade[key];
  }
  return result;
}
