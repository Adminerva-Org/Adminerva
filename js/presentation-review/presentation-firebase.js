import {requireCurrentVersion} from "../lesson-review/workspace-model.mjs?v=2026.10.20.1";
import {ownedDoc,ownedCollection,lessonStorage,workspaceUid,assertWorkspaceAccount,workspaceOnReady,requireStaffWorkspace} from "../lesson-review/workspace-session.mjs?v=1.1.0";
/** Saved deck storage, lesson linking and source-version checks. */
import { db } from "../core/firebase-core.js";
import {lessonStarterDeck,lessonSourceChanged} from "./lesson-to-slides.mjs?v=2026.10.19.1";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  runTransaction,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

window.availablePlans = [];
window.selectedPlanData = null;
window.selectedSessionData = null;
window.selectedSessionIndex = null;
window.db = db;
let sessionLoadSequence=0;

workspaceOnReady( () => {
  injectPlanSelectorUI();
  initFirebase();
});

function initFirebase() {
  const select = document.getElementById("presentationPlanSelect");

  if (!db) {
    if (select)
      select.innerHTML = '<option value="">Firebase disconnected</option>';
    return;
  }

  try {
    window.db = db;
    fetchSavedLessonPlans();
  } catch (e) {
    if (select)
      select.innerHTML = '<option value="">Error loading Firebase</option>';
  }
}

function injectPlanSelectorUI() {
  const listContainer = document.getElementById("slideBlockList");
  if (!listContainer || !listContainer.parentElement) return;

  const selectorHTML = `
        <div class="mb-4 bg-gray-50 p-3 rounded border border-gray-200 w-full relative">
            <button onclick="openPresentationHistory()" class="absolute top-9 right-2 text-xs font-bold text-blue-700 hover:underline">Version history</button>
            <button onclick="openArchiveManager()" class="absolute top-2 right-2 text-gray-400 hover:text-red-500 text-xs font-bold transition flex items-center gap-1" title="Recycle Bin">
                <span>🗑️</span> Archive
            </button>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1 mt-1">1. Select Saved Lesson</label>
            <select id="presentationPlanSelect" onchange="handlePlanSelection()" class="w-full p-1.5 mb-3 border border-gray-300 rounded text-xs bg-white focus:ring-blue-500">
                <option value="">Loading plans...</option>
            </select>
            
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">2. Select Session/Day</label>
            <select id="presentationSessionSelect" onchange="handleSessionSelection()" class="w-full p-1.5 mb-3 border border-gray-300 rounded text-xs bg-white focus:ring-blue-500" disabled>
                <option value="">Awaiting lesson...</option>
            </select>

            <button onclick="generateAI_SlideDeck()" id="btnGenerateSlides" class="w-full bg-purple-600 text-white font-bold py-2 rounded text-sm hover:bg-purple-700 transition shadow-sm opacity-50 cursor-not-allowed" disabled>
                Generate system slide draft
            </button>
            <button type="button" id="btnLessonStarter" class="w-full border border-blue-300 font-bold py-2 rounded text-sm mt-2">Build editable slides from lesson</button>
            <p id="presentationSourceStatus" role="status" class="text-xs text-slate-700 mt-2">Choose a saved lesson and session. Starter slides need no external service; neither option saves automatically.</p>
        </div>
    `;
  listContainer.insertAdjacentHTML("beforebegin", selectorHTML);
  document.getElementById("btnLessonStarter").addEventListener("click",()=>{
    try{
      if(window.selectedSessionIndex===null)throw Error("Select a lesson session first.");
      if(window.currentPresentationDeck?.length&&!confirm("Replace the displayed slide draft with slides from this lesson? Save or export existing edits first; saved cloud versions are unchanged."))return;
      const result=lessonStarterDeck(window.selectedPlanData,window.selectedSessionIndex);
      window.currentPresentationDeck=result.deck;window.activeSlideIndex=0;window.adminervaPresentationDirty=true;
      window.presentationSourceLessonVersion=result.source.lessonVersion;
      window.renderSlideBlocks();window.selectSlide(0);
      document.getElementById("presentationSourceStatus").textContent="Editable lesson starter created from version "+result.source.lessonVersion+". Review and save explicitly. No content was sent to an external provider.";
    }catch(error){document.getElementById("presentationSourceStatus").textContent=error.message;}
  });
}

