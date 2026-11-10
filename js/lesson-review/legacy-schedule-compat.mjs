/** Temporary 2026-2027 timetable compatibility.
 * Keeps the current shared timetable intact while newer schedules store grade metadata.
 */
export const LEGACY_SCHEDULE_YEAR = "2026-2027";
export const LEGACY_SCHEDULE_RETIRE_AT = "2027-05-01T00:00:00+08:00";

export const LEGACY_SECTION_GRADES = Object.freeze({
  "St. Anselm": "Grade 12",
  "St. Philip": "Grade 12",
  "St. Carlo": "Grade 11",
  "St. Isidore": "Grade 11",
});

const normalize=value=>String(value??"").trim();
const same=(a,b)=>normalize(a).toLowerCase()===normalize(b).toLowerCase();

export function isLegacyScheduleYear(schoolYear){
  return normalize(schoolYear)===LEGACY_SCHEDULE_YEAR;
}

export function isLegacySharedScope(scope){
  return Boolean(scope&&isLegacyScheduleYear(scope.year)&&(scope.semester==="S1"||scope.semester==="S2"));
}

export function isLegacyScheduleRetired(now=new Date()){
  const when=now instanceof Date?now:new Date(now);
  return when.getTime()>=new Date(LEGACY_SCHEDULE_RETIRE_AT).getTime();
}

export function legacyScheduleNotice(now=new Date()){
  if(isLegacyScheduleRetired(now)){
    return "Legacy 2026–2027 timetable archived. It remains viewable, but new lesson plans require a timetable for the new school year.";
  }
  const when=now instanceof Date?now:new Date(now);
  if(when.getFullYear()===2027&&when.getMonth()===3){
    return "Legacy timetable retiring April 30, 2027. Keep using it for this school year, then create a new timetable for 2027–2028.";
  }
  return "Shared 2026–2027 legacy timetable. Admin and the original teacher can use the same timetable through April 30, 2027.";
}

export function resolveSectionGrade(section,{rowGrade="",catalogSections=[]}={}){
  const explicit=normalize(rowGrade);
  if(explicit)return explicit;
  const name=normalize(section);
  const catalog=Array.isArray(catalogSections)?catalogSections:[];
  const record=catalog.find(item=>same(item?.name,name)&&normalize(item?.gradeLevel));
  if(record)return normalize(record.gradeLevel);
  const legacy=Object.entries(LEGACY_SECTION_GRADES).find(([sectionName])=>same(sectionName,name));
  return legacy?.[1]||"";
}

export function enrichScheduleRowsWithGrades(rows,catalogSections=[]){
  return (Array.isArray(rows)?rows:[]).map(row=>{
    if(!row||row.type!=="class")return row;
    const copy={...row};
    for(const day of ["mon","tue","wed","thu","fri"]){
      const cell=row[day]||{};
      copy[day]={...cell,grade:resolveSectionGrade(cell.sec,{rowGrade:cell.grade,catalogSections})};
    }
    return copy;
  });
}

export function filterScheduleRowsForLesson(rows,{grade="",subject="",catalogSections=[]}={}){
  const targetGrade=normalize(grade),targetSubject=normalize(subject);
  const days=["mon","tue","wed","thu","fri"];
  return enrichScheduleRowsWithGrades(rows,catalogSections)
    .filter(row=>row?.type==="class")
    .map(row=>{
      const copy={...row};
      for(const day of days){
        const cell=row[day]||{};
        // A lesson prompt only needs meetings for the selected class. Generic
        // timetable events (assembly, breaks, lunch, etc.) are intentionally
        // excluded. A periodic event is retained only when it is attached to
        // the same section + subject cell, because that event replaces or
        // affects an actual lesson meeting.
        if(!cell.sec||!cell.sub){
          copy[day]={sec:"",sub:"",evt:"",grade:""};
          continue;
        }
        const subjectOk=!targetSubject||same(cell.sub,targetSubject);
        const gradeOk=!targetGrade||(cell.grade&&same(cell.grade,targetGrade));
        copy[day]=subjectOk&&gradeOk?{...cell}:{sec:"",sub:"",evt:"",grade:""};
      }
      return copy;
    })
    .filter(row=>days.some(day=>row[day]?.sec&&row[day]?.sub));
}

function formatTime(time24){
  const match=/^(\d{2}):(\d{2})$/.exec(normalize(time24));
  if(!match)return normalize(time24);
  let hour=Number(match[1]);const minute=match[2],suffix=hour>=12?"PM":"AM";
  hour=hour%12||12;
  return `${hour}:${minute} ${suffix}`;
}


