import {ownedDoc,ownedCollection,lessonStorage,workspaceUid,assertWorkspaceAccount,workspaceOnReady,requireStaffWorkspace} from "./workspace-session.mjs?v=1.3.0";
import {captureLessonSettings} from "./lesson-settings.mjs?v=1.3.0";
import {resolveReferenceLibrary,assertReferenceOwner,referenceFolders,referenceFolder,normalizeReferenceFolder,cacheReferenceFolders} from "./reference-library.mjs?v=1.3.4";
/** Saved lesson records, version handling and lesson loading. */
// Import centralized database instead of initializing locally
import { auth,db } from "../core/firebase-core.js?v=1.3.0";
import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.0";
import {ADMIN_EMAIL,TEACHER_EMAIL} from "../core/staff-role.mjs?v=1.3.0";
import {legacyLessonRecovery} from "../core/legacy-lesson-recovery.mjs?v=1.3.2";
import {personalPlanId,requireCurrentVersion} from "./workspace-model.mjs?v=1.3.0";
import {scheduleScope,localScheduleText,normalizeSchoolYear,parseScheduleRows} from "./schedule-scope.mjs?v=1.3.0";
import {filterScheduleRowsForLesson,isLegacySharedScope,isLegacyScheduleRetired,scheduleRowsToText} from "./legacy-schedule-compat.mjs?v=1.4.18";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  setDoc,
  getDoc,
  runTransaction,
  serverTimestamp,
  query,
  orderBy,
  limit,
} from "../core/teaching-firestore.mjs?v=1.3.0";

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

// Resolve only the timetable rows relevant to this lesson.
window.fetchScheduleForLesson = async function (schoolYear, academicTerm, grade="", subject="") {
  const scope = scheduleScope(schoolYear, academicTerm);
  if(isLegacySharedScope(scope)&&isLegacyScheduleRetired()){
    throw Error("The 2026–2027 legacy timetable is archived. Create a timetable for the new school year before generating new lesson plans.");
  }
  const filteredText=rows=>scheduleRowsToText(filterScheduleRowsForLesson(rows,{grade,subject}));
  const local = () => {
    const rows=parseScheduleRows(lessonStorage.getItem(scope.jsonKey));
    if(rows.length)return filteredText(rows);
    return localScheduleText(lessonStorage, schoolYear, academicTerm);
  };
  // A failed cloud save must not silently replace recent edits on this device.
  if (lessonStorage.getItem(scope.pendingKey) === "1") return local();
  try {
    const email=String(auth.currentUser?.email||"").toLowerCase();
    const shared=isLegacySharedScope(scope)&&(email===ADMIN_EMAIL||email===TEACHER_EMAIL);
    let selected = shared
      ? await getDoc(doc(db,"app_config",scope.id))
      : await getDoc(ownedDoc(db,"schedules",scope.id));
    if(shared&&!selected.exists()&&scope.allowLegacy)selected=await getDoc(doc(db,"app_config","master_schedule"));
    if (selected.exists()) {
      const rows=parseScheduleRows(selected.data().json_data);
      if(rows.length)return filteredText(rows);
      const text=String(selected.data().raw_text||"");
      if(!grade&&!subject&&text)return text;
    }
    if (lessonStorage.getItem(scope.jsonKey) !== null || lessonStorage.getItem(scope.textKey) !== null) return local();
  } catch (error) {
    console.warn("Could not load semester schedule from cloud; checking device cache:", error);
  }
  return local();
};

window.initFirebase = function () {
  if (window.loadLibraryFolders) {
    window.loadLibraryFolders();
  }
};
workspaceOnReady(async()=>{
  const parameters=new URLSearchParams(location.search),legacyId=parameters.get("legacyPlan");
  if(!legacyId&&parameters.get("saved")==="1"){await window.openLoadPlanModal();return;}
  if(!legacyId)return;
  try{
    if(legacyId.includes("/")||legacyId.length>1500)throw Error("This older-lesson link has an invalid record ID. Open Saved Lesson Plans instead.");
    const uid=await requireStaffWorkspace();
    if(originalTeacherSignedIn(uid)){
      await recoverOwnLegacyLessons(uid);
      assertWorkspaceAccount(uid);
      const plans=await getDocs(ownedCollection(db,"lesson_plans"));
      assertWorkspaceAccount(uid);
      const recovered=plans.docs.find(record=>record.data().source_legacy_plan===legacyId);
      if(!recovered)throw Error("This older lesson is not yet available in your teacher workspace. Open Saved Lesson Plans and retry older-lesson recovery.");
      window.loadSpecificPlan({...recovered.data(),id:recovered.id,ownerUid:uid});
      return;
    }
    if(await resolveStaffRole(auth.currentUser)!=="admin")throw Error("This older lesson belongs to the original teacher. Open your own Saved Lesson Plans.");
    assertWorkspaceAccount(uid);
    if(!confirm("Open this older shared lesson for inspection? Saving creates your own separate copy; the shared record remains unchanged."))return;
    const snapshot=await getDoc(doc(db,"lesson_plans",legacyId));
    assertWorkspaceAccount(uid);
    if(!snapshot.exists())throw Error("The older lesson no longer exists.");
    window.loadSpecificPlan({...snapshot.data(),id:snapshot.id});
    window.loadedPersonalPlan=null;window.legacySourcePlanId=legacyId;
    alert("Older shared lesson loaded. Ownership is unverified. Inspect it before saving a separate personal copy.");
  }catch(error){alert("Could not open the legacy lesson: "+error.message);}
});