window.fetchSavedLessonPlans = async function () {
  const select = document.getElementById("presentationPlanSelect");
  if (!window.db || !select) return;

  try {
    const querySnapshot = await getDocs(ownedCollection(window.db,"lesson_plans"));
    window.availablePlans = [];
    select.innerHTML = '<option value="">-- Choose a Lesson Plan --</option>';

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.is_archived) return; // Hide archived files

      window.availablePlans.push({ id: doc.id, ...data });

      const grade = data.grade_level || "N/A";
      const subject = data.subject_title || "Unknown Subject";
      const week = data.course_week || data.week || "Unknown Week";

      const option = document.createElement("option");
      option.value = doc.id;
      option.textContent = `${grade} - ${subject} (${week})`;
      select.appendChild(option);
    });
    const requested=new URLSearchParams(location.search).get("plan");
    if(window.availablePlans.some(plan=>plan.id===requested)){select.value=requested;window.handlePlanSelection();}
  } catch (e) {
    select.innerHTML = '<option value="">Error loading plans</option>';
  }
};

window.handlePlanSelection = function () {
  const planId = document.getElementById("presentationPlanSelect").value;
  if(window.adminervaPresentationDirty&&window.selectedPlanData?.id!==planId&&!confirm("Discard unsaved slide edits and choose another saved lesson?")){
    document.getElementById("presentationPlanSelect").value=window.selectedPlanData?.id||"";return;
  }
  sessionLoadSequence++;window.selectedSessionIndex=null;window.selectedSessionData=null;
  const sessionSelect = document.getElementById("presentationSessionSelect");
  const btnGen = document.getElementById("btnGenerateSlides");
  const btnDelete = document.getElementById("btnDeletePresentation");
  if (btnDelete) btnDelete.classList.replace("flex", "hidden");

  if (!planId) {
    sessionSelect.innerHTML = '<option value="">Awaiting lesson...</option>';
    sessionSelect.disabled = true;
    btnGen.disabled = true;
    btnGen.classList.add("opacity-50", "cursor-not-allowed");
    return;
  }

  window.selectedPlanData = window.availablePlans.find((p) => p.id === planId);
  sessionSelect.innerHTML = '<option value="">-- Choose a Session --</option>';
  sessionSelect.disabled = false;

  if (window.selectedPlanData && window.selectedPlanData.sessions) {
    window.selectedPlanData.sessions.forEach((session, idx) => {
      const option = document.createElement("option");
      option.value = idx;
      option.textContent = session.session_name || `Session ${idx + 1}`;
      sessionSelect.appendChild(option);
    });
  }
};

