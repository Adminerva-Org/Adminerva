/** Verified staff identity shared by monitoring screens; browser role simulation grants no permissions. */
export const ADMIN_EMAIL = "babaynike2013@gmail.com";
export const TEACHER_EMAIL = "josephsixson@mcstayuman.edu.ph";
const resolved = new Map();
export function rememberStaff(user, profile) {
  if (user?.uid) resolved.set(user.uid, profile);
}
export function staffRole(user) {
  if (!user?.emailVerified) return null;
  const email = (user.email || "").toLowerCase();
  if (email === ADMIN_EMAIL) return "admin";
  if (resolved.has(user.uid)) {
    const profile = resolved.get(user.uid);
    if (profile) return profile.email === email && profile.status === "active" && profile.role === "teacher" ? "teacher" : null;
  }
  return email === TEACHER_EMAIL ? "teacher" : null;
}
