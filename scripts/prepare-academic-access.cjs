const path=require("node:path"),crypto=require("node:crypto");
const dependencies=require("node:module").createRequire(path.resolve(__dirname,"../functions/package.json"));
const {initializeApp,deleteApp}=dependencies("firebase-admin/app");
const {getFirestore,FieldValue}=dependencies("firebase-admin/firestore");
const {getAuth}=dependencies("firebase-admin/auth");
const {planAcademicAccess,createAcademicPreparation,version}=require("../functions/academic-preparation.js");
const argument=name=>{const position=process.argv.indexOf(name);return position<0?null:process.argv[position+1];};
async function main(){
  const projectId=argument("--project"),actorUid=argument("--actor-uid");
  if(projectId!=="reporeview-e7ca4"&&!/^demo-adminerva-/.test(projectId||""))throw Error("Select the reviewed project explicitly.");
  const app=initializeApp({projectId});
  try{
    const administrator=await getAuth(app).getUser(actorUid||"");
    if(administrator.email!=="babaynike2013@gmail.com"||!administrator.emailVerified||administrator.disabled)throw Error("A verified administrator identity is required.");
    const db=getFirestore(app),names=["students","teaching_roster","assessments","assessment_private","student_grades"];
    const records=Object.fromEntries(await Promise.all(names.map(async name=>[name,(await db.collection(name).get()).docs.map(record=>({id:record.id,path:record.ref.path,data:record.data(),version:version(record)}))])));
    const plan=planAcademicAccess(records,actorUid),digest=crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex");
    if(!process.argv.includes("--apply")){console.log(JSON.stringify({dryRun:true,projectId,digest,counts:plan.counts,blockers:plan.blockers.length}));return;}
    if(argument("--approved-digest")!==digest||!process.argv.includes("--confirm-metadata-only"))throw Error("Approve the exact unchanged dry-run digest and metadata-only scope first.");
    const result=await createAcademicPreparation({db,FieldValue}).apply(plan,{actorUid,runId:"access-"+Date.now()+"-"+crypto.randomBytes(6).toString("hex")});
    console.log(JSON.stringify({applied:true,...result}));
  }finally{await deleteApp(app);}
}
main().catch(error=>{console.error(JSON.stringify({ready:false,errorType:error.name,code:error.code||null}));process.exitCode=1;});
