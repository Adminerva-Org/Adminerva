"use strict";
const admin=require("firebase-admin");
const crypto=require("node:crypto");
const fs=require("node:fs");
if(!admin.apps.length)admin.initializeApp({credential:admin.credential.applicationDefault()});
const db=admin.firestore();
const publicKey="-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq+MvuWZTcmvVuyn0ulaV\nUCXWwR5XG0UtOH1yLTZQygAGOzYv3koL5XDPzmF4zGtuIVydkD0sgBssY5OIrof0\nBFEI3NagPhxekEyzUJyCDY6e/xz3rWbLkvke6GVjoRdtOlVNtKzqtMRIyHG/2yqj\nfeVC+OcTf0lmuPGYuabhEDD2btBpKp9RwRxFBxohYZ/tKiV0/UJ6wmVrE/2cgYHZ\nXApDkQB2Q8TC+cAlRL2t8/8qh7hekdujMsScHUYUjwMkMelKl5i+GeGu/X71Ygn5\nkVinaMqDkv8b235YoL++XpwqkYy4itJi2mz8pKW9Vu9gf5JYisSADwaBQSoJ9xcD\n7QIDAQAB\n-----END PUBLIC KEY-----";
const norm=v=>String(v||"").trim().toLowerCase();
function scalar(value,depth=0){
 if(depth>12)return "[depth-limit]";
 if(value===undefined)return null;
 if(value===null||typeof value==="string"||typeof value==="number"||typeof value==="boolean")return value;
 if(typeof value?.toDate==="function")return value.toDate().toISOString();
 if(typeof value?.toMillis==="function")return new Date(value.toMillis()).toISOString();
 if(Array.isArray(value))return value.map(v=>scalar(v,depth+1));
 if(typeof value==="object"){const out={};for(const [k,v] of Object.entries(value))out[k]=scalar(v,depth+1);return out;}
 return String(value);
}
function referencesIsidore(id,data,studentIds){
 if(studentIds.has(data.studentId)||studentIds.has(data.uid)||studentIds.has(data.studentUid)||studentIds.has(data.learnerId))return true;
 if(norm(data.section).includes("isidore")||norm(data.classSection).includes("isidore"))return true;
 const sid=[...studentIds].find(x=>id.includes(x));
 return Boolean(sid);
}
(async()=>{
 const studentSnap=await db.collection("students").get();
 const students=studentSnap.docs.map(d=>({id:d.id,...d.data()}));
 const isidore=students.filter(s=>norm(s.section).includes("isidore"));
 const studentIds=new Set(isidore.map(s=>s.id));
 const roots=await db.listCollections();
 const inventory=[],matches=[];
 const candidateName=/grade|score|eval|assess|review|submit|result|rubric|activity|evidence|feedback/i;
 for(const col of roots){
   const countSnap=await col.count().get();
   const count=countSnap.data().count||0;
   inventory.push({id:col.id,count});
   if(!candidateName.test(col.id)||count>10000)continue;
   const snap=await col.get();
   const docs=[];
   for(const d of snap.docs){
     const data=d.data();
     if(referencesIsidore(d.id,data,studentIds))docs.push({id:d.id,...scalar(data)});
   }
   if(docs.length)matches.push({collection:col.id,totalCount:count,matchedCount:docs.length,docs});
 }
 const payload={
  schema:"adminerva-legacy-grading-collection-audit-v1",
  generatedAt:new Date().toISOString(),
  sectionMatches:isidore.map(s=>({id:s.id,name:s.name||s.displayName||null,section:s.section||null})),
  inventory:inventory.sort((a,b)=>a.id.localeCompare(b.id)),
  matches
 };
 const plaintext=Buffer.from(JSON.stringify(payload));
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv("aes-256-gcm",key,iv);
 const ct=Buffer.concat([cipher.update(plaintext),cipher.final()]),tag=cipher.getAuthTag();
 const ek=crypto.publicEncrypt({key:publicKey,oaepHash:"sha256"},key);
 fs.writeFileSync(process.env.RECOVERY_OUTPUT||"legacy-grading-audit.enc.json",JSON.stringify({alg:"RSA-OAEP-SHA256+A256GCM",ek:ek.toString("base64"),iv:iv.toString("base64"),tag:tag.toString("base64"),ct:ct.toString("base64")}));
 console.log("Encrypted legacy grading collection audit prepared. No student values were written to logs.");
})().catch(e=>{console.error("Audit failed:",e.message);process.exitCode=1;});
