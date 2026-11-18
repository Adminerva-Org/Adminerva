import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,chmod,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

const OUTPUT_LIMIT=256000;
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
function digestFiles(files){
  const rows=Object.entries(files).sort(([a],[b])=>a.localeCompare(b))
    .map(([filePath,content])=>({path:filePath,content:String(content)}));
  return createHash("sha256").update(canonicalJson({language:"java",files:rows})).digest("hex");
}
function qid(value){return '"'+String(value).replace(/"/g,'""')+'"';}
function sqlValue(value){
  if(value===null||value===undefined)return "NULL";
  if(typeof value==="number"&&Number.isFinite(value))return String(value);
  if(typeof value==="boolean")return value?"1":"0";
  return "'"+String(value).replace(/'/g,"''")+"'";
}
function sqliteType(value){
  const type=String(value||"TEXT").toUpperCase();
  if(/INT|BOOL/.test(type))return "INTEGER";
  if(/REAL|NUM|DEC|DOUBLE|FLOAT/.test(type))return "REAL";
  if(/BLOB/.test(type))return "BLOB";
  return "TEXT";
}
function databaseSql(database){
  const tables=database?.tables&&typeof database.tables==="object"?database.tables:{};
  const sql=["PRAGMA foreign_keys=ON;","BEGIN;"];
  let tableCount=0;
  for(const [name,table] of Object.entries(tables)){
    if(!/^[A-Za-z_][\w]*$/.test(name)||!Array.isArray(table?.columns)||!Array.isArray(table?.rows))continue;
    const columns=table.columns.filter(column=>/^[A-Za-z_][\w]*$/.test(String(column?.name||"")));
    if(!columns.length)continue;
    tableCount++;
    sql.push("DROP TABLE IF EXISTS "+qid(name)+";");
    sql.push("CREATE TABLE "+qid(name)+" ("+columns.map(column=>
      qid(column.name)+" "+sqliteType(column.type)+(column.primaryKey===true?" PRIMARY KEY":"")
    ).join(", ")+");");
    for(const row of table.rows){
      if(!row||typeof row!=="object"||Array.isArray(row))continue;
      sql.push("INSERT INTO "+qid(name)+" ("+columns.map(column=>qid(column.name)).join(",")+
        ") VALUES ("+columns.map(column=>sqlValue(row[column.name])).join(",")+");");
    }
  }
  sql.push("COMMIT;");
  return tableCount?sql.join("\n"):"";
}
function sanitizeChecks(value){
  if(!Array.isArray(value))return [];
  return value.slice(0,12).map((item,index)=>{
    if(!item||typeof item!=="object")return null;
    const sql=String(item.sql||"").trim();
    if(!/^SELECT\b/i.test(sql)||sql.length>800||/[;]\s*\S/.test(sql))return null;
    return {
      index,name:clip(item.name||("Database check "+(index+1)),120),sql,
      expectedContains:item.expectedContains===undefined?null:clip(item.expectedContains,500)
    };
  }).filter(Boolean);
}
function evaluateUiExpectations(inventory,expectations){
  if(!expectations||typeof expectations!=="object"||!inventory)return {configured:false,passed:null,checks:[]};
  const checks=[];
  const numeric=[["minVisibleWindows","visibleWindows"],["minButtons","buttons"],["minTextFields","textFields"],
    ["minTables","tables"],["minTextAreas","textAreas"],["minComboBoxes","comboBoxes"]];
  for(const [key,field] of numeric){
    if(Number.isFinite(Number(expectations[key]))){
      const required=Math.max(0,Number(expectations[key])),actual=Number(inventory[field]||0);
      checks.push({name:key,passed:actual>=required,expected:required,actual});
    }
  }
  if(Array.isArray(expectations.requiredButtons)){
    for(const label of expectations.requiredButtons.slice(0,20)){
      const expected=String(label),actual=Array.isArray(inventory.buttonLabels)?inventory.buttonLabels:[];
      checks.push({name:"button:"+expected,passed:actual.includes(expected),expected,actual});
    }
  }
  if(expectations.windowTitleContains){
    const expected=String(expectations.windowTitleContains),titles=Array.isArray(inventory.windowTitles)?inventory.windowTitles:[];
    checks.push({name:"windowTitleContains",passed:titles.some(title=>String(title).includes(expected)),expected,actual:titles});
  }
  return {configured:checks.length>0,passed:checks.length?checks.every(check=>check.passed):null,checks};
}
function parseMarkers(stderr){
  const lines=String(stderr||"").split(/\r?\n/),stages={},dbChecks=[],guiLine=lines.find(line=>line.startsWith("__ADMINERVA_GUI__"));
  for(const line of lines){
    if(line.startsWith("__ADMINERVA_VERIFY__")){
      const body=line.slice("__ADMINERVA_VERIFY__".length),parts=Object.fromEntries(body.split(";")
        .map(piece=>piece.split("=",2)).filter(pair=>pair.length===2));
      if(parts.stage)stages[parts.stage]=parts;
    }else if(line.startsWith("__ADMINERVA_DB_CHECK__")){
      const body=line.slice("__ADMINERVA_DB_CHECK__".length),split=body.indexOf(":");
      if(split>0){
        const index=body.slice(0,split),encoded=body.slice(split+1);
        let output="";try{output=Buffer.from(encoded,"base64").toString("utf8");}catch{}
        dbChecks.push({index,output:clip(output,4000)});
      }
    }
  }
  let gui=null;
  if(guiLine)try{gui=JSON.parse(guiLine.slice("__ADMINERVA_GUI__".length));}catch{}
  const cleaned=lines.filter(line=>!line.startsWith("__ADMINERVA_")).join("\n").trim();
  return {stages,dbChecks,gui,cleanedStderr:cleaned};
}
async function prepareFolder(files,database,checks,stdin=""){
  const base=await mkdtemp(path.join(tmpdir(),"adminerva-verify-"));
  for(const [name,source] of Object.entries(files)){
    const full=path.join(base,...name.split("/"));
    await mkdir(path.dirname(full),{recursive:true});
    await writeFile(full,String(source),{mode:0o644});
    let dir=path.dirname(full);
    while(dir.startsWith(base)){await chmod(dir,0o755);if(dir===base)break;dir=path.dirname(dir);}
  }
  const sql=databaseSql(database);
  if(sql)await writeFile(path.join(base,"__adminerva_db.sql"),sql,{mode:0o644});
  if(String(stdin||"").length)await writeFile(path.join(base,"__adminerva_stdin.txt"),String(stdin).slice(0,6000),{mode:0o644});
  if(checks.length){
    const dir=path.join(base,"__adminerva_db_checks");await mkdir(dir,{recursive:true,mode:0o755});
    for(const check of checks)await writeFile(path.join(dir,String(check.index)+".sql"),check.sql+"\n",{mode:0o644});
  }
  return base;
}
export async function runAutomaticVerification({files,entry,mainClass,profile,sourceDigest,database,uiExpectations,databaseChecks,stdin="",image}){
  const computedDigest=digestFiles(files),matchesSubmittedSource=!sourceDigest||computedDigest===sourceDigest;
  if(!matchesSubmittedSource)return {status:"source_mismatch",sourceDigest:computedDigest,matchesSubmittedSource:false,
    compile:{succeeded:null},runtime:{runSucceeded:null},gui:{status:"not_run"},database:{status:"not_run"}};
  const checks=sanitizeChecks(databaseChecks);
  const folder=await prepareFolder(files,database,checks,stdin);
  const containerName="adminerva-verify-"+createHash("sha256").update(folder).digest("hex").slice(0,20);
  let stdout="",stderr="",code=null,timedOut=false;
  try{
    const args=["run","--rm","--name",containerName,
      "--network","none","--cpus","0.75","--memory","640m","--memory-swap","640m",
      "--pids-limit","96","--ulimit","nofile=96:96","--read-only",
      "--tmpfs","/tmp:rw,nosuid,nodev,size=192m,mode=1777",
      "--tmpfs","/workspace:rw,nosuid,nodev,size=128m,mode=1777",
      "--cap-drop","ALL","--security-opt","no-new-privileges",
      "--mount","type=bind,source="+folder+",target=/source,readonly",
      "--env","MAIN_CLASS="+mainClass,"--env","VERIFY_PROFILE="+profile,
      "--entrypoint","/usr/local/bin/adminerva-java-verify",image];
    const child=spawn("docker",args,{stdio:["ignore","pipe","pipe"]});
    const collect=(key,chunk)=>{
      const value=Buffer.from(chunk).toString("utf8");
      if(key==="stdout")stdout=(stdout+value).slice(-OUTPUT_LIMIT);
      else stderr=(stderr+value).slice(-OUTPUT_LIMIT);
      if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>OUTPUT_LIMIT*2)child.kill("SIGTERM");
    };
    child.stdout.on("data",chunk=>collect("stdout",chunk));
    child.stderr.on("data",chunk=>collect("stderr",chunk));
    const timer=setTimeout(()=>{timedOut=true;child.kill("SIGTERM");
      const killer=spawn("docker",["rm","-f",containerName],{stdio:"ignore"});killer.on("error",()=>{});},26000);
    code=await new Promise((resolve,reject)=>{
      child.on("close",value=>resolve(value??1));child.on("error",reject);
    });
    clearTimeout(timer);
    const parsed=parseMarkers(stderr),compileOk=parsed.stages.compile?.ok==="true";
    const runtimeExit=Number(parsed.stages.runtime?.exit);
    const isSwing=String(profile).startsWith("java_swing");
    const guiInventory=parsed.gui||null;
    const ui=evaluateUiExpectations(guiInventory,uiExpectations);
    const runtimeSucceeded=compileOk&&!timedOut&&(
      isSwing?Boolean(guiInventory&&Number(guiInventory.visibleWindows)>0):
      Number.isFinite(runtimeExit)&&runtimeExit===0
    );
    const checkResults=checks.map(check=>{
      const actual=parsed.dbChecks.find(item=>Number(item.index)===check.index)?.output??null;
      return {...check,output:actual,passed:actual!==null&&
        (check.expectedContains===null||String(actual).includes(check.expectedContains))};
    });
    return {
      status:timedOut?"timed_out":"completed",
      sourceDigest:computedDigest,matchesSubmittedSource:true,
      compile:{attempted:true,succeeded:compileOk,status:compileOk?"passed":"failed"},
      runtime:{attempted:compileOk,status:timedOut?"timed_out":runtimeSucceeded?"passed":"failed",
        runSucceeded:runtimeSucceeded,exitCode:Number.isFinite(runtimeExit)?runtimeExit:code,
        stdout:clip(stdout,16000),stderr:clip(parsed.cleanedStderr,12000)},
      gui:isSwing?{attempted:compileOk,status:guiInventory&&Number(guiInventory.visibleWindows)>0?"launched":"failed",
        inventory:guiInventory,expectations:ui}:{attempted:false,status:"not_applicable"},
      database:{
        attempted:Boolean(databaseSql(database)),
        status:parsed.stages.database_bootstrap?.ok==="true"?
          (parsed.stages.database_integrity?.ok==="true"?"passed":"integrity_failed"):"not_present_or_failed",
        bootstrapped:parsed.stages.database_bootstrap?.ok==="true",
        integrityPassed:parsed.stages.database_integrity?.ok==="true",
        checks:checkResults
      }
    };
  }finally{
    await rm(folder,{recursive:true,force:true}).catch(()=>{});
  }
}
