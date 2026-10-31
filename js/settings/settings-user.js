import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.0";
/** Scoped product configuration and staff preferences: settings user. */
import { auth, db } from "../core/firebase-core.js?v=1.3.0";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const SUPER_ADMIN_EMAIL = "babaynike2013@gmail.com".toLowerCase();
const TEACHER_EMAIL = "josephsixson@mcstayuman.edu.ph".toLowerCase();

// 🔒 Security Patch: Helper to neutralize malicious HTML scripts from user input
function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==========================================
// STATE MANAGEMENT & CACHE
// ==========================================
let allStudents = [];
let currentSort = { col: "name", dir: "asc" };

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  const email = user.email.toLowerCase();
  if (!await resolveStaffRole(user)) {
    window.location.href = "student-dashboard.html";
  } else {
    const pageBody = document.getElementById("pageBody");
    if (pageBody) {
      pageBody.classList.remove("hidden");
      loadDirectory();
    }
  }
});

const signOutBtn = document.getElementById("signOutBtn");
if (signOutBtn) {
  signOutBtn.addEventListener("click", async event => {
    event.preventDefault();
    try{const push=await import("../core/push-notifications.mjs?v=1.3.6");await push.departPushAccount();}catch{}
    await signOut(auth).catch(()=>{});
    window.location.href = "login.html";
  });
}

// ==========================================
// CSV PARSING & UPLOAD
// ==========================================
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("csvFile");
const uploadBtn = document.getElementById("uploadBtn");
const uploadStatus = document.getElementById("uploadStatus");
let selectedCsvFile = null;

if (dropzone && fileInput) {
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();fileInput.click();}});
  for(const type of ["dragover","dragenter"])dropzone.addEventListener(type,event=>{event.preventDefault();dropzone.dataset.dragging="true";});
  dropzone.addEventListener("dragleave",()=>{dropzone.dataset.dragging="false";});
  dropzone.addEventListener("drop",event=>{event.preventDefault();dropzone.dataset.dragging="false";chooseCsvFile(event.dataTransfer?.files?.[0]);});
  fileInput.addEventListener("change", (e) => {
    chooseCsvFile(e.target.files?.[0]);
  });
}
function chooseCsvFile(file){
  if(!file)return;
  if(!/\.csv$/i.test(file.name)){showUploadError("Choose a CSV file ending in .csv.");return;}
  selectedCsvFile=file;dropzone.replaceChildren();
  const name=document.createElement("strong"),hint=document.createElement("p");name.textContent=file.name;hint.textContent="Ready to import. Click to choose a different file.";
  dropzone.append(name,hint);uploadBtn.disabled=false;
  uploadStatus.classList.remove("hidden");uploadStatus.textContent="File selected. Import when ready.";
}

if (uploadBtn) {
  uploadBtn.addEventListener("click", () => {
    if (!selectedCsvFile) return;
    uploadBtn.disabled = true;const end=window.beginLoading?.("Importing student roster CSV…")||(()=>{});
    uploadBtn.textContent = "Parsing CSV...";
    uploadStatus.classList.remove("hidden");
    uploadStatus.className = "text-xs font-bold text-center mt-3 text-blue-500";
    uploadStatus.textContent = "Reading file data...";

    const reader = new FileReader();
    reader.onload = async function (e) {
      const text = e.target.result;
      try{await processCSV(text);}finally{end();}
    };
    reader.onerror=()=>{showUploadError("This file could not be read. Choose the file again.");end();};
    reader.readAsText(selectedCsvFile);
  });
}

