"use strict";
/**
 * Creates an UNAPPROVED review file for the MCS canonical foundation plan.
 * The operator must explicitly approve person/account links, roles and academic IDs.
 * This file is data-entry scaffolding only; it grants nothing.
 */
const {readFileSync,writeFileSync}=require("node:fs");
const {createHash}=require("node:crypto");
const {SCHEMA,SCHOOL_ID}=require("./mcs-canonical-foundation-plan.js");
const APPROVAL_SCHEMA="adminerva-v4-mcs-canonical-foundation-approval-v1";
function sha256(value){return createHash("sha256").update(value).digest("hex");}
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide a restricted absolute --"+name+"=/secure/path.");
 return value;
}
function load(path){
 const raw=readFileSync(path),data=JSON.parse(raw.toString("utf8"));return {raw,data};
}
function createTemplate(plan,planRaw){
 if(plan?.schema!==SCHEMA||plan.schoolId!==SCHOOL_ID||plan.readOnly!==true||
    plan.readyForCanonicalApply!==false)
  throw Error("Use a current read-only MCS canonical foundation plan.");
 return {
  schema:APPROVAL_SCHEMA,schoolId:SCHOOL_ID,scope:"canonical_foundation_only",
  planSha256:sha256(planRaw),approvedBy:"",approvedAt:"",
  acknowledgements:{
   identityLinksReviewed:false,rolesReviewed:false,archivedStatusReviewed:false,
   academicLabelsReviewed:false,courseOfferingsDefined:false,
   noAutomaticLegacyAdminGrant:true,noEmailDomainAuthorization:true,
   backupsAndRollbackReviewed:false
  },
  people:(plan.people||[]).map(person=>({
   personId:person.personId,uid:person.uid,kind:person.kind,
   displayName:person.displayName,status:person.status,
   approveIdentityLink:false,approvedDisplayName:person.displayName,
   approvedStatus:person.status,notes:""
  })),
  memberships:(plan.memberships||[]).map(member=>({
   uid:member.uid,personId:member.personId,proposedRoles:member.roles,
   approvedRoles:[],approvedStatus:member.status,
   approveMembership:false,notes:""
  })),
  academic:{
   years:(plan.academicObservations?.years||[]).map(item=>({
    legacyLabel:item.legacyLabel,targetId:item.suggestedId,targetName:item.legacyLabel,approved:false
   })),
   sections:(plan.academicObservations?.sections||[]).map(item=>({
    legacyLabel:item.legacyLabel,targetId:item.suggestedId,targetName:item.legacyLabel,approved:false
   })),
   subjects:(plan.academicObservations?.subjects||[]).map(item=>({
    legacyLabel:item.legacyLabel,targetId:item.suggestedId,targetName:item.legacyLabel,approved:false
   })),
   terms:(plan.academicObservations?.terms||[]).map(item=>({
    legacyLabel:item.legacyLabel,targetId:item.suggestedId,targetName:item.legacyLabel,
    yearId:"",approved:false
   }))
  },
  courseOfferings:[],
  unresolvedBlockers:plan.blockers||[],
  reviewNotes:"",
  warning:"UNAPPROVED TEMPLATE. This file does not grant school access or authorize canonical writes."
 };
}
function main(){
 const args=process.argv.slice(2),planPath=arg(args,"plan"),output=arg(args,"output");
 const file=load(planPath),template=createTemplate(file.data,file.raw);
 writeFileSync(output,JSON.stringify(template,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({templateCreated:true,schoolId:SCHOOL_ID,
  people:template.people.length,memberships:template.memberships.length,
  blockers:template.unresolvedBlockers.length,approved:false}));
}
if(require.main===module)try{main();}catch(error){
 console.error("Canonical foundation approval template failed:",error.message);process.exitCode=1;
}
module.exports={APPROVAL_SCHEMA,createTemplate};
