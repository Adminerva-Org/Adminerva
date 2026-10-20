import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync("js/lesson-review/document-exporter.js","utf8")
  .replace(/import\s*\{[^}]*\}\s*from\s*"[^"]+";/g," ");
const clientId="902176956124-i9vcin925le0d9jghr4afn56q7n53gl5.apps.googleusercontent.com";
const scope="https://www.googleapis.com/auth/drive.file";

function exportHarness({granted=true,ready=true,prepareError=false,uploadStatus=200,formatStatus=200}={}){
  const alerts=[],requests=[],opened=[],storageWrites=[],loading=[];
  let config,requested=0;
  const elements={
    lpAcademicTerm:{value:"FIRST SEMESTER FIRST QUARTER"},
    lpCourseWeek:{value:"Week 1"},
    printDocumentWrapper:{innerHTML:"<table><tr><td>Lesson</td></tr></table><table><tr><td>Teacher</td></tr></table>"},
  };
  const window={
    currentTargetGrade:"Grade 11",
    showSubtleLoader:()=>loading.push("show"),
    hideSubtleLoader:()=>loading.push("hide"),
    open:(...args)=>opened.push(args),
  };
  const google={accounts:{oauth2:{
    initTokenClient:value=>{config=value;return {requestAccessToken:()=>requested++};},
    hasGrantedAllScopes:(response,requestedScope)=>granted&&requestedScope===scope&&response.scope===scope,
  }}};
  const context={window,google,htmlDocx:{},
    alert:value=>alerts.push(value),confirm:()=>false,
    document:{getElementById:id=>elements[id]},
    lessonStorage:{getItem:()=>null,setItem:(...args)=>storageWrites.push(args)},
    fetch:async(url,options)=>{
      requests.push({url,options});
      if(url.startsWith("https://www.googleapis.com/upload/drive/"))
        return {ok:uploadStatus===200,status:uploadStatus,statusText:"Upload response",json:async()=>({id:"synthetic-doc"})};
      if(url.endsWith(":batchUpdate"))
        return {ok:formatStatus===200,status:formatStatus};
      return {ok:true,json:async()=>({body:{content:[{startIndex:1,table:{}},{startIndex:100,table:{}}]}})};
    },
  };
  runInNewContext(source,context);
  window.buildDocumentLayout=async()=>{
    if(prepareError)throw Error("synthetic preparation error");
    return ready;
  };
  return {window,context,alerts,requests,opened,storageWrites,loading,
    start:()=>window.exportToGoogleDocs(),get config(){return config;},get requested(){return requested;}};
}

const token={access_token:"synthetic-memory-only-token",scope};

test("Docs export uses the owner-supplied web client and only per-file access",()=>{
  const harness=exportHarness();harness.start();
  assert.equal(harness.config.client_id,clientId);
  assert.equal(harness.config.scope,scope);
  assert.equal(harness.config.include_granted_scopes,false);
  assert.equal(harness.requested,1);
  assert.equal(harness.requests.length,0);
  assert.doesNotMatch(source,/396238862950-|https:\/\/www\.googleapis\.com\/auth\/documents/);
  assert.match(readFileSync("lesson-planner.html","utf8"),/document-exporter\.js\?v=2026\.10\.21\.1-dev\.1/);
});

test("missing Google library does not start an export",()=>{
  const harness=exportHarness();harness.context.google=undefined;harness.start();
  assert.match(harness.alerts[0],/Google scripts failed to load/);
  assert.equal(harness.requests.length,0);
});

test("closed and blocked authorization windows explain the next step without uploading",()=>{
  for(const [type,message] of [["popup_failed_to_open",/Allow popups/],["popup_closed",/No document was created/],["unknown",/administrator/]]){
    const harness=exportHarness();harness.start();harness.config.error_callback({type});
    assert.match(harness.alerts[0],message);
    assert.equal(harness.requests.length,0);
  }
});

test("denied, missing or insufficient permission never reaches Drive or Docs",async()=>{
  for(const [response,granted] of [[{error:"access_denied"},true],[{error:"origin_mismatch"},true],[{},true],[token,false]]){
    const harness=exportHarness({granted});harness.start();await harness.config.callback(response);
    assert.equal(harness.alerts.length,1);
    assert.equal(harness.requests.length,0);
    assert.equal(harness.opened.length,0);
    assert.equal(harness.storageWrites.length,0);
    assert.equal(harness.loading.length,0);
  }
});

test("cancelled or failed lesson preparation always clears export loading",async()=>{
  for(const options of [{ready:false},{prepareError:true}]){
    const harness=exportHarness(options);harness.start();await harness.config.callback(token);
    assert.deepEqual(harness.loading,["show","hide"]);
    assert.equal(harness.requests.length,0);
    if(options.prepareError)assert.match(harness.alerts[0],/saved lesson was not changed/);
  }
});

test("consented export uploads, inspects and formats only its created document",async()=>{
  const harness=exportHarness();harness.start();await harness.config.callback(token);
  assert.equal(harness.requests.length,3);
  assert.match(harness.requests[0].url,/upload\/drive\/v3\/files\?uploadType=multipart$/);
  assert.equal(harness.requests[1].url,"https://docs.googleapis.com/v1/documents/synthetic-doc");
  assert.equal(harness.requests[2].url,"https://docs.googleapis.com/v1/documents/synthetic-doc:batchUpdate");
  for(const request of harness.requests)assert.equal(request.options.headers.Authorization,"Bearer "+token.access_token);
  const formatting=JSON.parse(harness.requests[2].options.body).requests;
  assert.equal(formatting.length,12);
  assert.equal(formatting[0].updateDocumentStyle.documentStyle.pageSize.width.magnitude,936);
  assert.equal(formatting.filter(request=>request.updateTableColumnProperties).length,11);
  assert.deepEqual(harness.opened,[["https://docs.google.com/document/d/synthetic-doc/edit","_blank"]]);
  assert.deepEqual(harness.loading,["show","hide"]);
  assert.deepEqual(harness.alerts,[]);
  assert.deepEqual(harness.storageWrites,[]);
});

test("upload or formatting failures clear loading without claiming a successful export",async()=>{
  for(const options of [{uploadStatus:403},{formatStatus:403}]){
    const harness=exportHarness(options);harness.start();await harness.config.callback(token);
    assert.deepEqual(harness.loading,["show","hide"]);
    assert.equal(harness.alerts.length,1);
    assert.match(harness.alerts[0],/Google Docs export needs attention/);
    assert.equal(harness.opened.length,0);
    assert.equal(harness.storageWrites.length,0);
  }
});
