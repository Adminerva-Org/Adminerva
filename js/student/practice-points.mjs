/** Student submissions, practice progress and isolated code workspaces: practice points. */
import {COURSES} from "./practice-courses.mjs?v=1.3.0";
export const MISSION_IDS=[...new Set(COURSES.flatMap(course=>course.missions.map(mission=>mission.id)))];
const missionIdSet=new Set(MISSION_IDS);
export function practicePoints(ids){
  const missions=[...new Set(Array.isArray(ids)?ids:[])].filter(id=>missionIdSet.has(id));
  return {missions,completed:missions.length,points:missions.length*10,maximum:MISSION_IDS.length*10};
}
export function classStandings(profiles,scores,section){
  const rows=profiles.filter(profile=>profile.section===section&&profile.leaderboardOptIn===true).flatMap(profile=>{
    const score=scores.find(score=>score.studentId===profile.studentId&&score.section===section);
    if(!score||!/^[-\w ]{3,24}$/.test(profile.alias))return [];
    const total=practicePoints(score.verifiedMissionIds);
    if(score.points!==total.points||!score.reviewedBy)return [];
    return [{alias:profile.alias,points:total.points}];
  }).sort((first,second)=>second.points-first.points||first.alias.localeCompare(second.alias));
  return rows.map((row,index)=>({...row,rank:rows.findIndex(other=>other.points===row.points)+1}));
}
