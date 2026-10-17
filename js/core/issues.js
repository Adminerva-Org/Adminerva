import { db, auth } from "../core/firebase-core.js";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  runTransaction,
  deleteDoc,
  addDoc,
  query,
  orderBy,
  where,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { filterReports, ownsReport } from "./report-filters.mjs";

let allIssues = [];
let currentOpenIssueId = null;
let currentUserEmail = "";

// Role check
const trustedStaff = new Set(["babaynike2013@gmail.com","josephsixson@mcstayuman.edu.ph"]);
let isSuperAdmin = false; // Verified auth email; never a localStorage role.
let isTeacher = false;
let stopIssueListeners = [];
function ownsIssue(issue) {
  return ownsReport(issue,auth.currentUser?.uid,currentUserEmail);
}
const filterIds=["filterCategory","filterStatus","filterAudience","filterSort","filterMine","filterSearch"];
function filterStoreKey(){return auth.currentUser?.uid
  ?"Adminerva_ReportFilters_"+auth.currentUser.uid:null}
function saveReportFilters(){
  const key=filterStoreKey();if(!key)return;
  const value={};
  for(const id of filterIds){
    const input=document.getElementById(id);
    if(input)value[id]=input.type==="checkbox"?input.checked:input.value;
  }
  try{localStorage.setItem(key,JSON.stringify(value))}catch(error){
    console.warn("Report filter preference could not be saved:",error);
  }
}
function restoreReportFilters(){
  const key=filterStoreKey();if(!key)return;
  let stored;
  try{stored=JSON.parse(localStorage.getItem(key)||"null")}catch{return}
  if(!stored||typeof stored!=="object")return;
  for(const id of filterIds){
    const input=document.getElementById(id);
    if(!input)continue;
    if(input.type==="checkbox")input.checked=stored[id]===true;
    else if(typeof stored[id]==="string"){
      if(input.tagName==="SELECT"&&
        ![...input.options].some(option=>option.value===stored[id]))continue;
      input.value=stored[id];
    }
  }
}

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

