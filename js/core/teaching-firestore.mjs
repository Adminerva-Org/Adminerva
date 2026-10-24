/** Assigned-section query adapter; Firestore rules remain the authorization boundary. */
export * from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import * as sdk from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {auth,db} from "./firebase-core.js?v=1.3.0";
import {resolveStaffRole} from "./staff-session.mjs?v=1.3.0";
import {staffRole,staffSections} from "./staff-role.mjs?v=1.3.0";
const descriptors=new WeakMap();
const sectional=new Set(["teaching_roster","student_grades","grades","activity_grades","assessment_evidence","student_submissions","commit_reclaims","practice_profiles","practice_scores","practice_boards","practice_rankings","practice_class_season_rankings","grading_alerts","issues"]);
const privateKinds=new Set(["repobank","group_repo_cache","github_stats_cache","system","templates","reference_folders"]);
let pending=null;
const emptySnapshot=docs=>({docs,size:docs.length,empty:docs.length===0,forEach:callback=>docs.forEach(callback)});
async function actor(){
  await auth.authStateReady();const user=auth.currentUser;
  if(!pending||pending.uid!==user?.uid){
    const operation=resolveStaffRole(user).then(role=>({uid:user?.uid,role,sections:staffSections(user)}));
    pending={uid:user?.uid,operation};operation.finally(()=>{if(pending?.operation===operation)pending=null;}).catch(()=>{});
  }
  const current=await pending.operation;
  if(auth.currentUser?.uid!==current.uid)throw Error("Account changed. Reload the teaching workspace.");
  if(current.role==="teacher"&&typeof document!=="undefined"&&!document.getElementById("teaching-access-notice")){
    const notice=document.createElement("p");notice.id="teaching-access-notice";notice.className="av-scope-notice";
    notice.textContent=current.sections.length?"Assigned-section access is enforced. Older shared records may need administrator access review; missing records are not zero scores.":"No teaching sections are assigned. Ask an administrator to use Manage Teachers; private planning remains available.";
    document.querySelector("main")?.prepend(notice);
  }
  return current;
}
function materialPath(path,current){
  const parts=path.split("/");
  return current.role==="teacher"&&privateKinds.has(parts[0])?["teacher_materials",current.uid,...parts].join("/"):path;
}
function mappedDoc(reference,current){
  let path=materialPath(reference.path,current);
  if(current.role==="teacher"&&path.startsWith("students/"))path=path.replace(/^students\//,"teaching_roster/");
  return path===reference.path?reference:sdk.doc(reference.firestore,path);
}
function writeDoc(reference,current){const path=materialPath(reference.path,current);return path===reference.path?reference:sdk.doc(reference.firestore,path);}
export function collection(...args){const reference=sdk.collection(...args);descriptors.set(reference,{reference,path:reference.path,constraints:[]});return reference;}
export function query(base,...constraints){
  const reference=sdk.query(base,...constraints),prior=descriptors.get(base)||(base.type==="collection"?{reference:base,path:base.path,constraints:[]}:null);
  if(prior)descriptors.set(reference,{...prior,constraints:prior.constraints.concat(constraints)});
  return reference;
}
export function doc(...args){return sdk.doc(...args);}
async function plans(source,current=null){
  if(!current)current=await actor();
  if(current.role!=="teacher")return [source];
  const descriptor=descriptors.get(source)||(source.type==="collection"?{reference:source,path:source.path,constraints:[]}:null);
  if(!descriptor){if(source.type==="document")return [mappedDoc(source,current)];throw Error("This teaching query has no section descriptor. Reload the page.");}
  let {path,constraints}=descriptor;
  if(privateKinds.has(path.split("/")[0]))return [sdk.query(sdk.collection(db,materialPath(path,current)),...constraints)];
  if(path==="students")path="teaching_roster";
  const base=sdk.collection(db,path);
  if(sectional.has(path))return current.sections.map(section=>sdk.query(base,...constraints,sdk.where("section","==",section)));
  if(path==="assessments"||path==="assessment_private")return [sdk.query(base,...constraints,sdk.where("ownerUid","==",current.uid)),
    ...current.sections.map(section=>sdk.query(base,...constraints,sdk.where("sectionIds","array-contains",section)))];
  if(/^practice_verified_progress\/[^/]+\/courses$/.test(path))return current.sections.map(section=>sdk.query(base,...constraints,sdk.where("sections","array-contains",section)));
  return [source];
}
async function readMany(source,reader){
  const current=await actor(),uid=current.uid;
  const requests=await plans(source,current),rows=new Map();
  for(let offset=0;offset<requests.length;offset+=4){
    const snapshots=await Promise.all(requests.slice(offset,offset+4).map(reader));
    if(auth.currentUser?.uid!==uid)throw Error("Account changed. Discard the previous teaching results.");
    snapshots.forEach(snapshot=>snapshot.docs.forEach(record=>rows.set(record.ref.path,record)));
  }
  return emptySnapshot([...rows.values()]);
}
export const getDocs=source=>readMany(source,sdk.getDocs);
export const getDocsFromServer=source=>readMany(source,sdk.getDocsFromServer);
async function readDocument(reference,reader){
  const current=await actor(),result=await reader(mappedDoc(reference,current));
  if(auth.currentUser?.uid!==current.uid)throw Error("Account changed. Discard the previous teaching record.");
  return result;
}
export async function getDoc(reference){return readDocument(reference,sdk.getDoc);}
export async function getDocFromServer(reference){return readDocument(reference,sdk.getDocFromServer);}
export function onSnapshot(source,...args){
  let active=true,stops=[];const callbackIndex=args.findIndex(value=>typeof value==="function"),callback=args[callbackIndex],failure=args[callbackIndex+1];
  void actor().then(async current=>{
    if(!active)return;
    const uid=current.uid,requests=await plans(source,current);
    if(!active||auth.currentUser?.uid!==uid)return;
    if(source.type==="document"){const bound=[...args];bound[callbackIndex]=snapshot=>{if(active&&auth.currentUser?.uid===uid)callback(snapshot);};stops.push(sdk.onSnapshot(requests[0],...bound));return;}
    if(!requests.length){callback(emptySnapshot([]));return;}
    const received=new Map();
    requests.forEach((request,index)=>stops.push(sdk.onSnapshot(request,snapshot=>{
      if(!active||auth.currentUser?.uid!==uid)return;received.set(index,snapshot.docs);
      if(received.size!==requests.length)return;
      const rows=new Map();received.forEach(records=>records.forEach(record=>rows.set(record.ref.path,record)));callback(emptySnapshot([...rows.values()]));
    },error=>{if(active&&typeof failure==="function")failure(error);})));
  }).catch(error=>{if(active&&typeof failure==="function")failure(error);});
  return ()=>{active=false;stops.forEach(stop=>stop());stops=[];};
}
export async function setDoc(reference,...args){return sdk.setDoc(writeDoc(reference,await actor()),...args);}
export async function updateDoc(reference,...args){return sdk.updateDoc(writeDoc(reference,await actor()),...args);}
export async function deleteDoc(reference){return sdk.deleteDoc(writeDoc(reference,await actor()));}
export async function addDoc(reference,...args){const current=await actor(),path=materialPath(reference.path,current);return sdk.addDoc(path===reference.path?reference:sdk.collection(reference.firestore,path),...args);}
export function writeBatch(database){
  const operations=[];
  const batch={
    set(reference,...values){operations.push({action:"set",reference,values});return batch;},
    update(reference,...values){operations.push({action:"update",reference,values});return batch;},
    delete(reference){operations.push({action:"delete",reference,values:[]});return batch;},
    async commit(){
      const current=await actor(),target=sdk.writeBatch(database);
      for(const operation of operations)target[operation.action](writeDoc(operation.reference,current),...operation.values);
      return target.commit();
    }
  };
  return batch;
}
export async function runTransaction(database,callback,...args){
  const current=await actor();
  return sdk.runTransaction(database,transaction=>{
    if(auth.currentUser?.uid!==current.uid)throw Error("Account changed. Reload before saving.");
    return callback({
    get:reference=>transaction.get(mappedDoc(reference,current)),
    set:(reference,...values)=>transaction.set(writeDoc(reference,current),...values),
    update:(reference,...values)=>transaction.update(writeDoc(reference,current),...values),
    delete:reference=>transaction.delete(writeDoc(reference,current))
    });
  },...args);
}
