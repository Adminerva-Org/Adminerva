# Analytics, help and organization — prepared release 2026.10.19.3

This patch is stacked on PR #21. Neither patch is activated by this document. Do not merge/release the website before the matching Firestore permissions receive explicit owner approval and are activated. No Functions or rules deployment is authorized by this PR. The former deployment CLI session remains revoked.

The continuation adds disabled-by-default maintenance and a consent-removal handler, prepared but not deployed. See [maintenance workflow and release gates](monitoring-maintenance.md). Staging manifests `.19.1` and `.19.2` were not live releases; their public notes are consolidated into `.19.3` rather than generating fictional historical notices.

## Short user guide

- Students: open **? → Help with this page**, or **Help / tutorial** at the bottom. Repeated heading links have been removed. Wiki and Patch notes work without an account.
- Optional activity: on a signed-in workspace page, expand Help → Activity preferences. Both switches default off. Choose sharing and/or this-page diagnostic memory, then Save preferences. Diagnostic history alone does not upload usage events.
- Reports: administrator reports can explicitly attach the current page's last 20 semantic actions. Teacher-directed reports never include that attachment. Clicks describe attempts, not successful completion. Review/crop screenshots separately.
- Administrator: Staff Home → Administration analytics. Refresh the bounded operational sample, select the current instructor's assigned sections and Save assignment. Explicitly Refresh teacher summary to replace the private coarse snapshot. This never writes grades.
- Teacher: Teacher Analytics displays the account's learning view; only administrators can choose another configured instructor. Existing academic charts remain separate from optional engagement. No raw monitoring or diagnostic controls are present.
- Retention: use the optional, separately approved hourly worker, repeated manual cleanup or approved TTL policies. All application cleanup is bounded; check backlog warnings. Expiry fields alone do not delete records. Latest teacher snapshots and account preferences are separate records; do not promise a 30-day blanket deletion policy.

## Data and authorization

`activity_preferences/{uid}` stores consent and the student's existing roster ID, with ownership validated against verified Auth identity. Staff can opt in with an empty student ID. `activity_events` accepts only the allowlisted module/action schema, an owner UID, pinned profile student ID, bounded active seconds and expiry timestamps. Records are append-only, including for administrators; only administrators read/delete them. Both legacy staff catchalls explicitly exclude every new monitoring collection.

`issue_diagnostics/{issueId}` contains two parallel bounded allowlisted lists, never DOM text, selectors, full URLs, credentials, source code, mouse positions, free-form traces or recordings. Creation requires the existing administrator-directed report's authenticated reporter. Teachers cannot read it, even if the report later changes audience. Submission reports a separate attachment failure without falsely saying the already-saved report failed.

`analytics_rosters/{teacherEmail}` and `analytics_views/{teacherEmail}` are administrator-maintained. The new summary route limits teacher selection to verified identities; teachers can get only their own coarse snapshot, not list snapshots or read raw activity. The current school's authorization mapping still supports one instructor plus one administrator; adding more instructors needs a reviewed backend role migration. Existing broad **academic** staff permissions are not redefined by this operational patch; filtered academic UI is not a new server-side multi-teacher security boundary.

## Honest interpretation and limits

- Foreground, focused intervals only; input resets a 60-second idle cutoff without inspecting key values. Large timer jumps are dropped. Heartbeats send at most 60 seconds, and this client caps writes per page at 120. A final partial interval can be lost when closing/navigating.
- Client reports are forgeable/partial observations, not validated attendance, authorship, productivity, retention rate or mastery. They must never influence automated grades, discipline or ranking. Existing published grades/evidence protections remain unchanged.
- Dashboard coverage is the newest 500 events, up to 500 preferences and 200 reports, not full-population counts. The displayed student activity window is seven days. Returning means observations on two or more distinct UTC days, not cohort retention. High-volume use can truncate even that window.
- Stopping consent blocks future creates. Previously sent events persist until deletion. If the prepared consent handler is activated, it removes affected rows on processing; otherwise the administrator must refresh the snapshot. Manual saves now re-check consent transactionally, and teacher snapshot reads deny changed assignments or expired publication. A trusted administrator remains responsible for manual snapshot correctness and erasure requests.
- The bounded worker and consent handler are prepared, not deployed. Automatic TTL configuration, strong write-rate budgets, longitudinal population aggregation and account-erasure automation remain outside this release. Establish a school-approved privacy/retention policy and verify operating capacity before enabling monitoring at scale.
- Live listeners use first-result loading tokens, not perpetual loading indicators. Legacy show/hide calls remain one compatibility channel; newly instrumented jobs have independent idempotent completion tokens. Not every legacy network function has been refactored into this API.
- The browser regression exposed the review step toolbar covering an embedded Reopen button during scrolling. Step navigation now stays in normal flow instead of overlaying evidence controls; the test uses real clicks, not forced clicks.

## Maintenance

See [repository map](repository-map.md). New analytics and help responsibilities live in dedicated folders. Root routes use canonical kebab-case names with query/hash-preserving legacy aliases. Source HTML, CSS and JavaScript receive short purpose headers; JSON/config formats cannot accept comments. Database/stored identifiers, CI convention names and the binary logo URL are intentionally unchanged. Renaming every public/deployed entry point at once would break integrations and is not presented as completed.

Public release notes contain only user-relevant product information. They use Adminerva product names while the Wiki and evaluation details retain truthful automated-assistance disclosures. Versioned notices reuse the existing in-app release inbox; there is no background push to a closed browser.

## Validation scope

Focused unit tests cover activity minimization, idle/visibility accounting, summary windows and returns, verified identity, concurrent loading and legacy redirects. Firestore emulator cases cover consent, identity spoofing, extra fields, bounds, append-only protection, diagnostics isolation and teacher snapshot access. The real Auth/Firestore browser lifecycle adds opt-in/out, shared report trails, instructor selection and summary replacement, guest Wiki privacy and overlapping loader jobs on top of the existing grading/evidence lifecycle. The chart library is a render stub in this workflow; it does not validate chart rendering fidelity or production-scale datasets.
