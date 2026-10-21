# Practice, evaluation and access safeguards

This release candidate includes matching website, Firestore rules/indexes and
practice Functions changes. Passing local checks is not a deployment. Wait for
the exact-head CI result, approved access preparation and a coordinated rollout.

## Teacher review

1. Review selected committed diffs and the source pinned to the approved checkpoint.
   Approve only independently verified contributions and document individual scope.
2. Choose **Evaluate** for a private system draft. Each criterion stands on its
   own evidence. A missing teammate screen is shared project context, not an
   automatic individual deduction; a noncontributor receives no shared credit.
3. Pending criteria explain the missing evidence and the next teacher check.
   A supported subtotal is not a reweighted final grade or a missing-score zero.
   Resolve unsupported criteria manually, save privately, then deliberately publish.
   Automated assistance and provider/source limitations remain disclosed in details.

The step bar sits directly below the modal heading, outside its single scrolling
body. Reopening invalidates prior draft eligibility and updates student selections.
Published grades must be explicitly unpublished before evidence can be reopened.
One XML component cannot establish all screens, runtime behavior or authorship.

## Automatic practice XP

- Four courses, five modules each, fifteen missions per module: 300 missions.
  Each module's first mission is available independently; subsequent missions
  require the preceding verified completion, enforced on the server.
- The server issues randomized, expiring attempts. It consumes one prediction;
  incorrect answers require a new example. Correct predictions unlock the
  experiment and written comparison. Accepted work automatically saves ten XP
  per unique mission. Replays remain playable but never award duplicate XP.
- Attempts, award receipts, verified progress and ranking totals are server-owned.
  Editing browser storage, submitting a numeric total or claiming a known mission
  ID cannot mint XP. Concurrent submissions and retry responses are idempotent.
- Old self-recorded/local progress is retained separately, not silently converted
  into verified XP. Offline reflections are private drafts, not earned points.
  Pending completion retries remain tied to the account, attempt and scored session.
- Class-only rankings use generated aliases and shared ranks for ties. Private
  reflections stay separate. A 500-row display cap is explicitly labeled.
  Aliases are pseudonyms, not anonymity; class documents contain opaque record IDs.
- No teacher approval or activity-sharing consent is needed for automatic XP.
  Optional legacy instructor practice notes/points are separate records and never
  gate or replace the server-owned leaderboard. School grades are unchanged.

## Device changes and shared computers

One active scored session is maintained per account/browser installation. A
different active session requires explicit transfer confirmation and recent sign-in,
not teacher approval. The old lease cannot submit further scored work; previously
saved XP stays intact and the user is not signed out of the rest of the website.
Legitimate shared computers and device changes are allowed. Neutral handover events
are not cheating verdicts and cause no automatic penalty.

A random resettable browser key is not a hardware fingerprint. It cannot prove
physical device ownership, who typed an answer or whether somebody helped. The
backend checks predictions and deduplicates rewards; it does not certify mastery,
independent authorship or runtime execution. The client sandbox run marker is only
a workflow aid. Do not use XP as high-stakes assessment evidence.

Attempts expire after two hours; scored leases after thirty minutes and renew
during visible practice. Handover events expire after thirty days. The matching
Firestore TTL policies delete expired operational records asynchronously, not at
an exact instant; expired records are rejected even before physical deletion.
Award receipts and learning progress are retained separately. Platform request logs
follow their configured provider retention. No monitoring consent is silently enabled.

## Teacher access

The audited staff registry's sections, not browser roles or analytics preferences,
authorize academic access. Teachers query assigned sections and credential-free
roster projections. Raw other-student connection records are administrator/owner-only.
Private repository caches, notes and templates are namespaced to the teacher UID.
Assessment ownership/deployment metadata and grade section metadata support scoped
queries; unprepared historical records fail closed rather than exposing all classes.

Explicit administrator preparation copies only credential-free roster fields and
adds missing scope metadata. It preserves scores, feedback, publication states,
evidence revisions and submissions, records immutable preparation audits, and
rejects records changed after the dry run. Legacy assessments lacking an owner are
marked administrator-custodied, not falsely attributed to their original creator.
Original teacher assignments require an explicit administrator decision; no
directory entry or analytics record can self-authorize teaching.

This is not a complete multi-institution tenancy implementation. Public-by-link
Playground behavior, school catalog sharing and existing signed-in assessment
description visibility retain their documented legacy policies. Audit unrelated
modules before admitting unrelated institutions. App Check and provider-side budget
alerts remain separate operational setup; bounded instances and per-account example
limits are not complete bot/collusion prevention.

## Help and validation

Use **? → Help with this page**, or footer **Help / tutorial**. Repeated heading
links are removed. Wiki, privacy and patch history remain accessible.

Pure tests cover catalog parity, scope queries, outbox/account races and preparation.
Real local emulator tests cover forgery, replay, transfers, enrollment, assigned
access, immutable audits and protected grading. Browser coverage uses real local
Auth/Firestore and the production practice service behind a test callable gateway.
GitHub/evaluation responses and sandbox execution markers use fixtures. The gateway
does not prove production Functions routing or live provider accuracy; deployment
contracts and post-deploy smoke checks remain necessary.

Games remain proposals, and the PDF footer investigation remains deferred.
See [Learning Arcade](learning-arcade-proposal.md) for game ideas.
