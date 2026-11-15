import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const target=document.body?.dataset?.peopleAccessTarget||"overview";
const valid=new Set(["overview","people","import","invites","classes","access"]);
const destination=valid.has(target)?target:"overview";
const api=httpsCallable(getFunctions(app,"asia-southeast1"),"tenantSchools");

function redirect(){
  const url=new URL("people-access.html",location.href);
  for(const [key,value] of new URLSearchParams(location.search))url.searchParams.append(key,value);
  url.searchParams.set("from",location.pathname.split("/").pop()||"legacy-directory");
  url.hash=destination;
  location.replace(url.href);
}
await auth.authStateReady();
if(auth.currentUser){
  try{
    const preferred=sessionStorage.getItem("Adminerva_last_verified_school_"+auth.currentUser.uid)||null;
    const response=(await api({preferredSchoolId:preferred})).data||{};
    const canonicalAdmin=response.platformAdmin===true||
      (response.schools||[]).some(school=>Array.isArray(school.roles)&&school.roles.includes("school_admin"));
    if(canonicalAdmin)redirect();
  }catch{
    // Compatibility fallback: an account not yet adopted into the school-wide
    // membership model may continue using the old page until consolidation.
  }
}
