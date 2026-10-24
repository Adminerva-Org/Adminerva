/** Shared static evidence-review markup; user content is rendered separately with text nodes. */
export const evidenceReviewMarkup=`
<section id="evidenceDiscovery" class="hidden bg-white mt-5 p-5 rounded-xl border space-y-3">
<h2 class="font-bold text-lg">Discover historical GitHub evidence</h2>
<p class="text-sm text-slate-600">For assessments already assigned in class: select relevant commits from the linked repository without asking the student to resubmit. This records an instructor-discovered proposal, not a student submission or proof of on-time work.</p>
<button id="evidenceFindCommits" type="button" class="rounded bg-slate-800 text-white px-4 py-3 font-bold text-sm">Find repository commits</button>
<div id="evidenceDiscoverList" class="space-y-2 "></div>
<button id="evidenceFindOlder" type="button" class="hidden rounded border border-indigo-200 bg-indigo-50 text-indigo-900 px-4 py-3 text-sm font-bold">Load older commits</button>
<button id="evidenceSaveDiscovery" type="button" class="rounded bg-indigo-700 text-white px-4 py-3 font-bold text-sm">Save proposed historical evidence</button>
</section>
<section id="evidenceDetails" class="hidden bg-white mt-5 p-5 rounded-xl border space-y-4">
<h2 id="evidenceTitle" class="text-lg font-bold"></h2>
<p id="evidenceMetadata" class="text-sm text-slate-700 break-words"></p>
<div id="evidenceLinks" class="flex flex-wrap gap-4 text-sm"></div>
<h3 class="text-sm font-bold">Selected Git commits</h3>
<p class="text-xs text-slate-600">The boxes below verify individual contribution; they do not change the student's selected commits. Use Reopen (or release a historical proposal) to let the student edit their selection.</p>
<div id="evidenceCommitDetails" class="space-y-3"></div>
<details class="border rounded p-3" open><summary class="font-bold cursor-pointer">Pinned project source — shared context, not individual credit</summary><div id="evidenceSnapshot" class="mt-2"></div></details>
<h3 class="text-sm font-bold">Reclaim requests for this student</h3>
<div id="evidenceReclaims" class="space-y-3"></div>
<label class="block text-sm font-semibold" for="evidenceContributionScope">Additional responsibilities and attribution notes (optional)</label>
<textarea id="evidenceContributionScope" rows="3" maxlength="3000" class="w-full border rounded-lg p-3" placeholder="Add specific responsibilities or exceptions. Your selected verified commits are recorded automatically."></textarea>
<p class="text-xs text-slate-600">Select only commits independently verified as this student's contribution. A selected project checkpoint may contain teammates' work. Leave all contribution boxes empty when no individual work is verified; evaluation will require manual review.</p>
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
