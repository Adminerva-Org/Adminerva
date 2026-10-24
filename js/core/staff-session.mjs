/** Server-backed staff admission; browser simulation and teacher-directory edits never grant authority. */
import {auth,db} from "./firebase-core.js?v=1.3.0";
import {doc,getDocFromServer,getDocsFromServer,collection,query,where} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {ADMIN_EMAIL,staffRole,rememberStaff} from "./staff-role.mjs?v=1.3.0";
const pending = new Map();
const accountPending = new Map();
const unavailableStaffLookups = new Set();
export function resolveAccountAccess(user) {
  if(!user?.emailVerified)return Promise.resolve({role:null,teachers:[],students:[],needsTeacherApproval:false});
  if(!accountPending.has(user.uid)) {
    const email=String(user.email||"").toLowerCase();
    const profiles=name=>getDocsFromServer(query(collection(db,name),where("email","==",email)));
    const operation=Promise.all([resolveStaffRole(user),profiles("teachers"),profiles("students")]).then(([role,teachers,students])=>{
      const activeStudents=students.docs.filter(record=>!["suspended","archived"].includes(String(record.data()?.status||"active")));
      return {
        role,teachers:teachers.docs,students:activeStudents,needsTeacherApproval:!role&&!teachers.empty,
        staffLookupUnavailable:unavailableStaffLookups.has(user.uid)
      };
    }).finally(()=>accountPending.delete(user.uid));
    accountPending.set(user.uid,operation);
  }
  return accountPending.get(user.uid);
}
export async function resolveStaffRole(user) {
  if (!user?.emailVerified) return null;
  const email = String(user.email || "").toLowerCase();
  if (email === ADMIN_EMAIL) {unavailableStaffLookups.delete(user.uid);return "admin";}
  if (!pending.has(user.uid)) {
    const operation = getDocFromServer(doc(db,"staff_access",email)).then(snapshot => {
      unavailableStaffLookups.delete(user.uid);
      rememberStaff(user,snapshot.exists() ? snapshot.data() : null);
      return staffRole(user);
    }).finally(() => pending.delete(user.uid));
    pending.set(user.uid,operation);
  }
  try { return await pending.get(user.uid); }
  catch { unavailableStaffLookups.add(user.uid);rememberStaff(user,{status:"unavailable"}); return null; }
}
export const staffSessionReady = auth.authStateReady().then(async () => {
  const user = auth.currentUser;
  const role = await resolveStaffRole(user);
  return {user,role};
});
