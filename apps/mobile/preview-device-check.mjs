/**
 * Public-only QA network check for Android and iOS Simulator previews.
 * Does not collect identifiers, permissions, accounts or exam activity.
 */
const button=document.getElementById("preview-check-connection");
const status=document.getElementById("preview-connection-status");
const url="https://adminerva-org.github.io/Adminerva/native-update-channel.json";
function report(message){if(status)status.textContent=message;}
window.addEventListener("offline",()=>report("Offline. Reconnect to use public web tools."));
button?.addEventListener("click",async()=>{
 button.disabled=true;
 if(navigator.onLine===false){
  report("Offline. The app shell is available, but online tools need a connection.");
  button.disabled=false;
  return;
 }
 report("Checking Adminerva's public connection…");
 try{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),6500);
  let response;
  try{
   response=await fetch(url,{
    method:"GET",cache:"no-store",redirect:"error",signal:controller.signal
   });
  }finally{clearTimeout(timer);}
  if(!response.ok)throw Error("Connection unavailable");
  const body=await response.text();
  if(body.length>4096)throw Error("Unexpected response");
  const data=JSON.parse(body);
  if(data.schema!==1||data.channel!=="public-preview"||
     data.installMode!=="manual-preview")throw Error("Unexpected channel");
  report("Connected to Adminerva's public service. Private school access is not enabled in this preview.");
 }catch{
  report("Could not reach Adminerva. Check your connection; no project data was changed.");
 }finally{button.disabled=false;}
});
