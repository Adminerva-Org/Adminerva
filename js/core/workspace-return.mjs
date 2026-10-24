/** Public pages restore Auth only; protected destinations verify school access. */
import {auth} from "./firebase-core.js?v=1.3.0";
import {cachedWorkspaceDestination} from "./session-destination.mjs?v=1.3.8";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
export function refreshWorkspaceReturn(user=auth.currentUser){
  for(const link of document.querySelectorAll("[data-workspace-return]")){
    const direct=user?cachedWorkspaceDestination(user):"";
    if(direct){
      link.href=direct;
      link.textContent="Return to my workspace →";
      continue;
    }
    const target=new URL("login.html",location.href);
    if(user)target.searchParams.set("continue","1");
    link.href=target.pathname+target.search;
    link.textContent=user?"Continue to my workspace →":"Sign in →";
  }
}
onAuthStateChanged(auth,refreshWorkspaceReturn);
