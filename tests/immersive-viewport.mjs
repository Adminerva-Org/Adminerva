// Focused visual/interaction QA for the immersive redesign.
// Executed in a real Chromium browser against the PR's own static files.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,normalize,sep} from 'node:path';
import {chromium} from 'playwright';

const root=resolve('.');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const roles=new Set(['student','teacher','admin','platform']);
const fixture=role=>`<!doctype html><html lang="en"><head><base href="/"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/css/adminerva-ui.css"><link rel="stylesheet" href="/css/experience-mode.css"></head><body><main data-home-experience="${role}" style="max-width:1100px;margin:auto;padding:1rem"><header class="av-home-hero"><p>Canonical ${role} home</p><h1>One home. One navigation.</h1><p>Operational work starts on this page.</p></header><section id="real-dashboard"><h2>Operational dashboard fixture</h2><p>This is visible without crossing a second homepage.</p></section></main><script type="module" src="/js/core/experience-mode.mjs"></script></body></html>`;
const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  if(pathname.startsWith('/__role/')){
    const role=pathname.slice('/__role/'.length).replace(/\.html$/,'');
    if(!roles.has(role)){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fixture(role));return;
  }
  const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/,'');
  const absolute=resolve(root,normalize(relative));
  if(absolute!==root&&!absolute.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{const bytes=await readFile(absolute);res.writeHead(200,{'Content-Type':types[extname(absolute)]||'application/octet-stream'});res.end(bytes);}
  catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const launchOptions={headless:true,args:['--disable-dev-shm-usage']};
if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)launchOptions.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const browser=await chromium.launch(launchOptions);
const dimensions=[
  {name:'desktop-wide',width:1600,height:900,isMobile:false,hasTouch:false},
  {name:'desktop-narrow',width:1100,height:780,isMobile:false,hasTouch:false},
  {name:'tablet-landscape',width:1024,height:768,isMobile:true,hasTouch:true},
  {name:'tablet-portrait',width:768,height:1024,isMobile:true,hasTouch:true},
  {name:'mobile-320',width:320,height:740,isMobile:true,hasTouch:true},
  {name:'mobile-430',width:430,height:900,isMobile:true,hasTouch:true},
  {name:'mobile-landscape',width:740,height:360,isMobile:true,hasTouch:true}
];
const failures=[],results=[];
async function assess(page,label,viewport){
  const metrics=await page.evaluate(()=>{
    const main=document.querySelector('main');
    const headings=[...main.querySelectorAll('h1')].filter(n=>getComputedStyle(n).display!=='none'&&n.getBoundingClientRect().width>0);
    const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const headingRects=headings.map(n=>{const style=getComputedStyle(n);return {text:n.textContent,box:rect(n),scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight,clippedX:['hidden','clip'].includes(style.overflowX),clippedY:['hidden','clip'].includes(style.overflowY)};});
    const nav=document.querySelector('#adminerva-public-nav .av-public-shell');
    const stage=document.querySelector('.avx-world-shell,.avx-canonical-home-hero,.avx-editorial-world');
    const actions=[...main.querySelectorAll('a[href],button')].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden');
    const tiny=actions.filter(n=>{const r=n.getBoundingClientRect();return r.width<24||r.height<24;}).slice(0,8).map(n=>({label:n.getAttribute('aria-label')||n.textContent.trim().slice(0,45),box:rect(n)}));
    return {innerWidth,innerHeight,docWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,headings:headingRects,nav:nav?rect(nav):null,stage:stage?rect(stage):null,tiny,mode:document.documentElement.dataset.adminervaExperience};
  });
  const errs=[];
  if(metrics.docWidth>viewport.width+3)errs.push(`horizontal document overflow ${metrics.docWidth} > ${viewport.width}`);
  if(metrics.bodyWidth>viewport.width+3)errs.push(`horizontal body overflow ${metrics.bodyWidth} > ${viewport.width}`);
  if(metrics.stage&&(metrics.stage.left<-3||metrics.stage.right>viewport.width+3))errs.push(`world outside viewport [${Math.round(metrics.stage.left)},${Math.round(metrics.stage.right)}]`);
  for(const h of metrics.headings){
    if(h.box.left<-3||h.box.right>viewport.width+3)errs.push('headline outside viewport: '+h.text.slice(0,60));
    if(h.clippedX&&h.scrollWidth>h.clientWidth+3)errs.push('headline horizontal clipping: '+h.text.slice(0,60));
    if(h.clippedY&&h.scrollHeight>h.clientHeight+4)errs.push('headline vertical clipping: '+h.text.slice(0,60));
    if(metrics.nav&&h.box.top<metrics.nav.bottom-1&&h.box.bottom>metrics.nav.top+1)errs.push('headline collides with header: '+h.text.slice(0,60));
  }
  // Small decorative spans do not count; actionable items must be reachable.
  if(metrics.tiny.length)errs.push('too-small interactive targets: '+JSON.stringify(metrics.tiny));
  results.push({label,viewport:viewport.name,metrics,errors:errs});
  if(errs.length)failures.push({label,viewport:viewport.name,errors:errs});
  console.log(JSON.stringify({event:'viewport',label,viewport:viewport.name,docWidth:metrics.docWidth,headings:metrics.headings.map(h=>h.text.slice(0,50)),errors:errs}));
}
try{
  for(const viewport of dimensions){
    const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},isMobile:viewport.isMobile,hasTouch:viewport.hasTouch,reducedMotion:'reduce'});
    await context.addInitScript(()=>{localStorage.setItem('adminerva:experience-mode:public','full');localStorage.setItem('adminerva:experience-mode:guest','full');});
    for(const [name,path] of [['public','index.html'],['guest','guest-home.html'],['opportunities','opportunities.html'],['pulse','pulse.html']]){
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+'/'+path,{waitUntil:'domcontentloaded',timeout:30000});
      await page.locator('.avx-view-trigger').waitFor({timeout:12000});
      await page.waitForTimeout(350);
      await assess(page,name,viewport);
      if(errors.some(e=>/experience|undefined|null|syntaxerror/i.test(e)))failures.push({label:name,viewport:viewport.name,errors});
      if(viewport.name==='mobile-320'||viewport.name==='tablet-landscape'){
        const stage=page.locator(name==='public'||name==='guest'?'.avx-world-shell':'.avx-editorial-world');
        await stage.screenshot({path:`/tmp/adminerva-${name}-${viewport.name}.png`,animations:'disabled'});
      }
      if(name==='public'&&viewport.name==='mobile-320'){
        const flow=await page.evaluate(()=>{
          const introText=[...document.querySelectorAll('.avx-route-intro h2,.avx-route-intro p')]
            .filter(node=>node.getClientRects().length)
            .map(node=>node.getBoundingClientRect().bottom);
          const firstStop=document.querySelector('.avx-route-stop')?.getBoundingClientRect();
          const textBottom=introText.length?Math.max(...introText):null;
          return textBottom!==null&&firstStop?{textBottom,firstStopTop:firstStop.top}:null;
        });
        console.log(JSON.stringify({event:'mobile_route_flow',flow}));
        assert.ok(flow&&flow.firstStopTop>=flow.textBottom-1,'mobile public first destination must not overlap its visible narrative copy');
      }
      if(name==='public'){
        await page.locator('.avx-view-trigger').click();
        await page.getByRole('button',{name:'Quick Mode'}).click();
        assert.equal(await page.locator('html').getAttribute('data-adminerva-experience'),'quick');
        assert.equal(await page.locator('.avx-world-shell').isVisible(),false);
        await page.locator('.avx-view-trigger').click();
        await page.getByRole('button',{name:'Full Experience'}).click();
        assert.equal(await page.locator('.avx-world-shell').isVisible(),true);
      }
      if(name==='opportunities'){
        await page.locator('#opportunity-tools summary').click();
        assert.equal(await page.locator('#opportunity-tools').getAttribute('open'),'');
      }
      if(name==='pulse'){
        await page.getByRole('button',{name:/Friday Pulse/}).click();
        assert.equal(await page.locator('[data-signal-channel="weekly-pulse"]').getAttribute('aria-pressed'),'true');
      }
      await page.close();
    }
    for(const role of ['student','teacher','admin','platform']){
      const page=await context.newPage();
      await page.goto(origin+'/__role/'+role+'.html',{waitUntil:'domcontentloaded'});
      await page.locator('.avx-canonical-home-hero[data-avx-canonical-home="true"]').waitFor({timeout:10000});
      await assess(page,role,viewport);
      assert.equal(await page.locator('.avx-role-runway').count(),0,'separate signed-in runway must not return');
      assert.equal(await page.locator('.avx-dashboard-entry').count(),0,'dashboard continuation gate must not return');
      assert.equal(await page.locator('.avx-scene-architecture').count(),1,'canonical Home should own one scene architecture layer');
      assert.equal(await page.locator('.avx-home-handoff').count(),1,'scene should hand off directly into the operational Home');
      assert.equal(await page.locator('.avx-canonical-logo').count(),1,'official Adminerva logo should remain the foreground brand identity');
      await page.waitForFunction(()=>[...document.querySelectorAll('.avx-canonical-logo,.avx-canonical-guide')].every(img=>img.complete&&img.naturalWidth>0),null,{timeout:8000});
      assert.equal(await page.locator('.avx-canonical-logo').isVisible(),true,'official Adminerva logo should be visibly composed in Full Experience');
      assert.equal(await page.locator('.avx-canonical-guide').isVisible(),true,'Adminerva guide character should be visibly composed in Full Experience');
      const loadedSceneImages=await page.locator('.avx-canonical-logo,.avx-canonical-guide').evaluateAll(nodes=>nodes.every(img=>img.complete&&img.naturalWidth>0));
      assert.equal(loadedSceneImages,true,'canonical scene image assets should load successfully');
      assert.equal(await page.locator('#real-dashboard').isVisible(),true,'operational dashboard must already be on the canonical Home');
      if(['desktop-wide','tablet-landscape','mobile-320'].includes(viewport.name)){
        await page.locator('.avx-canonical-home-hero').screenshot({path:`/tmp/adminerva-${role}-${viewport.name}.png`,animations:'disabled'});
      }
      if(role==='student'){
        await page.locator('.avx-view-trigger').click();
        await page.getByRole('button',{name:'Quick Mode'}).click();
        assert.equal(await page.locator('.avx-home-handoff').isVisible(),false,'Quick Mode should remove scenic handoff only');
        assert.equal(await page.locator('.avx-canonical-home-hero').count(),0,'Quick Mode should remove immersive hero layout styling');
        assert.equal(await page.locator('#real-dashboard').isVisible(),true,'Quick Mode must keep the same operational Home');
        await page.locator('.avx-view-trigger').click();
        await page.getByRole('button',{name:'Full Experience'}).click();
        assert.equal(await page.locator('.avx-home-handoff').isVisible(),true,'Full Experience should restore scene handoff');
        assert.equal(await page.locator('.avx-canonical-home-hero').count(),1,'Full Experience should restore immersive hero layout styling');
      }
      await page.close();
    }
    await context.close();
  }
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({event:'immersive_qa_summary',cases:results.length,failures}));
assert.equal(failures.length,0,`${failures.length} immersive viewport/interaction failures`);
