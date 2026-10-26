/** Administrator-only reclaim decisions; frontend hints do not grant permission. */
import {auth,db} from "../../core/firebase-core.js?v=1.3.0";
import {doc,runTransaction,serverTimestamp} from "../../core/teaching-firestore.mjs?v=1.3.2";
import {resolveStaffRole} from "../../core/staff-session.mjs?v=1.3.10";

export async function decideReclaim({claimId,decision,reason}={}){
  if(!auth.currentUser||await resolveStaffRole(auth.currentUser)!=="admin")
    throw Error("An approved administrator account is required to resolve reclaim requests.");
  if(!["approved","shared","rejected"].includes(decision))throw Error("Invalid reclaim decision.");
  const note=String(reason||"").trim();
  if(note.length<10||note.length>2000)throw Error("Enter a decision reason of 10–2,000 characters.");
  if(!claimId||!String(claimId).match(/^[a-f0-9]{40}_[A-Za-z0-9_-]{1,160}$/))
    throw Error("Invalid reclaim request identity.");
  const userId=auth.currentUser.uid,ref=doc(db,"commit_reclaims",claimId);
  await runTransaction(db,async tx=>{
    const snapshot=await tx.get(ref);
    if(!snapshot.exists()||snapshot.data().status!=="pending")
      throw Error("This reclaim is no longer pending. Refresh the review.");
    const claim=snapshot.data();
    tx.update(ref,{status:decision,reviewedBy:userId,reviewedAt:serverTimestamp(),reviewNote:note});
    tx.set(doc(db,"commit_claim_decisions",claimId),{
      claimId,studentId:claim.studentId,repository:claim.repository,sha:claim.sha,
      decision,reviewerUid:userId,reason:note,createdAt:serverTimestamp()
    });
  });
}
