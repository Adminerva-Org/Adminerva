# Practice and assigned-access rollout

This runbook supersedes earlier review-only deployment boundaries for this
candidate. An owner's request to finish and deploy is not permission to guess
teaching assignments, silently reattribute legacy material, publish grades or
enable optional monitoring. Obtain the separate access-preparation decision.

## Preflight

1. Validate the exact PR head: pure tests, emulator permissions, browser lifecycle
   and hosted CI/CodeQL. Browser practice calls use the production service through
   a local authenticated callable gateway, not deployed Functions.
2. Confirm `reporeview-e7ca4`, Standard Firestore, the administrator account and
   the actual GitHub Pages source. Preserve live rules, function configuration,
   index/TTL inventory and website revision outside the public repository.
3. Dry-run `scripts/prepare-academic-access.cjs` using an authorized operator's
   Application Default Credentials, explicit `--project` and verified admin
   `--actor-uid`. It prints aggregate counts and a plan digest, not student data.
   The reusable planner/service also supports an authorized in-memory operator
   credential without exporting passwords, access tokens or service-account keys.
4. Review blockers and the exact plan. Apply only after approval with `--apply`,
   `--approved-digest` and `--confirm-metadata-only`. Conflict guards reject changed
   records. Metadata preparation does not change score, feedback, publication,
   evidence revisions or submissions; immutable audits record each operation.
   Legacy ownerless assessments become explicitly administrator-custodied, not
   retrospectively authored by that administrator.
5. Assign teacher sections through the audited Manage Teachers form. No section
   selection means no academic access; private planning remains available. Do not
   infer grants from a directory row or copy all administrator privileges.

## Coordinated release

- Use a controlled release window and preserve unsaved work. Old and new website
  code/rules cannot switch atomically. Existing tabs must reload after rollout.
- Deploy only the reviewed practice callables, teaching-roster trigger and changed
  notification handlers. Do not use an unrestricted Functions deployment that
  deletes unrelated handlers or activates monitoring. Keep the monitoring policy off.
- Merge required indexes/TTL policies with the live inventory. Do not force-delete
  unrelated indexes or expiry policies. Wait for new query indexes to be ready.
- Apply approved metadata preparation before enabling the restrictive rules.
  Deploy the exact reviewed rules and then release the validated website head.
- Verify live asset/version hashes and backend handler state. Probe signed-out
  callable rejection without changing student records. Actual scored/student and
  teacher smoke tests require owner-designated accounts; never manufacture a real
  submission, modify an existing score or publish a grade for a smoke test.
- Public patch notes and account notifications use the new release ID. Provider
  assistance remains disclosed in evaluation details. Scoring is never auto-published.

## Rollback and limits

Do not simply restore broad old teacher rules after restricting access: that could
re-expose raw student connection records. Prefer a corrective reviewed deployment
or temporary read-only module access. Keep verified XP receipts/progress and
preparation audits; do not turn old self-reported totals back into authoritative XP.
Metadata additions are additive and need not be erased to restore compatible UI.

TTL expiry is asynchronous and billable according to the configured provider;
server expiry checks apply immediately. Expiry fields have explicit empty index
overrides because practice uses document lookups, not expiry-field queries. The
override arrays are also required by the deployment configuration validator.
Configure App Check and budget alerts
separately before wider onboarding. Browser keys do not prove who answered; shared
devices cause no automatic penalties. XP remains formative, not a school grade.
