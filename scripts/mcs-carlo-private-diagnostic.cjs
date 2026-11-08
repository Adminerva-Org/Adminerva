"use strict";
const {initializeApp,applicationDefault,getApps}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");
const {createHash,publicEncrypt,constants,randomBytes,createCipheriv}=require("node:crypto");
const TARGET="30d7957afbc810af9073fbc9d3f7fda52f9eeaa1f785010de6f05e4e34c70473";
const PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAucusiPb/kf31lhnpexL3\nnat3cc1E9KHwomtR/2cpUfslf8e0MAeTPQIcNGjoMZ0IVUwZC0ywQ6N93DnVM+eL\nZoit5nwmtvSmfIU0jHpaGWp+8sn4JFdn45TWuDjIj2S5YhngFIEjVyQ26snFLQ+D\nZ4o1dsb1G+GuAAFOVWwp8TSEmaq9d6Emf11GGxYfXb/ijI3mlmfKkaebsJAUD6gv\nMXDCNVrfbx2EHnw2NUVh8/y+7igC3PqW4ev0chTPDzgMCBJlqE0WbaZl91PomJTw\niRaA0gHDmLgNf/6YH9CzdjG6Yzwj+0HFDcqwK8E+0CB2tA7gfo+hRaWaN/U2QJXj\nxwIDAQAB\n-----END PUBLIC KEY-----";
const norm=v=>String(v||"").trim().replace(/\s+/g," ").toLowerCase();
const fold=v=>norm(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const hash=v=>createHash("sha256").update(String(v)).digest("hex");
const active=d=>!["archived","suspended","inactive","disabled","deleted"].includes(norm(d?.status||"active"));
const name=d=>String(d?.displayName||d?.name||d?.fullName||d?.studentName||[d?.firstName||d?.firstname||d?.first_name,d?.lastName||d?.lastname||d?.last_name].filter(Boolean).join(" ")||"").trim().replace(/\s+/g," ");
async function main(){
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const db=getFirestore();
 const [students,requests]=await Promise.all([db.collection("students").get(),db.collection("account_requests").get()]);
 const matches=students.docs.filter(doc=>active(doc.data())&&hash(fold(name(doc.data())))===TARGET);
 if(matches.length!==1)throw Error("Carlo target fingerprint is not unique.");
 const doc=matches[0],d=doc.data(),display=name(d),email=String(d.email||"").trim(),gh=String(d.githubUsername||"").trim();
 const related=requests.docs.map(x=>x.data()).filter(r=>norm(r.displayName)===norm(display)||norm(r.email)===norm(email));
 const payload={displayName:display,email,githubUsername:gh,studentId:doc.id,section:String(d.section||d.sectionName||d.classSection||""),relatedRequests:related.map(r=>({status:r.status||null,requestedRole:r.requestedRole||null,approvedRole:r.approvedRole||null,studentId:r.studentId||null,email:String(r.email||"")}))};
 const aesKey=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",aesKey,iv);
 const ciphertext=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload),"utf8")),cipher.final()]);
 const tag=cipher.getAuthTag();
 const wrapped=publicEncrypt({key:PUBLIC_KEY,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:"sha256"},aesKey);
 console.log("MCS_CARLO_PRIVATE "+JSON.stringify({
   key:wrapped.toString("base64"),iv:iv.toString("base64"),tag:tag.toString("base64"),ciphertext:ciphertext.toString("base64")
 }));
}
main().catch(e=>{console.error("MCS_CARLO_PRIVATE_ERROR",e.message);process.exitCode=1});