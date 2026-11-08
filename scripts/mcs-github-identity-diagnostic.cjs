"use strict";
const {initializeApp,applicationDefault,getApps}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {getAuth}=require("firebase-admin/auth");

const PILOT=[
 ["St. Isidore of Seville",44],
 ["St. Carlo Acutis",34],
 ["St. Philip the Apostle",45],
 ["St. Anselm of Canterbury",44]
];
const norm=v=>String(v||"").trim().replace(/\s+/g," ").toLowerCase();
const validEmail=v=>{const e=norm(v);return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:null};
const nameOf=d=>norm(d.displayName||d.name||d.fullName||d.studentName||[d.firstName||d.firstname||d.first_name,d.lastName||d.lastname||d.last_name].filter(Boolean).join(" "));
const sectionOf=d=>{
 const raw=norm(d.section||d.sectionName||d.classSection);
 const parts=raw.split(",").map(norm);
 return PILOT.find(([s])=>parts.includes(norm(s)))?.[0]||null;
};
const active=d=>!["archived","suspended","inactive","disabled","deleted"].includes(norm(d.status||"active"));
async function main(){
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const db=getFirestore(),auth=getAuth();
 const snap=await db.collection("students").get();
 const rows=snap.docs.map(doc=>({id:doc.id,d:doc.data()}));
 const pilotRows=rows.filter(r=>active(r.d)&&sectionOf(r.d));
 const authByEmail=new Map();
 const emails=[...new Set(rows.map(r=>validEmail(r.d.email)).filter(Boolean))];
 for(let i=0;i<emails.length;i+=100){
   const batch=emails.slice(i,i+100);
   const found=await auth.getUsers(batch.map(email=>({email})));
   for(const u of found.users)authByEmail.set(norm(u.email),u);
 }
 const unresolved=pilotRows.filter(r=>{
   const e=validEmail(r.d.email),u=e?authByEmail.get(e):null;
   return !(u&&u.emailVerified&&!u.disabled);
 });
 let uniqueCrossProfile=0,githubBacked=0,withGithubUsername=0,sameNameCandidate=0,ambiguous=0,noCandidate=0;
 const allAuthUsers=[];
 let pageToken;
 do{
   const page=await auth.listUsers(1000,pageToken);
   allAuthUsers.push(...page.users);pageToken=page.pageToken;
 }while(pageToken);
 const authByGithubProviderUid=new Map();
 for(const user of allAuthUsers){
   for(const provider of user.providerData||[]){
     if(provider.providerId==="github.com"&&provider.uid)authByGithubProviderUid.set(String(provider.uid),user);
   }
 }
 let exactGithubProviderMatches=0,githubUsernameLookupFailures=0,githubMatchesEmailVerified=0,githubMatchesEmailUnverified=0,githubMatchesNoPrimaryEmail=0,githubMatchesDisabled=0;
 const bySection={};
 for(const row of unresolved){
   const section=sectionOf(row.d);bySection[section]??={unresolved:0,unique:0,ambiguous:0,none:0};bySection[section].unresolved++;
   const gh=norm(row.d.githubUsername);
   if(gh)withGithubUsername++;
   if(gh){
     try{
       const response=await fetch("https://api.github.com/users/"+encodeURIComponent(gh),{
         headers:{"Accept":"application/vnd.github+json","User-Agent":"Adminerva-MCS-identity-diagnostic"}
       });
       if(response.ok){
         const profile=await response.json(),matched=authByGithubProviderUid.get(String(profile.id));
         if(matched){
           exactGithubProviderMatches++;
           if(matched.disabled)githubMatchesDisabled++;
           if(validEmail(matched.email)){if(matched.emailVerified)githubMatchesEmailVerified++;else githubMatchesEmailUnverified++;}
           else githubMatchesNoPrimaryEmail++;
         }
       }else githubUsernameLookupFailures++;
     }catch{githubUsernameLookupFailures++}
   }
   const candidateDocs=rows.filter(other=>{
     if(other.id===row.id)return false;
     const e=validEmail(other.d.email);if(!e)return false;
     const u=authByEmail.get(e);if(!(u&&u.emailVerified&&!u.disabled))return false;
     const sameGithub=gh&&norm(other.d.githubUsername)===gh;
     const sameName=nameOf(row.d)&&nameOf(other.d)===nameOf(row.d);
     return sameGithub||sameName;
   });
   const uidMap=new Map();
   for(const other of candidateDocs){
     const e=validEmail(other.d.email),u=authByEmail.get(e);if(!u)continue;
     const reasons=[];
     if(gh&&norm(other.d.githubUsername)===gh)reasons.push("github_username");
     if(nameOf(row.d)&&nameOf(other.d)===nameOf(row.d))reasons.push("same_name");
     uidMap.set(u.uid,{user:u,reasons:[...(uidMap.get(u.uid)?.reasons||[]),...reasons]});
   }
   if(uidMap.size===1){
     uniqueCrossProfile++;bySection[section].unique++;
     const one=[...uidMap.values()][0];
     if(one.reasons.includes("same_name"))sameNameCandidate++;
     if(one.user.providerData?.some(p=>p.providerId==="github.com"))githubBacked++;
   }else if(uidMap.size>1){ambiguous++;bySection[section].ambiguous++}
   else{noCandidate++;bySection[section].none++}
 }
 console.log("MCS_GITHUB_IDENTITY_DIAGNOSTIC "+JSON.stringify({
   pilotRows:pilotRows.length,
   unresolved:unresolved.length,
   withGithubUsername,
   uniqueCrossProfile,
   uniqueCandidatesBackedByGithubProvider:githubBacked,
   uniqueCandidatesAlsoSameName:sameNameCandidate,
   exactGithubProviderMatches,
   githubMatchesEmailVerified,
   githubMatchesEmailUnverified,
   githubMatchesNoPrimaryEmail,
   githubMatchesDisabled,
   githubUsernameLookupFailures,
   ambiguous,
   noCandidate,
   bySection
 }));
}
main().catch(e=>{console.error("MCS_GITHUB_IDENTITY_DIAGNOSTIC_ERROR",e.message);process.exitCode=1});
