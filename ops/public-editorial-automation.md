# Public editorial channels — Codex automation runbook

This is an **operational runbook**, not a product roadmap. Product direction and status belong exclusively in `docs/adminerva-school-os-master-plan.md`.

## Publication boundary

Adminerva's website is a static GitHub Pages frontend. **Codex does not publish directly to production.** Each scheduled job can research and prepare a PR against `Adminerva-Org/Adminerva`; an authorized reviewer verifies the content and merges it when approved. Github Pages then serves the updated public files from `main` according to its release process.

Four independent channels share one safe frontend reader (`js/core/public-content.mjs`):

| Codex automation | Schedule (Asia/Manila) | Canonical output |
| --- | --- | --- |
| Immersive Homepage Experience | Daily, 06:00 | `content/experiences.json` |
| Release Notes & Announcements | Daily, 07:00 | `content/announcements.json`; release source is still `patch-history.json` |
| Opportunity Hunter | Daily, 08:00 | `content/opportunities.json` |
| Weekly Adminerva Pulse | Friday, 16:00 | `content/weekly-pulse.json` |

Set the above in **Codex Automations** with the Adminerva repository selected. A ChatGPT Scheduled Task is not the same as a Codex automation. No automation is provisioned merely by merging these repository files.

All channels use `{ "schemaVersion": 1, "channel": "<channel>", "items": [...] }`. Each `item` requires a unique slug `id`, `status`, ISO 8601 `publishedAt` and `expiresAt` with time zone, `title`, `summary`, `audience` and `url`. Valid audiences are `all`, `guest`, `student`, `teacher`, `admin`, `platform`. **Audience controls editorial relevance, not access authorization.** Every byte of these JSON files is publicly accessible, including draft entries. NEVER place private or school-specific records or sensitive information in these files, even with `status:"draft"`.

Status `published` is displayed only if the publication and expiration windows permit it. Content with other statuses is not displayed. A scheduled task should create a reviewable branch/PR and leave new material as `status:"draft"` until a human editor approves the content and sets it to published. New PRs are for approval; never automatically merge, deploy, or write directly to `main`.

For opportunities the reader additionally requires `category` (`Training`, `Scholarship`, `Competition`, `Internship`, `Event`, `Other`), `provider`, `location`, `cost`, `eligibility`, `sourceUrl` (HTTPS), `verifiedAt` (YYYY-MM-DD), and optional `tags`. Opportunity cards automatically disappear when source verification is older than 45 days, or when `expiresAt` passes. Use expiry as a **recheck deadline**, not as a fabricated application deadline. Never claim age, cost, admission, application deadline, or eligibility unless directly verified from the provider.

For announcements and weekly summaries, require a `sourceUrl` for traceability. Releases must continue using the established `docs/release-notes-style-guide.md`, `patch-history.json` and `site-release.json`. Existing release notifications must not be duplicated or published before the relevant backend/frontend release is confirmed.

For experiences, only use illustrative public demos with explicit public links and a short `label`. Do not invent actual user events, imply school-wide activity is live, or render data from student, teacher, or guardian records. Use existing interaction components; do not rewrite core homepage templates daily.

## Copy into Codex Automations

**1 — Daily immersive homepage experience**

> Read AGENTS.md, docs/adminerva-school-os-master-plan.md and content/experiences.json. For today's Asia/Manila date, propose at most one useful, genuinely different illustrative feature spotlight or public discovery scene that links to a verified existing Adminerva guest/public capability. Reuse the existing home activity/content UI; do not modify application architecture, HTML, authentication, school data, grading, tests unrelated to the change, or current release markers. If nothing new adds value, report no change. If applicable, update ONLY content/experiences.json on a reviewable branch, append a new item with status=draft, valid publishing/expiry windows and label, and open or update one PR for review. Never merge/publish/deploy automatically, never claim fictitious people actions as real, and keep the active item count small.

**2 — Daily release notes & announcements**

> Read AGENTS.md, docs/adminerva-school-os-master-plan.md, docs/release-notes-style-guide.md, patch-history.json, site-release.json and content/announcements.json. Inspect changes since the last verified published version and distinguish merged code, backend deployment, frontend release and actual operational behavior. Prepare a concise internal result with shipped/verified items and unreleased items explicitly separated. Do not infer production readiness from a PR or mainline commit. Only if there is independently verified, public-safe news, prepare at most one status=draft announcement with a traceable sourceUrl in content/announcements.json on a reviewable branch/PR. Do not advance site-release.json, publish patch-history.json, duplicate existing release notifications, touch school records, or publish automatically. If no verified changes, report no public update.

**3 — Daily Opportunity Hunter**

> Read AGENTS.md, docs/adminerva-school-os-master-plan.md, ops/public-editorial-automation.md and content/opportunities.json. Research relevant **real** scholarships, competitions, training, internships, career or educator opportunities primarily for the Philippines and then globally accessible opportunities. Prefer primary official provider sources. For every candidate verify the live original URL, actual provider, location, eligibility/age requirements, cost, deadline if explicitly given, and the observation date. Exclude dubious, pay-to-apply, expired, unverifiable, suspicious, or restricted opportunities; do not infer eligibility. Check existing IDs and URLs to avoid duplicates. Update existing entries' verifiedAt when sources are genuinely re-checked, and let stale records expire. Prepare at most three strongest new items, status=draft with accurate sourceUrl, publishedAt, expiresAt (recheck deadline, not application deadline) and category in content/opportunities.json; open or update a single PR for editorial approval. Do not edit other channels, auto-merge, publish automatically, submit applications, contact providers or process student records. If none qualifies, return a concise no-findings report.

**4 — Friday Adminerva Pulse**

> Read AGENTS.md, docs/adminerva-school-os-master-plan.md, ops/public-editorial-automation.md, patch-history.json, site-release.json, content/weekly-pulse.json and current public experiences/opportunities. For the week ending Friday in Asia/Manila, prepare a short factual public weekly recap. Refer only to verified published releases and already approved/public highlights; link to their actual sources. Clearly separate any in-development changes from shipped ones, and never imply school-wide student/staff activity. If a substantive recap is warranted, append one status=draft item with title, summary, url, sourceUrl, publishedAt, expiresAt and audience to content/weekly-pulse.json in a reviewable PR. Otherwise report no meaningful public update. Do not make live release/version/deployment/notification changes.

## Review before publication

- Confirm each link and material claim with its original official source. For opportunities, recheck eligibility, currency, deadlines and geographic applicability.
- Check `status`, `publishedAt`, `expiresAt`, and `verifiedAt` freshness. Do not publish entries with speculative facts.
- Keep preview content public-safe; no private school announcements, student work, individual activity, account information or grades.
- Approve published content through normal PR review and merge. Do not publish a release solely because an automation completed.
- Verify `opportunities.html` and at least one guest + one authenticated homepage on narrow/mobile screens after the frontend release. No backend deployment is needed for these static public channels.

**Not included yet:** authenticated school announcements, push alerts, school-scoped personalized recommendations, auto-publishing, private student achievement feeds, paid opportunity APIs, scholarship applications, or a Codex usage quota controller. Those require separate approved access and product workflows.
