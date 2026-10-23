/** Explicit recovery copies; shared originals are never edited from this interface. */
import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {resolveStaffRole} from "./staff-session.mjs?v=1.3.0";
const request=httpsCallable(getFunctions(app,"asia-southeast1"),"legacyLessonRecovery",{timeout:120000});
const setupRequest=httpsCallable(getFunctions(app,"asia-southeast1"),"legacySchoolSetup",{timeout:120000});
export async function restoreOriginalTeacherSections(){
  const actor=auth.currentUser;if(await resolveStaffRole(actor)!=="admin")throw Error("Administrator access is required.");
  const response=await setupRequest({});if(auth.currentUser?.uid!==actor.uid)throw Error("Account changed. Reload teacher assignments.");return response.data;
}
export async function legacyLessonRecovery(payload){
  const actor=auth.currentUser;
  const role=await resolveStaffRole(actor),own=payload?.action==="recover-own";
  if(own?role!=="teacher"||!actor?.emailVerified||actor.email?.toLowerCase()!=="josephsixson@mcstayuman.edu.ph":role!=="admin")throw Error(own?"Sign in with the original teacher account to restore its saved lessons.":"Administrator access is required to recover school records.");
  const result=await request(payload);
  if(auth.currentUser?.uid!==actor.uid)throw Error("Account changed. Reload to see recovery results.");
  return result.data;
}
const field=id=>document.getElementById(id);
export function mountLegacyRecovery(){
  const root=field("legacy-recovery");if(!root)return;
  let preview=null,busy=false;
  const status=message=>field("legacy-recovery-status").textContent=message;
  const render=()=>{
    const list=field("legacy-recovery-list");list.replaceChildren();
    for(const [key,eligible] of [["eligible",true],["unattributed",false]])for(const record of preview?.[key]||[]){
      const label=document.createElement("label");label.className="av-section-option";
      const check=document.createElement("input");check.type="checkbox";check.value=record.id;check.dataset.attributable=String(eligible);
      const details=document.createElement("span"),title=document.createElement("strong"),hint=document.createElement("small");
      title.textContent=record.title||record.subjectTitle||record.id;
      hint.textContent=[record.schoolYear||"School year unrecorded",record.teacherName,eligible?"Owner identity matches original teacher":"Owner unverified · requires explicit administrator confirmation"].filter(Boolean).join(" · ");
      details.append(title,hint);label.append(check,details);list.append(label);
    }
    field("legacy-recovery-apply").hidden=!list.children.length;
    status("Original teacher: "+(preview?.ownerEmail||"unavailable")+". "+(preview?.eligible?.length||0)+" attributable, "+(preview?.unattributed?.length||0)+" unverified, "+(preview?.alreadyRecovered?.length||0)+" previously recovered, "+(preview?.blocked?.length||0)+" blocked by ownership or missing content."+(preview?.hasMore?" Showing the first 500 shared records.":"")+" Originals stay in the shared archive.");
  };
  field("legacy-recovery-preview").onclick=async()=>{
    if(busy)return;busy=true;field("legacy-recovery-preview").disabled=true;status("Inspecting legacy records and their saved ownership evidence…");
    try{preview=await legacyLessonRecovery({action:"preview"});render();}
    catch(error){status("Recovery preview could not load. "+error.message);}
    finally{busy=false;field("legacy-recovery-preview").disabled=false;}
  };
  field("legacy-recovery-apply").onclick=async()=>{
    if(busy||!preview)return;
    const selected=[...root.querySelectorAll('input[type="checkbox"][data-attributable]:checked')],recordIds=selected.map(input=>input.value),reason=field("legacy-recovery-reason").value.trim();
    const needsAttestation=selected.some(input=>input.dataset.attributable==="false"),attestOriginalOwner=field("legacy-recovery-attest").checked;
    if(!recordIds.length){status("Select the specific records to recover.");return;}
    if(recordIds.length>100){status("Recover up to 100 lessons at a time.");return;}
    if(reason.length<15){status("Add a recovery reason of at least 15 characters.");return;}
    if(needsAttestation&&!attestOriginalOwner){status("Unverified records require the administrator’s explicit ownership confirmation. A matching display name is insufficient.");return;}
    if(!confirm("Copy "+recordIds.length+" selected lessons into "+preview.ownerEmail+"’s workspace? Existing personal lessons and all shared originals will be preserved."))return;
    busy=true;field("legacy-recovery-apply").disabled=true;
    try{const versions=Object.fromEntries([...(preview.eligible||[]),...(preview.unattributed||[])].filter(record=>recordIds.includes(record.id)).map(record=>[record.id,record.sourceVersion]));const result=await legacyLessonRecovery({action:"recover",recordIds,reason,attestOriginalOwner,sourceVersions:versions});status(result.message||"Recovery completed. The original teacher can now open Saved Lesson Plans. Existing copies and original archive records were preserved.");field("legacy-recovery-list").replaceChildren();field("legacy-recovery-apply").hidden=true;preview=null;}
    catch(error){status("Recovery did not complete: "+error.message+". Use Preview again to inspect completed copies before retrying.");}
    finally{busy=false;field("legacy-recovery-apply").disabled=false;}
  };
}
