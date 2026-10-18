/** Safe Android XML subset browser preview and per-account drafts. */
import {auth} from "../core/firebase-core.js";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {compileAndroidLayout,XML_STARTER} from "./xml-layout.mjs?v=2026.10.19.1";
const el=id=>document.getElementById(id);
let user=null,timer;
function render(){
  if(!user)return;
  try{
    const result=compileAndroidLayout(el("xmlEditor").value);
    el("xmlPreview").srcdoc=result.output;el("xmlPreview").style.width=el("xmlWidth").value+"px";
    el("xmlGenerated").value=result.output;el("xmlWarnings").replaceChildren();
    for(const warning of result.warnings){const item=document.createElement("li");item.textContent=warning;el("xmlWarnings").append(item);}
    el("xmlStatus").textContent=result.viewCount+" views translated. Preview is approximate; inspect the warnings.";
  }catch(error){el("xmlStatus").textContent=error.message;el("xmlPreview").removeAttribute("srcdoc");el("xmlGenerated").value="";}
  try{localStorage.setItem("Adminerva_XML_"+user.uid,el("xmlEditor").value);}
  catch{el("xmlStatus").textContent+=" This browser could not save the draft; copy your XML before leaving.";}
}
el("xmlRender").addEventListener("click",render);
el("xmlEditor").addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(render,500);});
el("xmlWidth").addEventListener("change",render);
el("xmlReset").addEventListener("click",()=>{if(confirm("Replace this XML draft with the starter example?")){el("xmlEditor").value=XML_STARTER;render();}});
onAuthStateChanged(auth,current=>{clearTimeout(timer);user=current;el("xmlPreview").removeAttribute("srcdoc");el("xmlGenerated").value="";el("xmlEditor").value="";if(!user)return;try{el("xmlEditor").value=localStorage.getItem("Adminerva_XML_"+user.uid)||XML_STARTER;}catch{el("xmlEditor").value=XML_STARTER;}render();});
