"use strict";
const admin=require("firebase-admin");
const crypto=require("node:crypto");
const fs=require("node:fs");

if(!admin.apps.length) admin.initializeApp({credential:admin.credential.applicationDefault()});
const db=admin.firestore();
const publicKey="-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAymiMI2qg0Ex3GpeY+RBe\nwBG6G8egUhQnjJdyo6Th3yDSARyyyZgE9Dyx5+jHywTOPlduz/jsLkullSEZy1Oo\nWR3zSGS9DsvMGACJl9/pTmQmliVLdyC01p3cqioHD2PE/UgiW8IEQVLYzv4UI5XE\n1/1pBkRuGPtwieT4a7QoobTngLKGg2QA6c4rEHq4O37AZQQCcUmLRfKjWDbx/E75\nPEfmbOovhG9rybqn32k+w4so/d48DMil0RGKxfOg4CyiLjcG3lJ9+hbyBmmMHgq6\notqj6EmNs7Dm/zW9or/6Vdmb4j5vfcVB86IQoCkUqtg9Ur5xuz6Ec+M0dfwL4jmw\nVwIDAQAB\n-----END PUBLIC KEY-----";

const scalarTime=value=>{
  if(!value)return null;
  if(typeof value.toDate==="function")return value.toDate().toISOString();
  if(typeof value.toMillis==="function")return new Date(value.toMillis()).toISOString();
  if(typeof value==="string"||typeof value==="number")return value;
  return null;
};
const first=(data,keys)=>{
  for(const key of keys){
    const value=data[key];
    if(value!==undefined&&value!==null&&String(value).trim()!=="")return value;
  }
  return null;
};

(async()=>{
  const [assessSnap,gradeSnap,studentSnap,evidenceSnap]=await Promise.all([
    db.collection("assessments").get(),
    db.collection("student_grades").get(),
    db.collection("students").get(),
    db.collection("assessment_evidence").get().catch(()=>({docs:[]}))
  ]);
  const liveAssessmentIds=new Set(assessSnap.docs.map(d=>d.id));
  const students=new Map(studentSnap.docs.map(d=>[d.id,d.data()]));
  const evidenceByTask=new Map();
  for(const d of evidenceSnap.docs||[]){
    const v=d.data(),taskId=v.assessmentId||v.taskId;
    if(!taskId)continue;
    const arr=evidenceByTask.get(taskId)||[];
    arr.push({
      status:v.status||null,
      submittedAt:scalarTime(v.submittedAt||v.createdAt||v.updatedAt),
      approvedAt:scalarTime(v.approvedAt||v.reviewedAt)
    });
    evidenceByTask.set(taskId,arr);
  }
  const groups=new Map();
  for(const d of gradeSnap.docs){
    const v=d.data(),taskId=v.taskId;
    if(!taskId||liveAssessmentIds.has(taskId))continue;
    const s=students.get(v.studentId)||{};
    const row={
      gradeId:d.id,
      taskId,
      studentId:v.studentId||null,
      studentName:s.name||s.displayName||null,
      section:s.section||v.section||null,
      score:Number.isFinite(Number(v.score))?Number(v.score):null,
      maxScore:Number.isFinite(Number(v.maxScore))?Number(v.maxScore):null,
      published:v.published===true,
      title:first(v,["assessmentTitle","taskTitle","title","assessmentName"]),
      createdAt:scalarTime(v.createdAt),
      updatedAt:scalarTime(v.updatedAt),
      evaluatedAt:scalarTime(v.evaluatedAt||v.gradedAt),
      publishedAt:scalarTime(v.publishedAt)
    };
    if(!groups.has(taskId))groups.set(taskId,[]);
    groups.get(taskId).push(row);
  }
  const orphaned=[...groups.entries()].map(([taskId,grades])=>{
    grades.sort((a,b)=>(a.studentName||"").localeCompare(b.studentName||""));
    const dates=grades.flatMap(g=>[g.createdAt,g.updatedAt,g.evaluatedAt,g.publishedAt]).filter(Boolean).sort();
    const titles=[...new Set(grades.map(g=>g.title).filter(Boolean))];
    const evidence=evidenceByTask.get(taskId)||[];
    return {
      taskId,
      titleCandidates:titles,
      gradeCount:grades.length,
      earliestRecordedAt:dates[0]||null,
      latestRecordedAt:dates.at(-1)||null,
      evidenceCount:evidence.length,
      evidence,
      grades
    };
  }).sort((a,b)=>String(b.latestRecordedAt||"").localeCompare(String(a.latestRecordedAt||"")));

  const payload={
    schema:"adminerva-orphaned-legacy-grade-recovery-v1",
    generatedAt:new Date().toISOString(),
    liveAssessmentCount:liveAssessmentIds.size,
    totalGradeRecords:gradeSnap.size,
    orphanedAssessmentCount:orphaned.length,
    orphaned
  };
  const plaintext=Buffer.from(JSON.stringify(payload));
  const aesKey=crypto.randomBytes(32),iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv("aes-256-gcm",aesKey,iv);
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  const tag=cipher.getAuthTag();
  const encryptedKey=crypto.publicEncrypt({key:publicKey,oaepHash:"sha256"},aesKey);
  const envelope={
    alg:"RSA-OAEP-SHA256+A256GCM",
    ek:encryptedKey.toString("base64"),
    iv:iv.toString("base64"),
    tag:tag.toString("base64"),
    ct:ciphertext.toString("base64")
  };
  fs.writeFileSync(process.env.RECOVERY_OUTPUT||"orphaned-grades.enc.json",JSON.stringify(envelope));
  console.log("Encrypted orphaned-grade recovery completed. No grade values were written to logs.");
})().catch(error=>{console.error("Recovery failed:",error.message);process.exitCode=1;});
