/** Reports reach teaching sections only through a verified enrolled reporter profile. */
import {auth,db} from "./firebase-core.js?v=1.3.0";
import {collection,getDocs,query,where} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {resolveAccountAccess} from "./staff-session.mjs?v=4.0.2";
export async function reportContext(audience,category){
  if(audience!=="teacher"||category==="Bug")return {audience:"admin"};
  const current=auth.currentUser;if(!current?.emailVerified)return {audience:"admin"};
  try{
    const access=await resolveAccountAccess(current);
    if(auth.currentUser?.uid!==current.uid)throw Error("Account changed before reporting.");
    if(access.legacyCompatibilityAllowed===false||access.v4Cutover===true)
      return {audience:"admin"};
    const records=await getDocs(query(collection(db,"students"),where("email","==",current.email.toLowerCase())));
    if(auth.currentUser?.uid!==current.uid)throw Error("Account changed before reporting.");
    if(records.size!==1)return {audience:"admin"};
    return {audience:"teacher",studentId:records.docs[0].id,section:records.docs[0].data().section};
  }catch{return {audience:"admin"};}
}
