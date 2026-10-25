import {loadPublicReleases} from "./patch-history.mjs?v=1.4.0";
import {releasePresentation,releaseMatches} from "./release-version.mjs?v=1.3.0";
const field=id=>document.getElementById(id);
const node=(tag,text,className="")=>{const element=document.createElement(tag);element.textContent=text;element.className=className;return element;};
let releases=[];
function render(){
  const visible=releases.filter(release=>releaseMatches(release,{text:field("patchSearch").value,type:field("patchType").value}));
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
      const item=node("li","");item.append(node("span",change.type,"av-change-kind"),node("strong",change.area),node("p",change.text));list.append(item);
    }
    card.append(list);field("patchList").append(card);
  }
  field("patchStatus").textContent=visible.length+" of "+releases.length+" published releases. Drafts and private operational details never appear here.";
  if(!visible.length)field("patchList").append(node("p","No releases match. Clear the search or choose another release type.","av-empty-state"));
}
for(const id of ["patchSearch","patchType"])field(id).addEventListener(id==="patchSearch"?"input":"change",render);
field("patchReset").addEventListener("click",()=>{field("patchSearch").value="";field("patchType").value="all";render();});
try{
  releases=await loadPublicReleases();render();
  const selected=new URLSearchParams(location.search).get("version");
  const release=releases.find(item=>item.version===selected||item.displayVersion===selected);
  if(release){const card=document.getElementById("release-"+release.version);card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({block:"start"});}
}catch{field("patchStatus").textContent="Release history could not load. Refresh to retry; no account sign-in is required.";}
