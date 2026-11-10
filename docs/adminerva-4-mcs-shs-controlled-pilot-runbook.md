# Adminerva 4.0 — MCS Senior High ICT controlled pilot runbook

This runbook is intentionally narrower than the school-wide 4.0 cutover. It enables the verified Senior High ICT cohort to use canonical 4.0 workflows while Manila Cathedral School remains legacy-compatible and **not institutionally production-authorized**.

## Pilot boundary

The first operational cohort is:

- Grade 11 TechPro (ICT): St. Isidore of Seville and St. Carlo Acutis;
- Grade 12 TVL (ICT), old curriculum: St. Philip the Apostle and St. Anselm of Canterbury;
- the designated pilot teacher, retaining both Teacher and School Admin roles.

St. Sebastian remains configured as a known section but is outside the first operational migration until a reviewed roster/source is available. Basic Education and unrelated MCS sections are outside the pilot.

The pilot migrates only verified identity/person records, school memberships, the Senior High academic catalog, current semester course offerings, current student enrollments and the pilot teacher's course assignments. Historical assessments, evidence, grades, planning, Practice and other school populations remain on legacy 3.x paths.

## State model

The MCS school record moves through:

`draft → pilot → active`

`pilot` is a non-production operating state. It:

- permits verified canonical school calls for reviewed members;
- forces `compatibilityMode = legacy_allowed`;
- records `productionAuthorized = false`;
- does not satisfy cutover readiness;
- does not substitute for privacy, retention, institutional-authority, backup or official-calendar approval.

Returning `pilot → draft` disables V4 member access without deleting canonical pilot data.

## Controlled sequence

1. Deploy compatible 4.0 backend functions/rules and the opt-in V4 pages without changing existing 3.x routing.
2. Create/verify the `mcs-manila` school draft and designate the verified pilot teacher as the first School Admin. The later foundation migration must preserve School Admin while adding Teacher.
3. Capture/reconcile the protected legacy mirror and generate the read-only Firebase Auth identity-candidate report.
4. Create the protected pilot operator file:
   ```sh
   npm run pilot:operator-template -- --output=/secure/mcs-shs-pilot-operator.json
   ```
   Enter the verified teacher UID only in that restricted file, confirm the current academic-year ID/name, and set the three pilot acknowledgements to `true` after review.
5. Generate the subset foundation plan:
   ```sh
   npm run pilot:foundation-plan -- \
     --reconciliation=/secure/mcs-mirror-reconciliation.json \
     --identity=/secure/mcs-identity-candidates.json \
     --operator=/secure/mcs-shs-pilot-operator.json \
     --output=/secure/mcs-shs-pilot-foundation-plan.json
   ```
   This plan ignores unrelated MCS sections/teachers. It reports only selected-cohort identity blockers and aggregate roster-count differences.
6. Generate the prefilled, still-unapproved foundation review:
   ```sh
   npm run pilot:foundation-approval -- \
     --plan=/secure/mcs-shs-pilot-foundation-plan.json \
     --operator=/secure/mcs-shs-pilot-operator.json \
     --output=/secure/mcs-shs-pilot-foundation-approval.json
   ```
7. Review the file manually. Resolve every identity blocker/review item; approve only the four active sections, current year, two semesters, four Computer Programming subjects and the eight active course offerings. Do not approve St. Sebastian students until its source is available.
8. Run the normal canonical foundation **preflight**. Apply only after the preflight is blocker-free and the protected approval is complete. The apply engine adopts the designated pre-existing School Admin membership and preserves the union of roles.
9. Generate the canonical academic-access plan from the approved foundation. Review every proposed student enrollment and teacher-course assignment, then preflight/apply only the approved pilot relationships.
10. In Platform School Registry, start **Controlled pilot**. Confirm limited scope, legacy compatibility, and non-production status. Only then do canonical pilot members receive V4 school access.
11. Perform only the focused live checks: one student assignment/submission path, one teacher evidence/review path, one grade draft/publication path, cross-school denial, and `pilot → draft` rollback. Avoid broad regression testing.
12. Continue normal 3.x use for all non-pilot and deferred workflows. Do not enable `v4_only`, publish 4.0, or mark institutional attestations approved.

