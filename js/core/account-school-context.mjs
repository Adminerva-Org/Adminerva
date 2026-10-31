import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const tenantSchools=httpsCallable(getFunctions(app,"asia-southeast1"),"tenantSchools");
const preferredKey=uid=>"Adminerva_last_verified_school_"+uid;
const unsafePages=new Set([
  // These pages already own a verified-school picker and may have unsaved
  // editor/review state. The account menu stays read-only there.
  "student-playground.html","gradebook.html","teacher-assessment-library.html",
  "people-access.html","owner-schools.html"
]);
let mountedFor=null,requestId=0;
function pageName(){return location.pathname.split("/").pop()||"index.html";}
function readPreferred(uid){try{return sessionStorage.getItem(preferredKey(uid))||null;}catch{return null;}}
function writePreferred(uid,schoolId){try{sessionStorage.setItem(preferredKey(uid),schoolId);}catch{}}
function optionName(school){return String(school?.name||school?.schoolId||"School").slice(0,120);}
export async function mountAccountSchoolSwitcher(root=document.getElementById("adminerva-nav")){
  const host=root?.querySelector("#av-school-context");
  if(!host)return;
  await auth.authStateReady();
  const user=auth.currentUser;
  if(!user?.uid||!user.emailVerified){host.hidden=true;host.replaceChildren();return;}
  const run=++requestId;
  let response;
  try{response=(await tenantSchools({preferredSchoolId:readPreferred(user.uid)})).data;}
  catch{if(run===requestId){host.hidden=true;host.replaceChildren();}return;}
  if(run!==requestId||auth.currentUser?.uid!==user.uid)return;
  const schools=Array.isArray(response?.schools)?response.schools:[];
  if(schools.length<=1){
    host.hidden=true;host.replaceChildren();
    if(schools.length===1)writePreferred(user.uid,schools[0].schoolId);
    return;
  }
  const selected=response?.selection?.schoolId||readPreferred(user.uid)||"";
  host.replaceChildren();
  const label=document.createElement("label");
  label.className="block px-3 py-2 border-b border-slate-700";
  const caption=document.createElement("span");
  caption.className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1";
  caption.textContent="Active school";
  if(unsafePages.has(pageName())){
    const current=schools.find(s=>s.schoolId===selected);
    const value=document.createElement("span");
    value.className="block text-sm font-semibold text-slate-100";
    value.textContent=current?optionName(current):"Choose school in this workspace";
    const note=document.createElement("span");
    note.className="block text-[10px] text-slate-400 mt-1";
    note.textContent="Use this workspace's school selector to protect unsaved work.";
    label.append(caption,value,note);
  }else{
    const select=document.createElement("select");
    select.className="w-full rounded-md bg-slate-800 border border-slate-600 text-slate-100 text-xs px-2 py-2";
    const blank=document.createElement("option");
    blank.value="";blank.textContent="Choose school";blank.disabled=true;blank.selected=!selected;
    select.append(blank);
    for(const school of schools){
      const option=document.createElement("option");
      option.value=school.schoolId;option.textContent=optionName(school);
      option.selected=school.schoolId===selected;select.append(option);
    }
    select.addEventListener("change",()=>{
      const schoolId=select.value;
      if(!schools.some(s=>s.schoolId===schoolId))return;
      writePreferred(user.uid,schoolId);
      document.dispatchEvent(new CustomEvent("adminerva:preferred-school-changed",{detail:{schoolId}}));
      location.reload();
    });
    label.append(caption,select);
  }
  host.append(label);host.hidden=false;mountedFor=user.uid;
}
export function clearAccountSchoolSwitcher(){
  requestId++;mountedFor=null;
  const host=document.getElementById("av-school-context");
  if(host){host.hidden=true;host.replaceChildren();}
}
