import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {collection,getDocs,query,where} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {COURSES} from "./practice-courses.mjs?v=1.3.0";
const missionLabels=new Map(COURSES.flatMap(course=>course.missions.map(mission=>[course.id+":"+mission.id,course.name+" · "+mission.title])));
const dash=document.getElementById("studentFollowupContainer"),packsMount=document.getElementById("practiceAssignedPacks");
function card(title,meta,body="",href=""){const box=document.createElement(href?"a":"article");if(href)box.href=href;box.className="block rounded-lg border border-slate-200 bg-slate-50 p-3";const h=document.createElement("strong");h.textContent=title;const m=document.createElement("p");m.className="text-xs text-slate-500 mt-1";m.textContent=meta;box.append(h,m);if(body){const p=document.createElement("p");p.className="text-sm text-slate-700 mt-2 whitespace-pre-wrap";p.textContent=body;box.append(p);}return box;}
function packCard(pack){
 const box=card(pack.title,(pack.missionRefs?.length||0)+" assigned missions"+(pack.dueDate?" · due "+pack.dueDate:""),pack.notes||"");
 const missions=document.createElement("div");missions.className="flex flex-wrap gap-2 mt-2";
 for(const ref of (pack.missionRefs||[]).slice(0,8)){const [course,mission]=String(ref).split(":");const a=document.createElement("a");a.href="student-practice.html?course="+encodeURIComponent(course)+"&mission="+encodeURIComponent(mission);a.className="text-xs font-bold text-blue-700 underline";a.textContent=missionLabels.get(String(ref))||course.toUpperCase()+" · "+mission;a.addEventListener("click",e=>e.stopPropagation());missions.append(a);}box.append(missions);return box;
}
async function load(){
 await auth.authStateReady();const user=auth.currentUser;if(!user?.email)return;
 try{
  const roster=await getDocs(query(collection(db,"students"),where("email","==",user.email.toLowerCase()))),student=roster.docs.find(r=>!["archived","suspended"].includes(r.data().status))||roster.docs[0];
  if(!student)return;
  const profile={id:student.id,...student.data()},section=profile.section;
  const [packSnap,wholeProjectSnap,personalProjectSnap,planSnap]=await Promise.all([
   getDocs(query(collection(db,"practice_packs"),where("sectionIds","array-contains",section))),
   getDocs(query(collection(db,"student_projects"),where("sectionIds","array-contains",section),where("wholeSection","==",true))),
   getDocs(query(collection(db,"student_projects"),where("studentIds","array-contains",profile.id))),
   getDocs(collection(db,"improvement_plans",profile.id,"items"))
  ]);
  const packs=packSnap.docs.map(r=>({id:r.id,...r.data()})).filter(x=>x.status==="active");
  const projectDocs=new Map([...wholeProjectSnap.docs,...personalProjectSnap.docs].map(record=>[record.id,record]));
  const projects=[...projectDocs.values()].map(r=>({id:r.id,...r.data()})).filter(x=>x.status==="active");
  const plans=planSnap.docs.map(r=>({id:r.id,...r.data()})).filter(x=>x.status==="active");
  if(dash){
    dash.replaceChildren();
    for(const pack of packs)dash.append(packCard(pack));
    for(const project of projects)dash.append(card(project.title,"Named project"+(project.dueDate?" · due "+project.dueDate:""),project.description,"student-playground.html?project="+encodeURIComponent(project.id)));
    for(const plan of plans)dash.append(card(plan.title||"Improvement plan",(plan.skills||[]).join(" · "),plan.goal+"\nNext: "+plan.nextAction));
    if(!dash.children.length)dash.append(card("No follow-up assigned","Your teacher has not assigned an additional pack, project or improvement plan."));
  }
  if(packsMount){
    packsMount.hidden=!packs.length;packsMount.replaceChildren();
    if(packs.length){const panel=document.createElement("div");panel.className="rounded-xl border border-blue-200 bg-blue-50 p-4";const h=document.createElement("h2");h.className="font-extrabold text-blue-950";h.textContent="Assigned Practice Packs";panel.append(h);const list=document.createElement("div");list.className="grid md:grid-cols-2 gap-3 mt-3";for(const pack of packs)list.append(packCard(pack));panel.append(list);packsMount.append(panel);}
  }
 }catch(error){if(dash)dash.textContent="Learning follow-up is temporarily unavailable.";if(packsMount)packsMount.hidden=true;console.warn("Student follow-up unavailable",error);}
}
void load();
