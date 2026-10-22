import {auth} from "./firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
function apply(){try{document.documentElement.dataset.motion=auth.currentUser?localStorage.getItem("Adminerva_motion_"+auth.currentUser.uid)||"system":"system";}catch{document.documentElement.dataset.motion="system";}}
onAuthStateChanged(auth,apply);
window.addEventListener("storage",event=>{if(event.key?.startsWith("Adminerva_motion_"))apply();});
