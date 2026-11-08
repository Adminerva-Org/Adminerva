"use strict";
const {initializeApp,applicationDefault,getApps}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {createHash}=require("node:crypto");
const TARGETS=[
 {label:"isidore",hash:"cf7772b07257f28cd40d7a4312caee77f51bf4679e819c720965ca08f3a450dd"},
 {label:"carlo",hash:"30d7957afbc810af9073fbc9d3f7fda52f9eeaa1f785010de6f05e4e34c70473"}
];
const norm=v=>String(v||"").trim().replace(/\s+/g," ").toLowerCase();
const fold=v=>norm(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const hash=v=>createHash("sha256").update(String(v)).digest("hex");
const active=d=>!["archived","suspended","inactive","disabled","deleted"].includes(norm(d?.status||"active"));
const name=d=>String(d?.displayName||d?.name||d?.fullName||d?.studentName||[d?.firstName||d?.firstname||d?.first_name,d?.lastName||d?.lastname||d?.last_name].filter(Boolean).join(" ")||"").trim().replace(/\s+/g," ");
async function main(){
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const db=getFirestore();
 const [students,requests]=await Promise.all([db.collection("students").get(),db.collection("account_requests").get()]);
 const out={};
 for(const target of TARGETS){
   const matches=students.docs.filter(doc=>active(doc.data())&&hash(fold(name(doc.data())))===target.hash);
   if(matches.length!==1)throw Error(target.label+" target no longer unique.");
   const student=matches[0], reqs=requests.docs.filter(doc=>doc.data()?.studentId===student.id);
   out[target.label]={
     requestCount:reqs.length,
     approvedStudentRequest:reqs.some(doc=>doc.data()?.status==="approved"&&doc.data()?.approvedRole==="student"),
     approvedGuestOrigin:reqs.some(doc=>doc.data()?.requestedRole==="guest"&&doc.data()?.status==="approved"&&doc.data()?.approvedRole==="student"),
     studentEmailMatchesRequest:reqs.some(doc=>norm(doc.data()?.email)===norm(student.data()?.email)),
     studentIdGeneratedFromRequest:student.id.startsWith("registration_")
   };
 }
 console.log("MCS_GUEST_ORIGIN_DIAGNOSTIC "+JSON.stringify(out));
}
main().catch(e=>{console.error("MCS_GUEST_ORIGIN_DIAGNOSTIC_ERROR",e.message);process.exitCode=1});