async function processCSV(csvText) {
  const rows = csvText
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
  if (rows.length < 2)
    return showUploadError("CSV is empty or missing headers.");

  function splitCsvRow(row) {
    let cols = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < row.length; i++) {
      if (row[i] === '"') {
        inQuotes = !inQuotes;
      } else if (row[i] === "," && !inQuotes) {
        cols.push(cur.trim());
        cur = "";
      } else {
        cur += row[i];
      }
    }
    cols.push(cur.trim());
    return cols;
  }

  const headers = splitCsvRow(rows[0].toLowerCase());
  const emailIdx = headers.findIndex(
    (h) => h.includes("email") || h.includes("address"),
  );
  const firstIdx = headers.findIndex((h) => h.includes("first"));
  const lastIdx = headers.findIndex((h) => h.includes("last"));
  const nameIdx = headers.findIndex(
    (h) => h.includes("name") && !h.includes("first") && !h.includes("last"),
  );
  const sectionIdx = headers.findIndex(
    (h) => h.includes("section") || h.includes("club") || h.includes("class"),
  );
  const schoolYearIdx = headers.findIndex(
    (h) => h.includes("school year") || h.includes("schoolyear") || h.includes("academic year"),
  );

  if (emailIdx === -1)
    return showUploadError("CSV must contain a column named 'email'.");
  if (sectionIdx === -1)
    return showUploadError(
      "CSV must contain a column named 'section' or 'club'.",
    );

  uploadBtn.textContent = "Syncing to Database...";

  try {
    const [existingSnap,catalogSnap]=await Promise.all([
      getDocs(collection(db,"students")),
      getDocs(collection(db,"school_catalog","sections","records"))
    ]);
    const identity=(email,section,year)=>[String(email||"").toLowerCase().trim(),String(section||"").trim(),String(year||"").trim()].join("\u0000");
    const legacyIdentity=(email,section)=>[String(email||"").toLowerCase().trim(),String(section||"").trim()].join("\u0000");
    const existingByIdentity=new Map();
    const legacyCandidates=new Map();
    existingSnap.forEach(record=>{
      const data=record.data(),key=identity(data.email,data.section,data.schoolYear);
      existingByIdentity.set(key,record.id);
      const legacyKey=legacyIdentity(data.email,data.section);
      if(!legacyCandidates.has(legacyKey))legacyCandidates.set(legacyKey,[]);
      legacyCandidates.get(legacyKey).push({id:record.id,schoolYear:String(data.schoolYear||"").trim()});
    });
    const catalogSections=catalogSnap.docs.map(record=>({id:record.id,...record.data()}));
    const batch = writeBatch(db);
    let count = 0;

    for (let i = 1; i < rows.length; i++) {
      const cols = splitCsvRow(rows[i]);
      const rawEmail = cols[emailIdx]?.toLowerCase();

      if (!rawEmail || !rawEmail.includes("@")) continue;

      let firstName = firstIdx !== -1 ? cols[firstIdx] : "";
      let lastName = lastIdx !== -1 ? cols[lastIdx] : "";
      let fullName =
        nameIdx !== -1 ? cols[nameIdx] : `${firstName} ${lastName}`.trim();
      if (!fullName) fullName = "Unnamed Student";

      const rawSectionData = cols[sectionIdx] || "Unassigned";
      const csvSchoolYear=schoolYearIdx!==-1?String(cols[schoolYearIdx]||"").trim():"";
      const sections = rawSectionData
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (let sec of sections) {
        const catalogMatches=catalogSections.filter(record=>record.status!=="archived"&&
          String(record.name||"").trim().toLowerCase()===sec.toLowerCase()&&
          (!csvSchoolYear||!record.schoolYear||String(record.schoolYear).trim()===csvSchoolYear));
        const catalog=catalogMatches.length===1?catalogMatches[0]:null;
        const schoolYear=csvSchoolYear||String(catalog?.schoolYear||"").trim();
        const studentData = {
          email: rawEmail,
          firstName: firstName,
          lastName: lastName,
          name: fullName,
          section: sec,
          ...(catalog?{sectionId:catalog.id}:{}),
          ...(schoolYear?{schoolYear}:{}),
          status:"active",
          role: "student",
          enrolledAt: new Date().toISOString(),
        };

        const exactExisting=existingByIdentity.get(identity(rawEmail,sec,schoolYear));
        const legacy=legacyCandidates.get(legacyIdentity(rawEmail,sec))||[];
        const compatibleLegacy=!exactExisting&&legacy.length===1&&(!legacy[0].schoolYear||!schoolYear)?legacy[0].id:"";
        const stableSection=catalog?.id||encodeURIComponent(sec.normalize("NFKC").trim());
        const stableYear=encodeURIComponent(schoolYear||"unspecified");
        const compositeId = exactExisting||compatibleLegacy||`${rawEmail}__${stableYear}__${stableSection}`;

        const docRef = doc(db, "students", compositeId);
        batch.set(docRef, studentData, { merge: true });
        count++;
        if(count>500)throw Error("This import contains more than 500 roster records, including students in multiple sections. Split it into smaller files.");
      }
    }

    if(!count)throw Error("No valid student records were found. Check the email and section columns.");
    await batch.commit();

    uploadStatus.className =
      "text-xs font-bold text-center mt-3 text-emerald-600";
    uploadStatus.textContent = `Imported or updated ${count} roster records without deleting prior grading history. Assign these same section names to teachers next.`;
    selectedCsvFile = null;
    fileInput.value="";
    dropzone.innerHTML = `<span class="text-3xl block mb-2">📥</span><p class="text-sm font-bold text-slate-700">Click or drag CSV here</p><p class="text-xs text-slate-400 mt-1">Maximum 500 records per upload</p>`;

    loadDirectory();
  } catch (error) {
    showUploadError("Database Sync Failed: " + error.message);
  } finally {
    uploadBtn.textContent = "Import selected CSV";
    uploadBtn.disabled = !selectedCsvFile;
  }
}

