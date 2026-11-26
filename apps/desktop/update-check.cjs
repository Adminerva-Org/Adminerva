"use strict";
const UPDATE_STATUS_URL="https://adminerva-org.github.io/Adminerva/native-update-channel.json";
const DOWNLOAD_CENTER_URL="https://adminerva-org.github.io/Adminerva/downloads.html";
const VERSION=/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
function compareVersions(a,b){
 if(typeof a!=="string"||typeof b!=="string"||!VERSION.test(a)||!VERSION.test(b))throw Error("Invalid version");
 const left=a.split(".").map(Number),right=b.split(".").map(Number);
 for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;
 return 0;
}
function evaluateUpdateManifest(data,{platform,currentVersion}){
 if(!["windows","macos","android"].includes(platform))return {state:"unsupported"};
 if(!data||data.schema!==1||data.channel!=="public-preview"||data.installMode!=="manual-preview"||
  data.officialSignedRelease!==false)throw Error("Untrusted update channel");
 const latestVersion=data.latestVersion?.[platform];
 const delta=compareVersions(latestVersion,currentVersion);
 return {state:delta>0?"newer-preview-listed":delta<0?"ahead-of-listing":"no-newer-version-listed",
  currentVersion,latestVersion,canAutoInstall:false,installMode:"manual-preview"};
}
async function checkUpdateStatus({platform,currentVersion,fetchImpl=fetch,signal}={}){
 if(!["windows","macos","android"].includes(platform))return {state:"unsupported"};
 const response=await fetchImpl(UPDATE_STATUS_URL,{method:"GET",redirect:"error",cache:"no-store",signal});
 if(!response?.ok)throw Error("Update status unavailable");
 const len=Number(response.headers?.get?.("content-length"));
 if(Number.isFinite(len)&&len>4096)throw Error("Update listing too large");
 const raw=await response.text();
 if(raw.length>4096)throw Error("Update listing too large");
 return evaluateUpdateManifest(JSON.parse(raw),{platform,currentVersion});
}
module.exports={UPDATE_STATUS_URL,DOWNLOAD_CENTER_URL,compareVersions,evaluateUpdateManifest,checkUpdateStatus};
