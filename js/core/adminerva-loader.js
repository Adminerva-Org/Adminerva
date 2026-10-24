/** Shared concurrent-job loading status, public help and privacy-conscious issue submission. */
const loadingJobs = new Map();
const earlyLoadingStatus = document.createElement("div");
earlyLoadingStatus.id = "subtleLoader";
earlyLoadingStatus.setAttribute("role", "status");
earlyLoadingStatus.setAttribute("aria-live", "polite");
earlyLoadingStatus.style.cssText = "position:fixed;right:1rem;bottom:1rem;z-index:9999;background:#0f172a;color:#fff;border:1px solid #64748b;border-radius:0.5rem;padding:1rem;max-width:90vw";
const earlyLabel = document.createElement("span"); earlyLabel.id = "subtleLoaderText";
earlyLoadingStatus.append(earlyLabel); document.documentElement.append(earlyLoadingStatus);
let legacyLoading = null;
let loaderSequence = 0;
window.beginLoading = function(message = "Loading…", region) {
  const token = ++loaderSequence;
  loadingJobs.set(token, {message:String(message), region});
  region?.setAttribute("aria-busy", "true");
  updateLoadingStatus();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true; loadingJobs.delete(token);
    if (region && ![...loadingJobs.values()].some(job => job.region === region)) region.removeAttribute("aria-busy");
    updateLoadingStatus();
  };
};
function updateLoadingStatus() {
  const loader = document.getElementById("subtleLoader");
  if (!loader) return;
  const jobs = [...loadingJobs.values()];
  const message = jobs.at(-1)?.message || legacyLoading;
  loader.hidden = !message;
  loader.classList.toggle("hidden", !message);
  loader.style.display = message ? "flex" : "none";
  loader.style.opacity = message ? "1" : "0";
  loader.style.transform = "none";
  document.getElementById("subtleLoaderText").textContent = message || "Ready";
}
const endPageLoading = window.beginLoading("Opening page…");
window.addEventListener("load", endPageLoading, {once:true});
document.addEventListener("DOMContentLoaded", () => {
  if(!document.getElementById("adminerva-report-dialog-style")){
    const style=document.createElement("style");style.id="adminerva-report-dialog-style";
    style.textContent="#bug-modal[hidden]{display:none!important}#bug-modal:not([hidden]){position:fixed;inset:0;z-index:110;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(15,23,42,.86)}#bug-modal>div{position:relative;width:min(100%,36rem);max-height:90vh;overflow:auto;background:#1e293b;color:#fff;border:1px solid #164e63;border-radius:.75rem;box-shadow:0 20px 50px rgba(0,0,0,.45)}#bug-modal>div>div:last-child{padding:1.5rem}#bug-modal input,#bug-modal select,#bug-modal textarea,#bug-modal button{font:inherit}";
    document.head.append(style);
  }
  const loaderHTML = `
        <!-- Unified nonblocking status loader -->
        <div id="subtleLoader" role="status" aria-live="polite" aria-atomic="true" class="fixed bottom-5 right-5 z-[250] bg-slate-900 border border-slate-700 shadow-[0_10px_40px_rgba(0,0,0,0.5)] rounded-lg p-4 flex items-center gap-4 transition-all duration-300 transform translate-y-20 opacity-0 hidden">
            <svg class="animate-spin h-5 w-5 text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-100" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span id="subtleLoaderText" class="text-sm font-bold text-slate-200 tracking-wide">Fetching data...</span>
        </div>
        
        <!-- Bug Modal -->
        <div id="bug-modal" role="dialog" aria-modal="true" aria-labelledby="bug-dialog-title" tabindex="-1" hidden class="hidden fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div class="bg-slate-800 border border-cyan-900 rounded-xl shadow-2xl max-w-xl w-full relative text-white text-left max-h-[90vh] flex flex-col overflow-hidden">
            
            <!-- ✨ NEW: Similarity Intercept Overlay (Hidden by Default) -->
            <div id="bug-similarity-overlay" class="hidden absolute inset-0 bg-slate-900/95 backdrop-blur-md z-[120] p-6 flex flex-col">
               <h3 class="text-xl font-bold text-amber-400 flex items-center gap-2 mb-2"><span>⚠️</span> Wait! Similar Issues Found</h3>
               <p class="text-sm text-slate-300 mb-4">Before you submit, please check if your issue matches any of these existing reports. Upvoting an existing issue resolves it faster!</p>
               
               <div id="bug-similarity-list" class="flex-1 overflow-y-auto space-y-3 mb-4 pr-2">
                  <!-- Similar issues dynamically injected here -->
               </div>
               
               <div class="mt-auto pt-4 border-t border-slate-700 flex gap-3">
                   <a href="issues.html" class="flex-1 bg-slate-700 hover:bg-slate-600 text-white text-center font-bold py-3 rounded transition shadow-sm">Go to Issue Tracker</a>
                   <button onclick="window.finalizeBugReport()" class="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded transition shadow-lg">Continue Submitting</button>
               </div>
            </div>

            <!-- Standard Form -->
            <div class="p-6 flex flex-col flex-1 overflow-hidden">
                <button type="button" aria-label="Close report dialog" onclick="const m=document.getElementById('bug-modal');if(m){m.hidden=true;m.classList.add('hidden')}" class="absolute top-4 right-4 text-slate-400 hover:text-cyan-400 transition text-xl">&times;</button>
                
                <div class="flex justify-between items-center mb-4 border-b border-slate-700 pb-3">
                  <h2 id="bug-dialog-title" class="text-xl font-bold text-cyan-400 flex items-center gap-2"><span aria-hidden="true">🚨</span> Report an Issue</h2>
                  <a href="issues.html" class="text-xs font-bold text-slate-400 hover:text-cyan-400 transition underline">View Known Issues</a>
                </div>
                
                <div class="overflow-y-auto pr-2 flex-1 space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label for="bug-category" class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Category</label>
                            <select id="bug-category" class="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-400 cursor-pointer">
                                <option value="Bug">🐛 Bug / System Error</option>
                                <option value="Access">🔐 Login / Access Issue</option>
                                <option value="Feature">✨ Feature Request</option>
                                <option value="UI">📱 UI / Display Issue</option>
                                <option value="Other">❓ Other</option>
                            </select>
                        </div>
                        <div>
                            <label for="bug-priority" class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Priority</label>
                            <select id="bug-priority" class="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-400 cursor-pointer">
                                <option value="Low">🟢 Low</option>
                                <option value="Medium" selected>🟡 Medium</option>
                                <option value="High">🟠 High</option>
                                <option value="Critical">🔴 Critical (Blocks Work)</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label for="bug-audience" class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Send report to</label>
                        <select id="bug-audience" class="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm text-slate-200" aria-describedby="bug-audience-note">
                            <option value="teacher">Teacher — class / learning concerns</option>
                            <option value="admin">Administrator — system / account concerns</option>
                        </select>
                        <p id="bug-audience-note" class="text-xs text-cyan-200 mt-1"></p>
                    </div>

                    <div>
                        <label for="bug-title" class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Issue Summary</label>
                        <input type="text" maxlength="160" id="bug-title" class="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-400" placeholder="A brief title of the problem...">
                    </div>

                    <div>
                        <label for="bug-description" class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Detailed Description</label>
                        <textarea id="bug-description" maxlength="6000" rows="3" class="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-400" placeholder="Please provide details or steps to reproduce the issue..."></textarea>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div><label for="bug-module" class="block text-[10px] text-slate-300 font-bold mb-1">Affected module</label>
                        <select id="bug-module" class="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm text-white">
                          <option value="General">General</option><option value="Login">Login</option>
                          <option value="Gradebook">Gradebook</option><option value="Assessments">Assessments</option>
                          <option value="RepoFetch">RepoFetch</option><option value="Playground">Code Playground</option>
                          <option value="Other">Other</option>
                        </select></div>
                      <div><label for="bug-reproduction" class="block text-[10px] text-slate-300 font-bold mb-1">Steps to reproduce</label>
                        <textarea id="bug-reproduction" rows="2" maxlength="1500" placeholder="1. Open... 2. Click..." class="w-full bg-slate-900 text-white border border-slate-600 rounded p-2 text-sm"></textarea></div>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div><label for="bug-expected" class="block text-[10px] text-slate-300 font-bold mb-1">Expected result</label>
                        <textarea id="bug-expected" rows="2" maxlength="1400" class="w-full bg-slate-900 text-white border border-slate-600 rounded p-2 text-sm"></textarea></div>
                      <div><label for="bug-actual" class="block text-[10px] text-slate-300 font-bold mb-1">What happened</label>
                        <textarea id="bug-actual" rows="2" maxlength="1400" class="w-full bg-slate-900 text-white border border-slate-600 rounded p-2 text-sm"></textarea></div>
                    </div>
                    <label class="block text-xs text-slate-200"><input id="bug-attach-diagnostics" type="checkbox"> Attach my optional diagnostic actions from this page (administrator reports only)</label>
                    <p class="text-xs text-slate-300">Enable diagnostic history in Help first. Only module/action identifiers are attached; never typed content, source code or credentials. Nothing is attached unless you tick the box.</p>
                    <p class="text-xs text-amber-200">Screenshots may contain names or other personal information. Crop or redact anything not necessary to diagnose the issue.</p>
                    <div class="bg-slate-900/50 p-3 rounded border border-slate-700 border-dashed">
                        <div class="flex justify-between items-center mb-2">
                            <label for="bug-image-upload" class="block text-[10px] font-bold text-cyan-500 uppercase tracking-wider">
                                Screenshots (<span id="bug-img-count">0</span>/5)
                            </label>
                            <div class="flex gap-2">
                                <span class="text-[10px] text-slate-500 hidden sm:inline pt-1 mr-2">Tip: You can press Ctrl+V to paste</span>
                                <button onclick="document.getElementById('bug-image-upload').click()" type="button" class="text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded transition font-bold shadow-sm">
                                    📸 Browse / Capture
                                </button>
                            </div>
                            <input type="file" id="bug-image-upload" multiple accept="image/*" class="hidden" />
                        </div>
                        <div id="bug-screenshots-container" class="flex gap-3 overflow-x-auto py-2 min-h-[4.5rem]">
                            <span id="bug-img-placeholder" class="text-xs text-slate-500 italic mt-2">No screenshots attached yet.</span>
                        </div>
                    </div>
                </div>
                
                <div class="mt-4 pt-3 border-t border-slate-700">
                    <button onclick="window.initiateBugReport()" id="submit-bug-btn" class="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded transition shadow-lg">Submit Report</button>
                </div>
            </div>
          </div>
        </div>
    `;

  earlyLoadingStatus.remove();
  document.body.insertAdjacentHTML("beforeend", loaderHTML);
  document.documentElement.append(document.getElementById("subtleLoader"));
  updateLoadingStatus();
  if (document.readyState === "complete") endPageLoading();
  const content = document.querySelector("main") || document.querySelector("h1");
  if (content && !document.getElementById("av-skip-link")) {
    if (!content.id) content.id = "av-main-content";
    content.setAttribute("tabindex", "-1");
    const skip = document.createElement("a");
    skip.id = "av-skip-link"; skip.className = "av-skip-link";
    skip.href = "#" + content.id; skip.textContent = "Skip to main content";
    document.body.prepend(skip);
  }
  import("../help/page-help.mjs?v=1.3.0").then(module => module.mountHelp()).catch(() => {});
  bindBugReporterLogic();
});

