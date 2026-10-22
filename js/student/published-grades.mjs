/** Published repository and manual activity grades share the student's feedback feed. */
import {db} from "../core/firebase-core.js?v=1.3.0";
import {collection,getDocs,query,where} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
export async function loadPublishedGrades(studentId){
  const snapshots=await Promise.all(["student_grades","activity_grades"].map(name=>getDocs(query(collection(db,name),where("studentId","==",studentId),where("published","==",true)))));
  const time=grade=>grade.updatedAt?.toMillis?.()||grade.gradedAt?.toMillis?.()||Date.parse(grade.gradedAt||"")||0;
  const rows=snapshots.flatMap(snapshot=>snapshot.docs).map(record=>({id:record.id,...record.data()})).filter(grade=>grade.published===true&&grade.taskId).sort((a,b)=>time(a)-time(b));
  const unique=new Map();for(const grade of rows)unique.set(grade.taskId,grade);
  const docs=[...unique.values()].map(grade=>({id:grade.id,data:()=>typeof grade.gradedAt==="string"?{...grade,gradedAt:{toDate:()=>new Date(grade.gradedAt)}}:grade}));
  return {docs,size:docs.length,empty:docs.length===0,forEach:callback=>docs.forEach(callback)};
}
