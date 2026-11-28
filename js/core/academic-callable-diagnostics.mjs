/** Optional diagnostic envelope for a fixed list of canonical academic writes.
 * The callable payload/result and school-scope checks remain owned by its caller.
 * Never transmit scores, evidence, student identifiers or free-form error text.
 */
const WRITES=Object.freeze({
  "schoolAssessmentSubmissions": {
    "save_draft": "assessment_draft_save",
    "submit": "assessment_response_submit",
    "request_revision": "assessment_revision_request"
  },
  "schoolStudioSubmissions": {
    "request_revision": "assessment_studio_revision_request"
  },
  "schoolGithubEvidence": {
    "submit": "assessment_github_submit",
    "request_revision": "assessment_github_revision_request"
  },
  "schoolGradebook": {
    "save_draft": "gradebook_draft_save",
    "publish": "gradebook_publish",
    "publish_task_drafts": "gradebook_bulk_publish",
    "correct_published": "gradebook_correct",
    "convert_legacy_scalar": "gradebook_legacy_convert",
    "convert_legacy_published": "gradebook_legacy_published_convert"
  },
  "schoolClassRecord": {
    "save_scheme": "class_record_scheme_save",
    "archive_scheme": "class_record_scheme_archive",
    "restore_scheme": "class_record_scheme_restore",
    "save_layout": "class_record_layout_save",
    "save_manual_scores": "class_record_scores_save",
    "save_cell_status": "class_record_status_save",
    "finalize_period": "class_record_finalize",
    "release_final_grade": "class_record_release",
    "withdraw_final_grade": "class_record_withdraw"
  },
  "schoolClassRecordAdmin": {
    "approve_legacy_custody": "class_record_custody_approve",
    "revoke_legacy_custody": "class_record_custody_revoke"
  }
});
const CODES=new Set(["cancelled","unknown","invalid-argument","deadline-exceeded","not-found","already-exists","permission-denied","resource-exhausted","failed-precondition","aborted","out-of-range","unimplemented","internal","unavailable","data-loss","unauthenticated"]);
export function observedAcademicCallable(service,call){
  return async input=>{
    const actions=Object.hasOwn(WRITES,service)?WRITES[service]:null;
    const name=actions&&Object.hasOwn(actions,input?.action)?actions[input.action]:"";
    if(!name)return call(input);
    let finish;
    try{finish=globalThis.AdminervaDiagnostic?.beginProcess?.(name);}catch{}
    const report=(success,error)=>{
      try{
        const raw=String(error?.code||"");
        const code=raw.startsWith("functions/")?raw.slice(10):raw;
        finish?.(success,CODES.has(code)?code:"unknown");
      }catch{}
    };
    try{
      const response=await call(finish?.correlation?{...input,_diagnostic:finish.correlation}:input);
      report(true);return response;
    }catch(error){report(false,error);throw error;}
  };
}
