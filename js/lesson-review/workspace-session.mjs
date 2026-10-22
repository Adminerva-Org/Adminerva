/** UID-owned planning storage; legacy device caches are never silently imported into another account. */
import {auth} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {doc,collection} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {staffSessionReady,resolveStaffRole} from "../core/staff-session.mjs?v=1.3.0";
import {workspacePath,scopedStorage} from "./workspace-model.mjs?v=1.3.0";
let boundUid=null,invalidated=false;
staffSessionReady.then(({user,role})=>{if(role&&user?.uid===auth.currentUser?.uid&&!invalidated)boundUid=user.uid;});
onAuthStateChanged(auth,user=>{
  if(boundUid&&user?.uid!==boundUid){invalidated=true;location.replace("login.html?error=account-changed");}
});
export function workspaceOnReady(callback) {
  const start=()=>staffSessionReady.then(callback).catch(()=>{});
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",start,{once:true});
  else void start();
}
workspaceOnReady(({user,role})=>{
  if(!role||!/(lesson-planner|schedule|presentation)\.html$/.test(location.pathname)||document.getElementById("av-personal-workspace"))return;
  const label=document.createElement("p");label.id="av-personal-workspace";label.className="av-muted my-3";
  label.textContent="Personal teaching workspace · "+user.email+". Saves stay in your account; authorized administrators can inspect retained teaching records.";
  document.querySelector("h1")?.after(label);
});
export function workspaceUid() {
  const user=auth.currentUser;
  if (invalidated || !user?.uid || !user.emailVerified || user.uid!==boundUid) throw Error("Account changed or not ready. Reload your signed-in staff workspace before continuing.");
  return user.uid;
}
export function ownedDoc(database,kind,...segments) { return doc(database,...workspacePath(workspaceUid(),kind,...segments)); }
export function ownedCollection(database,kind,...segments) { return collection(database,...workspacePath(workspaceUid(),kind,...segments)); }
export function assertWorkspaceAccount(uid) { if (workspaceUid()!==uid) throw Error("Account changed. Reload before continuing."); }
export const lessonStorage={
  getItem:key=>boundUid&&auth.currentUser?.uid===boundUid ? scopedStorage(localStorage,workspaceUid()).getItem(key) : null,
  setItem:(key,value)=>scopedStorage(localStorage,workspaceUid()).setItem(key,value),
  removeItem:key=>scopedStorage(localStorage,workspaceUid()).removeItem(key),
};
export async function requireStaffWorkspace() {
  await auth.authStateReady();
  await staffSessionReady;
  const user=auth.currentUser;
  if (!await resolveStaffRole(user)) throw Error("Active teacher access is required.");
  if(!invalidated&&!boundUid&&user?.uid===auth.currentUser?.uid)boundUid=user.uid;
  if(user?.uid!==auth.currentUser?.uid)throw Error("Account changed. Reload before continuing.");
  return workspaceUid();
}
