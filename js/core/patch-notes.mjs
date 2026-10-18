/** Public curated feature history without private operational details. */
import {loadPublicReleases} from "./patch-history.mjs?v=2026.10.19.1";
const node=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
try{
  const releases=await loadPublicReleases(),selected=new URLSearchParams(location.search).get("version");
  for(const release of releases){
    const card=node("article","");card.className="bg-white border rounded-xl p-5";card.id="release-"+release.version;
    card.append(node("h2",release.version+" · "+release.title),node("p",release.releasedAt),node("p",release.summary));
    const list=node("ul","");list.className="list-disc pl-5 mt-3 space-y-2 text-sm";
    for(const change of release.changes)list.append(node("li",change.type+" — "+change.area+": "+change.text));
    card.append(list);document.getElementById("patchList").append(card);
    if(release.version===selected)card.setAttribute("tabindex","-1");
  }
  document.getElementById("patchStatus").textContent=releases.length?"Every published release also appears in signed-in users' notification inboxes.":"No published release notes yet.";
  if(selected)document.getElementById("release-"+selected)?.scrollIntoView();
}catch(error){document.getElementById("patchStatus").textContent=error.message;}
