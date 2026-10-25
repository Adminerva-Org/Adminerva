/** Assessment authoring, repository evidence, individual review and protected grading: evidence transaction. */
import {auth,db} from "../../core/firebase-core.js?v=1.3.0";
import {doc,runTransaction,serverTimestamp} from "../../core/teaching-firestore.mjs?v=1.3.0";
import {assertSameEvidence,evidenceRevision,gradeMatchesEvidence} from "./evidence-lifecycle.mjs?v=1.3.0";
import {legacyReadyDraft} from "./publication-queue.mjs?v=1.3.2";

export async function verifyGradePublication(transaction,gradeRef,grade){
  if(!grade.taskId)return false;
  const assessment=await transaction.get(doc(db,"assessments",grade.taskId));
  if(assessment.data()?.schemaVersion!==2)return false;
  const evidence=await transaction.get(doc(db,"assessment_evidence",gradeRef.id));
  if(!evidence.exists()||!gradeMatchesEvidence(grade,evidence.data())||
    (grade.reviewRequired && !legacyReadyDraft(grade)))
    throw Error("Evidence changed or needs review. Open Review & Grade before publishing.");
  return true;
}

export async function changeEvidence(ref,opened,changes,reason){
  if(!auth.currentUser)throw Error("Sign in before changing evidence.");
  if(String(reason||"").trim().length<10)throw Error("An audit reason is required.");
  await runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(ref);
    const current=snapshot.exists()?snapshot.data():null;
    assertSameEvidence(current,opened);
    if(changes.status==="reopened"||(current.status==="approved"&&changes.status==="approved")){
      const grade=await transaction.get(doc(db,"student_grades",ref.id));
      if(grade.exists()&&grade.data().published)throw Error("Unpublish the protected grade in section 3 of Review & Grade (or Gradebook) before reopening evidence or revising verification.");
    }
    const revision=evidenceRevision(current)+1;
    const after={...current,...changes,revision,updatedAt:serverTimestamp()};
    transaction.set(doc(ref,"revisions",String(revision)),{
      before:current,after,actorUid:auth.currentUser.uid,reason:reason.trim(),createdAt:serverTimestamp()
    });
    transaction.set(ref,after);
  });
}
