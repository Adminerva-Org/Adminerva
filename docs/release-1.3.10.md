# Adminerva 1.3.10 release candidate

This is the cleanup and workflow-consolidation release before the next feature/minor release. It completes the previously planned Playground work and removes unnecessary teacher review fragmentation.

## Teacher workflow

- Repository Management uses one primary **Review & grade** flow instead of separate Evidence, Contribution Inspector, and Group Inspector interfaces.
- The review queue tells the teacher the next useful action for each learner: review submission, grade approved evidence, continue a private grade draft, or view a published result.
- Evidence review, selected diffs, contribution context, system evaluation draft, teacher score/feedback, and publication remain in one workspace.
- Old Evidence Review, Contribution Inspector, and Group Inspector URLs redirect into the integrated workspace while preserving available section, assessment, and student context.
- Submission Inbox distinguishes **Graded draft** from **Published** so a saved teacher draft is not mistaken for a student-visible result.
- Submission Inbox actions adapt to the current lifecycle state and link directly into the selected learner/assessment review.
- Existing reopen/resubmission safeguards remain intact: submitted evidence can be returned for changes, approved evidence must be reopened, and a new submission/approval is required before fresh grading.
- Individual grading continues to rely on verified individual contribution evidence rather than awarding shared repository code automatically.

## Subject-neutral Repository Management

- Teacher access can optionally include a **Subject focus** in addition to assigned sections.
- Sections remain the academic authorization boundary in this release.
- Subject focus narrows Repository Management assessment lists, Submission Inbox, integrated grading, and Gradebook views so teachers do not have to work through unrelated subjects.
- Existing teachers with no subject focus continue to see all subjects available in their assigned sections.
- Assessment Studio now persists the assessment subject, restores it when editing, shows it on assessment cards, and keeps subject-focused teachers within their assigned subject list.
- Subject assignments are audited with the existing teacher-access revision workflow.

## Code Playground

- Project Explorer supports manual ordering for files and folders, including mixed file/folder placement within the same directory.
- Dragging over a sibling shows an insertion line for before/after placement.
- Folder/root drops still move items between directories, with moved items placed at the end of the destination directory.
- Explorer order persists across local drafts, cloud versions, practice scratch work, restores, and shared snapshots.
- Enrolled and guest Playground use the same Explorer ordering behavior.
- Cloud versions can be optionally named when saved, pinned/unpinned, restored, renamed, duplicated, and deleted.
- **Clean up** keeps the newest 10 unpinned versions plus every pinned version and removes older unpinned versions only after confirmation.
- Old pinned versions remain discoverable even after many newer saves.
- Saved source contents remain immutable through version metadata edits.

## Product language and grading safety

- User-facing grading surfaces continue to describe system evaluation drafts without unnecessary AI branding.
- System-generated scoring remains a private draft until teacher review and explicit publication.
- Blank or missing evidence is not treated as proof that a learner earned a zero.
- Group repository context does not establish individual credit by itself.

## Deliberately deferred

- Full subject-level authorization across every academic record is not claimed here. Subject focus is a workspace filter; section assignment remains the security boundary until subject scope is carried consistently by roster, evidence, grades, and supporting records.
- Multi-institution tenancy is a separate architecture project.
- Automatic time-based cloud deletion remains disabled so student checkpoints are never removed without an explicit cleanup action.

## Release handling

The public release manifest remains on **1.3.9** until 1.3.10 is actually deployed.

The matching Firestore rules must be deployed with the frontend because this release adds teacher subject metadata, analytics-roster subject metadata, and cloud Pin/Unpin metadata updates. Duplicate and cleanup use the existing owner-only version create/delete permissions.
