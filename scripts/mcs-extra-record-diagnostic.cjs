"use strict";
const {initializeApp,applicationDefault,getApps}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {getAuth}=require("firebase-admin/auth");
const TARGET=["St. Isidore of Seville","St. Carlo Acutis"];
const norm=v=>String(v||"").trim().replace(/\s+/g," ").toLowerCase();
const validEmail=v=>{const e=norm(v);return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:null};
const active=d=>!["archived","suspended","inactive","disabled","deleted"].includes(norm(d.status||"active"));
const sectionOf=d=>{const parts=norm(d.section||d.sectionName||d.classSection).split(",").map(norm);return TARGET.find(s=>parts.includes(norm(s)))||null};
const nameOf=d=>norm(d.displayName||d.name||d.fullName||d.studentName||[d.firstName||d.firstname||d.first_name,d.lastName||d.lastname||d.last_name].filter(Boolean).join(" "));
const fold=v=>norm(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"");
async function main(){
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const db=getFirestore(),auth=getAuth();
 const [students,reviews,exclusions]=await Promise.all([
   db.collection("students").get(),
   db.collection("schools/mcs-manila/pilot_identity_reviews").get(),
   db.collection("schools/mcs-manila/pilot_roster_exclusions").get()
 ]);
 const reviewById=new Map(reviews.docs.filter(d=>d.data()?.status==="approved").map(d=>[d.id,d.data()]));
 const excluded=new Set(exclusions.docs.filter(d=>d.data()?.status==="excluded").map(d=>d.id));
 const authByEmail=new Map(),all=[];
 let token;do{const p=await auth.listUsers(1000,token);all.push(...p.users);token=p.pageToken;}while(token);
 for(const u of all)if(u.email)authByEmail.set(norm(u.email),u);
 const rows=students.docs.map(doc=>({id:doc.id,d:doc.data(),section:sectionOf(doc.data())}))
   .filter(r=>r.section&&active(r.d)&&!excluded.has(r.id))
   .map(r=>{
     const e=validEmail(r.d.email),u=e?authByEmail.get(e):null,review=reviewById.get(r.id);
     return {...r,name:nameOf(r.d),github:norm(r.d.githubUsername),uid:review?.authUid||(u&&!u.disabled?u.uid:null)};
   });
 const summary={};
 for(const section of TARGET){
   const s=rows.filter(r=>r.section===section);
   const dup=(field)=>[...new Map(s.filter(r=>r[field]).map(r=>[r[field],[]])).keys()].map(key=>({key,ids:s.filter(r=>r[field]===key).map(r=>r.id)})).filter(x=>x.ids.length>1);
   summary[section]={
     included:s.length,
     nameHashes:s.map(r=>({nameHash:require("node:crypto").createHash("sha256").update(r.name).digest("hex"),foldedNameHash:require("node:crypto").createHash("sha256").update(fold(r.name)).digest("hex"),emailHash:r.d.email?require("node:crypto").createHash("sha256").update(norm(r.d.email)).digest("hex"):null})).sort((a,b)=>a.nameHash.localeCompare(b.nameHash)),
     duplicateNameGroups:dup("name").length,
     duplicateGithubGroups:dup("github").length,
     duplicateUidGroups:dup("uid").length,
     recordsWithNoUid:s.filter(r=>!r.uid).length
   };
 }
 console.log("MCS_EXTRA_RECORD_DIAGNOSTIC "+JSON.stringify(summary));
}
main().catch(e=>{console.error("MCS_EXTRA_RECORD_DIAGNOSTIC_ERROR",e.message);process.exitCode=1});