## Pilot expansion

St. Sebastian can be added later without restarting the school-wide migration. Add its reviewed roster/source, rerun a new pilot subset plan/approval for that section, preflight/apply the additional identity and academic-access units, then keep the school in `pilot`.

## Promotion to production

Promotion from `pilot` to `active` is a separate institutional event. It still requires the real authority/calendar/privacy/retention/backup references and activation attestations. A later school-wide migration and successful cutover package are required before `v4_only`.


## Operator handoff — November 10, 2026

**GitHub workflow safeguard:** [PR #141](https://github.com/Adminerva-Org/Adminerva/pull/141) removed the workflow-file-push trigger that previously applied an Admin SDK migration with repository credentials. The replacement workflow `.github/workflows/mcs-reviewed-live-roster-migration.yml` is **manual and read-only**, and has no Firebase credential access or apply operation. Running this preflight does not activate the school pilot or create records. Review the protected migration plan/approval and perform any authorized write operations through the separately restricted operator process; do not invoke `scripts/mcs-shs-pilot-live-execute.cjs` as a shortcut for reviewed approvals.

**Pilot UI and readiness:** [PR #142](https://github.com/Adminerva-Org/Adminerva/pull/142) corrected the stale 167-student page text. The canonical review baseline is **169 approved students** across St. Isidore (45), St. Carlo (35), St. Philip (45) and St. Anselm (44). The pilot overview now derives its count label from the verified response. A `school_admin` must also retain `teacher` to initiate this teacher-led pilot; `productionAuthorized` must remain false, `compatibilityMode` must remain `legacy_allowed`, and changing reviewed roster decisions invalidates an in-progress start. The UI disables duplicate actions and ignores stale page refreshes.

**Important limitation:** Count equality and a green source-level check do **not** prove that all identities, memberships, course enrollments, teaching assignments, and backup snapshots are correctly matched. Before requesting a start, an authorized operator must inspect the protected foundation and academic-access plan/approval receipts and confirm the correct student-to-class and teacher-to-course relationships. Do not enter student names, account identifiers, credentials, or private receipt contents into a public PR.

**Pending live actions:**
- Approve a controlled deployment of the compatible V4 callables/rules and opt-in pilot surfaces while retaining legacy 3.x Gradebook.
- Enter the actual academic-year ID and exact start/end dates in the restricted pilot operator file; July–May are defaults, **not** official dates.
- Verify the first MCS administrator's active, school-scoped `school_admin` **and** `teacher` membership.
- Obtain a current private snapshot/mirror, verified Auth identity candidates, and protected 169-student roster review; preserve both legitimate roster additions and any historical or deferred records.
- Complete the approved preflight and non-destructive target checks before each protected apply stage; record receipts. Do not auto-approve identity, catalog or access mappings from expected counts alone.
- Once canonical data, receipts and deployment are ready, start `draft → pilot` by the designated authorized school administrator and perform only the focused live teacher/student, cross-school denial and rollback checks.

**Current declaration:** Source changes and local/isolated checks have been completed; no live school migration, Firebase backend deployment, membership grant, pilot start, production cutover, or public V4 release is claimed.


## Live technical readiness evidence — November 10, 2026

These are **read-only aggregate results** from approved Firebase Admin SDK reconnaissance; they are not student-level authorization, protected migration approvals or official school policy attestations:

| Reviewed four-section data | Observed |
| --- | ---: |
| Active included learners and verified/reviewed Auth links | 169 / 169 |
| Unresolved current learner links and duplicate Auth links | 0 / 0 |
| Canonical people | 170 (169 students + designated teacher) |
| School memberships | 171 (169 students + designated dual-role teacher + one additional active school-admin-only member) |
| Course offerings / enrollments / teacher assignments | 8 / 338 / 8 |
| Student-to-person and two-course enrollment relationship errors | 0 |
| Teacher-to-offering assignment mismatches | 0 |
| School state / compatibility / production authorization | `draft` / `legacy_allowed` / `false` |

- [Read-only membership composition run](https://github.com/Adminerva-Org/Adminerva/actions/runs/42839187979): the additional account is active, school-scoped and administrator-only; it has no `student` role and no canonical person record. **Do not delete or demote it to satisfy an obsolete exact-count gate.**
- [Read-only academic relationship run](https://github.com/Adminerva-Org/Adminerva/actions/runs/42840919070): all 169 students have matching person records and the correct two academic enrollments; all eight teacher-to-course assignments match the designated pilot teacher.
- [V4 PR #145](https://github.com/Adminerva-Org/Adminerva/pull/145) changes `mcsPilotControl` readiness from “exactly 170 total memberships” to verifying each of the 169 included student grants, the designated teacher/admin grant and the authorization/scope of extra staff members. An unapproved extra student grant still blocks activation.
- [Browser smoke run](https://github.com/Adminerva-Org/Adminerva/actions/runs/42838396034) passed for the pilot readiness page at desktop and 360px mobile widths with fictional accounts only. It checked readiness blockers, refresh failure/retry, account switch and disabled activation. Real teacher/student browser acceptance remains pending.

### Required controlled deployment and operator handoff

1. **Deploy the corrected V4 pilot callable** using the explicitly reviewed and SHA-pinned [manual GitHub workflow](https://github.com/Adminerva-Org/Adminerva/actions/workflows/mcs-v4-pilot-callable-deploy.yml). Its three confirmation inputs must be selected by the authorized operator. It changes only `functions:mcsPilotControl`, not any data, Firestore rules, other functions or frontend.
2. Verify the workflow completes successfully. The prior compatible V4 Firebase backend/rules deployment succeeded, but **that earlier deployment still contains the old membership-count rule** until this targeted callable update is performed.
3. Open the opt-in [MCS controlled-pilot page](https://adminerva-org.github.io/Adminerva/school-pilot.html) with the designated verified teacher/school-admin account. Confirm `169 / 169`, `V4 migration Ready`, extra staff count `1`, `draft`, `legacy_allowed`, and no remaining blockers. These indicators are readiness checks, **not permission to skip review of historical provenance and operator approvals**.
4. Review the protected roster/identity and academic-access application receipts, school permission grant, academic-year dates and backup/recovery reference. The aggregate run cannot establish official approval or a usable backup by itself.
5. Only once the designated school authority has reviewed those references should that account check the three limited-pilot acknowledgements and explicitly choose **Start Controlled Pilot**. Verify the result remains `pilot`, `legacy_allowed`, `productionAuthorized=false`.
6. Keep the public site version `3.0.0` and legacy Gradebook untouched. **Do not** switch to `v4_only`, change official grades, grant every student school-admin rights, import old scores, publish Adminerva 4.0 or mark school-wide cutover complete.

### Focused v4 teacher/student acceptance after activation

Use a clearly labeled *pilot-only assessment* and approved consenting test learners. Check, in order:

1. **School admin + teacher:** opening School Administration and People & Access shows only reviewed MCS scope; the first admin retains both roles; the additional school-admin-only account has no implicit private teacher grading access.
2. **Teacher:** create a teacher-private assessment blueprint, share only with an explicitly chosen teacher if intended, and deploy a clearly marked pilot task to one authorized offering. Record its created assessment ID privately.
3. **Student:** one authorized learner opens the v4 assessment, works in Adminerva Studio, saves, submits and (if requested) resubmits. Confirm the teacher receives the correct frozen revision and the learner cannot inspect someone else's draft/grade.
4. **Teacher evaluation:** review the approved evidence, create a private grade draft, then explicitly publish only the pilot score if appropriate. Verify the student sees the *published* grade, not the private draft. Check a reopened submission cannot silently reuse a stale snapshot.
5. **UI/UX:** repeat the Studio editor/terminal drawer and submission/status checks on a narrow phone viewport. Actions must show loading and recoverable errors rather than appearing stuck; switch school/account only after local unsaved changes are handled.
6. **Boundary/rollback:** verify unauthorized schools and unrelated students are denied. Use the documented `pilot → draft` rollback if any cross-account authorization or grade publication anomaly appears; preserve all data, audit trails and legacy access.

**Technical status:** V4 code and isolated checks are complete; the fixed callable’s targeted deployment and the explicit operator pilot-start action remain outstanding. No pilot activation or real student acceptance is claimed in this document.
