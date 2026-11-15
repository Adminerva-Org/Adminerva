import {auth} from "../core/firebase-core.js?v=1.3.0";

const host=document.getElementById("schoolAssessmentStudioHost");
const general=document.getElementById("schoolAssessmentWorkspace");
const legacy=document.getElementById("legacyRepositoryWorkspace");
const newButton=document.getElementById("tl-new-assessment");
const repoTab=document.getElementById("assessment-repository-tab");

if(host&&general&&legacy){
  document.body.dataset.assessmentShell="studio";

  const style=document.createElement("style");
  style.textContent=`
    #schoolAssessmentStudioHost{min-width:0}
    #schoolAssessmentStudioHost .tl-grid{display:block}
    #schoolAssessmentStudioHost .tl-card{min-width:0}
    #schoolAssessmentStudioHost .tl-muted{font-size:.82rem;color:#64748b}
    #schoolAssessmentStudioHost #tl-list{display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:1rem}
    #schoolAssessmentStudioHost .tl-row{display:flex;flex-direction:column;min-height:190px;border:1px solid #e2e8f0;border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 1px 2px #0f172a0d;padding:0;transition:box-shadow .15s ease,transform .15s ease}
    #schoolAssessmentStudioHost .tl-row:hover{box-shadow:0 10px 28px #0f172a14;transform:translateY(-1px)}
    #schoolAssessmentStudioHost .tl-row>div:first-child{width:100%;padding:1rem 1rem .85rem;background:#1e293b;color:#fff;min-height:94px}
    #schoolAssessmentStudioHost .tl-row>div:first-child h3{font-size:1rem;line-height:1.35;color:#fff}
    #schoolAssessmentStudioHost .tl-row>div:first-child .tl-muted{color:#cbd5e1;margin-top:.35rem;line-height:1.45}
    #schoolAssessmentStudioHost .tl-row>.tl-actions{width:100%;margin-top:auto;padding:.85rem 1rem 1rem;display:flex;flex-wrap:wrap;gap:.45rem}
    #schoolAssessmentStudioHost .tl-action{min-height:38px;border:0;border-radius:8px;background:#2563eb;color:#fff;font:inherit;font-size:.78rem;font-weight:700;padding:.5rem .75rem;cursor:pointer}
    #schoolAssessmentStudioHost .tl-action.alt{background:#e2e8f0;color:#0f172a}
    #schoolAssessmentStudioHost .tl-action:disabled{opacity:.5;cursor:not-allowed}
    #schoolAssessmentStudioHost .tl-input{min-height:44px;width:100%;border:1px solid #cbd5e1;border-radius:9px;padding:.65rem .75rem;margin:.3rem 0 .9rem;font:inherit;background:#fff}
    #schoolAssessmentStudioHost .tl-dialog{border:0;border-radius:16px;max-width:min(720px,calc(100vw - 1.5rem));width:100%;max-height:calc(100dvh - 2rem);overflow:auto;padding:0;box-shadow:0 24px 90px #02061766}
    #schoolAssessmentStudioHost .tl-dialog::backdrop{background:#020617b8;backdrop-filter:blur(3px)}
    #schoolAssessmentStudioHost .tl-dialog-inner{padding:1.1rem;background:#fff}
    #schoolAssessmentStudioHost .tl-actions{display:flex;flex-wrap:wrap;gap:.5rem}
    #schoolAssessmentStudioHost [hidden]{display:none!important}
    @media(min-width:760px){#schoolAssessmentStudioHost #tl-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(min-width:1120px){#schoolAssessmentStudioHost #tl-list{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:700px){#schoolAssessmentStudioHost .tl-dialog{height:calc(100dvh - .75rem);max-height:none;max-width:100vw;border-radius:16px 16px 0 0;margin:auto 0 0}}
  `;
  document.head.append(style);

  host.innerHTML=`
    <div class="mb-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
      <div>
        <p id="tl-status" class="text-sm text-slate-600" role="status" aria-live="polite">Checking verified school access…</p>
      </div>
      <div id="tl-school-switcher" hidden class="w-full lg:w-auto lg:min-w-[220px]"></div>
    </div>

    <section id="tl-workspace" hidden>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs font-bold uppercase tracking-wider text-slate-500">School-scoped assessment library</p>
        <div class="flex flex-wrap gap-2">
          <button id="tl-refresh" class="tl-action alt" type="button">Refresh</button>
          <button id="tl-import-legacy" class="tl-action alt" type="button">Import Repository assessments</button>
        </div>
      </div>
      <div id="tl-list" role="list"></div>
    </section>

    <dialog id="tl-editor-dialog" class="tl-dialog">
      <form class="tl-dialog-inner" id="tl-create">
        <header class="-m-[1.1rem] mb-5 bg-slate-800 text-white p-5 rounded-t-2xl">
          <p class="text-xs uppercase tracking-wider font-bold text-cyan-300">Assessment blueprint</p>
          <h2 class="text-xl font-bold mt-1">New private blueprint</h2>
          <p class="text-xs text-slate-300 mt-1">Create the academic task once, then choose the submission method when you deploy it.</p>
        </header>
        <label class="text-sm font-bold">Title<input name="title" class="tl-input" maxlength="140" required></label>
        <label class="text-sm font-bold">Description<textarea name="description" class="tl-input" maxlength="2000" rows="3"></textarea></label>
        <label class="text-sm font-bold">Student instructions<textarea name="instructions" class="tl-input" maxlength="20000" rows="5"></textarea></label>
        <label class="text-sm font-bold">Teacher checking instructions <span class="font-normal text-slate-500">(private)</span>
          <textarea name="checkingInstructions" class="tl-input" maxlength="8000" rows="4" placeholder="Accepted alternatives, exclusions, evidence requirements, or grading notes."></textarea>
        </label>
        <label class="text-sm font-bold">Assessment mode
          <select name="personalizationMode" id="tl-personalization-mode" class="tl-input">
            <option value="standard">Standard · same task for the class</option>
            <option value="personalized">Personalized · unique Studio task per learner attempt</option>
          </select>
        </label>
        <div id="tl-personalization-fields" hidden class="rounded-xl border border-violet-200 bg-violet-50 p-3 mb-3">
          <label class="text-sm font-bold">Private pool target
            <input name="variantTarget" type="number" min="10" max="600" value="30" class="tl-input">
          </label>
          <label class="text-sm font-bold">Variation guidance
            <textarea name="variationGuidance" class="tl-input" maxlength="3000" rows="3"></textarea>
          </label>
          <p class="tl-muted">Personalized assessments use Adminerva Studio and keep full prompts/evaluator notes private to the owner.</p>
        </div>
        <label class="text-sm font-bold">Rubric criteria <span class="font-normal text-slate-500">(Criterion | points)</span>
          <textarea name="rubric" class="tl-input" rows="5" maxlength="4000" placeholder="Functionality | 10&#10;Code quality | 5"></textarea>
        </label>
        <p class="tl-muted mb-4">Each criterion must have 1–100 points, with at most 20 criteria.</p>
        <div class="tl-actions justify-end">
          <button type="button" id="tl-editor-cancel" class="tl-action alt">Cancel</button>
          <button class="tl-action" type="submit">Create private assessment</button>
        </div>
      </form>
    </dialog>

    <dialog id="tl-share-dialog" class="tl-dialog">
      <form id="tl-share-form" class="tl-dialog-inner">
        <h2 class="text-xl font-bold">Share assessment</h2>
        <p class="tl-muted" id="tl-share-title"></p>
        <fieldset class="my-3">
          <legend class="font-bold mb-2">Audience</legend>
          <label class="block py-2"><input type="radio" name="visibility" value="private" checked> Only me</label>
          <label class="block py-2"><input type="radio" name="visibility" value="selected_teachers"> Selected teachers</label>
          <label class="block py-2"><input type="radio" name="visibility" value="school_teachers"> All active teachers at this school</label>
        </fieldset>
        <div id="tl-recipient-container" hidden>
          <p class="font-bold mb-2">Choose teachers</p>
          <div id="tl-recipients" class="max-h-60 overflow-y-auto border rounded-lg p-2"></div>
        </div>
        <p class="tl-muted my-3">Recipients may preview and make independent copies. Sharing never grants access to submissions, grades, answer keys or your private checking instructions.</p>
        <div class="tl-actions justify-end"><button type="button" class="tl-action alt" id="tl-cancel-share">Cancel</button><button type="submit" class="tl-action">Save sharing</button></div>
      </form>
    </dialog>

    <dialog id="tl-preview-dialog" class="tl-dialog">
      <div class="tl-dialog-inner">
        <h2 id="tl-preview-heading" class="text-xl font-bold"></h2>
        <p id="tl-preview-meta" class="tl-muted mb-4"></p>
        <h3 class="font-bold">Description</h3><p id="tl-preview-description" class="whitespace-pre-wrap text-sm text-slate-700 mt-1"></p>
        <h3 class="font-bold mt-4">Instructions</h3><p id="tl-preview-instructions" class="whitespace-pre-wrap text-sm text-slate-700 mt-1"></p>
        <h3 class="font-bold mt-4">Rubric</h3><ul id="tl-preview-rubric" class="list-disc pl-5 text-sm text-slate-700 mt-1"></ul>
        <p id="tl-preview-personalization" class="tl-muted mt-3"></p>
        <div class="tl-actions justify-end mt-4"><button type="button" id="tl-preview-close" class="tl-action alt">Close</button></div>
      </div>
    </dialog>

    <dialog id="tl-personalization-dialog" class="tl-dialog">
      <div class="tl-dialog-inner">
        <h2 class="text-xl font-bold">Private personalization pool</h2>
        <p id="tl-personalization-title" class="tl-muted"></p>
        <div class="rounded-xl border border-violet-200 bg-violet-50 p-3 my-3">
          <p id="tl-personalization-status" class="text-sm text-violet-950" role="status"></p>
          <div id="tl-personalization-samples" class="grid gap-2 mt-3"></div>
        </div>
        <div class="tl-actions">
          <button id="tl-personalization-copy" type="button" class="tl-action alt">Copy next external AI package</button>
          <button id="tl-personalization-activate" type="button" class="tl-action">Activate pool</button>
        </div>
        <label class="block mt-4 text-sm font-bold">External response JSON
          <textarea id="tl-personalization-response" class="tl-input font-mono text-xs" rows="9"></textarea>
        </label>
        <div class="tl-actions justify-end"><button id="tl-personalization-import" type="button" class="tl-action">Import variants</button><button id="tl-personalization-close" type="button" class="tl-action alt">Close</button></div>
      </div>
    </dialog>

    <dialog id="tl-deploy-dialog" class="tl-dialog">
      <form id="tl-deploy-form" class="tl-dialog-inner">
        <h2 class="text-xl font-bold">Deploy to my class</h2>
        <p id="tl-deploy-title" class="tl-muted mb-3"></p>
        <label class="text-sm font-bold">Assigned course offering<select name="offeringId" class="tl-input" id="tl-deploy-offering" required></select></label>
        <label class="text-sm font-bold">Student response / submission method
          <select name="submissionSource" class="tl-input" required>
            <option value="text">Written response in Adminerva</option>
            <option value="link">Submission link</option>
            <option value="studio">Adminerva Studio project</option>
            <option value="github">GitHub / repository evidence</option>
          </select>
        </label>
        <div class="grid sm:grid-cols-2 gap-3">
          <label class="text-sm font-bold">Opens at<input name="opensAt" type="datetime-local" class="tl-input" required></label>
          <label class="text-sm font-bold">Deadline<input name="dueAt" type="datetime-local" class="tl-input" required></label>
        </div>
        <p class="tl-muted">The rubric, instructions and private checking guidance are frozen at deployment.</p>
        <div class="tl-actions justify-end mt-4"><button type="button" id="tl-cancel-deploy" class="tl-action alt">Cancel</button><button type="submit" class="tl-action">Deploy task</button></div>
      </form>
    </dialog>

    <dialog id="tl-lifecycle-dialog" class="tl-dialog">
      <form id="tl-lifecycle-form" class="tl-dialog-inner">
        <h2 id="tl-lifecycle-heading" class="text-xl font-bold">Update deployment</h2>
        <p id="tl-lifecycle-task" class="tl-muted"></p>
        <p id="tl-lifecycle-help" class="text-sm text-slate-700 my-3"></p>
        <label class="text-sm font-bold">Reason<textarea name="reason" class="tl-input" minlength="12" maxlength="1000" rows="3" required></textarea></label>
        <label id="tl-lifecycle-deadline-field" hidden class="text-sm font-bold">New deadline<input name="newDueAt" type="datetime-local" class="tl-input"></label>
        <div class="tl-actions justify-end"><button type="button" id="tl-lifecycle-cancel" class="tl-action alt">Cancel</button><button type="submit" class="tl-action">Save change</button></div>
      </form>
    </dialog>

    <dialog id="tl-legacy-dialog" class="tl-dialog">
      <div class="tl-dialog-inner">
        <h2 class="text-xl font-bold">Import Repository Management assessments</h2>
        <p class="tl-muted mt-1">Copies only the academic blueprint. Historical repository deployments, submissions, evidence and grades remain unchanged.</p>
        <p id="tl-legacy-status" class="tl-muted my-3" role="status">Loading…</p>
        <div id="tl-legacy-list" class="grid gap-2 my-3"></div>
        <div class="tl-actions justify-end"><button id="tl-legacy-close" type="button" class="tl-action alt">Close</button></div>
      </div>
    </dialog>
  `;

  const showGeneral=()=>{
    general.hidden=false;legacy.hidden=true;
    if(newButton)newButton.hidden=false;
    if(repoTab)repoTab.setAttribute("aria-pressed","false");
  };
  const showLegacy=()=>{
    general.hidden=true;legacy.hidden=false;
    if(newButton)newButton.hidden=true;
    document.querySelectorAll("[data-filter]").forEach(button=>button.setAttribute("aria-pressed","false"));
    if(repoTab)repoTab.setAttribute("aria-pressed","true");
    const url=new URL(location.href);url.searchParams.set("view","repository");history.replaceState(null,"",url);
  };
  document.querySelectorAll("[data-filter]").forEach(button=>button.addEventListener("click",showGeneral));
  repoTab?.addEventListener("click",showLegacy);

  const requested=new URL(location.href).searchParams.get("view");
  if(requested==="repository")showLegacy();else showGeneral();

  await import("../repo-review/teacher-assessment-library.mjs?v=20261115-studio-shell2");
  if(requested==="repository")showLegacy();
}
