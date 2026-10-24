import {auth,db} from "./firebase-core.js?v=1.3.0";
import {collection,getDocs,query,where} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveStaffRole} from "./staff-session.mjs?v=1.3.10";
await auth.authStateReady();const user=auth.currentUser,role=await resolveStaffRole(user);
if(role!=="admin")location.replace("teacher-home.html");else try{
 const [students,teachers,reports]=await Promise.all([
  getDocs(query(collection(db,"students"),where("status","==","active"))),
  getDocs(query(collection(db,"staff_access"),where("status","==","active"))),
  getDocs(query(collection(db,"issues"),where("status","in",["Open","Triaged","Waiting for Reporter","In Progress"])))
 ]);
 document.getElementById("adminStudentCount").textContent=students.size;
 document.getElementById("adminTeacherCount").textContent=teachers.docs.filter(record=>record.data().role==="teacher").length;
 document.getElementById("adminReportCount").textContent=reports.size;
 document.getElementById("adminOverviewStatus").textContent="Administration summary loaded. Choose a workspace above to continue.";
}catch(error){document.getElementById("adminOverviewStatus").textContent="Some administration counts are unavailable: "+error.message;}