function showUploadError(msg) {
  uploadStatus.className = "text-xs font-bold text-center mt-3 text-red-500";
  uploadStatus.textContent = "❌ " + msg;
  uploadStatus.classList.remove("hidden");
  uploadBtn.textContent = "Import selected CSV";
  uploadBtn.disabled = !selectedCsvFile;
}
// ==========================================
// GOOGLE SHEETS LIVE SYNC
// ==========================================
const syncSheetBtn = document.getElementById("syncSheetBtn");

// Hardcoded Google Sheets CSV Link
const ROSTER_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSBRK8KRB-RkW0nxLcRPlxhxDGxCRBI30wn9TDrbtFasZwuHDR1oZiY-N1qq6utAnZdDcragzpsDRbP/pub?output=csv";

if (syncSheetBtn) {
  syncSheetBtn.addEventListener("click", async () => {
    syncSheetBtn.disabled = true;const end=window.beginLoading?.("Importing configured roster sheet…")||(()=>{});
    syncSheetBtn.textContent = "Fetching Live Data...";

    uploadStatus.classList.remove("hidden");
    uploadStatus.className = "text-xs font-bold text-center mt-3 text-blue-500";
    uploadStatus.textContent = "Downloading Google Sheet responses...";

    try {
      const response = await fetch(ROSTER_SHEET_URL);
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const csvText = await response.text();

      syncSheetBtn.textContent = "Parsing Data...";

      await processCSV(csvText);
    } catch (err) {
      showUploadError("Failed to fetch Sheet: " + err.message);
    } finally {
      syncSheetBtn.disabled = false;
      syncSheetBtn.textContent = "Import configured sheet";end();
    }
  });
}

