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
// Optional impact text explains how a change affects each role, not merely who owns its page.
// Only these short, public descriptions are copied from the release manifest.
const cleanImpact=value=>{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const cleaned={};
  for(const role of ["all",...roles]){
    const note=text(value[role],350);
    if(note)cleaned[role]=note;
  }
  return Object.keys(cleaned).length?cleaned:null;
};

const cleanReleaseRedactions=value=>{
  if(!Array.isArray(value))return [];
  return value.slice(0,8).flatMap(item=>{
    const x=Number(item?.x),y=Number(item?.y),width=Number(item?.width),height=Number(item?.height);
    if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>100||y+height>100)return [];
    const label=text(item?.label,80);
    return [{x,y,width,height,...(label?{label}:{})}];
  });
};
const cleanReleaseMedia=value=>{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const src=text(value.src,240).replace(/^\.\//,"");
  if(!src||src.includes("..")||!/^assets\/releases\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp|avif)$/i.test(src))return null;
  const alt=text(value.alt,180);
  if(!alt)return null;
  const caption=text(value.caption,240),redactions=cleanReleaseRedactions(value.redactions);
  return {src,alt,...(caption?{caption}:{}),...(redactions.length?{redactions}:{})};
};
const cleanDevelopment=value=>{
  if(!Array.isArray(value))return [];
  return value.slice(0,8).flatMap(item=>{
    const title=text(item?.title,100),summary=text(item?.summary||item?.text,500);
    if(!title||!summary)return [];
    const audience=cleanAudience(item?.audience)||["all"];
    return [{title,summary,audience}];
  });
};
const cleanHighlights=value=>{
  if(!Array.isArray(value))return [];
  return value.slice(0,6).flatMap(item=>{
    const title=text(item?.title,100),summary=text(item?.summary,500);
    if(!title||!summary)return [];
    const audience=cleanAudience(item?.audience)||["all"],
      why=text(item?.why,400),
      media=cleanReleaseMedia(item?.media);
    return [{title,summary,audience,...(why?{why}:{}),...(media?{media}:{})}];
  });
};

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
  const selected=cleanAudience(change?.audience)||inferLegacyChangeAudience(change);
  const impacts=Object.keys(cleanImpact(change?.impact)||{});
  if(selected.includes("all")||impacts.includes("all"))return ["all"];
  return [...new Set([...selected,...impacts])];
}
export function audienceMatches(audience,role){
  if(!role||role==="admin")return true;
  const selected=cleanAudience(audience)||["all"];
  return selected.includes("all")||selected.includes(role);
}
export function releaseForRole(release,role){
  if(!release||!role||role==="admin")return release;
  const changes=(release.changes||[]).filter(change=>audienceMatches(change.audience,role))
    .map(change=>({...change,...(change.impact?{impact:Object.fromEntries(
      Object.entries(change.impact).filter(([audience])=>audience===role||audience==="all")
    )}:{})}));
  const highlights=(release.highlights||[]).filter(highlight=>audienceMatches(highlight.audience,role));
  const development=(release.development||[]).filter(item=>audienceMatches(item.audience,role));
  return changes.length?{...release,changes,...(release.highlights?{highlights}:{}),...(release.development?{development}:{})}:null;
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
      .map(change=>({type:change.type,area:text(change.area,80),text:text(change.text,600),
        audience:changeAudience(change),...(cleanImpact(change.impact)?{impact:cleanImpact(change.impact)}:{})}));
    if(!changes.length||!text(release.title,120)||!text(release.summary,500))return [];
    versions.add(release.version);
    const displayVersion=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.displayVersion||"")?release.displayVersion:null,
      highlights=cleanHighlights(release.highlights),
      development=cleanDevelopment(release.development);
    return [{version:release.version,...(displayVersion?{displayVersion}:{}),releasedAt:release.releasedAt,...(publishedAt?{publishedAt}:{}),title:text(release.title,120),summary:text(release.summary,500),changes,audience:releaseAudience(changes),...(highlights.length?{highlights}:{}),...(development.length?{development}:{})}];
  }).sort((first,second)=>effectiveReleaseTime(second)-effectiveReleaseTime(first)||second.version.localeCompare(first.version,undefined,{numeric:true}));
}
export function releaseNotifications(releases,role=null){
  return releases.flatMap(release=>{
    const projected=releaseForRole(release,role);
    if(!projected)return [];
    const partial=Boolean(role&&role!=="admin"&&projected.changes.length!==(release.changes||[]).length);
    const impact=role&&role!=="admin"?projected.changes.flatMap(change=>
      [change.impact?.[role]||change.impact?.all].filter(Boolean))[0]:null;
    const body=impact?"How this affects you: "+impact:
      partial?"This release includes "+projected.changes.length+" change"+(projected.changes.length===1?"":"s")+" relevant to your "+role+" account. Open What’s New for details."
        : release.summary;
    return [{key:"release:"+release.version,type:"release",title:"Adminerva update · "+release.title,
      body,audience:release.audience||releaseAudience(release.changes||[]),at:effectiveReleaseTime(release),...(Number.isFinite(publicationTime(release.publishedAt))?{publishedAt:release.publishedAt}:{}),target:"patch-notes.html?version="+encodeURIComponent(release.version),saved:false}];
  });
}
export async function loadPublicReleases(fetchImpl=globalThis.fetch){
  const response=await fetchImpl("patch-history.json",{cache:"no-store"});
  if(!response.ok)throw Error("Patch history is temporarily unavailable.");
  return publicReleases(await response.json());
}
