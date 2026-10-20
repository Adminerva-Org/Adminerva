/** Personal planning paths, device-cache separation and optimistic save protection. */
const kinds = new Set(["lesson_plans","presentations","schedules","preferences"]);
export function workspacePath(uid,kind,...segments) {
  if (typeof uid !== "string" || !uid || uid.includes("/") || !kinds.has(kind)) throw Error("A signed-in staff workspace is required.");
  return ["staff_workspaces",uid,kind,...segments];
}
export function scopedStorage(storage,uid) {
  workspacePath(uid,"preferences");
  const key = value => "Adminerva_account_" + encodeURIComponent(uid) + "_" + value;
  return {getItem:name=>storage.getItem(key(name)),setItem:(name,value)=>storage.setItem(key(name),value),removeItem:name=>storage.removeItem(key(name))};
}
export function personalPlanId({grade,subject,term,week,schoolYear}) {
  const fields=[schoolYear,grade,subject,term,week].map(value=>String(value||"").trim());
  if (fields.some(value=>!value)) throw Error("Set the lesson year, grade, subject, term and week before saving.");
  const id=encodeURIComponent(JSON.stringify(fields));
  if (id.length>1200) throw Error("Lesson identifiers are too long.");
  return id;
}
export function requireCurrentVersion(existing,expected=0) {
  const actual=existing ? Number(existing.version || 1) : 0;
  if (actual !== expected) throw Error("A newer saved version exists. Your edits are still here. Reload the saved record before replacing it.");
  return actual+1;
}
