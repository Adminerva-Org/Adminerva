import {auth,db} from "../core/firebase-core.js";
import {doc,runTransaction,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {COURSES} from "./practice-courses.mjs?v=2026.10.21.2-dev.1";
import {practiceAlias,completionTotal,PRACTICE_MAXIMUM} from "./practice-ranking-model.mjs?v=2026.10.21.2-dev.1";
export async function syncPracticeRanking(user,profile){
  if(!user?.emailVerified||profile.email.toLowerCase()!==user.email.toLowerCase())throw Error("An enrolled student account is required.");
  return runTransaction(db,async transaction=>{
    const references=COURSES.map(course=>doc(db,"student_practice_progress",user.uid,"courses",course.id));
    const records=await Promise.all(references.map(reference=>transaction.get(reference)));
    const ref=doc(db,"practice_rankings",profile.id),existing=await transaction.get(ref);
    if(auth.currentUser?.uid!==user.uid)throw Error("Account changed. Reload before saving practice.");
    const completedCount=completionTotal(records.filter(record=>record.exists()).map(record=>record.data()));
    const alias=existing.exists()?existing.data().alias:practiceAlias(profile.id);
    transaction.set(ref,{ownerUid:user.uid,studentId:profile.id,section:profile.section,alias,completedCount,points:completedCount*10,catalogMaximum:PRACTICE_MAXIMUM,updatedAt:serverTimestamp()});
  });
}
