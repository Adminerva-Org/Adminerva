/** Transactional deliberate publication with immutable revisions and recoverable progress. */
import {auth,db} from "../core/firebase-core.js";
import {doc,collection,runTransaction,serverTimestamp} from "../core/teaching-firestore.mjs?v=1.1.0";
import {assertGradeVersion} from "./services/grade-version.mjs?v=2026.10.20.1";
import {publicationCandidates,publicationJournal} from "./services/publication-queue.mjs?v=2026.10.20.1";
export {publicationCandidates};
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
export async function publishGradeEntries(entries,published,{context,onProgress=()=>{}}={}) {
  const uid=auth.currentUser?.uid;
  if(!uid)throw Error("Sign in again before publishing.");
  const eligible=publicationCandidates(entries,published);
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
        if(!publicationCandidates([{...entry,data:before}],published).length)throw Error("Grade is no longer eligible.");
        const task=await transaction.get(doc(db,"assessments",before.taskId));
        if(published&&(!task.exists()||typeof task.data().maxScore!=="number"||task.data().maxScore<=0||before.score>task.data().maxScore||(before.maxScore!=null&&before.maxScore!==task.data().maxScore)))throw Error("Assessment bounds changed or are unavailable. Review this grade before publishing.");
        if(published&&task.data()?.schemaVersion===2)throw Error("V2 grades require individual reviewed publication.");
        transaction.set(doc(collection(db,"grade_revisions")),{
          gradeId:entry.ref.id,studentId:before.studentId,taskId:before.taskId,editorUid:uid,
          reason:published?"Teacher explicitly published a reviewed batch draft":"Teacher explicitly unpublished a batch grade",
          before:{published:Boolean(before.published)},after:{published},createdAt:serverTimestamp()
        });
        transaction.update(entry.ref,{published});
      });
      progress.completed.push(entry.ref.id);progress.pending=progress.pending.filter(id=>id!==entry.ref.id);
    } catch {progress.failed.push(entry.ref.id);}
    persist();
  }
  return progress;
}
