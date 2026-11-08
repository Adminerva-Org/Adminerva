"use strict";
const {initializeApp,applicationDefault,getApps}=require("firebase-admin/app");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {getAuth}=require("firebase-admin/auth");
const {createHash}=require("node:crypto");

const SCHOOL_ID="mcs-manila";
const PILOT=[
 {sectionId:"shs-g11-techpro-ict-st-isidore-of-seville",name:"St. Isidore of Seville"},
 {sectionId:"shs-g11-techpro-ict-st-carlo-acutis",name:"St. Carlo Acutis"},
 {sectionId:"shs-g12-tvl-ict-st-philip-the-apostle",name:"St. Philip the Apostle"},
 {sectionId:"shs-g12-tvl-ict-st-anselm-of-canterbury",name:"St. Anselm of Canterbury"}
];
const norm=v=>String(v||"").trim().replace(/\s+/g," ").toLowerCase();
const validEmail=v=>{const e=norm(v);return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:null};
const hash=v=>createHash("sha256").update(String(v)).digest("hex");
const active=d=>!["archived","suspended","inactive","disabled","deleted"].includes(norm(d?.status||"active"));
const displayName=d=>String(d?.displayName||d?.name||d?.fullName||d?.studentName||[d?.firstName||d?.firstname||d?.first_name,d?.lastName||d?.lastname||d?.last_name].filter(Boolean).join(" ")||"Legacy student").trim().replace(/\s+/g," ").slice(0,140);
function sectionFor(d){
 const parts=norm(d?.section||d?.sectionName||d?.classSection).split(",").map(norm);
 return PILOT.find(s=>parts.includes(norm(s.name)))||null;
}
async function main(){
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const db=getFirestore(),auth=getAuth();
 const school=await db.doc("platform_schools/"+SCHOOL_ID).get();
 if(!school.exists||school.data().state!=="draft"||school.data().compatibilityMode==="v4_only"||school.data().productionAuthorized===true)
   throw Error("MCS must remain draft, legacy-compatible and non-production during identity reconciliation.");

 const studentSnap=await db.collection("students").get();
 const rows=studentSnap.docs.map(doc=>({id:doc.id,d:doc.data(),section:sectionFor(doc.data())}))
   .filter(r=>r.section&&active(r.d));

 const authUsers=[],authByEmail=new Map(),authByGithubProviderUid=new Map();
 let pageToken;
 do{
   const page=await auth.listUsers(1000,pageToken);authUsers.push(...page.users);pageToken=page.pageToken;
 }while(pageToken);
 for(const user of authUsers){
   if(user.email)authByEmail.set(norm(user.email),user);
   for(const p of user.providerData||[]){
     if(p.providerId==="github.com"&&p.uid){
       if(authByGithubProviderUid.has(String(p.uid))&&authByGithubProviderUid.get(String(p.uid)).uid!==user.uid)
         throw Error("Duplicate Firebase users share one GitHub provider UID.");
       authByGithubProviderUid.set(String(p.uid),user);
     }
   }
 }

 const reviewSnap=await db.collection("schools/"+SCHOOL_ID+"/pilot_identity_reviews").get();
 const existingReviews=new Map(reviewSnap.docs.filter(d=>d.data()?.status==="approved").map(d=>[d.id,d.data()]));
 const exclusionSnap=await db.collection("schools/"+SCHOOL_ID+"/pilot_roster_exclusions").get();
 const excluded=new Set(exclusionSnap.docs.filter(d=>d.data()?.status==="excluded").map(d=>d.id));

 const uidOwner=new Map();
 for(const row of rows){
   if(excluded.has(row.id))continue;
   const review=existingReviews.get(row.id);
   let uid=review?.authUid||null;
   if(!uid){
     const e=validEmail(row.d.email),u=e?authByEmail.get(e):null;
     if(u&&u.emailVerified&&!u.disabled)uid=u.uid;
   }
   if(uid){
     const prior=uidOwner.get(uid);
     if(prior&&prior!==row.id)throw Error("Existing pilot identity collision detected before GitHub reconciliation.");
     uidOwner.set(uid,row.id);
   }
 }

 const unresolved=rows.filter(row=>{
   if(excluded.has(row.id)||existingReviews.has(row.id))return false;
   const e=validEmail(row.d.email),u=e?authByEmail.get(e):null;
   return !(u&&u.emailVerified&&!u.disabled);
 });
 if(unresolved.length!==13)throw Error("Expected exactly 13 unresolved pilot identities; observed "+unresolved.length+".");

 const matches=[];
 const githubCache=new Map();
 for(const row of unresolved){
   const username=norm(row.d.githubUsername);
   if(!username)throw Error("An unresolved pilot row no longer has a GitHub username.");
   let gh=githubCache.get(username);
   if(!gh){
     const response=await fetch("https://api.github.com/users/"+encodeURIComponent(username),{
       headers:{"Accept":"application/vnd.github+json","User-Agent":"Adminerva-MCS-GitHub-reconcile"}
     });
     if(!response.ok)throw Error("GitHub identity lookup failed for one unresolved pilot row.");
     gh=await response.json();githubCache.set(username,gh);
   }
   const user=authByGithubProviderUid.get(String(gh.id));
   if(!user||user.disabled||user.emailVerified!==true||!validEmail(user.email))
     throw Error("GitHub provider identity does not resolve to one active verified Firebase user.");
   const prior=uidOwner.get(user.uid);
   if(prior&&prior!==row.id)throw Error("GitHub provider match collides with another included pilot record.");
   uidOwner.set(user.uid,row.id);
   matches.push({row,user});
 }
 if(new Set(matches.map(x=>x.user.uid)).size!==matches.length)
   throw Error("GitHub provider reconciliation is not one-to-one.");

 const batch=db.batch(),now=FieldValue.serverTimestamp();
 for(const {row,user} of matches){
   batch.set(db.doc("schools/"+SCHOOL_ID+"/pilot_identity_reviews/"+row.id),{
     schoolId:SCHOOL_ID,legacyStudentId:row.id,status:"approved",authUid:user.uid,
     emailHash:hash(norm(user.email)),displayNameSnapshot:displayName(row.d),
     sectionId:row.section.sectionId,identitySource:"github_provider_uid",
     automated:true,reviewedByUid:"migration",reviewedAt:now,
     reason:"Deterministic legacy GitHub username to GitHub provider UID to Firebase Auth UID match."
   },{merge:false});
 }
 batch.create(db.collection("schools/"+SCHOOL_ID+"/pilot_audit").doc(),{
   schoolId:SCHOOL_ID,actorUid:"migration",action:"pilot_github_identities_reconciled",
   matchedCount:matches.length,identitySource:"github_provider_uid",
   legacyAcademicHistoryChanged:false,createdAt:now
 });
 await batch.commit();
 console.log("MCS_GITHUB_IDENTITY_RECONCILE "+JSON.stringify({
   matched:matches.length,uniqueFirebaseUsers:new Set(matches.map(x=>x.user.uid)).size,
   legacyStudentDocumentsChanged:0,historicalAcademicRecordsChanged:0,pilotStarted:false
 }));
}
main().catch(e=>{console.error("MCS_GITHUB_IDENTITY_RECONCILE_ERROR",e.message);process.exitCode=1});
