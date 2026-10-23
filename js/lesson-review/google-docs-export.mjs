/** Explicit Drive consent and HTML conversion. Google tokens stay in page memory. */
const CLIENT_ID='902176956124-i9vcin925le0d9jghr4afn56q7n53gl5.apps.googleusercontent.com';
const SCOPE='https://www.googleapis.com/auth/drive.file';
let cachedToken=null,activeExport=null;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeMessage=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/(access_token=)[^\s&]+/gi,'$1[redacted]').replace(/\s+/g,' ').trim().slice(0,700);

function tokenFor({uid,loginHint,assertAccount}){
 if(cachedToken?.uid===uid&&cachedToken.expiresAt>Date.now()+60000)return Promise.resolve(cachedToken.value);
 cachedToken=null;
 const oauth=globalThis.google?.accounts?.oauth2;
 if(!oauth?.initTokenClient)return Promise.reject(Error('Google authorization could not load. Check your connection or content blocker, then retry. You can download the lesson below.'));
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>finish(Error('Google authorization did not finish. Close its popup, then retry or download the lesson below.')),120000);
  try{
   const client=oauth.initTokenClient({client_id:CLIENT_ID,scope:SCOPE,include_granted_scopes:true,...(loginHint?{login_hint:loginHint}:{}),
    callback:response=>{
     if(settled)return;
     try{
      assertAccount();
      if(response?.error){
       const reason=safeMessage(response.error_description||response.error);
       throw Error(response.error==='access_denied'?'Google Drive permission was not granted. Your Adminerva session is still signed in.':`Google authorization failed: ${reason}. If Google reports an origin or client restriction, an administrator must allow ${location.origin} for the existing export OAuth client.`);
      }
      const granted=response&&(typeof oauth.hasGrantedAllScopes==='function'?oauth.hasGrantedAllScopes(response,SCOPE):String(response.scope||'').split(/\s+/).includes(SCOPE));
      if(!response?.access_token||!granted)throw Error('Google did not grant permission to create this lesson in Drive. Retry and grant the requested permission, or download a copy below.');
      cachedToken={uid,value:response.access_token,expiresAt:Date.now()+Math.max(0,Number(response.expires_in)||3600)*1000};
      finish(null,cachedToken.value);
     }catch(error){finish(error);}
    },
    error_callback:error=>finish(Error(error?.type==='popup_failed_to_open'?'Allow Google authorization popups for this website, then retry.':error?.type==='popup_closed'?'Google authorization was closed. No document was uploaded. Your Adminerva session is still signed in.':'Google authorization could not finish. Check the export OAuth client’s allowed website origin and the school’s Google account policy.'))
   });
   // Called directly from the export/retry click, before any asynchronous work.
   client.requestAccessToken({prompt:''});
  }catch(error){finish(error);}
 });
}

async function googleRequest(url,options,stage){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 try{
  const response=await fetch(url,{...options,signal:controller.signal});
  const text=await response.text();let data=null;
  try{data=text?JSON.parse(text):null;}catch{}
  if(!response.ok){
   const errors=Array.isArray(data?.error?.errors)?data.error.errors:[],details=Array.isArray(data?.error?.details)?data.error.details:[];
   const reasons=[...errors,...details].map(item=>typeof item?.reason==='string'?item.reason:null).filter(Boolean);
   const detail=safeMessage(data?.error?.message||text||response.statusText||'Google returned no error details.');
   const error=new Error(`${stage}: HTTP ${response.status}${reasons.length?' ('+[...new Set(reasons)].join(', ')+')':''}. ${detail}`);
   error.status=response.status;error.reasons=reasons;error.stage=stage;throw error;
  }
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error(`${stage}: Google returned an unreadable response (HTTP ${response.status}). Check Drive for the lesson before creating another copy.`);
  return data;
 }catch(error){
  if(error.name==='AbortError')throw Error(`${stage} timed out. If uploading had started, Google may still create the lesson. Check Drive before retrying; a download is available below.`);
  if(error instanceof TypeError)throw Error(`${stage} could not reach Google. Check your connection or browser blocker. If uploading had started, check Drive before retrying.`);
  throw error;
 }finally{clearTimeout(timer);}
}

function explain(error){
 const message=safeMessage(error?.message)||'Google export could not finish. Download the lesson below.';
 if(error?.status===401){cachedToken=null;return message+' Google permission expired or was revoked. Retry to reconnect Google Drive; Adminerva stays signed in.';}
 if(/SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(message))return message+' A Google Cloud administrator must enable the indicated Drive or Docs API in the existing OAuth client’s project.';
 if(/insufficient.*(?:scope|permission)|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message)){cachedToken=null;return message+' Retry and grant the requested Google Drive permission.';}
 if(/storageQuotaExceeded|storage quota/i.test(message))return message+' Free space in Google Drive, then retry.';
 if(/domainPolicy|admin_policy|org_restriction|organization.*policy/i.test(message))return message+' Ask your Google Workspace administrator to allow this export application.';
 return message;
}

