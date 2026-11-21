> **Planning authority:** This document is retained as a technical specification, implementation note, migration reference, or historical plan. The canonical Adminerva product roadmap, development status and future priorities are maintained only in [Adminerva School OS — Master Development Plan](https://github.com/Adminerva-Org/Adminerva/blob/main/docs/adminerva-school-os-master-plan.md). Do not use this file as a competing roadmap or progress tracker.

# Administrator workflow development

### System administration

- Editing automatic maintenance requires a successful policy read. If another administrator saves first, refresh the current policy before editing it again.

- Suspended schools can be restored through the school registry with an explicit recovery reason. The server requires verified platform authority, the exact reviewed school revision, prior production authorization and an active school administrator. Recovery records an audit entry, preserves school policies and compatibility mode, and leaves individually suspended memberships suspended.
- School-specific owner forms reset when a school is selected. Policy decisions and governance assignment remain unavailable until the current school's read succeeds; responses from older selections cannot populate current forms. School selection is locked during an owner write. Global governance-role creation remains available independently of school-specific bindings.

### School administration

- Roster previews bind to the school selected before reading the CSV or fetching the configured Sheet. File changes, source changes and school changes invalidate obsolete previews; old successes and failures cannot replace the current review.
- Import commits capture the reviewed rows and digest and lock file/source controls until completion. A successful import remains marked as committed when a follow-up refresh fails. Failed commits require another preview before retrying.
- Sheet controls reflect saved configuration rather than unsaved URL text. Stale status reads cannot overwrite newly edited URLs. Duplicate supported CSV headers are rejected before calling the server.
- School switching clears person/access forms and class selectors, preventing copied IDs, invitation emails or staff search results from becoming another school's input.
- Enrollment review clears the previous student's number and placement before loading another applicant. Unsaved edits require a discard decision before replacement or school switching. Saves lock the enrollment controls and invalidate older reads; independent queue/registration refresh failures preserve available results.
- Class Record oversight keeps audit history tied to the selected class. An unavailable overview shows a dash for missing counts.

### Validation and delivery

Deploy the updated `platformSchools` backend before exposing the recovery action in the frontend.


### UI architecture and workflow consolidation — 2026-11-21

- Canonical School Administration pages share one compact **Setup → Operate → Monitor** workflow strip so administrators can move among School Profile, Academic Configuration, People & Access, Classes & Scheduling, Enrollment & Registration, Grading, Attendance and Class Record Oversight without returning to an unrelated menu.
- The School Administration dashboard now represents the same eight operational stages, including Attendance Oversight before Class Record Oversight.
- People & Access copy and routing make its ownership boundary explicit: people, account links, memberships, roles and access remain here; teaching assignments belong to Classes & Scheduling; official student placement belongs to Enrollment & Registration.
- Enrollment routing is now based on a server-derived `enrollmentMode` capability. Canonical enrollment is not selected from a Manila Cathedral School ID. The verified-school client scope preserves that server capability before any School Admin page chooses a workflow.
- The existing public MCS enrollment page remains a deliberately isolated pilot adapter. It no longer exports MCS assumptions through the canonical enrollment service, and new online applications persist the public reference shown to the applicant. Historical MCS references are preserved when older records lack that stored field.
- Classes & Scheduling now presents one selected class through focused **Teaching team / Schedule / Roster** panels. Desktop retains the comparative table; narrow screens receive readable class cards and scroll directly to the selected class controls.
- Administrative relationship changes in Classes & Scheduling use an accessible reason dialog rather than browser prompts, while continuing to send the required reason into the audited backend mutation.
- Attendance Oversight retains its desktop table but uses section cards on small screens so submitted/missing state and P/L/A/E/unmarked counts remain readable without horizontal table navigation.
- System Admin information architecture is separate from School Administration. The current platform surfaces are grouped under **Platform Administration**: School Registry, Platform Users, Monitoring & Maintenance and Releases. School-private academic configuration is reached only through explicit Preview/Assist handoffs.
- School Registry includes selected-institution jump navigation for lifecycle, setup, administrators, audit/governance and legacy migration controls; legacy-only controls remain hidden for standard schools.

### Focused validation

- Added a small server capability regression for canonical vs compatibility enrollment mode.
- Added a client-scope regression proving the verified enrollment capability survives tenant selection and defaults safely to compatibility when absent.
- No broad new release suite was added. The changed workflow still relies on the existing authorization, school isolation, enrollment, schedule/conflict and audit protections.
