# Adminerva 1.3.0 — Release record

Released 23 October 2026 (Asia/Manila).

## User-visible changes

- One class/assessment/group-or-individual review workspace with inline inbox, source, contributions, evidence, grading and repository-free activity marking.
- Central school choices across schedule, lesson planning and admissions; administrator teacher-plan browsing and clearly labeled school-year filtering.
- Persistent Firebase sessions and recoverable access errors; public guides return to the appropriate workspace.
- Shared server-side school AI connection, existing administrator connection reuse, per-teacher limits and bounded school concurrency. No school key is returned to teachers.
- 300-mission Practice Lab with five activity types, a new difficulty-based points season and optional public alias ranking. Older completion records remain separate history.
- Current-season class reports for assigned teachers; private class standings in the Lab.
- Shared student/guest project editor, file/folder organization, ZIP import/export and bounded compiler execution.
- Improved XML learning preview with device tools, component/property editing, sibling anchors, templates and local resources.
- Simpler assessment authoring, optional instructions, prepared rubric, advanced controls disclosure, home search/continuation/interaction and settings-based notification preferences.

## Administrator startup

Open Manage Teachers after publication. Safe setup is idempotent: it restores missing original-teacher sections, projects safe teacher rosters and copies lessons with verified owner metadata. Existing explicit assignments and disabled access are preserved. Legacy records without trustworthy ownership metadata remain selectable for explicit administrator confirmation; different saved owners are blocked.

The first authorized school-AI request reuses the administrator's previously saved Gemini connection if no school configuration exists. An existing disabled or customized school connection is never overwritten. Connections settings can change the model and limits or disable the service.

## Practical boundaries

- XML is a browser learning approximation, with unsupported Android behavior explained in the interface.
- Remote compilation depends on the compiler provider; cancellation stops waiting, and a submitted remote job may still finish.
- Visitor drafts are local. Cloud operations and ranked answers require the appropriate signed-in access.
- Mistakes reduce only the current mission's possible completion reward. Running code and service failures do not deduct points.
- Unverified legacy ownership is never inferred from a display name.

## Release checks

At the user's request, no automated runtime, browser or emulator tests were added or run. Release packaging checks parse JavaScript and resolve local modules/assets. Firebase deployment compiles rules and loads backend handler definitions. The existing broader validation workflows remain available manually.
