/** Verified staff identity shared by monitoring screens; browser role simulation grants no permissions. */
export const ADMIN_EMAIL = "babaynike2013@gmail.com";
export const TEACHER_EMAIL = "josephsixson@mcstayuman.edu.ph";
const resolved = new Map();
export function rememberStaff(user, profile) {
  if (user?.uid) resolved.set(user.uid, profile);
}
export function staffSections(user) {
  const profile=resolved.get(user?.uid);
  return staffRole(user)==="teacher"&&Array.isArray(profile?.sections)
    ? [...new Set(profile.sections.filter(section=>typeof section==="string"&&section.length>0&&section.length<=120))].slice(0,40):[];
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