// ==========================================
// GLOBAL LOADER FUNCTIONS
// ==========================================
window.showSubtleLoader = function (message = "Processing...") {
  legacyLoading = String(message);
  updateLoadingStatus();
};

window.hideSubtleLoader = function () {
  legacyLoading = null;
  updateLoadingStatus();
};

// ==========================================
// BUG REPORTER LOGIC (Images & Paste)
// ==========================================
function syncReportAudience() {
  const category = document.getElementById("bug-category")?.value;
  const select = document.getElementById("bug-audience");
  const note = document.getElementById("bug-audience-note");
  if (!select || !note) return;
  if (category === "Bug") {
    select.value = "admin";
    select.disabled = true;
    select.dataset.forced = "true";
    note.textContent = "System bug reports are sent only to administrators.";
  } else {
    if (select.dataset.forced === "true") select.value = "teacher";
    select.dataset.forced = "false";
    select.disabled = false;
    note.textContent = "Only the selected staff role and you can view the report.";
  }
  const attachment = document.getElementById("bug-attach-diagnostics");
  if (attachment) {
    attachment.disabled = select.value !== "admin";
    if (attachment.disabled) attachment.checked = false;
  }
}

function bindBugReporterLogic() {
  window.bugImages = [];
  document.getElementById("bug-category").addEventListener("change", syncReportAudience);
  document.getElementById("bug-audience").addEventListener("change", syncReportAudience);
  syncReportAudience();
  const fileInput = document.getElementById("bug-image-upload");
  const modal = document.getElementById("bug-modal");
  bindReportDialogAccessibility(modal);

  fileInput.addEventListener("change", (e) => {
    processBugFiles(Array.from(e.target.files));
    e.target.value = "";
  });

  window.addEventListener("paste", (e) => {
    if (modal.hidden || modal.classList.contains("hidden")) return;
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    const files = [];
    for (let item of items) {
      if (item.type.indexOf("image") === 0) files.push(item.getAsFile());
    }
    if (files.length > 0) processBugFiles(files);
  });
}

