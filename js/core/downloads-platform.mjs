/** Platform hints only. A detected device is not evidence that a native app is released. */
export function detectDownloadPlatform(userAgent="",platform="",touchPoints=0){
 const ua=String(userAgent),os=String(platform);
 if(/Android/i.test(ua))return "android";
 if(/iPad|iPhone|iPod/i.test(ua)||(/Mac/i.test(os)&&touchPoints>1))return "ios";
 if(/Windows|Win32|Win64/i.test(ua+" "+os))return "windows";
 if(/Macintosh|Mac OS|MacIntel/i.test(ua+" "+os))return "macos";
 return "other";
}
export function getInstallHint(device,{standalone=false,installPrompt=false}={}){
 if(standalone)return "Adminerva is already open as an installed web experience on this device.";
 if(installPrompt)return "Your browser is offering an Adminerva web-app installation. Use Install web app to continue.";
 if(device==="ios")return "On iPhone or iPad, open Adminerva in Safari and look for Share → Add to Home Screen.";
 if(device==="android")return "On Android, open Adminerva in Chrome and check the menu for Install app or Add to Home screen.";
 if(device==="macos"||device==="windows")return "On your computer, open Adminerva in Chrome or Edge and check for Install app in the browser's menu or address bar.";
 return "Open Adminerva in your browser. If the browser provides an installation or shortcut option, follow its instructions.";
}
