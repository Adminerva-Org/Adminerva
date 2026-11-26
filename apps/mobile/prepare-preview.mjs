/**
 * Generate a reviewed, bundled public-only mobile preview from the canonical
 * root website. No remote server.url, native credentials, or student data.
 * Generated www/ is excluded from source control and must not be distributed.
 */
import {cpSync,copyFileSync,existsSync,mkdirSync,rmSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"../..");
const output=path.join(here,"www");
const folders=["assets","css","js","content","runtime"];
const publicPages=[
 "guest-home.html","guest-playground.html","guest-practice.html",
 "guest-xml-lab.html","guest-settings.html","wiki.html","downloads.html",
 "opportunities.html","pulse.html","patch-notes.html","issues.html"
];
function exclude(p){
 const relative=path.relative(root,p).replaceAll("\\","/");
 return /(^|\/)node_modules(\/|$)/.test(relative)||
  /(^|\/)(?:package|package-lock)\.json$/.test(relative)||
  /\.test\.[cm]?js$/.test(relative)||
  /(^|\/)server\.js$/.test(relative);
}
for(const name of [...folders,...publicPages]){
 if(!existsSync(path.join(root,name)))throw Error("Missing canonical public asset: "+name);
}
if(!existsSync(path.join(here,"preview-index.html")))throw Error("Missing mobile preview entry.");
// Rebuild atomically in a throwaway directory to avoid leaving a partial site.
const staging=path.join(here,"www.build");
rmSync(staging,{recursive:true,force:true});
mkdirSync(staging,{recursive:true});
try{
 for(const folder of folders){
  cpSync(path.join(root,folder),path.join(staging,folder),{
   recursive:true,filter:source=>!exclude(source),force:false,errorOnExist:true
  });
 }
 for(const page of publicPages)copyFileSync(path.join(root,page),path.join(staging,page));
 copyFileSync(path.join(here,"preview-index.html"),path.join(staging,"index.html"));
 copyFileSync(path.join(here,"preview-update.mjs"),path.join(staging,"preview-update.mjs"));
 rmSync(output,{recursive:true,force:true});
 // renameSync is same-device and prevents accidentally syncing an incomplete tree.
 const {renameSync}=await import("node:fs");
 renameSync(staging,output);
 console.log("Generated public-only mobile preview from canonical website assets.");
}catch(error){rmSync(staging,{recursive:true,force:true});throw error;}