function bindReportDialogAccessibility(modal) {
  if (!modal || modal.dataset.dialogReady) return;
  modal.dataset.dialogReady = "true";
  const focusSelector = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const visible = element => Boolean(element && !element.closest("[hidden],.hidden") && element.getClientRects().length);
  const isOpen = () => !modal.hidden && !modal.classList.contains("hidden") && modal.style.display !== "none";
  let wasOpen = false, returnFocus = null, lastOutsideFocus = document.activeElement;
  const scope = () => {
    const similar = document.getElementById("bug-similarity-overlay");
    return visible(similar) ? similar : modal;
  };
  const controls = () => [...scope().querySelectorAll(focusSelector)].filter(visible);
  const focusInside = () => {
    if (!isOpen() || scope().contains(document.activeElement) && visible(document.activeElement)) return;
    const title = document.getElementById("bug-title");
    (scope() === modal && visible(title) ? title : controls()[0] || modal).focus();
  };
  const sync = () => {
    const open = isOpen();
    if (open && !wasOpen) returnFocus = lastOutsideFocus;
    const closed = wasOpen && !open;
    wasOpen = open;
    if (open) focusInside();
    else if (closed) {
      const fallback = document.getElementById("av-information-toggle") || document.getElementById("page-help-open");
      (visible(returnFocus) && returnFocus.isConnected ? returnFocus : fallback)?.focus();
    }
  };
  document.addEventListener("focusin", event => {
    if (!modal.contains(event.target)) {
      if (isOpen()) focusInside();
      else lastOutsideFocus = event.target;
    }
  });
  document.addEventListener("keydown", event => {
    if (!isOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      modal.classList.add("hidden"); // Closing preserves the unsent report.
      sync();
    } else if (event.key === "Tab") {
      const items = controls(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); modal.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !scope().contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !scope().contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  });
  // Existing callers open and close the dialog by changing its hidden class.
  // Observe that contract, including the report comparison overlay.
  new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ["class", "hidden", "style"], subtree: true });
  sync();
}

