import {db,auth} from "../core/firebase-core.js?v=1.3.0";
import {collection,getDocs,query,where} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {ensureStudentAccessProjection} from "./student-access.mjs?v=1.3.6";
import {loadPublishedGrades} from "./published-grades.mjs?v=1.3.0";

const asDate=value=>{
  if(!value)return null;
  if(value instanceof Date)return value;
  if(typeof value?.toDate==="function")return value.toDate();
  const parsed=new Date(value);return Number.isNaN(parsed.getTime())?null:parsed;
};
const millis=value=>asDate(value)?.getTime()||0;
const isStudio=data=>data?.assessmentFormat==="studio_code"||
  data?.assessmentMode==="personalized"||data?.personalizedTask?.enabled===true||
  /studio|practical/i.test(String(data?.type||""));

function assignmentForSection(docSnap,section){
  const data=docSnap.data();if(data.published===false)return null;
  let assigned=false,due=null,noDeadline=false,posted=asDate(data.createdAt)||new Date();
  if(Array.isArray(data.deployments)){
    const deployment=data.deployments.find(item=>item.section===section);
    if(deployment){
      assigned=true;noDeadline=deployment.deadlineEnabled===false;
      if(deployment.deadline&&!noDeadline)due=asDate(deployment.deadline);
      if(deployment.postDate)posted=asDate(deployment.postDate)||posted;
    }
  }else if(Array.isArray(data.targetSections)&&data.targetSections.includes(section)){
    assigned=true;if(data.dueDate)due=asDate(data.dueDate);
  }
  if(!assigned)return null;
  return {
    taskId:docSnap.id,title:data.title||"Assignment",description:data.description||data.taskContext||"",
    postedAt:posted?.getTime()||Date.now(),dueAt:due?.getTime()||null,
    windowStatus:due&&due.getTime()<Date.now()?"closed":"open",
    submissionSource:isStudio(data)?"studio":"github",legacy:true,noDeadline,
    raw:data
  };
}
function submissionRank(row){
  const status=String(row?.status||"");
  if(status==="reopened")return 5;if(status==="approved"||status==="reviewed")return 4;
  if(status==="submitted")return 3;if(row?.submittedAt)return 2;return 1;
}
function mergeStatus(map,taskId,row){
  if(!taskId)return;
  const prior=map.get(taskId);
  if(!prior||submissionRank(row)>=submissionRank(prior))map.set(taskId,row);
}
function gradeTime(data){return millis(data.updatedAt)||millis(data.gradedAt)||Date.parse(data.gradedAt||"")||0;}

export async function loadLegacyProgrammingClassroom(){
  const user=auth.currentUser;
  if(!user?.email)return {classes:[],tasks:[],statuses:new Map(),grades:new Map(),legacy:true};
  const targetEmail=(localStorage.getItem("Adminerva_Impersonate")||user.email).toLowerCase();
  const profilesSnap=await getDocs(query(collection(db,"students"),where("email","==",targetEmail)));
  const profiles=profilesSnap.docs.map(doc=>({id:doc.id,...doc.data()})).filter(item=>item.section);
  if(!profiles.length)return {classes:[],tasks:[],statuses:new Map(),grades:new Map(),legacy:true};

  await ensureStudentAccessProjection().catch(()=>{});
  const taskMap=new Map(),statuses=new Map(),grades=new Map();
  for(const profile of profiles){
    const [sectionSnap,targetSnap,submissionSnap,evidenceSnap,studioSnap,gradeSnap]=await Promise.all([
      getDocs(query(collection(db,"assessments"),where("sectionIds","array-contains",profile.section)).catch?null:null).catch(()=>null),
      getDocs(query(collection(db,"assessments"),where("targetSections","array-contains",profile.section))).catch(()=>null),
      getDocs(query(collection(db,"student_submissions"),where("studentId","==",profile.id))).catch(()=>null),
      getDocs(query(collection(db,"assessment_evidence"),where("studentId","==",profile.id))).catch(()=>null),
      getDocs(query(collection(db,"studio_submissions"),where("studentId","==",profile.id))).catch(()=>null),
      loadPublishedGrades(profile.id).catch(()=>null)
    ]);
    for(const snap of [sectionSnap,targetSnap]){
      for(const docSnap of snap?.docs||[]){
        const task=assignmentForSection(docSnap,profile.section);if(task)taskMap.set(task.taskId,task);
      }
    }
    for(const record of submissionSnap?.docs||[]){
      const data=record.data();mergeStatus(statuses,data.assessmentId,{...data,submitted:Boolean(data.submittedAt)||data.status==="submitted"});
    }
    for(const record of evidenceSnap?.docs||[]){
      const data=record.data();mergeStatus(statuses,data.assessmentId,{...data,submitted:!["withdrawn","not_submitted"].includes(String(data.status||""))});
    }
    for(const record of studioSnap?.docs||[]){
      const data=record.data();mergeStatus(statuses,data.assessmentId,{...data,submitted:Boolean(data.submittedAt)||["submitted","reviewed","approved"].includes(String(data.status||""))});
    }
    gradeSnap?.forEach(record=>{
      const data=record.data();if(data.published!==true||!data.taskId)return;
      const mapped={
        taskId:data.taskId,awarded:Number(data.score??data.awarded??0),
        total:Number(data.maxScore??data.total??taskMap.get(data.taskId)?.raw?.maxScore??0),
        feedback:data.feedback||"",publishedAt:gradeTime(data)
      };
      const prior=grades.get(data.taskId);if(!prior||mapped.publishedAt>=prior.publishedAt)grades.set(data.taskId,mapped);
    });
  }
  const sections=[...new Set(profiles.map(item=>item.section).filter(Boolean))];
  return {
    legacy:true,classes:[{
      subjectId:"computer-programming",subject:"Computer Programming",
      offeringId:"",section:sections.join(" / "),term:"",year:""
    }],
    tasks:[...taskMap.values()].sort((a,b)=>(b.postedAt||0)-(a.postedAt||0)),
    statuses,grades,posts:[]
  };
}