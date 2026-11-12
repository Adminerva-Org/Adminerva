/**
 * Run only on an independently hosted HTTPS origin, in an iframe.
 * Do not copy this file into a signed-in Adminerva page.
 *
 * The parent sends a frozen source snapshot with postMessage. No Firebase IDs,
 * auth tokens, student identities, assessment data, or origin credentials are sent.
 */
import {createConsoleBridge} from './console-bridge.mjs';

const CHANNEL='adminerva-cheerpj-studio-v1';
const PARENTS=new Set(['https://adminerva-org.github.io','http://localhost:8080']);
const session=new URLSearchParams(location.search).get('session')||'';
const validSession=/^[a-f0-9-]{36}$/i.test(session);
let parentOrigin=null, started=false, running=false, bridge=null;
let library=null;
const encode=new TextEncoder();
let compiledDirectory=null;
function send(type,data={}) {
  if (!parentOrigin) return;
  window.parent.postMessage({channel:CHANNEL,session,type,...data},parentOrigin);
}
function status(state,message) {send('status',{state,message});}
function fail(error){
  send('error',{message:(error?.message||String(error)).slice(0,500)});
}
function sourcePathSafe(path){
  return typeof path==='string' && /^[A-Za-z0-9_.\-/]+\.java$/.test(path) &&
    !path.split('/').some(part=>!part||part==='.'||part==='..');
}
function validateRun(files,entry){
  if (!files || Array.isArray(files) || typeof files!=='object' ||
      typeof entry!=='string' || !sourcePathSafe(entry) ||
      !Object.hasOwn(files,entry)) throw Error('Invalid Java project entry.');
  const entries=Object.entries(files);
  if(entries.length<1||entries.length>40)throw Error('Java project must contain 1–40 source files.');
  let size=0;
  for(const [path,source] of entries){
    if(!sourcePathSafe(path)||typeof source!=='string')throw Error('Only safe .java paths are supported.');
    size+=encode.encode(source).length;
    if(size>250000)throw Error('Java project exceeds 250 KB.');
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
async function removeTree(path){
  if(!path)return;
  const File=await (await getLibrary()).java.io.File;
  async function walk(file) {
    if(await file.isDirectory()){
      const entries=await file.listFiles();
      for(let i=0;i<(entries?.length||0);i++)await walk(entries[i]);
    }
    await file.delete();
  }
  await walk(await new File(path));
}
async function execute(files,entry){
  let completed=null,failed=null;
  try{
    const entries=validateRun(files,entry);
    status('loading','Loading browser Java 17 (CheerpJ)…');
    if(typeof window.cheerpjInit!=='function')throw Error('CheerpJ loader unavailable. Check the runtime host and network.');
    await window.cheerpjInit({version:17,status:'none'});
    window.cheerpjCreateDisplay(-1,-1,document.getElementById('display'));
    bridge=createConsoleBridge(window,chunk=>send('output',{text:chunk}));
    compiledDirectory='/files/adminerva_studio_'+session.replaceAll('-','')+'/classes';
    await makeDirectory(compiledDirectory);
    for(const [path,source] of entries)window.cheerpOSAddStringFile('/str/'+path,source);
    status('compiling','Compiling '+entries.length+' Java source file'+(entries.length===1?'':'s')+'…');
    const compileCode=await window.cheerpjRunMain(
      'com.sun.tools.javac.Main','',
      '-encoding','UTF-8','-d',compiledDirectory,
      ...entries.map(([path])=>'/str/'+path)
    );
    if(compileCode!==0){
      completed={code:compileCode,compileFailed:true};
    }else{
      bridge.clearQueuedInput();
      bridge.resetOutputLimit();
      status('running','Java running — type an input line when prompted.');
      running=true;
      const mainClass=javaMainClass(entry,files[entry]);
      const exitCode=await window.cheerpjRunMain(mainClass,compiledDirectory);
      running=false;
      completed={code:exitCode,compileFailed:false};
    }
  }catch(error){
    running=false;
    failed=error;
  }finally{
    bridge?.endRun();
    // A per-run directory avoids stale bytecode; cleanup must complete before
    // the parent destroys this iframe. Interrupted runs can leave temp files.
    try{await removeTree(compiledDirectory?.replace(/\/classes$/,''))}catch(e){console.warn('CheerpJ temporary files cleanup:',e)}
    if(failed)fail(failed);
    else if(completed)send('finished',completed);
  }
}

if(!validSession){
  document.body.textContent='Invalid session.';
}else{
  window.addEventListener('message',event=>{
    const data=event.data;
    if(event.source!==window.parent||!PARENTS.has(event.origin)||
       !data||data.channel!==CHANNEL||data.session!==session)return;
    if(data.type==='hello'&&!parentOrigin){
      parentOrigin=event.origin;
      send('ready');
    }else if(data.type==='run'&&parentOrigin===event.origin&&!started){
      started=true;
      void execute(data.files,data.entry);
    }else if(data.type==='input'&&parentOrigin===event.origin&&running&&bridge){
      if(typeof data.text==='string'&&data.text.length<=2000){
        try{bridge.sendLine(data.text)}catch(e){send('output',{text:'\n[Input refused: '+e.message+']\n'})}
      }
    }
  });
}
