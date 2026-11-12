import assert from 'node:assert/strict';
import {test} from 'node:test';
import {handleRequest,processQueue} from './src/index.mjs';

const origin='https://api.adminerva-edge.example';
const token='sample-internal-edge-secret-1234567890';
const base={EDGE_API_ENABLED:'true',EDGE_R2_ENABLED:'false',EDGE_QUEUES_ENABLED:'false',ADMINERVA_EDGE_SECRET:token};
function req(path,{method='GET',headers={},body}={}){
  return new Request(origin+path,{method,headers:{'authorization':'Bearer '+token,...headers},body});
}
async function body(res){return res.json();}

test('health is public but contains no bucket names, secrets or school information',async()=>{
  const res=await handleRequest(new Request(origin+'/health'),{});
  assert.equal(res.status,200);
  assert.deepEqual(await body(res),{service:'adminerva-edge',status:'staged',publicData:false});
});
test('all internal routes fail closed without explicit API opt-in and strong secret',async()=>{
  const request=req('/v1/internal/references',{method:'POST'});
  assert.equal((await handleRequest(request,{...base,EDGE_API_ENABLED:'false'})).status,503);
  assert.equal((await handleRequest(request,{...base,ADMINERVA_EDGE_SECRET:''})).status,401);
  assert.equal((await handleRequest(new Request(origin+'/v1/internal/references'),base)).status,401);
  assert.equal((await handleRequest(req('/unknown'),base)).status,404);
});
test('upload requires trusted school opt-in, PDF MIME and bounded size',async()=>{
  const writes=[];
  const env={...base,EDGE_R2_ENABLED:'true',ADMINERVA_REFERENCES:{
    async put(key,stream,metadata){writes.push({key,metadata,source:await new Response(stream).text()});}
  }};
  const headers={
    'content-type':'application/pdf',
    'content-length':'11',
    'x-adminerva-school-id':'school123',
    'x-adminerva-school-storage-opt-in':'true'
  };
  const pdf='%PDF-1.7\nx';
  assert.equal(pdf.length,11);
  assert.equal((await handleRequest(req('/v1/internal/references',{method:'POST',headers:{...headers,'x-adminerva-school-storage-opt-in':'false'},body:pdf}),env)).status,403);
  assert.equal((await handleRequest(req('/v1/internal/references',{method:'POST',headers:{...headers,'content-type':'text/plain'},body:pdf}),env)).status,415);
  assert.equal((await handleRequest(req('/v1/internal/references',{method:'POST',headers:{...headers,'content-length':'60000000'},body:pdf}),env)).status,413);
  const uploaded=await handleRequest(req('/v1/internal/references',{method:'POST',headers,body:pdf}),env);
  assert.equal(uploaded.status,201);
  const data=await body(uploaded);
  assert.equal(data.ok,true);
  assert.match(data.id,/^[a-f0-9-]{36}$/);
  assert.equal(writes.length,1);
  assert.equal(writes[0].key,'schools/school123/reference-library/'+data.id+'.pdf');
  assert.equal(writes[0].source,pdf);
});
test('R2 downloads require the internal bearer and return private no-store headers',async()=>{
  const referenceId='e6fdb7a3-bf47-4b55-8dcd-935383e9f42c';
  let deleted=false;
  const env={...base,EDGE_R2_ENABLED:'true',ADMINERVA_REFERENCES:{
    async get(){return {body:new Blob(['%PDF-1.7']).stream()};},
    async delete(){deleted=true;}
  }};
  const path='/v1/internal/references/school123/'+referenceId;
  const res=await handleRequest(req(path),env);
  assert.equal(res.status,200);
  assert.equal(res.headers.get('cache-control'),'private, no-store');
  assert.equal(res.headers.get('content-type'),'application/pdf');
  assert.equal(await res.text(),'%PDF-1.7');
  assert.equal((await handleRequest(req(path,{method:'DELETE'}),env)).status,204);
  assert.equal(deleted,true);
});
test('metadata-only queue request cannot accept prompts or student evidence',async()=>{
  const submitted=[];
  const env={...base,EDGE_QUEUES_ENABLED:'true',JOB_PROCESSOR_URL:'https://processor.example/authorized',JOB_PROCESSOR_TOKEN:token,ADMINERVA_JOBS:{
    async send(x){submitted.push(x);}
  }};
  const make=payload=>req('/v1/internal/jobs',{method:'POST',
    headers:{'content-type':'application/json','content-length':String(JSON.stringify(payload).length)},
    body:JSON.stringify(payload)});
  const good={kind:'reference_pdf_extract',schoolId:'school123',
    referenceId:'e6fdb7a3-bf47-4b55-8dcd-935383e9f42c'};
  assert.equal((await handleRequest(make({...good,studentAnswer:'private'}),env)).status,400);
  assert.equal((await handleRequest(make(good),{...env,EDGE_QUEUES_ENABLED:'false'})).status,503);
  const res=await handleRequest(make(good),env);
  assert.equal(res.status,202);
  assert.equal(submitted.length,1);
  assert.equal(submitted[0].kind,'reference_pdf_extract');
  assert.deepEqual(Object.keys(submitted[0]).sort(),['jobId','kind','referenceId','requestedAt','schema','schoolId']);
});
test('queue refuses to acknowledge work without a configured trusted processor',async()=>{
  let retried=0,acknowledged=0;
  const batch={messages:[{body:{},retry(){retried++},ack(){acknowledged++}}]};
  await processQueue(batch,{EDGE_QUEUES_ENABLED:'false'});
  assert.equal(retried,1);
  assert.equal(acknowledged,0);
});
