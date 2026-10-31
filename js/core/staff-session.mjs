/** Server-backed staff admission; browser simulation and teacher-directory edits never grant authority. */
import {app,auth,db} from "./firebase-core.js?v=1.3.0";
import {doc,getDocFromServer,getDocsFromServer,collection,query,where} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {ADMIN_EMAIL,staffRole,rememberStaff} from "./staff-role.mjs?v=1.3.0";
const pending = new Map();
const staffProfiles = new Map();
const accountPending = new Map();
const unavailableStaffLookups = new Set();
const tenantPending=new Map();
const tenantCallable=httpsCallable(getFunctions(app,"asia-southeast1"),"tenantSchools");
async function resolveTenantMemberships(user){
  if(!user?.emailVerified)return {schools:[],roles:[],platformAdmin:false,available:false,legacyCompatibilityAllowed:true};
  if(!tenantPending.has(user.uid)){
    const operation=tenantCallable({preferredSchoolId:null}).then(response=>{
      const schools=Array.isArray(response.data?.schools)?response.data.schools:[];
      return {
        schools,
        roles:[...new Set(schools.flatMap(s=>Array.isArray(s.roles)?s.roles:[]))],
        platformAdmin:response.data?.platformAdmin===true,
        available:true,
        legacyCompatibilityAllowed:response.data?.legacyCompatibilityAllowed!==false,
        v4Cutover:schools.length>0&&schools.every(s=>s.compatibilityMode==="v4_only")
      };
    }).catch(error=>{
      // During the 3.0→4.0 rollout, absence of the new callable must not lock
      // out a valid legacy MCS user. New school-only users still fail closed.
      console.warn("Verified school membership lookup unavailable:",error?.code||error?.message||error);
      return {schools:[],roles:[],available:false,legacyCompatibilityAllowed:true};
    }).finally(()=>tenantPending.delete(user.uid));
    tenantPending.set(user.uid,operation);
  }
  return tenantPending.get(user.uid);
}
export function resolveAccountAccess(user) {
  if(!user?.emailVerified)return Promise.resolve({role:null,teachers:[],students:[],needsTeacherApproval:false});
  if(!accountPending.has(user.uid)) {
    const email=String(user.email||"").toLowerCase();
    const profiles=name=>getDocsFromServer(query(collection(db,name),where("email","==",email)));
    const operation=Promise.all([
      resolveStaffRole(user),profiles("teachers"),profiles("students"),resolveTenantMemberships(user)
    ]).then(([legacyRole,teachers,students,tenant])=>{
      const activeStudents=students.docs.filter(record=>!["suspended","archived"].includes(String(record.data()?.status||"active")));
      const schoolAdmin=tenant.roles.includes("school_admin");
      const schoolTeacher=tenant.roles.includes("teacher");
      const schoolStudent=tenant.roles.includes("student");
      const platformAdmin=tenant.platformAdmin===true;
      const effectiveLegacyRole=tenant.legacyCompatibilityAllowed===false?null:legacyRole;
      // Once MCS is V4-only, flat staff_access/bootstrap identities stop
      // contributing any presentation role. Canonical school/platform grants
      // remain authoritative and are returned independently.
      const role=effectiveLegacyRole|| (schoolTeacher?"teacher":null);
      return {
        role,legacyRole:effectiveLegacyRole,platformAdmin,schoolAdmin,schoolTeacher,schoolStudent,
        v4Schools:tenant.schools,v4MembershipLookupAvailable:tenant.available,
        legacyCompatibilityAllowed:tenant.legacyCompatibilityAllowed!==false,
        v4Cutover:tenant.v4Cutover===true,
        teachers:teachers.docs,students:activeStudents,
        needsTeacherApproval:!role&&!schoolAdmin&&!schoolStudent&&!teachers.empty,
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
  if (email === ADMIN_EMAIL) {unavailableStaffLookups.delete(user.uid);staffProfiles.delete(user.uid);return "admin";}
  if (!pending.has(user.uid)) {
    const operation = getDocFromServer(doc(db,"staff_access",email)).then(snapshot => {
      unavailableStaffLookups.delete(user.uid);
      const profile=snapshot.exists() ? snapshot.data() : null;
      staffProfiles.set(user.uid,profile);rememberStaff(user,profile);
      return staffRole(user);
    }).finally(() => pending.delete(user.uid));
    pending.set(user.uid,operation);
  }
  try { return await pending.get(user.uid); }
  catch { unavailableStaffLookups.add(user.uid);staffProfiles.delete(user.uid);rememberStaff(user,{status:"unavailable"}); return null; }
}
export async function resolveStaffSubjects(user){
  const role=await resolveStaffRole(user);
  if(role!=="teacher")return [];
  const profile=staffProfiles.get(user?.uid),subjects=profile?.subjects;
  return Array.isArray(subjects)?[...new Set(subjects.filter(subject=>typeof subject==="string"&&subject.trim()&&subject.length<=120))].slice(0,40):[];
}
export const staffSessionReady = auth.authStateReady().then(async () => {
  const user=auth.currentUser;
  const access=await resolveAccountAccess(user);
  return {user,role:access.role,schoolAdmin:access.schoolAdmin,access};
});
