/**
 * CheerpJ controlled activation policy.
 *
 * Default OFF: no runner origin, no pilot accounts, no institutional license
 * clearance. This is a client-side rollout / UX control, NOT an access-control
 * boundary or proof that Java code is safe. The isolated runner must remain on
 * another HTTPS origin and must not receive Firebase tokens.
 *
 * Modes:
 *   off                => production default
 *   developer_evaluation => named development accounts only, no assessments
 *   licensed_pilot     => named accounts, institutional license reviewed
 *   licensed_general   => signed-in users, institutional license reviewed
 *
 * Before changing any value, review docs/studio-cheerpj-phases-5-6.md.
 */
export const CHEERPJ_STUDIO_ROLLOUT = Object.freeze({
  mode: 'developer_evaluation',
  institutionalUseApproved: false,
  // Instructor-only technical evaluation. This allowlist is a public UI gate,
  // not security authorization; assessments remain blocked.
  pilotUids: Object.freeze(['7GE8DNztS9fBCCP4hCibtVkK2Q72']),
  allowGeneralAssessments: false,
  allowPersonalizedAssessments: false,
  allowPracticalExams: false,
  allowGuests: false,
});

const fail = reason => ({ enabled: false, reason });
const allow = () => ({ enabled: true, reason: '' });

/**
 * Pure admission decision used before exposing Browser Java or running code.
 * A personalized variant's prompt, grading rubric and student identity are
 * never passed through to the CheerpJ runner.
 */
export function evaluateBrowserJavaAccess({
  policy = CHEERPJ_STUDIO_ROLLOUT,
  runnerReady = false,
  uid = null,
  guest = false,
  assessmentId = null,
  assessmentContext = null,
  examPolicyPending = false,
  practicalExam = false,
} = {}) {
  const mode = policy?.mode ?? 'off';
  if (mode === 'off') return fail('Browser Java is not activated for Adminerva Studio.');
  if (!runnerReady) return fail('Browser Java needs a separate HTTPS execution host.');
  if (!['developer_evaluation', 'licensed_pilot', 'licensed_general'].includes(mode)) {
    return fail('Browser Java activation mode is not recognized.');
  }

  // Developer evaluation does not include operational classroom assessments.
  if (mode !== 'developer_evaluation' && policy.institutionalUseApproved !== true) {
    return fail('Institutional CheerpJ use has not been approved for activation.');
  }
  if (!uid && !guest) return fail('Sign in to use the browser Java pilot.');
  if (guest && (mode !== 'licensed_general' || policy.allowGuests !== true)) {
    return fail('Browser Java is not available in Guest Studio for this pilot.');
  }
  if (mode !== 'licensed_general' && (!uid || !Array.isArray(policy.pilotUids) ||
      !policy.pilotUids.includes(uid))) {
    return fail('This account is not included in the browser Java pilot.');
  }
  if (mode === 'developer_evaluation' && assessmentId) {
    return fail('CheerpJ technical evaluation is limited to non-assessment projects.');
  }
  if (!assessmentId) return allow();
  if (guest) return fail('Assessment runs require an authenticated student account.');
  if (examPolicyPending) return fail('Assessment rules are still loading. Standard (batch) execution is available.');
  if (!assessmentContext || assessmentContext.assessmentId !== assessmentId ||
      assessmentContext.status === 'loading') {
    return fail('Waiting for assessment instructions before enabling Browser Java.');
  }
  if (assessmentContext.status === 'unavailable') {
    return fail('Assessment instructions are unavailable. Reopen the assignment.');
  }
  if (!['ready', 'not-personalized'].includes(assessmentContext.status)) {
    return fail('Assessment status is not ready for browser execution.');
  }
  if (practicalExam && policy.allowPracticalExams !== true) {
    return fail('Browser Java is not enabled for practical exams in this pilot.');
  }
  if (assessmentContext.personalized === true &&
      policy.allowPersonalizedAssessments !== true) {
    return fail('Browser Java is not enabled for personalized assessments in this pilot.');
  }
  if (policy.allowGeneralAssessments !== true && assessmentContext.personalized !== true) {
    return fail('Browser Java is not enabled for this assessment in the pilot.');
  }
  if (assessmentContext.personalized === true && !assessmentContext.variantId) {
    return fail('Your individual task variant has not been issued yet.');
  }
  if (assessmentContext.personalized === true && assessmentContext.readOnly === true) {
    return fail('This personalized attempt is already submitted. Reopen it after a teacher-requested revision.');
  }
  return allow();
}
