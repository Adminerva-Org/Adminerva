/** Transactional deliberate publication with immutable revisions and recoverable progress. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {doc,collection,runTransaction,serverTimestamp} from "../core/teaching-firestore.mjs?v=1.3.0";
import {assertGradeVersion} from "./services/grade-version.mjs?v=1.3.0";
import {approvableEvaluationDraft,legacyReadyDraft,publicationCandidates,bulkPublicationCandidates,bulkZeroScoreDrafts,publicationJournal} from "./services/publication-queue.mjs?v=1.3.3";
import {verifyGradePublication} from "./services/evidence-transaction.mjs?v=3.0.1";
export {publicationCandidates,bulkPublicationCandidates,bulkZeroScoreDrafts};
export function writePublicationRevision(transaction,ref,before,published) {
  if(Boolean(before.published)===published)return;
  transaction.set(doc(collection(db,"grade_revisions")),{
    gradeId:ref.id,studentId:before.studentId,taskId:before.taskId,editorUid:auth.currentUser.uid,
    reason:published?"Teacher explicitly published reviewed feedback":"Teacher explicitly unpublished protected feedback",
    before:{published:Boolean(before.published)},after:{published},createdAt:serverTimestamp()
  });
}
export function publicationRecovery(context) {
  if(!auth.currentUser)return null;
  return publicationJournal(localStorage,"Adminerva_publication_"+auth.currentUser.uid+"_"+context).read();
}
export async function approveEvaluationDraftAndPublish(entry,{reason=""}={}){
  const uid=auth.currentUser?.uid;
  if(!uid)throw Error("Sign in again before approving this evaluation.");
  if(!entry?.ref||!entry?.data)throw Error("Evaluation draft is unavailable.");
  const note=String(reason||"").trim()||
    "Teacher reviewed the system/external evaluation and approved its score and feedback unchanged for publication.";
  if(note.length<15||note.length>3000)throw Error("Teacher approval note must be 15–3,000 characters.");
  await runTransaction(db,async transaction=>{
    const latest=await transaction.get(entry.ref);
    if(!latest.exists())throw Error("Grade missing. Reload before approving.");
    const before=latest.data();
    assertGradeVersion(before,entry.data);
    if(!approvableEvaluationDraft(before))throw Error("This grade is no longer an approvable system/external evaluation draft.");
    const task=await transaction.get(doc(db,"assessments",before.taskId));
    if(!task.exists()||task.data()?.schemaVersion!==2)throw Error("Direct evaluation approval is available only for current V2 assessments.");
    if(typeof task.data().maxScore!=="number"||task.data().maxScore<=0||before.score<0||before.score>task.data().maxScore||
      (before.maxScore!=null&&before.maxScore!==task.data().maxScore))
      throw Error("Assessment score bounds changed. Review this grade before publishing.");
    await verifyGradePublication(transaction,entry.ref,before,{allowTeacherApproval:true});
    const reviewedDraft={...(before.evaluationDraft||{}),teacherReviewed:true};
    transaction.set(doc(collection(db,"grade_revisions")),{
      gradeId:entry.ref.id,studentId:before.studentId,taskId:before.taskId,editorUid:uid,
      reason:"Teacher approved evaluated draft unchanged for publication",
      before:{score:before.score,feedback:before.feedback,published:false},
      after:{score:before.score,feedback:before.feedback,published:true},
      createdAt:serverTimestamp()
    });
    transaction.update(entry.ref,{
      published:true,
      reviewRequired:false,
      reviewPriority:"teacher_approved",
      reviewedBy:uid,
      reviewedAt:serverTimestamp(),
      teacherReviewNote:note,
      evaluationDraft:reviewedDraft
    });
  });
  return true;
}
export async function publishGradeEntries(entries,published,{context,onProgress=()=>{}}={}) {
  const uid=auth.currentUser?.uid;
  if(!uid)throw Error("Sign in again before publishing.");
  const eligible=bulkPublicationCandidates(entries,published);
  if(eligible.length>2000)throw Error("Narrow this batch to at most 2,000 grades.");
  const journal=publicationJournal(localStorage,"Adminerva_publication_"+uid+"_"+context);
  const progress={pending:eligible.map(entry=>entry.ref.id),completed:[],failed:[],published,updatedAt:Date.now()};
  const persist=()=>{progress.updatedAt=Date.now();const saved=journal.write(progress);onProgress({...progress,recoveryAvailable:saved});if(!saved)throw Error("Recovery storage is unavailable. Batch paused; reload grades before explicitly retrying.");};
  persist();
  for(const entry of eligible) {
    if(auth.currentUser?.uid!==uid)throw Error("Account changed. The interrupted batch was retained for review.");
    try {
      await runTransaction(db,async transaction=>{
        const latest=await transaction.get(entry.ref);
        if(!latest.exists())throw Error("Grade missing; reload this row.");
        const before=latest.data();
        assertGradeVersion(before,entry.data);
        if(!bulkPublicationCandidates([{...entry,data:before}],published).length)
          throw Error(Number(before.score)===0?"Zero-score drafts require individual teacher attention before publication.":"Grade is no longer eligible.");
        const task=await transaction.get(doc(db,"assessments",before.taskId));
        if(published&&(!task.exists()||typeof task.data().maxScore!=="number"||task.data().maxScore<=0||before.score>task.data().maxScore||(before.maxScore!=null&&before.maxScore!==task.data().maxScore)))throw Error("Assessment bounds changed or are unavailable. Review this grade before publishing.");
        const legacyReady=published&&legacyReadyDraft(before);
        const aiDraft=published&&approvableEvaluationDraft(before);
        const needsBulkApproval=published&&before.reviewRequired===true;
        if(published&&task.data()?.schemaVersion===2)
          await verifyGradePublication(transaction,entry.ref,before,{allowTeacherApproval:true});
        transaction.set(doc(collection(db,"grade_revisions")),{
          gradeId:entry.ref.id,studentId:before.studentId,taskId:before.taskId,editorUid:uid,
          reason:published
            ?(aiDraft?"Teacher bulk-published AI grade draft unchanged":
              needsBulkApproval?"Teacher bulk-published reviewed draft unchanged":
              legacyReady?"Teacher published legacy clean system draft":
              "Teacher explicitly published a grade draft")
            :"Teacher explicitly unpublished a batch grade",
          before:{published:Boolean(before.published)},after:{published},createdAt:serverTimestamp()
        });
        transaction.update(entry.ref,{
          published,
          ...(legacyReady?{reviewRequired:false,reviewPriority:"ready_to_publish"}:{}),
          ...(needsBulkApproval?{
            reviewRequired:false,
            reviewPriority:"teacher_approved",
            reviewedBy:uid,
            reviewedAt:serverTimestamp(),
            teacherReviewNote:"Teacher approved this grade draft unchanged through the confirmed bulk publication action."
          }:{}),
          ...(aiDraft?{
            evaluationDraft:{...(before.evaluationDraft||{}),teacherReviewed:true}
          }:{})
        });
      });
      progress.completed.push(entry.ref.id);progress.pending=progress.pending.filter(id=>id!==entry.ref.id);
    } catch {progress.failed.push(entry.ref.id);}
    persist();
  }
  return progress;
}
