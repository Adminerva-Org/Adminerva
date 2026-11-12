# Adminerva Cloudflare Platform Integration — Approved Direction / Staged Execution

Updated: 2026-11-12. Goal: adopt the full set of useful Cloudflare capabilities without replacing production Firebase records or disrupting CheerpJ, teacher workflows, or active assessments.

## Architecture and immovable boundaries

**Authoritative academic data remains in Firebase** until a separately approved migration: identity, schools, membership, assessments, personalized variants, source snapshots, rubrics, teacher evaluations, grades, class records, audit history, and parent/student grade views.

Cloudflare services have distinct responsibilities:
- Pages: the independently hosted CheerpJ runner (already live at adminerva.pages.dev); it must never execute on the authenticated GitHub Pages origin.
- Workers: authenticated service-to-service gateway, school policy checks by its trusted Firebase caller, storage and queue orchestration.
- R2: private, opt-in original PDFs and eligible support documents; no public read ACL and no files stored without a school-approved retention policy.
- Queues: small, non-sensitive job pointers for PDF extraction, evidence processing and controlled AI tasks, with bounded retries and dead-letter handling.
- Workflows / Cron: later durable orchestration, deadline/expiry reconciliation and retry recovery.
- Web Analytics: aggregate page-performance and page-view metrics. Do not send student IDs, assessment IDs, query strings with personal data or teacher grading content.
- Turnstile / Firebase App Check: targeted abuse protection at guest joins, public endpoints and upload authorization. Never replace school-role authorization.
- AI Gateway: optional routing for supported providers; disable prompt/response logging or expressly review privacy before any student content.
- Workers AI: selected low-risk tasks, model/budget capped; no autonomous scoring.
- Vectorize: opt-in retrieval only for licensed/approved educational text, never unpublished assessment solutions or identifiable student submissions.
- D1: operational job state and reconciliation, not a replacement for Firestore grades.
- Durable Objects: later real-time shared Studio sessions, only with explicit participant consent and teacher controls.
- Cloudflare Images: approved lesson images and thumbnails; media rights remain a prerequisite.

## Workstream sequence and acceptance

| Wave | Capability | Integration / acceptance | Status |
| ---- | ---------- | ------------------------ | ------ |
| 0 | CheerpJ isolated Pages | Existing dedicated HTTPS origin and teacher-only pilot | Connected |
| 1 | Workers + R2 + Queues foundation | Private service-only API, metadata-only jobs, fail-closed flags, local tests | Code staged |
| 2 | School-admin storage opt-in + Firebase relay | Verify Firebase session, school role, file policy and retention BEFORE calling Worker; issue no browser edge secrets; maintain current library text-only workflow until opt-in | Not started |
| 3 | Safe Reference Library originals | Private PDF object lifecycle, upload progress, duplicate detection, deletion, school-scoped retention and failed-import recovery | Not started |
| 4 | Queue-backed extraction and batch evaluation | Firestore authoritative job metadata; queue only opaque pointers, provider-side idempotency and evidence retention; no automatic publishing of grades | Not started |
| 5 | Web Analytics + performance | Enable beacon only on explicitly listed low-risk pages, with no personal data in URLs; review current privacy notice | Not started |
| 6 | Turnstile / App Check | Server verifies token on selected high-risk operations, graceful fallback; doesn't block verified classes during vendor outage | Not started |
| 7 | AI Gateway | School-aware provider budgets, redacted logging, admin-level cost control, existing external packages unchanged | Not started |
| 8 | Workers AI / Vectorize | Opt-in resource indexing and teacher-assisted planning; removal and school-isolation controls | Not started |
| 9 | D1 / Workflows / Cron | Operational state, retries, purge/reconciliation jobs with observability and idempotency | Not started |
| 10 | Durable Objects / collaborative Studio | Consent, tenant policy, invited roles, real-time typing and code review; never publish drafts as official submissions | Not started |
| 11 | Images / CDN / optional site migration | Approved educational images and caching; weigh complexity before moving GitHub Pages | Not started |

