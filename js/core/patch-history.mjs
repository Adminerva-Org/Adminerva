/** Shared navigation, account access, reporting and release infrastructure: patch history. */
import {validReleaseId} from "./release-version.mjs?v=1.3.0";
const categories=new Set(["New","Updated","Fixed","Revised","Removed"]);
const text=(value,max)=>typeof value==="string"?value.trim().slice(0,max):"";
const releaseTime=value=>Date.parse(value+"T00:00:00+08:00");
export function publicReleases(data,now=Date.now()){
  const versions=new Set();
  return (Array.isArray(data?.releases)?data.releases:[]).flatMap(release=>{
    if(release?.public!==true||release.status!=="published"||
      !validReleaseId(release.version)||versions.has(release.version)||
      !/^\d{4}-\d{2}-\d{2}$/.test(release.releasedAt)||!Number.isFinite(releaseTime(release.releasedAt))||releaseTime(release.releasedAt)>now)return [];
    const changes=(Array.isArray(release.changes)?release.changes:[]).filter(change=>categories.has(change.type)&&text(change.text,600)).slice(0,30)
      .map(change=>({type:change.type,area:text(change.area,80),text:text(change.text,600)}));
    if(!changes.length||!text(release.title,120)||!text(release.summary,500))return [];
    versions.add(release.version);
    const displayVersion=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.displayVersion||"")?release.displayVersion:null;
    return [{version:release.version,...(displayVersion?{displayVersion}:{}),releasedAt:release.releasedAt,title:text(release.title,120),summary:text(release.summary,500),changes}];
  }).sort((first,second)=>second.releasedAt.localeCompare(first.releasedAt)||second.version.localeCompare(first.version,undefined,{numeric:true}));
}
export function releaseNotifications(releases){
  return releases.map(release=>({key:"release:"+release.version,type:"release",title:"Adminerva update · "+release.title,
    body:release.summary,at:releaseTime(release.releasedAt),target:"patch-notes.html?version="+encodeURIComponent(release.version),saved:false}));
}
export async function loadPublicReleases(fetchImpl=globalThis.fetch){
  const response=await fetchImpl("patch-history.json",{cache:"no-store"});
  if(!response.ok)throw Error("Patch history is temporarily unavailable.");
  return publicReleases(await response.json());
}
