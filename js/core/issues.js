import { db, auth } from "../core/firebase-core.js";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

let allIssues = [];
let currentOpenIssueId = null;
let currentUserEmail = "";

// Role check
const userRole = localStorage.getItem("Adminerva_Role") || "student";
const trustedStaff = new Set(["babaynike2013@gmail.com","josephsixson@mcstayuman.edu.ph"]);
let isSuperAdmin = false; // Verified auth email; never a localStorage role.

function escapeHTML(str) {
  if (!str) return "";
  return String(str).replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[m],
  );
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUserEmail = user.email.toLowerCase();
    isSuperAdmin = trustedStaff.has(currentUserEmail);
    fetchIssues();
  }
});
// ==========================================
// 1. REAL-TIME FEED LISTENER
// ==========================================
function fetchIssues() {
  const container = document.getElementById("issuesFeed");

  // onSnapshot listens continuously for any live changes in the database
  const q = query(collection(db, "issues"), orderBy("createdAt", "desc"));

  onSnapshot(
    q,
    (snapshot) => {
      allIssues = [];
      snapshot.forEach((docSnap) => {
        allIssues.push({ id: docSnap.id, ...docSnap.data() });
      });

      renderIssues();
      const deepLink = new URLSearchParams(location.search).get("issue");
      if (deepLink && !currentOpenIssueId && allIssues.some(item=>item.id===deepLink)) {
        window.openIssueModal(deepLink);
        history.replaceState(null,"",location.pathname);
      }

      // If the modal is currently open, dynamically refresh its stats (like upvotes or status changes) in real time too
      if (currentOpenIssueId) {
        const activeIssue = allIssues.find((i) => i.id === currentOpenIssueId);
        if (activeIssue) {
          document.getElementById("upvoteCount").textContent = (
            activeIssue.upvotes || []
          ).length;
        }
      }
    },
    (error) => {
      container.innerHTML = `<div class="p-5 text-center text-red-500 font-bold border border-red-200 bg-red-50 rounded-xl">Failed to load live issues.</div>`;
      console.error(error);
    },
  );
}

function renderIssues() {
  const container = document.getElementById("issuesFeed");
  const catFilter = document.getElementById("filterCategory").value;
  const statFilter = document.getElementById("filterStatus").value;

  const onlyMine = document.getElementById("filterMine")?.checked || false;
  const filtered = allIssues.filter((iss) => {
    if (onlyMine && (iss.reporterEmail||"").toLowerCase() !== currentUserEmail) return false;
    const matchCat = catFilter === "All" || iss.category === catFilter;
    const matchStat = statFilter === "All" || iss.status === statFilter;
    return matchCat && matchStat;
  });

  container.innerHTML = "";

  if (filtered.length === 0) {
    container.innerHTML = `<div class="py-12 text-center text-slate-400 font-medium italic border-2 border-dashed border-slate-200 rounded-xl bg-white">No reports match your filters.</div>`;
    return;
  }

  filtered.forEach((iss) => {
    const dateStr = iss.createdAt
      ? iss.createdAt.toDate().toLocaleDateString()
      : "Just now";
    const upvotes = iss.upvotes ? iss.upvotes.length : 0;
    const isLocked = iss.locked ? "🔒 " : "";

    // Status Styles
    let statStyle = "bg-slate-100 text-slate-600";
    if (iss.status === "Open") statStyle = "bg-emerald-100 text-emerald-700";
    if (iss.status === "In Progress") statStyle = "bg-amber-100 text-amber-700";
    if (iss.status === "Resolved") statStyle = "bg-blue-100 text-blue-700";

    // Priority Marker
    const prioMarker =
      iss.priority === "Critical"
        ? "🔴 "
        : iss.priority === "High"
          ? "🟠 "
          : "";

    const card = `
      <div class="bg-white p-4 rounded-xl border border-slate-200 hover:shadow-md hover:border-cyan-300 transition cursor-pointer flex gap-4 items-center group" onclick="openIssueModal('${iss.id}')">
        
        <div class="hidden sm:flex flex-col items-center justify-center bg-slate-50 border border-slate-200 rounded-lg min-w-[3rem] py-2">
            <span class="text-xs text-slate-400">👍</span>
            <span class="font-bold text-slate-700">${upvotes}</span>
        </div>

        <div class="flex-grow">
          <div class="flex items-center gap-2 mb-1.5 flex-wrap">
            <span class="${statStyle} text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">${escapeHTML(iss.status)}</span>
            <span class="text-[10px] font-bold text-slate-500 border border-slate-200 bg-slate-50 px-2 py-0.5 rounded uppercase">${escapeHTML(iss.category)}</span>
            <span class="text-[10px] text-slate-400 font-medium ml-auto">${dateStr}</span>
          </div>
          <h3 class="text-base font-bold text-slate-800 leading-tight group-hover:text-cyan-700 transition">${isLocked}${prioMarker}${escapeHTML(iss.title)}</h3>
          <p class="text-xs text-slate-500 mt-1 truncate">Reported by ${escapeHTML(iss.reporterEmail)}</p>
        </div>
      </div>
    `;
    container.insertAdjacentHTML("beforeend", card);
  });
}

