import {auth,db} from "./firebase-core.js";
import {collection,getDocs,query,orderBy,limit} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveStaffRole} from "./staff-session.mjs?v=1.1.0";
import {matchingStudentRecords,decideAdmission} from "./admission-service.mjs?v=1.1.0";
const field=id=>document.getElementById(id);
let opened=null,busy=false,selection=0;
function status(message){field("admission-status").textContent=message;}
async function refresh(){
  const records=await getDocs(query(collection(db,"account_requests"),orderBy("createdAt","desc"),limit(100)));
  field("admission-list").replaceChildren();
  for(const record of records.docs){
    const request=record.data(),button=document.createElement("button");button.type="button";button.className="av-directory-card";
    button.textContent=request.displayName+" · "+request.email+" · requested "+request.requestedRole+" · "+request.status;
    button.disabled=request.status!=="pending";
    button.onclick=async()=>{
      if(busy)return;const epoch=++selection;opened=null;field("admission-form").hidden=true;status("Looking for matching existing student records…");
      try{
        const students=await matchingStudentRecords(request.email);if(epoch!==selection)return;
        opened=request;field("admission-name").textContent=request.displayName+" · "+request.email;
        field("admission-student").replaceChildren(new Option("Create a new student record (section required)",""),...students.map(student=>new Option(student.name+" · "+student.section,student.id)));
        if(students.length===1)field("admission-student").value=students[0].id;
        field("admission-role").value=request.requestedRole==="teacher"?"teacher":"student";field("admission-reason").value="";field("admission-form").hidden=false;
        status("Choose access deliberately. Existing students are linked only by the same verified email. Teacher section assignments are configured in Manage Teachers.");
      }catch{status("Matching records could not load. No access was changed.");}
    };field("admission-list").append(button);
  }
  if(records.empty)status("No guest requests yet. Existing students do not need to register again.");
  else status("Showing "+records.size+" most recent requests. Decided requests are read-only.");
}
field("admission-refresh").onclick=()=>{if(!busy)refresh().catch(()=>status("Could not refresh requests."));};
field("admission-form").onsubmit=async event=>{
  event.preventDefault();if(!opened||busy)return;
  const decision=event.submitter?.value||"approved";
  if(!confirm(decision==="approved"?"Approve this verified account for the selected role?":"Reject this request? The reason will be retained in the audit history."))return;
  busy=true;for(const button of field("admission-form").querySelectorAll("button"))button.disabled=true;
  try{
    await decideAdmission(opened,{role:field("admission-role").value,studentId:field("admission-student").value,section:field("admission-section").value,reason:field("admission-reason").value,decision});
    field("admission-form").hidden=true;opened=null;await refresh();status("Decision saved with reviewer identity and immutable history. No invitation was sent and no existing student records were overwritten.");
  }catch(error){status(error.message||"Decision failed. Reload to check the current request.");}
  finally{busy=false;for(const button of field("admission-form").querySelectorAll("button"))button.disabled=false;}
};
await auth.authStateReady();
if(await resolveStaffRole(auth.currentUser)==="admin")try{field("admissions").hidden=false;await refresh();}catch{status("Guest requests could not load. Check your connection and administrator permissions.");}