window.handleSessionSelection = async function () {
  const sequence=++sessionLoadSequence;
  const planId = document.getElementById("presentationPlanSelect").value;
  const sessionIdx = document.getElementById("presentationSessionSelect").value;
  const btnGen = document.getElementById("btnGenerateSlides");
  const btnDelete = document.getElementById("btnDeletePresentation");

  if (btnDelete) btnDelete.classList.add("hidden");

  if (sessionIdx !== "") {
    if (window.adminervaPresentationDirty &&
        !confirm("You have unsaved slide edits. Continue to another session without saving?")) {
      const select=document.getElementById("presentationSessionSelect");
      if(select)select.value=window.selectedSessionIndex ?? "";
      return;
    }
    window.selectedSessionIndex = sessionIdx;
    window.selectedSessionData = window.selectedPlanData.sessions[sessionIdx];
    window.presentationSourceLessonVersion=null;
    window.currentPresentationDeck=[{layout:"standard",type:"blank",label:"New session draft",content:"",hidden:false}];
    window.adminervaPresentationDirty=false;window.renderSlideBlocks?.();window.selectSlide?.(0);
    btnGen.disabled = false;
    btnGen.classList.remove("opacity-50", "cursor-not-allowed");

    if (window.db) {
      const presentationId = `${planId}_session${sessionIdx}`;
      try {
        const docSnap = await getDoc(
          ownedDoc(window.db,"presentations", presentationId),
        );
        if(sequence!==sessionLoadSequence)return;
        document.getElementById("presentationSourceStatus").textContent=lessonSourceChanged(docSnap.data(),window.selectedPlanData)?"Saved deck has older or unknown lesson provenance. Slides are not overwritten by lesson updates. Review the source before rebuilding.":"Lesson version "+Number(window.selectedPlanData.version||1)+" selected. Slides remain editable; save explicitly.";

        if (docSnap.exists() && !docSnap.data().is_archived) {
          if (btnDelete) btnDelete.classList.replace("hidden", "flex");

          if (
            confirm(
              "💾 A saved presentation was found in the cloud for this session! Would you like to load it?",
            )
          ) {
            window.loadedPersonalDeck={id:presentationId,version:Number(docSnap.data().version||1)};
            window.presentationSourceLessonVersion=docSnap.data().source_lesson_version||null;
            window.currentPresentationDeck = (docSnap.data().deck||[]).map(slide=>({
            ...slide,
            content:window.sanitizePresentationHtml?.(slide.content) ?? "",
            contentLeft:window.sanitizePresentationHtml?.(slide.contentLeft) ?? "",
            contentRight:window.sanitizePresentationHtml?.(slide.contentRight) ?? ""
          }));
            window.activeSlideIndex = 0;
            window.adminervaPresentationDirty = false;
            if (typeof window.renderSlideBlocks === "function")
              window.renderSlideBlocks();
            if (typeof window.selectSlide === "function") window.selectSlide(0);
          }
        }
      } catch (e) {}
    }
  } else {
    window.selectedSessionData = null;
    window.selectedSessionIndex = null;
    btnGen.disabled = true;
    btnGen.classList.add("opacity-50", "cursor-not-allowed");
  }
};