document
  .getElementById("filterCategory")
  .addEventListener("change", renderIssues);
document
  .getElementById("filterStatus")
  .addEventListener("change", renderIssues);

// ==========================================
// 2. MODAL LOGIC & COMMENTS
// ==========================================
window.openIssueModal = async function (id) {
  const iss = allIssues.find((i) => i.id === id);
  if (!iss) return;

  currentOpenIssueId = id;
  const dateStr = iss.createdAt
    ? iss.createdAt.toDate().toLocaleString()
    : "Just now";

  // Build Badges
  let statStyle = "bg-slate-600 text-white";
  if (iss.status === "Open") statStyle = "bg-emerald-500 text-white";
  if (iss.status === "In Progress") statStyle = "bg-amber-500 text-white";
  if (iss.status === "Resolved") statStyle = "bg-blue-500 text-white";

  document.getElementById("modalBadges").innerHTML = `
    <span class="${statStyle} text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">${escapeHTML(iss.status)}</span>
    <span class="text-[10px] font-bold text-slate-200 border border-slate-500 px-2 py-0.5 rounded uppercase">${escapeHTML(iss.category)}</span>
    <span class="text-[10px] font-bold text-slate-200 border border-slate-500 px-2 py-0.5 rounded uppercase">Priority: ${escapeHTML(iss.priority)}</span>
  `;

  document.getElementById("modalIssueTitle").textContent = iss.title;
  document.getElementById("modalReporterData").textContent =
    (isSuperAdmin || (iss.reporterEmail||"").toLowerCase()===currentUserEmail)
      ? (iss.reporterEmail||"Reporter") : "Report submitted by a community member";
  document.getElementById("modalDateData").textContent = dateStr;
  const details = [iss.description];
  if(iss.module)details.push("Module: "+iss.module);
  if(iss.reproductionSteps)details.push("Steps to reproduce:\n"+iss.reproductionSteps);
  if(iss.expectedBehavior)details.push("Expected:\n"+iss.expectedBehavior);
  if(iss.actualBehavior)details.push("Actual:\n"+iss.actualBehavior);
  document.getElementById("modalIssueDescription").textContent = details.join("\n\n");

  // Handle Images
  const imgContainer = document.getElementById("modalScreenshots");
  imgContainer.innerHTML = "";
  if (iss.images && iss.images.length > 0) {
    iss.images.forEach((img) => {
      if(typeof img !== "string" || !/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(img)) return;
      const wrapper=document.createElement("button");
      wrapper.type="button";
      wrapper.className="aspect-video bg-slate-100 rounded border border-slate-200 overflow-hidden hover:opacity-80";
      const picture=document.createElement("img");
      picture.src=img;
      picture.alt="Issue screenshot";
      picture.className="w-full h-full object-cover";
      wrapper.append(picture);
      wrapper.addEventListener("click",()=>window.viewFullscreen(img));
      imgContainer.append(wrapper);
    });
  } else {
    imgContainer.innerHTML = `<span class="text-xs text-slate-400 italic">No evidence attached.</span>`;
  }

  // Voting Status
  const upvotes = iss.upvotes || [];
  const btn = document.getElementById("upvoteBtn");
  document.getElementById("upvoteCount").textContent = upvotes.length;

  if (upvotes.includes(currentUserEmail)) {
    btn.classList.add("bg-indigo-100", "text-indigo-700", "border-indigo-300");
  } else {
    btn.classList.remove(
      "bg-indigo-100",
      "text-indigo-700",
      "border-indigo-300",
    );
  }

  // 🚀 ADMIN CONTROLS INJECTION
  if (isSuperAdmin) {
    document.getElementById("adminControlPanel").classList.remove("hidden");
    document.getElementById("adminStatusSelect").value = iss.status || "Open";
    document.getElementById("adminPrioritySelect").value =
      iss.priority || "Medium";
    document.getElementById("adminLockBtn").textContent = iss.locked
      ? "🔓 Unlock Comments"
      : "🔒 Lock Comments";
  } else {
    document.getElementById("adminControlPanel").classList.add("hidden");
  }

  // Lock State UI
  if (iss.locked) {
    document.getElementById("commentInputBox").classList.add("hidden");
    document.getElementById("lockedNotice").classList.remove("hidden");
  } else {
    document.getElementById("commentInputBox").classList.remove("hidden");
    document.getElementById("lockedNotice").classList.add("hidden");
  }

  document.getElementById("issueDetailsModal").classList.remove("hidden");
  loadComments(id);
};

