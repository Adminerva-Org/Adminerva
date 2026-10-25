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
  return enrichScheduleRowsWithGrades(rows,catalogSections).map(row=>{
    if(!row||row.type!=="class")return row;
    const copy={...row};
    for(const day of ["mon","tue","wed","thu","fri"]){
      const cell=row[day]||{};
      if(cell.evt){copy[day]={...cell};continue;}
      if(!cell.sec||!cell.sub){copy[day]={sec:"",sub:"",evt:"",grade:""};continue;}
      const subjectOk=!targetSubject||same(cell.sub,targetSubject);
      const gradeOk=!targetGrade||(cell.grade&&same(cell.grade,targetGrade));
      copy[day]=subjectOk&&gradeOk?{...cell}:{sec:"",sub:"",evt:"",grade:""};
    }
    return copy;
  });
}

function formatTime(time24){
  const match=/^(\d{2}):(\d{2})$/.exec(normalize(time24));
  if(!match)return normalize(time24);
  let hour=Number(match[1]);const minute=match[2],suffix=hour>=12?"PM":"AM";
  hour=hour%12||12;
  return `${hour}:${minute} ${suffix}`;
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
