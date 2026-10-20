# Review resilience, audit integrity and draft publication

This extends the personal-teacher-workspace PR. It is **review-only**: no deployment, live permission changes, student-data migration, monitoring activation or grade publication is authorized.

## Findings against the actual code

- Dynamic teacher admission already exists in `staff_access`. A plain `teachers` directory record is not a secure authority source. Account access now cross-references the verified account's registry, own teacher profiles and own student membership concurrently. An unapproved teacher directory profile gets an explicit approval-required message, not a silent student fallback. The administrator must activate the exact verified email in Teacher Accounts. No directory self-edit, CSV import or browser simulation grants staff privileges.
- The existing evidence comparator already canonicalizes map keys. Grade transactions now use a separate deterministic projection of grade version, timestamps (including nanoseconds), publication, score/max, feedback, evidence revision/SHA and review/protection flags. Unrelated map ordering cannot produce a conflict. Material grade edits still do. Saves increment `gradeVersion`; old grades remain compatible without migration.
- The current shared loader was already a nonblocking status element, not the older full-screen overlay in the report. Targeted legacy review fetches now use region busy states, skeleton rows and a dismissing status toast rather than controlling a page-wide loader. No whole-site loader removal is claimed.
- Self-closing Android XML tags were already preserved. Screening now also handles multiline XML comments and tags following comments on the same line, without erasing attributes or quoted text.
- The legacy checker and Contribution Inspector already resolve the saved GitHub login against GitHub. They now share a validation helper that normalizes CSV-style `@login`/whitespace and rejects a mismatched saved stable ID. A successful lookup identifies commits from that GitHub account; it **does not** prove that the account belongs to the student. Undefined `githubAccountVerified` is never changed to true by importing a CSV. Unresolved login-only evidence remains review-required.
- `grade_revisions` was covered by broad staff writes. It now has explicit append-only rules, actor/time validation and matching grade before/after values. Both broad academic matches stop at the top-level document: arbitrary nested audit/revision writes no longer inherit permission. Legitimate shared reference documents and instructor practice-progress reads have explicit paths. Claim decisions are append-only; evidence, workspace, admission, practice and monitoring histories retain their immutable rules. Server Admin SDK access is outside client Security Rules and remains an operational trust boundary.

## Teacher workflow

1. Open Review & Grade and inspect selected changes and the pinned checkpoint. Confirm attribution before evaluation. Review panels load independently without a full-page fetch overlay.
2. Choose **Evaluate**. Short transient outages get bounded backoff. Rate-limit/long-cooldown messages keep the page usable with **Retry with backoff** and **Switch to manual grading**. Invalid JSON or rubric schema never becomes a fabricated zero, replaced teacher feedback or a published grade. Existing teacher fields remain unchanged.
3. Complete the teacher score, feedback and audit note; save privately. Publish a V2 grade individually after verifying the current approval. A published grade must be unpublished before editing.
4. Table cells show a total and one-sentence feedback preview. Open a feedback chip for a side drawer; use **Review / edit teacher grade** to reach protected editing. Markdown previews support headings, bullets, bold and inline/fenced code using text nodes, not arbitrary HTML or scripts.
5. In Gradebook, **Publish (N Drafts)** stays mounted and is disabled while loading, busy or empty. Only explicitly reviewed legacy drafts with valid bounded numeric scores are eligible. V2 grades remain excluded from batch publication. Confirmation is required; each item is re-read transactionally and gets an immutable publication revision. Changed items are skipped rather than silently publishing a newer teacher edit.

## Recovery and limits

