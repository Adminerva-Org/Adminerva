/** Public contextual tutorials and explicit activity preferences; never fetch protected data for guests. */
import {pageForPath} from "../analytics/activity-model.mjs?v=2026.10.19.3";
const guides = {
  home:["Start with your workspace", "Choose a learning or teaching tool. Help, the public Wiki and patch history remain available from every page.", "getting-started"],
  project:["Submit your individual evidence", "Open an assessment, select your committed contributions and a checkpoint, then submit. Withdraw before approval to edit; approved evidence needs instructor reopening.", "evidence"],
  assessments:["Evidence comes first", "Select your own commits and checkpoint. Expand instructions and criteria when needed. A shared repository is not proof of individual authorship.", "evidence"],
  review:["Review → Evaluate → Teacher score", "Inspect the inline evidence and approve verified contributions. Evaluate for an optional draft, explicitly copy any suggestions you accept, then save your teacher score privately. Publication is a separate confirmation.", "review"],
  playground:["Edit, run and preserve your work", "Choose a language, edit your files and Run. Save or export before leaving. XML layouts have their own safe preview in XML Layout Lab.", "learning"],
  "xml-lab":["Try an Android layout", "Edit XML to preview supported widgets and attributes. This is a browser approximation, not an Android runtime. Inspect warnings for unsupported constraints.", "learning"],
  practice:["Practice is not an assessment grade", "Open a mission, practise and record completion. Personal points are self-recorded; class standings require instructor review and explicit alias opt-in.", "learning"],
  grades:["Drafts and published grades differ", "A saved private draft is not student-visible. Check evidence revision, instructor review and protection status before explicitly publishing.", "review"],
  lessons:["Save a lesson before creating slides", "Save your lesson, then open its Slide Editor link for an editable starter. Inspect content and source version before presenting.", "lessons"],
  slides:["Keep your slide edits", "Create a starter from a saved lesson, edit it and save. A newer lesson does not silently replace your slide edits.", "lessons"],
  analytics:["Read signals in context", "Teacher Analytics is for learning summaries. Administration Analytics is for operations and debugging. Optional activity samples are incomplete and never proof of effort or mastery.", "analytics"],
  reports:["Send the right concern to the right role", "System bugs go to administrators. Class concerns may go to teachers. Add reproduction steps and redact private information. Diagnostic trails require your explicit consent.", "support"],
  settings:["Change only your intended settings", "Check the scope before saving. Permission-dependent controls may be unavailable. Preserve local work before changing accounts.", "getting-started"],
  other:["Need a hand?", "Choose a guide in the public Wiki for this module. If loading fails, preserve your work and report the steps needed to reproduce it.", "getting-started"]
};
export function mountHelp() {
  if (document.getElementById("adminerva-help")) return;
  const [title, description, anchor] = guides[pageForPath(location.pathname)];
  const footer = document.createElement("footer"); footer.id = "adminerva-help";
  footer.className = "p-4 border-t border-slate-300 bg-white text-slate-900 text-sm flex flex-wrap items-center justify-center gap-5";
  footer.innerHTML = '<button type="button" class="font-bold underline" id="page-help-open">ⓘ Help / tutorial</button><a class="underline" href="wiki.html">Adminerva Wiki</a><a class="underline" href="patch-notes.html">Patch notes</a>';
  document.body.append(footer);
  const dialog = document.createElement("dialog"); dialog.id = "page-help-dialog";
  dialog.className = "p-6 rounded-xl border border-slate-300 max-w-xl w-[95vw] text-slate-900 bg-white";
  dialog.setAttribute("aria-labelledby", "page-help-title");
  dialog.innerHTML = '<h2 id="page-help-title" class="text-xl font-bold"></h2><p id="page-help-description" class="my-4"></p><a id="page-help-guide" class="underline">Read the full guide</a><details class="my-5"><summary class="font-bold cursor-pointer">Activity preferences (optional)</summary><p class="my-3">No typed text, source code, credentials, full URLs or session recordings. Sharing is off by default. Administrators see operational records; teachers receive only assigned students’ coarse snapshots. Stopping does not delete earlier records. <a class="underline" href="wiki.html#privacy">Privacy and retention details</a></p><label class="block my-2"><input type="checkbox" id="activity-share"> Share module visits and approximate active time</label><label class="block my-2"><input type="checkbox" id="activity-diagnostics"> Keep up to 20 diagnostic actions in memory on this page; attach only when I explicitly choose</label><button id="activity-save" type="button" class="border rounded p-2" disabled>Save preferences</button><p id="activity-status" class="my-2" role="status">Sign in on a workspace page to manage preferences. Public pages do not collect activity.</p></details><form method="dialog"><button class="bg-cyan-800 text-white rounded p-3">Close help</button></form>';
  dialog.querySelector("#page-help-title").textContent = title;
  dialog.querySelector("#page-help-description").textContent = description;
  dialog.querySelector("#page-help-guide").href = "wiki.html#" + anchor;
  document.body.append(dialog);
  const headerHelp = document.createElement("button"); headerHelp.type = "button";
  headerHelp.className = "inline-block text-sm underline font-semibold my-3";
  headerHelp.textContent = "ⓘ Help with this page";
  headerHelp.addEventListener("click", () => { dialog.showModal(); window.adminervaActivity?.record("help-open"); });
  document.querySelector("h1")?.after(headerHelp);
  const sectionGuides = {
    evidence:["Review committed evidence", "Verify selected diffs, pinned checkpoint and the student's individual scope. Reopen approved evidence only with an explicit reason; protected grades require deliberate revision.", "review"],
    evaluation:["Use an evaluation draft deliberately", "Evaluate only the verified checkpoint. Partial evidence cannot establish a whole project's quality or authorship. Copy a suggestion only if accurate; teacher fields and publication remain separate.", "review"],
    scoring:["Save privately, publish separately", "Enter your teacher score and feedback. Saving keeps a private draft. Confirm publication separately after checking the evidence revision and review status.", "review"]
  };
  document.addEventListener("click", event => {
    const guide = sectionGuides[event.target.closest?.("[data-adminerva-help]")?.dataset.adminervaHelp];
    if (!guide) return;
    dialog.querySelector("#page-help-title").textContent = guide[0]; dialog.querySelector("#page-help-description").textContent = guide[1]; dialog.querySelector("#page-help-guide").href = "wiki.html#" + guide[2]; dialog.showModal();
  });
  for (const button of [headerHelp, document.getElementById("page-help-open")]) button.addEventListener("click", () => {
    dialog.querySelector("#page-help-title").textContent = title; dialog.querySelector("#page-help-description").textContent = description; dialog.querySelector("#page-help-guide").href = "wiki.html#" + anchor;
  });
  document.getElementById("page-help-open").addEventListener("click", () => { dialog.showModal(); window.adminervaActivity?.record("help-open"); });
  const privatePage = Boolean(document.querySelector('script[src*="auth-guard.js"],script[src*="admin-analytics.mjs"]'));
  if (privatePage && window.self === window.top) {
    document.addEventListener("adminerva-activity-preferences", event => {
      document.getElementById("activity-share").checked = event.detail.enabled;
      document.getElementById("activity-diagnostics").checked = event.detail.diagnostics;
      document.getElementById("activity-save").disabled = false;
    });
    import("../analytics/activity-client.mjs?v=2026.10.19.2").then(module => {
      const save = document.getElementById("activity-save");
      document.getElementById("activity-status").textContent = "Optional: choose what to share, then save. These settings never affect grades.";
      save.addEventListener("click", async () => {
        save.disabled = true;
        try { await module.savePreferences(document.getElementById("activity-share").checked, document.getElementById("activity-diagnostics").checked); }
        catch { document.getElementById("activity-status").textContent = "Preferences could not be saved. Check your sign-in, connection and permissions; sharing has not been enabled."; }
        finally { save.disabled = false; }
      });
    }).catch(() => {});
  }
}
