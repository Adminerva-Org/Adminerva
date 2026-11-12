/**
 * Verified-school administration overview.
 * Never use legacy root students/staff_access/issues collection counts here:
 * this page is accessible to school-specific V4 administrators.
 */
import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs";

const directory=httpsCallable(getFunctions(app,"asia-southeast1"),"peopleDirectory");
const byId=id=>document.getElementById(id);
const overviewStatus=byId("adminOverviewStatus");
const schoolStatus=byId("adminSchoolStatus");
const counters={
  people:byId("adminPeopleCount"),
  enrollments:byId("adminEnrollmentCount"),
  staff_assignments:byId("adminAssignmentCount"),
  invitations:byId("adminInviteCount")
};
const protectedPanels=["adminSchoolActions","adminSchoolSummary","adminPilotTools","adminSchoolTools"]
  .map(byId).filter(Boolean);
function showSchoolTools(allowed){
  for(const node of protectedPanels){
    node.hidden=!allowed;
    node.classList.toggle("hidden",!allowed);
  }
}
let requestGeneration=0;
function clearCounts(){
  for(const node of Object.values(counters))if(node)node.textContent="—";
}
async function loadOverview(scope){
  const generation=++requestGeneration;
  const lease=scope.lease();
  overviewStatus.textContent="Loading this school's directory totals…";
  try{
    const response=(await directory({schoolId:lease.schoolId,action:"overview"})).data;
    scope.assertLease(lease);
    if(generation!==requestGeneration||auth.currentUser?.uid!==scope.current?.uid)return;
    for(const [key,node] of Object.entries(counters)){
      if(!node)continue;
      const count=Number(response?.counts?.[key]);
      node.textContent=Number.isSafeInteger(count)&&count>=0?count.toLocaleString():"—";
    }
    overviewStatus.textContent="Verified-school totals loaded. Historical legacy records are not included until reconciled.";
  }catch(error){
    try{scope.assertLease(lease);}catch{return;}
    if(generation!==requestGeneration)return;
    clearCounts();
    overviewStatus.textContent="School totals unavailable. Open People & Access to review this school's directory.";
    console.warn("School administration overview unavailable:",error?.code||error?.message||error);
  }
}
const picker=createTenantSchoolPicker({
  host:byId("adminSchoolPicker"),
  status:schoolStatus,
  onBeforeChange:async()=>{
    ++requestGeneration;
    showSchoolTools(false);
    document.querySelectorAll("[data-legacy-only]").forEach(node=>{node.hidden=true;});
    clearCounts();
    overviewStatus.textContent="Checking the selected school's administration scope…";
  },
  onReady:scope=>{
    clearCounts();
    const authorized=scope.current?.roles?.includes("school_admin")===true;
    showSchoolTools(authorized);
    document.querySelectorAll("[data-legacy-only]").forEach(node=>{
      node.hidden=!authorized||scope.current.compatibilityMode!=="legacy_allowed";
    });
    if(!authorized){
      ++requestGeneration;
      overviewStatus.textContent="This school has not granted you School Administrator access.";
      return;
    }
    void loadOverview(scope);
  }
});
try{
  await picker.load();
  if(!auth.currentUser)overviewStatus.textContent="Sign in to view school administration.";
}catch(error){
  clearCounts();
  overviewStatus.textContent="School access is unavailable. Retry when connected.";
  console.warn("School administration picker unavailable:",error?.code||error?.message||error);
}
