import {resolveStaffRole} from "../core/staff-session.mjs?v=2026.10.20.1";
/** Scoped product configuration and staff preferences: settings user. */
import { auth, db } from "../core/firebase-core.js";
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
  signOutBtn.addEventListener("click", () => {
    signOut(auth).then(() => (window.location.href = "login.html"));
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
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      selectedCsvFile = e.target.files[0];
      // Note: selectedCsvFile.name is safe here as it's provided by the browser file system, but we escape it just in case
      dropzone.innerHTML = `<span class="text-3xl block mb-2">✅</span><p class="text-sm font-bold text-green-600">${escapeHTML(selectedCsvFile.name)}</p>`;
      uploadBtn.disabled = false;
    }
  });
}

if (uploadBtn) {
  uploadBtn.addEventListener("click", () => {
    if (!selectedCsvFile) return;
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Parsing CSV...";
    uploadStatus.classList.remove("hidden");
    uploadStatus.className = "text-xs font-bold text-center mt-3 text-blue-500";
    uploadStatus.textContent = "Reading file data...";

    const reader = new FileReader();
    reader.onload = async function (e) {
      const text = e.target.result;
      await processCSV(text);
    };
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

  if (emailIdx === -1)
    return showUploadError("CSV must contain a column named 'email'.");
  if (sectionIdx === -1)
    return showUploadError(
      "CSV must contain a column named 'section' or 'club'.",
    );

  uploadBtn.textContent = "Syncing to Database...";

  try {
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
      const sections = rawSectionData
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (let sec of sections) {
        const studentData = {
          email: rawEmail,
          firstName: firstName,
          lastName: lastName,
          name: fullName,
          section: sec,
          role: "student",
          enrolledAt: new Date().toISOString(),
        };

        const safeSection = sec.replace(/[^a-zA-Z0-9]/g, "");
        const compositeId = `${rawEmail}_${safeSection}`;

        const docRef = doc(db, "students", compositeId);
        batch.set(docRef, studentData, { merge: true });
        count++;
      }
    }

    await batch.commit();

    uploadStatus.className =
      "text-xs font-bold text-center mt-3 text-emerald-600";
    uploadStatus.textContent = `✅ Successfully imported ${count} multi-section records!`;
    selectedCsvFile = null;
    dropzone.innerHTML = `<span class="text-3xl block mb-2">📥</span><p class="text-sm font-bold text-slate-700">Click or drag CSV here</p><p class="text-xs text-slate-400 mt-1">Maximum 500 records per upload</p>`;

    loadDirectory();
  } catch (error) {
    showUploadError("Database Sync Failed: " + error.message);
  } finally {
    uploadBtn.textContent = "Sync to Database";
    uploadBtn.disabled = false;
  }
}

function showUploadError(msg) {
  uploadStatus.className = "text-xs font-bold text-center mt-3 text-red-500";
  uploadStatus.textContent = "❌ " + msg;
  uploadBtn.textContent = "Sync to Database";
  uploadBtn.disabled = false;
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
    syncSheetBtn.disabled = true;
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
      syncSheetBtn.textContent = "Sync Class Roster";
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

  try {
    const snap = await getDocs(collection(db, "students"));
    allStudents = [];
    let uniqueSections = new Set();

    snap.forEach((documentSnapshot) => {
      const data = documentSnapshot.data();
      if (data.email === SUPER_ADMIN_EMAIL || data.email === TEACHER_EMAIL)
        return;

      uniqueSections.add(data.section);
      const isLinked = !!(data.githubUsername && data.repoUrl);

      // Build local memory object
      allStudents.push({
        ...data,
        id: documentSnapshot.id,
        isLinked: isLinked,
        pillId: `status_${documentSnapshot.id.replace(/[^a-zA-Z0-9]/g, "")}`,
        ghStatusText: isLinked ? "Verifying..." : "Missing Info",
        ghStatusClass: isLinked
          ? "bg-blue-100 text-blue-700 animate-pulse"
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

    // Asynchronously verify GitHub status for linked accounts
    const ghToken = localStorage.getItem("Adminerva_github_token");
    allStudents.forEach((stu) => {
      if (stu.isLinked && !stu.verified) {
        verifyRepoStatusCache(stu, ghToken);
      }
    });
  } catch (error) {
    console.error(error);
    tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-red-500 font-bold">Error loading directory: ${escapeHTML(error.message)}</td></tr>`;
  }
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
    if (statusVal === "linked") matchStatus = s.isLinked;
    if (statusVal === "missing") matchStatus = !s.isLinked;
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
    tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-slate-400 font-medium">No records match your filters.</td></tr>`;
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

      const statusHtml = `<span id="${safePillId}" class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${safeStatusClass}">${safeStatusText}</span>`;

      // Feature: Show GitHub URL if available safely
      let repoLinkHtml = "";
      if (data.repoUrl) {
        const safeRepoUrl = escapeHTML(data.repoUrl);
        let displayUrl = data.repoUrl.replace("https://github.com/", "");
        try {
          const parsed = new URL(data.repoUrl);
          displayUrl = parsed.pathname.substring(1);
        } catch (e) {}

        repoLinkHtml = `<a href="${safeRepoUrl}" target="_blank" class="text-[10px] font-mono text-blue-500 hover:underline block mt-1.5 truncate w-48" title="Visit Repository">🔗 ${escapeHTML(displayUrl)}</a>`;
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
                        <button onclick="window.viewAsStudent('${safeEmail}')" class="text-blue-600 hover:text-white border border-blue-200 bg-blue-50 hover:bg-blue-600 font-bold text-[10px] uppercase tracking-wider px-3 py-1.5 rounded transition shadow-sm">View As</button>
                        <button onclick="window.revokeStudent('${safeId}')" class="text-red-500 hover:text-white font-bold text-[10px] uppercase tracking-wider border border-red-100 bg-red-50 hover:bg-red-500 px-3 py-1.5 rounded transition shadow-sm">Revoke</button>
                    </td>
                </tr>
            `;
      tbody.insertAdjacentHTML("beforeend", tr);
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
  if (!confirm(`Are you sure you want to revoke this specific access?`)) return;
  if (typeof window.showSubtleLoader === "function")
    window.showSubtleLoader("Revoking access...");

  try {
    await deleteDoc(doc(db, "students", compositeDocId));
    await loadDirectory();
  } catch (error) {
    alert("Failed to delete user: " + error.message);
  } finally {
    if (typeof window.hideSubtleLoader === "function")
      window.hideSubtleLoader();
  }
};

window.clearDirectory = async function () {
  const firstConfirm = confirm(
    "⚠️ DANGER: Are you sure you want to delete ALL students and ALL grading data? This cannot be undone.",
  );
  if (!firstConfirm) return;

  const secondConfirm = confirm(
    "Please confirm one more time. This will wipe your entire directory AND reset all analytics metrics to zero.",
  );
  if (!secondConfirm) return;

  if (typeof window.showSubtleLoader === "function")
    window.showSubtleLoader("Wiping Database...");

  try {
    const deletePromises = [];
    let studentCount = 0;
    let gradeCount = 0;

    const studentSnap = await getDocs(collection(db, "students"));
    studentSnap.forEach((documentSnapshot) => {
      const data = documentSnapshot.data();
      if (data.email === SUPER_ADMIN_EMAIL || data.email === TEACHER_EMAIL)
        return;
      deletePromises.push(deleteDoc(doc(db, "students", documentSnapshot.id)));
      studentCount++;
    });

    const gradesSnap = await getDocs(collection(db, "grades"));
    gradesSnap.forEach((documentSnapshot) => {
      deletePromises.push(deleteDoc(doc(db, "grades", documentSnapshot.id)));
      gradeCount++;
    });

    if (deletePromises.length === 0) {
      alert("The database is already completely empty.");
      if (typeof window.hideSubtleLoader === "function")
        window.hideSubtleLoader();
      return;
    }

    await Promise.all(deletePromises);
    alert(
      `✅ Hard Reset Complete: Cleared ${studentCount} students and ${gradeCount} grade records.`,
    );
    await loadDirectory();
  } catch (error) {
    console.error("Error clearing database:", error);
    alert("❌ Failed to clear database: " + error.message);
  } finally {
    if (typeof window.hideSubtleLoader === "function")
      window.hideSubtleLoader();
  }
};
