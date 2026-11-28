import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

const users=read("system-users.html");
const usersClient=read("js/core/platform-users.mjs");
const page=read("platform-logs.html");
const viewer=read("js/core/platform-logs.mjs");
const css=read("css/platform-logs.css");
const navigation=read("js/core/navigation-ia.mjs");
const workflow=read("js/core/platform-admin-workflow.mjs");
const guard=read("js/core/auth-guard-v4-pilot.js");
const backend=read("functions/platform-account-diagnostics.js");

test("log inspection is a separate read-only page and no longer embedded in Users",()=>{
  assert.doesNotMatch(users,/id="pu-diagnostic-(?:load|events|audit|next|reason|status)"/);
  assert.doesNotMatch(usersClient,/function loadDiagnostics\(/);
  assert.doesNotMatch(usersClient,/resetDiagnostics|pu-diagnostic-/);
  assert.doesNotMatch(usersClient,/platformAccountDiagnostics/);
  assert.match(users,/id="pu-open-logs"[^>]*href="platform-logs.html"/);
  assert.match(usersClient,/el\("pu-open-logs"\)\.href="platform-logs\.html\?uid="/);
  assert.match(page,/User Action &amp; System Logs/);
  assert.match(page,/id="pl-reason"/);
  assert.match(page,/id="pl-accounts"/);
  assert.match(page,/id="pl-events"/);
  assert.match(page,/id="pl-more"/);
  assert.doesNotMatch(page,/id="pu-(?:create|lifecycle|platform-authority|save-profile)"/);
});

test("Log Viewer loads the shared Tailwind navigation and safely contains notifications",()=>{
  assert.match(page,/<script defer src="https:\/\/cdn\.tailwindcss\.com"><\/script>/);
  assert.match(page,/adminerva-nav\.js\?v=/);
  assert.match(css,/#adminerva-nav #av-alert-panel\.hidden\{display:none!important\}/);
  assert.match(css,/#adminerva-nav #av-alert-panel\{[\s\S]*?position:absolute/);
  assert.match(css,/@media\(max-width:640px\)\{[\s\S]*?#adminerva-nav #av-alert-panel/);
});

test("Platform-only diagnostic analytics distinguish server results from browser observations",()=>{
  assert.match(page,/id="pl-trends"/);
  assert.match(page,/id="pl-trends-refresh"/);
  assert.match(page,/id="pl-trends-metrics"/);
  assert.match(page,/id="pl-trends-chart"/);
  assert.match(page,/id="pl-trends-services"/);
  assert.match(page,/id="pl-trends-browsers"/);
  assert.match(viewer,/action:"global_trends"/);
  assert.match(viewer,/function loadTrends\(/);
  assert.match(viewer,/function renderTrends\(/);
  assert.match(viewer,/record\.provenance/);
  assert.match(viewer,/row\.provenance==="server_confirmed"/);
  assert.match(page,/A truncated sample understates event volume/);
  assert.match(css,/\.pl-trend-segment\[data-level=failure\]/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.doesNotMatch(page,/download.*\.csv/i);
});

test("investigation UI reports filter scope and never treats unseen time buckets as recorded zeros",()=>{
  assert.match(page,/id="pl-filter-status"/);
  assert.match(page,/id="pl-clear-filters"/);
  assert.match(page,/id="pl-trends-table"/);
  assert.match(page,/View exact recorded event counts by time/);
  assert.match(page,/A truncated sample understates event volume/);
  assert.match(page,/a durable database write/);
  assert.match(viewer,/function renderFilterSummary\(/);
  assert.match(viewer,/function clearInvestigationFilters\(/);
  assert.match(viewer,/renderFilterSummary\(filtered\.length,rows\.length\)/);
  assert.match(viewer,/renderFilterSummary\(live\.rows\.filter\(liveMatches\)\.length,live\.rows\.length\)/);
  assert.match(viewer,/coverage==="unsampled"\?"—":value/);
  assert.match(viewer,/coverage==="unsampled"\?"Not covered"/);
  assert.match(viewer,/state\.trendsRendered===data/);
  assert.match(viewer,/function diagnosticActionLabel\(/);
  assert.match(viewer,/api_succeeded"\)return "Backend callable returned"/);
  assert.match(viewer,/Callable returned without throwing; not proof of a committed record/);
  assert.match(css,/pl-trend-bucket\[data-coverage=unsampled\]/);
  assert.match(css,/pl-trends-table-wrap/);
  assert.match(css,/pl-filter-feedback/);
  assert.match(css,/@media\(max-width:560px\)/);
});

test("wide-screen compact workspace retains canonical log controls and responsive disclosures",()=>{
  assert.match(page,/class="pl-hero-main"/);
  assert.match(page,/id="pl-directory-disclosure" class="pl-directory-disclosure" open/);
  assert.match(page,/class="pl-mode-bar" aria-label="Diagnostic views"/);
  assert.match(page,/id="pl-show-live"/);
  assert.match(page,/id="pl-show-global"/);
  assert.match(page,/id="pl-show-recent"/);
  assert.match(page,/id="pl-filter-disclosure" class="pl-filter-disclosure" open/);
  assert.match(page,/id="pl-analysis-drawer" class="pl-analysis-drawer" hidden/);
  assert.match(page,/class="pl-analysis-content"/);
  assert.match(page,/id="pl-reason" rows="1" minlength="12" maxlength="300"/);
  assert.match(viewer,/function syncCompactDisclosures\(/);
  assert.match(viewer,/compactViewport=window\.matchMedia\("\(max-width: 780px\)"\)/);
  assert.match(viewer,/compactViewport\.addEventListener\("change",syncCompactDisclosures\)/);
  assert.match(viewer,/\$\("pl-analysis-drawer"\)\.hidden=state\.view!=="global"/);
  assert.match(viewer,/cell\.dataset\.label=label;cell\.classList\.add\(cssName\)/);
  assert.match(viewer,/\["Account ID",ownerUid\]/);
  assert.match(css,/1940px/);
  assert.match(css,/grid-template-columns:clamp\(210px,19vw,276px\) minmax\(0,1fr\)/);
  assert.match(css,/@media\(max-width:780px\)/);
  assert.match(css,/\.pl-table tbody tr\{display:grid;grid-template-columns:/);
  assert.match(css,/\.pl-live-line\{grid-template-columns:77px 48px minmax\(0,1fr\)/);
  assert.match(css,/\.pl-analysis-drawer>summary/);
  assert.match(css,/\.pl-filter-bar\{display:flex;flex-direction:column/);
  assert.match(page,/css\/platform-logs\.css\?v=20261126-trace-6/);
  assert.match(page,/js\/core\/platform-logs\.mjs\?v=20261126-trace-6/);
  assert.doesNotMatch(viewer,/setDoc|updateDoc|deleteDoc/);
});

test("live console is separate from historical views with three-second polling and bounded rendering",()=>{
  assert.match(page,/id="pl-show-live"/);
  assert.match(page,/id="pl-live"/);
  assert.match(page,/id="pl-live-console"/);
  assert.match(page,/id="pl-live-batch"/);
  assert.match(page,/id="pl-live-total"/);
  assert.match(page,/id="pl-live-last"/);
  assert.match(page,/id="pl-live-toggle"/);
  assert.match(page,/id="pl-live-stop"/);
  assert.match(page,/id="pl-live-follow"/);
  assert.match(page,/id="pl-live-status"/);
  assert.match(page,/checks for newly indexed events every 3 seconds/);
  assert.match(viewer,/LIVE_INTERVAL_MS=3000,LIVE_MAX_LINES=240/);
  assert.match(viewer,/action:"global_live"/);
  assert.match(viewer,/function pollLive\(/);
  assert.match(viewer,/function stopLive\(/);
  assert.match(viewer,/function toggleLive\(/);
  assert.match(viewer,/function liveLine\(/);
  assert.match(viewer,/new Set\(\),highlighted:new Map\(\)/);
  assert.match(viewer,/result\.hasMore\?150:LIVE_INTERVAL_MS/);
  assert.match(viewer,/document\.addEventListener\("visibilitychange"/);
  assert.match(viewer,/window\.addEventListener\("offline"/);
  assert.match(viewer,/window\.addEventListener\("online"/);
  assert.match(css,/pl-live-line\.pl-live-new/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\).*pl-live-new/);
  assert.doesNotMatch(viewer,/onSnapshot|collectionGroup|Firestore\.collection/);
});

test("separate logs route retains platform administration role guards and canonical navigation",()=>{
  assert.match(guard,/owner-schools\|system-users\|platform-logs/);
  assert.match(navigation,/live\("platform-logs","User Action & System Logs","platform-logs\.html"/);
  assert.match(workflow,/file:"platform-logs\.html",label:"User Action & System Logs"/);
  assert.match(page,/auth-guard-v4-pilot\.js\?v=/);
  assert.match(page,/platform-logs\.mjs\?v=/);
});

test("global developer console queries individual events and provides bounded impact analysis",()=>{
  assert.match(page,/Global Event Stream/);
  assert.match(page,/id="pl-window"/);
  assert.match(page,/id="pl-impact-results"/);
  assert.match(page,/id="pl-event-search"/);
  assert.match(viewer,/action:"global_feed"/);
  assert.match(viewer,/action:"global_impact"/);
  assert.match(viewer,/function loadGlobal\(/);
  assert.match(viewer,/function loadImpact\(/);
  assert.match(viewer,/request trace|Cloud trace|cloud trace/i);
  assert.match(viewer,/record\.operationId/);
  assert.match(viewer,/state\.fingerprint/);
  assert.match(page,/the new global index starts with newly recorded events/);
});

test("normal, warning, failure flags remain readable on mobile and do not conflate clicks with saved outcomes",()=>{
  for(const level of ["normal","warning","failure"]){
    assert.match(page,new RegExp('data-level="'+level+'"'));
    assert.match(css,new RegExp('data-level='+level));
  }
  assert.match(page,/A normal click means it was observed, not that a save or submission succeeded/);
  assert.match(page,/Severity and module filters are applied server-side in the Global Event Stream/);
  assert.match(page,/text search filters the currently loaded rows only/);
  assert.match(css,/@media\(max-width:560px\)/);
  assert.match(page,/minlength="12" maxlength="300"/);
  assert.match(viewer,/severity:severity\(row.severity\)/);
  assert.match(viewer,/function renderEvents\(\)/); // event properties are displayed, not edited.
});

test("directory and recent accounts are read only from canonical callable APIs after an audited reason",()=>{
  assert.match(viewer,/httpsCallable\(functions,"platformUsers"\)/);
  assert.match(viewer,/httpsCallable\(functions,"platformAccountDiagnostics"\)/);
  assert.match(viewer,/action:"list_all"/);
  assert.match(viewer,/action:"recent_accounts",reason/);
  assert.match(viewer,/action:"list",targetUid:selected,reason/);
  assert.match(viewer,/requiredReason\(\)/);
  assert.match(backend,/action:"platform_user_diagnostics_recent_viewed"/);
  assert.match(backend,/action:"platform_user_diagnostics_viewed"/);
  assert.match(backend,/if\(!authority\.platformAdmin\)deny\("permission-denied"/);
  assert.doesNotMatch(viewer,/setDoc|updateDoc|deleteDoc|collectionGroup/);
  assert.doesNotMatch(page,/export.*CSV/i);
});

test("inspector is bounded to authorized loaded operations and resets with view access",()=>{
 assert.match(page,/id="pl-inspector"/);assert.match(viewer,/function relatedOperationRows/);
 assert.match(viewer,/row\.sessionId===selected\.sessionId/);assert.match(viewer,/stopLive\(\);closeInspector\(\)/);
 assert.match(viewer,/missing completion is not proof of a stuck process/);
 assert.match(css,/pl-investigation-grid\.pl-inspecting/);
});

test("stream-first workspace preserves audit reason and adds quick filters",()=>{
 assert.match(page,/id="pl-access-disclosure"/);assert.match(page,/data-filter="failure"/);assert.match(page,/id="pl-focus-mode"/);assert.match(page,/id="pl-milliseconds"/);assert.match(viewer,/function markAudited/);assert.match(viewer,/reason changed/i);assert.match(css,/pl-directory-collapsed/);
});

test("operation timeline connects explicit parent spans but excludes other accounts, sessions and unrelated overlap",()=>{
 const start=viewer.indexOf("function linkedOperationIds("),end=viewer.indexOf("function loadedRows(",start);
 const {relatedOperationRows,operationStatus,summarizeOperationFamily}=new Function(viewer.slice(start,end)+";return {relatedOperationRows,operationStatus,summarizeOperationFamily};")();
 const root={id:"r",ownerUid:"a",sessionId:"s",operationId:"root",action:"process_started",at:1};
 const child={...root,id:"c",operationId:"child",context:{parentOperationId:"root"},at:2};
 const server={...child,id:"b",action:"api_failed",provenance:"server_confirmed",at:3};
 const overlap={...root,id:"o",operationId:"other",context:{active:[{id:"root",ageMs:65000}]},at:4};
 const alien={...child,id:"x",ownerUid:"b"},otherSession={...child,id:"y",sessionId:"t"};
 const unrelated={...root,id:"z",operationId:"other",at:5};
 const rows=[root,child,server,overlap,alien,otherSession,unrelated];
 assert.deepEqual(relatedOperationRows(rows,root,"a").map(x=>x.id),["r","c","b","o"]);
 assert.equal(operationStatus(rows,"child"),"Backend rejection recorded; browser completion not loaded");
 assert.match(operationStatus(rows,"root"),/Observed active for 65s/);
 assert.deepEqual(summarizeOperationFamily(relatedOperationRows(rows,root,"a"),root),{operations:2,events:3,backendReturns:0,backendRejections:1,contextEvents:1});
 assert.match(operationStatus([root,{...root,action:"process_prolonged",context:{elapsedMs:61000}}],"root"),/Observed active for 61s/);
});

test("panel sizes and loaded-record lookup are available without changing read authority",()=>{
 assert.match(page,/id="pl-directory-width"/);assert.match(page,/id="pl-inspector-width"/);assert.match(viewer,/Find page instance/);assert.match(viewer,/Search loaded records only/);assert.match(css,/--pl-inspector-width/);
});
