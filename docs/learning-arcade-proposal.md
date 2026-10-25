# Learning Arcade — current foundation and future mechanics

## Recommended shape

One Arcade hub with eight small replayable mechanics is easier to learn and
maintain than eight unrelated applications. Reuse the mechanics with subject
packs rather than mixing unrelated subject scores into a single leaderboard.
Start with programming; teachers can later approve Mathematics, Science,
English, Filipino, Social Studies, media literacy and entrepreneurship packs.
These are configurable content proposals, not an official curriculum mapping.

| Replayable game | Learning loop | Example challenge |
| --- | --- | --- |
| Bug Detective | Find a defect, repair it, explain why | Fix an off-by-one loop; seeded examples change the boundary |
| Trace Quest | Predict state, reveal the trace, try again | Follow variables, conditions and output through a short program |
| XML Layout Rescue | Repair attributes and inspect the preview | Restore readable labels and a supported parent-edge constraint |
| Algorithm Maze | Arrange commands and test a route | Use a loop instead of repeating movement blocks |
| Logic Circuit | Build and test a decision | Make a truth table satisfy a set of rules |
| Data Detective | Query or classify fictional records | Choose the filter that answers a question without exposing private data |
| Safe Inbox | Investigate a fictional message | Spot phishing signals and choose a safe response |
| Interface Repair | Compare a broken interface with an accessible target | Fix a label, responsive width or keyboard action |

Every round should provide the failed rule, a small counterexample, a hint and
an explanation, not just a red/green answer. Prefer short deterministic checks
over an external evaluation request for every play. Code execution must stay
sandboxed; do not execute arbitrary student code with server privileges.

## Four student-only progression campaigns

1. **Debugging Case Files:** unlock a connected case after explaining the previous
   repair. Revisit earlier cases without farming completion XP.
2. **Build-a-Project:** complete a sequence of small components, then inspect how
   they fit together. Save checkpoints, not an irreversible one-attempt lock.
3. **Algorithm Expedition:** a skill map with prerequisite routes, new seeds and
   optional challenge paths; practise any unlocked route repeatedly.
4. **Adaptive Challenge Trail:** rotate deterministic tasks from skills the learner
   has practised. Save mastery checkpoints only after validated attempts; never
   equate time spent or number of clicks with mastery.

## Guest and student behavior

- Proposed guest games need no name. Results exist only in the current round's
  memory; leaving discards them. No cloud or persistent local game progress,
  leaderboard identity or activity tracking. Replay as often as desired.
- Enrolled students automatically save private progress. Any game rankings are
  class-only generated aliases, separate from assessment grades and optional
  diagnostic/activity consent. Explain this at entry without an opt-in gate.
- Replay freely; give completion XP once per distinct mission. Consider bounded
  best-attempt accuracy or skill badges only after authoritative validation.
  Never use client-reported success as proof of assessed mastery.
- Provide keyboard controls, readable contrast, reduced motion, non-color-only
  feedback and an untimed path. Avoid speed-only rankings that reward hardware,
  connection quality or reading speed. Separate difficulty/subject comparisons.
- No public real-name board, automatic grade publication, hidden monitoring or
  external-provider call without the appropriate disclosure and confirmation.

## What this review branch actually implements

The branch now uses one **Skill Arcade** practice hub rather than separate mini-apps.
It provides five reusable deterministic interaction mechanics — choice, output,
ordering, matching and debugging — over the current course/mission packs. The eight
named themed mechanics above remain future content designs; they are not represented
as eight separate applications, and the branch does not invent subject mappings that
teachers have not approved.

Guest playground/XML tools remain separate. Guest Arcade attempts do not create an
enrolled-student progress record; authenticated practice uses the existing private
server-validated practice path.

Practice Lab now has four courses, each with five modules and fifteen missions
per module: 300 guided missions in total. Five skills per module each have
Guided, Apply and Challenge levels. Numeric examples use seeded operands;
some web questions reuse the same demonstration with a different learning task.
These are guided variants, not 300 independent projects or 300 unique concepts.
The existing sixteen mission identifiers and completions are retained.

Student private progress saves without activity consent or instructor approval.
Ten completion XP per unique mission feeds a class-only alias board, including
ties, a personal highlight and a top-three display. Teacher analytics distinguishes
automatic completion XP from its older independent-review records. A future
Arcade can reuse these boundaries after its mechanics/content are approved.

Current completion XP is formative and self-recorded. Rules validate known
mission IDs, uniqueness, ownership, enrolled membership and totals, but a modified
client can still claim completion of known missions. Before using this for
high-stakes rewards, implement and test authoritative attempt verification,
idempotency, content-version policies and abuse limits as separate reviewed work.
