# Adminerva Class Record

Status: implemented on `main` for the school-scoped teacher workflow.

## Purpose

Class Record is the consolidated academic record for one **course offering**. It is deliberately separate from Repository Management.

A Class Record column can represent:

1. a **manual score** entered by the teacher for work completed outside Adminerva; or
2. a **linked Adminerva assessment** whose published score is read from the assessment's owning grading workflow.

Class Record does not become a second assessment grading engine. Linked assessment cells are read-only.

## Score-source boundary

### School-scoped assessments

School/V4 assessments are graded in the school Gradebook. Class Record consumes only records whose school grade status is `published`.

Flow:

`Assessment → evidence/submission workflow → school Gradebook → published score → Class Record`

### Personalized Adminerva Studio assessments

The current MCS compatibility implementation uses the legacy schema-v3 Studio assessment collections. Personalized work is graded from the learner's exact server-issued variant and frozen Studio project snapshot.

Flow:

`Personalized task → frozen Studio submission → Studio grading → published Studio grade → Class Record`

Repository Management is not part of this flow.

During the MCS compatibility period, Class Record maps the school person record to the legacy student row through the verified Firebase Auth identity. Only published legacy Studio grades are projected into the Class Record. This bridge is restricted to the MCS compatibility school and is not a general cross-tenant legacy-data mechanism.

Future school-scoped Personalized assessment formats should publish through their own school grading workflow and then appear as the normal school assessment source.

For school-scoped deployed assessments, the teacher Assessment Library exposes an **Add to Class Record** action. It deep-links to the assigned offering and preselects the deployed assessment, but it does not create a column automatically; the teacher still confirms the Class Record label and category before saving.

## Column lifecycle

Each column has a stable `columnId`.

Supported column behavior:

- label/category editing;
- active column reordering;
- safe archive/restore;
- manual or assessment-linked source;
- immutable score-source semantics after creation.

An existing column cannot silently change from manual to assessment, switch assessment sources, or change the meaning of its maximum score. Create a new column when the scoring source changes.

Archiving is preferred over deletion. Archived columns retain their saved scores and assessment provenance but are excluded from current calculations and exports.

Historical assessment-linked columns retain their source snapshot even when the original assessment later closes, archives, or is no longer linkable. New columns can link only to a currently authorized/linkable assessment.

If a linked assessment's published maximum later differs from the locked Class Record column maximum, that score is excluded from live grade calculations and server finalization is blocked. The teacher can archive the historical column and link the same assessment again as a new active column using its current maximum; archived copies do not prevent this recovery path.

## Manual score import

Manual-score import accepts CSV or tab-separated text for one manual column at a time.

Import is intentionally staged:

1. choose the manual column;
2. upload/paste the values;
3. Adminerva matches an exact student display name or canonical person ID;
4. imported values appear as unsaved changes in the normal Class Record cells;
5. the teacher reviews them;
6. the teacher explicitly saves manual scores.

Blank imported scores are ignored so an import cannot erase an existing score accidentally.

## Categories and grade computation

Categories are teacher/school-defined text labels such as Written Work, Performance Task, and Quarterly Assessment.

For each active category:

`Percentage Score = category earned points / category maximum points × 100`

`Weighted contribution = Percentage Score × category weight`

`Initial Grade = sum of weighted contributions`

A live computed grade is available only when:

- every active column has a category;
- every active category has a configured weight;
- active category weights total 100%;
- every active learner has a finalized score in every active column.

Missing scores are never treated as zero.

Supported period-grade computation modes:

- `raw_weighted`: Period Grade = Initial Grade
- `deped_60_100`: Period Grade = 60 + (Initial Grade × 0.40)

The transmutation mode must be selected only when it matches school policy. Adminerva does not hard-code universal category weights.

## School grading schemes

School administrators can manage reusable grading schemes.

A scheme contains:

- name and optional description;
- category weights totaling exactly 100%;
- period-grade computation mode;
- optional applicability to a specific academic program/division, subject, and/or period type;
- active/archived state;
- revision number.

