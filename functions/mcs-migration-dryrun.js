"use strict";
/**
 * Approved-credential READ-ONLY ledger generator.
 * Does not authorize or perform migration, provisioning or grade changes.
 * Full manifest contains private document identifiers; save to restricted file.
 */
const {initializeApp,getApps,applicationDefault}=require("firebase-admin/app");
const {getFirestore,FieldPath}=require("firebase-admin/firestore");
const {writeFileSync}=require("node:fs");
const {candidateEntry,classification,mapPath}=require("./mcs-migration-ledger.js");
const DEFAULT_LIMIT=20000,MAX_DEPTH=12;
function safeTime(timestamp){
 if(!timestamp)return null;
 if(Number.isInteger(timestamp.seconds)&&Number.isInteger(timestamp.nanoseconds))
  return timestamp.seconds+"."+String(timestamp.nanoseconds).padStart(9,"0");
 return null;
}
async function dryRunLedger(db,{schoolId="mcs-manila",limit=DEFAULT_LIMIT,includeExistingTargets=true}={}){
 if(!/^[a-z][a-z0-9-]{1,63}$/.test(schoolId))throw Error("Invalid school ID");
 if(!Number.isSafeInteger(limit)||limit<1||limit>100000)throw Error("Invalid document limit");
 const roots=(await db.listCollections()).map(ref=>ref.id).sort();
 const report={
  schema:"adminerva-v4-mcs-dryrun-v1",schoolId,readOnly:true,source:"live firestore read-only",
  ownerStatement:"Owner confirms legacy records belong to Manila Cathedral School; no other school's data mixed in (2026-10-31).",
  status:"needs_operational_review",generatedAt:new Date().toISOString(),
  authorizedToWrite:false,entries:[],summary:{total:0,eligible_for_approved_mirror:0,
   identical_legacy_mirror:0,legacy_mirror_conflict:0,school_conflict:0,manual_review:0},
  groups:{},unknownRoots:[],warnings:[],truncated:false
 };
 const excluded=new Set(["platform_schools","platform_users","platform_admins","platform_audit","provisioning_jobs","migration_runs","system_health","schools"]);
 for(const root of roots) {
  if(excluded.has(root))continue;
  const kind=classification(root);
  if(kind==="unclassified_review")report.unknownRoots.push(root);
  const totals={classification:kind,documents:0,nestedDocuments:0};
  report.groups[root]=totals;
  async function scanCollection(colRef,depth){
   if(depth>MAX_DEPTH) {
    report.truncated=true;report.warnings.push("A nested collection exceeded the supported depth: "+root);return;
   }
   let lastDoc=null;
   while(report.summary.total<limit){
    let q=colRef.orderBy(FieldPath.documentId()).limit(Math.min(100,limit-report.summary.total));
    if(lastDoc)q=q.startAfter(lastDoc);
    const snap=await q.get();
    if(snap.empty)break;
    for(const doc of snap.docs){
     const record=doc.data();
     const sourcePath=doc.ref.path;
     let destination=null;
     if(kind==="school_candidate"&&includeExistingTargets) {
      const targetPath=mapPath(sourcePath,schoolId).targetPath;
      const existing=await db.doc(targetPath).get();
      destination={exists:existing.exists,data:existing.exists?existing.data():null};
     }
     const entry=candidateEntry({sourcePath,data:record,
       updateTime:safeTime(doc.updateTime),schoolId,destination});
     report.entries.push(entry);
     report.summary.total++;
     report.summary[entry.decision]++;
     totals.documents++;
     if(depth>1)totals.nestedDocuments++;
     if(report.summary.total>=limit){report.truncated=true;break;}
     const children=await doc.ref.listCollections();
     for(const sub of children.sort((a,b)=>a.id.localeCompare(b.id))){
      if(report.summary.total>=limit){report.truncated=true;break;}
      await scanCollection(sub,depth+1);
     }
    }
    if(snap.size<Math.min(100,limit-report.summary.total+snap.size))break;
    lastDoc=snap.docs.at(-1);
    if(report.summary.total>=limit)break;
   }
  }
  await scanCollection(db.collection(root),1);
  if(report.truncated)break;
 }
 if(report.unknownRoots.length)report.warnings.push("Unclassified roots require separate review before any cutover.");
 if(report.summary.school_conflict||report.summary.legacy_mirror_conflict)
  report.warnings.push("Conflicting school tags or existing legacy-mirror checksums prohibit automatic mirroring.");
 if(report.summary.manual_review)
  report.warnings.push("Platform, identity and secret records require explicit mapping and never an automatic record copy.");
 if(report.truncated)
  report.warnings.push("Inventory document limit/depth reached. This ledger is incomplete; do not migrate.");
 report.warnings.push("Missing ancestor documents with nested children may be invisible to collection queries; reconcile collection group exports and backup before migration.");
 report.warnings.push("This inventory does not include Cloud Storage blobs, browser-local drafts or third-party repository data.");
 report.warnings.push("Raw V3 records target only the school legacy mirror; they never become canonical V4 assessments, grades, people or submissions by copying.");
 report.warnings.push("Even mirror-eligible rows need backup, approval and checksum reconciliation; canonical V4 records require separate typed transforms and ownership/enrollment mapping.");
 report.requiresReview=true;
 return report;
}
async function main(){
 const args=process.argv.slice(2);
 const output=args.find(arg=>arg.startsWith("--output="))?.slice(9);
 if(!output||!output.startsWith("/")||output.includes("\0"))
  throw Error("A restricted absolute --output=/secure/path/ledger.json is required; do not print private paths to terminal.");
 if(!getApps().length)initializeApp({credential:applicationDefault()});
 const ledger=await dryRunLedger(getFirestore(),{
  schoolId:process.env.ADMINERVA_PILOT_SCHOOL_ID||"mcs-manila",
  limit:Number(process.env.ADMINERVA_INVENTORY_MAX_DOCS||DEFAULT_LIMIT)
 });
 writeFileSync(output,JSON.stringify(ledger,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({outputCreated:true,schoolId:ledger.schoolId,summary:ledger.summary,
  rootCount:Object.keys(ledger.groups).length,unknownRootCount:ledger.unknownRoots.length,
  truncated:ledger.truncated,readyForProductionMigration:false}));
}
if(require.main===module)main().catch(error=>{
 console.error("MCS dry-run inventory failed:",error.code||error.message);
 process.exitCode=1;
});
module.exports={dryRunLedger,safeTime};
