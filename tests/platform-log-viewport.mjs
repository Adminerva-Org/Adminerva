// Focused actual Chromium layout check for the canonical Log Viewer markup/CSS.
// Only external scripts are stripped from the fixture; no test data is written.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,extname,normalize,sep} from "node:path";
import {chromium} from "playwright";

const root=resolve(".");
const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8"};
const source=await readFile(resolve(root,"platform-logs.html"),"utf8");
const fixture=source
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"")
  .replace('<body id="pageBody" class="hidden">','<body id="pageBody">')
  .replace('<div id="adminerva-nav" data-module="admin" data-page="platform-logs"></div>',"");
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,"http://127.0.0.1").pathname;
  if(pathname==="/__diagnostics"){
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
    res.end(fixture);return;
  }
  const absolute=resolve(root,normalize(pathname.replace(/^\/+/,"")));
  if(absolute!==root&&!absolute.startsWith(root+sep)){
    res.writeHead(403);res.end();return;
  }
  try{
    const bytes=await readFile(absolute);
    res.writeHead(200,{"Content-Type":types[extname(absolute)]||"application/octet-stream"});
    res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const browser=await chromium.launch({headless:true,args:["--disable-dev-shm-usage"]});
const origin="http://127.0.0.1:"+server.address().port;
const sizes=[[1920,1080],[1440,900],[1024,768],[768,1024],[430,900],[390,844],[320,740]];
try{
  for(const [width,height] of sizes){
    const page=await browser.newPage({viewport:{width,height},reducedMotion:"reduce"});
    await page.goto(origin+"/__diagnostics",{waitUntil:"load"});
    await page.evaluate(compact=>{
      document.getElementById("pl-directory-disclosure").open=!compact;
      document.getElementById("pl-filter-disclosure").open=!compact;
      document.getElementById("pl-analysis-drawer").hidden=false;
      document.getElementById("pl-events").innerHTML=
        '<tr><td class="pl-cell-flag"><span class="pl-flag" data-level="failure">Failure</span></td>'+
        '<td class="pl-cell-time">Nov 25, 2026, 8:27:15 PM PHT</td>'+
        '<td class="pl-cell-account"><strong class="pl-primary-cell">Sample learner</strong><span class="pl-muted">uid-xxxxxx</span></td>'+
        '<td class="pl-cell-event"><strong class="pl-primary-cell">Backend callable failed</strong><span class="pl-muted">Studio</span></td>'+
        '<td class="pl-cell-context"><span>Code: unavailable · Service: studioProject.save · Provenance: server-confirmed</span>'+
        '<details class="pl-event-detail"><summary>Developer details</summary><dl><dt>Trace ID</dt><dd>abcdefgh1234567890123456789</dd></dl></details></td></tr>';
      document.getElementById("pl-accounts").innerHTML=
        '<button class="pl-account"><strong>Sample learner</strong><small>sample@example.edu</small><small>uid-xxxx</small></button>';
    },width<=780);
    const metrics=await page.evaluate(()=>({
      docWidth:document.documentElement.scrollWidth,
      shellWidth:document.querySelector(".pl-shell").getBoundingClientRect().width,
      side:document.querySelector(".pl-directory").getBoundingClientRect().toJSON(),
      view:document.querySelector(".pl-view").getBoundingClientRect().toJSON(),
      row:document.querySelector("#pl-events tr").getBoundingClientRect().toJSON(),
      directoryOpen:document.getElementById("pl-directory-disclosure").open,
      filterOpen:document.getElementById("pl-filter-disclosure").open
    }));
    assert.ok(metrics.docWidth<=width+3,"Document overflow at "+width+"px: "+metrics.docWidth);
    assert.ok(metrics.row.right<=width+3,"Event row overflow at "+width+"px");
    if(width>=1440)assert.ok(metrics.shellWidth>=width*.94,
      "Desktop width underused at "+width+"px: "+metrics.shellWidth);
    if(width>780)assert.ok(metrics.side.right<metrics.view.left,
      "Expected side-by-side directory at "+width+"px");
    else{
      assert.equal(metrics.directoryOpen,false,"Directory should start compact at "+width+"px");
      assert.equal(metrics.filterOpen,false,"Filters should start compact at "+width+"px");
      await page.locator("#pl-directory-disclosure > summary").click();
      assert.equal(await page.locator("#pl-directory-disclosure").getAttribute("open"),"");
      await page.locator("#pl-directory-disclosure > summary").click();
    }
    await page.evaluate(()=>{
      document.querySelector(".pl-table-wrap").hidden=true;
      document.querySelector("#pl-live").hidden=false;
      document.getElementById("pl-live-console").innerHTML=
        '<div class="pl-live-line" data-severity="failure"><time>20:27:15</time>'+
        '<span class="pl-live-severity">FAIL</span><button class="pl-live-actor">Sample learner</button>'+
        '<div class="pl-live-content"><strong>Studio cloud save failed</strong>'+
        '<div class="pl-live-meta">service-studio-very-long-reference-123456789012345678901234567890</div>'+
        '<details><summary>Diagnostic context</summary><dl><dt>Trace</dt><dd>1234567890123456789012345</dd></dl></details></div></div>';
    });
    const live=await page.evaluate(()=>({
      docWidth:document.documentElement.scrollWidth,
      line:document.querySelector(".pl-live-line").getBoundingClientRect().toJSON()
    }));
    assert.ok(live.docWidth<=width+3,"Live view overflows at "+width+"px");
    assert.ok(live.line.right<=width+3,"Live row exceeds viewport at "+width+"px");
    await page.evaluate(()=>{
      document.getElementById("pl-investigation-grid").classList.add("pl-inspecting");
      document.getElementById("pl-inspector").hidden=false;
      document.getElementById("pl-inspector-body").innerHTML='<dl class="pl-inspector-fields"><div><dt>Operation ID</dt><dd>aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa</dd></div><div><dt>Page state</dt><dd>visible · focused · online · complete</dd></div></dl><ol class="pl-operation-timeline"><li><time>20:27:15</time><button class="pl-operation-event">Studio API submit</button><small>Observed while operation was active</small></li></ol>';
    });
    const inspector=await page.evaluate(()=>({
      docWidth:document.documentElement.scrollWidth,
      rect:document.getElementById("pl-inspector").getBoundingClientRect().toJSON(),
      feed:document.querySelector(".pl-event-feed").getBoundingClientRect().toJSON()
    }));
    assert.ok(inspector.docWidth<=width+3,"Inspector document overflow at "+width);
    assert.ok(inspector.rect.right<=width+3,"Inspector overflow at "+width);
    if(width>=1280)assert.ok(inspector.feed.right<=inspector.rect.left,"Inspector should sit beside the feed");
    else assert.ok(inspector.rect.bottom<=inspector.feed.top+1,"Inspector should stack above the feed");
    if(width===320||width===1920)
      await page.screenshot({path:"/tmp/adminerva-platform-log-"+width+".png",fullPage:true});
    console.log(JSON.stringify({viewport:width+"x"+height,shell:Math.round(metrics.shellWidth),
      tableRight:Math.round(metrics.row.right),liveRight:Math.round(live.line.right),
      docWidth:live.docWidth}));
    await page.close();
  }
}finally{
  await browser.close();
  await new Promise(done=>server.close(done));
}