window.closeIssueModal = function () {
  document.getElementById("issueDetailsModal").classList.add("hidden");
  currentOpenIssueId = null;
};

window.viewFullscreen = function (base64) {
  document.getElementById("fullscreenImage").src = base64;
  document.getElementById("imageViewerModal").classList.remove("hidden");
};

// ==========================================
// 3. VOTING & COMMENTING LOGIC
// ==========================================
document.getElementById("upvoteBtn").addEventListener("click", async () => {
  if (!currentOpenIssueId) return;

  const issIndex = allIssues.findIndex((i) => i.id === currentOpenIssueId);
  let upvotes = allIssues[issIndex].upvotes || [];

  if (upvotes.includes(currentUserEmail)) {
    upvotes = upvotes.filter((e) => e !== currentUserEmail); // Remove vote
  } else {
    upvotes.push(currentUserEmail); // Add vote
  }

  allIssues[issIndex].upvotes = upvotes;

  // Optimistic UI Update
  document.getElementById("upvoteCount").textContent = upvotes.length;
  document.getElementById("upvoteBtn").classList.toggle("bg-indigo-100");
  document.getElementById("upvoteBtn").classList.toggle("text-indigo-700");
  renderIssues(); // Update background list

  // Database Sync
  await updateDoc(doc(db, "issues", currentOpenIssueId), { upvotes });
});
// ==========================================
// 2. REAL-TIME COMMENTS LISTENER
// ==========================================
let unsubscribeComments = null; // Track connection so it doesn't duplicate when opening different issues

function loadComments(issueId) {
  const feed = document.getElementById("commentsFeed");
  feed.innerHTML = `<div class="text-center py-4 text-xs text-slate-400">Connecting to live chat...</div>`;

  // If we were listening to a different issue's comments previously, cut that connection
  if (unsubscribeComments) {
    unsubscribeComments();
  }

  const q = query(
    collection(db, `issues/${issueId}/comments`),
    orderBy("createdAt", "asc"),
  );

  unsubscribeComments = onSnapshot(
    q,
    (snapshot) => {
      feed.innerHTML = "";
      document.getElementById("commentCount").textContent = snapshot.size;

      if (snapshot.empty) {
        feed.innerHTML = `<div class="text-center py-6 text-xs text-slate-400 italic">No comments yet. Start the discussion!</div>`;
        return;
      }

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const timeStr = data.createdAt
          ? data.createdAt.toDate().toLocaleString()
          : "Just now";
        const isAdmin = trustedStaff.has((data.authorEmail||"").toLowerCase());
        const tag = isAdmin
          ? `<span class="bg-cyan-100 text-cyan-800 text-[8px] font-bold px-1.5 py-0.5 rounded ml-2">ADMIN</span>`
          : "";

        feed.insertAdjacentHTML(
          "beforeend",
          `
                <div class="bg-white p-3 rounded-lg border border-slate-200 shadow-sm relative group">
                    <div class="flex justify-between items-start mb-1">
                        <span class="text-xs font-bold text-slate-700 flex items-center">${escapeHTML(data.authorEmail.split("@")[0])} ${tag}</span>
                        <span class="text-[9px] text-slate-400">${timeStr}</span>
                    </div>
                    <p class="text-sm text-slate-600 whitespace-pre-wrap">${escapeHTML(data.text)}</p>
                    ${isSuperAdmin ? `<button onclick="deleteComment('${docSnap.id}')" class="absolute top-2 right-2 text-red-300 hover:text-red-500 text-xs hidden group-hover:block">🗑️</button>` : ""}
                </div>
            `,
        );
      });

      feed.scrollTop = feed.scrollHeight; // Auto-scroll to latest comment
    },
    (error) => {
      console.error(error);
      feed.innerHTML = `<div class="text-center py-4 text-xs text-red-400">Error loading live comments.</div>`;
    },
  );
}

