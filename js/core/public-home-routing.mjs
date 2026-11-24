/** Public root routing: authenticated users belong on their canonical role home, not a second landing page. */
import {auth} from "./firebase-core.js?v=1.3.0";
import {roleHome} from "./session-destination-v4-pilot.mjs?v=20261121-registrar1";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

let routed=false;
function canonicalHomeFor(user){
  if(!user?.uid)return "";
  let role="";
  try{role=localStorage.getItem("Adminerva_Role")||"";}catch{}
  return roleHome(role);
}
onAuthStateChanged(auth,user=>{
  if(routed||!user)return;
  routed=true;
  const home=canonicalHomeFor(user);
  // Cached role is only a navigation hint. Protected destination guards
  // re-verify authority. If there is no usable hint, login resolves access.
  location.replace(home||"login.html?continue=1");
});
