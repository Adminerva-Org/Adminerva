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