window.savePresentationToCloud = async function () {
  const planId = document.getElementById("presentationPlanSelect")?.value;
  const sessionIdx = window.selectedSessionIndex;

  if (!planId || sessionIdx === null || sessionIdx === undefined)
    return alert("Please select a Lesson Plan and Session first.");
  if (
    !window.currentPresentationDeck ||
    window.currentPresentationDeck.length === 0
  )
    return alert("No slides to save.");
  if (!window.db) return alert("Firebase is not connected.");

  const saveBtn = document.getElementById("btnSavePresentation");
  const originalText = saveBtn.innerHTML;
  const draftSnapshot=JSON.stringify(window.currentPresentationDeck);
  saveBtn.innerHTML = "⏳ Saving...";
  saveBtn.disabled = true;
  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader("Saving presentation to cloud...");
  }

  try {
    const presentationId = `${planId}_session${sessionIdx}`;
    const payload = {
      ownerUid:workspaceUid(),
      plan_id: planId,
      source_lesson_version: window.presentationSourceLessonVersion||null,
      session_index: sessionIdx,
      subject: window.selectedPlanData.subject_title || "Unknown",
      grade: window.selectedPlanData.grade_level || "Unknown",
      deck: window.currentPresentationDeck.map(slide=>({
        ...slide,
        content:window.sanitizePresentationHtml?.(slide.content) ?? "",
        contentLeft:window.sanitizePresentationHtml?.(slide.contentLeft) ?? "",
        contentRight:window.sanitizePresentationHtml?.(slide.contentRight) ?? ""
      })),
      updated_at: new Date().toISOString(),
      is_archived: false, // Ensure it saves as active
    };

    // Transactionally preserve the previous deck before replacing it.
    // Restoring an earlier version requires a separate deliberate Save action.
    const currentRef=ownedDoc(window.db,"presentations",presentationId);
    const action=await runTransaction(window.db,async tx=>{
      const previous=await tx.get(currentRef);
      const expected=window.loadedPersonalDeck?.id===presentationId?window.loadedPersonalDeck.version:0;
      payload.version=requireCurrentVersion(previous.exists()?previous.data():null,expected);
      assertWorkspaceAccount(payload.ownerUid);
      if(previous.exists()){
        const before=previous.data();
        if(JSON.stringify(before.deck||[])===JSON.stringify(payload.deck)&&before.source_lesson_version===payload.source_lesson_version)return "unchanged";
        tx.set(ownedDoc(window.db,"presentations",presentationId,"revisions",String(before.version)),{...before,archivedRevisionAt:serverTimestamp()});
        payload.version=Number(before.version||1)+1;
      }else payload.version=1;
      tx.set(currentRef,payload);
      return "saved";
    });

    if(action==="saved")window.loadedPersonalDeck={id:presentationId,version:payload.version};
    if(document.getElementById("presentationPlanSelect")?.value===planId&&window.selectedSessionIndex===sessionIdx&&JSON.stringify(window.currentPresentationDeck)===draftSnapshot)window.adminervaPresentationDirty=false;
    const btnDelete = document.getElementById("btnDeletePresentation");
    if (btnDelete) btnDelete.classList.replace("hidden", "flex");

    alert(action==="unchanged"?"No presentation changes since last save.":"Presentation saved with previous version retained.");
  } catch (e) {
    alert("Failed to save: " + e.message);
  } finally {
    saveBtn.innerHTML = originalText;
    saveBtn.disabled = false;
    if (typeof window.hideSubtleLoader === "function") {
      window.hideSubtleLoader();
    }
  }
};

window.deletePresentationFromCloud = async function () {
  const planId = document.getElementById("presentationPlanSelect")?.value;
  const sessionIdx = window.selectedSessionIndex;

  if (!planId || sessionIdx === null || sessionIdx === undefined) return;
  if (
    !confirm(
      "Move this presentation to the Archive? It will be permanently deleted in 14 days.",
    )
  )
    return;

  const btnDelete = document.getElementById("btnDeletePresentation");
  const originalText = btnDelete.innerHTML;
  btnDelete.innerHTML = "⏳ Archiving...";
  btnDelete.disabled = true;
  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader("Moving presentation to archive...");
  }

  try {
    const presentationId = `${planId}_session${sessionIdx}`;
    const purgeDate = new Date(
      Date.now() + 14 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await setDoc(
      ownedDoc(window.db,"presentations", presentationId),
      {
        is_archived: true,
        archived_at: new Date().toISOString(),
        purge_at: purgeDate,
      },
      { merge: true },
    );

    alert("🗑️ Presentation moved to Archive.");
    btnDelete.classList.replace("flex", "hidden");

    window.currentPresentationDeck = [];
    window.activeSlideIndex = -1;
    if (typeof window.renderSlideBlocks === "function")
      window.renderSlideBlocks();
  } catch (e) {
    alert("Failed to archive: " + e.message);
  } finally {
    btnDelete.innerHTML = originalText;
    btnDelete.disabled = false;
    if (typeof window.hideSubtleLoader === "function") {
      window.hideSubtleLoader();
    }
  }
};

