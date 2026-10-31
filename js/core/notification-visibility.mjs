/** Shared navigation, account access, reporting and release infrastructure: notification visibility. */
// Notification badges and feeds are based on intended recipients, never
// failed subscriptions or private reports the viewer cannot access.
export function notificationVisible(item, role) {
  if (!item || !item.type) return false;
  if (role === "admin") return true;
  if (item.type === "release") {
    const audience=Array.isArray(item.audience)?item.audience:[];
    if(audience.length)return audience.includes("all")||audience.includes(role)||role==="schooladmin"&&audience.includes("teacher");
    return role === "teacher" || role === "student";
  }
  if (item.type === "issue") {
    // V4 school support alerts are written only to an explicit per-user feed,
    // tagged with schoolId, and filtered again by the user's active verified
    // school before rendering. They do not need legacy report audience fields.
    if(item.schoolId)return ["admin","teacher","student"].includes(role);
    // Legacy source issue feeds still require their historical audience metadata.
    if (!item.reportCategory || !["teacher", "admin"].includes(item.reportAudience)) return false;
    return role === "teacher" || role === "student";
  }
  if (role === "teacher") return ["submission", "grading", "grade", "assessment", "reclaim"].includes(item.type);
  if (role === "student") return ["submission", "grade", "assessment", "reclaim"].includes(item.type);
  return false;
}
export function unreadNotificationCount(items, muted, readKeys) {
  return items.filter(item => !muted.has(item.type) &&
    !item.history && !item.readAt && !readKeys.has(item.key)).length;
}
