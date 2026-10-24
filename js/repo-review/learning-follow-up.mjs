import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {collection,doc,getDocs,query,where,setDoc,updateDoc,serverTimestamp} from "../core/teaching-firestore.mjs?v=1.3.2";
import {resolveStaffRole} from "../core/staff-session.mjs?v=1.3.10";
import {COURSES} from "../student/practice-courses.mjs?v=1.3.0";
const el=id=>document.getElementById(id),id=()=>crypto.randomUUID();
let students=[],packs=[],projects=[],plans=[],mode="";
const section=()=>el("followupSection").value,student=()=>students.find(item=>item.id===el("followupStudent").value);
function card(title,meta,body=""){const article=document.createElement("article");article.className="rounded-xl border border-slate-200 bg-white p-4";const h=document.createElement("strong");h.textContent=title;const m=document.createElement("p");m.className="text-xs text-slate-500 mt-1";m.textContent=meta;article.append(h,m);if(body){const p=document.createElement("p");p.className="text-sm text-slate-700 mt-2 whitespace-pre-wrap";p.textContent=body;article.append(p);}return article;}
function actionButton(label,handler){const button=document.createElement("button");button.type="button";button.className="mt-3 mr-2 text-xs font-bold text-blue-700 underline";button.textContent=label;button.addEventListener("click",handler);return button;}
async function setStatus(kind,item,status){
 const path=kind==="pack"?["practice_packs",item.id]:kind==="project"?["student_projects",item.id]:["improvement_plans",item.studentId,"items",item.id];
 if(!confirm((status==="archived"?"Archive ":"Mark as "+status+" ")+(item.title||"this item")+"?"))return;
 try{await updateDoc(doc(db,...path),{status,updatedAt:serverTimestamp()});await load();}
 catch(error){el("followupStatus").textContent="Update failed: "+error.message;}
}
function render(){
 const sec=section(),person=student();
 const packCards=packs.filter(x=>x.sectionIds?.includes(sec)&&x.status!=="archived").map(x=>{const box=card(x.title,(x.missionRefs?.length||0)+" missions"+(x.dueDate?" · due "+x.dueDate:""),x.notes);box.append(actionButton("Archive",()=>void setStatus("pack",x,"archived")));return box;});
 const projectCards=projects.filter(x=>x.sectionIds?.includes(sec)&&x.status!=="archived").map(x=>{const box=card(x.title,(x.studentIds?.length?x.studentIds.length+" selected learners":"Whole section")+(x.dueDate?" · due "+x.dueDate:""),x.description);box.append(actionButton("Archive",()=>void setStatus("project",x,"archived")));return box;});
 const planCards=plans.filter(x=>x.studentId===person?.id&&x.status!=="closed").map(x=>{const box=card(x.title||"Improvement plan",(x.status==="completed"?"Completed · ":"")+(x.skills||[]).join(" · "),x.goal+"\nNext: "+x.nextAction);if(x.status!=="completed")box.append(actionButton("Mark completed",()=>void setStatus("plan",x,"completed")));box.append(actionButton("Close plan",()=>void setStatus("plan",x,"closed")));return box;});
 el("practicePackList").replaceChildren(...packCards);el("studentProjectList").replaceChildren(...projectCards);el("improvementPlanList").replaceChildren(...planCards);
 for(const target of ["practicePackList","studentProjectList","improvementPlanList"])if(!el(target).children.length)el(target).append(card("Nothing assigned yet","Create an item when follow-up is needed."));
}
function field(label,name,type="text",value=""){const wrap=document.createElement("label");wrap.className="block text-sm font-bold";wrap.textContent=label;const input=document.createElement(type==="textarea"?"textarea":"input");input.name=name;input.className="block w-full border rounded-lg p-2.5 mt-1 font-normal";if(type==="date")input.type="date";else if(type!=="textarea")input.type="text";input.value=value;wrap.append(input);return wrap;}
function open(kind){
 mode=kind;const box=el("followupFields");box.replaceChildren();const sec=section(),person=student();
 if(!sec)return;
 if(kind==="pack"){
   el("followupKindLabel").textContent="Practice pack";el("followupDialogTitle").textContent="Assign Practice Pack";
   box.append(field("Pack title","title"),field("Due date","dueDate","date"),field("Teacher note","notes","textarea"));
   const fs=document.createElement("fieldset");fs.innerHTML='<legend class="font-bold text-sm">Missions</legend>';const list=document.createElement("div");list.className="grid sm:grid-cols-2 gap-2 mt-2 max-h-64 overflow-y-auto";
   for(const course of COURSES)for(const mission of course.missions){const label=document.createElement("label");label.className="text-xs border rounded p-2 flex gap-2";const check=document.createElement("input");check.type="checkbox";check.name="missionRefs";check.value=course.id+":"+mission.id;label.append(check,document.createTextNode(course.name+" · "+mission.title));list.append(label);}fs.append(list);box.append(fs);
 }else if(kind==="project"){
   el("followupKindLabel").textContent="Named project";el("followupDialogTitle").textContent="Assign named project";box.append(field("Project title","title"),field("Due date","dueDate","date"),field("Project brief","description","textarea"));
   const fs=document.createElement("fieldset");fs.innerHTML='<legend class="font-bold text-sm">Assign to learners (leave empty for whole section)</legend>';const list=document.createElement("div");list.className="grid sm:grid-cols-2 gap-2 mt-2";
   for(const s of students.filter(x=>x.section===sec)){const label=document.createElement("label");label.className="text-xs border rounded p-2 flex gap-2";const check=document.createElement("input");check.type="checkbox";check.name="studentIds";check.value=s.id;label.append(check,document.createTextNode(s.name||s.id));list.append(label);}fs.append(list);box.append(fs);
 }else{
   if(!person)return alert("Choose a student first.");el("followupKindLabel").textContent="Improvement plan";el("followupDialogTitle").textContent="Plan follow-up for "+(person.name||person.id);
   box.append(field("Plan title","title"),field("Skills to strengthen (comma-separated)","skills"),field("Goal","goal","textarea"),field("Next teacher/student action","nextAction","textarea"));
   const pack=document.createElement("label");pack.className="block text-sm font-bold";pack.innerHTML='<span>Optional Practice Pack</span>';const select=document.createElement("select");select.name="packId";select.className="block w-full border rounded-lg p-2 mt-1 font-normal";select.append(new Option("None",""),...packs.filter(x=>x.sectionIds?.includes(sec)).map(x=>new Option(x.title,x.id)));pack.append(select);box.append(pack);
 }
 el("followupFormStatus").textContent="";el("followupDialog").showModal();
}
async function save(event){
 event.preventDefault();const data=new FormData(event.currentTarget),sec=section(),user=auth.currentUser,now=serverTimestamp();if(!user||!sec)return;
 try{
  if(mode==="pack"){const missionRefs=data.getAll("missionRefs");if(!data.get("title")||!missionRefs.length)throw Error("Add a title and at least one mission.");const key=id();await setDoc(doc(db,"practice_packs",key),{id:key,ownerUid:user.uid,title:String(data.get("title")).trim(),sectionIds:[sec],missionRefs,notes:String(data.get("notes")||"").trim(),dueDate:String(data.get("dueDate")||""),status:"active",createdAt:now,updatedAt:now});}
  else if(mode==="project"){if(!data.get("title"))throw Error("Add a project title.");const key=id(),studentIds=data.getAll("studentIds");await setDoc(doc(db,"student_projects",key),{id:key,ownerUid:user.uid,title:String(data.get("title")).trim(),sectionIds:[sec],studentIds,wholeSection:studentIds.length===0,description:String(data.get("description")||"").trim(),dueDate:String(data.get("dueDate")||""),status:"active",createdAt:now,updatedAt:now});}
  else{const person=student();if(!person||!data.get("goal")||!data.get("nextAction"))throw Error("Choose a learner and add a goal plus next action.");const key=id();await setDoc(doc(db,"improvement_plans",person.id,"items",key),{id:key,studentId:person.id,section:person.section,ownerUid:user.uid,title:String(data.get("title")||"Improvement plan").trim(),skills:String(data.get("skills")||"").split(",").map(x=>x.trim()).filter(Boolean).slice(0,12),goal:String(data.get("goal")).trim(),nextAction:String(data.get("nextAction")).trim(),packId:String(data.get("packId")||""),status:"active",createdAt:now,updatedAt:now});}
  el("followupDialog").close();await load();
 }catch(error){el("followupFormStatus").textContent=error.message;}
}
async function load(){
 const sec=section(),person=student(),user=auth.currentUser;if(!user)return;
 const [studentSnap,packSnap,projectSnap]=await Promise.all([
  getDocs(collection(db,"students")),
  getDocs(query(collection(db,"practice_packs"),where("sectionIds","array-contains",sec))),
  getDocs(query(collection(db,"student_projects"),where("sectionIds","array-contains",sec)))
 ]);
 students=studentSnap.docs.map(r=>({id:r.id,...r.data()})).filter(item=>item.section===sec);packs=packSnap.docs.map(r=>({id:r.id,...r.data()}));projects=projectSnap.docs.map(r=>({id:r.id,...r.data()}));
 const prior=person?.id||el("followupStudent").value;el("followupStudent").replaceChildren(new Option("Choose learner",""),...students.map(s=>new Option(s.name||s.id,s.id)));if(prior&&students.some(s=>s.id===prior))el("followupStudent").value=prior;
 const selected=student();plans=selected?(await getDocs(collection(db,"improvement_plans",selected.id,"items"))).docs.map(r=>({id:r.id,...r.data()})):[];
 render();el("followupStatus").textContent=students.length+" learners · "+packs.length+" packs · "+projects.length+" named projects.";
}
await auth.authStateReady();const user=auth.currentUser,role=await resolveStaffRole(user);if(!role)location.replace("login.html");
let sections=[];try{const roster=await getDocs(collection(db,"students"));sections=[...new Set(roster.docs.map(record=>record.data().section).filter(Boolean))].sort();}catch{}
el("followupSection").replaceChildren(...sections.map(value=>new Option(value,value)));if(sections.length)await load();else el("followupStatus").textContent="No assigned sections.";
el("followupSection").addEventListener("change",()=>void load());el("followupStudent").addEventListener("change",()=>void load());
el("newPracticePack").onclick=()=>open("pack");el("newStudentProject").onclick=()=>open("project");el("newImprovementPlan").onclick=()=>open("plan");
el("followupClose").onclick=el("followupCancel").onclick=()=>el("followupDialog").close();el("followupForm").addEventListener("submit",save);
