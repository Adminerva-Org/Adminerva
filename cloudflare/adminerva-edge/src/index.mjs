/**
 * Adminerva Cloudflare foundation — deliberately service-to-service only.
 *
 * This Worker is not a Firebase authorization replacement and does not accept
 * browser Firebase tokens. A trusted Firebase Function must authorize the
 * teacher, school, retention policy and action before calling this API.
 *
 * Nothing below is activated by the repository being deployed to GitHub Pages.
 * Cloudflare deployment, bindings, secrets and explicit flags are required.
 */
const SCHOOL_ID=/^[A-Za-z0-9_-]{1,128}$/;
const REFERENCE_ID=/^[a-f0-9-]{36}$/i;
const MAX_PDF_BYTES=50*1024*1024;
const MAX_JOB_BYTES=4096;
const ALLOWED_JOBS=new Set(['reference_pdf_extract','evaluation_batch']);
const responseHeaders={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer'
};

function json(data,status=200) {
  return new Response(JSON.stringify(data),{status,headers:responseHeaders});
}
function fail(status,code) {
  return json({ok:false,code},status);
}
function stringIs(value,pattern){return typeof value==='string'&&pattern.test(value);}
function constantTimeEqual(a,b) {
  // No secret-dependent early return once both strings are converted to bytes.
  const left=new TextEncoder().encode(String(a||''));
  const right=new TextEncoder().encode(String(b||''));
  let difference=left.length^right.length;
  for(let i=0;i<Math.max(left.length,right.length);i++)
    difference|=(left[i]||0)^(right[i]||0);
  return difference===0;
}
function authorized(request,env){
  const expected=env.ADMINERVA_EDGE_SECRET;
  if(typeof expected!=='string'||expected.length<32)return false;
  const supplied=request.headers.get('authorization')||'';
  return supplied.startsWith('Bearer ')&&constantTimeEqual(supplied.slice(7),expected);
}
function storageKey(schoolId,id){return 'schools/'+schoolId+'/reference-library/'+id+'.pdf';}
function validLength(request,maximum){
  const length=request.headers.get('content-length');
  if(!/^\d+$/.test(length||''))return null;
  const size=Number(length);
  return Number.isSafeInteger(size)&&size>0&&size<=maximum?size:null;
}
function readyFlag(env,key){
  return env?.[key]==='true';
}
function noOpenCors(){
  // Service-to-service only: never reflect arbitrary browser origins.
  return {'access-control-allow-origin':'null'};
}

async function handleUpload(request,env){
  if(!readyFlag(env,'EDGE_R2_ENABLED')||!env.ADMINERVA_REFERENCES)
    return fail(503,'storage_not_enabled');
  // The caller must enforce Adminerva's per-school file-policy and retention
  // settings. This assertion is defense in depth, not a school authorization.
  if(request.headers.get('x-adminerva-school-storage-opt-in')!=='true')
    return fail(403,'school_storage_opt_in_required');
  const schoolId=request.headers.get('x-adminerva-school-id');
  if(!stringIs(schoolId,SCHOOL_ID))return fail(400,'invalid_school_id');
  if(!/^application\/pdf(?:\s*;.*)?$/i.test(request.headers.get('content-type')||''))
    return fail(415,'pdf_only');
  const size=validLength(request,MAX_PDF_BYTES);
  if(size===null)return fail(413,'invalid_pdf_size_or_content_length');
  if(!request.body)return fail(400,'empty_document');
  const id=crypto.randomUUID();
  const key=storageKey(schoolId,id);
  await env.ADMINERVA_REFERENCES.put(key,request.body,{
    httpMetadata:{contentType:'application/pdf'},
    customMetadata:{type:'reference-pdf',schoolId,storedAt:new Date().toISOString()},
  });
  // R2 is private: never expose a public object URL or presigned credential.
  return json({ok:true,id,bytes:size},201);
}
async function handleReference(request,env,schoolId,id){
  if(!readyFlag(env,'EDGE_R2_ENABLED')||!env.ADMINERVA_REFERENCES)
    return fail(503,'storage_not_enabled');
  if(!stringIs(schoolId,SCHOOL_ID)||!stringIs(id,REFERENCE_ID))
    return fail(400,'invalid_reference');
  const key=storageKey(schoolId,id);
  if(request.method==='DELETE'){
    await env.ADMINERVA_REFERENCES.delete(key);
    return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
  }
  const object=await env.ADMINERVA_REFERENCES.get(key);
  if(!object)return fail(404,'not_found');
  return new Response(object.body,{status:200,headers:{
    'content-type':'application/pdf',
    'cache-control':'private, no-store',
    'content-disposition':'attachment; filename="reference.pdf"',
    'x-content-type-options':'nosniff'
  }});
}
async function handleJob(request,env){
  if(!readyFlag(env,'EDGE_QUEUES_ENABLED')||!env.ADMINERVA_JOBS||
     !/^https:\/\//.test(env.JOB_PROCESSOR_URL||'')||
     typeof env.JOB_PROCESSOR_TOKEN!=='string'||env.JOB_PROCESSOR_TOKEN.length<32)
    return fail(503,'job_processing_not_configured');
  const size=validLength(request,MAX_JOB_BYTES);
  if(size===null)return fail(413,'invalid_job_size_or_content_length');
  let payload;
  try{payload=await request.json();}catch{return fail(400,'invalid_json');}
  if(!payload||Array.isArray(payload)||typeof payload!=='object'||
     !ALLOWED_JOBS.has(payload.kind)||
     !stringIs(payload.schoolId,SCHOOL_ID)||
     !stringIs(payload.referenceId,REFERENCE_ID)||
     Object.keys(payload).some(x=>!['kind','schoolId','referenceId'].includes(x))) {
    return fail(400,'invalid_job_metadata');
  }
  // Only opaque pointers, not PDFs, prompts, teacher notes, student source or
  // AI credentials, cross the queue boundary.
  const job={...payload,jobId:crypto.randomUUID(),schema:1,requestedAt:new Date().toISOString()};
  await env.ADMINERVA_JOBS.send(job);
  return json({ok:true,jobId:job.jobId,status:'queued'},202);
}

