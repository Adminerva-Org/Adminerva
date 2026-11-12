# CheerpJ Studio — Phases 5 and 6: assessment compatibility and controlled rollout

**Status (November 2026):** Code prepared with activation OFF. Judge0 remains the default. There is no independently deployed CheerpJ host, written institutional license confirmation, or completed live-browser compatibility exercise.

## Phase 5 — Personalized assessment integration

An assignment-linked Student Studio session reports its variant-readiness status:
- loading: fetching assessment metadata or generating the assigned variant.
- not-personalized: valid Studio assessment without an assigned variant.
- ready: server-issued personalized task variant returned successfully.
- unavailable: failed, invalid or inaccessible assessment.

Browser Java cannot launch in an assessment session until that context and practical-exam policies are resolved. It also requires explicit rollout permission for general assessments or personalized assessments, separately.

An issued personalized variant must have a valid variant ID; submitted read-only attempts cannot run in Browser Java until a teacher-requested revision. Practical exams are off by default.

A compact Studio notice states that Browser Java terminal output is for **practice only**. The existing submission transaction, frozen project snapshot, snapshot checksum, rubric, teacher verification, published grades, and variant generator are unchanged. No Java run outputs or input transcript are automatically stored as assessment scoring evidence.

The isolated runner receives only Java source file text and entry path. It does NOT receive the personalized prompt, variant ID, rubric, Firebase tokens, scores, or student/school profile information.

The existing practical exam rules for code copy/paste, imports, history and AI tutoring continue to apply; Browser Java is not a proctoring tool.

## Phase 6 — Controlled and documented activation

The configuration is in js/student/cheerpj-studio-rollout.mjs, defaulting to:
- mode: off
- institutionalUseApproved: false
- pilotUids: empty
- allowGeneralAssessments: false
- allowPersonalizedAssessments: false
- allowPracticalExams: false
- allowGuests: false

Modes:
- off: no Browser Java UI or executions.
- developer_evaluation: named development UIDs only, on ordinary non-assessment Java projects, with the separate host configured.
- licensed_pilot: named UIDs only, after institutional use is approved; assessment categories are individually enabled.
- licensed_general: signed-in users once approved; guest access still requires explicit permission.

The Java engine selection resets to Standard (Judge0) on each new Studio visit, to avoid inheriting another user's pilot choice.

### How to activate after the independent host exists

1. Deploy Cloudflare Pages (or another trusted static HTTPS host) using docs/studio-cheerpj-phases-3-4.md. Verify it is an origin separate from https://adminerva-org.github.io.
2. Set CHEERPJ_STUDIO_RUNNER_URL in js/student/cheerpj-studio-client.mjs to that verified public HTTPS embedded-runner.html address.
3. For developer-only compatibility checks, set mode to developer_evaluation and populate pilotUids with test account UIDs. Assessments are never allowed in technical evaluation mode.
4. Request written confirmation from Leaning Technologies regarding the precise institutional/classroom licensing of Adminerva.
5. After license approval, set institutionalUseApproved true and use licensed_pilot with a small, reviewed pilotUids list.
6. Decide independently when to turn on allowGeneralAssessments and allowPersonalizedAssessments. Keep allowPracticalExams false until school rules are agreed.
7. When pilot behavior is stable, optionally move to licensed_general. Roll back by setting mode back to off.
8. Update the JavaScript cache query in js/student/playground.js and both Studio HTML documents when changing the configuration or runner URL.

These are **frontend rollout toggles, not secure server-side entitlement enforcement**. A public static runner may be visited independently of the Studio UI. A dedicated origin isolates authenticated Adminerva data, but it is not a substitute for a proper sandbox security assessment.

## CheerpJ licensing

Current vendor documentation says that some educational use and technical evaluation are free; it distinguishes organization/operational use and offers academic licensing options. Multi-school operational use by teachers and students must be confirmed with the provider before broad activation.

Sources:
- https://cheerpj.com/docs/licensing
- https://cheerpj.com/docs/faq
- https://cheerpj.com/licensing/

The vendor inquiry should describe intended student/teacher counts, remote use, whether Adminerva is a free or paid service, and that CheerpJ Core is loaded from the official CDN (not self-hosted). No vendor authorization has been obtained.

## Short acceptance exercise

First verify a Hello World Java program, followed by Scanner name+age prompts without restarting the process. Then test two Java files, a compilation error, and stop/restart. For licensed assessment pilots, open a personalized task from My Assessments and confirm the issued variant remains fixed and the project submission is still the only grading evidence. Standard Judge0 must remain selectable.

### Remaining blockers

Separate HTTPS runner host, real-browser multi-input verification, production licensing clearance, and approved pilot-user selection. Until these exist, Student and Guest Studio continue using Judge0. No assessment/grade records were migrated or modified.
