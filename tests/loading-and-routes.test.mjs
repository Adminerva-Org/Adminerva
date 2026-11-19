/** Regression coverage: concurrent global loading, compatibility URLs and public help entry points. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync, readdirSync} from "node:fs";
import vm from "node:vm";
test("a legacy hide or completed job cannot dismiss another active operation", () => {
  const elements = new Map(), events = new Map();
  function element() {
    const node = {style:{}, classList:{toggle(){}}, attributes:new Map(), append(){}, setAttribute(key,value){this.attributes.set(key,value);}, removeAttribute(key){this.attributes.delete(key);}};
    Object.defineProperty(node,"id",{set(value){elements.set(value,node);}});return node;
  }
  const document = {createElement:element, documentElement:{append(){}}, getElementById:id=>elements.get(id), querySelectorAll:()=>[], addEventListener(){}, readyState:"loading", scripts:[{src:"https://example.test/js/core/release-footer.js?v=test"}]};
  const window = {addEventListener:(type,callback)=>events.set(type,callback)};
  vm.runInNewContext(readFileSync("js/core/adminerva-loader.js","utf8"),{document,window});
  const status = elements.get("subtleLoader"), region = element();
  events.get("load")(); assert.equal(status.hidden,true);
  const first = window.beginLoading("First",region), second = window.beginLoading("Second",region);
  window.showSubtleLoader("Legacy");window.hideSubtleLoader();
  assert.equal(status.hidden,false);assert.equal(elements.get("subtleLoaderText").textContent,"Second");
  first();first();assert.equal(status.hidden,false);assert.equal(region.attributes.get("aria-busy"),"true");
  second();assert.equal(status.hidden,true);assert.equal(region.attributes.has("aria-busy"),false);
});
test("renamed routes retain bounded same-site redirects including query and fragment", () => {
  for (const [oldName,newName] of [["reporeviewDashboard.html","teacher-analytics.html"],["temp-grading.html","group-inspector.html"],["temp-activity-grader.html","activity-grader.html"]]) {
    const source=readFileSync(oldName,"utf8");let destination;
    const start = source.indexOf("<script>") + "<script>".length;
    const end = source.indexOf("</script>", start);
    assert.ok(start >= "<script>".length && end > start, "Owned redirect fixture must contain its exact script block");
    vm.runInNewContext(source.slice(start, end),{location:{search:"?student=alice",hash:"#review",replace:value=>destination=value}});
    assert.equal(destination,newName+"?student=alice#review");assert.ok(existsSync(newName));
  }
});
test("all root application pages mount help and public routes load no authentication guard", () => {
  const aliases = new Set(["reporeviewDashboard.html","temp-grading.html","temp-activity-grader.html"]);
  for (const file of readdirSync(".").filter(file=>file.endsWith(".html")&&!aliases.has(file))) {
    if(file.startsWith("guest-")){
      const content=readFileSync(file,"utf8");
      const publicShell=readFileSync("js/core/public-shell.mjs","utf8");
      assert.ok(/href="wiki\.html/.test(content)||(/public-shell\.mjs/.test(content)&&publicShell.includes('"wiki.html"')),file+" needs public help access");
      assert.doesNotMatch(content,/auth-guard[^"\s]*\.js|activity-client|(?:^|\/)notifications\.mjs/);
      continue;
    }
    const content=readFileSync(file,"utf8");
    const knownRedirects={"pilot-sandbox.html":"teacher-home.html","school-pilot.html":"school-admin.html","school-student-assessments.html":"student-assessments.html","teacher-assessment-library.html":"assessment-studio.html"};
    if(knownRedirects[file]){
      const target=knownRedirects[file];
      assert.ok(content.includes('"'+target+'"')&&/location\.replace\(/.test(content),file+" must keep its known redirect");
      assert.ok(readFileSync(target,"utf8").includes("adminerva-loader.js"),file+" destination needs shared help");
      continue;
    }
    const redirect=content.match(/location\.replace\(\s*["']([\w-]+\.html)["']\s*\+\s*location\.search\s*\+\s*location\.hash\s*\)/);
    if(redirect){assert.notEqual(redirect[1],file);assert.ok(existsSync(redirect[1]),file+" redirects to a missing page");assert.ok(readFileSync(redirect[1],"utf8").includes("adminerva-loader.js"),file+" must redirect to a page with shared help");continue;}
    assert.ok(content.includes("adminerva-loader.js"),file+" needs the shared help/loader entry");
  }
  for (const file of ["wiki.html","patch-notes.html","index.html"]) assert.doesNotMatch(readFileSync(file,"utf8"),/auth-guard[^"\s]*\.js/);
});
