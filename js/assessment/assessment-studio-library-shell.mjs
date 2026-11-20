const host=document.getElementById("schoolAssessmentStudioHost");

if(host){
  const style=document.createElement("style");
  style.textContent=`
    #schoolAssessmentStudioHost{min-width:0}
    #schoolAssessmentStudioHost .tl-muted{font-size:.82rem;color:#64748b}
    #schoolAssessmentStudioHost #tl-list{display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:1rem}
    #schoolAssessmentStudioHost .tl-row{
      display:flex;flex-direction:column;min-height:220px;padding:0;overflow:hidden;
      border:1px solid #e2e8f0;border-radius:14px;background:#fff;box-shadow:0 1px 2px #0f172a0d;
      transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease
    }
    #schoolAssessmentStudioHost .tl-row:hover{transform:translateY(-1px);box-shadow:0 12px 30px #0f172a14;border-color:#cbd5e1}
    #schoolAssessmentStudioHost .tl-row>div:first-child{
      width:100%;min-height:108px;padding:1rem 1rem .9rem;background:#1e293b;color:#fff
    }
    #schoolAssessmentStudioHost .tl-row>div:first-child h3{font-size:1rem;line-height:1.35;color:#fff}
    #schoolAssessmentStudioHost .tl-row>div:first-child .tl-muted{margin-top:.4rem;color:#cbd5e1;line-height:1.45}
    #schoolAssessmentStudioHost .tl-row>.tl-actions{
      width:100%;margin-top:auto;padding:.9rem 1rem 1rem;display:flex;flex-wrap:wrap;gap:.45rem;background:#fff
    }
    #schoolAssessmentStudioHost .tl-action{
      min-height:39px;border:0;border-radius:8px;background:#2563eb;color:#fff;font:inherit;
      font-size:.78rem;font-weight:800;padding:.5rem .78rem;cursor:pointer
    }
    #schoolAssessmentStudioHost .tl-action:hover{filter:brightness(.96)}
    #schoolAssessmentStudioHost .tl-action.alt{background:#e2e8f0;color:#0f172a}
    #schoolAssessmentStudioHost .tl-action:disabled{opacity:.5;cursor:not-allowed}
    #schoolAssessmentStudioHost .tl-input{
      min-height:44px;width:100%;border:1px solid #cbd5e1;border-radius:9px;padding:.7rem .78rem;
      margin:.3rem 0 .9rem;font:inherit;background:#fff;color:#0f172a
    }
    #schoolAssessmentStudioHost textarea.tl-input{min-height:unset;resize:vertical}
    #schoolAssessmentStudioHost .tl-dialog{
      border:0;border-radius:16px;max-width:min(820px,calc(100vw - 1.25rem));width:100%;
      max-height:calc(100dvh - 1.25rem);overflow:auto;padding:0;box-shadow:0 24px 90px #02061766
    }
    #schoolAssessmentStudioHost .tl-dialog::backdrop{background:#020617b8;backdrop-filter:blur(4px)}
    #schoolAssessmentStudioHost .tl-dialog-inner{padding:0;background:#f8fafc}
    #schoolAssessmentStudioHost .tl-dialog-body{padding:1rem}
    #schoolAssessmentStudioHost .tl-dialog-footer{
      position:sticky;bottom:0;display:flex;justify-content:flex-end;flex-wrap:wrap;gap:.55rem;
      border-top:1px solid #e2e8f0;background:#fff;padding:1rem
    }
    #schoolAssessmentStudioHost .tl-section{border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:1rem}
    #schoolAssessmentStudioHost .tl-section+.tl-section{margin-top:.85rem}
    #schoolAssessmentStudioHost .tl-actions{display:flex;flex-wrap:wrap;gap:.5rem}
    #schoolAssessmentStudioHost [hidden]{display:none!important}
    #schoolAssessmentStudioHost .tl-empty{
      grid-column:1/-1;border:2px dashed #cbd5e1;border-radius:14px;background:#f8fafc;
      padding:3rem 1rem;text-align:center;color:#64748b;font-size:.9rem
    }
    @media(min-width:760px){#schoolAssessmentStudioHost #tl-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(min-width:1120px){#schoolAssessmentStudioHost #tl-list{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:700px){
      #schoolAssessmentStudioHost .tl-dialog{height:calc(100dvh - .5rem);max-height:none;max-width:100vw;border-radius:16px 16px 0 0;margin:auto 0 0}
      #schoolAssessmentStudioHost .tl-dialog-body{padding:.8rem}
    }
  `;
  document.head.append(style);

  host.innerHTML=`
    <div class="mb-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
      <p id="tl-status" class="text-sm text-slate-600" role="status" aria-live="polite">Checking verified school access…</p>
      <div id="tl-school-switcher" hidden class="w-full lg:w-auto lg:min-w-[230px]"></div>
    </div>

    <section id="tl-workspace" hidden>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="text-xs font-extrabold uppercase tracking-wider text-slate-500">Assessment blueprints</p>
          <p class="mt-1 text-xs text-slate-500">Create once, then choose how learners respond when you deploy.</p>
        </div>        <div class="flex flex-wrap gap-2">
          <button id="tl-refresh" class="tl-action alt" type="button">Refresh</button>
        </div>
      </div>
      <div id="tl-list" role="list"></div>
    </section>

    <dialog id="tl-editor-dialog" class="tl-dialog" aria-labelledby="tl-editor-heading">
      <form class="tl-dialog-inner" id="tl-create">
        <header class="bg-slate-800 px-5 py-5 text-white">
          <p class="text-[10px] font-extrabold uppercase tracking-[.18em] text-cyan-300">Assessment Studio</p>
          <h2 id="tl-editor-heading" class="mt-1 text-xl font-extrabold">Create Assessment</h2>
          <p class="mt-1 text-xs leading-5 text-slate-300">Define the academic task and rubric here. Submission method, class and schedule are chosen when you deploy.</p>
        </header>
        <div class="tl-dialog-body">
          <section class="tl-section">
            <h3 class="font-extrabold text-slate-900">1. Task details</h3>
            <p class="mt-1 mb-3 text-xs text-slate-500">These are the learner-facing assessment details.</p>
            <label class="text-sm font-bold text-slate-700">Assessment title *
              <input name="title" class="tl-input" maxlength="140" required placeholder="e.g. Encapsulation mini performance task">
            </label>
            <div class="grid sm:grid-cols-3 gap-3">
              <label class="text-sm font-bold text-slate-700">Subject *
                <input name="subject" class="tl-input" maxlength="120" required value="General" placeholder="e.g. Computer Programming">
              </label>
              <label class="text-sm font-bold text-slate-700">Assessment type *
                <select name="assessmentType" class="tl-input">
                  <option value="Assessment">Assessment</option>
                  <option value="Written Work">Written Work</option>
                  <option value="Performance Task">Performance Task</option>
                  <option value="Mini PETA">Mini PETA</option>
                  <option value="Practical Exam">Practical Exam</option>
                  <option value="Formative">Formative</option>
                  <option value="Quiz">Quiz</option>
                </select>
              </label>
              <label class="text-sm font-bold text-slate-700">Default response *
                <select name="defaultSubmissionSource" class="tl-input">
                  <option value="text">Written response</option>
                  <option value="link">Submission link</option>
                  <option value="studio">Adminerva Studio</option>
                  <option value="github">GitHub / Repository</option>
                </select>
              </label>
            </div>
            <div id="tl-studio-project-profile-wrap" hidden class="rounded-xl border border-cyan-200 bg-cyan-50 p-3">
              <label class="text-sm font-bold text-cyan-950">Studio project setup
                <select name="studioProjectProfile" class="tl-input">
                  <option value="auto">Auto · infer conservatively from the task</option>
                  <option value="java-console">Java Console · fundamentals / OOP / CLI</option>
                  <option value="java-desktop">Java Desktop · Swing / AWT / GUI</option>
                  <option value="java-database">Java + Database · console + Adminerva DB / JDBC / SQL</option>
                  <option value="java-desktop-database">Java Desktop + Database · Swing / AWT + DB</option>
                  <option value="web">Web · HTML / CSS / JavaScript</option>
                  <option value="python-console">Python Console</option>
                </select>
              </label>
              <p class="mt-1 text-xs text-cyan-900">This controls the project Adminerva creates when a learner opens the assessment. Auto will not assume a GUI or database unless the task explicitly requires one.</p>
            </div>
            <label class="text-sm font-bold text-slate-700">Short description
              <textarea name="description" class="tl-input" maxlength="2000" rows="3" placeholder="A concise teacher/library summary."></textarea>
            </label>
            <label class="text-sm font-bold text-slate-700">Student instructions
              <textarea name="instructions" class="tl-input" maxlength="20000" rows="6" placeholder="What learners must do, produce, submit, and observe."></textarea>
            </label>
          </section>

          <section class="tl-section">
            <h3 class="font-extrabold text-slate-900">2. Rubric</h3>
            <p class="mt-1 mb-3 text-xs text-slate-500">Use one criterion per line in the format <strong>Criterion | points</strong>.</p>
            <label class="text-sm font-bold text-slate-700">Published evaluation criteria
              <textarea name="rubric" class="tl-input font-mono text-sm" rows="7" maxlength="4000" placeholder="Task requirements | 10&#10;Correctness | 10&#10;Clarity | 5"></textarea>
            </label>
          </section>

          <section class="tl-section">
            <h3 class="font-extrabold text-slate-900">3. Assessment mode</h3>
            <label class="mt-3 block text-sm font-bold text-slate-700">Mode
              <select name="personalizationMode" id="tl-personalization-mode" class="tl-input">
                <option value="standard">Standard · same task for the class</option>
                <option value="personalized">Personalized · unique Adminerva Studio task per learner attempt</option>
              </select>
            </label>
            <div id="tl-personalization-fields" hidden class="rounded-xl border border-violet-200 bg-violet-50 p-3">
              <label class="text-sm font-bold text-violet-950">Private variant pool target
                <input name="variantTarget" type="number" min="10" max="600" value="30" class="tl-input">
              </label>
              <label class="text-sm font-bold text-violet-950">Variation guidance
                <textarea name="variationGuidance" class="tl-input" maxlength="3000" rows="4" placeholder="What may vary and what must remain fixed across learner scenarios."></textarea>
              </label>
              <p class="text-xs text-violet-900">Personalized mode currently deploys through Adminerva Studio and assigns frozen private variants.</p>
            </div>
          </section>

          <details class="tl-section">
            <summary class="cursor-pointer font-extrabold text-slate-900">Teacher-only checking guidance</summary>
            <p class="mt-2 text-xs text-slate-500">Private evaluator instructions, accepted alternatives, exclusions, or evidence requirements. Never shown to students.</p>
            <textarea name="checkingInstructions" class="tl-input" maxlength="8000" rows="5" placeholder="Optional private checking instructions."></textarea>
          </details>
        </div>
        <footer class="tl-dialog-footer">
          <button type="button" id="tl-editor-cancel" class="tl-action alt">Cancel</button>
          <button class="tl-action" type="submit">Save Assessment</button>
        </footer>
      </form>
    </dialog>

    <dialog id="tl-share-dialog" class="tl-dialog">
      <form id="tl-share-form" class="tl-dialog-inner">
        <header class="bg-slate-800 px-5 py-5 text-white"><h2 class="text-xl font-extrabold">Share Assessment</h2><p id="tl-share-title" class="mt-1 text-xs text-slate-300"></p></header>
        <div class="tl-dialog-body">
          <section class="tl-section">
            <fieldset>
              <legend class="font-extrabold">Audience</legend>
              <label class="block py-2"><input type="radio" name="visibility" value="private" checked> Only me</label>
              <label class="block py-2"><input type="radio" name="visibility" value="selected_teachers"> Selected teachers</label>
              <label class="block py-2"><input type="radio" name="visibility" value="school_teachers"> All active teachers at this school</label>
            </fieldset>
            <div id="tl-recipient-container" hidden class="mt-3">
              <p class="font-bold mb-2">Choose teachers</p>
              <div id="tl-recipients" class="max-h-60 overflow-y-auto rounded-lg border p-2"></div>
            </div>
            <p class="mt-3 text-xs text-slate-500">Recipients may preview and make independent copies. Your private checking instructions, submissions and grades are not shared.</p>
          </section>
        </div>
        <footer class="tl-dialog-footer"><button type="button" class="tl-action alt" id="tl-cancel-share">Cancel</button><button type="submit" class="tl-action">Save sharing</button></footer>
      </form>
    </dialog>

    <dialog id="tl-preview-dialog" class="tl-dialog">
      <div class="tl-dialog-inner">
        <header class="bg-slate-800 px-5 py-5 text-white"><h2 id="tl-preview-heading" class="text-xl font-extrabold"></h2><p id="tl-preview-meta" class="mt-1 text-xs text-slate-300"></p></header>
        <div class="tl-dialog-body">
          <section class="tl-section"><h3 class="font-extrabold">Student view details</h3><p id="tl-preview-description" class="mt-2 whitespace-pre-wrap text-sm text-slate-700"></p><p id="tl-preview-instructions" class="mt-3 whitespace-pre-wrap text-sm text-slate-700"></p></section>
          <section class="tl-section"><h3 class="font-extrabold">Rubric</h3><ul id="tl-preview-rubric" class="mt-2 list-disc pl-5 text-sm text-slate-700"></ul></section>
          <p id="tl-preview-personalization" class="mt-3 text-xs text-slate-500"></p>
        </div>
        <footer class="tl-dialog-footer"><button type="button" id="tl-preview-close" class="tl-action alt">Close</button></footer>
      </div>
    </dialog>

    <dialog id="tl-personalization-dialog" class="tl-dialog">
      <div class="tl-dialog-inner">
        <header class="bg-slate-800 px-5 py-5 text-white"><h2 class="text-xl font-extrabold">Personalized Variants</h2><p id="tl-personalization-title" class="mt-1 text-xs text-slate-300"></p></header>
        <div class="tl-dialog-body">
          <section class="tl-section border-violet-200"><p id="tl-personalization-status" class="text-sm text-violet-950" role="status"></p><div id="tl-personalization-samples" class="grid gap-2 mt-3"></div></section>
          <section class="tl-section">
            <div class="tl-actions"><button id="tl-personalization-copy" type="button" class="tl-action alt">Copy next external AI package</button><button id="tl-personalization-activate" type="button" class="tl-action">Activate pool</button></div>
            <label class="mt-4 block text-sm font-bold">External response JSON<textarea id="tl-personalization-response" class="tl-input font-mono text-xs" rows="9"></textarea></label>
          </section>
        </div>
        <footer class="tl-dialog-footer"><button id="tl-personalization-import" type="button" class="tl-action">Import variants</button><button id="tl-personalization-close" type="button" class="tl-action alt">Close</button></footer>
      </div>
    </dialog>

    <dialog id="tl-deploy-dialog" class="tl-dialog">
      <form id="tl-deploy-form" class="tl-dialog-inner">
        <header class="bg-slate-800 px-5 py-5 text-white"><p class="text-[10px] font-extrabold uppercase tracking-[.18em] text-cyan-300">Deployment</p><h2 class="mt-1 text-xl font-extrabold">Deploy Assessment</h2><p id="tl-deploy-title" class="mt-1 text-xs text-slate-300"></p></header>
        <div class="tl-dialog-body">
          <section class="tl-section">
            <label class="text-sm font-bold">Assigned class / subject
              <select name="offeringId" class="tl-input" id="tl-deploy-offering" required></select>
            </label>
            <label class="text-sm font-bold">How will learners respond?
              <select name="submissionSource" class="tl-input" required>
                <option value="text">Written response in Adminerva</option>
                <option value="link">Submission link</option>
                <option value="studio">Adminerva Studio project</option>
                <option value="github">GitHub / repository evidence</option>
              </select>
            </label>
            <label id="tl-manual-exam-option" class="mt-3 flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950" hidden>
              <input name="manualOpenRequired" type="checkbox" class="mt-1 h-4 w-4 shrink-0">
              <span><strong>Teacher-controlled opening</strong><span class="mt-1 block text-xs">Publish the Studio exam in advance, but keep its instructions, personalized task and project launch locked until the responsible teacher selects Open exam for this section. Opening and holding are controlled separately for each deployment.</span></span>
            </label>
            <p class="text-xs text-slate-600">Set a deadline later than the opening reference time. For scheduled assessments, the opening time controls availability; for teacher-controlled Studio exams, the teacher's Open exam action controls the start. Deadline enforcement continues in both modes. Students cannot submit before publication.</p>
            <div class="grid sm:grid-cols-2 gap-3">
              <label class="text-sm font-bold">Opens at<input name="opensAt" type="datetime-local" class="tl-input" required></label>
              <label class="text-sm font-bold">Deadline<input name="dueAt" type="datetime-local" class="tl-input" required></label>
            </div>
            <label class="mt-3 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <input name="allowLateSubmissions" type="checkbox" class="mt-1 h-4 w-4 shrink-0">
              <span><strong>Allow late submissions</strong><span class="mt-1 block text-xs">Students may submit after the deadline while this deployment remains active. Adminerva still records the original deadline and submission time.</span></span>
            </label>
            <p class="text-xs text-slate-500">The current instructions, rubric and private checking guidance are frozen for this deployment. Deployment remains private until you publish it.</p>
          </section>
        </div>
        <footer class="tl-dialog-footer"><button type="button" id="tl-cancel-deploy" class="tl-action alt">Cancel</button><button type="submit" class="tl-action">Deploy Assessment</button></footer>
      </form>
    </dialog>

    <dialog id="tl-deployment-settings-dialog" class="tl-dialog">
      <form id="tl-deployment-settings-form" class="tl-dialog-inner">
        <header class="bg-slate-800 px-5 py-5 text-white">
          <p class="text-[10px] font-extrabold uppercase tracking-[.18em] text-cyan-300">Deployment settings</p>
          <h2 class="mt-1 text-xl font-extrabold">Edit Assessment Deployment</h2>
          <p id="tl-deployment-settings-title" class="mt-1 text-xs text-slate-300"></p>
        </header>
        <div class="tl-dialog-body">
          <section class="tl-section">
            <p class="mb-3 text-xs text-slate-500">These settings affect the deployed class task. The frozen task instructions, rubric and personalized pool remain unchanged.</p>
            <div class="grid sm:grid-cols-2 gap-3">
              <label class="text-sm font-bold">Opens at<input name="opensAt" type="datetime-local" class="tl-input" required></label>
              <label class="text-sm font-bold">Deadline<input name="dueAt" type="datetime-local" class="tl-input" required></label>
            </div>
            <label class="mt-3 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <input name="allowLateSubmissions" type="checkbox" class="mt-1 h-4 w-4 shrink-0">
              <span><strong>Allow late submissions</strong><span class="mt-1 block text-xs">When enabled, new submissions remain accepted after the deadline until the assessment is closed, archived or cancelled.</span></span>
            </label>
            <label class="mt-3 block text-sm font-bold">Reason for change
              <textarea name="reason" class="tl-input" minlength="12" maxlength="1000" rows="3" required placeholder="Explain the schedule or submission-policy change."></textarea>
            </label>
          </section>
        </div>
        <footer class="tl-dialog-footer"><button type="button" id="tl-deployment-settings-cancel" class="tl-action alt">Cancel</button><button type="submit" class="tl-action">Save deployment settings</button></footer>
      </form>
    </dialog>

    <dialog id="tl-lifecycle-dialog" class="tl-dialog">
      <form id="tl-lifecycle-form" class="tl-dialog-inner">
        <header class="bg-slate-800 px-5 py-5 text-white"><h2 id="tl-lifecycle-heading" class="text-xl font-extrabold">Update deployment</h2><p id="tl-lifecycle-task" class="mt-1 text-xs text-slate-300"></p></header>
        <div class="tl-dialog-body">
          <section class="tl-section"><p id="tl-lifecycle-help" class="text-sm text-slate-700 mb-3"></p><label class="text-sm font-bold">Reason<textarea name="reason" class="tl-input" minlength="12" maxlength="1000" rows="3" required></textarea></label><label id="tl-lifecycle-deadline-field" hidden class="text-sm font-bold">New deadline<input name="newDueAt" type="datetime-local" class="tl-input"></label></section>
        </div>
        <footer class="tl-dialog-footer"><button type="button" id="tl-lifecycle-cancel" class="tl-action alt">Cancel</button><button type="submit" class="tl-action">Save change</button></footer>
      </form>
    </dialog>


  `;

  await import("../repo-review/teacher-assessment-library.mjs?v=20261120-classroom-deploy");
}
