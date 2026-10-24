/** Shared navigation, account access, reporting and release infrastructure: notification visibility. */
// Notification badges and feeds are based on intended recipients, never
// failed subscriptions or private reports the viewer cannot access.
export function notificationVisible(item, role) {
  if (!item || !item.type) return false;
  if (role === "admin") return true;
  if (item.type === "release") return role === "teacher" || role === "student";
  if (item.type === "issue") {
    // Source issue feeds are already audience-scoped, while official notification
    // records are private to the recipient. Missing metadata remains hidden.
    if (!item.reportCategory || !["teacher", "admin"].includes(item.reportAudience)) return false;
    return role === "teacher" || role === "student";
  }
  if (role === "teacher") return ["submission", "grading", "grade", "assessment"].includes(item.type);
  if (role === "student") return ["submission", "grade", "assessment"].includes(item.type);
  return false;
}
export function unreadNotificationCount(items, muted, readKeys) {
  return items.filter(item => !muted.has(item.type) &&
    !item.history && !item.readAt && !readKeys.has(item.key)).length;
}
