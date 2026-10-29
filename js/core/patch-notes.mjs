import {loadPublicReleases,releaseForRole} from "./patch-history.mjs?v=1.4.19";
import {releasePresentation,releaseMatches} from "./release-version.mjs?v=1.3.0";
import {auth} from "./firebase-core.js?v=1.3.0";
import {resolveStaffRole} from "./staff-session.mjs?v=1.3.0";
import {staffRole} from "./staff-role.mjs?v=1.3.0";
const field=id=>document.getElementById(id);
const node=(tag,text,className="")=>{const element=document.createElement(tag);element.textContent=text;element.className=className;return element;};
let releases=[],viewerRole=null;
const roleLabel=role=>role==="admin"?"Administrator":role==="teacher"?"Teacher":role==="student"?"Student":"Public";
function scopedReleases(){
  const selector=field("patchAudience");
  if(!viewerRole||!selector||selector.value!=="relevant")return releases;
  return releases.map(release=>releaseForRole(release,viewerRole)).filter(Boolean);
}
function render(){
  const scoped=scopedReleases();
  const visible=scoped.filter(release=>releaseMatches(release,{text:field("patchSearch").value,type:field("patchType").value}));
  field("patchList").replaceChildren();
  for(const release of visible){
    const presentation=releasePresentation(release),card=node("article","","av-release-card");
    card.id="release-"+release.version;
    const header=node("header","","av-release-heading");
    const label=node("span",presentation.label,"av-version-label");
    const badge=node("span",presentation.description,"av-release-badge av-release-"+presentation.type);
    header.append(label,badge);
    const date=node("time",new Intl.DateTimeFormat(undefined,{dateStyle:"long",timeZone:"Asia/Manila"}).format(new Date(release.releasedAt+"T12:00:00+08:00")));
    date.dateTime=release.releasedAt;header.append(date);
    card.append(header,node("h2",release.title),node("p",release.summary,"av-release-summary"));
    if(presentation.label!==release.version)card.append(node("p","Original release ID: "+release.version,"av-release-origin"));
    const list=node("ul","","av-release-changes");
    for(const change of release.changes){
      const item=node("li","");item.append(node("span",change.type,"av-change-kind"),node("strong",change.area),node("p",change.text));
      for(const [role,impact] of Object.entries(change.impact||{})){
        item.append(node("p",(role==="all"?"For everyone":role==="student"?"For students":role==="teacher"?"For teachers":"For administrators")+": "+impact,"av-release-impact"));
      }
      list.append(item);
    }
    card.append(list);field("patchList").append(card);
  }
  const relevant=viewerRole&&field("patchAudience")?.value==="relevant";
  field("patchStatus").textContent=relevant
    ? visible.length+" relevant release"+(visible.length===1?"":"s")+" shown for "+roleLabel(viewerRole)+". "+releases.length+" public releases are available."
    : visible.length+" of "+releases.length+" published releases. Drafts and private operational details never appear here.";
  if(!visible.length)field("patchList").append(node("p",relevant?"No published changes matching these filters affect this account role.":"No releases match. Clear the search or choose another release type.","av-empty-state"));
}
for(const id of ["patchSearch","patchType","patchAudience"]){
  const control=field(id);if(control)control.addEventListener(id==="patchSearch"?"input":"change",render);
}
field("patchReset").addEventListener("click",()=>{
  field("patchSearch").value="";field("patchType").value="all";
  if(field("patchAudience"))field("patchAudience").value=viewerRole?"relevant":"all";
  render();
});
try{
  releases=await loadPublicReleases();
  try{
    await auth.authStateReady();
    const user=auth.currentUser;
    if(user){
      await resolveStaffRole(user);
      viewerRole=staffRole(user)||"student";
      const wrapper=field("patchAudienceWrap"),selector=field("patchAudience"),hint=field("patchAudienceHint");
      if(wrapper)wrapper.hidden=false;
      if(selector)selector.value="relevant";
      if(hint)hint.textContent="Signed in as "+roleLabel(viewerRole)+". Relevant changes are shown by default.";
    }
  }catch(error){console.debug("Role-aware release filtering unavailable; showing public history.",error);}
  render();
  const selected=new URLSearchParams(location.search).get("version");
  const scoped=scopedReleases(),release=scoped.find(item=>item.version===selected||item.displayVersion===selected);
  if(release){const card=document.getElementById("release-"+release.version);card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({block:"start"});}
}catch{field("patchStatus").textContent="Release history could not load. Refresh to retry; no account sign-in is required.";}
