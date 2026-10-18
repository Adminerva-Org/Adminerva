/** Lesson planning, school schedules, references and document export: lesson plan helpers. */
// Preserve school-defined lesson fields and printed headings.
// New document IDs include the school year; existing documents remain untouched.
export function quarterCode(term="") {
  const text=String(term).toUpperCase();
  return text.includes("FOURTH QUARTER")?"Q4":text.includes("THIRD QUARTER")?"Q3":
    text.includes("SECOND QUARTER")?"Q2":"Q1";
}
const safeSegment=value=>String(value||"").replace(/[^a-zA-Z0-9_]/g,"");
export function legacyPlanId({grade,subject,term,week}){
  return safeSegment([grade,subject,quarterCode(term),week].join("_"));
}
export function schoolYearPlanId({grade,subject,term,week,schoolYear}){
  const year=safeSegment(schoolYear);
  if(!year)throw Error("School year must be set before saving a lesson.");
  return safeSegment([grade,subject,"SY"+year,quarterCode(term),week].join("_"));
}
export function expectedSessions(grade){
  return grade==="Grade 11"?["Session 1","Session 2","Session 3","Session 4-6","Session Flex"]:
    grade==="Grade 12"?["Session 1","Session 2","Session 3","Session Flex"]:
      ["Session 1","Session 2","Session Flex"];
}
export function validateGeneratedLesson(plan,grade){
  const problems=[];
  if(!plan||typeof plan!=="object")return ["AI returned no structured plan."];
  const overview=plan.weekly_overview;
  for(const field of ["topic","content_standard","performance_standard","materials"]){
    if(typeof overview?.[field]!=="string"||!overview[field].trim())problems.push("Missing weekly overview: "+field);
  }
  if(!Array.isArray(plan.sessions))return [...problems,"Missing lesson sessions."];
  const required=expectedSessions(grade);
  if(plan.sessions.length!==required.length)problems.push("Expected "+required.length+" sessions, received "+plan.sessions.length+".");
  for(let i=0;i<required.length;i++){
    const session=plan.sessions[i];
    if(!session||typeof session!=="object"){problems.push("Missing "+required[i]);continue;}
    if(String(session.session_name||"").trim().toLowerCase()!==required[i].toLowerCase()){
      problems.push("Expected "+required[i]+" at position "+(i+1)+".");
    }
    if(typeof session.learning_activities!=="string"||!session.learning_activities.trim())
      problems.push("Missing activities for "+required[i]+".");
    if(!required[i].includes("Flex")){
      for(const field of ["competencies","objectives","evaluation","remarks"]){
        if(typeof session[field]!=="string")problems.push("Missing field "+field+" in "+required[i]+".");
      }
    }
  }
  return problems;
}
