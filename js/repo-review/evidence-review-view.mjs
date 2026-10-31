/** Shared static evidence-review markup; user content is rendered separately with text nodes. */
export const evidenceReviewMarkup=`
<section id="evidenceDiscovery" class="hidden bg-white mt-5 p-5 rounded-xl border space-y-3">
<h2 id="evidenceDiscoveryTitle" class="font-bold text-lg">Discover historical GitHub evidence</h2>
<p id="evidenceDiscoveryHelp" class="text-sm text-slate-600">For assessments already assigned in class: select relevant commits from the linked repository without asking the student to resubmit. This records an instructor-discovered proposal, not a student submission or proof of on-time work.</p>
<button id="evidenceFindCommits" type="button" class="rounded bg-slate-800 text-white px-4 py-3 font-bold text-sm">Find repository commits</button>
<div id="evidenceDiscoverList" class="space-y-2 "></div>
<button id="evidenceFindOlder" type="button" class="hidden rounded border border-indigo-200 bg-indigo-50 text-indigo-900 px-4 py-3 text-sm font-bold">Load older commits</button>
<label id="evidenceDiscoveryNoteLabel" class="hidden block text-sm font-semibold" for="evidenceDiscoveryNote">Teacher attribution note</label>
<textarea id="evidenceDiscoveryNote" rows="3" maxlength="3000" class="hidden w-full border rounded-lg p-3" placeholder="Explain why the added commit belongs to this learner despite the GitHub identity mismatch."></textarea>
<button id="evidenceSaveDiscovery" type="button" class="rounded bg-indigo-700 text-white px-4 py-3 font-bold text-sm">Save proposed historical evidence</button>
</section>
<p id="evidenceReviewStatus" role="status" class="text-sm font-semibold text-indigo-900 mb-3">Loading evidence review…</p>
<section id="evidenceDetails" class="hidden bg-white mt-5 p-5 rounded-xl border space-y-4">
<h2 id="evidenceTitle" class="text-lg font-bold"></h2>
<div id="evidenceLifecycleBanner" role="status" aria-live="polite" class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap items-start justify-between gap-3">
  <div class="flex-1 min-w-0"><strong id="evidenceLifecycleLabel" class="block text-sm font-extrabold">Checking evidence status…</strong>
  <p id="evidenceLifecycleHelp" class="text-xs mt-1 break-words"></p></div>
  <button id="evidenceReloadTop" type="button" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800">Refresh status</button>
</div>
<p id="evidenceMetadata" class="text-sm text-slate-700 break-words"></p>
<div id="evidenceLinks" class="flex flex-wrap gap-4 text-sm"></div>
<h3 class="text-sm font-bold">Selected evidence commits</h3>
<p class="text-xs text-slate-600">These are the commits the student submitted for individual review. The project checkpoint is separate and may be a later teammate commit.</p>
<label class="flex gap-2 items-start rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-950">
<input id="evidenceVerifyAll" type="checkbox" class="mt-1">
<span>Verify all submitted evidence commits as this student's relevant work.</span>
</label>
<details id="evidenceVerificationExceptions" class="border rounded-lg p-3">
<summary class="font-semibold text-sm cursor-pointer">Adjust individual commit verification (optional)</summary>
<p class="text-xs text-slate-600 mt-2">Use this only when a selected commit is shared, disputed, or should not be credited to this student.</p>
<div id="evidenceContributionChecks" class="space-y-2 mt-3"></div>
</details>
<div id="evidenceCommitDetails" class="space-y-2"></div>
<div id="evidenceAttributionOverride" class="rounded-lg border border-amber-200 bg-amber-50 p-3">
  <strong class="block text-sm text-amber-950">Need to add or correct repository evidence?</strong>
  <p class="text-xs text-amber-900 mt-1">After inspecting the commit diff, an instructor can add a repository commit that automatic attribution missed, including unverified or alternate GitHub identities. The commit is not credited until you explicitly verify it and approve the checkpoint.</p>
  <button id="evidenceAddCommit" type="button" class="mt-2 rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-bold text-amber-950">Add / attribute repository commit</button>
</div>
<details class="border rounded p-3"><summary class="font-bold cursor-pointer">Pinned project source — shared context, not individual credit</summary><div id="evidenceSnapshot" class="mt-2"></div></details>
<h3 class="text-sm font-bold">Reclaim requests for this student</h3>
<div id="evidenceReclaims" class="space-y-3"></div>
<label class="block text-sm font-semibold" for="evidenceContributionScope">Additional responsibilities and attribution notes (optional)</label>
<textarea id="evidenceContributionScope" rows="3" maxlength="3000" class="w-full border rounded-lg p-3" placeholder="Add specific responsibilities or exceptions. Your selected verified commits are recorded automatically."></textarea>
<p class="text-xs text-slate-600">A selected project checkpoint may contain teammates' work and does not become individual credit. If none of the submitted evidence commits can be verified for this student, leave verification unchecked and use manual review.</p>
<label id="evidenceReviewNoteLabel" class="block text-sm font-semibold" for="evidenceReviewNote">Additional review note (optional for approval)</label>
<textarea id="evidenceReviewNote" rows="3" maxlength="3000" class="w-full border rounded-lg p-3" placeholder="Approval records your inspection automatically."></textarea>
<label class="flex gap-2 items-start text-sm"><input id="evidenceConfirm" type="checkbox" class="mt-1">
<span>I inspected the project at the selected revision, checked the relevant commits and addressed attribution uncertainties. Git timestamps alone were not used to prove push time.</span></label>
<button id="evidenceApprove" type="button" class="px-5 py-3 bg-emerald-700 text-white font-bold rounded">Approve checkpoint</button>
<button id="evidenceReopen" type="button" class="hidden px-5 py-3 border border-amber-500 text-amber-900 font-bold rounded">Reopen for student changes</button>
<button id="evidenceEditVerification" type="button" class="hidden px-5 py-3 border border-indigo-500 text-indigo-900 font-bold rounded">Revise contribution verification</button>
<button id="evidenceReload" type="button" class="px-4 py-3 border rounded font-bold">Reload evidence</button>
<p id="evidenceActionStatus" role="status" class="text-sm font-semibold text-indigo-900"></p>
<p id="evidenceAuditSummary" class="text-xs text-slate-600"></p>
<p class="text-xs text-slate-500">Approval records the student's assessment checkpoint, not a score. Grading and grade publication remain separate instructor actions.</p>
</section>
`;
