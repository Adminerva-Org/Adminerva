# Adminerva 1.4.1 release candidate

Adminerva 1.4.1 completes the workflow and reliability work that remained after 1.4.0.

## Reports and support

- Historical report discussions tolerate Firestore timestamps and older date/text representations instead of leaving a counted discussion blank.
- Comment controls match the authorization model and show explicit loading/error states.
- Existing support-packet copy/export, test-report marking, locking and closing workflows are retained.

## Branding and navigation

- The shared header uses the Adminerva brand asset rather than the notification badge.
- Shared teacher chrome is more compact.
- Repository Management's secondary navigation can be collapsed on desktop and remembers the teacher's choice.
- Class Results and Practice & Learning share the same centered analytics width.

## Gradebook single-assessment workflow

- Single Assessment is the primary Gradebook view.
- Each learner shows the next relevant workflow state: not submitted, submitted, needs review, approved, evaluation ready, graded draft, published, returned or withdrawn.
- Legacy submission receipts are included in the same class console.
- V2 evidence reads are constrained to the selected assessment and authorized section.
- Bulk checkpoint approval and bulk evaluation remain V2-only and retain their existing evidence safeguards.
- Exceptions and individual confirmation continue in Review & Grade.

## Release announcements

- Website-update push remains opt-in per account/device.
- Administrators can send the newest published release announcement after publication.
- A release version can be claimed only once for announcement delivery so repeated button presses cannot create duplicate blasts.

## School administration and settings

- Support/report triage is surfaced directly from Administration Overview.
- Existing role settings, notification preferences, privacy links and guest preferences remain in place; no new role model or data migration is introduced.

## Deployment requirements

Deploy the frontend, Firestore indexes and Cloud Functions together. The public site-release manifest and this release's public patch-history record must stay on 1.4.0/draft until the deployment is intentionally published.

Focused release checks should cover:
1. opening a report containing an older comment,
2. loading Single Assessment for both legacy and V2 assessments,
3. section-scoped V2 evidence access for an ordinary teacher,
4. the release-announcement duplicate guard,
5. shared navigation/logo rendering on teacher and student pages.
