import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const backend=readFileSync(new URL("../functions/teacher-blueprints.js",import.meta.url),"utf8");
const library=readFileSync(new URL("../js/repo-review/teacher-assessment-library.mjs",import.meta.url),"utf8");
const campus=readFileSync(new URL("../functions/school-profile.js",import.meta.url),"utf8");
const page=readFileSync(new URL("../assessment-studio.html",import.meta.url),"utf8");
const shell=readFileSync(new URL("../js/assessment/assessment-studio-library-shell.mjs",import.meta.url),"utf8");
const indexes=JSON.parse(readFileSync(new URL("../firestore.indexes.json",import.meta.url),"utf8"));

test("archived assessment blueprints are owner-private and indexed",()=>{
  assert.match(backend,/if\(action==="list_archived"\)/);
  assert.match(backend,/where\("ownerUid","==",ctx\.uid\)\s*\.where\("status","==","archived"\)/);
  assert.match(backend,/orderBy\(FieldPath\.documentId\(\)\)\.limit\(26\)/);
  assert.match(backend,/query=query\.startAfter\(after\)/);
  assert.match(backend,/nextCursor:archived\.size>25\?page\[page\.length-1\]\.id:null/);
  assert.match(backend,/page\.some\(doc=>doc\.data\(\)\.schoolId!==ctx\.schoolId\|\|/);
  assert.match(backend,/doc\.data\(\)\.ownerUid!==ctx\.uid\|\|doc\.data\(\)\.status!=="archived"/);
  // Maintain the legacy owner listing contract: older drafts may lack a status field.
  assert.match(backend,/collection\.where\("ownerUid","==",ctx\.uid\)\.limit\(50\)\.get\(\)/);
  assert.match(backend,/value\.status!=="archived"/);
  assert.ok(indexes.indexes.some(item=>item.collectionGroup==="assessment_blueprints"&&
    item.queryScope==="COLLECTION"&&item.fields?.[0]?.fieldPath==="ownerUid"&&
    item.fields?.[1]?.fieldPath==="status"));
});

test("restore keeps the same blueprint identity and requires school owner, revision, and reason",()=>{
  const start=backend.indexOf('if(action==="restore")'),end=backend.indexOf('if(action==="share")',start);
  assert.ok(start>0&&end>start);
  const restore=backend.slice(start,end);
  assert.match(restore,/assertCurrentTeacher\(member\);assertCurrentSchool\(school\)/);
  assert.match(restore,/original\.data\(\)\.schoolId!==ctx\.schoolId/);
  assert.match(restore,/original\.data\(\)\.ownerUid!==ctx\.uid/);
  assert.match(restore,/data\.status!=="archived"/);
  assert.match(restore,/contentRevision\)\|\|1\)!==expectedRevision/);
  assert.match(restore,/reason\.length<12/);
  assert.match(restore,/status:"draft",visibility:"private",sharedWithUids:\[\]/);
  assert.match(restore,/aclRevision:\(Number\(data\.aclRevision\)\|\|1\)\+1/);
  assert.match(restore,/action:"restore",reason,previousVisibility/);
  assert.doesNotMatch(restore,/tx\.delete\(/);
  assert.doesNotMatch(restore,/tx\.create\(ref/);
});

test("canonical Assessment Studio separates archived blueprint restore from deployed task restore",()=>{
  assert.match(page,/data-filter="archived"/);
  assert.match(library,/filter==="archived"\?perform\("list_archived"\)/);
  assert.match(library,/item\.ownerUid===uid&&item\.status==="archived"/);
  assert.match(library,/Restore private draft/);
  assert.match(library,/Load more archived blueprints/);
  assert.match(library,/perform\("list_archived",\{cursor\}\)/);
  assert.match(library,/openBlueprintLifecycle\(item,"restore"\)/);
  assert.match(library,/openBlueprintLifecycle\(item,"archive"\)/);
  assert.match(library,/await perform\(action,\{resourceId:item\.id,expectedRevision:item\.contentRevision,reason\}\)/);
  assert.match(library,/performScoped\(scopedAssessmentApi,action,details\)/);
  assert.match(shell,/teacher-assessment-library\.mjs\?v=20261123-exam-finalize1/);
});

test("blueprint archival requires a reason and retains original history",()=>{
  const start=backend.indexOf('if(action==="update" || action==="archive")');
  const end=backend.indexOf('if(action==="restore")',start);
  assert.ok(start>0&&end>start);
  const archive=backend.slice(start,end);
  assert.match(archive,/Archive reason/);
  assert.match(archive,/legacyArchive=action==="archive"&&input.reason===undefined/);
  assert.match(archive,/reasonSource:legacyArchive\?"legacy_client":"teacher_supplied"/);
  assert.match(archive,/reason.length<12/);
  assert.match(archive,/archivedByUid:ctx.uid,archivedAt:now,archiveReason:reason/);
  assert.match(archive,/action,contentRevision:expectedRevision\+1/);
  assert.doesNotMatch(archive,/tx.delete\(/);
});
test("school campus lifecycle disallows updating archived records until reviewed restore",()=>{
  const start=campus.indexOf('if(input.action==="update_campus")');
  const end=campus.indexOf('if(["archive_campus","restore_campus"]',start);
  assert.ok(start>0&&end>start);
  const update=campus.slice(start,end);
  assert.match(update,/if\(current\.data\(\)\.status!=="active"\)/);
  assert.match(update,/Restore this campus before editing its details/);
  assert.match(update,/currentRevision!==expectedRevision/);
  assert.match(campus,/if\(restoring&&row\.status!=="archived"\)/);
  assert.match(campus,/if\(!restoring&&row\.status!=="active"\)/);
});