function processBugFiles(files) {
  let availableSlots = 5 - window.bugImages.length;
  if (availableSlots <= 0)
    return alert("Maximum 5 screenshots allowed per report.");

  const filesToProcess = files.slice(0, availableSlots);
  filesToProcess.forEach((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = String(e.target.result || "");
      const total = window.bugImages.reduce((n,v)=>n+v.length,0);
      if (dataUrl.length + total > 550000) {
        alert("Screenshots are too large for this report. Use smaller cropped images or submit without screenshots.");
        return;
      }
      window.bugImages.push(dataUrl);
      renderBugThumbnails();
    };
    reader.readAsDataURL(file);
  });
}

window.removeBugImage = function (index) {
  window.bugImages.splice(index, 1);
  renderBugThumbnails();
};

function renderBugThumbnails() {
  const container = document.getElementById("bug-screenshots-container");
  const count = document.getElementById("bug-img-count");

  count.textContent = window.bugImages.length;
  container.innerHTML = "";

  if (window.bugImages.length === 0) {
    container.innerHTML = `<span id="bug-img-placeholder" class="text-xs text-slate-500 italic mt-2">No screenshots attached yet.</span>`;
    return;
  }

  window.bugImages.forEach((imgBase64, index) => {
    container.insertAdjacentHTML(
      "beforeend",
      `
      <div class="relative w-16 h-16 shrink-0 rounded border-2 border-slate-600 overflow-hidden group shadow-sm">
          <img src="${imgBase64}" class="w-full h-full object-cover" />
          <button type="button" aria-label="Remove screenshot ${index + 1}" onclick="window.removeBugImage(${index})" class="absolute top-0 right-0 bg-red-600/90 hover:bg-red-500 text-white w-5 h-5 flex items-center justify-center text-[10px] font-bold opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition shadow">✕</button>
      </div>
    `,
    );
  });
}

