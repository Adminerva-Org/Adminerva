import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {normalizeGoogleSheetUrl,fetchPublishedCsv}=require("../functions/school-roster-source.js");

test("normalizes an editable Google Sheet URL to bounded CSV export",()=>{
  const result=normalizeGoogleSheetUrl("https://docs.google.com/spreadsheets/d/12345678901234567890ABCDEF/edit#gid=123");
  assert.equal(result.gid,"123");
  assert.equal(result.url,"https://docs.google.com/spreadsheets/d/12345678901234567890ABCDEF/export?format=csv&gid=123");
});
test("normalizes published Google Sheet URLs without accepting arbitrary hosts",()=>{
  const published=normalizeGoogleSheetUrl("https://docs.google.com/spreadsheets/d/e/2PACX-123456789012345678901234567890/pubhtml?gid=0");
  assert.equal(published.published,true);
  assert.match(published.url,/^https:\/\/docs\.google\.com\/spreadsheets\/d\/e\//);
  assert.throws(()=>normalizeGoogleSheetUrl("https://example.com/spreadsheets/d/12345678901234567890/export"));
});
test("published sheet fetch follows only Google controlled redirects and rejects HTML",async()=>{
  const fetchImpl=async url=>{
    const href=String(url);
    if(href.includes("docs.google.com"))return new Response(null,{status:302,headers:{location:"https://doc-1.googleusercontent.com/export.csv"}});
    return new Response("email,firstName,lastName\nstudent@example.edu,Ana,Santos\n",{
      status:200,headers:{"content-type":"text/csv"}
    });
  };
  const result=await fetchPublishedCsv("https://docs.google.com/spreadsheets/d/12345678901234567890ABCDEF/export?format=csv",{fetchImpl});
  assert.match(result.csv,/student@example\.edu/);
  await assert.rejects(()=>fetchPublishedCsv(
    "https://docs.google.com/spreadsheets/d/12345678901234567890ABCDEF/export?format=csv",
    {fetchImpl:async()=>new Response("<html>login</html>",{status:200,headers:{"content-type":"text/html"}})}
  ));
});