// ==========================================
// 🚀 RECYCLE BIN / ARCHIVE MANAGER
// ==========================================
window.openArchiveManager = async function () {
  if (!window.db) return alert("Firebase is not connected.");

  let modal = document.getElementById("archiveModal");
  if (!modal) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `
            <div id="archiveModal" class="fixed inset-0 bg-gray-900/90 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
                <div class="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 relative flex flex-col max-h-[85vh]">
                    <button onclick="document.getElementById('archiveModal').classList.add('hidden')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500 text-xl font-bold">✖</button>
                    <h3 class="text-xl font-black text-blue-900 mb-2 flex items-center gap-2"><span>🗑️</span> Cloud Recycle Bin</h3>
                    <p class="text-sm text-gray-500 mb-4 border-b pb-4">Items here will be permanently deleted 14 days after archiving.</p>
                    
                    <div id="archiveListContainer" class="flex-1 overflow-y-auto space-y-3 pr-2">
                        <p class="text-gray-400 italic text-center py-8">Scanning for archived files...</p>
                    </div>
                </div>
            </div>
        `,
    );
    modal = document.getElementById("archiveModal");
  } else {
    modal.classList.remove("hidden");
  }

  const container = document.getElementById("archiveListContainer");
  container.innerHTML = `<div class="animate-pulse flex space-x-4"><div class="flex-1 space-y-4 py-1"><div class="h-4 bg-gray-200 rounded w-3/4"></div></div></div>`;

  try {
    const [plansSnap, presSnap] = await Promise.all([
      getDocs(ownedCollection(window.db,"lesson_plans")),
      getDocs(ownedCollection(window.db,"presentations")),
    ]);

    let archivedItems = [];

    plansSnap.forEach((doc) => {
      const d = doc.data();
      if (d.is_archived)
        archivedItems.push({
          collection: "lesson_plans",
          id: doc.id,
          title: `Lesson Plan: ${d.grade_level} - ${d.subject_title} (${d.course_week || d.week})`,
          ...d,
        });
    });

    presSnap.forEach((doc) => {
      const d = doc.data();
      if (d.is_archived)
        archivedItems.push({
          collection: "presentations",
          id: doc.id,
          title: `Presentation Slides: ${d.grade} - ${d.subject} (Session ${parseInt(d.session_index) + 1})`,
          ...d,
        });
    });

    container.innerHTML = "";
    if (archivedItems.length === 0)
      return (container.innerHTML = `<p class="text-gray-400 font-bold text-center py-8">Recycle Bin is empty.</p>`);

    archivedItems.sort(
      (a, b) =>
        new Date(b.archived_at).getTime() - new Date(a.archived_at).getTime(),
    );

    archivedItems.forEach((item) => {
      const daysLeft = Math.ceil(
        (new Date(item.purge_at).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24),
      );
      const icon = item.collection === "lesson_plans" ? "📘" : "🖥️";

      container.insertAdjacentHTML(
        "beforeend",
        `
                <div class="p-3 border rounded-lg bg-gray-50 flex justify-between items-center">
                    <div>
                        <h4 class="font-bold text-gray-800 text-sm flex items-center gap-2"><span>${icon}</span> ${item.title}</h4>
                        <p class="text-[10px] text-red-500 font-bold mt-1">Permanently deletes in ${daysLeft} days</p>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="restoreDocument('${item.collection}', '${item.id}')" class="px-3 py-1.5 bg-green-50 text-green-700 font-bold text-xs rounded border border-green-200 hover:bg-green-100 transition shadow-sm">♻️ Restore</button>
                        <button onclick="hardDeleteDocument('${item.collection}', '${item.id}')" class="px-3 py-1.5 bg-red-600 text-white font-bold text-xs rounded hover:bg-red-700 transition shadow-sm">🗑️ Eradicate</button>
                    </div>
                </div>
            `,
      );
    });
  } catch (e) {
    container.innerHTML = `<p class="text-red-500 font-bold text-center py-8">Error: ${e.message}</p>`;
  }
};

window.restoreDocument = async function (collectionName, docId) {
  if (!window.db) return;
  try {
    await setDoc(
      ownedDoc(window.db, collectionName, docId),
      { is_archived: false },
      { merge: true },
    );
    window.openArchiveManager(); // Refresh UI
    window.fetchSavedLessonPlans(); // Refresh the main dropdowns
  } catch (e) {
    alert("Failed to restore: " + e.message);
  }
};

