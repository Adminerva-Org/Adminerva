/** Public pages restore Auth only; protected destinations verify school access. */
import {auth} from "./firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
export function refreshWorkspaceReturn(user=auth.currentUser){
  for(const link of document.querySelectorAll("[data-workspace-return]")){
    const target=new URL("login.html",location.href);
    if(user){
      target.searchParams.set("continue","1");
      try{const saved=sessionStorage.getItem("Adminerva_last_workspace_"+user.uid);if(saved)target.searchParams.set("returnTo",saved);}catch{}
    }
    link.href=target.pathname+target.search;
    link.textContent=user?"Return to my workspace →":"Sign in →";
  }
}
onAuthStateChanged(auth,refreshWorkspaceReturn);
