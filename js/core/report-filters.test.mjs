/** Regression coverage: Shared navigation, account access, reporting and release infrastructure: report filters. */
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {filterReports,ownsReport,visibleReport,reportAudience} from "./report-filters.mjs";
const rows=[
  {id:"t1",title:"Broken navigation",description:"Menu",category:"UI",audience:"teacher",
    status:"Open",priority:"High",reporterUid:"alice",createdAt:{seconds:10},upvotes:["alice"]},
  {id:"t2",title:"Slow lesson generation",description:"Teacher schedule",module:"Lesson Review",
    category:"Feature",audience:"teacher",status:"In Progress",priority:"Medium",
    reporterUid:"bob",createdAt:{seconds:20},upvotes:[]},
  {id:"a1",title:"Account login issue",description:"Authentication",category:"Access",
    audience:"admin",status:"Resolved",priority:"Critical",reporterUid:"teacher",
    createdAt:{seconds:30},upvotes:["teacher","admin"]},
  {id:"a2",title:"System bug",category:"Bug",audience:"admin",
    status:"Open",priority:"Low",reporterUid:"bob",createdAt:{seconds:40},upvotes:[]},
  {id:"legacy",title:"Older missing audience",category:"Bug",status:"Open",
    reporterUid:"alice",createdAt:{seconds:1},upvotes:[]}
];
test("teacher sees all teacher-directed reports plus own admin reports, never another person's bugs",()=>{
  const filter={role:"teacher",uid:"teacher",email:"teacher@example.edu"};
  assert.deepEqual(filterReports(rows,filter).map(r=>r.id),["a1","t2","t1"]);
  assert.deepEqual(filterReports(rows,{...filter,onlyMine:true}).map(r=>r.id),["a1"]);
  assert.equal(visibleReport(rows[3],filter),false);
  assert.equal(reportAudience(rows[4]),"admin");
});
test("students see their own reports only, including older missing-audience records",()=>{
  const mine=filterReports(rows,{role:"student",uid:"alice"});
  assert.deepEqual(mine.map(r=>r.id),["t1","legacy"]);
  assert.ok(ownsReport({reporterEmail:"SCHOOL@EXAMPLE.EDU"},null,"school@example.edu"));
  assert.ok(!ownsReport({reporterUid:"bob"},"alice",""));
});
test("admin report category, status, recipient, and search filters combine",()=>{
  const options={role:"admin",category:"Feature",status:"In Progress",audience:"teacher",
    search:"schedule"};
  assert.deepEqual(filterReports(rows,options).map(r=>r.id),["t2"]);
  assert.deepEqual(filterReports(rows,{role:"admin",search:"login"}).map(r=>r.id),["a1"]);
  assert.deepEqual(filterReports(rows,{role:"admin",search:"id-does-not-exist"}),[]);
});
test("sorting supports newest, oldest, priority and votes without mutating the source",()=>{
  const snapshot=[...rows];
  const opt={role:"admin"};
  assert.deepEqual(filterReports(rows,opt).map(r=>r.id),["a2","a1","t2","t1","legacy"]);
  assert.deepEqual(filterReports(rows,{...opt,sort:"oldest"}).map(r=>r.id),["legacy","t1","t2","a1","a2"]);
  assert.deepEqual(filterReports(rows,{...opt,sort:"priority"}).map(r=>r.id),["a1","t1","t2","a2","legacy"]);
  assert.deepEqual(filterReports(rows,{...opt,sort:"upvotes"}).map(r=>r.id).slice(0,3),["a1","t1","a2"]);
  assert.deepEqual(rows,snapshot);
});
test("report UI contains controls and role-appropriate triage safeguards",()=>{
  const html=readFileSync("issues.html","utf8");
  for(const id of ["filterSearch","filterSort","filterCategory","filterStatus",
    "filterAudience","filterMine","resetReportFilters","issuesFeedSummary","adminControlLabel"])
    assert.ok(html.includes('id="'+id+'"'),"Missing report control "+id);
  const source=readFileSync("js/core/issues.js","utf8");
  assert.match(source,/where\("reporterUid","==",user\.uid\)/);
  assert.match(source,/where\("reporterEmail","==",currentUserEmail\)/);
  assert.match(source,/filterReports\(allIssues/);
  assert.match(source,/isSuperAdmin\s*\?\s*"Administrator controls:"\s*:\s*"Teacher controls:"/);
  assert.match(source,/adminDeleteBtn"\)\.classList\.toggle\("hidden",!isSuperAdmin\)/);
});