// ==========================================
// DIRECTORY READ, CACHE, & UI UPDATES
// ==========================================
window.loadDirectory = async function () {
  const tbody = document.getElementById("userTableBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-slate-400 italic font-medium">Fetching roster from database...</td></tr>`;

  const end=window.beginLoading?.("Loading student roster…",tbody)||(()=>{});
  try {
    const snap = await getDocs(collection(db, "students"));
    allStudents = [];
    let uniqueSections = new Set();

    snap.forEach((documentSnapshot) => {
      const data = documentSnapshot.data();
      if (data.email === SUPER_ADMIN_EMAIL || data.email === TEACHER_EMAIL)
        return;

      if(typeof data.section==="string"&&data.section.trim())uniqueSections.add(data.section);
      const isLinked = !!(data.githubUsername && data.repoUrl);

      // Build local memory object
      allStudents.push({
        ...data,
        name:data.name||[data.firstName,data.lastName].filter(Boolean).join(" ")||"Unnamed student",
        email:data.email||"",
        id: documentSnapshot.id,
        isLinked: isLinked,
        pillId: `status_${documentSnapshot.id.replace(/[^a-zA-Z0-9]/g, "")}`,
        ghStatusText: isLinked ? "Verifying..." : "Missing Info",
        ghStatusClass: isLinked
          ? "bg-blue-100 text-blue-700"
          : "bg-slate-200 text-slate-600",
        verified: false,
      });
    });

    // Populate dynamic Section Filter dropdown
    const secFilter = document.getElementById("sectionFilter");
    if (secFilter) {
      secFilter.innerHTML = `<option value="all">All Sections</option>`;
      [...uniqueSections].sort().forEach((sec) => {
        // 🔒 Security Patch: Sanitize section names for dropdowns
        secFilter.insertAdjacentHTML(
          "beforeend",
          `<option value="${escapeHTML(sec)}">${escapeHTML(sec)}</option>`,
        );
      });
    }

    applyFiltersAndRender();
    const summary=document.getElementById("directory-summary");
    if(summary){summary.textContent=allStudents.length+" student roster records across "+uniqueSections.size+" sections. Use these exact section names in teacher assignments.";summary.dataset.tone="info";}

    // Asynchronously verify GitHub status for linked accounts
    const ghToken = localStorage.getItem("Adminerva_github_token");
    allStudents.forEach((stu) => {
      if (stu.isLinked && !stu.verified && !["suspended","archived"].includes(String(stu.status||"active"))) {
        verifyRepoStatusCache(stu, ghToken);
      }
    });
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-red-500 font-bold">Error loading directory: ${escapeHTML(error.message)}</td></tr>`;
    const summary=document.getElementById("directory-summary");if(summary){summary.textContent="The student roster could not load. Check your connection and use Refresh data to try again.";summary.dataset.tone="error";}
  }finally{end();}
};
// ==========================================
// SEARCH, FILTER, SORT & PAGINATION LOGIC
// ==========================================
let currentPage = 1;
const itemsPerPage = 15;

