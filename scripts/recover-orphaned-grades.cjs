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
 if(value instanceof admin.firestore.DocumentReference)return value.path;
 if(Array.isArray(value))return value.map(v=>scalar(v,depth+1));
 if(typeof value==="object"){
   const out={};
   for(const [k,v] of Object.entries(value))out[k]=scalar(v,depth+1);
   return out;
 }
 return String(value);
}
function relevantAssessment(data,sections){
 const text=[data.title,data.type,data.assessmentType,data.taskContext].map(norm).join(" ");
 const practical=text.includes("practical");
 const dep=Array.isArray(data.deployments)&&data.deployments.some(d=>sections.has(norm(d.section)));
 const targets=Array.isArray(data.targetSections)&&data.targetSections.some(s=>sections.has(norm(s)));
 return practical&&(dep||targets||sections.size===0);
}
(async()=>{
 const [studentSnap,assessmentSnap,gradeSnap,revisionSnap,evidenceSnap,alertSnap]=await Promise.all([
   db.collection("students").get(),
   db.collection("assessments").get(),
   db.collection("student_grades").get(),
   db.collection("grade_revisions").get().catch(()=>({docs:[]})),
   db.collection("assessment_evidence").get().catch(()=>({docs:[]})),
   db.collection("grading_alerts").get().catch(()=>({docs:[]}))
 ]);
 const students=studentSnap.docs.map(d=>({id:d.id,...d.data()}));
 const isidore=students.filter(s=>norm(s.section).includes("isidore"));
 const sectionNames=new Set(isidore.map(s=>norm(s.section)).filter(Boolean));
 const studentIds=new Set(isidore.map(s=>s.id));
 const assessments=assessmentSnap.docs.map(d=>({id:d.id,...d.data()}));
 const practicalAssessments=assessments.filter(a=>relevantAssessment(a,sectionNames));
 const practicalIds=new Set(practicalAssessments.map(a=>a.id));
 const allIsidoreGrades=gradeSnap.docs
   .filter(d=>studentIds.has(d.data().studentId))
   .map(d=>({id:d.id,...d.data()}));
 const candidateTaskIds=new Set(practicalIds);
 // Include deleted/orphaned or renamed task groups for this section when their grade metadata clearly says Practical.
 for(const g of allIsidoreGrades){
   const titleText=[g.assessmentTitle,g.taskTitle,g.title,g.type,g.assessmentType].map(norm).join(" ");
   if(titleText.includes("practical"))candidateTaskIds.add(g.taskId);
 }
 // If exactly one currently deployed practical assessment exists, keep that exact task.
 // Also retain orphan task IDs for Isidore so deleted historical practical records can be inspected.
 const liveIds=new Set(assessments.map(a=>a.id));
 const orphanTaskIds=[...new Set(allIsidoreGrades.map(g=>g.taskId).filter(id=>id&&!liveIds.has(id)))];
 for(const id of orphanTaskIds)candidateTaskIds.add(id);

 const selectedGrades=allIsidoreGrades.filter(g=>candidateTaskIds.has(g.taskId));
 const gradeIds=new Set(selectedGrades.map(g=>g.id));
 const selectedRevisions=(revisionSnap.docs||[]).map(d=>({id:d.id,...d.data()}))
   .filter(r=>gradeIds.has(r.gradeId)||(studentIds.has(r.studentId)&&candidateTaskIds.has(r.taskId)));
 const selectedEvidence=(evidenceSnap.docs||[]).map(d=>({id:d.id,...d.data()}))
   .filter(e=>studentIds.has(e.studentId)&&candidateTaskIds.has(e.assessmentId||e.taskId));
 const selectedAlerts=(alertSnap.docs||[]).map(d=>({id:d.id,...d.data()}))
   .filter(a=>studentIds.has(a.studentId)&&candidateTaskIds.has(a.taskId));

 const payload={
   schema:"adminerva-st-isidore-practical-exam-audit-v1",
   generatedAt:new Date().toISOString(),
   sectionMatches:isidore.map(s=>({id:s.id,name:s.name||s.displayName||null,section:s.section||null,githubUsername:s.githubUsername||null})),
   matchingAssessmentCount:practicalAssessments.length,
   assessments:practicalAssessments.map(a=>scalar(a)),
   orphanTaskIds,
   candidateTaskIds:[...candidateTaskIds],
   grades:selectedGrades.map(g=>scalar(g)),
   gradeRevisions:selectedRevisions.map(r=>scalar(r)),
   evidence:selectedEvidence.map(e=>scalar(e)),
   gradingAlerts:selectedAlerts.map(a=>scalar(a))
 };
 const plaintext=Buffer.from(JSON.stringify(payload));
 const key=crypto.randomBytes(32),iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv("aes-256-gcm",key,iv);
 const ct=Buffer.concat([cipher.update(plaintext),cipher.final()]),tag=cipher.getAuthTag();
 const ek=crypto.publicEncrypt({key:publicKey,oaepHash:"sha256"},key);
 fs.writeFileSync(process.env.RECOVERY_OUTPUT||"st-isidore-practical.enc.json",JSON.stringify({
   alg:"RSA-OAEP-SHA256+A256GCM",ek:ek.toString("base64"),iv:iv.toString("base64"),tag:tag.toString("base64"),ct:ct.toString("base64")
 }));
 console.log("Encrypted St. Isidore Practical Examination audit prepared. Student records were not written to logs.");
})().catch(e=>{console.error("Audit failed:",e.message);process.exitCode=1;});
