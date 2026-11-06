/** Shared concurrent-job loading status, public help and privacy-conscious issue submission. */
const loadingJobs = new Map();
const earlyLoadingStatus = document.createElement("div");
earlyLoadingStatus.id = "subtleLoader";
earlyLoadingStatus.setAttribute("role", "status");
earlyLoadingStatus.setAttribute("aria-live", "polite");
earlyLoadingStatus.style.cssText = "position:fixed;top:calc(12px + env(safe-area-inset-top, 0px));left:50%;transform:translateX(-50%);z-index:10050;background:#172b47;color:#fff;border:1px solid #496380;border-radius:0.875rem;padding:.8rem 1.2rem;width:max-content;max-width:calc(100vw - 24px);box-shadow:0 16px 46px rgba(9,20,36,.3);font:600 13px/1.4 system-ui,sans-serif";
const earlyIcon=document.createElement("span");earlyIcon.className="av-loader-mark";earlyIcon.setAttribute("aria-hidden","true");
const earlyEmblem=document.createElement("img");earlyEmblem.src="assets/adminerva-emblem.png";earlyEmblem.alt="";earlyEmblem.className="av-loader-emblem";
const earlyOrbit=document.createElement("span");earlyOrbit.className="av-loader-orbit";earlyIcon.append(earlyEmblem,earlyOrbit);
earlyLoadingStatus.append(earlyIcon);
const earlyLabel = document.createElement("span"); earlyLabel.id = "subtleLoaderText";
earlyLoadingStatus.append(earlyLabel); document.documentElement.append(earlyLoadingStatus);
const loaderStyle=document.createElement("style");loaderStyle.id="adminerva-loading-motion";
loaderStyle.textContent=`
#subtleLoader{position:fixed;top:calc(12px + env(safe-area-inset-top, 0px));left:50%;right:auto;bottom:auto;transform:translateX(-50%);z-index:10050;display:flex;align-items:center;justify-content:center;gap:10px;isolation:isolate;overflow:hidden;min-height:54px;padding:12px 18px;border:1px solid #496380;border-radius:14px;background:#172b47;color:#f4f8ff;box-shadow:0 16px 46px rgba(9,20,36,.3);font:600 13px/1.5 system-ui,sans-serif;max-width:calc(100vw - 24px);box-sizing:border-box}#subtleLoader[hidden],#subtleLoader.hidden{display:none!important}
.av-loader-mark{position:relative;display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:50%;background:#052e45;box-shadow:0 0 0 1px rgba(34,211,238,.24)}
.av-loader-emblem{width:28px;height:28px;object-fit:contain;filter:drop-shadow(0 0 5px rgba(34,211,238,.35));animation:avEmblemBreathe 1.6s ease-in-out infinite}
.av-loader-orbit{position:absolute;inset:-3px;border:2px solid transparent;border-top-color:#67e8f9;border-left-color:#0e7490;border-radius:50%;animation:avOrbit 1.15s linear infinite}
#subtleLoader::after{content:"";height:2px;position:absolute;bottom:0;left:0;width:34%;background:linear-gradient(90deg,transparent,#67e8f9,transparent);animation:avSweep 1.7s ease-in-out infinite}
@keyframes avOrbit{to{transform:rotate(360deg)}}
@keyframes avEmblemBreathe{0%,100%{transform:scale(.94)}50%{transform:scale(1.06)}}
@keyframes avSweep{0%{transform:translateX(-110%)}100%{transform:translateX(400%)}}
@media (prefers-reduced-motion:reduce){.av-loader-orbit,.av-loader-emblem,#subtleLoader::after{animation:none!important}#subtleLoader::after{width:100%;opacity:.45}}
/* One loading animation system: legacy overlays and secondary spinner/pulse motion stay visually suppressed. */
.av-legacy-loader-suppressed{display:none!important}
:is(#executionOverlay,#issuesFeed,#assignmentsFeed,#commitListContainer,#studentAssessmentsContainer,#submissionFeed) :is(.animate-spin,.animate-pulse),
button :is(.animate-spin,.animate-pulse){animation:none!important}
`;
document.documentElement.append(loaderStyle);
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
  loader.style.position = "fixed";
  loader.style.top = "calc(12px + env(safe-area-inset-top, 0px))";
  loader.style.left = "50%";
  loader.style.right = "auto";
  loader.style.bottom = "auto";
  loader.style.transform = "translateX(-50%)";
  loader.style.width = "max-content";
  loader.style.maxWidth = "calc(100vw - 24px)";
  loader.style.zIndex = "10050";
  document.getElementById("subtleLoaderText").textContent = message || "Ready";
}
/** Wrap explicit user work so feedback begins before the first await and always ends. */
const processingControls = new WeakSet();
window.withLoading = async function(message, action, {button=null, region=null}={}) {
  if (typeof action !== "function") throw new TypeError("A processing action is required.");
  if (button && processingControls.has(button)) return;
  const end=window.beginLoading(message,region);
  if(button){processingControls.add(button);button.setAttribute("aria-busy","true");}
  try { return await action(); }
  finally {
    if(button){processingControls.delete(button);button.removeAttribute("aria-busy");}
    end();
  }
};
const legacyLoaderJobs=new Map();
function legacyLoaderRequested(node){
  return Boolean(node)&&!node.hasAttribute("hidden")&&!node.classList.contains("hidden")&&node.style.display!=="none";
}
function legacyLoaderMessage(node){
  const selectors=["#loaderMessage","#loaderMainText","#loaderSubMessage","#loaderSubText","[role='status']"];
  const values=[];
  for(const selector of selectors){
    const item=node.querySelector(selector);
    const value=String(item?.textContent||"").trim();
    if(value&&!values.includes(value))values.push(value);
  }
  return values.join(" · ")||"Processing…";
}
function syncLegacyLoaders(){
  for(const node of document.querySelectorAll("#globalLoader,#loaderOverlay,#loadingOverlay")){
    const requested=legacyLoaderRequested(node),existing=legacyLoaderJobs.get(node),message=legacyLoaderMessage(node);
    node.classList.add("av-legacy-loader-suppressed");
    node.setAttribute("aria-hidden","true");
    if(requested){
      if(existing?.message===message)continue;
      existing?.end?.();
      legacyLoaderJobs.set(node,{message,end:window.beginLoading(message)});
    }else if(existing){
      existing.end?.();legacyLoaderJobs.delete(node);
    }
  }
}
let legacyLoaderSyncQueued=false;
function queueLegacyLoaderSync(){
  if(legacyLoaderSyncQueued)return;
  legacyLoaderSyncQueued=true;
  queueMicrotask(()=>{legacyLoaderSyncQueued=false;syncLegacyLoaders();});
}
const startLegacyLoaderBridge=()=>{
  syncLegacyLoaders();
  if(document.body)new MutationObserver(queueLegacyLoaderSync).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["class","style","hidden"]});
};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",startLegacyLoaderBridge,{once:true});else startLegacyLoaderBridge();

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
        <div id="subtleLoader" role="status" aria-live="polite" aria-atomic="true" class="fixed z-[10050] bg-slate-900 border border-slate-700 shadow-[0_10px_40px_rgba(0,0,0,0.5)] rounded-lg p-4 flex items-center gap-4 transition-all duration-300 transform translate-y-20 opacity-0 hidden">
            <span class="av-loader-mark" aria-hidden="true"><img class="av-loader-emblem" src="assets/adminerva-emblem.png" alt=""><span class="av-loader-orbit"></span></span>
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
  btn.textContent = "Checking records...";
  const end=window.beginLoading?.("Checking similar reports…")||(()=>{});

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
    end();
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
  btn.textContent = "Submitting Report...";
  const end=window.beginLoading?.("Submitting report…")||(()=>{});

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
    end();
    btn.disabled = false;
    btn.textContent = "Submit Report";
  }
};