function applyFiltersAndRender() {
  const searchVal = (
    document.getElementById("searchInput")?.value || ""
  ).toLowerCase();
  const sectionVal = document.getElementById("sectionFilter")?.value || "all";
  const statusVal = document.getElementById("statusFilter")?.value || "all";

  // 1. Filter
  let filteredData = allStudents.filter((s) => {
    const matchSearch =
      s.name.toLowerCase().includes(searchVal) ||
      s.email.toLowerCase().includes(searchVal);
    const matchSection = sectionVal === "all" || s.section === sectionVal;
    let matchStatus = true;
    const accessSuspended=["suspended","archived"].includes(String(s.status||"active"));
    if (statusVal === "linked") matchStatus = s.isLinked;
    if (statusVal === "missing") matchStatus = !s.isLinked;
    if (statusVal === "active") matchStatus = !accessSuspended;
    if (statusVal === "suspended") matchStatus = accessSuspended;
    return matchSearch && matchSection && matchStatus;
  });

  // 2. Sort
  filteredData.sort((a, b) => {
    let valA = (a[currentSort.col] || "").toString().toLowerCase();
    let valB = (b[currentSort.col] || "").toString().toLowerCase();
    if (valA < valB) return currentSort.dir === "asc" ? -1 : 1;
    if (valA > valB) return currentSort.dir === "asc" ? 1 : -1;
    return 0;
  });

  // 3. Pagination Logic
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedData = filteredData.slice(
    startIndex,
    startIndex + itemsPerPage,
  );

  // 4. Render HTML
  const tbody = document.getElementById("userTableBody");
  tbody.innerHTML = "";

  if (filteredData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-slate-500 font-medium">${allStudents.length?"No students match these filters. Try another section or search.":"No student records yet. Import a CSV roster or approve a student access request to begin."}</td></tr>`;
  } else {
    paginatedData.forEach((data) => {
      // 🔒 Security Patch: Sanitize all variables before injecting into innerHTML/insertAdjacentHTML
      const safePillId = escapeHTML(data.pillId);
      const safeStatusClass = escapeHTML(data.ghStatusClass);
      const safeStatusText = escapeHTML(data.ghStatusText);
      const safeName = escapeHTML(data.name);
      const safeSection = escapeHTML(data.section);
      const safeEmail = escapeHTML(data.email);
      const safeId = escapeHTML(data.id);

      const accessSuspended=["suspended","archived"].includes(String(data.status||"active"));
      const accessHtml=accessSuspended?'<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 mr-1">Access suspended</span>':"";
      const statusHtml = accessHtml+`<span id="${safePillId}" class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${safeStatusClass}">${safeStatusText}</span>`;

      // Feature: Show GitHub URL if available safely
      let repoLinkHtml = "";
      if (/^https:\/\/github\.com\//i.test(data.repoUrl||"")) {
        const safeRepoUrl = escapeHTML(data.repoUrl);
        let displayUrl = data.repoUrl.replace("https://github.com/", "");
        try {
          const parsed = new URL(data.repoUrl);
          displayUrl = parsed.pathname.substring(1);
        } catch (e) {}

        repoLinkHtml = `<a href="${safeRepoUrl}" target="_blank" rel="noopener noreferrer" class="text-[10px] font-mono text-blue-500 hover:underline block mt-1.5 truncate w-48" title="Visit Repository">🔗 ${escapeHTML(displayUrl)}</a>`;
      }

      const tr = `
                <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                    <td class="px-6 py-4">
                        <div class="font-medium text-slate-800">${safeName}</div>
                        <div class="text-[10px] font-bold text-blue-500 uppercase tracking-wider mt-0.5">${safeSection}</div>
                    </td>
                    <td class="px-6 py-4 text-slate-500 font-mono text-xs">${safeEmail}</td>
                    <td class="px-6 py-4 align-top">
                      ${statusHtml}
                      ${repoLinkHtml}
                    </td>
                    <td class="px-6 py-4 text-right align-top whitespace-nowrap space-x-1">
                        <button type="button" data-student-action="view" class="text-blue-600 hover:text-white border border-blue-200 bg-blue-50 hover:bg-blue-600 font-bold text-[10px] uppercase tracking-wider px-3 py-1.5 rounded transition shadow-sm">View As</button>
                        <button type="button" data-student-action="revoke" class="text-red-500 hover:text-white font-bold text-[10px] uppercase tracking-wider border border-red-100 bg-red-50 hover:bg-red-500 px-3 py-1.5 rounded transition shadow-sm">${accessSuspended?"Restore":"Suspend"}</button>
                    </td>
                </tr>
            `;
      tbody.insertAdjacentHTML("beforeend", tr);
      const row=tbody.lastElementChild;row.querySelector('[data-student-action="view"]').addEventListener("click",()=>window.viewAsStudent(data.email));row.querySelector('[data-student-action="revoke"]').addEventListener("click",()=>accessSuspended?window.restoreStudent(data.id):window.revokeStudent(data.id));
    });
  }

  // 5. Update UI Controls
  const footerCount = document.getElementById("footerCount");
  if (footerCount && filteredData.length > 0) {
    footerCount.innerHTML = `Showing <strong class="text-slate-700">${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredData.length)}</strong> of <strong class="text-slate-700">${filteredData.length}</strong> records`;
  } else if (footerCount) {
    footerCount.textContent = "0 records";
  }

  const paginationContainer = document.getElementById("paginationControls");
  if (paginationContainer) {
    paginationContainer.innerHTML = `
      <button onclick="window.prevPage()" class="px-3 py-1 bg-white border border-slate-300 rounded font-bold hover:bg-slate-50 transition disabled:opacity-50 disabled:cursor-not-allowed" ${currentPage === 1 ? "disabled" : ""}>&larr; Prev</button>
      <span class="px-3 py-1 text-slate-700 font-bold">Page ${currentPage} of ${totalPages || 1}</span>
      <button onclick="window.nextPage()" class="px-3 py-1 bg-white border border-slate-300 rounded font-bold hover:bg-slate-50 transition disabled:opacity-50 disabled:cursor-not-allowed" ${currentPage >= totalPages ? "disabled" : ""}>Next &rarr;</button>
    `;
  }

  document.getElementById("sort-name").textContent =
    currentSort.col === "name" ? (currentSort.dir === "asc" ? "↑" : "↓") : "";
  document.getElementById("sort-email").textContent =
    currentSort.col === "email" ? (currentSort.dir === "asc" ? "↑" : "↓") : "";
  for(const col of ["name","email"])document.getElementById("sort-"+col+"-header")?.setAttribute("aria-sort",currentSort.col===col?(currentSort.dir==="asc"?"ascending":"descending"):"none");
}

