// Notification badges and feeds are based on intended recipients, never
// failed subscriptions or private reports the viewer cannot access.
export function notificationVisible(item, role) {
  if (!item || !item.type) return false;
  if (role === "admin") return true;
  if (item.type === "issue") {
    // Report responses remain accessible via My Reports, not student alerts.
    if (role === "student") return false;
    // Missing metadata on older alerts is not proof of authorization.
    if (!item.reportCategory || item.reportCategory === "Bug") return false;
    return role === "teacher"
      ? item.reportAudience === "teacher"
      : role === "student" && ["teacher", "admin"].includes(item.reportAudience);
  }
  if (role === "teacher") return ["submission", "grading", "grade", "assessment"].includes(item.type);
  if (role === "student") return ["grade", "assessment"].includes(item.type);
  return false;
}
export function unreadNotificationCount(items, muted, readKeys) {
  return items.filter(item => !muted.has(item.type) &&
    !item.history && !item.readAt && !readKeys.has(item.key)).length;
}
