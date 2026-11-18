"use strict";
/**
 * Automatic verification for frozen Adminerva Studio submissions.
 * Source fields remain immutable; the system appends a verification sidecar
 * whose sourceDigest is calculated from the exact submitted files.
 */
const {createHash}=require("node:crypto");

const VERIFY_VERSION="studio-auto-verification-v1";
const JUDGE0_ORIGIN=String(process.env.ADMINERVA_JUDGE0_ORIGIN||"https://ce.judge0.com").replace(/\/$/,"");
const RUNTIME_ORIGIN=String(process.env.ADMINERVA_RUNTIME_VERIFY_ORIGIN||"").replace(/\/$/,"");
const RUNTIME_TOKEN=String(process.env.ADMINERVA_RUNTIME_VERIFY_TOKEN||"");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const CRC_TABLE=(()=>{
 const table=new Uint32Array(256);
 for(let n=0;n<256;n++){
  let value=n;
  for(let k=0;k<8;k++)value=(value&1)?(0xEDB88320^(value>>>1)):(value>>>1);
  table[n]=value>>>0;
 }
 return table;
})();
function crc32(buffer){
 let crc=0xFFFFFFFF;
 for(const byte of buffer)crc=CRC_TABLE[(crc^byte)&0xFF]^(crc>>>8);
 return (crc^0xFFFFFFFF)>>>0;
}
function zipBase64(entries){
 const locals=[],centrals=[];let offset=0;
 for(const [name,value] of entries){
  const filename=Buffer.from(name,"utf8"),data=Buffer.from(String(value),"utf8"),crc=crc32(data);
  const local=Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);
  local.writeUInt16LE(0,8);local.writeUInt16LE(0,10);local.writeUInt16LE(0,12);
  local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);
  local.writeUInt16LE(filename.length,26);local.writeUInt16LE(0,28);
  locals.push(local,filename,data);
  const central=Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt16LE(0,8);central.writeUInt16LE(0,10);central.writeUInt16LE(0,12);central.writeUInt16LE(0,14);
  central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);
  central.writeUInt16LE(filename.length,28);central.writeUInt16LE(0,30);central.writeUInt16LE(0,32);
  central.writeUInt16LE(0,34);central.writeUInt16LE(0,36);central.writeUInt32LE(0,38);central.writeUInt32LE(offset,42);
  centrals.push(central,filename);
  offset+=local.length+filename.length+data.length;
 }
 const centralBuffer=Buffer.concat(centrals),end=Buffer.alloc(22),count=entries.length;
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(0,4);end.writeUInt16LE(0,6);
 end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(centralBuffer.length,12);
 end.writeUInt32LE(offset,16);end.writeUInt16LE(0,20);
 return Buffer.concat([...locals,centralBuffer,end]).toString("base64");
}
const clip=(value,max)=>String(value??"").slice(0,max);
function canonicalJson(value){
 function normalize(node){
  if(node===null||typeof node==="string"||typeof node==="boolean")return node;
  if(typeof node==="number")return Number.isFinite(node)?(Object.is(node,-0)?0:node):null;
  if(Array.isArray(node))return node.map(normalize);
  if(node&&typeof node==="object"){
   const result={};
   for(const key of Object.keys(node).sort())result[key]=normalize(node[key]);
   return result;
  }
  return null;
 }
 return JSON.stringify(normalize(value));
}
function sourceDigest(files,language){
 return createHash("sha256").update(canonicalJson({language:String(language||""),files})).digest("hex");
}
function javaMain(files){
 const candidates=files.filter(file=>/\.java$/i.test(file.path)&&/\bstatic\s+void\s+main\s*\(/.test(file.content));
 const chosen=candidates.find(file=>/(^|\/)Main\.java$/i.test(file.path))||candidates[0]||null;
 if(!chosen)return {entry:"",mainClass:""};
 const pkg=chosen.content.match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m)?.[1]||"";
 const base=chosen.path.split("/").at(-1).replace(/\.java$/i,"");
 return {entry:chosen.path,mainClass:(pkg?pkg+".":"")+base};
}
function inferProfile(task,snapshot){
 const language=String(snapshot.sourceLanguage||snapshot.language||snapshot.lang||"").toLowerCase();
 if(language!=="java")return {id:"unsupported",language};
 const artifacts=snapshot.artifacts||{},config=artifacts.config||snapshot.config||{};
 const files=Array.isArray(snapshot.files)?snapshot.files:
   Object.entries(snapshot.files||{}).map(([path,content])=>({path,content:String(content)}));
 const source=files.map(file=>file.content).join("\n");
 const declared=String(task?.studioProjectProfile||"auto").toLowerCase();
 const swing=declared==="java-desktop"||config.runMode==="desktop"||
   /\b(?:javax\.swing|java\.awt)\b/.test(source);
 const database=declared==="java-database"||config.database===true||
   Object.keys((artifacts.database||snapshot.database||{}).tables||{}).length>0||
   /\b(?:java\.sql|DriverManager|PreparedStatement|ResultSet)\b/.test(source);
 return {id:swing?(database?"java_swing_database":"java_swing"):
   (database?"java_console_database":"java_console"),language,swing,database,declared};
}
function databaseArtifact(snapshot){
 return snapshot.artifacts?.database||snapshot.database||null;
}
function verifyDatabaseArtifact(database){
 if(!database||typeof database!=="object")return {
   present:false,schemaValid:null,crudSmokePassed:null,tables:[],
   note:"No frozen Adminerva DB artifact is attached to this submission."
 };
 try{
  const tables=database.tables&&typeof database.tables==="object"?database.tables:{},summaries=[];
  for(const [name,table] of Object.entries(tables)){
   if(!/^[A-Za-z_][\w]*$/.test(name)||!Array.isArray(table?.columns)||!Array.isArray(table?.rows))
    throw Error("Malformed table "+name);
   const names=table.columns.map(column=>String(column?.name||""));
   if(!names.length||new Set(names).size!==names.length||names.some(value=>!/^[A-Za-z_][\w]*$/.test(value)))
    throw Error("Invalid columns in "+name);
   const primary=table.columns.find(column=>column?.primaryKey===true)?.name||null;
   if(primary){
    const keys=table.rows.map(row=>row?.[primary]);
    if(keys.some(value=>value===null||value===undefined)||new Set(keys.map(value=>canonicalJson(value))).size!==keys.length)
     throw Error("Primary-key integrity failed in "+name);
   }
   for(const row of table.rows)if(!row||typeof row!=="object"||Array.isArray(row))
    throw Error("Invalid row in "+name);
   // Generic isolated CRUD smoke on a copy of the artifact model. This verifies
   // that the frozen schema/data can support CRUD; it does not claim the Java
   // program itself performed these operations.
   const rows=JSON.parse(JSON.stringify(table.rows)),sample={};
   for(const column of table.columns){
    const type=String(column?.type||"TEXT").toUpperCase();
    let value=/INT|REAL|NUM|DEC|DOUBLE|FLOAT/.test(type)?987654321:"__adminerva_verify__";
    if(column?.primaryKey===true){
      const used=new Set(rows.map(row=>String(row?.[column.name])));
      while(used.has(String(value)))value=typeof value==="number"?value+1:value+"_x";
    }
    sample[column.name]=value;
   }
   rows.push(sample);
   const key=primary||names[0],found=rows.some(row=>row?.[key]===sample[key]);
   if(!found)throw Error("Insert/read smoke failed in "+name);
   const mutable=names.find(column=>column!==primary)||key;
   const updated=typeof sample[mutable]==="number"?sample[mutable]+1:String(sample[mutable])+"_u";
   const target=rows.find(row=>row?.[key]===sample[key]);target[mutable]=updated;
   if(target[mutable]!==updated)throw Error("Update smoke failed in "+name);
   const filtered=rows.filter(row=>row?.[key]!==sample[key]);
   if(filtered.length!==rows.length-1)throw Error("Delete smoke failed in "+name);
   summaries.push({name,columns:names,rowCount:table.rows.length,primaryKey:primary});
  }
  return {present:true,schemaValid:true,crudSmokePassed:true,tables:summaries,
    note:"CRUD smoke validates the frozen Adminerva DB artifact in isolation; Java/JDBC integration requires runtime verification."};
 }catch(error){
  return {present:true,schemaValid:false,crudSmokePassed:false,tables:[],error:clip(error.message,1000)};
 }
}
function shellQuote(value){return "'"+String(value).replace(/'/g,"'\"'\"'")+"'";}
async function judge0Verify({files,profile,stdin=""}){
 const main=javaMain(files);
 if(!main.mainClass)return {attempted:false,status:"no_main",
   compileSucceeded:null,runAttempted:false,runSucceeded:null,
   message:"No Java static void main(...) entry point was found in the frozen files."};
 try{
  const javaFiles=files.filter(file=>/\.java$/i.test(file.path)).map(file=>shellQuote(file.path));
  const compileOnly=profile.swing===true||profile.database===true;
  const additional_files=zipBase64([
   ...files.map(file=>[file.path,file.content]),
   ["compile","#!/bin/bash\nset -e\njavac -encoding UTF-8 -d . "+javaFiles.join(" ")+"\n"],
   ["run","#!/bin/bash\nset -e\n"+(compileOnly?"true":"timeout 12s java "+shellQuote(main.mainClass))+"\n"]
  ]);
  const start=await fetch(JUDGE0_ORIGIN+"/submissions?base64_encoded=false&wait=false",{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({language_id:89,additional_files,stdin:compileOnly?"":clip(stdin,6000),
     cpu_time_limit:8,wall_time_limit:20}),signal:AbortSignal.timeout(12000)
  });
  if(!start.ok)throw Error("Judge0 submission returned "+start.status);
  let result=await start.json();
  if(!result.token)throw Error("Judge0 did not return a verification token.");
  const deadline=Date.now()+45000;
  while((!result.status||Number(result.status.id)<=2)&&Date.now()<deadline){
   await sleep(850);
   const poll=await fetch(JUDGE0_ORIGIN+"/submissions/"+encodeURIComponent(result.token)+
    "?base64_encoded=false&fields=stdout,stderr,compile_output,message,status,time,memory,exit_code",
    {signal:AbortSignal.timeout(12000)});
   if(!poll.ok)throw Error("Judge0 verification poll returned "+poll.status);
   result=await poll.json();
  }
  if(!result.status||Number(result.status.id)<=2)throw Error("Judge0 verification timed out.");
  const statusId=Number(result.status.id),compileSucceeded=statusId!==6;
  return {
   attempted:true,engine:"judge0",entry:main.entry,mainClass:main.mainClass,
   status:clip(result.status.description||"finished",120),statusId,
   compileSucceeded,runAttempted:compileSucceeded&&!compileOnly,
   runSucceeded:compileSucceeded&&!compileOnly?statusId===3:null,
   exitCode:Number.isFinite(Number(result.exit_code))?Number(result.exit_code):null,
   stdout:clip(result.stdout,16000),stderr:clip(result.stderr,12000),
   compileOutput:clip(result.compile_output,12000),message:clip(result.message,2000),
   time:Number.isFinite(Number(result.time))?Number(result.time):null,
   memory:Number.isFinite(Number(result.memory))?Number(result.memory):null
  };
 }catch(error){
  return {attempted:true,engine:"judge0",entry:main.entry,mainClass:main.mainClass,
    status:"service_unavailable",compileSucceeded:null,runAttempted:false,runSucceeded:null,
    message:clip(error.message,1000)};
 }
}
async function dedicatedRuntimeVerify({files,profile,database,sourceDigestValue,task,stdin=""}){
 if(!RUNTIME_ORIGIN||!RUNTIME_TOKEN)return {
   attempted:false,status:"not_configured",
   message:"Dedicated Adminerva desktop/database runtime verification is not configured on the Firebase backend."
 };
 try{
  const main=javaMain(files);
  if(!main.mainClass)return {attempted:false,status:"no_main",message:"No Java main entry point found."};
  const response=await fetch(RUNTIME_ORIGIN+"/v1/verifications",{
   method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+RUNTIME_TOKEN},
   body:JSON.stringify({
    files:Object.fromEntries(files.map(file=>[file.path,file.content])),entry:main.entry,
    profile:profile.id,sourceDigest:sourceDigestValue,database:database||null,
    uiExpectations:task?.verificationConfig?.ui||null,
    databaseChecks:task?.verificationConfig?.databaseChecks||null,
    stdin:clip(stdin,6000)
   }),signal:AbortSignal.timeout(35000)
  });
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw Error(data.error||"Runtime verification returned "+response.status);
  return {...data,attempted:true};
 }catch(error){
  return {attempted:true,status:"service_unavailable",message:clip(error.message,1000)};
 }
}
function normalizeFiles(snapshot){
 if(Array.isArray(snapshot.files))return snapshot.files.map(file=>({path:String(file.path),content:String(file.content||"")}));
 return Object.entries(snapshot.files||{}).map(([path,content])=>({path,content:String(content||"")})).sort((a,b)=>a.path.localeCompare(b.path));
}
async function verifyFrozenSubmission({snapshot,task}){
 const files=normalizeFiles(snapshot),language=String(snapshot.sourceLanguage||snapshot.language||snapshot.lang||"").toLowerCase();
 const digest=sourceDigest(files,language),profile=inferProfile(task,{...snapshot,files});
 const limitations=[];
 const historicalRuns=Array.isArray(snapshot.executionEvidence?.runs)?snapshot.executionEvidence.runs:
   Array.isArray(snapshot.artifacts?.evidence?.runs)?snapshot.artifacts.evidence.runs:[];
 const matchingInput=historicalRuns.find(run=>run?.sourceDigest===digest&&String(run?.stdin||"").length)?.stdin||"";
 const verificationInput=String(task?.verificationConfig?.stdin??matchingInput??"").slice(0,6000);
 if(profile.id==="unsupported")return {
   verificationVersion:VERIFY_VERSION,verifiedAt:Date.now(),profile,sourceDigest:digest,
   matchesSubmittedSource:true,status:"not_applicable",
   compile:{attempted:false},runtime:{attempted:false},gui:{attempted:false},
   database:verifyDatabaseArtifact(databaseArtifact(snapshot)),
   limitations:["Automatic runtime verification currently targets Java Studio submissions."]
 };
 const compileRun=await judge0Verify({files,profile,stdin:verificationInput});
 const database=verifyDatabaseArtifact(databaseArtifact(snapshot));
 let dedicated={attempted:false,status:"not_required"};
 if(profile.swing||profile.database){
  dedicated=await dedicatedRuntimeVerify({
    files,profile,database:databaseArtifact(snapshot),sourceDigestValue:digest,task,stdin:verificationInput
  });
  if(dedicated.status==="not_configured")
   limitations.push("Dedicated desktop/database runtime verification is not configured; compile and frozen database-artifact checks remain available.");
  if(dedicated.status==="service_unavailable")
   limitations.push("Dedicated desktop/database runtime verification was temporarily unavailable.");
 }
 if(profile.database&&database.present&&database.schemaValid!==true)
  limitations.push("The frozen Adminerva DB artifact failed structural verification.");
 const gui=profile.swing?{
   attempted:dedicated.attempted===true,
   status:dedicated.gui?.status||dedicated.desktopLaunch?.status||dedicated.status||"not_configured",
   ...(dedicated.gui||{}),inventory:dedicated.gui?.inventory||null
 }:{attempted:false,status:"not_applicable"};
 const dedicatedRuntime=dedicated?.runtime&&typeof dedicated.runtime==="object"?dedicated.runtime:null;
 const runtime=(profile.swing||profile.database)?{
   attempted:dedicatedRuntime?dedicatedRuntime.attempted!==false:dedicated.attempted===true,
   status:dedicatedRuntime?.status||dedicated.desktopLaunch?.status||dedicated.status||
     (profile.database?"requires_database_runtime":"compile_only"),
   runSucceeded:dedicatedRuntime?.runSucceeded??dedicated.desktopLaunch?.succeeded??null,
   exitCode:dedicatedRuntime?.exitCode??null,
   stdout:clip(dedicatedRuntime?.stdout,16000),stderr:clip(dedicatedRuntime?.stderr,12000)
 }:{
   attempted:compileRun.runAttempted===true,
   status:compileRun.status,runSucceeded:compileRun.runSucceeded,
   exitCode:compileRun.exitCode,stdout:compileRun.stdout||"",stderr:compileRun.stderr||""
 };
 return {
   verificationVersion:VERIFY_VERSION,verifiedAt:Date.now(),profile,sourceDigest:digest,
   matchesSubmittedSource:true,status:"completed",
   compile:{
    attempted:compileRun.attempted===true,status:compileRun.status,
    succeeded:compileRun.compileSucceeded,engine:compileRun.engine||"",
    entry:compileRun.entry||"",mainClass:compileRun.mainClass||"",
    output:compileRun.compileOutput||"",stderr:compileRun.stderr||""
   },
   runtime,gui,
   database:{
    ...database,
    runtimeIntegration:profile.database?{
      attempted:dedicated.attempted===true,
      status:dedicated.database?.status||dedicated.status||"not_configured",
      ...(dedicated.database||{})
    }:{attempted:false,status:"not_applicable"}
   },
   limitations
 };
}
function createStudioAutoVerification({db}){
 async function enrichLegacy(event){
  const snap=event.data;if(!snap?.exists)return;
  const data=snap.data()||{},assessmentId=String(data.assessmentId||"");
  if(!assessmentId)return;
  const task=await db.doc("assessments/"+assessmentId).get();
  const verification=await verifyFrozenSubmission({snapshot:{
    ...JSON.parse(String(data.snapshotJson||"{}")),sourceLanguage:JSON.parse(String(data.snapshotJson||"{}")).lang
  },task:task.exists?task.data():{}});
  await snap.ref.set({verification},{merge:true});
 }
 async function enrichSchool(event){
  const snap=event.data;if(!snap?.exists)return;
  const data=snap.data()||{},schoolId=String(event.params?.schoolId||data.schoolId||""),
    taskId=String(data.taskId||"");
  if(!schoolId||!taskId)return;
  const task=await db.doc("schools/"+schoolId+"/assessments/"+taskId).get();
  const verification=await verifyFrozenSubmission({snapshot:data,task:task.exists?task.data():{}});
  await snap.ref.set({verification},{merge:true});
 }
 return {enrichLegacy,enrichSchool,verifyFrozenSubmission};
}
module.exports={createStudioAutoVerification,verifyFrozenSubmission,sourceDigest,inferProfile,verifyDatabaseArtifact};