const LESSON_DAYS=[
  ["mon","Monday",1],
  ["tue","Tuesday",2],
  ["wed","Wednesday",3],
  ["thu","Thursday",4],
  ["fri","Friday",5],
];

function startDateFromRange(dateRange){
  const text=normalize(dateRange);
  let match=/^([A-Za-z]+)\s+(\d{1,2})-(\d{1,2}),\s*(\d{4})$/.exec(text);
  if(match){
    const parsed=new Date(`${match[1]} ${match[2]}, ${match[4]}`);
    return Number.isNaN(parsed.getTime())?null:parsed;
  }
  match=/^([A-Za-z]+)\s+(\d{1,2})-([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text);
  if(match){
    const parsed=new Date(`${match[1]} ${match[2]}, ${match[5]}`);
    return Number.isNaN(parsed.getTime())?null:parsed;
  }
  // Historical plans may contain a simpler range. Use its first parseable
  // month/day/year without making generation depend on date parsing.
  match=/([A-Za-z]{3,9})\s+(\d{1,2}).*?(\d{4})/.exec(text);
  if(!match)return null;
  const parsed=new Date(`${match[1]} ${match[2]}, ${match[3]}`);
  return Number.isNaN(parsed.getTime())?null:parsed;
}

function lessonDateLabels(dateRange){
  const start=startDateFromRange(dateRange);
  if(!start)return {};
  const monday=new Date(start);
  const weekday=monday.getDay();
  if(weekday!==1)monday.setDate(monday.getDate()+((8-weekday)%7));
  const labels={};
  for(const [key,,offset] of LESSON_DAYS){
    const date=new Date(monday);
    date.setDate(monday.getDate()+offset-1);
    labels[key]=date.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
  }
  return labels;
}

export function scheduleRowsToLessonText(rows,{dateRange=""}={}){
  const dates=lessonDateLabels(dateRange);
  const entries=[];
  for(const row of Array.isArray(rows)?rows:[]){
    if(row?.type!=="class"||!row.startTime||!row.endTime)continue;
    const startMinutes=Number(row.startTime.slice(0,2))*60+Number(row.startTime.slice(3,5));
    const endMinutes=Number(row.endTime.slice(0,2))*60+Number(row.endTime.slice(3,5));
    const duration=Number.isFinite(startMinutes)&&Number.isFinite(endMinutes)&&endMinutes>startMinutes
      ?endMinutes-startMinutes:null;
    for(const [key,day] of LESSON_DAYS){
      const cell=row[key]||{};
      if(!cell.sec||!cell.sub)continue;
      const parts=[
        day,
        dates[key]||"",
        `${formatTime(row.startTime)} - ${formatTime(row.endTime)}`,
        cell.sec,
        cell.sub,
        duration?`${duration} minutes`:""
      ].filter(Boolean);
      if(cell.evt)parts.push("AFFECTING EVENT: "+cell.evt);
      entries.push("- "+parts.join(" | "));
    }
  }
  if(!entries.length)return "";
  return [
    "LESSON MEETING CONTEXT (already filtered by Adminerva for this grade and subject):",
    ...entries,
    "",
    "Use only these meetings for session-to-schedule mapping. Do not infer other timetable periods."
  ].join("\n");
}

export function scheduleRowsToText(rows){
  const dayData={Monday:[],Tuesday:[],Wednesday:[],Thursday:[],Friday:[]};
  const days={mon:"Monday",tue:"Tuesday",wed:"Wednesday",thu:"Thursday",fri:"Friday"};
  for(const row of Array.isArray(rows)?rows:[]){
    if(!row?.startTime)continue;
    const timeBlock=`${formatTime(row.startTime)} - ${formatTime(row.endTime)}`;
    if(row.type==="constant"&&row.eventName){
      for(const day of Object.values(days))dayData[day].push(`${timeBlock}: [EVENT: ${row.eventName}]`);
      continue;
    }
    if(row.type!=="class")continue;
    for(const [key,day] of Object.entries(days)){
      const cell=row[key]||{};
      let text="";
      if(cell.evt)text=`[EVENT: ${cell.evt}]`;
      else if(cell.sec&&cell.sub)text=`${cell.sec} (${cell.sub})${cell.grade?` [${cell.grade}]`:""}`;
      if(text)dayData[day].push(`${timeBlock}: ${text}`);
    }
  }
  let output="TEACHER WEEKLY SCHEDULE:\n\n";
  for(const [day,entries] of Object.entries(dayData)){
    if(!entries.length)continue;
    output+=`[${day}]\n`;
    for(const entry of entries)output+=`- ${entry}\n`;
    output+="\n";
  }
  return output;
}
