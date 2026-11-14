import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"tenantSchools");
const SCHOOL_KEY=uid=>"Adminerva_last_verified_school_"+uid;
const VIEW_SCHOOL="Adminerva_platform_view_school";
const VIEW_ROLE="Adminerva_platform_view_role";

function getSession(key){try{return sessionStorage.getItem(key)||"";}catch{return "";}}
function setSession(key,value){try{value?sessionStorage.setItem(key,value):sessionStorage.removeItem(key);}catch{}}
function rememberSchool(uid,schoolId){try{schoolId?sessionStorage.setItem(SCHOOL_KEY(uid),schoolId):sessionStorage.removeItem(SCHOOL_KEY(uid));}catch{}}
function field(labelText){
  const label=document.createElement("label");
  label.className="block px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400";
  const text=document.createElement("span");text.textContent=labelText;label.append(text);
  const select=document.createElement("select");
  select.className="mt-1 w-full min-h-9 rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-xs text-slate-100";
  label.append(select);return {label,select};
}
function routeForRole(role){
  if(role==="student")return "student-home.html";
  if(role==="teacher")return "teacher-home.html";
  return "school-admin.html";
}
function option(select,value,text,{selected=false}={}){
  const item=document.createElement("option");item.value=value;item.textContent=text;item.selected=selected;select.append(item);
}
function currentSchoolName(schools,id){return schools.find(s=>s.schoolId===id)?.name||id||"";}

export async function mountAccountContextSwitcher(root=document){
  await auth.authStateReady();
  const user=auth.currentUser,menu=root.querySelector(".av-account-menu .av-nav-menu-panel");
  if(!user||!menu)return;

  let host=menu.querySelector("#av-account-context");
  if(!host){
    host=document.createElement("div");host.id="av-account-context";
    host.className="border-b border-slate-700 pb-2 mb-2";
    menu.prepend(host);
  }
  host.replaceChildren();
  const loading=document.createElement("p");
  loading.className="px-3 py-2 text-xs text-slate-400";loading.textContent="Loading school context…";host.append(loading);

  let payload;
  try{payload=(await api({preferredSchoolId:getSession(VIEW_SCHOOL)||getSession(SCHOOL_KEY(user.uid))||null})).data||{};}
  catch(error){loading.textContent=error?.message||"School context unavailable.";return;}
  const schools=Array.isArray(payload.schools)?payload.schools:[],platformAdmin=payload.platformAdmin===true;
  host.replaceChildren();

  if(platformAdmin){
    const schoolField=field("View context");
    option(schoolField.select,"","System administration",{selected:!getSession(VIEW_SCHOOL)});
    const selectedSchool=getSession(VIEW_SCHOOL);
    for(const school of schools)option(schoolField.select,school.schoolId,school.name||school.schoolId,{selected:school.schoolId===selectedSchool});
    host.append(schoolField.label);

    const roleField=field("Role view");
    roleField.label.classList.toggle("hidden",!selectedSchool);
    const selectedRole=getSession(VIEW_ROLE)||"schooladmin";
    option(roleField.select,"schooladmin","School administrator",{selected:selectedRole==="schooladmin"});
    option(roleField.select,"teacher","Teacher",{selected:selectedRole==="teacher"});
    option(roleField.select,"student","Student",{selected:selectedRole==="student"});
    host.append(roleField.label);

    const note=document.createElement("p");note.className="px-2 pt-1.5 text-[10px] leading-4 text-slate-500";
    note.textContent=selectedSchool
      ?"System administrator override · "+currentSchoolName(schools,selectedSchool)
      :"System-wide administration";
    host.append(note);

    schoolField.select.addEventListener("change",()=>{
      const schoolId=schoolField.select.value;
      if(!schoolId){
        setSession(VIEW_SCHOOL,"");setSession(VIEW_ROLE,"");rememberSchool(user.uid,"");
        location.href="owner-schools.html";return;
      }
      setSession(VIEW_SCHOOL,schoolId);
      const role=getSession(VIEW_ROLE)||"schooladmin";setSession(VIEW_ROLE,role);
      rememberSchool(user.uid,schoolId);
      location.href=routeForRole(role);
    });
    roleField.select.addEventListener("change",()=>{
      const schoolId=getSession(VIEW_SCHOOL);
      if(!schoolId)return;
      setSession(VIEW_ROLE,roleField.select.value);rememberSchool(user.uid,schoolId);
      location.href=routeForRole(roleField.select.value);
    });
    return;
  }

  const actualSchools=schools.filter(s=>s.platformOverride!==true);
  if(actualSchools.length>1){
    const selected=getSession(SCHOOL_KEY(user.uid))||payload.selection?.schoolId||actualSchools[0].schoolId;
    const schoolField=field("School");
    for(const school of actualSchools)option(schoolField.select,school.schoolId,school.name||school.schoolId,{selected:school.schoolId===selected});
    host.append(schoolField.label);
    schoolField.select.addEventListener("change",()=>{
      rememberSchool(user.uid,schoolField.select.value);
      document.dispatchEvent(new CustomEvent("adminerva:context-changed",{detail:{schoolId:schoolField.select.value}}));
      location.reload();
    });
  }else if(actualSchools.length===1){
    const school=document.createElement("div");school.className="px-3 py-2";
    const label=document.createElement("span");label.className="block text-[10px] uppercase tracking-wider text-slate-500";label.textContent="School";
    const name=document.createElement("strong");name.className="block text-xs text-slate-100 mt-1";name.textContent=actualSchools[0].name||actualSchools[0].schoolId;
    school.append(label,name);host.append(school);
  }else host.hidden=true;
}