export function buildGoogleDocsSource(wrapper,filename){
 if(!wrapper)throw Error('The lesson document is unavailable. Reload the planner and try again.');
 const copy=wrapper.cloneNode(true);
 for(const image of copy.querySelectorAll('img')){
  if(!image.getAttribute('src')||image.hidden||image.classList.contains('hidden')){image.remove();continue;}
  image.style.maxHeight='80px';image.style.maxWidth='500px';image.style.height='auto';image.style.width='auto';
 }
 const tables=[...copy.querySelectorAll('table')].map(table=>{
  const row=table.rows[0],cells=row?[...row.cells]:[],percent=cells.map(cell=>Number.parseFloat(cell.style.width)||0),total=percent.reduce((sum,value)=>sum+value,0);
  return {columns:cells.length,widths:percent.every(value=>value>0)&&total?percent.map(value=>864*value/total):cells.map(()=>864/cells.length)};
 });
 const html='<!doctype html><html><head><meta charset="utf-8"><title>'+escape(filename)+'</title><style>'+ 
  '@page{size:13in 8.5in;margin:.5in}body{margin:0;font:10pt Arial,sans-serif;color:#222}div,p{margin:0}table{border-collapse:collapse;width:100%;margin-top:10px;table-layout:fixed}td,th{border:1px solid #000;padding:6px 8px;font-size:10pt;vertical-align:top;overflow-wrap:break-word}th{background:#b4c6e7;font-weight:bold}tr{break-inside:avoid}thead{display:table-header-group}img{max-width:100%}.hidden{display:none}'+
  '</style></head><body>'+copy.innerHTML+'</body></html>';
 return {filename,html,tables};
}

async function uploadDocument(source,token){
 const boundary='adminerva_'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36));
 const metadata={name:source.filename,mimeType:'application/vnd.google-apps.document'};
 const body=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify(metadata),'\r\n--'+boundary+'\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n',source.html,'\r\n--'+boundary+'--\r\n']);
 if(body.size>5*1024*1024)throw Error('This lesson and its images exceed the 5 MB direct export limit. Download it below, or reduce the header image before retrying.');
 return googleRequest('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'multipart/related; boundary='+boundary},body},'Google Drive upload');
}

async function formatDocument(id,source,token,assertAccount){
 assertAccount();
 const url='https://docs.googleapis.com/v1/documents/'+encodeURIComponent(id);
 const data=await googleRequest(url,{headers:{Authorization:'Bearer '+token}},'Google Docs inspection');
 const tables=(data?.body?.content||[]).filter(element=>element.table);
 if(!tables.length)throw Error('The document was created, but its lesson tables could not be verified. Open it and check the content and page layout.');
 const requests=[{updateDocumentStyle:{documentStyle:{pageSize:{width:{magnitude:936,unit:'PT'},height:{magnitude:612,unit:'PT'}},marginTop:{magnitude:36,unit:'PT'},marginBottom:{magnitude:36,unit:'PT'},marginLeft:{magnitude:36,unit:'PT'},marginRight:{magnitude:36,unit:'PT'}},fields:'pageSize,marginTop,marginBottom,marginLeft,marginRight'}}];
 let differentColumns=false;
 for(let index=0;index<Math.min(tables.length,source.tables.length);index++){
  const expected=source.tables[index],table=tables[index];if(table.table.columns!==expected.columns){differentColumns=true;continue;}
  expected.widths.forEach((width,column)=>requests.push({updateTableColumnProperties:{tableStartLocation:{index:table.startIndex},columnIndices:[column],tableColumnProperties:{widthType:'FIXED_WIDTH',width:{magnitude:width,unit:'PT'}},fields:'width,widthType'}}));
 }
 assertAccount();await googleRequest(url+':batchUpdate',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({requests})},'Google Docs formatting');
 if(tables.length!==source.tables.length||differentColumns)throw Error('The document was created and page settings were applied, but the imported table structure differs. Inspect it before sharing.');
}

function download(source,word){
 const name=String(source.filename||'Lesson plan').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
 let blob,extension;
 if(word&&globalThis.htmlDocx?.asBlob){blob=globalThis.htmlDocx.asBlob(source.html,{orientation:'landscape',margins:{top:720,right:720,bottom:720,left:720}});extension='.docx';}
 else{blob=new Blob(['\ufeff',source.html],{type:word?'application/msword;charset=utf-8':'text/html;charset=utf-8'});extension=word?'.doc':'.html';}
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name+extension;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}

