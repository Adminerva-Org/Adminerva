"use strict";
/**
 * Creates an UNAPPROVED foundation review file prefilled for the MCS SHS ICT pilot.
 * Nothing is approved automatically; the operator must review identities, counts,
 * catalog rows and all eight active course offerings.
 */
const {readFileSync,writeFileSync}=require("node:fs");
const {join}=require("node:path");
const {createTemplate}=require("./mcs-canonical-foundation-approval-template.js");
const {SCHEMA:OPERATOR_SCHEMA}=require("./mcs-shs-pilot-operator-template.js");
const DEFAULTS_PATH=join(__dirname,"..","docs","adminerva-4-mcs-pilot-academic-defaults.json");
function arg(args,name){
 const value=args.find(item=>item.startsWith("--"+name+"="))?.slice(name.length+3);
 if(!value||!value.startsWith("/")||value.includes("\0"))
  throw Error("Provide --"+name+" as a restricted absolute path.");
 return value;
}
function read(path,label){
 const raw=readFileSync(path);let data;
 try{data=JSON.parse(raw.toString("utf8"));}catch{throw Error(label+" is not valid JSON.");}
 return {raw,data};
}
function createPilotTemplate(plan,planRaw,operator,defaults){
 if(operator?.schema!==OPERATOR_SCHEMA||operator.schoolId!=="mcs-manila")
  throw Error("Use the current protected pilot operator file.");
 if(plan?.pilotScope?.schema!=="adminerva-v4-mcs-shs-pilot-plan-scope-v1"||
    plan.pilotScope.productionAuthorized!==false)
  throw Error("Use an MCS SHS controlled-pilot foundation plan.");
 const template=createTemplate(plan,planRaw),programId="senior-high",
  active=new Set(operator.activeSectionIds||[]),yearId=operator.academicYear.yearId,
  yearName=operator.academicYear.name||yearId,
  observedYears=(plan.academicObservations?.years||[]).map(row=>row.legacyLabel).filter(Boolean),
  legacyYear=observedYears.find(label=>label===yearName)||observedYears[0]||yearName,
  termIds={1:yearId+"-semester-1",2:yearId+"-semester-2"};
 template.academic.programs=[{legacyLabel:"Senior High School",targetId:programId,
  targetName:"Senior High School",approved:false}];
 template.academic.years=[{legacyLabel:legacyYear,targetId:yearId,targetName:yearName,
  startMonth:Number(operator.academicYear.startMonth||7),endMonth:Number(operator.academicYear.endMonth||5),
  approved:false}];
 template.academic.sections=(defaults.sections||[]).filter(row=>active.has(row.sectionId)).map(row=>({
  legacyLabel:(row.legacyLabels||[])[0]||row.name,targetId:row.sectionId,targetName:row.name,
  programId,approved:false
 }));
 template.academic.subjects=(defaults.subjects||[]).map(row=>({
  legacyLabel:row.name,targetId:row.subjectId,targetName:row.name,approved:false
 }));
 template.academic.terms=[1,2].map(sequence=>({
  legacyLabel:"Semester "+sequence,targetId:termIds[sequence],targetName:"Semester "+sequence,
  yearId,programId,periodType:"semester",sequence,approved:false
 }));
 template.courseOfferings=(defaults.courseOfferingTemplates||[])
  .filter(row=>active.has(row.sectionId))
  .map(row=>({
   offeringId:[yearId,"sem"+row.semester,row.subjectId,row.sectionId].join("__"),
   programId,yearId,termId:termIds[row.semester],subjectId:row.subjectId,
   sectionId:row.sectionId,approved:false
  }));
 if(observedYears.length>1)template.reviewItems.push({
  type:"pilot_academic_year_observation_review",observedYears,resolved:false,resolution:"",
  note:"Only the operator-selected current academic year is included in the limited pilot. Confirm other observed labels remain historical/deferred."
 });
 template.reviewNotes="Limited SHS ICT pilot only. St. Sebastian and historical academic content remain deferred.";
 template.warning="UNAPPROVED PILOT TEMPLATE. Review every identity, acknowledgement, catalog row, roster-count review and course offering. This authorizes neither production activation nor V4-only cutover.";
 return template;
}
function main(){
 const args=process.argv.slice(2),plan=read(arg(args,"plan"),"Pilot plan"),
  operator=read(arg(args,"operator"),"Operator file"),output=arg(args,"output"),
  defaults=JSON.parse(readFileSync(DEFAULTS_PATH,"utf8")),
  template=createPilotTemplate(plan.data,plan.raw,operator.data,defaults);
 writeFileSync(output,JSON.stringify(template,null,2)+"\n",{flag:"wx",mode:0o600});
 console.info(JSON.stringify({pilotApprovalTemplateCreated:true,schoolId:"mcs-manila",
  people:template.people.length,memberships:template.memberships.length,
  offerings:template.courseOfferings.length,blockers:template.unresolvedBlockers.length,approved:false}));
}
if(require.main===module)try{main();}catch(error){
 console.error("MCS SHS pilot approval template failed:",error.message);process.exitCode=1;
}
module.exports={createPilotTemplate};