// ==========================================
// INTELLIGENT SUBMISSION ENGINE
// ==========================================
window.initiateBugReport = async function () {
  const title = document.getElementById("bug-title").value.trim();
  const description = document.getElementById("bug-description").value.trim();

  if (!title || !description)
    return alert(
      "Please provide both an Issue Summary and a Detailed Description.",
    );

  const btn = document.getElementById("submit-bug-btn");
  btn.disabled = true;
  btn.innerHTML = `<span class="animate-pulse">Checking records...</span>`;

  try {
    const { collection, getDocs, query, where, limit } =
      await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    if (!window.db) throw new Error("No DB Connection");

    // 1. Keyword Extraction (Ignore common stop words)
    const stopWords = [
      "this",
      "that",
      "with",
      "from",
      "what",
      "where",
      "when",
      "your",
      "have",
      "they",
      "will",
      "just",
      "like",
      "about",
      "would",
      "could",
      "should",
      "some",
      "them",
      "because",
      "does",
      "cant",
      "cannot",
      "error",
      "issue",
      "problem",
    ];
    const inputWords =
      (title + " " + description)
        .toLowerCase()
        .match(/\b[a-z]{4,}\b/g)
        ?.filter((w) => !stopWords.includes(w)) || [];
    const uniqueKeywords = [...new Set(inputWords)];

    if (uniqueKeywords.length === 0) {
      return window.finalizeBugReport(); // Bypass if input is too generic
    }

    // 2. Fetch and Score Existing Issues
    // Private reports must never be exposed by the similarity checker.
    // Check only the signed-in reporter's own previous submissions.
    const uid = window.auth?.currentUser?.uid;
    if (!uid) throw new Error("Sign in to compare reports");
    const selectedAudience = document.getElementById("bug-category").value === "Bug"
      ? "admin" : document.getElementById("bug-audience").value;
    const snap = await getDocs(query(collection(window.db, "issues"),
      where("reporterUid", "==", uid), limit(120)));
    let similarIssues = [];

    snap.forEach((doc) => {
      const data = doc.data();
      if ((data.audience || "admin") !== selectedAudience) return;
      const issueText = (data.title + " " + data.description).toLowerCase();

      let matchCount = 0;
      uniqueKeywords.forEach((kw) => {
        if (issueText.includes(kw)) matchCount++;
      });

      // Threshold: At least 2 keywords match, or 1 if they only typed 1 specific keyword
      const threshold = Math.min(2, uniqueKeywords.length);

      if (
        matchCount >= threshold &&
        (data.status === "Open" || data.status === "In Progress")
      ) {
        similarIssues.push({ id: doc.id, matchCount, ...data });
      }
    });

    // 3. Evaluate Results
    if (similarIssues.length > 0) {
      similarIssues.sort((a, b) => b.matchCount - a.matchCount);
      const topMatches = similarIssues.slice(0, 3); // Grab top 3

      const encodeText = v=>String(v||"").replace(/[&<>"']/g,c=>({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
      })[c]);
      const listHTML = topMatches
        .map((iss) => {
          const statStyle =
            iss.status === "Open"
              ? "text-emerald-400 border-emerald-500"
              : "text-amber-400 border-amber-500";
          return `
            <div class="bg-slate-800 p-3 rounded-lg border border-slate-600 shadow-sm">
                <div class="flex items-center gap-2 mb-1.5">
                    <span class="border ${statStyle} text-[10px] px-1.5 py-0.5 rounded font-bold uppercase">${encodeText(iss.status)}</span>
                    <span class="text-slate-400 text-[10px] font-bold uppercase">${encodeText(iss.category)}</span>
                </div>
                <h4 class="font-bold text-sm text-cyan-300 line-clamp-1">${encodeText(iss.title)}</h4>
                <p class="text-xs text-slate-400 mt-1 line-clamp-2">${encodeText(iss.description)}</p>
            </div>`;
        })
        .join("");

      document.getElementById("bug-similarity-list").innerHTML = listHTML;
      document
        .getElementById("bug-similarity-overlay")
        .classList.remove("hidden");
    } else {
      window.finalizeBugReport(); // No matches, proceed normally
    }
  } catch (error) {
    console.error("Similarity engine bypassed:", error);
    window.finalizeBugReport(); // Failsafe
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Report";
  }
};