let referenceFolderLoadSerial=0;
window.loadLibraryFolders = async function () {
  const serial=++referenceFolderLoadSerial;
  const container = document.getElementById("libraryFolderContainer");
  if (!container) return;
  const selectionAtStart=window.currentLessonReferenceFolders;
  const existingCheckboxes=[...container.querySelectorAll(".folder-checkbox")];
  const selectedIds=new Set(existingCheckboxes.length?existingCheckboxes.filter(input=>input.checked).map(input=>input.value):(window.currentLessonReferenceFolders||[]));
  const refresh=document.getElementById("refreshPlannerReferencesBtn");if(refresh)refresh.disabled=true;

  container.innerHTML =
    '<div class="text-xs text-gray-500 italic">Fetching folders from cloud...</div>';

  try {
    const scope=await resolveReferenceLibrary();
    const snap = await getDocs(referenceFolders(scope));
    assertReferenceOwner(scope);if(serial!==referenceFolderLoadSerial)return;
    const libraryData = [];
    snap.forEach((d) => libraryData.push(normalizeReferenceFolder(d.id,d.data())));
    libraryData.sort((a,b)=>a.name.localeCompare(b.name));
    // A lesson may have loaded while its folders were still being fetched.
    if(window.currentLessonReferenceFolders!==selectionAtStart){selectedIds.clear();for(const id of window.currentLessonReferenceFolders||[])selectedIds.add(id);}

    cacheReferenceFolders(scope,libraryData);
    const scopeLabel=document.getElementById("plannerLibraryScope");if(scopeLabel)scopeLabel.textContent=scope.label+" · "+scope.email;

    container.innerHTML = "";
    if (libraryData.length === 0) {
      window.currentLessonReferenceFolders=[];
      container.innerHTML =
        '<div class="text-xs text-gray-500 italic">No reference folders in this account yet. Open Reference Library to add documents, or refresh after older references are restored.</div>';
      return;
    }

    libraryData.forEach((folder) => {
      const docCount=(folder.documents?.length||0)+(folder.documentCount||0);
      const safeId = escapeHTML(folder.id);
      const safeName = escapeHTML(folder.name);

      container.insertAdjacentHTML(
        "beforeend",
        `
                <label class="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" value="${safeId}" ${selectedIds.has(folder.id)?"checked":""} class="folder-checkbox w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 bg-white">
                    <span class="text-sm font-bold text-blue-900 group-hover:text-blue-700 transition">📁 ${safeName} <span class="text-[10px] text-gray-500 font-normal">(${docCount} docs)</span></span>
                </label>
            `,
      );
    });
    const saveSelections=()=>{window.currentLessonReferenceFolders=[...container.querySelectorAll(".folder-checkbox:checked")].map(input=>input.value);};
    container.onchange=saveSelections;
    saveSelections();
  } catch (e) {
    if(serial!==referenceFolderLoadSerial)return;
    container.innerHTML = `<div class="text-xs text-red-500 italic">Failed to load library: ${escapeHTML(e.message)}</div>`;
  }finally{
    if(serial===referenceFolderLoadSerial&&refresh)refresh.disabled=false;
  }
};

// Read only the teacher-selected reference folders. Existing documents remain
// in their legacy arrays; new PDFs are stored in child documents.
window.fetchReferenceDocuments=async function(folderId){
  const scope=await resolveReferenceLibrary();
  const root=await getDoc(referenceFolder(scope,folderId));
  assertReferenceOwner(scope);
  if(!root.exists())throw Error("Selected reference folder no longer exists.");
  const legacy=Array.isArray(root.data().documents)?root.data().documents:[];
  const nested=await getDocs(referenceFolders(scope,folderId,"documents"));
  assertReferenceOwner(scope);
  return [...legacy,...nested.docs.map(record=>record.data())];
};

window.fetchPreviousPlan = async function (
  grade,
  subject,
  academicTerm,
  currentCourseWeek,
  schoolYear,
) {
  if (!db) return null;

  const currentWeekNum = parseInt(currentCourseWeek.replace(/\D/g, ""));
  if (currentWeekNum <= 1) return null;

  const prevWeekStr = `Week ${currentWeekNum - 1}`;
  // New school-year key first, then a compatible legacy key.
  const options={grade,subject,term:academicTerm,week:prevWeekStr,schoolYear};
  for(const id of [personalPlanId(options)]){
    try{
      const result=await getDoc(ownedDoc(db,"lesson_plans",id));
      if(result.exists()&&result.data().school_year===schoolYear)return result.data();
    }catch(error){console.warn("Previous lesson lookup failed:",error);}
  }
  return null;
};

