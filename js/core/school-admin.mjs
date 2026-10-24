import {auth,db} from "./firebase-core.js?v=1.3.0";
import {collection,getDocs} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveStaffRole} from "./staff-session.mjs?v=1.3.10";
await auth.authStateReady();const user=auth.currentUser,role=await resolveStaffRole(user);
if(role!=="admin")location.replace("teacher-home.html");else try{
 const [students,teachers,reports]=await Promise.all([
  getDocs(collection(db,"students")),getDocs(collection(db,"staff_access")),getDocs(collection(db,"issues"))
 ]);
 document.getElementById("adminStudentCount").textContent=students.docs.filter(record=>!["suspended","archived"].includes(String(record.data().status||"active"))).length;
 document.getElementById("adminTeacherCount").textContent=teachers.docs.filter(record=>record.data().role==="teacher"&&record.data().status==="active").length;
 document.getElementById("adminReportCount").textContent=reports.docs.filter(record=>!["Resolved","Closed (Won't Fix)"].includes(String(record.data().status||"Open"))).length;
 document.getElementById("adminOverviewStatus").textContent="Administration summary loaded. Choose a workspace above to continue.";
}catch(error){document.getElementById("adminOverviewStatus").textContent="Some administration counts are unavailable: "+error.message;}