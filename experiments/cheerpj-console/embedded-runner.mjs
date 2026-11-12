/**
 * The Java runner is hosted on a separate HTTPS origin from Adminerva.
 * Its only communication with Studio is a validated postMessage protocol.
 * Never add Firebase, student identities, project persistence or grading here.
 */
import {createConsoleBridge} from './console-bridge.mjs';

const CHANNEL='adminerva-cheerpj-studio-v1';
const PARENTS=new Set(['https://adminerva-org.github.io','http://localhost:8080']);
const session=new URLSearchParams(location.search).get('session')||'';
const validSession=/^[a-f0-9-]{36}$/i.test(session);
// The GitHub Pages copy is source-only. Java is never allowed to execute on
// Adminerva's authenticated origin, even if this file is publicly accessible.
const validHost=location.protocol==='https:' && location.origin!=='https://adminerva-org.github.io';
const encode=new TextEncoder();
let parentOrigin=null,started=false,running=false,bridge=null;
let library=null,runRoot=null,heartbeat=null;

function send(type,data={}){
  if(parentOrigin)window.parent.postMessage({channel:CHANNEL,session,type,...data},parentOrigin);
}
function status(state,message){send('status',{state,message});}
function fail(error){send('error',{message:(error?.message||String(error)).slice(0,500)});}
function sourcePathSafe(path){
  return typeof path==='string' && /^[A-Za-z0-9_.\-/]+\.java$/.test(path) &&
    !path.split('/').some(part=>!part||part==='.'||part==='..');
}
function validateRun(files,entry){
  if(!files||Array.isArray(files)||typeof files!=='object'||
     typeof entry!=='string'||!sourcePathSafe(entry)||!Object.hasOwn(files,entry)){
    throw Error('Invalid Java project entry.');
  }
  const entries=Object.entries(files);
  if(entries.length<1||entries.length>40)throw Error('Java project must contain 1–40 source files.');
  let size=0;
  for(const [path,source] of entries){
    if(!sourcePathSafe(path)||typeof source!=='string'){
      throw Error('Only safe Java source paths are supported.');
    }
    size+=encode.encode(source).length;
    if(size>250000)throw Error('Java source exceeds 250 KB.');
  }
  return entries;
}
function javaMainClass(entry,source){
  const basename=entry.split('/').at(-1).replace(/\.java$/i,'');
  const pkg=String(source).match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m)?.[1];
  return (pkg?pkg+'.':'')+basename;
}
async function getLibrary(){
  if(!library)library=await window.cheerpjRunLibrary('');
  return library;
}
async function makeDirectory(path){
  const File=await (await getLibrary()).java.io.File;
  await (await new File(path)).mkdirs();
}
async function writeSources(entries,sourceRoot){
  const lib=await getLibrary(),paths=await lib.java.nio.file.Paths;
  const files=await lib.java.nio.file.Files;
  const File=await lib.java.io.File;
  for(const [path,source] of entries){
    const destination=sourceRoot+'/'+path;
    const parent=destination.slice(0,destination.lastIndexOf('/'));
    await (await new File(parent)).mkdirs();
    const data=encode.encode(source);
    await files.write(await paths.get(destination,[]),
      new Int8Array(data.buffer,data.byteOffset,data.byteLength),[]);
  }
}
async function removeTree(path){
  if(!path)return;
  const File=await (await getLibrary()).java.io.File;
  async function walk(file){
    if(await file.isDirectory()){
      const children=await file.listFiles();
      for(let i=0;i<(children?.length||0);i++)await walk(children[i]);
    }
    await file.delete();
  }
  await walk(await new File(path));
}
async function execute(files,entry){
  let completed=null,failed=null;
  heartbeat=setInterval(()=>send('heartbeat'),10000);
  try{
    const entries=validateRun(files,entry);
    status('loading','Loading CheerpJ 5 / Java 17…');
    if(typeof window.cheerpjInit!=='function'){
      throw Error('CheerpJ loader is unavailable. Check Internet access or the runtime host.');
    }
    await window.cheerpjInit({version:17,status:'none',clipboardMode:'java'});
    window.cheerpjCreateDisplay(-1,-1,document.getElementById('display'));
    bridge=createConsoleBridge(window,chunk=>send('output',{text:chunk}));
    runRoot='/files/adminerva_studio_'+session.replaceAll('-','');
    const src=runRoot+'/src',classes=runRoot+'/classes';
    await makeDirectory(classes);
    await makeDirectory(src);
    // Source file paths may include directories and package names, so use
    // CheerpJ's documented writable /files/ mount instead of /str/ injection.
    await writeSources(entries,src);
    status('compiling','Compiling '+entries.length+' Java file'+(entries.length===1?'':'s')+'…');
    const compileCode=await window.cheerpjRunMain(
      'com.sun.tools.javac.Main','',
      '-encoding','UTF-8','-d',classes,
      ...entries.map(([path])=>src+'/'+path)
    );
    if(compileCode!==0){
      completed={code:compileCode,compileFailed:true};
    }else{
      bridge.clearQueuedInput();
      bridge.resetOutputLimit();
      running=true;
      status('running','Java is live. Enter a line when the program asks for input.');
      const exitCode=await window.cheerpjRunMain(javaMainClass(entry,files[entry]),classes);
      completed={code:exitCode,compileFailed:false};
    }
  }catch(error){
    failed=error;
  }finally{
    running=false;
    bridge?.endRun();
    clearInterval(heartbeat);
    heartbeat=null;
    // This is best-effort: stopping the iframe can interrupt cleanup.
    // Every run has a unique directory so stale bytecode is never reused.
    try{await removeTree(runRoot)}catch(e){console.warn('Java temporary file cleanup:',e)}
    if(failed)fail(failed);
    else if(completed)send('finished',completed);
  }
}
if(!validSession||!validHost){
  document.body.textContent='The Java runner is inactive on this origin or session.';
}else{
  window.addEventListener('message',event=>{
    const data=event.data;
    if(event.source!==window.parent||event.origin===location.origin||
       !PARENTS.has(event.origin)||!data||
       data.channel!==CHANNEL||data.session!==session)return;
    if(data.type==='hello'&&!parentOrigin){
      parentOrigin=event.origin;
      send('ready');
    }else if(data.type==='run'&&parentOrigin===event.origin&&!started){
      started=true;
      void execute(data.files,data.entry);
    }else if(data.type==='input'&&parentOrigin===event.origin&&running&&bridge){
      if(typeof data.text==='string'&&data.text.length<=2000&&!/[\r\n]/.test(data.text)){
        try{bridge.sendLine(data.text)}
        catch(error){send('output',{text:'\n[Terminal input refused: '+error.message+']\n'});}
      }
    }
  });
}
