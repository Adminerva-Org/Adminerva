import {app,auth} from "./firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "./tenant-school-picker.mjs?v=4.0.0";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAnalytics");
const el=id=>document.getElementById(id),status=el("schoolAnalyticsStatus"),
  workspace=el("schoolAnalyticsWorkspace");
let loading=false;
function card(label,value,hint=""){
  const node=document.createElement("article");
  node.className="bg-white border rounded-2xl p-4 shadow-sm";
  const small=document.createElement("p");small.className="text-xs font-bold uppercase tracking-wide text-slate-500";small.textContent=label;
  const strong=document.createElement("strong");strong.className="block text-3xl mt-1";strong.textContent=String(value??0);
  node.append(small,strong);
  if(hint){const p=document.createElement("p");p.className="text-xs text-slate-500 mt-2";p.textContent=hint;node.append(p);}
  return node;
}
function render(data){
  const summary=el("schoolAnalyticsSummary");summary.replaceChildren(
    card("Active people",data.directory?.peopleActive,"School directory records"),
    card("Active enrollments",data.academics?.activeEnrollments,"Current course-offering memberships"),
    card("Teaching assignments",data.academics?.activeTeachingAssignments,"Current teacher-course grants"),
    card("Published grades",data.grades?.published,"Explicitly student-visible results")
  );
  const review=el("schoolAnalyticsReview");review.replaceChildren(
    card("Studio awaiting review",data.review?.studio?.submitted),
    card("Studio revisions open",data.review?.studio?.reopened),
    card("GitHub awaiting verification",data.review?.github?.submitted),
    card("GitHub approved",data.review?.github?.approved),
    card("Private grade drafts",data.grades?.draft),
    card("Deployed assessments",data.academics?.deployedAssessments)
  );
  const support=el("schoolAnalyticsSupport");support.replaceChildren(
    card("Open reports",data.support?.open),
    card("Critical-tagged reports",data.support?.critical,"Includes all report statuses"),
    card("Resolved",data.support?.resolved),
    card("Closed",data.support?.closed)
  );
}
const picker=createTenantSchoolPicker({
  host:el("schoolAnalyticsSwitcher"),status,
  onBeforeChange:async()=>{workspace.hidden=true;},
  onReady:()=>void refresh()
});
async function refresh(){
  if(loading||!picker.scope.current)return;
  loading=true;el("schoolAnalyticsRefresh").disabled=true;
  status.textContent="Loading aggregate counts for the selected school…";
  try{
    const lease=picker.scope.lease();
    const data=(await api({schoolId:lease.schoolId,action:"overview"})).data;
    picker.scope.assertLease(lease);render(data);workspace.hidden=false;
    status.textContent="School operations updated "+new Date(data.generatedAt).toLocaleString()+".";
  }catch(error){
    workspace.hidden=true;status.textContent=error?.message||"School operational analytics are unavailable.";
  }finally{loading=false;el("schoolAnalyticsRefresh").disabled=false;}
}
el("schoolAnalyticsRefresh").addEventListener("click",()=>void refresh());
try{
 await picker.load();
 if(!auth.currentUser)status.textContent="Sign in to view school operations.";
}catch(error){status.textContent=error?.message||"Unable to verify school administration access.";}
