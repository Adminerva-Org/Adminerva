document.addEventListener("DOMContentLoaded", () => {
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
        <div id="bug-modal" class="hidden fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
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
                <button onclick="document.getElementById('bug-modal').classList.add('hidden')" class="absolute top-4 right-4 text-slate-400 hover:text-cyan-400 transition text-xl">&times;</button>
                
                <div class="flex justify-between items-center mb-4 border-b border-slate-700 pb-3">
                  <h2 class="text-xl font-bold text-cyan-400 flex items-center gap-2"><span>🚨</span> Report an Issue</h2>
                  <a href="issues.html" class="text-xs font-bold text-slate-400 hover:text-cyan-400 transition underline">View Known Issues</a>
                </div>
                
                <div class="overflow-y-auto pr-2 flex-1 space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Category</label>
                            <select id="bug-category" class="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-400 cursor-pointer">
                                <option value="Bug">🐛 Bug / System Error</option>
                                <option value="Access">🔐 Login / Access Issue</option>
                                <option value="Feature">✨ Feature Request</option>
                                <option value="UI">📱 UI / Display Issue</option>
                                <option value="Other">❓ Other</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Priority</label>
                            <select id="bug-priority" class="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-400 cursor-pointer">
                                <option value="Low">🟢 Low</option>
                                <option value="Medium" selected>🟡 Medium</option>
                                <option value="High">🟠 High</option>
                                <option value="Critical">🔴 Critical (Blocks Work)</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Issue Summary</label>
                        <input type="text" maxlength="160" id="bug-title" class="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-400" placeholder="A brief title of the problem...">
                    </div>

                    <div>
                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Detailed Description</label>
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
                    <p class="text-xs text-amber-200">Screenshots may contain names or other personal information. Crop or redact anything not necessary to diagnose the issue.</p>
                    <div class="bg-slate-900/50 p-3 rounded border border-slate-700 border-dashed">
                        <div class="flex justify-between items-center mb-2">
                            <label class="block text-[10px] font-bold text-cyan-500 uppercase tracking-wider">
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

  document.body.insertAdjacentHTML("beforeend", loaderHTML);
  bindBugReporterLogic();
});

// ==========================================
// GLOBAL LOADER FUNCTIONS
// ==========================================
let subtleLoaderHideTimer = null;
let subtleLoaderEnterTimer = null;
window.showSubtleLoader = function (message = "Processing...") {
  const loader = document.getElementById("subtleLoader");
  const label = document.getElementById("subtleLoaderText");
  if (!loader || !label) return;
  clearTimeout(subtleLoaderHideTimer);
  clearTimeout(subtleLoaderEnterTimer);
  label.textContent = String(message);
  loader.classList.remove("hidden");
  subtleLoaderEnterTimer = setTimeout(() => {
    loader.classList.remove("translate-y-20", "opacity-0");
    loader.classList.add("translate-y-0", "opacity-100");
  }, 10);
};

window.hideSubtleLoader = function () {
  const loader = document.getElementById("subtleLoader");
  if (!loader) return;
  clearTimeout(subtleLoaderEnterTimer);
  clearTimeout(subtleLoaderHideTimer);
  loader.classList.remove("translate-y-0", "opacity-100");
  loader.classList.add("translate-y-20", "opacity-0");
  subtleLoaderHideTimer = setTimeout(() => loader.classList.add("hidden"), 250);
};

// ==========================================
// BUG REPORTER LOGIC (Images & Paste)
// ==========================================
function bindBugReporterLogic() {
  window.bugImages = [];
  const fileInput = document.getElementById("bug-image-upload");
  const modal = document.getElementById("bug-modal");

  fileInput.addEventListener("change", (e) => {
    processBugFiles(Array.from(e.target.files));
    e.target.value = "";
  });

  window.addEventListener("paste", (e) => {
    if (modal.classList.contains("hidden")) return;
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    const files = [];
    for (let item of items) {
      if (item.type.indexOf("image") === 0) files.push(item.getAsFile());
    }
    if (files.length > 0) processBugFiles(files);
  });
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
          <button onclick="window.removeBugImage(${index})" class="absolute top-0 right-0 bg-red-600/90 hover:bg-red-500 text-white w-5 h-5 flex items-center justify-center text-[10px] font-bold opacity-0 group-hover:opacity-100 transition shadow">✕</button>
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
    const { collection, getDocs } =
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
    const snap = await getDocs(collection(window.db, "issues"));
    let similarIssues = [];

    snap.forEach((doc) => {
      const data = doc.data();
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

    const payload = {
      category,
      priority,
      title,
      description,
      images: window.bugImages,
      urlContext: window.location.href,
      reporterEmail: currentUser.email.toLowerCase(),
      reporterUid: currentUser.uid,
      module: document.getElementById("bug-module").value,
      reproductionSteps: document.getElementById("bug-reproduction").value.trim(),
      expectedBehavior: document.getElementById("bug-expected").value.trim(),
      actualBehavior: document.getElementById("bug-actual").value.trim(),
      clientContext: navigator.userAgent.slice(0,300),
      reporterRole: localStorage.getItem("Adminerva_Role") || "Unknown",
      status: "Open",
      upvotes: [],
      locked: false,
      createdAt: serverTimestamp(),
    };

    const receipt = await addDoc(collection(window.db, "issues"), payload);

    // Reset Form
    document.getElementById("bug-title").value = "";
    document.getElementById("bug-description").value = "";
    document.getElementById("bug-category").value = "Bug";
    document.getElementById("bug-priority").value = "Medium";
    for (const id of ["bug-reproduction","bug-expected","bug-actual"]) {
      document.getElementById(id).value = "";
    }
    window.bugImages = [];
    renderBugThumbnails();

    document.getElementById("bug-modal").classList.add("hidden");

    window.showSubtleLoader("Report received. Reference: " + receipt.id.slice(0,10));
    alert("Report submitted successfully. Reference: " + receipt.id.slice(0,10) + ". You can follow updates in the notification center or Reports page.");
    setTimeout(() => window.hideSubtleLoader(), 3000);
  } catch (error) {
    console.error(error);
    alert("Failed to submit report: " + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Report";
  }
};
