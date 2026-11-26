/**
 * Align disposable Android native versionName/versionCode with the canonical
 * mobile package. This only edits the GENERATED Capacitor Android project.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const here=new URL(".",import.meta.url);
const pkg=JSON.parse(readFileSync(new URL("package.json",here),"utf8"));
const pattern=/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;
if(!pattern.test(pkg.version))throw Error("Invalid mobile native version.");
const [major,minor,patch]=pkg.version.split(".").map(Number);
const versionCode=major*10000+minor*100+patch;
if(!Number.isSafeInteger(versionCode)||versionCode<=0)throw Error("Invalid Android versionCode.");
const file=fileURLToPath(new URL("android/app/build.gradle",here));
let gradle=readFileSync(file,"utf8");
if(!/versionCode\s+\d+/.test(gradle)||!/versionName\s+["'][^"']+["']/.test(gradle))
 throw Error("Expected generated Capacitor Android version metadata missing.");
gradle=gradle.replace(/versionCode\s+\d+/,"versionCode "+versionCode)
 .replace(/versionName\s+["'][^"']+["']/,'versionName "'+pkg.version+'"');
writeFileSync(file,gradle);
console.log("Aligned Android preview package version: "+pkg.version+" ("+versionCode+")");
