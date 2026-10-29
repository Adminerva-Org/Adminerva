/** Administrator-only reclaim decisions; frontend hints do not grant permission. */
import {auth,db} from "../../core/firebase-core.js?v=1.3.0";
import {doc,runTransaction,serverTimestamp} from "../../core/teaching-firestore.mjs?v=1.3.2";
import {resolveStaffRole} from "../../core/staff-session.mjs?v=1.3.10";
import {claimDocumentId} from "./assessment-evidence.mjs?v=1.3.2";

export async function decideReclaim({claimId,decision,reason}={}){
  if(!auth.currentUser||await resolveStaffRole(auth.currentUser)!=="admin")
    throw Error("An approved administrator account is required to resolve reclaim requests.");
  if(!["approved","shared","rejected"].includes(decision))throw Error("Invalid reclaim decision.");
  const note=String(reason||"").trim();
  if(note.length<10||note.length>2000)throw Error("Enter a decision reason of 10–2,000 characters.");
  if(typeof claimId!=="string"||!(/^[a-f0-9]{40}_.{1,500}$/).test(claimId)||claimId.includes("/"))
    throw Error("Invalid reclaim request identity.");
  const userId=auth.currentUser.uid,ref=doc(db,"commit_reclaims",claimId);
  await runTransaction(db,async tx=>{
    const snapshot=await tx.get(ref);
    if(!snapshot.exists()||snapshot.data().status!=="pending")
      throw Error("This reclaim is no longer pending. Refresh the review.");
    const claim=snapshot.data();
    if(claimDocumentId(claim.sha,claim.studentId)!==claimId)
      throw Error("The reclaim request does not match its original student and commit.");
    tx.update(ref,{status:decision,reviewedBy:userId,reviewedAt:serverTimestamp(),reviewNote:note});
    tx.set(doc(db,"commit_claim_decisions",claimId),{
      claimId,studentId:claim.studentId,repository:claim.repository,sha:claim.sha,
      decision,reviewerUid:userId,reason:note,createdAt:serverTimestamp()
    });
  });
}
