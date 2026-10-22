/** Shared school choices. Catalog entries never grant roster or account access. */
import {auth,db} from "./firebase-core.js?v=1.3.0";
import {collection,getDocs} from "./teaching-firestore.mjs?v=1.3.0";
import {resolveStaffRole} from "./staff-session.mjs?v=1.3.0";
import {staffSections} from "./staff-role.mjs?v=1.3.0";
const names=values=>[...new Set(values.filter(value=>typeof value==="string"&&value.trim()))].sort((a,b)=>a.localeCompare(b));
export async function loadSchoolOptions({schoolYear="",gradeLevel=""}={}){
  await auth.authStateReady();const user=auth.currentUser,role=await resolveStaffRole(user);
  if(!role)throw Error("Sign in to an active staff account to load school choices.");
  const kinds=["sections","subjects","programs"];
  const results=await Promise.allSettled([...kinds.map(kind=>getDocs(collection(db,"school_catalog",kind,"records"))),getDocs(collection(db,"students"))]);
  if(auth.currentUser?.uid!==user.uid)throw Error("Account changed. Reload school choices.");
  const warnings=[];const catalogs=Object.fromEntries(kinds.map((kind,index)=>{
    if(results[index].status!=="fulfilled"){warnings.push(kind+" catalog unavailable");return [kind,[]];}
    return [kind,results[index].value.docs.map(record=>({id:record.id,...record.data()}))];
  }));
  const active=kind=>catalogs[kind].filter(record=>record.status==="active"&&(!schoolYear||!record.schoolYear||record.schoolYear===schoolYear)&&(!gradeLevel||!record.gradeLevel||record.gradeLevel===gradeLevel));
  const roster=results[3].status==="fulfilled"?results[3].value.docs.map(record=>record.data()):[];
  if(results[3].status!=="fulfilled")warnings.push("student roster unavailable");
  const assigned=role==="admin"?names([...active("sections").map(record=>record.name),...roster.map(record=>record.section)]):names(staffSections(user));
  return {role,sections:assigned,subjects:names(active("subjects").map(record=>record.name)),programs:names(active("programs").map(record=>record.name)),schoolYears:names(Object.values(catalogs).flat().map(record=>record.schoolYear)),catalogs,warnings};
}
export function fillSchoolDatalist(id,values){
  const list=document.getElementById(id);if(!list)return;
  list.replaceChildren(...names(values).map(value=>new Option(value,value)));
}
