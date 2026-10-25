import test from "node:test";
import assert from "node:assert/strict";
import {__googleDocsExportTest as api} from "../js/lesson-review/google-docs-export.mjs";

const scope="https://www.googleapis.com/auth/drive.file";
const token={access_token:"synthetic-token",scope,expires_in:3600};

function oauthHarness({response=token,error=null,granted=true}={}){
  let config,requests=0;
  globalThis.location={origin:"https://adminerva.example"};
  globalThis.google={accounts:{oauth2:{
    initTokenClient(value){
      config=value;
      return {requestAccessToken(){requests++;queueMicrotask(()=>error?config.error_callback(error):config.callback(response));}};
    },
    hasGrantedAllScopes(value,requested){return granted&&requested===scope&&value?.scope===scope;}
  }}};
  return {get config(){return config;},get requests(){return requests;}};
}

test("active Docs export requests only drive.file without incremental prior grants",async()=>{
  api.reset();const h=oauthHarness();
  const value=await api.tokenFor({uid:"u1",loginHint:"student@example.test",assertAccount(){}});
  assert.equal(value,token.access_token);
  assert.equal(h.config.scope,scope);
  assert.equal(h.config.include_granted_scopes,false);
  assert.equal(h.requests,1);
});

test("denied or insufficient consent is rejected before upload",async()=>{
  for(const options of [
    {response:{error:"access_denied",error_description:"denied"}},
    {response:token,granted:false},
    {response:{scope},granted:true}
  ]){
    api.reset();oauthHarness(options);
    await assert.rejects(()=>api.tokenFor({uid:"u1",assertAccount(){}}),/permission|grant|authorization/i);
  }
});

test("closed or blocked authorization popups return actionable errors",async()=>{
  for(const [type,pattern] of [["popup_failed_to_open",/popups/i],["popup_closed",/closed/i]]){
    api.reset();oauthHarness({error:{type}});
    await assert.rejects(()=>api.tokenFor({uid:"u1",assertAccount(){}}),pattern);
  }
});

test("account changes invalidate the authorization result",async()=>{
  api.reset();oauthHarness();
  await assert.rejects(()=>api.tokenFor({uid:"u1",assertAccount(){throw Error("Account changed");}}),/Account changed/);
});

test("cached access is reused until a 401 resets it",async()=>{
  api.reset();let h=oauthHarness();
  await api.tokenFor({uid:"u1",assertAccount(){}});
  const second=await api.tokenFor({uid:"u1",assertAccount(){}});
  assert.equal(second,token.access_token);
  assert.equal(h.requests,1);
  assert.match(api.explain(Object.assign(Error("expired"),{status:401})),/expired|revoked/i);
  h=oauthHarness({response:{...token,access_token:"replacement"}});
  assert.equal(await api.tokenFor({uid:"u1",assertAccount(){}}),"replacement");
  assert.equal(h.requests,1);
});

test("Google request failures preserve stage and status",async()=>{
  globalThis.fetch=async()=>({ok:false,status:403,statusText:"Forbidden",text:async()=>JSON.stringify({error:{message:"permission denied"}})});
  await assert.rejects(
    ()=>api.googleRequest("https://example.test",{method:"POST"},"Google Drive upload"),
    error=>error.status===403&&/Google Drive upload/.test(error.message)
  );
});

test("partial Docs formatting failure is reported after inspection",async()=>{
  let calls=0;
  globalThis.fetch=async(url)=>{
    calls++;
    if(calls===1)return {ok:true,status:200,text:async()=>JSON.stringify({body:{content:[{startIndex:1,table:{columns:1}}]}})};
    return {ok:false,status:403,statusText:"Forbidden",text:async()=>JSON.stringify({error:{message:"format blocked"}})};
  };
  await assert.rejects(
    ()=>api.formatDocument("doc-1",{tables:[{columns:1,widths:[864]}]},"synthetic",()=>{}),
    /Google Docs formatting/
  );
  assert.equal(calls,2);
});