// Ensure filters reset to Page 1 when used
document.getElementById("searchInput")?.addEventListener("input", () => {
  currentPage = 1;
  applyFiltersAndRender();
});
document.getElementById("sectionFilter")?.addEventListener("change", () => {
  currentPage = 1;
  applyFiltersAndRender();
});
document.getElementById("statusFilter")?.addEventListener("change", () => {
  currentPage = 1;
  applyFiltersAndRender();
});

window.prevPage = function () {
  if (currentPage > 1) {
    currentPage--;
    applyFiltersAndRender();
  }
};
window.nextPage = function () {
  currentPage++;
  applyFiltersAndRender();
};

window.sortTable = function (colName) {
  if (currentSort.col === colName)
    currentSort.dir = currentSort.dir === "asc" ? "desc" : "asc";
  else {
    currentSort.col = colName;
    currentSort.dir = "asc";
  }
  currentPage = 1;
  applyFiltersAndRender();
};

// ==========================================
// IMPERSONATION (VIEW AS)
// ==========================================
window.viewAsStudent = function (studentEmail) {
  // Set the target email and mock our role so auth-guard allows us into the dashboard
  localStorage.setItem("Adminerva_Impersonate", studentEmail);
  localStorage.setItem("Adminerva_Mock_Role", "student");
  window.location.href = "student-dashboard.html";
};

// ==========================================
// BACKGROUND GITHUB VERIFICATION (NO RATE LIMIT SPAM)
// ==========================================
async function verifyRepoStatusCache(stu, token) {
  if (!token) {
    stu.ghStatusClass = "bg-green-100 text-green-700";
    stu.ghStatusText = "Linked (No Token)";
    stu.verified = true;
    updateDOMStatus(stu);
    return;
  }
  try {
    // 🔒 Security Patch: Native URL parsing to sanitize URL substrings
    let owner, repo;
    try {
      const parsedUrl = new URL(stu.repoUrl);
      const urlParts = parsedUrl.pathname
        .replace(/\/$/, "")
        .replace(".git", "")
        .split("/");
      repo = urlParts.pop();
      owner = urlParts.pop();
    } catch (e) {
      stu.ghStatusClass = "bg-red-100 text-red-700";
      stu.ghStatusText = "Invalid URL";
      stu.verified = true;
      updateDOMStatus(stu);
      return;
    }

    // ==========================================
    // 🔄 AUTO-UPDATE RENAME LOGIC (DIRECTORY)
    // ==========================================
    try {
      const repoInfoRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (repoInfoRes.ok) {
        const repoInfo = await repoInfoRes.json();
        const actualUrl = repoInfo.html_url + ".git";

        if (
          stu.repoUrl.toLowerCase() !== actualUrl.toLowerCase() &&
          stu.repoUrl.toLowerCase() !== repoInfo.html_url.toLowerCase()
        ) {
          console.log(
            `Auto-fixing renamed repository in directory: ${stu.repoUrl} -> ${actualUrl}`,
          );

          // 1. Permanently fix it in the database
          await setDoc(
            doc(db, "students", stu.id),
            { repoUrl: actualUrl },
            { merge: true },
          );

          // 2. Update local variables so the status check below uses the new name
          stu.repoUrl = actualUrl;
          owner = repoInfo.owner.login;
          repo = repoInfo.name;
        }
      }
    } catch (autoUpdateError) {
      console.warn("Directory rename check failed", autoUpdateError);
    }
    // ==========================================

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    stu.verified = true;

    if (res.ok) {
      stu.ghStatusClass = "bg-emerald-100 text-emerald-700";
      stu.ghStatusText = "Active Repo";
    } else if (res.status === 409) {
      stu.ghStatusClass = "bg-amber-100 text-amber-700";
      stu.ghStatusText = "Linked, Empty";
    } else if (res.status === 404) {
      stu.ghStatusClass = "bg-red-100 text-red-700";
      stu.ghStatusText = "Not Found / Private";
    } else {
      stu.ghStatusClass = "bg-red-100 text-red-700";
      stu.ghStatusText = "API Error";
    }
    updateDOMStatus(stu);
  } catch (e) {
    stu.verified = true;
    stu.ghStatusClass = "bg-red-100 text-red-700";
    stu.ghStatusText = "Network Error";
    updateDOMStatus(stu);
  }
}

