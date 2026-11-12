/**
 * Adminerva 4: school-specific dashboard and a separate legacy-admin bridge.
 * Verified membership, never a browser role label, gates canonical school data.
 */
import {app,auth,db} from "./firebase-core.js?v=1.3.0";
import {collection,getDocs} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {resolveAccountAccess} from "./staff-session.mjs?v=4.0.1";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs?v=4.0.0";

const get=id=>document.getElementById(id);
const status=get("adminOverviewStatus");
const legacy=get("adminLegacyActions");
const schoolActions=get("adminSchoolActions");
const metrics=get("adminMetricPanel");
const enrollmentMetric=get("adminEnrollmentMetric");
const invitationMetric=get("adminInvitationMetric");
const peopleApi=httpsCallable(getFunctions(app,"asia-southeast1"),"peopleDirectory");
const supportApi=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolSupport");
const set=(id,value)=>{const node=get(id);if(node)node.textContent=String(value);};
const show=(node,visible)=>{
  if(!node)return;
  node.hidden=!visible;
  node.classList.toggle("hidden",!visible);
};
let refreshEpoch=0;

function showPanels(mode){
  show(metrics,mode!=="none");
  show(legacy,mode==="legacy");
  show(schoolActions,mode==="school");
  show(enrollmentMetric,mode==="school");
  show(invitationMetric,mode==="school");
}
function clearCounts(){
  for(const id of ["adminStudentCount","adminTeacherCount","adminReportCount",
                   "adminEnrollmentCount","adminInvitationCount"])set(id,"—");
}
function safeCount(value){
  const count=Number(value);
  return Number.isSafeInteger(count)&&count>=0?count.toLocaleString():"—";
}
function configureSchoolLabels(){
  set("adminMetricOneLabel","School people");
  set("adminMetricTwoLabel","Teaching assignments");
  set("adminMetricThreeLabel","Open school reports");
  for(const [id,href,label] of [
    ["adminMetricOneLink","people-access.html#people","Review school people"],
    ["adminMetricTwoLink","people-access.html#classes","Manage classes"],
    ["adminMetricThreeLink","school-support.html","Triage school reports"]
  ]){
    const node=get(id);
    if(node){node.href=href;node.textContent=label;}
  }
}
async function loadLegacy(){
  // Only the recognized legacy administrator reaches this compatibility view.
  showPanels("legacy");
  clearCounts();
  status.textContent="Loading MCS legacy administration summary…";
  try{
    const [students,teachers,reports]=await Promise.all([
      getDocs(collection(db,"students")),
      getDocs(collection(db,"staff_access")),
      getDocs(collection(db,"issues"))
    ]);
    set("adminStudentCount",students.docs.filter(r=>
      !["suspended","archived"].includes(String(r.data().status||"active"))).length);
    set("adminTeacherCount",teachers.docs.filter(r=>
      r.data().role==="teacher"&&r.data().status==="active").length);
    set("adminReportCount",reports.docs.filter(r=>
      !["Resolved","Closed (Won't Fix)"].includes(String(r.data().status||"Open"))).length);
    status.textContent="Legacy MCS summary loaded. These are not verified-school directory totals.";
  }catch(error){
    clearCounts();
    status.textContent="Legacy administration counts unavailable: "+(error?.message||"Connection unavailable");
  }
}
async function loadSchoolAdmin(access){
  configureSchoolLabels();
  showPanels("none");
  clearCounts();
  document.querySelectorAll("[data-school-teacher-only]").forEach(node=>
    node.classList.toggle("hidden",!access.schoolTeacher));
  const picker=createTenantSchoolPicker({
    host:get("adminSchoolSwitcher"),status,
    onBeforeChange:async()=>{
      ++refreshEpoch;
      showPanels("none");
      clearCounts();
      status.textContent="Verifying the selected school's administration scope…";
    },
    onReady:scope=>{
      if(!scope.current?.roles?.includes("school_admin")){
        ++refreshEpoch;
        showPanels("none");
        clearCounts();
        status.textContent="This selected school has not granted School Administrator access.";
        return;
      }
      showPanels("school");
      void refresh(scope);
    }
  });

  async function refresh(scope){
    const sequence=++refreshEpoch;
    let lease;
    try{lease=scope.lease();}catch{return;}
    clearCounts();
    status.textContent="Loading verified-school administration totals…";
    const [people,support]=await Promise.allSettled([
      peopleApi({schoolId:lease.schoolId,action:"overview"}),
      supportApi({schoolId:lease.schoolId,action:"overview"})
    ]);
    try{scope.assertLease(lease);}catch{return;}
    if(sequence!==refreshEpoch||auth.currentUser?.uid!==lease.uid)return;
    if(people.status==="fulfilled"){
      const counts=people.value.data?.counts||{};
      set("adminStudentCount",safeCount(counts.people));
      set("adminTeacherCount",safeCount(counts.staff_assignments));
      set("adminEnrollmentCount",safeCount(counts.enrollments));
      set("adminInvitationCount",safeCount(counts.invitations));
    }
    if(support.status==="fulfilled"){
      set("adminReportCount",safeCount(support.value.data?.counts?.open));
    }
    status.textContent=people.status==="fulfilled"&&support.status==="fulfilled"?
      "Verified-school administration loaded for "+scope.current.name+".":
      "Some school totals are unavailable. Open People & Access or School Support to review current records.";
  }
  try{
    const state=await picker.load();
    if(state?.state==="choose_school")status.textContent="Choose an authorized school to load administration.";
  }catch(error){
    showPanels("none");
    clearCounts();
    status.textContent="Verified-school administration is unavailable: "+(error?.message||"Retry when connected");
  }
}
showPanels("none");
await auth.authStateReady();
try{
  const access=await resolveAccountAccess(auth.currentUser);
  if(access.schoolAdmin)await loadSchoolAdmin(access);
  else if(access.platformAdmin)window.location.assign("owner-schools.html");
  else if(access.role==="admin"&&access.legacyCompatibilityAllowed)await loadLegacy();
  else window.location.assign("teacher-home.html");
}catch(error){
  showPanels("none");
  clearCounts();
  status.textContent="Administrator access could not be verified. Retry when connected.";
}
