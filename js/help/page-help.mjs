/** Public contextual tutorials and explicit activity preferences; never fetch protected data for guests. */
import {pageForPath} from "../analytics/activity-model.mjs?v=1.3.0";
const guides = {
  home:["Start with your workspace", "Choose a learning or teaching tool. Help, the public Wiki and patch history remain available from every page.", "getting-started"],
  project:["Submit your individual evidence", "Open an assessment, select your committed contributions and a checkpoint, then submit. Withdraw before approval to edit; approved evidence needs instructor reopening.", "evidence"],
  assessments:["Evidence comes first", "Select your own commits and checkpoint. Expand instructions and criteria when needed. A shared repository is not proof of individual authorship.", "evidence"],
  review:["Review → Evaluate → Teacher score", "Inspect the inline evidence and approve verified contributions. Evaluate for an optional draft, explicitly copy any suggestions you accept, then save your teacher score privately. Publication is a separate confirmation.", "review"],
  playground:["Edit, run and preserve your work", "Choose a language, edit your files and Run. Save or export before leaving. XML layouts have their own safe preview in XML Layout Lab.", "learning"],
  "xml-lab":["Try an Android layout", "Edit XML to preview supported widgets and attributes. This is a browser approximation, not an Android runtime. Inspect warnings for unsupported constraints.", "learning"],
  practice:["Practise, save and follow your class progress", "Choose a course and module, predict, experiment and reflect. Server-checked completions save automatically and earn class-only alias XP without activity consent or teacher approval. Use controlled transfer with recent sign-in when moving an active scored session; saved points stay intact and shared devices are allowed. Completion XP is not verified mastery or a school grade.", "learning"],
  grades:["Drafts and published grades differ", "A saved private draft is not student-visible. Check evidence revision, instructor review and protection status before explicitly publishing.", "review"],
  lessons:["Save a lesson before creating slides", "Save your lesson, then open its Slide Editor link for an editable starter. Inspect content and source version before presenting.", "lessons"],
  slides:["Keep your slide edits", "Create a starter from a saved lesson, edit it and save. A newer lesson does not silently replace your slide edits.", "lessons"],
  analytics:["Read signals in context", "Teacher Analytics is for learning summaries. Administration Analytics is for operations and debugging. Optional activity samples are incomplete and never proof of effort or mastery.", "analytics"],
  reports:["Send the right concern to the right role", "System bugs go to administrators. Class concerns may go to teachers. Add reproduction steps and redact private information. Diagnostic trails require your explicit consent.", "support"],
  settings:["Change only your intended settings", "Check the scope before saving. Permission-dependent controls may be unavailable. Preserve local work before changing accounts.", "getting-started"],
  other:["Need a hand?", "Choose a guide in the public Wiki for this module. If loading fails, preserve your work and report the steps needed to reproduce it.", "getting-started"]
};
export function hasActivityPreferences(scripts) {
  return [...scripts].some(script => /\/(auth-guard\.js|admin-analytics\.mjs|settings-security\.js)(?:[?]|$)/.test(script.src));
}
export function mountHelp() {
  if (document.getElementById("adminerva-help")) return;
  if(!document.querySelector('link[href*="workspace-navigation.css"]')){const styles=document.createElement("link");styles.rel="stylesheet";styles.href="css/workspace-navigation.css?v=1.3.0";document.head.append(styles);}
  import("../core/display-preferences.mjs?v=1.3.0").catch(()=>{});
  import("../core/section-navigation.mjs?v=1.3.0").then(module=>{module.mountSectionNavigation();document.addEventListener("adminerva:role-ready",()=>setTimeout(module.mountSectionNavigation,300),{once:true});}).catch(()=>{});
  const [title, description, anchor] = guides[pageForPath(location.pathname)];
  const footer = document.createElement("footer"); footer.id = "adminerva-help";
  footer.className = "av-site-footer";
  footer.setAttribute("aria-label","Help, privacy and website updates");
  footer.innerHTML = '<span class="av-footer-brand">ADMINERVA</span><nav aria-label="Website information"><button type="button" id="page-help-open">ⓘ Help / tutorial</button><a href="wiki.html">Wiki</a><a href="patch-notes.html">Patch notes</a><a href="wiki.html#privacy">Privacy</a></nav>';
  if(!document.getElementById("adminerva-nav")){
    const returnLink=document.createElement("a");returnLink.href="login.html?continue=1";returnLink.dataset.workspaceReturn="";returnLink.textContent="Return to my workspace →";footer.querySelector("nav").prepend(returnLink);
    import("../core/workspace-return.mjs?v=1.3.0").then(module=>module.refreshWorkspaceReturn()).catch(()=>{});
  }
  document.body.classList.add("av-with-footer");
  if (location.pathname.endsWith("/login.html")) {
    const card=document.getElementById("googleLoginBtn")?.closest('[class*="max-w-"]');
    if(card){const content=document.createElement("main");content.className="av-login-content";card.before(content);content.append(card);document.body.classList.add("av-login-page");}
  }
  const previousFooter=document.querySelector("body > footer");
  if(previousFooter){
    previousFooter.querySelectorAll('a[href="patch-notes.html"],a[href="wiki.html"]').forEach(link=>link.remove());
    const credits=document.createElement("div");credits.className="av-footer-credits";
    credits.append(...previousFooter.childNodes);if(credits.textContent.trim())footer.append(credits);
    previousFooter.remove();
  }
  document.body.append(footer);
  const dialog = document.createElement("dialog"); dialog.id = "page-help-dialog";
  dialog.className = "p-6 rounded-xl border border-slate-300 max-w-xl w-[95vw] text-slate-900 bg-white";
  dialog.setAttribute("aria-labelledby", "page-help-title");
  dialog.innerHTML = '<h2 id="page-help-title" class="text-xl font-bold"></h2><p id="page-help-description" class="my-4"></p><a id="page-help-guide" class="underline">Read the full guide</a><p class="my-5">Optional activity sharing and the home reminder can be changed in your <a href="student-settings.html" id="help-settings-link" class="underline">Account Settings</a>. Public pages do not collect activity.</p><form method="dialog"><button class="bg-cyan-800 text-white rounded p-3">Close help</button></form>';
  dialog.querySelector("#page-help-title").textContent = title;
  dialog.querySelector("#page-help-description").textContent = description;
  dialog.querySelector("#page-help-guide").href = "wiki.html#" + anchor;
  document.body.append(dialog);
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
  document.getElementById("page-help-open").addEventListener("click", () => {
    dialog.querySelector("#page-help-title").textContent = title; dialog.querySelector("#page-help-description").textContent = description; dialog.querySelector("#page-help-guide").href = "wiki.html#" + anchor;
  });
  document.getElementById("page-help-open").addEventListener("click", () => { dialog.showModal(); window.adminervaActivity?.record("help-open"); });
  const privatePage = hasActivityPreferences(document.scripts);
  document.getElementById("help-settings-link").href = document.getElementById("adminerva-nav")?.dataset.module?.startsWith("student") ? "student-settings.html" : "settings.html";
  if (privatePage && window.self === window.top) {
    import("./activity-preferences.mjs?v=1.3.0").then(module => module.mountActivityPreferences()).catch(() => {});
  }
}
