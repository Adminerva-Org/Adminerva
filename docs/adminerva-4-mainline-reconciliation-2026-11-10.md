# Adminerva 4.0 — mainline reconciliation and controlled-pilot readiness

**Recorded:** 2026-11-10  
**Production boundary:** Adminerva 3.x remains in service. This record is **development integration**, not a Firebase deployment, MCS data migration, School Admin grant, school-state change, or a release.

## Mainline source reconciliation

- Latest synchronized production parent: `4dfde0bff84a8b47b6fdac63f2a3cd2645895a43` (`main`).
- V4 source baseline after the verified integration PRs: `1ca6fdcf98c9f9f06d85f976e86d1915480f4af3`.
- [PR #134](https://github.com/Adminerva-Org/Adminerva/pull/134) integrated latest Gradebook bulk external evaluation, publication/evidence support, mobile Studio controls, pilot backend routes and approved MCS pilot configuration.
- [PR #139](https://github.com/Adminerva-Org/Adminerva/pull/139) restored manual Review & Grade's evidence approval and unmatched commit attribution controls, structured feedback guidance, the visible school-admin pilot link, and the manual-only public Pages release audit.
- Previously missing V4 school-scope import, Gradebook regression fixtures, and mobile school-picker styling were corrected in `main` through [PR #132](https://github.com/Adminerva-Org/Adminerva/pull/132) and [PR #135](https://github.com/Adminerva-Org/Adminerva/pull/135).

### Explicit resolution of remaining branch differences

The Git trees had **zero mainline-only changed files** after PR #134, but 17 files still differed because both branches intentionally edited the same areas. They have been reconciled as follows:

| Area | Preserved integration decision |
| --- | --- |
| `.github/workflows/adminerva-quality.yml` | Ordinary regression/security checks remain automatic; the strict public Pages file-hash release proof runs only by manual dispatch. |
| `css/adminerva-ui.css` | Preserve V4's 44px verified school-picker control and mobile focus treatment. |
| `css/playground-workspace.css`, `student-playground.html`, `js/student/playground.js` | Combine V4's school-scoped Studio and collapsible project explorer with mainline mobile Files/More drawers, editor/terminal single-pane navigation, run, zoom, cursor controls and touch-safe behavior. |
| `gradebook.html`, `js/repo-review/manual-review.mjs`, `repofetch.html` | Keep canonical V4 grading panel alongside current 3.x Gradebook; expose bulk external JSON handoff and manual evidence/attribution recovery with associated handlers. |
| `js/core/adminerva-nav.js`, `school-admin.html` | Keep legacy Gradebook primary while `legacy_allowed`; add specifically labeled V4 pilot routes for verified members only, and a school-admin pilot entry. |
| `js/core/school-ai.mjs`, `js/settings/school-ai-settings.mjs` | Canonical V4 school AI remains server-scoped with verified tenant context; personal connection fallback is permitted only in legacy compatibility before canonical pilot membership is usable. Changed school responses are rejected. |
| `js/lesson-review/ai-engine.js`, `js/student/assessment-evidence.mjs`, `js/repo-review/gradebook-class-review.mjs`, `js/repo-review/gradebook.js` | Keep the latest source integrations from both branches, with V4-specific route and school scoping intact. |
| `student-assessments.html`, `users.html` | Retain legacy student and directory workflow changes alongside canonical V4 pilot links. |
| `tests/loading-and-routes.test.mjs`, `tests/review-resilience.test.mjs`, `js/core/adminerva-nav.test.mjs`, `tests/v4-main-integration.test.mjs` | Assert actionable unavailable states, preserve global-loader behavior, check legacy vs verified pilot visibility, and verify required UI control/handler contracts. |

These intentional V4 differences are not grounds for restoring older legacy code wholesale.

### Validation completed

The isolated V4 integration targeted GitHub Actions workflow passed for the PR #134 integration SHA `7128153f1ae019b16fa604fdf2c53c307b6b1982`; a second targeted run passed for PR #139 at SHA `d8a226e587666879fb86df4af98bbbf953d3de08`. The checks exercise source/module syntax, local asset packaging, the verified-school and teaching contracts, grading resilience and navigation, plus static Gradebook/Studio bindings.

**Not claimed:** pixel-level or full interactive browser acceptance; connected real Firebase teacher/student pilot use; live cross-school denial; actual migration/backup recovery; production deployment. No such proof is represented by these green checks.

## Next controlled MCS SHS pilot

The **first cohort** remains the four reviewed Senior High ICT sections: St. Isidore of Seville (45), St. Carlo Acutis (35), St. Philip the Apostle (45), and St. Anselm of Canterbury (44), currently 169 approved students in the reviewed pilot roster baseline. St. Sebastian and Basic Education are deferred, not deleted or marked inactive.

Complete these protected operator steps **before** starting the pilot:

1. Deploy compatible V4 backend callables and rules only in a controlled, approved deployment window while keeping MCS `legacy_allowed`. Do not activate V4 routes or replace the current teacher Gradebook.
2. Confirm the existing verified MCS teacher account will retain both `school_admin` and `teacher` memberships through the protected owner console. Do not store a Firebase UID or credentials in this public file.
3. Supply the exact academic year identifier and dates in the private pilot operator file. Current July-to-May month defaults are provisional, not calendar certification.
4. Obtain a protected, reviewed legacy mirror and current identity candidates; run the four-section subset plan, human-reviewed approval, read-only preflight and blocker-free subset apply from `docs/adminerva-4-mcs-shs-controlled-pilot-runbook.md`. Retain all legacy and historical records.
5. Start `draft → pilot` only after an explicit operator decision. Enforce `compatibilityMode=legacy_allowed` and `productionAuthorized=false`; verify one authorized student submission, teacher draft/publication, cross-school denial and rollback to draft.
6. Record actual pilot results and unresolved blockers; **do not** enable `v4_only` or publish Adminerva 4.0 from the limited pilot.

Institutional authorization, approved privacy/retention/backup references, a final full-school mapping and the protected cutover package are still required before full production activation. These are not inferred from successful source tests.

## Separate draft work

Draft PRs for alternative/personal pilot sandbox or teacher-facing UI experiments are **not** part of the synchronized mainline ancestry and are not silently merged or deployed. They require separate role/privacy review and acceptance before inclusion in V4.
