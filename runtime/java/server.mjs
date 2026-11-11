/** Adminerva Java runtime pilot: isolated Java processes and authenticated FIFO queue.
 * Not hosted by GitHub Pages. Requires a dedicated Linux server and rootless Docker.
 */
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WebSocketServer,WebSocket} from 'ws';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';

const origin=process.env.ALLOWED_ORIGIN?.trim();
if(!origin||!/^https:\/\//.test(origin))throw Error('ALLOWED_ORIGIN must be the exact HTTPS Studio origin.');
const positive=(key,defaultValue,max)=>Math.max(1,Math.min(max,Number.parseInt(process.env[key]||'',10)||defaultValue));
const MAX_ACTIVE=positive('MAX_ACTIVE_SESSIONS',8,64);
const MAX_PENDING=positive('MAX_PENDING_SESSIONS',200,2000);
const IDLE_MS=positive('IDLE_SESSION_SECONDS',300,3600)*1000;
const HARD_MS=positive('MAX_SESSION_SECONDS',900,7200)*1000;
const GRACE_MS=positive('DISCONNECT_GRACE_SECONDS',120,600)*1000;
const IMAGE=process.env.DOCKER_IMAGE||'adminerva/java17-runner:pilot';
const PORT=positive('PORT',8787,65535);
const BYTES_LIMIT=250000,FILE_LIMIT=60,OUTPUT_LIMIT=1024*1024,WS_BUFFER_LIMIT=512*1024;
initializeApp({credential:applicationDefault()});
const sessions=new Map(),queue=[],active=new Set(),byUser=new Map();
const wsServer=new WebSocketServer({noServer:true,handleProtocols:protocols=>protocols.has('adminerva-runtime')?'adminerva-runtime':false});
function serial(session){
  return {id:session.id,state:session.state,position:session.state==='queued'?queue.indexOf(session.id)+1:0,
    activeCount:active.size,activeLimit:MAX_ACTIVE,waitingCount:queue.length,createdAt:session.createdAt,
    ...(session.finishedAt?{finishedAt:session.finishedAt}:{})};
}
function send(session,payload){
  const message=JSON.stringify(payload);
  for(const ws of session.sockets){
    if(ws.readyState!==WebSocket.OPEN)continue;
    if(ws.bufferedAmount>WS_BUFFER_LIMIT){ws.close(1008,'Slow terminal consumer');continue;}
    ws.send(message);
  }
}
function status(session){send(session,{type:'status',...serial(session)});}
function notifyQueue(){for(const s of sessions.values())if(s.state==='queued'||s.state==='running')status(s);}
function json(res,code,payload){
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(payload));
}
function cors(req,res){
  const received=req.headers.origin;
  if(received&&received!==origin){json(res,403,{error:'Origin not allowed.'});return false;}
  if(received===origin){
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');
    res.setHeader('Vary','Origin');
  }
  return true;
}
async function verify(req){
  const token=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'')?.[1];
  if(!token)throw Object.assign(Error('Authentication required.'),{httpCode:401});
  const decoded=await getAuth().verifyIdToken(token,true);
  if(!decoded.uid)throw Object.assign(Error('Invalid identity.'),{httpCode:401});
  return decoded.uid;
}
async function readBody(req){
  let content='',size=0;
  for await(const part of req){
    size+=part.length;
    if(size>900000)throw Object.assign(Error('Request too large.'),{httpCode:413});
    content+=part.toString('utf8');
  }
  try{return JSON.parse(content);}catch{throw Object.assign(Error('Invalid JSON.'),{httpCode:400});}
}
function snapshotValidation(input){
  if(!input||typeof input!=='object'||!input.files||typeof input.files!=='object'||Array.isArray(input.files))
    throw Object.assign(Error('Java project files are required.'),{httpCode:400});
  const entries=Object.entries(input.files);
  if(entries.length===0||entries.length>FILE_LIMIT)throw Object.assign(Error('Project file limit exceeded.'),{httpCode:400});
  let size=0;
  const files={};
  for(const [filename,source] of entries){
    const segments=filename.split('/');
    if(segments.some(seg=>!seg||seg==='.'||seg==='..'||!/^[A-Za-z0-9_$.-]+$/.test(seg))||
       filename.startsWith('/')||filename.includes('\\')||filename.length>180||typeof source!=='string')
      throw Object.assign(Error('Only safe relative Java source paths are supported.'),{httpCode:400});
    size+=Buffer.byteLength(source,'utf8');
    if(size>BYTES_LIMIT)throw Object.assign(Error('Java source exceeds the 250 KB runtime limit.'),{httpCode:400});
    files[filename]=source;
  }
  const entry=String(input.entry||'');
  if(!Object.keys(files).some(name=>name.endsWith('.java')))
    throw Object.assign(Error('At least one Java source file is required.'),{httpCode:400});
  if(!Object.hasOwn(files,entry)||!entry.endsWith('.java'))throw Object.assign(Error('Select an existing Java entry file.'),{httpCode:400});
  const pkg=files[entry].match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m)?.[1];
  const base=path.posix.basename(entry,'.java');
  if(!/^[A-Za-z_$][\w$]*$/.test(base))throw Object.assign(Error('Invalid Java entry name.'),{httpCode:400});
  const mainClass=(pkg?pkg+'.':'')+base;
  return {files,entry,mainClass};
}
async function makeFiles(files){
  const base=await mkdtemp(path.join(tmpdir(),'adminerva-java-'));
  for(const [name,source] of Object.entries(files)){
    const full=path.join(base,...name.split('/'));
    await mkdir(path.dirname(full),{recursive:true});
    await writeFile(full,source,{mode:0o644});
    // Container's unprivileged uid needs read-only access to source directories.
    let dir=path.dirname(full);
    while(dir.startsWith(base)){await chmod(dir,0o755);if(dir===base)break;dir=path.dirname(dir);}
  }
  return base;
}
function emitOutput(session,type,buffer){
  if(session.state!=='running')return;
  const bytes=Buffer.byteLength(buffer);
  session.outputBytes=(session.outputBytes||0)+bytes;
  if(session.outputBytes>OUTPUT_LIMIT){
    const note='\n[Adminerva runtime] Output limit reached. This execution was stopped.\n';
    session.output=(session.output+note).slice(-131072);
    send(session,{type:'stderr',data:note});
    void finish(session,null,'failed');
    return;
  }
  const data=Buffer.from(buffer).toString('utf8');
  session.lastActivity=Date.now();
  session.output=(session.output+data).slice(-131072);
  send(session,{type,data});
}
async function finish(session,code,state='finished'){
  if(['finished','cancelled','failed','expired'].includes(session.state))return;
  session.state=state;session.finishedAt=Date.now();
  const wasActive=active.delete(session.id);
  const index=queue.indexOf(session.id);if(index>=0)queue.splice(index,1);
  byUser.delete(session.uid);
  if(session.idleTimer)clearInterval(session.idleTimer);
  if(session.hardTimer)clearTimeout(session.hardTimer);
  if(session.disconnectTimer)clearTimeout(session.disconnectTimer);
  if(session.admissionTimer)clearTimeout(session.admissionTimer);
  if(session.child&&!session.child.killed&&code===null)session.child.kill('SIGTERM');
  if(session.containerName){
    const remover=spawn('docker',['rm','-f',session.containerName],{stdio:'ignore'});
    remover.on('error',()=>{});
  }
  if(session.folder)await rm(session.folder,{recursive:true,force:true}).catch(()=>{});
  // The exit event must be delivered first: clients close the socket on a final state.
  send(session,{type:'exit',code,state});
  status(session);
  notifyQueue();
  if(wasActive)setImmediate(pump);
  const housekeeping=setTimeout(()=>sessions.delete(session.id),300000);
  housekeeping.unref?.();
}
async function startSession(session){
  session.state='running';session.lastActivity=Date.now();active.add(session.id);
  status(session);notifyQueue();
  try{
    session.folder=await makeFiles(session.files);
    if(session.state!=='running')return;
    session.containerName='adminerva-java-'+session.id.replace(/-/g,'').slice(0,28);
    const args=['run','--rm','--interactive','--name',session.containerName,
      '--network','none','--cpus','0.5','--memory','256m','--memory-swap','256m',
      '--pids-limit','64','--ulimit','nofile=64:64',
      '--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=100m',
      '--cap-drop','ALL','--security-opt','no-new-privileges',
      '--mount','type=bind,source='+session.folder+',target=/workspace,readonly',
      '--env','MAIN_CLASS='+session.mainClass,IMAGE];
    const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});
    session.child=child;
    child.stdin.on('error',()=>{}); // Broken pipe is normal if Java exits before a final input arrives.
    child.stdout.on('data',chunk=>emitOutput(session,'stdout',chunk));
    child.stderr.on('data',chunk=>emitOutput(session,'stderr',chunk));
    child.on('error',error=>{send(session,{type:'stderr',data:'Runtime launcher error: '+error.message});void finish(session,1,'failed');});
    child.on('close',code=>{void finish(session,code??1,code===0?'finished':'failed');});
    session.idleTimer=setInterval(()=>{
      if(Date.now()-session.lastActivity>IDLE_MS)void finish(session,null,'expired');
    },10000);
    session.hardTimer=setTimeout(()=>{void finish(session,null,'expired');},HARD_MS);
  }catch(error){
    send(session,{type:'stderr',data:'Runtime preparation failed: '+error.message});
    await finish(session,1,'failed');
  }
}
function pump(){
  while(active.size<MAX_ACTIVE&&queue.length){
    const id=queue.shift(),session=sessions.get(id);
    if(session?.state==='queued')void startSession(session);
  }
  notifyQueue();
}
function stopSession(session){
  if(session.state==='queued'||session.state==='running')return finish(session,null,'cancelled');
  return Promise.resolve();
}
const server=http.createServer(async(req,res)=>{
  if(!cors(req,res))return;
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(req.url==='/health'&&req.method==='GET'){json(res,200,{ok:true,active:active.size,queued:queue.length,activeLimit:MAX_ACTIVE});return;}
  try{
    const uid=await verify(req);
    if(req.url==='/v1/executions'&&req.method==='POST'){
      const parsed=snapshotValidation(await readBody(req));
      // Check after body ingestion to serialize admission for concurrent requests
      // from the same authenticated UID (e.g. two browser tabs).
      const existing=byUser.get(uid);
      if(existing&&['queued','running'].includes(sessions.get(existing)?.state))
        throw Object.assign(Error('You already have a queued or active Java session.'),{httpCode:409});
      // Busy queue reservations are separate from active worker slots.
      if(active.size>=MAX_ACTIVE&&queue.length>=MAX_PENDING)
        throw Object.assign(Error('Execution queue is full. Retry later.'),{httpCode:429});
      const id=randomUUID();
      const session={id,uid,...parsed,createdAt:Date.now(),lastActivity:Date.now(),
        state:'queued',streamToken:randomBytes(32).toString('hex'),sockets:new Set(),output:'',outputBytes:0};
      sessions.set(id,session);byUser.set(uid,id);queue.push(id);
      // A tab that closes before its WebSocket connects must not hold a queue spot.
      session.admissionTimer=setTimeout(()=>{
        if(session.sockets.size===0&&['queued','running'].includes(session.state))
          void stopSession(session);
      },GRACE_MS);
      session.admissionTimer.unref?.();
      pump();
      json(res,201,{...serial(session),streamToken:session.streamToken});
      return;
    }
    if(req.url==='/v1/executions/current'&&req.method==='GET'){
      const existing=byUser.get(uid),session=existing&&sessions.get(existing);
      if(!session||!['queued','running'].includes(session.state)){
        json(res,200,{active:false});return;
      }
      json(res,200,{active:true,...serial(session),streamToken:session.streamToken});
      return;
    }
    const match=/^\/v1\/executions\/([a-f0-9-]{36})$/.exec(req.url||'');
    if(match){
      const session=sessions.get(match[1]);
      if(!session||session.uid!==uid)throw Object.assign(Error('Session not found.'),{httpCode:404});
      if(req.method==='GET'){json(res,200,serial(session));return;}
      if(req.method==='DELETE'){await stopSession(session);json(res,200,{...serial(session)});return;}
    }
    json(res,404,{error:'Unknown route.'});
  }catch(error){
    const status=error.httpCode||((error.code==='auth/id-token-expired'||error.code==='auth/argument-error')?401:500);
    if(status===500)console.error('Runtime API error:',error);
    json(res,status,{error:status===500?'Runtime service unavailable.':error.message});
  }
});
server.on('upgrade',(req,socket,head)=>{
  if(req.headers.origin!==origin){socket.destroy();return;}
  const match=/^\/v1\/executions\/([a-f0-9-]{36})\/stream$/.exec(req.url||'');
  const protocols=String(req.headers['sec-websocket-protocol']||'').split(',').map(x=>x.trim());
  const secret=protocols.find(x=>/^key\.[0-9a-f]{64}$/.test(x))?.slice(4);
  const session=match&&sessions.get(match[1]);
  if(!session||!secret||secret!==session.streamToken){socket.destroy();return;}
  wsServer.handleUpgrade(req,socket,head,ws=>{
    session.sockets.add(ws);
    if(session.disconnectTimer){clearTimeout(session.disconnectTimer);session.disconnectTimer=null;}
    if(session.admissionTimer){clearTimeout(session.admissionTimer);session.admissionTimer=null;}
    // Replay buffered output first for a late connection to an already finished run.
    // Otherwise a terminal status may close the browser stream before its output arrives.
    if(session.output)ws.send(JSON.stringify({type:'stdout',data:session.output}));
    ws.send(JSON.stringify({type:'status',...serial(session)}));
    ws.on('message',raw=>{
      if(!session||session.state!=='running'||raw.length>16384)return;
      let data;try{data=JSON.parse(String(raw));}catch{return;}
      if(data.type==='stop'){void stopSession(session);return;}
      if(data.type==='stdin'&&typeof data.data==='string'&&data.data.length<=4096){
        session.lastActivity=Date.now();
        session.child?.stdin?.write(data.data);
      }
    });
    ws.on('close',()=>{
      session.sockets.delete(ws);
      if(!session.sockets.size&&['queued','running'].includes(session.state)){
        session.disconnectTimer=setTimeout(()=>{void stopSession(session);},GRACE_MS);
        session.disconnectTimer.unref?.();
      }
    });
  });
});
server.listen(PORT,'127.0.0.1',()=>console.log('Adminerva Java runtime listening on 127.0.0.1:'+PORT+'; active limit '+MAX_ACTIVE));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
