const semantic=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const dated=/^\d{4}\.\d{2}\.\d{2}\.\d{1,3}$/;
export function validReleaseId(value) {
  return typeof value==="string" && (semantic.test(value)||dated.test(value));
}
export function releasePresentation(release) {
  const version=semantic.test(release.displayVersion||"")?release.displayVersion:release.version;
  if(!semantic.test(version||""))return {label:version,type:"archive",description:"Earlier dated release"};
  const [major,minor,patch]=version.split(".").map(Number);
  const type=patch>0?"patch":minor>0?"minor":"major";
  return {label:"v"+version,type,description:({major:"Major release · substantial changes",minor:"Feature update · new capabilities",patch:"Patch · focused fixes"})[type]};
}
export function releaseMatches(release,{text="",type="all"}={}) {
  if(type!=="all"&&releasePresentation(release).type!==type)return false;
  const searchable=[release.version,release.displayVersion,release.title,release.summary,...release.changes.flatMap(change=>[change.type,change.area,change.text])].join(" ").toLowerCase();
  return String(text).toLowerCase().trim().split(/\s+/).every(term=>searchable.includes(term));
}
