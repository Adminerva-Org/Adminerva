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
  const document = {createElement:element, documentElement:{append(){}}, getElementById:id=>elements.get(id), addEventListener(){}};
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
      assert.match(content,/href="wiki\.html/);assert.doesNotMatch(content,/adminerva-loader\.js|activity-client|notifications\.mjs/);
      continue;
    }
    assert.ok(readFileSync(file,"utf8").includes("adminerva-loader.js"),file+" needs the shared help/loader entry");
  }
  for (const file of ["wiki.html","patch-notes.html","index.html"]) assert.ok(!readFileSync(file,"utf8").includes("auth-guard.js"));
});