function exportDialog(){
 const previous=document.activeElement,dialog=document.createElement('dialog');dialog.id='googleDocsExportDialog';dialog.setAttribute('aria-labelledby','googleDocsExportTitle');
 dialog.style.cssText='max-width:38rem;width:calc(100% - 2rem);max-height:85dvh;overflow:auto;border:1px solid #cbd5e1;border-radius:16px;padding:24px;color:#123047;background:white;box-shadow:0 20px 70px #0f172a55';
 const heading=document.createElement('h2');heading.id='googleDocsExportTitle';heading.textContent='Export lesson';heading.style.cssText='font-size:1.25rem;font-weight:700;margin-bottom:12px';
 const status=document.createElement('p');status.setAttribute('role','status');status.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;margin:12px 0';
 const note=document.createElement('p');note.textContent='Your lesson in Adminerva is preserved. Downloads work even when Google export is unavailable.';note.style.cssText='font-size:.9rem;color:#526579;margin:12px 0';
 const actions=document.createElement('div');actions.style.cssText='display:flex;flex-wrap:wrap;gap:10px;margin-top:18px';
 const button=(text,action)=>{const item=document.createElement('button');item.type='button';item.textContent=text;item.style.cssText='padding:10px 14px;border:1px solid #9fb4c8;border-radius:8px;font-weight:600;background:#f3f7fb;cursor:pointer';item.onclick=action;actions.append(item);return item;};
 const open=document.createElement('a');open.textContent='Open Google Doc';open.target='_blank';open.rel='noopener noreferrer';open.hidden=true;open.style.cssText='padding:10px 14px;border-radius:8px;font-weight:600;background:#087e8b;color:white;text-decoration:none';actions.append(open);
 const word=button('Download Word',()=>{}),html=button('Download HTML',()=>{}),retry=button('Retry Google export',()=>{}),close=button('Close',()=>dialog.close());
 word.hidden=true;html.hidden=true;retry.hidden=true;close.disabled=true;
 dialog.addEventListener('cancel',event=>{if(close.disabled)event.preventDefault();});
 dialog.addEventListener('close',()=>{dialog.remove();previous?.focus?.();});
 dialog.append(heading,status,note,actions);document.body.append(dialog);dialog.showModal();
 return {dialog,status,open,word,html,retry,close};
}

export function exportLessonToGoogleDocs(options){
 if(activeExport){activeExport.dialog.focus();return;}
 let uid;try{uid=options.accountUid();}catch(error){alert(safeMessage(error.message));return;}
 const assertAccount=()=>options.assertAccount(uid),ui=exportDialog();activeExport=ui;
 ui.status.textContent='Preparing your lesson and connecting to Google Drive…';
 const warm=cachedToken?.uid===uid&&cachedToken.expiresAt>Date.now()+60000;
 // First-time consent owns the gesture popup. The result link also works if a tab is blocked.
 let outputTab=null;if(warm){try{outputTab=window.open('about:blank','_blank');}catch{}}
 if(outputTab){try{outputTab.opener=null;outputTab.document.title='Preparing Google Doc';outputTab.document.body.textContent='Preparing your lesson. You can return to Adminerva while it uploads.';}catch{}}
 const token=tokenFor({uid,loginHint:options.loginHint?.(),assertAccount});
 const prepared=Promise.resolve().then(()=>options.prepare(uid));
 void(async()=>{
  let created=null,source=null;
  try{
   const [documentResult,tokenResult]=await Promise.allSettled([prepared,token]);
   if(documentResult.status==='fulfilled')source=documentResult.value;
   if(source){ui.word.hidden=false;ui.html.hidden=false;ui.word.onclick=()=>{try{assertAccount();download(source,true);}catch(error){ui.status.textContent=safeMessage(error.message);}};ui.html.onclick=()=>{try{assertAccount();download(source,false);}catch(error){ui.status.textContent=safeMessage(error.message);}};}
   if(documentResult.status==='rejected')throw documentResult.reason;
   if(!source?.html)throw Error('No lesson was prepared. Generate or load a lesson before exporting.');
   if(tokenResult.status==='rejected')throw tokenResult.reason;
   assertAccount();ui.status.textContent='Uploading the lesson to Google Drive…';
   created=await uploadDocument(source,tokenResult.value);
   assertAccount();
   if(!created.id)throw Error('Google returned no document ID after upload. Check Drive before retrying to avoid a duplicate.');
   ui.open.href='https://docs.google.com/document/d/'+encodeURIComponent(created.id)+'/edit';ui.open.hidden=false;
   ui.status.textContent='Google Doc created. Applying page and table settings…';
   try{await formatDocument(created.id,source,tokenResult.value,assertAccount);ui.status.textContent='Your Google Doc is ready. Open it to review the layout before sharing.';}
   catch(error){ui.status.textContent='Your Google Doc was created. Its final formatting needs review.\n\n'+explain(error);}
   assertAccount();
   if(outputTab&&!outputTab.closed)outputTab.location.replace(ui.open.href);
  }catch(error){
   if(outputTab&&!outputTab.closed)outputTab.close();
   ui.status.textContent=explain(error);
   if(!created?.id){ui.retry.hidden=false;ui.retry.onclick=()=>{ui.dialog.close();exportLessonToGoogleDocs(options);};}
  }finally{ui.close.disabled=false;activeExport=null;ui.close.focus();}
 })();
}
