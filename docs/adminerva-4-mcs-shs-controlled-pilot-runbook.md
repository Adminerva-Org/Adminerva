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
