/** Server-backed staff admission; browser simulation and teacher-directory edits never grant authority. */
import {auth,db} from "./firebase-core.js";
import {doc,getDocFromServer,getDocsFromServer,collection,query,where} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {ADMIN_EMAIL,staffRole,rememberStaff} from "./staff-role.mjs?v=1.1.0";
const pending = new Map();
const accountPending = new Map();
export function resolveAccountAccess(user) {
  if(!user?.emailVerified)return Promise.resolve({role:null,teachers:[],students:[],needsTeacherApproval:false});
  if(!accountPending.has(user.uid)) {
    const email=String(user.email||"").toLowerCase();
    const profiles=name=>getDocsFromServer(query(collection(db,name),where("email","==",email)));
    const operation=Promise.all([resolveStaffRole(user),profiles("teachers"),profiles("students")]).then(([role,teachers,students])=>({
      role,teachers:teachers.docs,students:students.docs,needsTeacherApproval:!role&&!teachers.empty
    })).finally(()=>accountPending.delete(user.uid));
    accountPending.set(user.uid,operation);
  }
  return accountPending.get(user.uid);
}
export async function resolveStaffRole(user) {
  if (!user?.emailVerified) return null;
  const email = String(user.email || "").toLowerCase();
  if (email === ADMIN_EMAIL) return "admin";
  if (!pending.has(user.uid)) {
    const operation = getDocFromServer(doc(db,"staff_access",email)).then(snapshot => {
      rememberStaff(user,snapshot.exists() ? snapshot.data() : null);
      return staffRole(user);
    }).finally(() => pending.delete(user.uid));
    pending.set(user.uid,operation);
  }
  try { return await pending.get(user.uid); }
  catch { rememberStaff(user,{status:"unavailable"}); return null; }
}
export const staffSessionReady = auth.authStateReady().then(async () => {
  const user = auth.currentUser;
  const role = await resolveStaffRole(user);
  return {user,role};
});
