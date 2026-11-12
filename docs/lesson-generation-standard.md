# Adminerva focused lesson-generation standard

## Purpose

Generate concise, feasible weekly curriculum maps/learning plans in the existing Adminerva table and JSON format. The 2026–2027 Q2 Computer Programming 12 Week 6 plan is the writing-density reference, **not** a curriculum source for other topics. Do not copy Q2 Java I/O content into Q3 OOP lessons.

The shared prompt in `js/lesson-review/ai-engine.js` controls both native generation and the external-AI package. Keep their field names and imports aligned.

## Writing standard

| Field | Default target |
| --- | --- |
| Weekly content/performance standards | Reference-grounded; preserve authoritative wording without inventing official competencies |
| Weekly learning materials | 5–8 short, relevant, distinct resources |
| Session competencies | 1–2 |
| Session objectives | 3–4 measurable behavioral objectives, each generally 15–25 words |
| Session motivation | One concise action/strategy sentence |
| Session learning activities | 4–6 substantial, sequential student actions, each generally 12–25 words |
| Session evaluation | 1–2 sentences identifying an observable output/check |
| Session remarks | Only necessary interventions: normally up to two sentences and around 55 words |
| Session Flex | 3–5 optional independent study actions, no fabricated standards or assessment |
| Values integration | Relevant to the formation standard, briefly tied to the topic |

Every activity should describe a meaningful learner action, not one tiny step or a restatement of an objective. Consolidate related steps such as reading, comparing, annotating, coding, and checking into four to six purposeful actions appropriate to the time available.

## Delivery mode

Each normal session now has `delivery_mode`:
- `in_person`: a regular classroom meeting with teacher-configured preliminary and closing activities and standard time allocations.
- `asynchronous`: the session is explicitly assigned as independent study or all affected meetings are suspended/replaced. Use independent reading, code analysis, applied practice, and self-checks. No attendance-taking or minute-by-minute live lesson timetable; exported time cells remain blank.
- `mixed`: delivery differs among the mapped class sections/meetings. Remarks must identify material section-specific distinctions; avoid implying every section met live.
- `Session Flex`: always asynchronous and uses the familiar activities-only format.

Teachers may correct delivery mode in the lesson editor before saving or exporting. Legacy plans without the field remain readable as in-person plans.

## Continuity and reference hierarchy

1. Teacher instructions and their mapped constraints apply only to named sections, dates, and sessions.
2. Selected curriculum references supply competencies and standards; formation references supply the appropriate core value.
3. Prior-week plans identify unfinished or deferred content but **do not** automatically shift an entire week.
4. Carry over genuinely missed content within one or two relevant activities while preserving the current week's planned sequence.
5. The timetable is context for section/date/time mapping, not a source of new learning requirements.
6. Do not invent deadlines, rubric criteria, event cancellations, replacement work, or meetings.

## Q3 Week 6 (November 16–20, 2026): regeneration brief

Use this **only** when regenerating the relevant Computer Programming 12 weekly plan and after confirming the selected timetable and assessment publication data.

- **Session 1:** Unit 13 classes, objects, encapsulation, inheritance, and unfinished class/object foundations from the previous week. The Monday programming meetings are suspended; assign appropriate Quipper independent learning and a manageable Mini PETA 3 preparation step. Set `delivery_mode=asynchronous`.
- **Session 2:** Unit 13 inheritance, polymorphism, abstraction, and individual Mini PETA 3 application. The relevant Tuesday and Wednesday meetings are suspended; set `delivery_mode=asynchronous`. Do not describe the assessment as repository/commit-based.
- **Session 3:** Introduce Unit 14 built-in exceptions, checked/unchecked exceptions, and basic `try-catch`. The Wednesday meeting is suspended while a Thursday meeting proceeds: use `delivery_mode=mixed` if the selected timetable confirms the two situations. User-defined exceptions are a continuation/preview, not assumed fully taught.
- **Mini PETA 3:** A personalized Java console application in Adminerva Studio, evaluated using the published four OOP criteria, five points each (20 points total). Retain the published deadline and submission workflow only when provided in the selected references/instructions.
- **Mini PETA 2:** Do not claim a previously unfinished assessment was completed, replaced, or waived absent explicit teacher direction.
- **Friday:** Do not invent a Friday programming meeting not found in the timetable.
- **Formation:** Use the week's supported Service formation standard, applied meaningfully and briefly.

## Regeneration workflow

1. In Lesson Planner choose the correct school year, quarter, grade, subject, week/date range, section-aware timetable, and reference folders.
2. Review custom instructions for the selected week; give short day/session-specific exceptions (suspensions, carryovers, assessment conditions).
3. Use built-in generation or **Use External AI**. Both now share the same concise package and `delivery_mode` field.
4. Review the editor's delivery modes, activities, and remarks before saving. The new package does not retroactively rewrite an earlier plan.
5. Save a version and export a new Google Doc or PDF. Keep prior documents as historical records until intentionally replaced.
