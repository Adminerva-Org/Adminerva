"use strict";
/**
 * Creates an UNAPPROVED operator-review template tied to one exact dry-run
 * ledger. It never grants authorization and contains no Firestore credentials.
 */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {validateLedger,APPROVAL_SCHEMA,SCHOOL_ID}=require("./mcs-migration-apply.js");
function absoluteArg(args,name){
 const value=args.find(arg=>arg.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide an absolute --"+name+"=/secure/path.");
 return value;
}
function main(){
 const args=process.argv.slice(2),ledgerPath=absoluteArg(args,"ledger"),output=absoluteArg(args,"output");
 const raw=readFileSync(ledgerPath),ledger=JSON.parse(raw.toString("utf8"));
 const eligible=validateLedger(ledger);
 const approval={
  schema:APPROVAL_SCHEMA,schoolId:SCHOOL_ID,scope:"legacy_mirror_only",
  ledgerSha256:createHash("sha256").update(raw).digest("hex"),
  approvedBy:"",approvedAt:"",
  acknowledgements:{
   backupCaptured:false,conflictsReviewed:false,identityAndPlatformExcluded:false,
   canonicalTransformsExcluded:false,triggerSideEffectsReviewed:false,
   rollbackRunbookReviewed:false
  },
  reviewNotes:"",
  expectedEligibleMirrorRecords:eligible.length,
  warning:"UNAPPROVED TEMPLATE. Set every acknowledgement true only after independent operational review."
 };
 writeFileSync(output,JSON.stringify(approval,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({templateCreated:true,schoolId:SCHOOL_ID,
   eligibleMirrorRecords:eligible.length,approved:false}));
}
if(require.main===module){
 try{main();}catch(error){console.error("Approval template creation failed:",error.message);process.exitCode=1;}
}
module.exports={main};
