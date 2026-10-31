import {app,auth,db} from "./firebase-core.js?v=1.3.0";
import {collection,getDocs} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {resolveAccountAccess} from "./staff-session.mjs?v=4.0.0";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs?v=4.0.0";

const status=document.getElementById("adminOverviewStatus");
const legacy=document.getElementById("adminLegacyActions");
const schoolActions=document.getElementById("adminSchoolActions");
const peopleApi=httpsCallable(getFunctions(app,"asia-southeast1"),"peopleDirectory");
const set=(id,value)=>{const node=document.getElementById(id);if(node)node.textContent=value;};

function configureSchoolLabels(){
  set("adminMetricOneLabel","School people");
  set("adminMetricTwoLabel","Teaching assignments");
  set("adminMetricThreeLabel","Pending invitations");
  const links=[
    ["adminMetricOneLink","people-access.html","Open People & Access"],
    ["adminMetricTwoLink","people-access.html#classes","Manage classes"],
    ["adminMetricThreeLink","people-access.html#invites","Review invitations"]
  ];
  for(const [id,href,label] of links){const node=document.getElementById(id);if(node){node.href=href;node.textContent=label;}}
}
async function loadLegacy(){
  legacy?.classList.remove("hidden");schoolActions?.classList.add("hidden");
  try{
    const [students,teachers,reports]=await Promise.all([
      getDocs(collection(db,"students")),
      getDocs(collection(db,"staff_access")),
      getDocs(collection(db,"issues"))
    ]);
    set("adminStudentCount",students.docs.filter(record=>!["suspended","archived"].includes(String(record.data().status||"active"))).length);
    set("adminTeacherCount",teachers.docs.filter(record=>record.data().role==="teacher"&&record.data().status==="active").length);
    set("adminReportCount",reports.docs.filter(record=>!["Resolved","Closed (Won't Fix)"].includes(String(record.data().status||"Open"))).length);
    status.textContent="Platform administration summary loaded.";
  }catch(error){status.textContent="Some legacy administration counts are unavailable: "+error.message;}
}
async function loadSchoolAdmin(access){
  configureSchoolLabels();
  legacy?.classList.add("hidden");schoolActions?.classList.remove("hidden");
  document.querySelectorAll("[data-school-teacher-only]").forEach(node=>node.classList.toggle("hidden",!access.schoolTeacher));
  const picker=createTenantSchoolPicker({
    host:document.getElementById("adminSchoolSwitcher"),status,
    onReady:scope=>void refresh(scope),
    onBeforeChange:async()=>{status.textContent="Switching verified school context…";}
  });
  async function refresh(scope){
    if(!scope.current)return;
    try{
      const lease=scope.lease();
      const result=(await peopleApi({schoolId:lease.schoolId,action:"overview"})).data;
      scope.assertLease(lease);
      set("adminStudentCount",result.counts?.people??0);
      set("adminTeacherCount",result.counts?.staff_assignments??0);
      set("adminReportCount",result.counts?.invitations??0);
      status.textContent="Verified school administration loaded for "+lease.schoolId+".";
    }catch(error){status.textContent=error?.message||"School administration summary is unavailable.";}
  }
  const state=await picker.load();
  if(state?.context)await refresh(picker.scope);
}
await auth.authStateReady();
const access=await resolveAccountAccess(auth.currentUser);
if(access.role==="admin")await loadLegacy();
else if(access.schoolAdmin)await loadSchoolAdmin(access);
else window.location.assign("teacher-home.html");
