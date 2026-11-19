import {readFileSync,readdirSync,statSync,existsSync} from "node:fs";
import {resolve,relative,dirname,extname} from "node:path";

const ROOT=resolve(".");
const EXCLUDED_DIRS=new Set([".git","node_modules"]);
const stripUrl=value=>String(value||"").split("#")[0].split("?")[0];
const isExternal=value=>/^(?:[a-z]+:)?\/\//i.test(value)||/^(?:data|mailto|tel):/i.test(value)||value.startsWith("#");

function walk(dir){
  const files=[];
  for(const name of readdirSync(dir)){
    if(EXCLUDED_DIRS.has(name)) continue;
    const full=resolve(dir,name);
    const stat=statSync(full);
    if(stat.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}
function attrs(raw){
  const out={};
  const re=/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
  let m;
  while((m=re.exec(raw))) out[m[1].toLowerCase()]=m[2]??m[3]??m[4]??"";
  return out;
}
function visibleText(html){
  return html.replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/\s+/g," ").trim();
}
function localTarget(page,raw){
  const value=stripUrl(raw);
  if(!value||isExternal(value)||value.startsWith("/")) return null;
  return resolve(dirname(page),value);
}
function includesRef(code,value){
  if(!value) return false;
  return code.includes(value)||code.includes("#"+value)||code.includes("."+value);
}
function genericClickDelegation(code){
  return /addEventListener\s*\(\s*["']click["']/.test(code)&&/(closest|matches|dataset|getAttribute|querySelector)/.test(code);
}
function appendModuleGraph(file,seen=new Set()){
  const absolute=resolve(file);
  if(seen.has(absolute)||!existsSync(absolute)) return "";
  seen.add(absolute);
  let source;
  try{source=readFileSync(absolute,"utf8");}catch{return "";}
  let combined=source;
  const specs=[];
  for(const match of source.matchAll(/\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)) specs.push(match[1]);
  for(const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.push(match[1]);
  for(const spec of specs){
    if(!spec.startsWith(".")) continue;
    const target=resolve(dirname(absolute),stripUrl(spec));
    const candidates=[target,target+".js",target+".mjs",resolve(target,"index.js"),resolve(target,"index.mjs")];
    const found=candidates.find(existsSync);
    if(found) combined+="\n"+appendModuleGraph(found,seen);
  }
  return combined;
}

const pages=walk(ROOT).filter(file=>extname(file)===".html");
const findings=[];
for(const page of pages){
  const html=readFileSync(page,"utf8");
  const pageRel=relative(ROOT,page).replaceAll("\\","/");
  const scriptSources=[...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(match=>match[1]);
  let code=[...html.matchAll(/<script\b(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).join("\n");
  for(const source of scriptSources){
    const target=localTarget(page,source);
    if(!target) continue;
    if(!existsSync(target)){
      findings.push({severity:"broken",kind:"missing-script",page:pageRel,control:source,detail:"Local script target does not exist"});
      continue;
    }
    code+="\n"+appendModuleGraph(target);
  }

  for(const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)){
    const href=match[1],target=localTarget(page,href);
    if(target&&stripUrl(href).endsWith(".html")&&!existsSync(target))
      findings.push({severity:"broken",kind:"missing-route",page:pageRel,control:href,detail:"Linked HTML page does not exist"});
  }

  const controlRe=/<(button|a|input)\b([^>]*?)(?:>([\s\S]*?)<\/\1>|\s*\/?>)/gi;
  let match;
  while((match=controlRe.exec(html))){
    const tag=match[1].toLowerCase(), a=attrs(match[2]||""), body=match[3]||"";
    const type=(a.type||"").toLowerCase();
    if(tag==="button"&&String(a.class||"").split(/\s+/).some(name=>name.startsWith("ql-"))) continue;
    if(tag==="input"&&!["button","submit","reset","image"].includes(type)) continue;
    const text=(a["aria-label"]||a.title||a.value||visibleText(body)||"(unlabeled)").slice(0,90);
    const id=a.id||"";
    const href=a.href??null;
    const onclick=a.onclick||"";
    const disabled=("disabled" in a)||a["aria-disabled"]==="true";
    const dataEntries=Object.entries(a).filter(([key])=>key.startsWith("data-"));
    const signature=id||text;

    const placeholderHref=tag==="a"&&(href===""||href==="#"||/^javascript:(?:void\(0\)|;?)$/i.test(href||""));
    const placeholderHandler=/(?:coming soon|not implemented|todo|under development)/i.test(onclick+" "+text);
    const referenced=includesRef(code,id)||dataEntries.some(([key,value])=>includesRef(code,key)||includesRef(code,value));
    const delegated=genericClickDelegation(code)&&dataEntries.length>0;

    if(placeholderHandler){
      findings.push({severity:"planned",kind:"explicit-placeholder",page:pageRel,control:signature,detail:"Control explicitly indicates unfinished behavior"});
      continue;
    }
    if(placeholderHref&&!onclick&&!referenced&&!delegated){
      findings.push({severity:"broken",kind:"placeholder-link",page:pageRel,control:signature,detail:"Placeholder link has no detectable click wiring"});
      continue;
    }
    if(disabled&&!referenced&&!onclick){
      findings.push({severity:"planned",kind:"static-disabled",page:pageRel,control:signature,detail:"Control is statically disabled and has no detectable runtime enablement"});
      continue;
    }
    if(tag==="button"&&!disabled&&!onclick&&type!=="submit"&&type!=="reset"&&!(type===""&&a.value)&&!referenced&&!delegated){
      findings.push({severity:"review",kind:"unmatched-button",page:pageRel,control:signature,detail:"No direct ID/data reference found in this page's loaded scripts"});
    }
  }
}

const counts=findings.reduce((acc,item)=>(acc[item.severity]=(acc[item.severity]||0)+1,acc),{});
console.log("Adminerva interactive-control audit");
console.log(JSON.stringify({pages:pages.length,counts},null,2));
for(const severity of ["broken","planned","review"]){
  const group=findings.filter(item=>item.severity===severity);
  if(!group.length) continue;
  console.log("\n"+severity.toUpperCase()+" ("+group.length+")");
  for(const item of group) console.log("- "+item.page+" :: "+item.kind+" :: "+item.control+" :: "+item.detail);
}
// This audit is intentionally advisory. High-confidence findings are surfaced in logs
// without turning an exploratory sitewide inventory into a release blocker.