window.saveLessonPlan = async function () {
  let ownerUid;
  try{ownerUid=await requireStaffWorkspace();}catch(error){alert(error.message);return false;}
  if (typeof window.syncOutputToData === "function") {
    window.syncOutputToData();
  }

  if (
    !window.currentPlan ||
    window.currentPlan.length === 0 ||
    !window.currentWeeklyOverview
  ) {
    alert("Please generate a lesson plan first before saving.");
    return false;
  }
  if (!db) {
    alert("Firebase is not connected! Please configure it in Global Settings.");
    return false;
  }

  // A loaded lesson keeps its original identity even if global defaults
  // were changed for a different subject or a new semester.
  const subject = window.currentPlanSubject ||
    lessonStorage.getItem("Adminerva_defaultSubject") || "Subject";
  const teacher = window.currentPlanTeacher ||
    lessonStorage.getItem("Adminerva_defaultTeacher") || "Unassigned";
  const grade = window.currentTargetGrade || "Grade";

  const academicTerm = document.getElementById("lpAcademicTerm").value;
  const courseWeek = document.getElementById("lpCourseWeek").value;
  const dateRange = document.getElementById("lpDateRange").value;

  let schoolYear, safeDocId;
  try {
    schoolYear = normalizeSchoolYear(document.getElementById("lpSchoolYear").value);
    safeDocId = personalPlanId({
      grade, subject, term: academicTerm, week: courseWeek, schoolYear
    });
    if(window.loadedPersonalPlan?.id&&window.loadedPersonalIdentity===JSON.stringify([schoolYear,grade,subject,academicTerm,courseWeek]))safeDocId=window.loadedPersonalPlan.id;
  } catch (error) {
    alert("Cannot save lesson plan: " + error.message);
    return false;
  }

  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader("Syncing lesson plan securely to Firebase...");
  }

  try {
    const planData = {
      ownerUid,
      ...(window.legacySourcePlanId ? {source_legacy_plan:window.legacySourcePlanId} : {}),
      teacher_name: teacher,
      program_name:document.getElementById("lpProgram")?.value.trim()||"",
      subject_title: subject,
      school_year: document.getElementById("lpSchoolYear").value,
      academic_term: academicTerm,
      course_week: courseWeek,
      date_range: dateRange,
      grade_level: grade,
      document_settings:captureLessonSettings(lessonStorage,{...window.currentLessonSettings,subject_title:subject,teacher_name:teacher}),
      custom_instructions: document
        .getElementById("lpCustomInstructions")
        .value.trim(),
      schedule: await window.fetchScheduleForLesson(schoolYear, academicTerm, grade, subject),
      reference_folders: Array.from(
        document.querySelectorAll(".folder-checkbox:checked"),
      ).map((cb) => cb.value),
      weekly_overview: window.currentWeeklyOverview,
      sessions: window.currentPlan,
      timestamp: new Date().toISOString(), // This is the key we use to find recent plans
    };

    const currentRef=ownedDoc(db,"lesson_plans",safeDocId);
    const action=await runTransaction(db,async tx=>{
      const prior=await tx.get(currentRef);
      const existing=prior.exists()?prior.data():null;
      assertWorkspaceAccount(ownerUid);
      const expected=window.loadedPersonalPlan?.id===safeDocId ? window.loadedPersonalPlan.version : 0;
      const version=requireCurrentVersion(existing,expected);
      if(existing){
        const same=Object.entries(planData).every(([key,value])=>
          key==="timestamp" || JSON.stringify(value)===JSON.stringify(existing[key])
        );
        if(same)return "unchanged";
        tx.set(ownedDoc(db,"lesson_plans",safeDocId,"revisions",String(existing.version)),{...existing,archivedRevisionAt:serverTimestamp()});
      }
      tx.set(currentRef,{...planData,...(existing?.recovery_provenance?{recovery_provenance:existing.recovery_provenance}:{}),...(existing?.source_legacy_plan?{source_legacy_plan:existing.source_legacy_plan}:{}),version});
      window.pendingPersonalPlanVersion=version;
      return "saved";
    });
    if(action==="saved"){
      window.loadedPersonalPlan={id:safeDocId,version:window.pendingPersonalPlanVersion};
      window.currentLessonSettings=planData.document_settings;
    }
    alert(action==="unchanged"?"No changes since the last save.":"Lesson plan saved. The previous version is retained.");
    document.dispatchEvent(new CustomEvent("adminerva:lesson-saved",{detail:{id:safeDocId,action}}));
    return true;
  } catch (e) {
    console.error("Error saving plan:", e);
    alert("Failed to save to database: " + e.message);
    return false;
  } finally {
    if (typeof window.hideSubtleLoader === "function")
      window.hideSubtleLoader();
  }
};