**Order matters:** Waves 2–4 require school-admin retention approval and Firebase authorization; waves 7–10 require school AI and data-privacy reviews. Do not introduce everything at once or move school grades into a second database.

## Wave 1 code (this branch)

The path cloudflare/adminerva-edge contains a ready-to-adapt Worker foundation:
- GET /health is intentionally public and reveals no metadata.
- POST /v1/internal/references: stream a PDF to a **private** R2 binding; requires internal service secret, school ID and explicit opt-in assertion. Returns only a generated opaque ID.
- GET or DELETE /v1/internal/references/:schoolId/:id: internal service-only, no public object URL.
- POST /v1/internal/jobs: enqueue a pointer with a job type, school ID and opaque resource ID; rejects arbitrary fields and student evidence.
- Queue consumer: sends pointer to a previously configured trusted HTTPS Firebase job processor. Without a processor and secret, it retries rather than pretending to complete a job.
- The edge's R2, queue and API flags all default OFF. No API endpoint is deployed by committing this repository code.

Deployment template: cloudflare/adminerva-edge/wrangler.toml.example.

This foundation DOES NOT YET integrate with current Firebase functions. No school files are uploaded to R2 and no jobs are queued by the live website.

## Cloudflare account actions needed to enable Wave 1

An account owner must authorize Workers, R2 (billing setup may be required) and Queues. Do **not** paste service credentials into ChatGPT, GitHub issues, the frontend or this repository.

1. Create private R2 bucket adminerva-private-references (and a separate preview bucket).
2. Create Queues adminerva-jobs and adminerva-jobs-dlq.
3. Copy the deployment template to a local wrangler.toml file, then set binding names to the resources created above.
4. Set a long, randomly generated ADMINERVA_EDGE_SECRET via Cloudflare's encrypted Worker Secrets. It will be used **only by the trusted Firebase relay**, not by browser JavaScript.
5. Before enabling queues: provide a verified HTTPS Firebase processor URL and a distinct JOB_PROCESSOR_TOKEN secret. Processor must enforce idempotency and not publish grades.
6. Set EDGE_API_ENABLED true only after the trusted Firebase relay exists. Set EDGE_R2_ENABLED only for schools whose authorized policy allows original-file retention. Set EDGE_QUEUES_ENABLED only after the trusted processor is deployed.
7. Check billable resources and quotas in Cloudflare dashboard; set billing alerts where available.
8. Enforce school-tenant authorization and retention in Firebase before the Worker calls. Edge-side header assertions are not equivalent to school policy verification.

## Strict privacy and operational conditions

- No browser calls to internal Worker APIs and no Cloudflare shared secret in JavaScript.
- No student assessments, code submissions, AI prompts, names or grades in queues, R2 keys, D1 rows or logs by default.
- R2 objects are private; deletion/retention must be explicit, auditable, and compatible with the existing school file policy.
- Do not store original PDF files for a school unless the authorized school administrator opted in, chose retention, and the scope is consistent with Adminerva's school file policy.
- Enqueue only opaque pointers. Processing must be idempotent; otherwise retries can duplicate AI charges or published state.
- No change to current manual/external AI import workflows until each new path demonstrably produces the same normalized Reference Library results.
- Data sovereignty, student privacy requirements, content licensing and school processing agreements must be reviewed before transmitting non-public educational material to new services.
- Turnstile, analytics and AI request logging should be reviewed with the school's privacy officer before rollout.

## Known quotas (verify at activation time)

Workers Free currently lists 100,000 requests/day and 10ms CPU time/request. Use Workers for routing and streaming rather than CPU-heavy OCR. Cloudflare Queues Free includes 10,000 operations/day (write/read/delete count separately) and 24h retention. Big files should stream to R2, while a separate OCR/AI provider performs extraction. Avoid promising free, unlimited compute.

Official documentation:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/queues/platform/pricing/
- https://developers.cloudflare.com/r2/objects/upload-objects/
- https://developers.cloudflare.com/pages/how-to/web-analytics/
- https://developers.cloudflare.com/turnstile/
- https://developers.cloudflare.com/ai-gateway/