/* Shared compact-information behavior. Long secondary descriptions collapse by
   default and expand on hover/focus or explicit tap. Critical status/error text
   and form guidance are deliberately excluded. */
(() => {
  const copySelector = [
    "main > header p:not([role])",
    ".av-educator-content > header p:not([role])",
    ".av-panel > p:not([role])",
    ".av-action-card > p:not([role])",
    ".av-home-task > p:not([role])",
    ".av-learning-card > p:not([role])",
    ".av-analytics-intro > p:not([role])",
    ".av-operations-dashboard section > p:not([role])"
  ].join(",");
  const excluded = node => node.closest(
    "dialog,[role='dialog'],details,form,[role='alert'],[aria-live],.av-scope-notice,.av-status-card"
  );
  function bindCopy(node){
    if(node.dataset.avCompactBound || excluded(node) || node.textContent.trim().length < 140 ||
       node.querySelector("a,button,input,select,textarea")) return;
    node.dataset.avCompactBound="1";
    node.classList.add("av-progressive-copy");
    node.tabIndex=0;
    node.title="Hover, focus, or tap to show the full description";
    const toggle=event=>{
      if(event.type==="keydown" && !["Enter"," "].includes(event.key)) return;
      if(event.type==="keydown") event.preventDefault();
      node.classList.toggle("av-expanded");
    };
    node.addEventListener("click",toggle);
    node.addEventListener("keydown",toggle);
  }
  function bindPopover(button){
    if(button.dataset.avPopoverBound) return;
    button.dataset.avPopoverBound="1";
    button.addEventListener("click",event=>{
      event.stopPropagation();
      const wrap=button.closest(".av-inline-flag");
      const open=!wrap?.classList.contains("av-open");
      document.querySelectorAll(".av-inline-flag.av-open").forEach(item=>{
        item.classList.remove("av-open");
        item.querySelector("[data-av-popover]")?.setAttribute("aria-expanded","false");
      });
      if(wrap && open){wrap.classList.add("av-open");button.setAttribute("aria-expanded","true");}
      else button.setAttribute("aria-expanded","false");
    });
  }
  function enhance(root){
    if(root.nodeType!==1 && root.nodeType!==9) return;
    if(root.matches?.(copySelector)) bindCopy(root);
    root.querySelectorAll?.(copySelector).forEach(bindCopy);
    if(root.matches?.("[data-av-popover]")) bindPopover(root);
    root.querySelectorAll?.("[data-av-popover]").forEach(bindPopover);
  }
  const start=()=>{
    enhance(document);
    if(typeof MutationObserver!=="undefined" && document.body){
      new MutationObserver(records=>{
        for(const record of records) for(const node of record.addedNodes) enhance(node);
      }).observe(document.body,{childList:true,subtree:true});
    }
  };
  document.addEventListener("click",event=>{
    if(event.target.closest?.(".av-inline-flag")) return;
    document.querySelectorAll(".av-inline-flag.av-open").forEach(item=>{
      item.classList.remove("av-open");
      item.querySelector("[data-av-popover]")?.setAttribute("aria-expanded","false");
    });
  });
  document.addEventListener("keydown",event=>{
    if(event.key!=="Escape") return;
    document.querySelectorAll(".av-inline-flag.av-open").forEach(item=>{
      item.classList.remove("av-open");
      item.querySelector("[data-av-popover]")?.setAttribute("aria-expanded","false");
    });
  });
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
})();