let savedPlanSerial=0,ownersLoadedFor=null;
let ownRecoveryAttemptedFor=null,ownRecoveryPromise=null;
const ALL_SCHOOL_YEARS="__all__",UNKNOWN_SCHOOL_YEAR="School year not recorded";
const originalTeacherSignedIn=uid=>auth.currentUser?.uid===uid&&auth.currentUser.emailVerified===true&&auth.currentUser.email?.toLowerCase()===TEACHER_EMAIL;
const recoveryCount=value=>Array.isArray(value)?value.length:Number(value)||0;
async function recoverOwnLegacyLessons(uid,{retry=false}={}){
  if(!originalTeacherSignedIn(uid))return;
  const panel=document.getElementById("teacherLessonRecoveryPanel"),status=document.getElementById("teacherLessonRecoveryStatus"),button=document.getElementById("teacherLessonRecoveryBtn");
  if(panel)panel.hidden=false;
  if(ownRecoveryPromise)return ownRecoveryPromise;
  if(ownRecoveryAttemptedFor===uid&&!retry)return;
  ownRecoveryAttemptedFor=uid;
  if(status){status.dataset.tone="";status.textContent="Checking older lessons…";status.removeAttribute("title");}
  if(button){button.disabled=true;button.setAttribute("aria-busy","true");}
  ownRecoveryPromise=(async()=>{
    try{
      const result=await legacyLessonRecovery({action:"recover-own"});
      assertWorkspaceAccount(uid);
      if(result.ownerUid!==uid)throw Error("Recovery returned a different workspace. Reload your teacher account before continuing.");
      const recovered=recoveryCount(result.recovered),already=recoveryCount(result.alreadyRecovered),blocked=recoveryCount(result.blocked);
      if(status){
        status.dataset.tone="success";
        status.textContent=recovered
          ?recovered+" older lesson"+(recovered===1?"":"s")+" recovered"+(already?" · "+already+" already available":"")
          :(already?already+" saved "+(already===1?"copy is":"copies are")+" already in this workspace":"No older lessons found");
        if(blocked)status.textContent+=" · "+blocked+" need review";
        if(result.hasMore)status.textContent+=" · more available";
        status.title=String(result.message||"");
      }
      if(button)button.textContent=result.hasMore?"Recover more":"Check again";
    }catch(error){
      if(auth.currentUser?.uid===uid&&status){status.dataset.tone="error";status.textContent="Older lessons could not be checked. Your saved plans are unchanged.";status.title=error.message;}
      if(button)button.textContent="Retry";
    }finally{
      ownRecoveryPromise=null;
      if(auth.currentUser?.uid===uid&&button){button.disabled=false;button.removeAttribute("aria-busy");}
    }
  })();
  return ownRecoveryPromise;
}
window.recoverMyOlderLessonPlans=async()=>{
  try{
    const uid=await requireStaffWorkspace();if(!originalTeacherSignedIn(uid))throw Error("Sign in with the original verified teacher account to recover its lessons.");
    await recoverOwnLegacyLessons(uid,{retry:true});
    assertWorkspaceAccount(uid);
    await window.openLoadPlanModal();
  }catch(error){alert(error.message);}
};
async function preparePlanOwners(viewerUid){
  const role=await resolveStaffRole(auth.currentUser),select=document.getElementById("modalOwnerFilter"),control=document.getElementById("modalOwnerControl");
  assertWorkspaceAccount(viewerUid);
  control.hidden=role!=="admin";
  document.getElementById("savedPlanRecoveryLink").classList.toggle("hidden",role!=="admin");
  const identity=document.getElementById("savedPlanIdentity");
  if(identity)identity.textContent="Signed in as "+auth.currentUser.email+" · "+(role==="admin"?"Administrator":"Teacher");
  const recoveryPanel=document.getElementById("teacherLessonRecoveryPanel");
  if(recoveryPanel)recoveryPanel.hidden=!originalTeacherSignedIn(viewerUid);
  if(role!=="admin")return viewerUid;
  if(ownersLoadedFor!==viewerUid){
    select.replaceChildren(new Option("My administrator workspace · "+auth.currentUser.email,viewerUid));
    let profiles={docs:[]};try{profiles=await getDocs(collection(db,"teachers"));}catch{/* Own saved plans remain available when the optional teacher directory cannot load. */}
    assertWorkspaceAccount(viewerUid);
    const known=new Set([viewerUid]);
    for(const record of profiles.docs){const profile=record.data();if(typeof profile.uid!=="string"||!profile.uid||known.has(profile.uid))continue;known.add(profile.uid);select.add(new Option((profile.name||profile.displayName||profile.email||"Teacher")+" · "+(profile.email||""),profile.uid));}
    ownersLoadedFor=viewerUid;
    legacyLessonRecovery({action:"preview"}).then(result=>{if(auth.currentUser?.uid===viewerUid&&!known.has(result.ownerUid)){known.add(result.ownerUid);select.add(new Option("Original teacher · "+result.ownerEmail,result.ownerUid));}}).catch(()=>{});
  }
  return select.value||viewerUid;
}
window.changeLessonPlanOwner=()=>{const filter=document.getElementById("modalSyFilter");filter.replaceChildren(new Option("All school years",ALL_SCHOOL_YEARS));window.openLoadPlanModal();};
window.openLoadPlanModal = async function () {
  const serial=++savedPlanSerial;
  const modal = document.getElementById("loadPlanModal");
  if (!modal) return alert("Modal HTML is missing!");
  modal.classList.replace("hidden", "flex");
  const end=window.beginLoading?.("Loading saved lesson plans…",modal)||(()=>{});

  const container = document.getElementById("savedPlansListContainer");
  const summary=document.getElementById("savedPlanSummary");if(summary)summary.textContent="";
  container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12">
            <div class="animate-spin rounded-full h-10 w-10 border-t-4 border-b-4 border-blue-500 mb-4"></div>
            <p class="text-gray-500 font-medium">Fetching organized curriculum...</p>
        </div>
    `;

  if (!db) {
    container.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded-lg text-center font-bold">Firebase is not connected!</div>`;
    end();return;
  }

  try {
    const viewerUid=await requireStaffWorkspace(),ownerUid=await preparePlanOwners(viewerUid),foreign=ownerUid!==viewerUid;
    if(originalTeacherSignedIn(viewerUid))await recoverOwnLegacyLessons(viewerUid);
    assertWorkspaceAccount(viewerUid);if(serial!==savedPlanSerial)return;
    const querySnapshot = await getDocs(collection(db,"staff_workspaces",ownerUid,"lesson_plans"));
    assertWorkspaceAccount(viewerUid);if(serial!==savedPlanSerial)return;
    const ownerLabel=document.getElementById("modalOwnerFilter")?.selectedOptions[0]?.textContent||"My workspace";
    document.getElementById("savedPlanScope").textContent=foreign?"Viewing "+ownerLabel+" · loads create a copy in your workspace.":"Personal workspace · recovered plans are labeled.";
    if(document.getElementById("lessonArchiveBtn"))document.getElementById("lessonArchiveBtn").hidden=foreign;
    if (querySnapshot.empty) {
      const filter=document.getElementById("modalSyFilter");filter.replaceChildren(new Option("All school years",ALL_SCHOOL_YEARS));filter.disabled=true;
      const hint=originalTeacherSignedIn(viewerUid)?"Use the older-lesson recovery status above and Retry if needed. Recovered lessons appear in this teacher account; originals remain in the school archive.":foreign?"This teacher has no saved personal lesson plans yet.":"Plans appear here after Save Draft. An administrator’s workspace and each teacher’s workspace have separate saved lessons.";
      container.innerHTML = `<div class="text-center py-12"><p class="text-gray-500 font-bold">No saved lesson plans in this workspace yet.</p><p class="text-sm text-slate-600 mt-2">${escapeHTML(hint)}</p></div>`;
      return;
    }

    const allFetchedPlans = [];
    const uniqueSYs = new Set();
    let archivedCount=0;

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.is_archived) {archivedCount++;return;}

      const sy = typeof data.school_year==="string"&&data.school_year.trim()?data.school_year.trim():UNKNOWN_SCHOOL_YEAR;
      uniqueSYs.add(sy);

      let safeTerm = String(data.academic_term || "");
      if (!safeTerm) {
        const sem = /2|second/i.test(data.semester || "")
          ? "SECOND SEMESTER"
          : "FIRST SEMESTER";
        let qtr = "FIRST QUARTER";
        if (/2|second/i.test(data.quarter || "")) qtr = "SECOND QUARTER";
        if (/3|third/i.test(data.quarter || "")) qtr = "THIRD QUARTER";
        if (/4|fourth/i.test(data.quarter || "")) qtr = "FOURTH QUARTER";
        safeTerm = `${sem}/${qtr}`;
      }

      let safeWeek = String(data.course_week || "");
      if (!safeWeek) safeWeek = `Week ${data.absoluteWeek || 1}`;

      allFetchedPlans.push({
        ...data,
        id: docSnap.id,
        ownerUid,
        safeSY: sy,
        safeTerm: safeTerm,
        safeWeek: safeWeek,
        safeDate: String(data.date_range || "No physical dates"),
        subjectGrade: `${data.subject_title || "Subject"} — ${data.grade_level || "Grade"}`,
      });
    });

    const syFilter = document.getElementById("modalSyFilter");
    if (syFilter) {
      syFilter.disabled=uniqueSYs.size===0;
      const currentSelection = syFilter.value || ALL_SCHOOL_YEARS;
      syFilter.replaceChildren(new Option("All school years",ALL_SCHOOL_YEARS));
      Array.from(uniqueSYs)
        .sort()
        .reverse()
        .forEach((sy) => {
          const selected = sy === currentSelection ? "selected" : "";
          const safeSy = escapeHTML(sy);
          syFilter.insertAdjacentHTML(
            "beforeend",
            `<option value="${safeSy}" ${selected}>${sy===UNKNOWN_SCHOOL_YEAR?safeSy:"SY: "+safeSy}</option>`,
          );
        });
      if(!uniqueSYs.size)syFilter.replaceChildren(new Option("All plans are archived",ALL_SCHOOL_YEARS));
    }

    const activeSY = syFilter ? syFilter.value : ALL_SCHOOL_YEARS;
    const allPlans = allFetchedPlans.filter((p) => activeSY===ALL_SCHOOL_YEARS||p.safeSY === activeSY);
    container.innerHTML = "";
    if(summary){const recovered=allPlans.filter(plan=>plan.source_legacy_plan||plan.recovery_provenance).length;summary.textContent=allPlans.length+" saved lesson"+(allPlans.length===1?"":"s")+" shown"+(recovered?" · "+recovered+" recovered from the older school archive":"")+" · "+(activeSY===ALL_SCHOOL_YEARS?"All school years":activeSY)+(archivedCount?" · "+archivedCount+" archived"+(foreign?"":" in Recycle Bin"):"");}

    if (allPlans.length === 0) {
      container.innerHTML = `<div class="text-center py-12"><p class="text-gray-500 font-bold">${allFetchedPlans.length?"No saved plans found for "+escapeHTML(activeSY)+".":"All saved plans in this workspace are archived. Open Recycle Bin to restore them."}</p></div>`;
      return;
    }

    // 🚀 NEW: Find the absolute most recently saved plan based on timestamp
    let latestPlan = allPlans[0];
    allPlans.forEach((p) => {
      const currentTs = p.timestamp ? new Date(p.timestamp).getTime() : 0;
      const latestTs = latestPlan.timestamp
        ? new Date(latestPlan.timestamp).getTime()
        : 0;
      if (currentTs > latestTs) {
        latestPlan = p;
      }
    });
    const termKey=plan=>plan.safeSY+" · "+plan.safeTerm;
    const latestTerm = latestPlan ? termKey(latestPlan) : null;
    const latestSubject = latestPlan ? latestPlan.subjectGrade : null;

    const groupedPlans = Object.create(null);
    allPlans.forEach((plan) => {
      const term = termKey(plan);
      const subjectGrade = plan.subjectGrade;
      if (!groupedPlans[term]) groupedPlans[term] = Object.create(null);
      if (!groupedPlans[term][subjectGrade])
        groupedPlans[term][subjectGrade] = [];
      groupedPlans[term][subjectGrade].push(plan);
    });

    Object.keys(groupedPlans)
      .sort()
      .forEach((term) => {
        // 🚀 ONLY OPEN the main term accordion if it holds the most recent plan
        const isTermOpen = term === latestTerm ? "open" : "";
        let subjectAccordionsHTML = "";

        Object.keys(groupedPlans[term])
          .sort()
          .forEach((subjectGrade) => {
            const plans = groupedPlans[term][subjectGrade];
            plans.sort((a, b) => {
              const weekA = parseInt((a.safeWeek || "0").replace(/\D/g, ""));
              const weekB = parseInt((b.safeWeek || "0").replace(/\D/g, ""));
              return weekA - weekB;
            });

            let rowsHTML = "";
            plans.forEach((data) => {
              let shortDate = data.safeDate;
              const monthMap = {
                January: "Jan",
                February: "Feb",
                March: "Mar",
                April: "Apr",
                August: "Aug",
                September: "Sep",
                October: "Oct",
                November: "Nov",
                December: "Dec",
              };
              Object.keys(monthMap).forEach((longMonth) => {
                shortDate = shortDate.replace(
                  new RegExp(longMonth, "gi"),
                  monthMap[longMonth],
                );
              });

              const safeWeekStr = escapeHTML(data.safeWeek);
              const safeDateStr = escapeHTML(shortDate);
              const safeId = escapeHTML(data.id);
              const safeDataObjStr = escapeHTML(JSON.stringify(data));

              // 🚀 UX BONUS: Highlight the exact row of the most recent plan slightly yellow
              const isLatestRow =
                data.id === latestPlan.id
                  ? "bg-amber-50/50 border-l-4 border-amber-400 hover:bg-amber-100"
                  : "hover:bg-blue-50";

              rowsHTML += `
                        <tr class="border-b border-gray-100 ${isLatestRow} transition">
                            <td class="px-4 py-3 font-bold text-blue-900 w-1/4">${safeWeekStr}${data.source_legacy_plan||data.recovery_provenance?'<span class="block mt-1 text-[10px] font-semibold text-emerald-700">Recovered · older school archive</span>':""}</td>
                            <td class="px-4 py-3 text-xs text-gray-600 font-medium">🗓️ ${safeDateStr}</td>
                            <td class="px-4 py-3 text-right">
                                <div class="flex justify-end gap-2">
                                    <button onclick='loadSpecificPlan(${safeDataObjStr})' class="px-3 py-1.5 bg-blue-600 text-white font-bold text-[10px] rounded hover:bg-blue-700 shadow-sm transition">${foreign?"Load personal draft":"Load"}</button>
                                    ${foreign?"":`<a href="presentation.html?plan=${escapeHTML(encodeURIComponent(data.id))}" class="px-3 py-1.5 border border-indigo-300 text-indigo-800 font-bold text-[10px] rounded">Open in Slide Editor</a>`}
                                    <button data-plan-history="${safeId}" class="px-2 py-1.5 bg-slate-100 text-slate-700 font-bold text-[10px] rounded hover:bg-slate-200" title="Previous saved versions">History</button>
                                     ${foreign?"":`<button data-plan-archive="${safeId}" class="px-2 py-1.5 bg-red-50 text-red-600 font-bold text-[10px] rounded hover:bg-red-100 transition" title="Archive this plan">✖</button>`}
                                </div>
                            </td>
                        </tr>
                    `;
            });

            // 🚀 ONLY OPEN the sub-accordion if it holds the most recent plan
            const isSubjectOpen =
              term === latestTerm && subjectGrade === latestSubject
                ? "open"
                : "";

            subjectAccordionsHTML += `
                    <details class="group/sub border border-gray-200 rounded-md mb-3 overflow-hidden shadow-sm" ${isSubjectOpen}>
                        <summary class="flex justify-between items-center bg-gray-50 p-3 cursor-pointer select-none hover:bg-gray-100 transition">
                            <span class="font-bold text-sm text-gray-800">📘 ${escapeHTML(subjectGrade)}</span>
                            <span class="text-gray-400 group-open/sub:rotate-180 transition-transform">▼</span>
                        </summary>
                        <div class="bg-white"><table class="w-full text-left"><tbody>${rowsHTML}</tbody></table></div>
                    </details>
                `;
          });

        container.insertAdjacentHTML(
          "beforeend",
          `
                <details class="group/main mb-4 bg-white border border-blue-200 rounded-lg shadow-sm" ${isTermOpen}>
                    <summary class="flex justify-between items-center font-extrabold text-blue-900 uppercase tracking-widest cursor-pointer select-none p-4 bg-blue-50 hover:bg-blue-100 transition rounded-t-lg border-b border-blue-100">
                        <div class="flex items-center gap-2"><span class="text-lg">📁</span><span>${escapeHTML(term)}</span></div>
                        <span class="text-blue-500 group-open/main:rotate-180 transition-transform">▼</span>
                    </summary>
                    <div class="p-4 bg-white rounded-b-lg">${subjectAccordionsHTML}</div>
                </details>
            `,
        );
      });
    for(const button of container.querySelectorAll("[data-plan-history]"))button.addEventListener("click",()=>window.openLessonHistory(button.dataset.planHistory,ownerUid));
    for(const button of container.querySelectorAll("[data-plan-archive]"))button.addEventListener("click",()=>window.deleteLessonPlan(button.dataset.planArchive));
  } catch (e) {
    if(serial!==savedPlanSerial)return;
    container.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded-lg border border-red-200">Error: ${escapeHTML(e.message)}</div>`;
  }finally{end();}
};

