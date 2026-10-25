/** Shared navigation, account access, reporting and release infrastructure: patch history. */
import {validReleaseId} from "./release-version.mjs?v=1.3.0";
const categories=new Set(["New","Updated","Fixed","Revised","Removed"]);
const roles=["admin","teacher","student"];
const text=(value,max)=>typeof value==="string"?value.trim().slice(0,max):"";
const releaseTime=value=>Date.parse(value+"T00:00:00+08:00");
// A calendar release date does not establish a publication time. Only accept
// an explicit ISO timestamp with a timezone as evidence of that precision.
const publicationTime=value=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
const effectiveReleaseTime=release=>Number.isFinite(publicationTime(release.publishedAt))?publicationTime(release.publishedAt):releaseTime(release.releasedAt);
const cleanAudience=value=>{
  if(!Array.isArray(value))return null;
  const selected=[...new Set(value.map(item=>String(item||"").toLowerCase().trim()).filter(item=>item==="all"||roles.includes(item)))];
  if(selected.includes("all"))return ["all"];
  return selected.length?selected:null;
};
const withAdmin=audience=>audience.includes("all")?["all"]:[...new Set(["admin",...audience])];

export function inferLegacyChangeAudience(change){
  const area=text(change?.area,80).toLowerCase();
  // Historical release entries predate audience metadata. Prefer conservative
  // exact module signals over body keywords so references to students inside
  // teacher workflows do not accidentally become student announcements.
  const adminOnly=/teacher accounts|school administration|reports and administration|user directory|monitoring maintenance|guest access and school management|^school setup$|release reliability|evidence and release reliability/.test(area);
  if(adminOnly)return ["admin"];

  const shared=/^navigation$|navigation and settings|navigation and layout|mobile navigation|shared header|responsive interface|adminerva branding|home and sign-in|home and preferences|sign-in and public guides|help and release history|help and preferences|help and updates|help and tutorials|loading and navigation|^loading$|website updates|website refresh|interface cleanup|shared-browser accounts|notification preferences|notification center|push delivery|web app installation|notification delivery|notification reliability|workspace return|update notification times|account safeguards/.test(area);
  if(shared)return ["all"];

  const teacherStudent=/returned-submission notifications|evidence resubmission alerts|grade visibility alerts|report and reply alerts|notification destinations|assessment assignment alerts|student resubmission alert|return for student changes|submitted evidence return action|project checkpoint|checkpoint validation|checkpoint selection|student evidence|evidence editing/.test(area);
  if(teacherStudent)return withAdmin(["teacher","student"]);

  const student=/student notification inbox|student device notifications|student access|student workspaces|practice lab|practice progress|practice exact-answer prompts|code playground|xml layout lab|project hub|leaderboards and guests|learning tools|scored session transfers/.test(area);
  if(student)return withAdmin(["student"]);

  const teacher=/review|gradebook|lesson|teacher|grading|submission inbox|repofetch|reference|slide editor|evidence|assessment studio|educator hub|analytics|auto.?checker|commit review|teaching|export permissions|export feedback|school ai|individual verification|review workspace|checkpoint approval/.test(area);
  if(teacher)return withAdmin(["teacher"]);

  // Unknown historical areas remain visible to everyone rather than silently
  // hiding a release that may have affected them.
  return ["all"];
}

export function changeAudience(change){
  return cleanAudience(change?.audience)||inferLegacyChangeAudience(change);
}
export function audienceMatches(audience,role){
  if(!role||role==="admin")return true;
  const selected=cleanAudience(audience)||["all"];
  return selected.includes("all")||selected.includes(role);
}
export function releaseForRole(release,role){
  if(!release||!role||role==="admin")return release;
  const changes=(release.changes||[]).filter(change=>audienceMatches(change.audience,role));
  return changes.length?{...release,changes}:null;
}
const releaseAudience=changes=>{
  const all=changes.flatMap(change=>changeAudience(change));
  return all.includes("all")?["all"]:[...new Set(all)];
};

export function publicReleases(data,now=Date.now()){
  const versions=new Set();
  return (Array.isArray(data?.releases)?data.releases:[]).flatMap(release=>{
    if(release?.public!==true||release.status!=="published"||
      !validReleaseId(release.version)||versions.has(release.version)||
      !/^\d{4}-\d{2}-\d{2}$/.test(release.releasedAt)||!Number.isFinite(releaseTime(release.releasedAt))||releaseTime(release.releasedAt)>now)return [];
    const publishedAt=Number.isFinite(publicationTime(release.publishedAt))?release.publishedAt:null;
    if(publishedAt&&publicationTime(publishedAt)>now)return [];
    const changes=(Array.isArray(release.changes)?release.changes:[]).filter(change=>categories.has(change.type)&&text(change.text,600)).slice(0,30)
      .map(change=>({type:change.type,area:text(change.area,80),text:text(change.text,600),audience:changeAudience(change)}));
    if(!changes.length||!text(release.title,120)||!text(release.summary,500))return [];
    versions.add(release.version);
    const displayVersion=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.displayVersion||"")?release.displayVersion:null;
    return [{version:release.version,...(displayVersion?{displayVersion}:{}),releasedAt:release.releasedAt,...(publishedAt?{publishedAt}:{}),title:text(release.title,120),summary:text(release.summary,500),changes,audience:releaseAudience(changes)}];
  }).sort((first,second)=>effectiveReleaseTime(second)-effectiveReleaseTime(first)||second.version.localeCompare(first.version,undefined,{numeric:true}));
}
export function releaseNotifications(releases){
  return releases.map(release=>({key:"release:"+release.version,type:"release",title:"Adminerva update · "+release.title,
    body:release.summary,audience:release.audience||releaseAudience(release.changes||[]),at:effectiveReleaseTime(release),...(Number.isFinite(publicationTime(release.publishedAt))?{publishedAt:release.publishedAt}:{}),target:"patch-notes.html?version="+encodeURIComponent(release.version),saved:false}));
}
export async function loadPublicReleases(fetchImpl=globalThis.fetch){
  const response=await fetchImpl("patch-history.json",{cache:"no-store"});
  if(!response.ok)throw Error("Patch history is temporarily unavailable.");
  return publicReleases(await response.json());
}
