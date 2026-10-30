# Adminerva 4.0 — Teacher ownership, private resources and explicit sharing

**Status: planning only.** Teacher-owned work is a separate permission boundary beneath the school boundary. Source gap: current `firestore.rules` assessment read permits `ownerUid` OR overlapping `sectionIds`; `assessment_private`, evidence and Studio submission reads also rely partly on shared section. Replace this access model for v4.

## Core rules

1. Teacher-created assessment blueprints, rubric templates, tests, lesson plans, presentations, teaching reference files, repository setups and workspaces are **private to their verified creator/owner by default**, even if colleagues teach the same section.
2. Each resource has immutable `schoolId`, `creatorUid`, persistent `ownerUid`, createdAt, revision and visibility. Owner may change visibility within the school; author attribution never changes. No automatic sharing based on section membership, email domain or role.
3. A teacher can select **Share with specific active teachers at this school** or **Share with all active teachers at this school**; these recipients get only **read and make a separate copy** by default. They cannot alter the original, see student evidence/grades, publish in the author's class, or share onward. Link possession is never authority.
4. Optional explicit, separately audited grants: `coedit_draft` (not already deployed immutable version), `review_students` for a specific deployed class assessment, and `publish_grade` for a specific authorized reviewer. **Content access and academic grading authority are independent.**
5. School admins manage personnel/course authorizations but **do not automatically inspect private teacher drafts**. Emergency account recovery and teacher departure transfer require reason, narrow grant, audit, creator attribution and preservation of students' records. Platform owner never gets blanket private teacher data merely by being owner.
6. School owns the institutional academic record: students' submissions, frozen evidence, grades, revisions and class deployments are governed by school/class review rights, not deletable personal documents of departing staff.

## Permission matrix

| Actor | Private original | Shared template | Edit original | Make copy | Deploy | Review/publish grades |
| --- | --- | --- | --- | --- | --- | --- |
| Teacher creator/owner | Yes | Yes | Yes | Yes | Assigned offerings only | Only authorized class tasks |
| Same-school teacher without grant | No | School-wide share only | No | Only if granted | Own authorized copy | Independently assigned/delegated only |
| Specifically shared same-school teacher | Via active grant only | Yes | No by default | Yes | Own copy into own offerings | Not from template share |
| Explicit draft coeditor | Via active coedit grant | Yes | Editable draft with revision checks | If granted | No, unless own separate task | Not from coedit alone |
| Teacher in another school | No | No | No | No | No | No |
| School admin | No by default | Only authorized school library | No by default | If specifically authorized | No by office alone | Formal authorized school oversight only |
| Platform owner | No by default | No by default | No | No | No | No |
| Student | No | No | No | No | No | Only their own published results |

## Proposed data contract

- `schools/{schoolId}/assessment_blueprints/{resourceId}`: `creatorUid`, `ownerUid`, `visibility: private|selected_teachers|school_teachers`, `contentRevision`, `aclRevision`, author and non-student blueprint content.
- `schools/{schoolId}/resource_grants/{grantId}`: server-controlled `resourceId`, resource type, grantee UID, authorized actions, active/disabled, expiry, grant revision, actor UID/time/reason and school ID.
- `schools/{schoolId}/assessments/{id}`: protected published task/deployment record linked to creator-owned blueprint version, frozen rubric and specific course offering; grades and submissions separately protected.
- `schools/{schoolId}/review_delegations/{id}`: school + assessment + course offering + reviewer UID + permissions (review vs publish) + expiry and grant revision.
- `schools/{schoolId}/teacher_resource_index/{uid}/items/{id}`: optional derived index for fast private/shared tabs, **not an independent grant authority**.

**Important:** implement queryable ownership/share indexes rather than listing every school assessment then hiding non-shared rows client-side. All direct Firestore access, Admin SDK Functions, exports, file attachments, grading queues and review links enforce school + owner/ACL and academic course rights. A published task's student-facing content must be separate from the teacher's answer key and confidential notes.

## Workflows

**Create:** Teacher A creates an assessment; server sets owner A and private visibility; only A's "My Assessments" shows it. A may deploy to assigned course offerings.

**School-wide share:** Teacher A opens the card's More → Share; choose "All teachers at Manila Cathedral School", preview the actual reusable content, grant view/copy, confirm and audit. A colleague may preview and create their own copy, but not view A's students, grade drafts or confidential solutions.

**Specific-teacher share:** Teacher A selects "Specific teachers" and picks from an active, **same-school verified directory**. The recipients see the template under "Shared with Me" and receive properly scoped notification. Removing a recipient revokes future original accesses.

**Reuse:** Teacher B selects "Make a copy", which creates a *new* blueprint owned by B with immutable `copiedFromSchoolId/resourceId/revision` provenance. B selects only their own assigned course offering for deployment. Existing student results, teacher notes, tokens, solution secrets and review permissions do not copy. When A edits/revokes original, B's independent copy remains stable.

**Coedit:** Optional limited grant for edit of a predeployment draft. On concurrent edits require revision precondition, compare/recover instead of last-write-wins; never rewrite frozen student task versions.

**Co-review:** Teacher A or authorized school academic manager delegates a particular deployed course task to a same-school co-teacher. Separate reviewer approval and optional grade-publication grant; revocation affects future edits, not published grades.

**Owner leaves or is disabled:** School admin uses audited "Transfer content owner", "Copy to school resource library" or "Archive" after verifying responsibility. Private material is not automatically disclosed; school-owned deployed tasks and historical grade/evidence remain available to authorized course successors.

**Legacy MCS migration:** verified `ownerUid` is carried forward; formerly section-visible colleague blueprints become private by default, without deleting legitimate student deployed tasks. Ownerless records enter a *read-only ownership review queue*; do not assign authorship to the platform owner, first teacher or last grader. Academic records remain readable by authorized reviewers under separate deployment policies. Explicit owner claim requires provenance and audit.

## Mobile-first assessment UI

Assessment Studio adds **My Assessments (default)**, **Shared with Me**, **School Library**, **Archived**. Compact card shows owner, privacy badge, subject, task version, last update and one action. Owner: Edit / Deploy / Share / Archive. Recipient: Preview / Make Copy. School admin: only resources granted to their school-level role; no hidden all-teacher switch. Use a full-height accessible sharing sheet on 320 px: audience radio options, same-school teacher search, selected chips, rights summary, confirm, pending/success status, revoke option. Teacher's active-school selector remains hidden if only one school membership.

## What-if release blockers

- B teaches same section but A's resource is private → B cannot list/get it, its private rubric or attachments.
- B is specifically shared a template → B may preview/copy but not read A's grades/submissions, edit origin or deploy origin.
- A makes resource school-wide → teachers within that school only; teachers from other schools cannot see it even with forwarded URL.
- A revokes B while B edits/copies → new operation checks current ACL; no stale privileged write or partial copy.
- Same course/subject across schools → school isolation takes precedence over every resource share.
- Teacher disables account, class handover or school transfer → no lost student records, no abandoned grades, no silent private-document ownership transfer.
- School admin or platform owner attempts to browse all private teacher drafts → denied unless independently authorized and audited.
- Teacher copy/clone of assessment → no student identities, grades, private notes, API keys or teacher review rights included.
- Two coeditors race → version conflict and recovery, never silent overwrite.
- Changing template share rights cannot alter existing frozen deployed rubric, evidence history or published grades.

**Engineering prerequisites:** #104 server grants, #105 legacy MCS migration, #106 LMS/gradebook restructuring, #107 school operations, #108 mobile UX.