onAuthStateChanged(auth, user => {
  stopIssueListeners.forEach(stop => stop()); stopIssueListeners = [];
  if (user) {
    currentUserEmail = (user.email||"").toLowerCase();
    isSuperAdmin = currentUserEmail === [...trustedStaff][0];
    isTeacher = currentUserEmail === [...trustedStaff][1];
    restoreReportFilters();
    fetchIssues();
  } else {
    allIssues = [];
    currentUserEmail = "";
    isSuperAdmin = false;
    isTeacher = false;
    currentOpenIssueId = null;
    if(unsubscribeComments){unsubscribeComments();unsubscribeComments=null;}
    document.getElementById("issueDetailsModal")?.classList.add("hidden");
    renderIssues();
  }
});
// ==========================================
// 1. REAL-TIME FEED LISTENER
// ==========================================
function fetchIssues() {
  const container = document.getElementById("issuesFeed");
  const user = auth.currentUser;
  if (!user) return;
  // Query only documents the authenticated role may read.
  const requests = isSuperAdmin
    ? [query(collection(db, "issues"), orderBy("createdAt", "desc"))]
    : isTeacher
      ? [
          query(collection(db,"issues"),where("audience","==","teacher")),
          query(collection(db,"issues"),where("reporterUid","==",user.uid)),
          query(collection(db,"issues"),where("reporterEmail","==",currentUserEmail))
        ]
      : [
          query(collection(db, "issues"), where("reporterUid", "==", user.uid)),
          query(collection(db, "issues"), where("reporterEmail", "==", currentUserEmail))
        ];
  const groups = requests.map(() => []);
  const refresh = () => {
    const merged = new Map();
    groups.flat().forEach(item => merged.set(item.id, item));
    allIssues = [...merged.values()].sort((a,b)=>
      (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    renderIssues();
    const deepLink = new URLSearchParams(location.search).get("issue");
    if (deepLink && !currentOpenIssueId && allIssues.some(item=>item.id===deepLink)) {
      window.openIssueModal(deepLink);
      history.replaceState(null,"",location.pathname);
    }
    if (currentOpenIssueId) {
      const activeIssue = allIssues.find(item=>item.id===currentOpenIssueId);
      if (activeIssue) document.getElementById("upvoteCount").textContent =
        (activeIssue.upvotes||[]).length;
    }
  };
  requests.forEach((request,index)=>{
    stopIssueListeners.push(onSnapshot(request,snapshot=>{
      groups[index]=snapshot.docs.map(d=>({id:d.id,...d.data()}));
      refresh();
    },error=>{
      console.error("Report feed unavailable:",error);
      container.textContent="Failed to load reports permitted for your account.";
    }));
  });
}

window.renderIssuesFilter = () => {saveReportFilters();renderIssues()};
function resetReportFilters(){
  for(const id of ["filterCategory","filterStatus","filterAudience"]){
    const input=document.getElementById(id);if(input)input.value="All";
  }
  document.getElementById("filterSort").value="newest";
  document.getElementById("filterSearch").value="";
  document.getElementById("filterMine").checked=false;
  saveReportFilters();renderIssues();
}
function renderIssues() {
  const container = document.getElementById("issuesFeed");
  if(!container)return;
  const filtered=filterReports(allIssues,{
    role:isSuperAdmin?"admin":isTeacher?"teacher":"student",
    uid:auth.currentUser?.uid||"",email:currentUserEmail,
    category:document.getElementById("filterCategory")?.value||"All",
    status:document.getElementById("filterStatus")?.value||"All",
    audience:document.getElementById("filterAudience")?.value||"All",
    onlyMine:document.getElementById("filterMine")?.checked||false,
    search:document.getElementById("filterSearch")?.value||"",
    sort:document.getElementById("filterSort")?.value||"newest"
  });
  const summary=document.getElementById("issuesFeedSummary");
  if(summary)summary.textContent=filtered.length+" of "+allIssues.length+" accessible reports shown";
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
            <span class="text-[10px] font-bold text-blue-800 border border-blue-200 bg-blue-50 px-2 py-0.5 rounded uppercase">To ${(iss.audience||"admin")==="teacher"?"Teacher":"Admin"}</span>
            <span class="text-[10px] text-slate-400 font-medium ml-auto">${dateStr}</span>
          </div>
          <h3 class="text-base font-bold text-slate-800 leading-tight group-hover:text-cyan-700 transition">${isLocked}${prioMarker}${escapeHTML(iss.title)}</h3>
          <p class="text-xs text-slate-500 mt-1 truncate">Reported by ${ownsIssue(iss) ? "You" : isSuperAdmin ? "Student / Staff member" : "Community member"}</p>
        </div>
      </div>
    `;
    container.insertAdjacentHTML("beforeend", card);
  });
}

for(const id of ["filterCategory","filterStatus","filterAudience","filterSort","filterMine"]){
  document.getElementById(id)?.addEventListener("change",window.renderIssuesFilter);
}
document.getElementById("filterSearch")?.addEventListener("input",window.renderIssuesFilter);
document.getElementById("resetReportFilters")?.addEventListener("click",resetReportFilters);

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
    <span class="text-[10px] font-bold text-cyan-100 border border-cyan-500 px-2 py-0.5 rounded uppercase">To ${(iss.audience||"admin")==="teacher"?"Teacher":"Admin"}</span>
  `;

  document.getElementById("modalIssueTitle").textContent = iss.title;
  document.getElementById("modalReporterData").textContent =
    ownsIssue(iss) ? "Report submitted by you" :
    isSuperAdmin ? "Report submitted by an authenticated user" :
    "Report submitted by a community member";
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

  if (upvotes.includes(auth.currentUser?.uid) || upvotes.includes(currentUserEmail)) {
    btn.classList.add("bg-indigo-100", "text-indigo-700", "border-indigo-300");
  } else {
    btn.classList.remove(
      "bg-indigo-100",
      "text-indigo-700",
      "border-indigo-300",
    );
  }

  // 🚀 ADMIN CONTROLS INJECTION
  if (isSuperAdmin || (isTeacher && iss.audience === "teacher")) {
    document.getElementById("adminControlPanel").classList.remove("hidden");
    document.getElementById("adminControlLabel").textContent =
      isSuperAdmin ? "Administrator controls:" : "Teacher controls:";
    document.getElementById("adminDeleteBtn").classList.toggle("hidden",!isSuperAdmin);
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
  // Stop reading live comments after the report is closed (Firestore usage).
  if(unsubscribeComments){unsubscribeComments();unsubscribeComments=null;}
};

window.viewFullscreen = function (base64) {
  document.getElementById("fullscreenImage").src = base64;
  document.getElementById("imageViewerModal").classList.remove("hidden");
};

// ==========================================
// 3. VOTING & COMMENTING LOGIC
// ==========================================
document.getElementById("upvoteBtn").addEventListener("click", async () => {
  if (!currentOpenIssueId || !auth.currentUser?.uid) return;
  const button=document.getElementById("upvoteBtn");
  const issueId=currentOpenIssueId, voterUid=auth.currentUser.uid;
  button.disabled=true;
  try {
    // Read and update votes atomically. A simultaneous classmate vote cannot
    // overwrite another user's vote or forge somebody else's identity.
    const currentVotes=await runTransaction(db,async transaction=>{
      const ref=doc(db,"issues",issueId);
      const snapshot=await transaction.get(ref);
      if(!snapshot.exists())throw new Error("This issue no longer exists.");
      const votes=Array.isArray(snapshot.data().upvotes)?snapshot.data().upvotes:[];
      const mine=votes.includes(voterUid)?voterUid:
        votes.includes(currentUserEmail)?currentUserEmail:null;
      const next=mine?votes.filter(value=>value!==mine):[...votes,voterUid];
      transaction.update(ref,{upvotes:next});
      return next;
    });
    const issue=allIssues.find(item=>item.id===issueId);
    if(issue)issue.upvotes=currentVotes;
    document.getElementById("upvoteCount").textContent=String(currentVotes.length);
    const voted=currentVotes.includes(voterUid)||currentVotes.includes(currentUserEmail);
    button.classList.toggle("bg-indigo-100",voted);
    button.classList.toggle("text-indigo-700",voted);
    button.classList.toggle("border-indigo-300",voted);
    renderIssues();
  } catch(error) {
    console.warn("Could not update issue vote",error);
    alert("Your vote could not be saved. Reload the report and try again.");
  } finally {
    button.disabled=false;
  }
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
                        <span class="text-xs font-bold text-slate-700 flex items-center">${escapeHTML((data.authorEmail||"").split("@")[0] || "Member")} ${tag}</span>
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

    const issueId=currentOpenIssueId;
    const button=document.getElementById("postCommentBtn");
    button.disabled=true;
    try {
      await addDoc(collection(db, `issues/${issueId}/comments`), {
        text: text,
        authorEmail: isSuperAdmin ? currentUserEmail : "",
        role: isSuperAdmin ? "superadmin" : "student",
        authorUid: auth.currentUser?.uid || null,
        createdAt: serverTimestamp(),
      });
      textObj.value=""; // Clear only after Firestore accepts the comment.
    } catch (e) {
      alert("Failed to post comment. Your draft is still in the comment box.");
    } finally {
      button.disabled=false;
    }
  });

window.deleteComment = async function (commentId) {
  if (!confirm("Delete this comment permanently?")) return;
  await deleteDoc(doc(db, `issues/${currentOpenIssueId}/comments`, commentId));
  loadComments(currentOpenIssueId);
};

// ==========================================
// 4. AUTHORIZED REPORT TRIAGE
// ==========================================
function canTriage(issue){
  return isSuperAdmin || (isTeacher && issue?.audience==="teacher");
}
async function updateIssueField(field,value,{button}={}){
  const id=currentOpenIssueId,issue=allIssues.find(item=>item.id===id);
  if(!id||!issue||!canTriage(issue))return;
  const previous=issue[field];
  if(button)button.disabled=true;
  issue[field]=value;
  renderIssues();
  try{
    await updateDoc(doc(db,"issues",id),{
      [field]:value,updatedAt:serverTimestamp()
    });
    if(currentOpenIssueId===id)window.openIssueModal(id);
  }catch(error){
    console.warn("Report update failed:",error);
    issue[field]=previous;
    renderIssues();
    if(currentOpenIssueId===id)window.openIssueModal(id);
    alert("Report change could not be saved. Your previous value has been restored.");
  }finally{
    if(button)button.disabled=false;
  }
}
document.getElementById("adminStatusSelect")?.addEventListener("change",e=>{
  void updateIssueField("status",e.target.value,{button:e.target});
});
document.getElementById("adminPrioritySelect")?.addEventListener("change",e=>{
  void updateIssueField("priority",e.target.value,{button:e.target});
});
document.getElementById("adminLockBtn")?.addEventListener("click",e=>{
  const issue=allIssues.find(item=>item.id===currentOpenIssueId);
  if(issue)void updateIssueField("locked",!Boolean(issue.locked),{button:e.currentTarget});
});
document.getElementById("adminDeleteBtn")?.addEventListener("click",async()=>{
  if(!isSuperAdmin||!currentOpenIssueId)return;
  if(!confirm("Delete this report? Historical comments may remain in Firebase until separately removed. This cannot be undone."))return;
  try{
    await deleteDoc(doc(db,"issues",currentOpenIssueId));
    allIssues=allIssues.filter(item=>item.id!==currentOpenIssueId);
    window.closeIssueModal();renderIssues();
  }catch(error){
    console.warn("Unable to delete report:",error);
    alert("Report deletion failed. No change was made.");
  }
});
