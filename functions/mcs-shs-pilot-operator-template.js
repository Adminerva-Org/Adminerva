"use strict";
/**
 * Creates a protected operator file for the MCS Senior High ICT controlled pilot.
 * The output contains no student PII. The operator must insert the verified teacher UID
 * and explicitly acknowledge the limited non-production scope before planning.
 */
const {writeFileSync}=require("node:fs");
const SCHEMA="adminerva-v4-mcs-shs-pilot-operator-v1";
function outputArg(args){
 const value=args.find(arg=>arg.startsWith("--output="))?.slice(9);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide a restricted absolute --output=/secure/path.");
 return value;
}
function academicYear(now=new Date()){
 const year=now.getUTCFullYear(),month=now.getUTCMonth()+1,start=month>=7?year:year-1;
 return {yearId:String(start)+"-"+String(start+1),name:String(start)+"-"+String(start+1),
  startMonth:7,endMonth:5};
}
function createTemplate(now=new Date()){
 const year=academicYear(now);
 return {
  schema:SCHEMA,schoolId:"mcs-manila",scope:"senior_high_ict_limited_pilot",
  productionAuthorized:false,compatibilityMode:"legacy_allowed",
  teacherUid:"",
  academicYear:year,
  activeSectionIds:[
   "shs-g11-techpro-ict-st-isidore-of-seville",
   "shs-g11-techpro-ict-st-carlo-acutis",
   "shs-g12-tvl-ict-st-philip-the-apostle",
   "shs-g12-tvl-ict-st-anselm-of-canterbury"
  ],
  pendingSectionIds:["shs-g11-techpro-ict-st-sebastian"],
  rosterReference:"protected_drive_snapshot_2026-11-08",
  acknowledgements:{
   limitedScopeReviewed:false,
   rosterReferenceReviewed:false,
   productionNotAuthorized:false
  },
  notes:"St. Sebastian remains pending until a reviewed roster/source is available."
 };
}
function main(){
 const output=outputArg(process.argv.slice(2)),template=createTemplate();
 writeFileSync(output,JSON.stringify(template,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({pilotOperatorTemplateCreated:true,schoolId:template.schoolId,
  academicYear:template.academicYear.yearId,activeSections:template.activeSectionIds.length,
  productionAuthorized:false}));
}
if(require.main===module)try{main();}catch(error){
 console.error("MCS SHS pilot operator template failed:",error.message);process.exitCode=1;
}
module.exports={SCHEMA,academicYear,createTemplate};
