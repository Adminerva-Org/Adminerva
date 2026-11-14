# Adminerva production source of truth

Updated: 2026-11-14

## Production rule

The production product is the `main` branch and the existing Adminerva website. Do not create a second V4 application, V4 launchpad, pilot dashboard, or sandbox as the normal user entry point.

**MCS (`mcs-manila`) is the Adminerva 4.0 pilot school inside the production website.** During the pilot it remains `legacy_allowed`; this does not authorize a school-wide `v4_only` cutover or deletion of historical data.

Draft V4 PRs and old pilot/sandbox branches are implementation history. They are not the production source of truth and must not be deployed wholesale over newer `main`.

## Canonical user workflows

### Teacher

- **Teacher Home:** `teacher-home.html`
- **Repository Management:** GitHub/repository assessments, commit evidence and repository grading. Use `assessment-studio.html`, `repofetch.html`, `gradebook.html` and related repository tools.
- **Class Record & Adminerva Assessments:** school-scoped Adminerva assessments and grades. Use:
  - `teacher-assessment-library.html` for authoring/deployment
  - `school-gradebook.html` for Adminerva assessment review/publication
  - `class-record.html` for manual scores, linked published Adminerva results, visibility and grade finalization
- **Lesson Planning:** existing lesson planner, slides, schedule and reference library.

Do not present `school-pilot.html` or `pilot-sandbox.html` as normal teacher workflows.

### Student

- Repository/GitHub work remains explicitly labeled as repository work.
- School-scoped Adminerva work uses `school-student-assessments.html`, `school-student-projects.html`, and `school-student-grades.html`.
- **My Grades** is the canonical student view for teacher-released activity scores and Final Grades.

### School administrator

- **School Administration:** `school-admin.html`
- **People & Access:** `people-access.html` is the canonical place for verified people, memberships, teacher activation, course offerings, enrollments and class assignments.
- **Class Record oversight:** `school-class-records.html` is read-only administration/audit.
- **Grading schemes:** `school-grading-schemes.html`.

Legacy user/teacher/section maintenance pages are not the primary school-admin workflow.

## Class Record readiness

Editable Class Record requires all three conditions:

1. The school is in `pilot` or `active` state.
2. The signed-in staff account has an active verified-school `teacher` role.
3. The teacher has an active assignment to the relevant course offering.

Recovery path:

- If school access is inactive, verify MCS school lifecycle state.
- If Teacher role is missing, School Administration → People & Access → Access → **Activate linked teacher access**.
- If no class appears, People & Access → Classes → assign the active teacher to the course offering.
- School Admin-only accounts use **Class Record oversight** unless they also hold the Teacher role.

## Deployment rule

Firebase Functions/Firestore source on `main` must deploy with `main` backend changes; do not leave production frontend code ahead of its callable backend.

The MCS pilot-state operation is narrowly scoped, idempotent, keeps `legacy_allowed`, keeps `productionAuthorized:false`, and does not alter grades, memberships, enrollments or historical records.

## Deprecated product concepts

The following may remain in source temporarily for compatibility, diagnostics or historical reference, but should not be linked as separate products:

- V4 pilot launchpads
- separate controlled-pilot user workspaces
- private pilot sandbox as a normal teacher destination
- duplicated “4.0 pilot” versions of navigation items

New work must extend the canonical production pages above.
