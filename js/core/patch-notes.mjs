import {loadPublicReleases,releaseForRole} from "./patch-history.mjs?v=1.4.20";
import {releasePresentation,releaseMatches} from "./release-version.mjs?v=1.3.0";
import {auth} from "./firebase-core.js?v=1.3.0";
import {resolveStaffRole} from "./staff-session.mjs?v=1.3.0";
import {staffRole} from "./staff-role.mjs?v=1.3.0";
const field=id=>document.getElementById(id);
const node=(tag,text,className="")=>{const element=document.createElement(tag);element.textContent=text;element.className=className;return element;};
let releases=[],viewerRole=null;
const roleLabel=role=>role==="admin"?"Administrator":role==="teacher"?"Teacher":role==="student"?"Student":"Public";
const normalizeVersion=value=>String(value||"").replace(/^v/i,"");

let mediaDialog=null;
function openReleaseMedia(media){
  if(!media?.src)return;
  if(!mediaDialog){
    mediaDialog=document.createElement("dialog");
    mediaDialog.className="av-release-media-dialog";
    const shell=node("div","","av-release-media-dialog-shell"),
      close=node("button","Close","av-release-media-close"),
      image=document.createElement("img"),
      caption=node("p","","av-release-media-dialog-caption");
    close.type="button";
    close.addEventListener("click",()=>mediaDialog.close());
    mediaDialog.addEventListener("click",event=>{if(event.target===mediaDialog)mediaDialog.close();});
    shell.append(close,image,caption);mediaDialog.append(shell);document.body.append(mediaDialog);
    mediaDialog._image=image;mediaDialog._caption=caption;
  }
  mediaDialog._image.src=media.src;
  mediaDialog._image.alt=media.alt||"";
  mediaDialog._caption.textContent=media.caption||"";
  mediaDialog._caption.hidden=!media.caption;
  if(typeof mediaDialog.showModal==="function")mediaDialog.showModal();
}

function releaseTopics(release){
  const highlights=Array.isArray(release.highlights)?release.highlights:[];
  if(!highlights.length)return null;
  const topics=node("div","","av-release-topics");
  topics.setAttribute("aria-label","Key areas in this release");
  for(const highlight of highlights.slice(0,4))topics.append(node("span",highlight.title,"av-release-topic"));
  return topics;
}

function releaseHighlights(release){
  const highlights=Array.isArray(release.highlights)?release.highlights:[];
  if(!highlights.length)return null;
  const section=node("section","","av-release-highlights");
  section.setAttribute("aria-label","Release highlights");
  section.append(node("h3","Release highlights","av-release-section-title"));
  let mediaIndex=0;
  for(const highlight of highlights){
    const hasMedia=Boolean(highlight.media?.src);
    const item=node("article","",hasMedia?"av-release-highlight av-release-highlight-has-media":"av-release-highlight av-release-highlight-text-only"),
      copy=node("div","","av-release-highlight-copy");
    if(hasMedia&&mediaIndex%2===1)item.classList.add("av-release-highlight-media-first");
    if(hasMedia)mediaIndex++;
    copy.append(node("span","Highlight","av-release-highlight-label"),node("h4",highlight.title),node("p",highlight.summary));
    if(highlight.why)copy.append(node("p","Why this matters: "+highlight.why,"av-release-highlight-why"));
    item.append(copy);
    if(hasMedia){
      const figure=node("figure","","av-release-media"),button=document.createElement("button"),image=document.createElement("img");
      button.type="button";
      button.className="av-release-media-button";
      button.setAttribute("aria-label","Enlarge screenshot: "+(highlight.media.alt||highlight.title));
      image.src=highlight.media.src;image.alt=highlight.media.alt||"";image.loading="lazy";image.decoding="async";
      button.append(image);button.addEventListener("click",()=>openReleaseMedia(highlight.media));figure.append(button);
      if(highlight.media.caption)figure.append(node("figcaption",highlight.media.caption));
      item.append(figure);
    }
    section.append(item);
  }
  return section;
}

const developerChange=change=>/^Developer focus\s*·/i.test(change.area||"");
function changeGroup(change){
  const value=((change.area||"")+" "+(change.text||"")).toLowerCase();
  if(/personalized|assessment|practical exam/.test(value))return "Assessments & personalization";
  if(/review|grade|evaluation|evaluator|verification|frozen submission/.test(value))return "Review, grade & evaluation";
  if(/studio|runtime evidence/.test(value))return "Adminerva Studio";
  if(/academic|course offering|people & access|school administration|navigation|workspace/.test(value))return "School administration & navigation";
  return "Other improvements";
}
function renderChange(change){
  const item=node("li","");
  item.append(node("span",change.type,"av-change-kind"),node("strong",change.area),node("p",change.text));
  for(const [role,impact] of Object.entries(change.impact||{})){
    item.append(node("p",(role==="all"?"For everyone":role==="student"?"For students":role==="teacher"?"For teachers":"For administrators")+": "+impact,"av-release-impact"));
  }
  return item;
}
function releaseChangelog(release){
  const released=(release.changes||[]).filter(change=>!developerChange(change));
  if(!released.length)return null;
  const details=node("details","","av-release-changelog");
  const summary=node("summary","","av-release-changelog-summary");
  summary.append(node("span","Full changelog","av-release-changelog-label"),node("span",released.length+" released change"+(released.length===1?"":"s"),"av-release-changelog-count"));
  details.append(summary);
  const body=node("div","","av-release-changelog-body"),groups=new Map();
  for(const change of released){
    const group=changeGroup(change);
    if(!groups.has(group))groups.set(group,[]);
    groups.get(group).push(change);
  }
  for(const [label,changes] of groups){
    const section=node("section","","av-release-change-group");
    section.append(node("h4",label+" · "+changes.length,"av-release-change-group-title"));
    const list=node("ul","","av-release-changes");
    for(const change of changes)list.append(renderChange(change));
    section.append(list);body.append(section);
  }
  details.append(body);
  return details;
}
function developerFocus(release){
  const changes=(release.changes||[]).filter(developerChange);
  if(!changes.length)return null;
  const section=node("aside","","av-release-development");
  section.append(node("span","Not included in this release","av-release-development-label"),node("h3","Still in development","av-release-development-title"));
  const intro=node("p","These areas have active foundations or previews, but they are not being presented as completed 3.3.0 features.","av-release-development-intro");
  section.append(intro);
  const list=node("ul","","av-release-development-list");
  for(const change of changes){
    const title=(change.area||"").replace(/^Developer focus\s*·\s*/i,"");
    const item=node("li","");
    item.append(node("strong",title),node("p",change.text));
    list.append(item);
  }
  section.append(list);
  return section;
}

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
    const topics=releaseTopics(release);if(topics)card.append(topics);
    if(normalizeVersion(presentation.label)!==normalizeVersion(release.version))card.append(node("p","Original release ID: "+release.version,"av-release-origin"));
    const highlights=releaseHighlights(release);if(highlights)card.append(highlights);
    const changelog=releaseChangelog(release);if(changelog)card.append(changelog);
    const development=developerFocus(release);if(development)card.append(development);
    field("patchList").append(card);
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
