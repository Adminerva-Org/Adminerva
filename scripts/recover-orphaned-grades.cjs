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
(async()=>{
 const [studentSnap,assessmentSnap,gradeSnap,revisionSnap,evidenceSnap]=await Promise.all([
   db.collection("students").get(),
   db.collection("assessments").get(),
   db.collection("student_grades").get(),
   db.collection("grade_revisions").get().catch(()=>({docs:[]})),
   db.collection("assessment_evidence").get().catch(()=>({docs:[]}))
 ]);
 const students=studentSnap.docs.map(d=>({id:d.id,...d.data()}));
 const isidore=students.filter(s=>norm(s.section).includes("isidore"));
 const ids=new Set(isidore.map(s=>s.id));
 const assessments=assessmentSnap.docs.map(d=>({id:d.id,...d.data()}));
 const grades=gradeSnap.docs.filter(d=>ids.has(d.data().studentId)).map(d=>({id:d.id,...d.data()}));
 const taskIds=new Set(grades.map(g=>g.taskId).filter(Boolean));
 const revisions=(revisionSnap.docs||[]).map(d=>({id:d.id,...d.data()})).filter(r=>ids.has(r.studentId)||taskIds.has(r.taskId));
 const evidence=(evidenceSnap.docs||[]).map(d=>({id:d.id,...d.data()})).filter(e=>ids.has(e.studentId));
 const payload={
  schema:"adminerva-st-isidore-all-assessment-grade-audit-v1",
  generatedAt:new Date().toISOString(),
  students:isidore.map(s=>({id:s.id,name:s.name||s.displayName||null,section:s.section||null,githubUsername:s.githubUsername||null})),
  assessments:assessments.map(a=>scalar(a)),
  grades:grades.map(g=>scalar(g)),
  revisions:revisions.map(r=>scalar(r)),
  evidence:evidence.map(e=>scalar(e))
 };
 const plaintext=Buffer.from(JSON.stringify(payload));
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv("aes-256-gcm",key,iv);
 const ct=Buffer.concat([cipher.update(plaintext),cipher.final()]),tag=cipher.getAuthTag();
 const ek=crypto.publicEncrypt({key:publicKey,oaepHash:"sha256"},key);
 fs.writeFileSync(process.env.RECOVERY_OUTPUT||"st-isidore-all-assessments.enc.json",JSON.stringify({alg:"RSA-OAEP-SHA256+A256GCM",ek:ek.toString("base64"),iv:iv.toString("base64"),tag:tag.toString("base64"),ct:ct.toString("base64")}));
 console.log("Encrypted St. Isidore all-assessment grade audit prepared.");
})().catch(e=>{console.error("Audit failed:",e.message);process.exitCode=1;});