An empty applicability scope means **school-wide**. Teachers only see active presets that match the selected offering. The server validates the same program, subject and period-type scope before accepting a newly applied preset, so stale browser state cannot apply an incompatible scheme.

When a teacher applies a scheme, Adminerva copies the current scheme into the Class Record as a **versioned snapshot**:

- `appliedSchemeId`
- `appliedSchemeRevision`
- `appliedSchemeName`
- copied weights and formula

Later administrator edits do not silently recalculate an existing Class Record. The teacher must explicitly apply the newer scheme revision.

If the Class Record category set does not exactly match the selected preset, matching weights may be staged as a custom setup, but the class is not marked as using that preset revision.

## Live record vs finalized period

The table is the **live working Class Record**.

Period finalization is a separate server-computed snapshot. The browser is not trusted to submit final grades.

Before finalization, the server recalculates from:

- saved manual score documents;
- published linked assessment grades;
- active Class Record columns;
- current category weights/formula;
- active roster.

Finalization is blocked if any required score/setup is incomplete or if a linked assessment maximum no longer matches the Class Record column.

A source digest records the exact active grade inputs and settings. If any active source score, roster membership, column definition, or grading setup later changes, the live record is marked as changed relative to the latest frozen revision.

Finalization writes:

- current header: `schools/{schoolId}/class_record_finalizations/{offeringId}`
- immutable header revisions: `.../revisions/{revision}`
- current per-student period grade: `schools/{schoolId}/class_record_period_grades/{gradeId}`
- immutable per-student revisions: `.../revisions/{revision}`
- Class Record audit event

Each student snapshot includes the category breakdown, Initial Grade, Period Grade, source digest and finalization revision.

The frozen finalization header also snapshots the human-readable academic context — program/division, school year, academic period name/type, subject and section — so an old finalization remains intelligible even if catalog labels are renamed later.

A changed live record is not allowed to rewrite an old frozen revision. The teacher creates a new finalization revision.

Finalization is currently teacher-side academic recordkeeping. It is **not automatically student-facing publication or report-card release**.

## Shared teacher ownership and handover

Class Record belongs to the course offering, not to an individual teacher UID.

Every active teacher assigned to the offering works with the same Class Record. The UI shows the current active assigned-teacher set.

Consequences:

- co-teachers see the same worksheet;
- a teacher handover does not create a new record or lose prior scores;
- layout writes use sheet-revision concurrency checks;
- finalization uses sheet/finalization revision checks;
- audit records retain the acting teacher UID;
- when a teacher assignment ends, that teacher loses Class Record access while the offering record remains.

## Exports

The live working record supports:

- CSV export;
- native `.xlsx` export generated locally in the browser;
- landscape print output labeled as a **live working record**.

Frozen finalization revisions support independent CSV, Excel and print output. Frozen printouts are labeled with their finalization revision and use the academic-context snapshot stored with that revision, so a later live change does not alter an old exported or printed period record.

## Current storage

Primary school-scoped records:

- `class_records/{offeringId}` — layout, settings, scheme snapshot, revision
- `class_record_scores/{id}` — manual score cells
- `class_record_audit/{id}` — layout/manual/finalization audit events
- `grading_schemes/{schemeId}` — school presets
- `grading_scheme_audit/{id}` — preset audit events
- `class_record_finalizations/{offeringId}` — current frozen period header
- `class_record_period_grades/{id}` — current frozen per-student period result

All paths above are below `schools/{schoolId}/`.

## Deliberate non-goals

Class Record does not:

- grade GitHub commits;
- grade Studio source code directly;
- replace Repository Management;
- allow manual edits to an assessment-owned published score;
- treat missing grades as zero;
- automatically change existing class grades when a school preset changes;
- hard-delete scored columns;
- automatically publish finalized period grades to students.

Those boundaries should remain explicit when new assessment formats are added.