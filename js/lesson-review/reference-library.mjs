/** Explicit reference-library ownership shared by the library and lesson planner. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {staffSessionReady,resolveStaffRole} from "../core/staff-session.mjs?v=1.3.0";
import {collection,doc} from "../core/teaching-firestore.mjs?v=1.3.0";
import {scopedStorage} from "./workspace-model.mjs?v=1.3.0";
let boundUid=null;

export async function resolveReferenceLibrary(){
  await auth.authStateReady();
  await staffSessionReady;
  const user=auth.currentUser;
  if(!user?.uid||!user.emailVerified)throw Error("Sign in with your verified staff account to load references.");
  if(boundUid&&boundUid!==user.uid)throw Error("Account changed. Reload your reference library before continuing.");
  const role=await resolveStaffRole(user);
  if(auth.currentUser?.uid!==user.uid)throw Error("Account changed while loading references. Reload this page.");
  if(role!=="teacher"&&role!=="admin")throw Error("Active staff access is required to open reference folders.");
  boundUid=user.uid;
  return Object.freeze({uid:user.uid,email:user.email,role,
    path:Object.freeze(role==="teacher"?["teacher_materials",user.uid,"reference_folders"]:["reference_folders"]),
    label:role==="teacher"?"Your teacher reference library":"Administrator · shared school reference library",
  });
}

export function assertReferenceOwner(scope){
  if(!scope?.uid||auth.currentUser?.uid!==scope.uid||!auth.currentUser.emailVerified||boundUid!==scope.uid)throw Error("Account changed or references are not ready. Reload the library before continuing.");
}
function checkSegments(segments){
  if(segments.some(segment=>typeof segment!=="string"||!segment||segment.includes("/")||segment.length>1500))throw Error("This reference has an invalid folder or document ID.");
}
export function referenceFolders(scope,...segments){assertReferenceOwner(scope);checkSegments(segments);return collection(db,...scope.path,...segments);}
export function referenceFolder(scope,...segments){assertReferenceOwner(scope);checkSegments(segments);return doc(db,...scope.path,...segments);}
export function normalizeReferenceFolder(id,data){return {...data,id,name:String(data.name||"Untitled folder"),documents:Array.isArray(data.documents)?data.documents:[]};}
export function cacheReferenceFolders(scope,folders){
  assertReferenceOwner(scope);
  // A full device cache must never prevent loading the preserved cloud references.
  try{scopedStorage(localStorage,scope.uid).setItem("Adminerva_library",JSON.stringify(folders));}catch{/* Cloud records remain available when device storage is full. */}
}
