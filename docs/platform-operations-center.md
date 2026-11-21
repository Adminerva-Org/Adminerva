> **Planning authority:** This document is retained as a technical specification, implementation note, migration reference, or historical plan. The canonical Adminerva product roadmap, development status and future priorities are maintained only in [Adminerva School OS — Master Development Plan](https://github.com/Adminerva-Org/Adminerva/blob/main/docs/adminerva-school-os-master-plan.md). Do not use this file as a competing roadmap or progress tracker.

# System Admin Operations Center — implementation

**Status:** Implemented on `feature/platform-operations-center-20261117` / draft PR #194. **Not deployed to production.** The existing school administrator, People & Access, V4 pilot, academic records, and migration flows are deliberately untouched.

## Delivered platform capabilities

| Domain | Implementation | Provenance / important limits |
| --- | --- | --- |
| Fleet overview | Exact Firestore count-aggregate lifecycle totals, searchable school registry (first 100 rows) | Large registries are flagged as truncated; detailed school browsing beyond 100 is future pagination work |
| School operations | Selected school setup checklist (standard provisioning) and support-report aggregate counts | No private support bodies, reporter identity, academic records, grades or student information returned |
| Fleet support | Operator-requested batches of 8 schools, at most first 100, with graceful per-school source errors | Server-enforced rollout governs support observations; counts are not uptime checks |
| Health probes | Manual and hourly opt-in Firestore, Firebase Auth, public GitHub, Google Cloud and Cloudflare status probes | Public vendor status does **not** verify Adminerva's OAuth, school Gemini credentials, storage, account status or API quotas |
| No unsupported claims | FCM shows registered-device readiness plus an explicit System Admin self-test; Cloud Billing/quota stays **Not monitored** | Firebase acceptance is distinct from foreground-browser receipt; no false green uptime badges without evidence |
| Adminerva-native telemetry | Sampled callable/browser success traffic, full failure capture, 5-minute metric buckets, sanitized error grouping, trace summaries and bounded spans | No prompts, source code, grades, student names, credentials, request payloads or notification bodies are stored by this telemetry layer |
| Historical monitoring | Bounded recent probe samples plus 7-day trace / 90-day metric retention, service failure streaks and instrumented job history | Cleanup is bounded and can run manually or with the separately authorized platform pulse |
| Anomaly detection | Recent-baseline failure-rate and latency checks; scheduled pulse creates/clears telemetry alerts | High-severity telemetry anomalies open incidents only when the existing automatic-incident policy is enabled |
| Incident response | Create, acknowledge, investigate, resolve/reopen, operator notes, revision checks, transition history | Platform admin only; technical notes must not contain student data or credentials |
| Internal alerts | Repeated failed probe thresholds, cooldown, deduplicated alert, automated incident creation and alert acknowledgment | Alerts are visible **inside** System Admin; no push/email escalation is enabled |
| Automation policy | Explicit opt-in automated checks, auto incidents and daily digests; thresholds and revisioned audits | A saved enabled policy does not mean the job is deployed or running |
| Daily digests | UTC daily aggregate per deployment, with school-count totals and rollout-filtered school ID inclusion | School selections do not include academic metrics or any student-level data |
| Job/backlog visibility | Platform pulse, file-retention and legacy monitoring jobs record start/finish/duration/failure receipts; major Firestore notification/evidence events are sampled into telemetry | External provider queues remain outside Adminerva unless their APIs expose safe queue state |
| Spend reporting | Audited operator-reported monthly PHP amount, optional budget threshold and source reference | **Not real charges**: Cloud Billing export and quota APIs require separate authorized cloud project/IAM integration |
| Feature rollout controls | Off / selected schools / all schools, verified IDs, reason, revision and audit | Only three **Operations Center** behaviors use these flags. They do not silently switch classroom features |
| Navigation/UX | Compact 6-tab responsive page, shared Adminerva nav, owner-only route guard, keyboard tab support | Client routing complements, but does not replace, server-side platform authorization |

### Operator actions

- **Overview:** View aggregate lifecycle and school support information; load fleet support in bounded pages; review sanitized platform registry changes; inspect school AI configuration metadata and the last diagnostic result without exposing its key.
- **Service health:** Run bounded internal/public-provider checks, send a current-account push self-test, distinguish Firebase acceptance from foreground-browser receipt, view recent samples, and inspect stale status and legacy maintenance.
- **Observability:** Inspect estimated request volume, failures, error rate, average/P95 latency bands, anomaly signals, sanitized error groups, recent traces/spans, frontend/backend release markers and bounded retention cleanup.
- **Incidents & alerts:** File an incident, apply guarded status transitions, inspect the stored transition history and acknowledge internal alerts.
- **Jobs & policy:** Inspect instrumented work, edit and audit monitoring policy, view saved daily digests, record a separately sourced monthly cost figure.
- **Feature rollouts:** Control fleet support observations, school setup observation display, and school inclusion in optional digests.

## Code and storage contracts

New frontend and assets:
- `platform-operations.html`
- `css/platform-operations.css`
- `js/core/platform-operations.mjs`
- `js/core/telemetry.mjs` — authenticated browser diagnostics, local duplicate suppression, sampled page-load timing and trace propagation helpers.

Backend:
- `functions/platform-operations.js` — callable `platformOperations` actions, owner-only authorization, bounded read models and audited mutations.
- `functions/platform-operations-model.js` — shared server schema, input limits, feature definition and status normalization.
- `functions/platform-operations-monitor.js` — `platformOperationsPulse` work core, bounded probes, probe/anomaly alert state, daily digest and retention cleanup.
- `functions/platform-telemetry.js` — cost-bounded metric buckets, sanitized error fingerprints, sampled traces, job/event wrappers and browser diagnostic intake.
- `functions/platform-observability.js` — System Admin read model, anomaly calculations, release correlation and bounded retention cleanup.
- `functions/index.js` — instruments safe callables, selected scheduled/background work, browser telemetry intake and the separately deployable hourly schedule.

Storage:
- `platform_operations/control` and `platform_operations/runtime` — automated monitoring policy and lease/worker heartbeat.
- `platform_operations_samples`, `platform_operations_service_state` and `platform_operations_jobs` — probe samples, service state and scheduled-job receipts.
- `platform_telemetry_metrics` — five-minute weighted metric buckets.
- `platform_telemetry_errors` — sanitized grouped failures with bounded school-context lists.
- `platform_telemetry_traces` — sampled backend/browser trace summaries and up to 12 technical spans.
- `platform_telemetry_client_rate` — short-lived server-side browser telemetry rate-limit counters.
- `platform_operations_incidents/{id}/history`, `platform_operations_alerts` and `platform_operations_audit` — incident, alert and privileged-action records.
- `platform_operations_features` — Operations Center rollout settings.
- `platform_operations_digests` and `platform_operations_costs` — aggregate summaries and explicitly manual cost entries.

All new writes run through the trusted server Admin SDK; no client Firestore collection access or academic schema migration is introduced. Existing `platform_schools`, `schools/{schoolId}/support_reports` and legacy monitoring records are only read.

## Native observability architecture

Adminerva does **not** require Datadog for the implemented operational visibility. The Operations Center now owns the relevant application-level telemetry:

1. Every callable routed through `safeCallable` receives an internal trace context. Successful requests are sampled at approximately 10%; failures are recorded at full rate.
2. Critical Studio, assessment and school-AI browser clients propagate a trace ID to the callable. Backend Studio persistence/submission, assessment deployment and Gemini provider calls add bounded child spans to that same trace.
3. The authenticated shell starts `js/core/telemetry.mjs`, which samples page-load performance and reports uncaught JavaScript errors, resource-load failures and unhandled promise rejections. Repeated identical browser failures are aggregated locally and sent as bounded occurrence summaries rather than one network write per repeat.
4. Metric documents use five-minute buckets and weighted success samples rather than one permanent Firestore document per successful request.
5. Error messages are sanitized and used only to derive a one-way grouping fingerprint. Stored error-group samples use a generic source/code/operation label; browser or backend error message text is not retained. Telemetry code never intentionally receives educational request payloads.
6. Scheduled/background jobs record compact start/finish/duration/error receipts. Major assessment, evidence, notification and roster event handlers feed the same sampled operation/error model.
7. The observability read model compares the latest 30 minutes with the preceding 60-minute baseline. Material failure-rate or latency spikes become Operations Center anomaly alerts during a platform pulse; high-severity anomalies may create incidents only when automatic incidents are enabled.
8. Backend release correlation uses the Cloud Functions/Cloud Run revision marker. Browser telemetry uses the current shared frontend asset version marker when available.
9. Trace documents are retained for 7 days and metric buckets for 90 days. Each cleanup pass is deliberately capped; grouped errors and incidents are retained until an explicit future policy says otherwise.

This is intentionally an **application observability system**, not a replacement for Google's physical infrastructure telemetry. CPU hosts, Google datacenter networking, authoritative quotas and actual billing remain provider-owned signals.

## Connection diagnostics

- **School Gemini:** A System Admin can manually test a configured school's Gemini connection. The backend sends only a fixed `Return only OK.` diagnostic prompt, never school content, does not return provider output, stores no API key in operational telemetry, and permits at most one test per school per minute. The request consumes a small amount of that school's provider quota.
- **Push:** The current System Admin can reconnect the current browser, send the existing `pushTestPing`, and see two separate states: Firebase accepted the message, and (when the page remains foregrounded) the browser emitted the Adminerva push event. This is not a background-device delivery SLA.
- **GitHub:** V4 school evidence intentionally has no centrally managed school OAuth credential. The Operations Center reports public GitHub provider status and identifies school GitHub evidence as public-evidence mode. Legacy personal GitHub tokens remain user-owned settings and are not inspected by System Admin.
- **Google Cloud status:** The broad public incident feed is used only as provider context. Google documents project-specific Service Health as a separately authenticated API with project/billing/IAM requirements, so the Operations Center does not imply that public status verifies a school's Gemini account.
- **Billing:** Real Cloud Billing/quotas remain external prerequisites. Manual figures are explicitly operator-reported and are not cloud-verified.

## Activation safeguards

1. This branch should be reconciled against the latest `main` before integration, because parallel school-admin/V4 work is active.
2. Deploy the **callables** `platformOperations` and `platformTelemetry` with the instrumented backend functions before relying on the Observability tab. The browser reporter fails closed when diagnostic intake is unavailable.
3. **Do not deploy** `platformOperationsPulse` until scheduled execution and billing are authorized. Its export is guarded by the deployment-only environment variable `ADMINERVA_DEPLOY_PLATFORM_PULSE=true`; normal deployments do not register the schedule. The hourly scheduler can incur charges even when `automatedChecks` is false.
4. Automated monitoring flags remain false until a verified System Admin explicitly enables them.
5. New operational write collections are server-origin only. Confirm existing Firestore rules still deny direct browser access.
6. Avoid entering real student names, private report text, credentials or personal secrets in operator notes.
7. The operations incident service cannot change school status, grading, enrollment, tenant permissions, user identity, assessment outputs or publication. System Admin access is verified on every callable.

## Focused validation

`node --test tests/platform-operations.test.mjs tests/platform-telemetry.test.mjs`

The focused tests cover platform permission denial, aggregate-only payloads, fleet support counts, incident revision conflicts, rollout isolation, provider-status semantics, credential/error redaction, trace-span privacy, weighted metric math and anomaly thresholds. CI may also report failures from unrelated student-workspace tests; do not attribute those failures to this operations work without inspecting their traces.

## Remaining external prerequisites

A functional **Cloud Billing/Monitoring API** integration requires separately authorized billing export, service-account scope, quotas and cost controls; no existing service-account permission is assumed. FCM can now be self-tested for the current System Admin browser, including a foreground receipt signal; background-device delivery still has no receipt SLA. School Gemini credentials can be tested manually with a fixed diagnostic prompt. Legacy personal GitHub OAuth remains user-owned and is not centrally inspected; public vendor status is not credential verification.

These unconnected infrastructure sources remain conspicuously labeled **Not monitored**, rather than fabricated as healthy. Adminerva application callables, selected browser workflows, scheduled maintenance and major background events now have first-party telemetry; provider-owned queue internals are shown only when a provider exposes an authorized source.

No production release, Firebase deployment, school migration or live school control changes have been made as part of this branch.
