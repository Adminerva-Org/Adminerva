"use strict";
/**
 * Published Google Sheets CSV adapter for V4 People & Access.
 * This never accepts arbitrary remote URLs, OAuth tokens, cookies or Apps Script.
 * It only fetches a school-admin configured docs.google.com spreadsheet CSV.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message)}
function reason(value){
  const text=typeof value==="string"?value.trim():"";
  if(text.length<12||text.length>500)
    deny("invalid-argument","Explain the roster source change in 12–500 characters.");
  return text;
}
function normalizeGoogleSheetUrl(value){
  let url;
  try{url=new URL(String(value||"").trim());}
  catch{deny("invalid-argument","Enter a valid Google Sheets URL.");}
  if(url.protocol!=="https:"||url.hostname.toLowerCase()!=="docs.google.com")
    deny("invalid-argument","Only https://docs.google.com Google Sheets URLs are supported.");
  const path=url.pathname.replace(/\/+$/,"");
  let match=path.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  let published=false,id="";
  if(match)id=match[1];
  else{
    match=path.match(/^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{20,})/);
    if(match){published=true;id=match[1];}
  }
  if(!id)deny("invalid-argument","Use a Google Sheets spreadsheet link, not a Drive folder or document link.");
  let gid=url.searchParams.get("gid")||"";
  if(!gid&&url.hash){
    const hash=new URLSearchParams(url.hash.replace(/^#/,""));
    gid=hash.get("gid")||"";
  }
  if(gid&&!/^\d{1,12}$/.test(gid))deny("invalid-argument","The Google Sheet tab ID is invalid.");
  const normalized=published
    ?new URL("https://docs.google.com/spreadsheets/d/e/"+id+"/pub")
    :new URL("https://docs.google.com/spreadsheets/d/"+id+"/export");
  normalized.searchParams.set(published?"output":"format","csv");
  if(gid)normalized.searchParams.set("gid",gid);
  return {url:normalized.toString(),spreadsheetId:id,gid:gid||null,published};
}
function redirectAllowed(url){
  const host=url.hostname.toLowerCase();
  return url.protocol==="https:"&&(host==="docs.google.com"||host==="drive.google.com"||
    host==="googleusercontent.com"||host.endsWith(".googleusercontent.com"));
}
async function fetchPublishedCsv(url,{fetchImpl=fetch}={}){
  let current=new URL(url);
  for(let hop=0;hop<4;hop++){
    if(!redirectAllowed(current))deny("failed-precondition","Google Sheets returned an unsupported redirect.");
    let response;
    try{
      response=await fetchImpl(current,{method:"GET",redirect:"manual",
        headers:{Accept:"text/csv,text/plain;q=0.9,*/*;q=0.1"},
        signal:AbortSignal.timeout(15000)});
    }catch(error){
      if(error?.name==="TimeoutError"||error?.name==="AbortError")
        deny("unavailable","The published Google Sheet did not respond in time.");
      throw error;
    }
    if(response.status>=300&&response.status<400){
      const location=response.headers.get("location");
      if(!location)deny("unavailable","Google Sheets returned an incomplete redirect.");
      current=new URL(location,current);continue;
    }
    if(!response.ok){
      if([401,403,404].includes(response.status))
        deny("failed-precondition","The configured sheet is not publicly readable as CSV. Publish or share an exportable roster sheet first.");
      deny("unavailable","Google Sheets could not provide the roster CSV.");
    }
    const declared=Number(response.headers.get("content-length")||0);
    if(declared>512000)deny("resource-exhausted","The roster sheet exceeds the 500 KB preview limit.");
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.byteLength>512000)deny("resource-exhausted","The roster sheet exceeds the 500 KB preview limit.");
    const csv=new TextDecoder("utf-8",{fatal:false}).decode(bytes).replace(/^\uFEFF/,"");
    if(/^\s*</.test(csv)||!csv.trim())
      deny("failed-precondition","The configured Google Sheet did not return CSV data. Use a published/exportable spreadsheet link.");
    return {csv,bytes:bytes.byteLength,finalHost:current.hostname};
  }
  deny("unavailable","Google Sheets redirected too many times.");
}
function createSchoolRosterSourceService({db,fetchImpl=fetch}){
  return async request=>{
    const input=request.data||{};
    const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["school_admin"]});
    const prefix="schools/"+ctx.schoolId+"/";
    const ref=db.doc(prefix+"private_config/roster_source");
    const schoolRef=db.doc("platform_schools/"+ctx.schoolId);
    const memberRef=db.doc(prefix+"memberships/"+ctx.uid);
    async function authority(tx){
      const [school,member]=await Promise.all([tx.get(schoolRef),tx.get(memberRef)]);
      if(!school.exists||school.data().state!=="active"||!member.exists||
         member.data().schoolId!==ctx.schoolId||member.data().status!=="active"||
         !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
        deny("permission-denied","School administration access changed.");
    }
    const action=input.action||"status";
    if(action==="status"){
      const saved=await ref.get(),data=saved.exists?saved.data():null;
      return {configured:Boolean(data?.enabled&&data?.url),enabled:Boolean(data?.enabled),
        url:data?.url||"",gid:data?.gid||null,spreadsheetId:data?.spreadsheetId||null,
        updatedAt:data?.updatedAt?.toMillis?.()||null};
    }
    if(action==="configure"){
      const normalized=normalizeGoogleSheetUrl(input.url),why=reason(input.reason);
      const audit=db.collection(prefix+"configuration_audit").doc();
      await db.runTransaction(async tx=>{
        await authority(tx);const now=FieldValue.serverTimestamp();
        tx.set(ref,{schoolId:ctx.schoolId,type:"google_sheets_csv",enabled:true,
          url:normalized.url,spreadsheetId:normalized.spreadsheetId,gid:normalized.gid,
          publishedPath:normalized.published,updatedByUid:ctx.uid,updatedAt:now},{merge:false});
        tx.create(audit,{schoolId:ctx.schoolId,actorUid:ctx.uid,
          action:"roster_source_configured",sourceType:"google_sheets_csv",
          spreadsheetId:normalized.spreadsheetId,gid:normalized.gid,reason:why,createdAt:now});
      });
      return {configured:true,enabled:true,url:normalized.url,gid:normalized.gid,
        spreadsheetId:normalized.spreadsheetId};
    }
    if(action==="clear"){
      const why=reason(input.reason),audit=db.collection(prefix+"configuration_audit").doc();
      await db.runTransaction(async tx=>{
        await authority(tx);const saved=await tx.get(ref),now=FieldValue.serverTimestamp();
        tx.set(ref,{schoolId:ctx.schoolId,type:"google_sheets_csv",enabled:false,url:"",
          spreadsheetId:null,gid:null,publishedPath:false,updatedByUid:ctx.uid,updatedAt:now},{merge:false});
        tx.create(audit,{schoolId:ctx.schoolId,actorUid:ctx.uid,
          action:"roster_source_cleared",previousSpreadsheetId:saved.data()?.spreadsheetId||null,
          reason:why,createdAt:now});
      });
      return {configured:false,enabled:false};
    }
    if(action==="fetch_csv"){
      const saved=await ref.get(),data=saved.exists?saved.data():null;
      if(!data?.enabled||data.type!=="google_sheets_csv"||typeof data.url!=="string")
        deny("failed-precondition","Configure a published Google Sheets roster source first.");
      // Re-validate the stored URL before every network call; configuration data
      // is not treated as an SSRF bypass.
      const normalized=normalizeGoogleSheetUrl(data.url);
      const fetched=await fetchPublishedCsv(normalized.url,{fetchImpl});
      return {csv:fetched.csv,bytes:fetched.bytes,spreadsheetId:normalized.spreadsheetId,
        gid:normalized.gid};
    }
    deny("invalid-argument","Unknown school roster source operation.");
  };
}
module.exports={createSchoolRosterSourceService,normalizeGoogleSheetUrl,fetchPublishedCsv};
