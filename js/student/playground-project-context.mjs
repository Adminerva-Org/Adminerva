import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {doc,getDoc} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
const projectId=new URLSearchParams(location.search).get("project"),banner=document.getElementById("assignedProjectBanner");
if(projectId&&/^[a-zA-Z0-9_-]{1,80}$/.test(projectId)&&banner){
  await auth.authStateReady();
  if(auth.currentUser)try{
    const snapshot=await getDoc(doc(db,"student_projects",projectId));
    if(snapshot.exists()){
      const project=snapshot.data();banner.classList.remove("hidden");
      document.getElementById("assignedProjectTitle").textContent=project.title||"Assigned project";
      document.getElementById("assignedProjectMeta").textContent=(project.dueDate?"Due "+project.dueDate+" · ":"")+"Use this Playground as your working area. Saving remains under your own Adminerva account.";
      document.getElementById("assignedProjectBrief").textContent=project.description||"No additional project brief was provided.";
    }
  }catch(error){console.warn("Assigned project context unavailable",error);}
}
