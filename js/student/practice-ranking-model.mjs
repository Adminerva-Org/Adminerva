import {COURSES,hashSeed} from "./practice-courses.mjs?v=1.3.0";
export const PRACTICE_MAXIMUM=COURSES.reduce((total,course)=>total+course.missions.length,0);
export function practiceAlias(studentId){return "Learner-"+(hashSeed(studentId)>>>0).toString(36).toUpperCase().padStart(7,"0").slice(-7);}
export function completionTotal(records){
  return COURSES.reduce((total,course)=>{const source=records.find(record=>record.courseId===course.id);const allowed=new Set(course.missions.map(mission=>mission.id));return total+new Set((Array.isArray(source?.completed)?source.completed:[]).filter(id=>allowed.has(id))).size;},0);
}
export function automaticStandings(records,currentStudentId){
  const rows=records.filter(record=>/^Learner-[A-Z0-9]{7}$/.test(record.alias)&&Number.isInteger(record.completedCount)&&record.completedCount>=0&&record.completedCount<=PRACTICE_MAXIMUM&&record.points===record.completedCount*10)
    .sort((first,second)=>second.points-first.points||first.alias.localeCompare(second.alias));
  return rows.map((row,index)=>({alias:row.alias,points:row.points,completedCount:row.completedCount,rank:rows.findIndex(other=>other.points===row.points)+1,isCurrent:row.studentId===currentStudentId}));
}