// Earlier school records remain immutable; loading history only edits the
// current local draft. Teachers must explicitly Save to restore it in Firestore.
window.openLessonHistory=async function(planId,ownerUid=workspaceUid()){
  let modal=document.getElementById("lessonHistoryModal");
  if(!modal){
    modal=document.createElement("div");
    modal.id="lessonHistoryModal";
    modal.className="fixed inset-0 z-[260] bg-slate-950/80 p-3 flex items-center justify-center";
    modal.setAttribute("role","dialog");modal.setAttribute("aria-modal","true");
    const panel=document.createElement("div");
    panel.className="bg-white rounded-xl max-w-lg w-full p-5 max-h-[85dvh] overflow-y-auto";
    const header=document.createElement("div");
    header.className="flex justify-between items-center mb-4";
    const title=document.createElement("h2");
    title.textContent="Lesson plan versions";title.className="font-bold text-slate-900 text-lg";
    const close=document.createElement("button");
    close.textContent="Close";close.className="px-3 py-2 rounded bg-slate-200 text-slate-900";
    close.addEventListener("click",()=>modal.classList.add("hidden"));
    header.append(title,close);
    const list=document.createElement("div");list.id="lessonHistoryList";list.className="space-y-2";
    panel.append(header,list);modal.append(panel);document.body.append(modal);
  }
  modal.classList.remove("hidden");
  const list=modal.querySelector("#lessonHistoryList");
  list.textContent="Loading previous versions…";
  const end=window.beginLoading?.("Loading lesson version history…",modal)||(()=>{});
  try{
    const viewerUid=await requireStaffWorkspace();
    if(ownerUid!==viewerUid&&await resolveStaffRole(auth.currentUser)!=="admin")throw Error("Administrator access is required to inspect another teacher’s lesson history.");
    const records=await getDocs(query(collection(db,"staff_workspaces",ownerUid,"lesson_plans",planId,"revisions"),
      orderBy("archivedRevisionAt","desc"),limit(15)));
    assertWorkspaceAccount(viewerUid);
    list.replaceChildren();
    if(records.empty)list.textContent="No prior versions have been saved for this plan.";
    records.forEach(record=>{
      const original=record.data();
      const row=document.createElement("div");
      row.className="p-3 rounded-lg border flex gap-2 items-center justify-between";
      const label=document.createElement("span");
      label.className="text-sm text-slate-800";
      label.textContent="Version "+String(original.version||"legacy")+" · "+String(original.timestamp||"Unknown time");
      const restore=document.createElement("button");
      restore.className="bg-blue-600 text-white px-3 py-2 font-semibold rounded-lg text-xs";
      restore.textContent="Load draft";
      restore.addEventListener("click",async()=>{
        if(!confirm("Load this earlier lesson into the editor? Save explicitly to restore it."))return;
        const endRestore=window.beginLoading?.("Restoring historical lesson draft…",modal)||(()=>{});
        restore.disabled=true;
        try{
          const current=await getDoc(doc(db,"staff_workspaces",ownerUid,"lesson_plans",planId));assertWorkspaceAccount(viewerUid);
          if(!current.exists())return alert("The current plan no longer exists. Reload the saved-plan list.");
          window.loadSpecificPlan?.({...original,id:planId,ownerUid});
          if(ownerUid===viewerUid)window.loadedPersonalPlan={id:planId,version:Number(current.data().version||1)};
          modal.classList.add("hidden");
        }catch(error){alert("Lesson history could not load: "+error.message+". Your open draft is unchanged.");}finally{endRestore();restore.disabled=false;}
      });
      row.append(label,restore);list.append(row);
    });
  }catch(error){list.textContent="Could not retrieve lesson history: "+error.message;}finally{end();}
};