document
  .getElementById("postCommentBtn")
  .addEventListener("click", async () => {
    const textObj = document.getElementById("newCommentText");
    const text = textObj.value.trim();
    if (!text || !currentOpenIssueId) return;

    textObj.value = ""; // Clear immediately for UX

    try {
      await addDoc(collection(db, `issues/${currentOpenIssueId}/comments`), {
        text: text,
        authorEmail: currentUserEmail,
        role: isSuperAdmin ? "superadmin" : "student",
        authorUid: auth.currentUser?.uid || null,
        createdAt: serverTimestamp(),
      });
      // The live listener updates comments automatically.
    } catch (e) {
      alert("Failed to post comment.");
    }
  });

window.deleteComment = async function (commentId) {
  if (!confirm("Delete this comment permanently?")) return;
  await deleteDoc(doc(db, `issues/${currentOpenIssueId}/comments`, commentId));
  loadComments(currentOpenIssueId);
};

// ==========================================
// 4. ADMIN SUPER CONTROLS
// ==========================================
document
  .getElementById("adminStatusSelect")
  ?.addEventListener("change", async (e) => {
    if (!isSuperAdmin || !currentOpenIssueId) return;
    const newStatus = e.target.value;

    const issIndex = allIssues.findIndex((i) => i.id === currentOpenIssueId);
    allIssues[issIndex].status = newStatus;
    renderIssues();

    await updateDoc(doc(db, "issues", currentOpenIssueId), {
      status: newStatus,
      updatedAt: serverTimestamp(),
    });

    // Change modal badge color immediately
    openIssueModal(currentOpenIssueId);
  });

document
  .getElementById("adminPrioritySelect")
  ?.addEventListener("change", async (e) => {
    if (!isSuperAdmin || !currentOpenIssueId) return;
    const newPriority = e.target.value;

    const issIndex = allIssues.findIndex((i) => i.id === currentOpenIssueId);
    allIssues[issIndex].priority = newPriority;
    renderIssues();

    await updateDoc(doc(db, "issues", currentOpenIssueId), {
      priority: newPriority,
      updatedAt: serverTimestamp(),
    });
    openIssueModal(currentOpenIssueId);
  });

document.getElementById("adminLockBtn")?.addEventListener("click", async () => {
  if (!isSuperAdmin || !currentOpenIssueId) return;

  const issIndex = allIssues.findIndex((i) => i.id === currentOpenIssueId);
  const isCurrentlyLocked = allIssues[issIndex].locked || false;

  allIssues[issIndex].locked = !isCurrentlyLocked;

  await updateDoc(doc(db, "issues", currentOpenIssueId), {
    locked: !isCurrentlyLocked,
  });
  openIssueModal(currentOpenIssueId); // Refresh UI
});

document
  .getElementById("adminDeleteBtn")
  ?.addEventListener("click", async () => {
    if (!isSuperAdmin || !currentOpenIssueId) return;
    if (
      !confirm(
        "🚨 EXTREME WARNING: Are you sure you want to permanently delete this entire issue and all its comments? This cannot be undone.",
      )
    )
      return;

    await deleteDoc(doc(db, "issues", currentOpenIssueId));
    allIssues = allIssues.filter((i) => i.id !== currentOpenIssueId);
    closeIssueModal();
    renderIssues();
  });