window.finalizeBugReport = async function () {
  const category = document.getElementById("bug-category").value;
  const priority = document.getElementById("bug-priority").value;
  const title = document.getElementById("bug-title").value.trim();
  const description = document.getElementById("bug-description").value.trim();
  const currentUser = window.auth?.currentUser;
  if (!currentUser?.uid || !currentUser.email) return alert("Please sign in before submitting a report.");
  if (title.length < 4 || description.length < 5) return alert("Add a clearer title and description.");

  // Hide overlay and show loader
  document.getElementById("bug-similarity-overlay").classList.add("hidden");
  const btn = document.getElementById("submit-bug-btn");
  btn.disabled = true;
  btn.innerHTML = `<span class="animate-pulse">Submitting Report...</span>`;

  try {
    const { collection, addDoc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");

    const {reportContext}=await import("./report-context.mjs?v=1.3.0");
    const context=await reportContext(document.getElementById("bug-audience").value,category);
    const audience=context.audience;
    if (!["admin", "teacher"].includes(audience)) throw new Error("Invalid report recipient");
    const payload = {
      ...context,
      category,
      audience,
      priority,
      title,
      description,
      images: window.bugImages,
      urlContext: window.location.origin + window.location.pathname,
      // Keep contact identifiers out of publicly readable issue documents.
      // Notifications and ownership use the authenticated Firebase UID.
      reporterEmail: "",
      reporterUid: currentUser.uid,
      module: document.getElementById("bug-module").value,
      reproductionSteps: document.getElementById("bug-reproduction").value.trim(),
      expectedBehavior: document.getElementById("bug-expected").value.trim(),
      actualBehavior: document.getElementById("bug-actual").value.trim(),
      clientContext: navigator.userAgent.slice(0,300),
      reporterRole: "reporter",
      status: "Open",
      upvotes: [],
      locked: false,
      createdAt: serverTimestamp(),
    };

    const receipt = await addDoc(collection(window.db, "issues"), payload);
    let diagnosticWarning = "";
    if (audience === "admin" && document.getElementById("bug-attach-diagnostics")?.checked) {
      const trail = window.adminervaActivity?.diagnostics();
      if (trail?.actions.length) {
        try {
          const {setDoc, doc, Timestamp} = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
          await setDoc(doc(window.db, "issue_diagnostics", receipt.id), {ownerUid:currentUser.uid, ...trail, createdAt:serverTimestamp(), expiresAt:Timestamp.fromMillis(Date.now() + 30 * 86400000)});
        } catch { diagnosticWarning = " The report was saved, but its optional diagnostic trail could not be attached."; }
      }
    }
    document.getElementById("bug-attach-diagnostics").checked = false;

    // Reset Form
    document.getElementById("bug-title").value = "";
    document.getElementById("bug-description").value = "";
    document.getElementById("bug-category").value = "Bug";
    syncReportAudience();
    document.getElementById("bug-priority").value = "Medium";
    for (const id of ["bug-reproduction","bug-expected","bug-actual"]) {
      document.getElementById(id).value = "";
    }
    window.bugImages = [];
    renderBugThumbnails();

    const reportModal=document.getElementById("bug-modal");reportModal.hidden=true;reportModal.classList.add("hidden");

    window.showSubtleLoader("Report received. Reference: " + receipt.id.slice(0,10));
    alert("Report submitted successfully for " + (audience === "admin" ? "administrators" : "teachers") + ". Reference: " + receipt.id.slice(0,10) + ". Check My reports for its status." + diagnosticWarning);
    setTimeout(() => window.hideSubtleLoader(), 3000);
  } catch (error) {
    console.error(error);
    alert("Failed to submit report: " + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Report";
  }
};
