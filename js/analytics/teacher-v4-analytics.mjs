/** Authorized V4 offering analytics for assigned teachers; does not write grades. */
import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {createTenantSchoolPicker} from "../core/tenant-school-picker.mjs?v=4.0.0";

const root=document.getElementById("verifiedTeacherAnalytics");
if(root){
  const el=id=>document.getElementById(id),select=el("verifiedTeacherClass"),toggle=el("verifiedTeacherDrafts"),
    refresh=el("verifiedTeacherRefresh"),status=el("verifiedTeacherStatus"),
    metrics=el("verifiedTeacherMetrics"),assessments=el("verifiedTeacherAssessments"),
    studentsHost=el("verifiedTeacherStudents"),search=el("verifiedTeacherStudentSearch");
  const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolTeacherAnalytics");
  let picker=null,offerings=[],rows=[],scopeRequest=0,classRequest=0,loadingScope=false,loadingClass=false,readySchool="";
  const node=(tag,text,cls="")=>{const e=document.createElement(tag);e.textContent=text;e.className=cls;return e;};
  const signal=(message,failed=false)=>{status.textContent=message;status.className="mt-3 text-sm "+(failed?"text-rose-700":"text-slate-600");};
  const metric=(value,label,detail)=>{
    const card=node("div","","rounded-xl border border-slate-200 bg-slate-50 p-3");
    card.append(node("strong",value,"block text-xl font-extrabold text-slate-900"),node("span",label,"block text-xs font-bold text-slate-700 mt-1"),node("p",detail,"text-xs text-slate-500 mt-1"));return card;
  };
  const fraction=value=>value===null||value===undefined?"—":Number(value).toLocaleString(undefined,{maximumFractionDigits:1})+"%";
  const displayName=item=>[item.subject,item.section,item.term,item.year].filter(Boolean).join(" · ");
  const storeKey=()=>picker?.scope.current?"Adminerva_teacher_v4_class_"+auth.currentUser?.uid+"_"+picker.scope.current.schoolId:"";
  const getPreferred=()=>{try{return sessionStorage.getItem(storeKey())||"";}catch{return "";}};
  const setPreferred=id=>{try{sessionStorage.setItem(storeKey(),id);}catch{}};
  const valid=()=>picker?.scope.current?.roles.includes("teacher")&&picker.scope.current.uid===auth.currentUser?.uid;
  const controls=()=>{select.disabled=loadingScope||loadingClass||!offerings.length;toggle.disabled=loadingScope||loadingClass||!offerings.length;refresh.disabled=loadingScope||loadingClass;search.disabled=loadingScope||loadingClass||!rows.length;root.setAttribute("aria-busy",String(loadingScope||loadingClass));};
  async function scoped(action,details={}){
    if(!valid())throw Error("Verified teacher access is unavailable.");
    const lease=picker.scope.lease(),result=(await api({schoolId:lease.schoolId,action,...details})).data;
    picker.scope.assertLease(lease);
    if(lease.uid!==auth.currentUser?.uid)throw Error("Account changed. Reload your teaching workspace.");
    return result;
  }
  function clear(){
    offerings=[];rows=[];readySchool="";select.replaceChildren(new Option("Choose an assigned class",""));
    metrics.replaceChildren();assessments.replaceChildren();studentsHost.replaceChildren();
    el("verifiedTeacherClassRecordLink").href="class-record.html";controls();
  }
  function renderStudents(){
    const term=search.value.trim().toLowerCase();studentsHost.replaceChildren();
    const visible=rows.filter(item=>String(item.displayName||"").toLowerCase().includes(term));
    if(!visible.length){studentsHost.append(node("p",rows.length?"No students match this search.":"No active linked student records were returned for this class.","rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600"));return;}
    for(const item of visible){
      const card=node("div","","flex flex-wrap justify-between gap-2 rounded-lg border border-slate-200 p-3");
      card.append(node("strong",item.displayName||"Student","text-sm text-slate-800 break-words"),
        node("span",(item.publishedGrades||0)+" published"+(toggle.checked?" · "+(item.draftGrades||0)+" private draft":""),
        "text-xs text-slate-700"));
      if(item.averagePercentage!==null)card.append(node("span",fraction(item.averagePercentage)+" reported-results average"+(toggle.checked?" (provisional)":""),
        "w-full text-xs text-slate-600"));
      else card.append(node("span","No released result included in this view","w-full text-xs text-slate-500"));
      studentsHost.append(card);
    }
  }
  function renderResult(data){
    const sum=data.summary||{},provisional=data.scope==="published_and_my_drafts",offering=data.offering||{};
    metrics.replaceChildren(
      metric(String(sum.students??0),"Enrolled students","Active linked records"),
      metric(String(sum.assessments??0),"Deployed assessments","Owned or assigned for review"),
      metric(String(sum.publishedGrades??0),"Published grades","Released to students"),
      metric(String(sum.studentsWithPublishedGrade??0)+" / "+String(sum.students??0),"Students with published grades","Coverage, not a completion rate"),
      metric(fraction(sum.averagePercentage),"Reported score average",provisional?"Includes your private drafts":"Published grades only")
    );
    assessments.replaceChildren();
    if(!(data.assessments||[]).length)assessments.append(node("p","No deployed assessments in this class are assigned to you for review.","rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600"));
    for(const item of data.assessments||[]){
      const card=node("div","","rounded-xl border border-slate-200 p-3"),link=node("a",item.title||"Assessment","block font-bold text-cyan-900 underline break-words");
      link.href="school-gradebook.html?task="+encodeURIComponent(item.taskId);
      card.append(link,node("p",(item.publishedGrades||0)+" published results"+(provisional?" · "+(Math.max(0,Number(item.visibleGrades||0)-Number(item.publishedGrades||0)))+" private drafts":""),"text-xs text-slate-600 mt-1"),
       node("p","Average of included scores: "+fraction(item.averagePercentage),"text-xs text-slate-600 mt-1"));
      assessments.append(card);
    }
    rows=Array.isArray(data.students)?data.students:[];renderStudents();
    el("verifiedTeacherClassRecordLink").href="class-record.html?offeringId="+encodeURIComponent(data.offeringId);
    signal(displayName(offering)+". "+(provisional?"Private drafts included; results are provisional.":"Only published results shown.")+" Missing scores excluded from averages.");
  }
  async function loadClass(){
    if(!valid()||!select.value||loadingScope)return;
    const turn=++classRequest,id=select.value,includeDrafts=toggle.checked;
    setPreferred(id);loadingClass=true;rows=[];metrics.replaceChildren();assessments.replaceChildren();studentsHost.replaceChildren();controls();
    signal("Loading verified class results…");
    try{
      const response=await scoped("class",{offeringId:id,includeDrafts});
      if(turn!==classRequest||select.value!==id||toggle.checked!==includeDrafts||!valid())return;
      renderResult(response);
    }catch(error){if(turn===classRequest){signal("Class results unavailable: "+(error.message||"retry later"),true);}}
    finally{if(turn===classRequest){loadingClass=false;controls();}}
  }
  async function loadScope(){
    if(!valid())return;
    const turn=++scopeRequest;++classRequest,school=picker.scope.current.schoolId;loadingScope=true;clear();controls();signal("Loading assigned school classes…");
    try{
      const response=await scoped("scope");
      if(turn!==scopeRequest||!valid()||picker.scope.current.schoolId!==school)return;
      offerings=Array.isArray(response.offerings)?response.offerings:[];
      select.replaceChildren(new Option(offerings.length?"Choose an assigned class":"No active assigned classes",""));
      for(const item of offerings)select.add(new Option(displayName(item),item.offeringId));
      const preferred=getPreferred();
      select.value=offerings.some(item=>item.offeringId===preferred)?preferred:offerings[0]?.offeringId||"";
      readySchool=school;
      if(!offerings.length){
        metrics.replaceChildren();assessments.replaceChildren(node("p","No active class is currently assigned to your account.","rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600"));
        studentsHost.replaceChildren();signal("No active teaching assignments found. Refresh after your class assignment changes.");
      }
    }catch(error){if(turn===scopeRequest)signal("Assigned classes could not load: "+(error.message||"retry later"),true);}
    finally{if(turn===scopeRequest){loadingScope=false;controls();if(readySchool&&select.value)void loadClass();}}
  }
  select.addEventListener("change",()=>void loadClass());
  toggle.addEventListener("change",()=>void loadClass());
  refresh.addEventListener("click",()=>{if(loadingScope||loadingClass)return;if(!readySchool||!offerings.length)void loadScope();else void loadClass();});
  search.addEventListener("input",renderStudents);
  picker=createTenantSchoolPicker({host:el("verifiedTeacherSchoolPicker"),status:null,
    onBeforeChange:async()=>{++scopeRequest;++classRequest;loadingScope=false;loadingClass=false;toggle.checked=false;search.value="";clear();signal("Switching verified school…");},
    onReady:scope=>{if(scope.current?.roles.includes("teacher"))void loadScope();else{clear();signal("Teacher role required to view verified class analytics.");}}
  });
  clear();void auth.authStateReady().then(()=>picker.load()).catch(error=>signal(error.message||"Verified teaching access could not load.",true));
}
