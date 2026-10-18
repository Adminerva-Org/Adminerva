/** Verified staff identity shared by monitoring screens; browser role simulation grants no permissions. */
export const ADMIN_EMAIL = "babaynike2013@gmail.com";
export const TEACHER_EMAIL = "josephsixson@mcstayuman.edu.ph";
export function staffRole(user) {
  if (!user?.emailVerified) return null;
  const email = (user.email || "").toLowerCase();
  return email === ADMIN_EMAIL ? "admin" : email === TEACHER_EMAIL ? "teacher" : null;
}