window.deleteLessonPlan = async function (docId) {
  if (
    !confirm(
      "Move this lesson plan to the Archive? It stays recoverable until manually deleted.",
    )
  )
    return;

  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader("Archiving lesson plan to the Recycle Bin...");
  }

  try {
    const purgeDate = new Date(
      Date.now() + 14 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await setDoc(
      ownedDoc(db,"lesson_plans", docId),
      {
        is_archived: true,
        archived_at: new Date().toISOString(),
        purge_at: purgeDate,
      },
      { merge: true },
    );

    window.openLoadPlanModal();
  } catch (e) {
    alert("Failed to archive plan: " + e.message);
  } finally {
    if (typeof window.hideSubtleLoader === "function")
      window.hideSubtleLoader();
  }
};

// ==========================================
// ARCHIVE MANAGER
// ==========================================
window.openArchiveManager = async function () {
  if (!db) return alert("Firebase is not connected.");

  let modal = document.getElementById("archiveModal");
  if (!modal) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `
            <div id="archiveModal" class="fixed inset-0 bg-gray-900/90 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
                <div class="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 relative flex flex-col max-h-[85vh]">
                    <button onclick="document.getElementById('archiveModal').classList.add('hidden')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500 text-xl font-bold">✖</button>
                    <h3 class="text-xl font-black text-blue-900 mb-2 flex items-center gap-2"><span>🗑️</span> Cloud Recycle Bin</h3>
                    <p class="text-sm text-gray-500 mb-4 border-b pb-4">Archived files remain recoverable until permanently deleted by a teacher.</p>
                    
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
    const { collection, getDocs } =
      await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    const [plansSnap, presSnap] = await Promise.all([
      getDocs(ownedCollection(db,"lesson_plans")),
      getDocs(ownedCollection(db,"presentations")),
    ]);

    let archivedItems = [];
    const now = Date.now();

    plansSnap.forEach((doc) => {
      const d = doc.data();
      if (d.is_archived)
        archivedItems.push({
          collection: "lesson_plans",
          id: doc.id,
          title: `Lesson Plan: ${d.grade_level} - ${d.subject_title}`,
          ...d,
        });
    });

    presSnap.forEach((doc) => {
      const d = doc.data();
      if (d.is_archived)
        archivedItems.push({
          collection: "presentations",
          id: doc.id,
          title: `Presentation Slides: ${d.grade} - ${d.subject}`,
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
      const daysLeft = Math.max(
        0,
        Math.ceil(
          (new Date(item.purge_at).getTime() - now) / (1000 * 60 * 60 * 24),
        ),
      );
      const icon = item.collection === "lesson_plans" ? "📘" : "🖥️";

      const safeTitle = escapeHTML(item.title);
      const safeCollection = escapeHTML(item.collection);
      const safeId = escapeHTML(item.id);

      container.insertAdjacentHTML(
        "beforeend",
        `
                <div class="p-3 border rounded-lg bg-gray-50 flex justify-between items-center">
                    <div>
                        <h4 class="font-bold text-gray-800 text-sm flex items-center gap-2"><span>${icon}</span> ${safeTitle}</h4>
                        <p class="text-[10px] ${daysLeft <= 3 ? "text-red-600" : "text-amber-600"} font-bold mt-1">Permanently deletes in ${daysLeft} days</p>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="restoreDocument('${safeCollection}', '${safeId}')" class="px-3 py-1.5 bg-green-50 text-green-700 font-bold text-xs rounded border border-green-200 hover:bg-green-100 transition shadow-sm">♻️ Restore</button>
                        <button onclick="hardDeleteDocument('${safeCollection}', '${safeId}')" class="px-3 py-1.5 bg-red-600 text-white font-bold text-xs rounded hover:bg-red-700 transition shadow-sm">🗑️ Eradicate</button>
                    </div>
                </div>
            `,
      );
    });
  } catch (e) {
    container.innerHTML = `<p class="text-red-500 font-bold text-center py-8">Error: ${escapeHTML(e.message)}</p>`;
  }
};

window.restoreDocument = async function (collectionName, docId) {
  if (!db) return;
  try {
    const { doc, setDoc } =
      await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    await setDoc(
      ownedDoc(db, collectionName, docId),
      { is_archived: false },
      { merge: true },
    );

    window.openArchiveManager();
    if (typeof window.openLoadPlanModal === "function")
      window.openLoadPlanModal();
  } catch (e) {
    alert("Failed to restore: " + e.message);
  }
};

window.hardDeleteDocument = async function (collectionName, docId) {
  if (
    !db ||
    !confirm(
      "WARNING: This will eradicate the file permanently. Cannot be undone. Proceed?",
    )
  )
    return;
  try {
    const { doc, deleteDoc } =
      await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    await deleteDoc(ownedDoc(db, collectionName, docId));

    window.openArchiveManager();
    if (typeof window.openLoadPlanModal === "function")
      window.openLoadPlanModal();
  } catch (e) {
    alert("Failed to delete: " + e.message);
  }
};

// Automatic deletion is disabled: opening a planner must never purge school records.
