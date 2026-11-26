/**
 * Android preview update discovery only. No APK downloading or installation.
 * The cross-platform version listing is first-party data, never code.
 */
const status=document.getElementById("preview-update-status");
const button=document.getElementById("preview-check-update");
const link=document.getElementById("preview-update-link");
const url="https://adminerva-org.github.io/Adminerva/native-update-channel.json";
const currentVersion="0.1.2";
button?.addEventListener("click",async()=>{
 button.disabled=true;
 status.textContent="Checking Adminerva preview versions…";
 try{
  const response=await fetch(url,{cache:"no-store",redirect:"error"});
  if(!response.ok)throw Error("Listing unavailable");
  const raw=await response.text();
  if(raw.length>4096)throw Error("Listing too large");
  const data=JSON.parse(raw);
  const latest=data?.latestVersion?.android;
  const versionPattern=/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
  if(data.schema!==1||data.channel!=="public-preview"||
     data.installMode!=="manual-preview"||data.officialSignedRelease!==false||
     typeof latest!=="string"||!versionPattern.test(latest))
    throw Error("Unrecognized channel");
  status.textContent="Installed preview: "+currentVersion+
   ". Latest listed: "+latest+
   ". Automatic APK updates are not available for test builds. Do not uninstall an app with unsaved work.";
  link.hidden=false;
 }catch{
  status.textContent="Could not check preview updates. No files were downloaded or installed.";
 }finally{button.disabled=false;}
});