window.hardDeleteDocument = async function (collectionName, docId) {
  if (
    !window.db ||
    !confirm(
      "WARNING: This will eradicate the file permanently. Cannot be undone. Proceed?",
    )
  )
    return;
  try {
    await deleteDoc(ownedDoc(window.db, collectionName, docId));
    window.openArchiveManager(); // Refresh UI
  } catch (e) {
    alert("Failed to delete: " + e.message);
  }
};


window.openPresentationHistory=async function(){
  const planId=document.getElementById("presentationPlanSelect")?.value;
  const session=window.selectedSessionIndex;
  if(!planId||session===null||session===undefined)return alert("Select a lesson session first.");
  const presentationId=planId+"_session"+session;
  let modal=document.getElementById("presentationVersionsModal");
  if(!modal){
    modal=document.createElement("div");
    modal.id="presentationVersionsModal";
    modal.className="fixed inset-0 z-[250] bg-slate-900/75 p-3 sm:p-8 flex items-center justify-center";
    modal.setAttribute("role","dialog");
    modal.setAttribute("aria-modal","true");
    const panel=document.createElement("div");
    panel.className="bg-white rounded-xl max-w-xl w-full max-h-[85dvh] overflow-y-auto p-5";
    const header=document.createElement("div");
    header.className="flex justify-between items-center mb-4";
    const title=document.createElement("h2");
    title.className="font-bold text-lg text-slate-900";title.textContent="Presentation versions";
    const close=document.createElement("button");
    close.textContent="Close";close.className="px-3 py-2 bg-slate-200 rounded-lg text-sm font-bold";
    close.addEventListener("click",()=>modal.classList.add("hidden"));
    header.append(title,close);
    const list=document.createElement("div");list.id="presentationVersionsList";list.className="space-y-3";
    panel.append(header,list);modal.append(panel);document.body.append(modal);
  }
  modal.classList.remove("hidden");
  const container=modal.querySelector("#presentationVersionsList");
  container.textContent="Loading saved versions…";
  try{
    const snap=await getDocs(query(ownedCollection(db,"presentations",presentationId,"revisions"),
      orderBy("archivedRevisionAt","desc"),limit(20)));
    container.replaceChildren();
    if(snap.empty)container.textContent="No earlier versions yet. Saving a changed deck will preserve the previous one.";
    snap.forEach(docSnap=>{
      const revision=docSnap.data();
      const row=document.createElement("div");
      row.className="border border-slate-200 rounded-lg px-3 py-3 flex items-center justify-between gap-3";
      const info=document.createElement("p");
      info.className="text-sm text-slate-700 break-words";
      info.textContent="Version "+String(revision.version||"legacy")+" · "+
        String(revision.updated_at||"Unknown date")+" · "+
        String(revision.deck?.length||0)+" slides";
      const restore=document.createElement("button");
      restore.className="bg-blue-600 text-white text-xs font-bold px-3 py-2 rounded-lg shrink-0";
      restore.textContent="Load draft";
      restore.addEventListener("click",()=>{
        if(!confirm("Load this earlier deck into the editor? Save afterward to keep the restoration."))return;
        window.presentationSourceLessonVersion=revision.source_lesson_version||null;
        window.currentPresentationDeck=(revision.deck||[]).map(slide=>({
          ...slide,content:window.sanitizePresentationHtml?.(slide.content)??"",
          contentLeft:window.sanitizePresentationHtml?.(slide.contentLeft)??"",
          contentRight:window.sanitizePresentationHtml?.(slide.contentRight)??""
        }));
        window.activeSlideIndex=window.currentPresentationDeck.length?0:-1;
        window.renderSlideBlocks?.();
        if(window.currentPresentationDeck.length)window.selectSlide?.(0);
        modal.classList.add("hidden");
      });
      row.append(info,restore);container.append(row);
    });
  }catch(error){
    container.textContent="Could not load version history: "+error.message;
  }
};
