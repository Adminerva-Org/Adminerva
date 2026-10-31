import {app,auth} from "../core/firebase-core.js?v=1.3.0";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {activePlanningSchool} from "./school-planning.mjs?v=4.0.1";

const api=httpsCallable(getFunctions(app,"asia-southeast1"),"schoolAcademics");
export async function loadVerifiedSchoolPlanningOptions(){
  const school=await activePlanningSchool(),uid=auth.currentUser?.uid;
  if(!uid)throw Error("Sign in to a verified school teacher account.");
  const result=(await api({schoolId:school.schoolId,action:"planning_options"})).data;
  if(auth.currentUser?.uid!==uid)throw Error("Account changed. School planning choices were ignored.");
  const current=await activePlanningSchool();
  if(current.schoolId!==school.schoolId)throw Error("School changed. School planning choices were ignored.");
  const clean=list=>Array.isArray(list)?[...new Set(list.filter(value=>typeof value==="string"&&value.trim())
    .map(value=>value.trim()))].sort((a,b)=>a.localeCompare(b)):[];
  return {
    school,
    sections:clean(result.sections),
    subjects:clean(result.subjects),
    schoolYears:clean(result.schoolYears),
    terms:clean(result.terms),
    programs:clean(result.programs),
    offerings:Array.isArray(result.offerings)?result.offerings:[]
  };
}
export async function verifiedPlanningMode(){
  try{return (await activePlanningSchool()).compatibilityMode==="v4_only";}
  catch{return false;}
}
