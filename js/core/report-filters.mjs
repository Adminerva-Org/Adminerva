// Report filtering for the tracker. These checks improve the interface;
// Firestore security rules remain the authority for which reports may be read.
const priorities={Critical:4,High:3,Medium:2,Low:1};
export function ownsReport(report,uid,email){
  const normalized=String(email||"").toLowerCase();
  return Boolean(uid&&report?.reporterUid===uid) ||
    Boolean(normalized&&report?.reporterEmail &&
      String(report.reporterEmail).toLowerCase()===normalized);
}
export function reportAudience(report){
  return report?.audience==="teacher"?"teacher":"admin";
}
export function visibleReport(report,{role="student",uid="",email=""}={}){
  if(role==="admin")return true;
  if(ownsReport(report,uid,email))return true;
  return role==="teacher"&&reportAudience(report)==="teacher";
}
function timestamp(value){
  if(typeof value?.toMillis==="function")return value.toMillis();
  if(Number.isFinite(value?.seconds))return value.seconds*1000;
  if(value instanceof Date)return value.getTime();
  return 0;
}
export function filterReports(rows,options={}){
  const {role="student",uid="",email="",category="All",status="All",
    audience="All",onlyMine=false,search="",sort="newest"}=options;
  const needle=String(search||"").trim().toLowerCase();
  const matched=(Array.isArray(rows)?rows:[]).filter(report=>{
    if(!visibleReport(report,{role,uid,email}))return false;
    if(onlyMine&&!ownsReport(report,uid,email))return false;
    if(category!=="All"&&report.category!==category)return false;
    if(status!=="All"&&report.status!==status)return false;
    if(audience!=="All"&&reportAudience(report)!==audience)return false;
    if(needle){
      const searchable=[report.title,report.description,report.module,
        report.category,report.status,report.priority,report.id]
        .map(value=>String(value||"").toLowerCase()).join(" ");
      if(!searchable.includes(needle))return false;
    }
    return true;
  });
  return matched.sort((a,b)=>{
    if(sort==="oldest")return timestamp(a.createdAt)-timestamp(b.createdAt);
    if(sort==="priority")return (priorities[b.priority]||0)-(priorities[a.priority]||0)||
      timestamp(b.createdAt)-timestamp(a.createdAt);
    if(sort==="upvotes")return (Array.isArray(b.upvotes)?b.upvotes.length:0)-
      (Array.isArray(a.upvotes)?a.upvotes.length:0)||timestamp(b.createdAt)-timestamp(a.createdAt);
    return timestamp(b.createdAt)-timestamp(a.createdAt);
  });
}
