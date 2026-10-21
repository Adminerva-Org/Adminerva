import {auth,db} from "./firebase-core.js";
import {doc,serverTimestamp,runTransaction,collection,query,where,getDocs} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {registrationProfile,assertPendingRequest} from "./admission-model.mjs?v=2026.10.21.1-dev.1";
import {resolveStaffRole} from "./staff-session.mjs?v=1.1.0";
export async function ensureGuestRequest(user,requestedRole="guest") {
  const profile=registrationProfile(user,requestedRole),ref=doc(db,"account_requests",user.uid);
  return runTransaction(db,async transaction=>{
    const existing=await transaction.get(ref);
    if(auth.currentUser?.uid!==user.uid)throw Error("Account changed. Sign in again.");
    if(existing.exists())return existing.data();
    transaction.set(ref,{...profile,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    return profile;
  });
}
export async function matchingStudentRecords(email) {
  const records=await getDocs(query(collection(db,"students"),where("email","==",email)));
  return records.docs.map(record=>({id:record.id,...record.data()}));
}
export async function decideAdmission(opened,{role,studentId="",section="",reason,decision="approved"}) {
  const actor=auth.currentUser;
  if(await resolveStaffRole(actor)!=="admin")throw Error("Administrator access is required.");
  if(!["approved","rejected"].includes(decision)||!reason||reason.trim().length<12||reason.length>600)throw Error("Provide a decision reason of 12–600 characters.");
  if(decision==="approved"&&!["student","teacher"].includes(role))throw Error("Choose student or teacher access.");
  await runTransaction(db,async transaction=>{
    const ref=doc(db,"account_requests",opened.ownerUid),record=await transaction.get(ref),before=record.data();
    assertPendingRequest(before,opened);
    const staffRef=doc(db,"staff_access",before.email),staff=role==="teacher"&&decision==="approved"?await transaction.get(staffRef):null;
    const studentRef=role==="student"&&decision==="approved"?doc(db,"students",studentId||"registration_"+before.ownerUid):null;
    const student=studentRef?await transaction.get(studentRef):null;
    if(student?.exists()&&student.data().email?.toLowerCase()!==before.email)throw Error("Existing students can be linked only to the same verified email.");
    if(studentRef&&!student.exists()&&(!section.trim()||section.length>120))throw Error("Choose a section before creating a student record.");
    if(auth.currentUser?.uid!==actor.uid)throw Error("Account changed. Reload before continuing.");
    if(staff){
      const prior=staff.exists()?staff.data():null,revision=(prior?.revision||0)+1;
      const after={email:before.email,displayName:before.displayName,role:"teacher",status:"active",revision,reason:reason.trim(),updatedBy:actor.uid,updatedAt:serverTimestamp()};
      transaction.set(staffRef,after);transaction.set(doc(staffRef,"revisions",String(revision)),{before:prior,after,actorUid:actor.uid,createdAt:serverTimestamp()});
    }
    if(studentRef&&!student.exists())transaction.set(studentRef,{email:before.email,name:before.displayName,section:section.trim(),githubUsername:"",repoUrl:"unassigned"});
    const after={...before,status:decision,approvedRole:decision==="approved"?role:null,studentId:studentRef?.id||null,reason:reason.trim(),revision:before.revision+1,decidedBy:actor.uid,updatedAt:serverTimestamp()};
    transaction.set(ref,after);transaction.set(doc(ref,"revisions",String(after.revision)),{before,after,actorUid:actor.uid,createdAt:serverTimestamp()});
  });
}