export async function handleRequest(request,env){
  try{
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/health')
      return json({service:'adminerva-edge',status:'staged',publicData:false});
    if(!url.pathname.startsWith('/v1/internal/'))return fail(404,'not_found');
    if(!readyFlag(env,'EDGE_API_ENABLED'))return fail(503,'edge_api_disabled');
    if(!authorized(request,env))return fail(401,'unauthorized');
    if(request.method==='POST'&&url.pathname==='/v1/internal/references')
      return await handleUpload(request,env);
    const match=url.pathname.match(/^\/v1\/internal\/references\/([A-Za-z0-9_-]+)\/([a-f0-9-]{36})$/i);
    if(match&&['GET','DELETE'].includes(request.method))
      return await handleReference(request,env,match[1],match[2]);
    if(request.method==='POST'&&url.pathname==='/v1/internal/jobs')
      return await handleJob(request,env);
    return fail(404,'not_found');
  }catch(error){
    // Avoid logging tokens, school/student data or upstream response bodies.
    console.error('Adminerva edge operation failed',String(error?.name||'Error'));
    return fail(503,'edge_operation_failed');
  }
}

export async function processQueue(batch,env){
  const configured=readyFlag(env,'EDGE_QUEUES_ENABLED')&&
    typeof env.JOB_PROCESSOR_URL==='string'&&
    /^https:\/\//.test(env.JOB_PROCESSOR_URL)&&
    typeof env.JOB_PROCESSOR_TOKEN==='string'&&
    env.JOB_PROCESSOR_TOKEN.length>=32;
  for(const message of batch.messages){
    if(!configured){message.retry();continue;}
    const job=message.body;
    if(!job||job.schema!==1||!ALLOWED_JOBS.has(job.kind)||
       !stringIs(job.schoolId,SCHOOL_ID)||
       !stringIs(job.referenceId,REFERENCE_ID)||!stringIs(job.jobId,REFERENCE_ID)){
      // Invalid queue metadata is discarded without exposing it.
      message.ack();
      continue;
    }
    try{
      const response=await fetch(env.JOB_PROCESSOR_URL,{
        method:'POST',
        headers:{
          'authorization':'Bearer '+env.JOB_PROCESSOR_TOKEN,
          'content-type':'application/json'
        },
        body:JSON.stringify(job),
        signal:AbortSignal.timeout(20000)
      });
      if(response.ok)message.ack();
      else message.retry();
    }catch(error){message.retry();}
  }
}
export default {
  fetch(request,env){return handleRequest(request,env);},
  queue(batch,env){return processQueue(batch,env);}
};
