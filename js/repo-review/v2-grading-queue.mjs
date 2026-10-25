/** One class/assessment/target context for repository and offline activity review. */
import {resolveStaffRole,resolveStaffSubjects} from "../core/staff-session.mjs?v=1.3.10";
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,getDocs,query,where} from "../core/teaching-firestore.mjs?v=1.3.0";
import {parseRepository} from "./services/assessment-evidence.mjs?v=1.3.0";
import {mountTeachingWorkspace} from "./teaching-workspace.mjs?v=1.4.15";
const el=id=>document.getElementById(id),parameters=new URLSearchParams(location.search);
let requestedPanel=parameters.get("view")||"";
const workspace=mountTeachingWorkspace(el("teachingWorkspace"));
let roster=[],assessments=[],targets=[],activeTask=null,loadId=0,actorUid="",subjectFocus=[],records={evidence:new Map(),grades:new Map(),activities:new Map(),receipts:[]},sourceWarnings=[];
function status(text){el("v2QueueStatus").textContent=text;}
function options(select,items,placeholder){select.replaceChildren(new Option(placeholder,""),...items.map(item=>new Option(item.label,item.value)));}
function repoFor(student){try{return parseRepository(student.repoUrl);}catch{return null;}}
function matchesSection(task,section){return task.deployments?.some(item=>item.section===section)||task.sectionIds?.includes(section)||task.targetSections?.includes(section)||task.section===section;}
function title(student){return student.name||[student.firstName,student.lastName].filter(Boolean).join(" ")||student.id;}
function buildTargets(){
 const students=roster.filter(student=>student.section===el("v2SectionSelect").value).sort((a,b)=>title(a).localeCompare(title(b)));
 if(el("reviewTargetMode").value==="individual")return students.map(student=>({id:"student:"+student.id,label:title(student),students:[student],repository:repoFor(student)}));
 const grouped=new Map();
 for(const student of students){
  const repo=repoFor(student),actual=student.groupId??student.groupName??student.group??student.team;
  const group=typeof actual==="string"||typeof actual==="number"?String(actual).trim():actual?.name||actual?.id||"";
  const key=repo?"repository:"+repo.url.toLowerCase():group?"group:"+group:"student:"+student.id;
  if(!grouped.has(key))grouped.set(key,{id:key,label:repo?repo.owner+"/"+repo.repo:group?"Group "+group:title(student),students:[],repository:repo});
  grouped.get(key).students.push(student);
 }
 return [...grouped.values()];
}
async function readActivityGrades(task){
 const [modern,legacy]=await Promise.all([getDocs(query(collection(db,"activity_grades"),where("taskId","==",task.id))),getDocs(query(collection(db,"activity_grades"),where("activity","==",String(task.title||task.id).slice(0,300))))]);
 const rows=new Map();for(const item of legacy.docs)if(!item.data().taskId||item.data().taskId===task.id)rows.set(item.id,item);for(const item of modern.docs)rows.set(item.id,item);return {docs:[...rows.values()]};
}
async function initialize(user){
 const generation=++loadId;actorUid=user?.uid||"";
 if(!user||!await resolveStaffRole(user)){status("An authorized staff account is required to open the teaching workspace.");return;}
 try{
  status("Loading your assigned classes and assessments…");
  const [students,tasks]=await Promise.all([getDocs(collection(db,"students")),getDocs(collection(db,"assessments"))]);
  if(generation!==loadId||auth.currentUser?.uid!==user.uid)return;
  roster=students.docs.map(item=>({id:item.id,...item.data()}));assessments=tasks.docs.map(item=>({id:item.id,...item.data()}));subjectFocus=await resolveStaffSubjects(user);
  const sections=[...new Set(roster.map(student=>student.section).filter(value=>typeof value==="string"&&value.trim()))].sort();
  options(el("v2SectionSelect"),sections.map(value=>({value,label:value})),"Choose class");
  el("v2SectionSelect").value=sections.includes(parameters.get("section"))?parameters.get("section"):sections[0]||"";
  el("reviewTargetMode").value="group";
  await updateAssessments();
 }catch(error){if(generation===loadId)status("Classes could not load. Check your connection and select Refresh. "+error.message);}
}
async function updateAssessments(){
 const previous=el("v2AssessmentSelect").value,section=el("v2SectionSelect").value,subjectSelect=el("v2SubjectSelect");
 const sectionTasks=assessments.filter(task=>matchesSection(task,section));
 const subjects=[...new Set(sectionTasks.map(task=>String(task.subject||"").trim()).filter(Boolean))].sort();
 const allowed=subjectFocus.length?subjects.filter(subject=>subjectFocus.includes(subject)):subjects;
 const priorSubject=subjectSelect.value;
 subjectSelect.replaceChildren(new Option("All subjects","all"),...allowed.map(subject=>new Option(subject,subject)));
 const requestedSubject=parameters.get("subject");
 subjectSelect.value=requestedSubject&&allowed.includes(requestedSubject)?requestedSubject:allowed.includes(priorSubject)?priorSubject:"all";
 const chosen=subjectSelect.value;
 const tasks=sectionTasks.filter(task=>(!subjectFocus.length||!task.subject||subjectFocus.includes(task.subject))&&(chosen==="all"||task.subject===chosen));
 options(el("v2AssessmentSelect"),tasks.map(task=>({value:task.id,label:(task.subject?task.subject+" · ":"")+(task.title||task.id)})),"Choose assessment");
 el("v2AssessmentSelect").value=tasks.some(task=>task.id===parameters.get("assessment"))?parameters.get("assessment"):tasks.some(task=>task.id===previous)?previous:tasks[0]?.id||"";
 await renderQueue();
}
async function renderQueue({preserve=true}={}){
 const generation=++loadId,assessmentId=el("v2AssessmentSelect").value,section=el("v2SectionSelect").value,previous=preserve?el("reviewTargetSelect").value:"";
 activeTask=assessments.find(task=>task.id===assessmentId);
 if(!activeTask||!section){el("v2Queue").replaceChildren();options(el("reviewTargetSelect"),[],"Choose an assessment first");workspace.clear();status("Choose a class and an assessment. All assessment versions are supported.");return;}
 el("v2RefreshQueue").disabled=true;status("Loading saved evidence, receipts and grades…");
 try{
  const sources=await Promise.allSettled([
   getDocs(query(collection(db,"assessment_evidence"),where("assessmentId","==",assessmentId))),
   getDocs(query(collection(db,"student_grades"),where("taskId","==",assessmentId))),
   readActivityGrades(activeTask),
   getDocs(query(collection(db,"student_submissions"),where("assessmentId","==",assessmentId)))
  ]);
  if(generation!==loadId||auth.currentUser?.uid!==actorUid)return;
  const names=["evidence","grades","activities","receipts"];sourceWarnings=names.filter((name,index)=>sources[index].status!=="fulfilled");
  const data=sources.map(result=>result.status==="fulfilled"?result.value.docs.map(item=>({id:item.id,...item.data()})):[]);
  records={evidence:new Map(data[0].map(item=>[item.studentId,item])),grades:new Map(data[1].map(item=>[item.studentId,item])),activities:new Map(data[2].map(item=>[item.studentId,item])),receipts:data[3]};
  targets=buildTargets();options(el("reviewTargetSelect"),targets.map(target=>({value:target.id,label:target.label+(el("reviewTargetMode").value==="group"?" · "+target.students.length+" learner"+(target.students.length===1?"":"s"):"")})),"Choose review target");
  const requested=targets.find(target=>target.students.some(student=>student.id===parameters.get("student")));
  el("reviewTargetSelect").value=targets.some(target=>target.id===previous)?previous:requested?.id||targets[0]?.id||"";
  drawCards();activateTarget();
  status(targets.length+" repository/group target"+(targets.length===1?"":"s")+" · "+roster.filter(student=>student.section===section).length+" learners"+(sourceWarnings.length?". Some saved statuses could not load: "+sourceWarnings.join(", ")+". Missing statuses are not zero grades.":". Choose a repository/group, then select the learner inside the workspace."));
 }catch(error){if(generation===loadId)status("Review queue could not load. Retry with Refresh. "+error.message);}
 finally{el("v2RefreshQueue").disabled=false;}
}
function drawCards(){
 const container=el("v2Queue");container.replaceChildren();
 for(const target of targets){
  const card=document.createElement("button");card.type="button";card.className="av-review-target-card";card.setAttribute("aria-pressed",String(target.id===el("reviewTargetSelect").value));
  const heading=document.createElement("strong"),detail=document.createElement("span"),state=document.createElement("span");
  heading.textContent=target.label;detail.textContent=target.students.map(title).join(" · ");
  const published=target.students.filter(student=>records.grades.get(student.id)?.published||records.activities.get(student.id)?.published).length;
  state.textContent=published+" of "+target.students.length+" published · "+(target.repository?"Repository review":"Manual activity available");card.append(heading,detail,state);
  card.onclick=()=>{if(!workspace.canLeave())return;el("reviewTargetSelect").value=target.id;activateTarget();drawCards();};container.append(card);
 }
 if(!targets.length){const empty=document.createElement("p");empty.textContent="No students are enrolled in this class. Ask your administrator to check the roster and teaching assignments.";container.append(empty);}
}
function activateTarget(){
 const target=targets.find(item=>item.id===el("reviewTargetSelect").value);if(!target){workspace.clear();return;}
 workspace.setContext({assessment:activeTask,target,students:target.students,repository:target.repository,evidence:records.evidence,grades:records.grades,activities:records.activities,receipts:records.receipts,sourceWarnings,mode:el("reviewTargetMode").value,requestedStudent:parameters.get("student")});
 if(requestedPanel==="grade"){requestedPanel="";void workspace.show("grade");}
 window.dispatchEvent(new CustomEvent("adminerva:review-target-selected",{detail:{assessment:activeTask,students:target.students,repository:target.repository,mode:el("reviewTargetMode").value}}));
 const url=new URL(location.href);url.searchParams.delete("view");url.searchParams.set("section",el("v2SectionSelect").value);if(el("v2SubjectSelect").value!=="all")url.searchParams.set("subject",el("v2SubjectSelect").value);else url.searchParams.delete("subject");url.searchParams.set("assessment",activeTask.id);url.searchParams.set("mode","group");url.searchParams.set("student",target.students[0].id);history.replaceState(null,"",url);
}
let previousSection="",previousAssessment="",previousTarget="";
function rememberSelectors(){previousSection=el("v2SectionSelect").value;previousAssessment=el("v2AssessmentSelect").value;previousTarget=el("reviewTargetSelect").value;}
for(const id of ["v2SectionSelect","v2SubjectSelect","v2AssessmentSelect","reviewTargetSelect"])el(id).addEventListener("focus",rememberSelectors);
el("v2SectionSelect").onchange=()=>{if(!workspace.canLeave()){el("v2SectionSelect").value=previousSection;return;}void updateAssessments();};
el("v2SubjectSelect").onchange=()=>{if(!workspace.canLeave())return;void updateAssessments();};
el("v2AssessmentSelect").onchange=()=>{if(!workspace.canLeave()){el("v2AssessmentSelect").value=previousAssessment;return;}void renderQueue({preserve:false});};
el("reviewTargetSelect").onchange=()=>{if(!workspace.canLeave()){el("reviewTargetSelect").value=previousTarget;return;}activateTarget();drawCards();};
el("v2RefreshQueue").onclick=()=>void(!roster.length||!assessments.length?initialize(auth.currentUser):renderQueue());
window.addEventListener("adminerva:manual-grade-saved",()=>void renderQueue());
window.addEventListener("adminerva:activity-grade-saved",()=>void renderQueue());
onAuthStateChanged(auth,user=>{workspace.clear({force:true});void initialize(user);});
