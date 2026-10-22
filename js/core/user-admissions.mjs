import {auth,db} from "./firebase-core.js?v=1.3.0";
import {collection,getDocs,query,orderBy,limit} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveStaffRole} from "./staff-session.mjs?v=1.3.0";
import {matchingStudentRecords,decideAdmission} from "./admission-service.mjs?v=1.3.0";
import {loadSchoolOptions,fillSchoolDatalist} from "./school-options.mjs?v=1.3.0";
const field=id=>document.getElementById(id);
let opened=null,busy=false,selection=0;
function status(message){field("admission-status").textContent=message;}
function updateApprovalFields(){
  const student=field("admission-role").value==="student",isNew=!field("admission-student").value;
  field("admission-student-fields").hidden=!student;field("admission-section-label").hidden=!student||!isNew;
  field("admission-section").required=student&&isNew;field("admission-teacher-hint").hidden=student;
}
for(const id of ["admission-role","admission-student"])field(id).addEventListener("change",updateApprovalFields);
field("admission-cancel").onclick=()=>{if(busy)return;selection++;opened=null;field("admission-form").hidden=true;status("Review canceled. No access was changed.");};
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
        field("admission-role").value=request.requestedRole==="teacher"?"teacher":"student";field("admission-reason").value="";field("admission-section").value="";updateApprovalFields();field("admission-form").hidden=false;field("admission-role").focus();field("admission-form").scrollIntoView({behavior:"auto",block:"nearest"});
        status("Choose access deliberately. Existing students are linked only by the same verified email. Teacher section assignments are configured in Manage Teachers.");
      }catch{status("Matching records could not load. No access was changed.");}
    };field("admission-list").append(button);
  }
  if(records.empty)status("No guest requests yet. Existing students do not need to register again.");
  else status("Showing "+records.size+" most recent requests. Decided requests are read-only.");
}
field("admission-refresh").onclick=()=>{if(!busy){selection++;opened=null;field("admission-form").hidden=true;refresh().catch(()=>status("Could not refresh requests."));}};
field("admission-form").onsubmit=async event=>{
  event.preventDefault();if(!opened||busy)return;
  const decision=event.submitter?.value||"approved";
  if(field("admission-reason").value.trim().length<12){status("Enter a decision reason of at least 12 characters before approving or rejecting.");field("admission-reason").focus();return;}
  if(!confirm(decision==="approved"?"Approve this verified account for the selected role?":"Reject this request? The reason will be retained in the audit history."))return;
  busy=true;for(const button of field("admission-form").querySelectorAll("button"))button.disabled=true;
  try{
    await decideAdmission(opened,{role:field("admission-role").value,studentId:field("admission-student").value,section:field("admission-section").value,reason:field("admission-reason").value,decision});
    const role=field("admission-role").value;field("admission-form").hidden=true;opened=null;
    try{await refresh();status("Decision saved."+(decision==="approved"&&role==="teacher"?" Open Teachers to assign teaching sections. Existing assignments were preserved.":" The account owner can reload to see their access status."));}
    catch{status("Decision saved successfully. Requests could not refresh; select Refresh requests to try again.");}
  }catch(error){status(error.message||"Decision failed. Reload to check the current request.");}
  finally{busy=false;for(const button of field("admission-form").querySelectorAll("button"))button.disabled=false;}
};
await auth.authStateReady();
if(await resolveStaffRole(auth.currentUser)==="admin")try{
  field("admissions").hidden=false;await refresh();
  try{const choices=await loadSchoolOptions();fillSchoolDatalist("admission-section-choices",choices.sections);}catch{/* Exact section names can still be entered when suggestions are unavailable. */}
}catch{status("Guest requests could not load. Check your connection and administrator permissions.");}