- Publication progress stores account/context-scoped grade identifiers, not feedback, provider keys or student names. A refresh never resumes publication automatically. Reopen the same class/assessment, review server state, then confirm a new action. Completed grades are no longer eligible. Pending failures/interruption are indicated; unavailable local recovery storage pauses the batch. There is no durable server-side job scheduler or offline publishing.
- Read-only GitHub requests are bounded and cancelled with the review. Secondary 403/429 limits respect `Retry-After`/reset headers; secondary responses without a header wait at least a minute. Cooldowns are shared within the loaded page across client instances, and retries are bounded. Permission failures are not repeatedly retried. Other open tabs have separate network state.
- Repository metadata supplies the actual default branch. Explicit branch names are resolved to a full SHA before pagination. An empty/unknown default branch or inaccessible/deleted ref produces a manual-review limitation; no guessed `main`/`master`, branch switching or silent HEAD substitution occurs.
- API pagination caps, unavailable/truncated diffs, author-account ownership, original authorship and push-before-deadline limitations remain visible. A browser client cannot certify these facts. Verified individual diffs are distinct from group completeness; missing teammate screens cannot automatically reduce an individual's draft or earn credit for a noncontributor.
- Teacher admission retains the previously disclosed broad trusted academic permissions. This is not a full per-class server ACL migration. Owner-only provider connection fields remain in Firestore for compatibility; this is not a backend secret-vault migration.
- The new rules are a **prototype for review**, not an institution-wide security certification. They require matching-site rollout and regression checks before deployment. Unknown future nested collections default to denied client writes and need deliberate rules and tests.

## Verification

Pure regressions cover deterministic conflicts, timestamps, XML semantics, live GitHub ID linkage, retry/cancellation/schema errors, queue eligibility/recovery and parallel role lookups. Real Firestore tests cover immutable root revisions and nested-write bypasses, directory-only non-escalation, existing private workspaces/grades/evidence and explicit library/practice compatibility. The synthetic Auth/Firestore browser lifecycle exercises service failure and malformed-output fallbacks, manual overrides, mobile drawers, deliberately confirmed publication, review/V2 exclusions and no replay after refresh. External GitHub/evaluation/Google libraries are mocked; this does not assert real provider quality or real Google sign-in.

## Reusable implementation patterns

The complete wired JavaScript modules are `services/grade-version.mjs`, `services/request-backoff.mjs`, `services/publication-queue.mjs`, `grade-publication.mjs`, `review-ui.mjs` and `feedback-drawer.mjs` under `js/repo-review/`. Keep the existing authenticated transaction/audit and V2 guards when reusing them; a visual button is not an authorization boundary.

Use the retry/parser pair with the checker's fixed, trusted provider endpoint and authenticated request options, never a student-supplied destination:

```javascript
import {createBackoffClient,evaluationJSON} from "./services/request-backoff.mjs";

const client=createBackoffClient({scope:"evaluation",signal});
const response=await client.fetch(endpoint,requestOptions);
const suggestion=await evaluationJSON(response);
```

Handle a rejected promise in the view by exposing manual inputs and the retry deadline; do not replace the teacher's fields or treat this parsed object as a published grade. The existing checker additionally validates the rubric/score schema before accepting a draft.

The persistent toolbar pattern below replaces, rather than duplicates, the existing quarter toolbar controls. The view controller derives the count and disabled state from freshly loaded server grades and the explicit recovery journal:

```html
<div class="flex flex-wrap items-center justify-between gap-3">
  <p id="gbQuarterRecovery" role="status" class="text-sm text-slate-600"></p>
  <button id="gbQuarterPublish" type="button" disabled
    class="rounded-lg border border-blue-600 bg-white px-3 py-2 text-sm font-bold text-blue-700 disabled:opacity-50">
    Publish (0 Drafts)
  </button>
</div>
```

Use one vertical scrolling body inside a viewport-bounded dialog. Code expands in that body rather than adding its own height-limited vertical viewport:

```html
<section role="dialog" aria-modal="true" aria-labelledby="reviewTitle"
  class="flex w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white"
  style="max-height:calc(100dvh - 16px)">
  <header class="shrink-0 p-4"><h2 id="reviewTitle">Review &amp; Grade</h2></header>
  <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
    <pre class="max-h-none whitespace-pre-wrap break-words"></pre>
  </div>
  <footer class="flex shrink-0 flex-wrap justify-end gap-2 border-t p-4"></footer>
</section>
```

Retain close/discard confirmation, focus management, mobile wrapping and the existing protected save/publication handlers when adapting the layout.

Sources for the implementation boundaries: [Firebase overlapping rules](https://firebase.google.com/docs/rules/rules-behavior) and [GitHub REST rate-limit handling](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