// Only updates the DOM if the element is currently visible on screen
function updateDOMStatus(stu) {
  const pill = document.getElementById(stu.pillId);
  if (pill) {
    pill.className = `inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${escapeHTML(stu.ghStatusClass)}`;
    pill.textContent = stu.ghStatusText; // textContent natively mitigates XSS
  }
}

// ==========================================
// DATA DELETION
// ==========================================
window.revokeStudent = async function (compositeDocId) {
  if (!confirm("Suspend this student's school access? Their roster record, grades, submissions, evidence, and history will be preserved.")) return;
  if (typeof window.showSubtleLoader === "function") window.showSubtleLoader("Suspending access...");
  try {
    await setDoc(doc(db, "students", compositeDocId),{
      status:"suspended",suspendedAt:new Date().toISOString(),suspendedBy:auth.currentUser?.uid||""
    },{merge:true});
    await loadDirectory();
  } catch (error) {
    alert("Failed to suspend access: " + error.message);
  } finally {
    if (typeof window.hideSubtleLoader === "function") window.hideSubtleLoader();
  }
};

window.restoreStudent = async function (compositeDocId) {
  if (!confirm("Restore this student's school access using the preserved roster record?")) return;
  if (typeof window.showSubtleLoader === "function") window.showSubtleLoader("Restoring access...");
  try {
    await setDoc(doc(db,"students",compositeDocId),{
      status:"active",restoredAt:new Date().toISOString(),restoredBy:auth.currentUser?.uid||""
    },{merge:true});
    await loadDirectory();
  } catch (error) {
    alert("Failed to restore access: " + error.message);
  } finally {
    if (typeof window.hideSubtleLoader === "function") window.hideSubtleLoader();
  }
};

window.clearDirectory = async function () {
  const firstConfirm = confirm(
    "Suspend access for every student in the current roster? Grades, submissions, evidence, and historical records will be preserved.",
  );
  if (!firstConfirm) return;
  const secondConfirm = confirm(
    "Confirm bulk suspension. Students will lose normal workspace admission until restored or re-imported; academic history will not be deleted.",
  );
  if (!secondConfirm) return;

  if (typeof window.showSubtleLoader === "function") window.showSubtleLoader("Suspending roster access...");
  try {
    const studentSnap = await getDocs(collection(db, "students"));
    const records=studentSnap.docs.filter(record=>{
      const email=String(record.data()?.email||"").toLowerCase();
      return email!==SUPER_ADMIN_EMAIL&&email!==TEACHER_EMAIL&&record.data()?.status!=="suspended";
    });
    if(records.length>500)throw Error("More than 500 student records are active. Suspend sections separately before using the bulk action.");
    if(!records.length){alert("All student roster records are already suspended.");return;}
    const batch=writeBatch(db),actor=auth.currentUser?.uid||"",timestamp=new Date().toISOString();
    for(const record of records)batch.set(record.ref,{status:"suspended",suspendedAt:timestamp,suspendedBy:actor},{merge:true});
    await batch.commit();
    alert(`Suspended ${records.length} student access record${records.length===1?"":"s"}. Grades, submissions, evidence, and history were preserved.`);
    await loadDirectory();
  } catch (error) {
    console.error("Error suspending roster:", error);
    alert("Failed to suspend roster access: " + error.message);
  } finally {
    if (typeof window.hideSubtleLoader === "function") window.hideSubtleLoader();
  }
};
