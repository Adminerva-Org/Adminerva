# Adminerva 1.4.3

**Reliable class review and refreshed Adminerva**

Published October 25, 2026 (Asia/Manila). This cumulative release contains the changes since public version 1.4.0. The unpublished 1.4.1 and 1.4.3 maintenance drafts are consolidated here; no intervening public release is fabricated.

More reliable class review, evidence gathering and grading, clearer mobile layouts, consent-based usage analytics, refreshed owl branding, and stronger release checks.

- **Class review:** Single Assessment is the primary Gradebook workflow, combining legacy submission receipts with section-scoped evidence, grades and publication status.
- **Evidence gathering:** Gather missing evidence within the assessment window without overwriting saved student work. Project checkpoints remain distinct from verified individual contributions.
- **Bulk evaluation:** Re-evaluate eligible unpublished system drafts while preserving earlier results, stop after the current learner, and inspect complete exception lists. Teacher edits and published grades remain protected.
- **Evidence accuracy:** Corrected repository matching and stale source paths, improved original-commit and merge-context evaluation, and made large-diff limits explicit. Shared project code alone does not establish individual credit.
- **Review reliability:** Restored Gradebook bulk actions and Review & Grade, fixed a class-grid loading race, simplified RepoFetch setup, and open the review editor when it is ready.
- **Reports and administration:** Historical report discussions render reliably, comment controls follow ownership, and Administration Overview makes support triage easier to find. Administrator release announcements prevent duplicate delivery for the same version.
- **Analytics and privacy:** Anonymous product-usage analytics requires consent and can be controlled in Account settings. Names, emails, learner identifiers, repository links, commit references, grades, feedback and URL query values are excluded; advertising signals are disabled.
- **Account safeguards:** Staff settings and administration views wait for verified access, and connection settings hide stored credentials. Section-based authorization remains in place.
- **Responsive interface:** Gradebook uses clearer mobile cards, feedback opens in a centered dialog, and shared layouts have more consistent spacing and navigation. Homepage motion respects reduced-motion preferences.
- **Adminerva branding:** The supplied transparent owl and circular emblem now appear across navigation, public pages, sign-in, study-owl controls, notifications, browser icons and installed-app icons.
- **Evidence and release reliability:** Valid discovery, approval, reopening, withdrawal and resubmission work with up to twenty selected commits while preserving access restrictions and immutable history. Quality checks now run before updates are merged.

## Release evidence

- Last public release baseline: [371d22a — Publish Adminerva 1.4.0 release metadata](https://github.com/Adminerva-Org/Adminerva/commit/371d22ad09fb9f76851a248f345108d25b194cff).
- Required backend deployment completed successfully at [ef02fd8](https://github.com/Adminerva-Org/Adminerva/actions/runs/40195702986): Firestore rules and indexes released, with unchanged Functions retained.
- Branding merged through [PR #77](https://github.com/Adminerva-Org/Adminerva/pull/77), following the verified CI repairs in [PR #72](https://github.com/Adminerva-Org/Adminerva/pull/72).
- The release is published through the website release manifest and public patch history after the backend deployment gate. Pages deployment verifies that live content matches the released source.
- Release publication does not send a device-push announcement; that remains a separate administrator action.
