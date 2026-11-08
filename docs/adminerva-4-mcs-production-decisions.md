# Adminerva 4.0 — Manila Cathedral School production decisions

**Status:** approved product/configuration direction; not yet applied to production.

This file records non-sensitive decisions for the MCS 4.0 cutover. Account identifiers, credentials, API keys, migration payloads and private policy documents must remain in the protected operator workflow and must not be committed to this public repository.

## First school administrator

- The designated first MCS School Administrator is an existing verified MCS teacher account.
- The account must retain the `teacher` role and receive `school_admin` in addition to it. Adminerva memberships are intentionally multi-role; granting School Admin does not replace Teacher.
- The Firebase Authentication UID is intentionally omitted from source control. Enter it only through the protected Platform Owner Console when the production school record is prepared.
- The first administrator grant remains school-scoped and does not grant Platform Administrator authority.

## Academic calendar model

MCS requires more than one period structure inside the same school year.

Initial program/division model:

| Academic program / division | Period structure |
| --- | --- |
| Basic Education | 3 terms per school year |
| Senior High School | 2 semesters per school year |

Adminerva must not hard-code one school-wide period count. The canonical academic catalog supports:

- school-controlled academic programs/divisions;
- academic years;
- program-scoped academic periods with a configurable type (`term`, `semester`, `quarter`, `trimester`, or `custom`) and sequence;
- program-scoped sections;
- subjects; and
- course offerings bound to exactly one program + year + period + section + subject.

A school administrator may change future academic structures by creating/archiving catalog records. Historical offerings, enrollments, assignments, assessments and grades retain their original period/program references.

For migration, legacy sections and period labels must be explicitly mapped to a program. Do not infer Basic Education versus Senior High from a section name without review.

## AI and external repositories

- School AI: **approved**.
- GitHub / external repositories for approved assessment workflows: **approved**.
- Approval does not expose credentials. School AI keys and any repository authorization remain server-side/configured through their protected school workflows.

## Privacy and governance

- Default MCS data steward: `school_admin`.
- Platform Administrators may define separate governance roles (for example a Data Protection Officer or Records Officer) and mark which schools those roles apply to.
- Governance roles document policy responsibility only; they do not automatically grant Teacher, School Admin or Platform Admin application permissions.
- If a custom governance role is selected as a school's data steward, cutover readiness requires that role to exist and be actively assigned to the school.

## Retention

- MCS retention decision: **retain all historical data**.
- Migration must preserve historical people/identity relationships, enrollments, teacher assignments, assessments, evidence, reclaim history, grades/publication history, planning resources and migration provenance unless a later reviewed institutional policy explicitly changes retention.
- Optional school support attachments may use `retentionDays = 0`, meaning retain until the school changes its audited file policy. Abandoned upload reservations still expire automatically.

## Initial 4.0 pilot academic scope — Senior High ICT only

The first canonical MCS pilot configuration is intentionally limited to the Senior High School ICT classes currently handled by the teacher-led pilot. This is **not** a declaration that other MCS divisions, levels or sections are inactive.

Initial program/division:

- **Senior High School**
- period structure: **2 semesters**
- Basic Education: **deferred from the initial pilot configuration**

Initial section scope:

| Level / track | Section |
| --- | --- |
| Grade 11 TechPro (ICT) | St. Isidore of Seville |
| Grade 11 TechPro (ICT) | St. Carlo Acutis |
| Grade 11 TechPro (ICT) | St. Sebastian |
| Grade 12 TVL (ICT), old curriculum | St. Philip the Apostle |
| Grade 12 TVL (ICT), old curriculum | St. Anselm of Canterbury |

For canonical section records, the grade/track remains part of the display name so similarly named sections in another level cannot collide. Basic Education records discovered during migration must remain preserved and explicitly excluded/deferred rather than being marked inactive or silently remapped.

Because the compatibility switch is school-wide, this limited pilot scope does **not** by itself authorize MCS to enter `v4_only`. MCS should remain `legacy_allowed` while these Senior High classes pilot the canonical workflows. A later school-wide cutover requires the remaining active legacy population to be migrated, explicitly excluded as historical-only, or otherwise reviewed by the authorized school administration.

## Academic-year scheduling default

MCS academic-year dates can vary with institutional circumstances. Adminerva therefore uses an editable **July start / May end** month convention as the pilot default rather than hard-coding exact annual dates.

- default start month: **July**
- default end month: **May**
- exact institutional dates may be changed for each academic year by an authorized School Administrator;
- changing a future year's configuration must not rewrite historical offerings, submissions, assessments or grades.

The canonical academic-year catalog stores these as configurable month defaults. Official calendar references and exact dates can be added later when the administration provides them.

## Provisional teaching-staff escalation structure

The teacher-supplied working escalation path is recorded for future governance design:

**Teacher → Strand/Level Leader → Subject Area Coordinator → Senior High Coordinator → appropriate administration/office of concern**

This describes how teaching concerns are commonly escalated; it is **not** an authorization hierarchy and does not grant application permissions. Strand/Level Leader, Subject Area Coordinator and Senior High Coordinator may later become school-defined governance or workflow roles after the administration confirms the official organizational structure. Non-teaching personnel hierarchy remains pending institutional clarification.

## Institutional references currently pending

The teacher-led pilot does not currently have authoritative copies of the institutional/data-processing authority, privacy policy, retention policy, backup/recovery policy or complete organizational chart.

Adminerva must **not fabricate substitute policy documents or mark those approvals as complete**. Their cutover references remain pending until an authorized MCS administrator supplies or approves them. Development and test configuration may continue, but production activation/readiness attestations that depend on these references must remain false.

The existing product decisions still stand: retain all historical data, School Admin is the default data steward, School AI is approved, and approved external-repository workflows are allowed. Those product decisions do not replace institutional policy approval.

## Still required before production activation

These are operational references, not additional product-design decisions:

- institutional/data-processing authority reference;
- exact current academic-year identifier and date boundaries;
- approved calendar reference;
- privacy-policy reference;
- retention-policy reference documenting the retain-all decision;
- backup/recovery-policy reference;
- final mapping of active MCS sections to Basic Education or Senior High School;
- school AI credential/configuration when AI is actually enabled;
- repository authorization/configuration when external repository workflows are activated.

The protected migration and cutover process remains backend-first and reversible. No production migration, role grant, compatibility switch or public 4.0 release is authorized by this document alone.
