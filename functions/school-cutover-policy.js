"use strict";
/** Shared validation for platform-owner school cutover policy decisions. */
const SCHEMA="adminerva-v4-school-cutover-decisions-v1";
const permissionModes=new Set(["approved","disabled"]);
const requiredReferences=[
 "institutionalAuthorityReference","calendarReference","privacyPolicyReference",
 "retentionPolicyReference","backupPolicyReference"
];
function text(value,min,max,label){
 const out=typeof value==="string"?value.trim():"";
 if(out.length<min||out.length>max)throw Error(label+" must be "+min+"-"+max+" characters.");
 return out;
}
function normalizeCutoverDecisions(input={}){
 const result={
  institutionalAuthorityReference:text(input.institutionalAuthorityReference,8,240,"Institutional authority reference"),
  calendarReference:text(input.calendarReference,8,240,"Academic calendar reference"),
  privacyPolicyReference:text(input.privacyPolicyReference,8,240,"Privacy policy reference"),
  retentionPolicyReference:text(input.retentionPolicyReference,8,240,"Retention policy reference"),
  backupPolicyReference:text(input.backupPolicyReference,8,240,"Backup policy reference"),
  dataStewardRole:text(input.dataStewardRole,3,120,"Data steward role"),
  aiPermission:String(input.aiPermission||""),
  repositoryPermission:String(input.repositoryPermission||""),
  firstAdminAcknowledged:input.firstAdminAcknowledged===true,
  schoolAdminConfigurationReviewed:input.schoolAdminConfigurationReviewed===true,
  notes:typeof input.notes==="string"?input.notes.trim().slice(0,1000):""
 };
 if(!permissionModes.has(result.aiPermission))
  throw Error("School AI permission must be approved or disabled.");
 if(!permissionModes.has(result.repositoryPermission))
  throw Error("External repository permission must be approved or disabled.");
 if(!result.firstAdminAcknowledged)
  throw Error("The first verified school administrator must be acknowledged.");
 if(!result.schoolAdminConfigurationReviewed)
  throw Error("School administrator configuration review must be acknowledged.");
 return result;
}
function evaluateCutoverDecisionRecord(data,{schoolId,firstAdminUid}={}){
 const missing=[];
 if(!data||data.schema!==SCHEMA)missing.push("decision_record");
 if(data?.schoolId!==schoolId)missing.push("school_binding");
 if(!firstAdminUid||data?.firstAdminUid!==firstAdminUid)missing.push("first_admin_binding");
 for(const key of requiredReferences)
  if(typeof data?.[key]!=="string"||data[key].trim().length<8)missing.push(key);
 if(typeof data?.dataStewardRole!=="string"||data.dataStewardRole.trim().length<3)
  missing.push("dataStewardRole");
 if(!permissionModes.has(data?.aiPermission))missing.push("aiPermission");
 if(!permissionModes.has(data?.repositoryPermission))missing.push("repositoryPermission");
 if(data?.firstAdminAcknowledged!==true)missing.push("firstAdminAcknowledged");
 if(data?.schoolAdminConfigurationReviewed!==true)missing.push("schoolAdminConfigurationReviewed");
 return {ok:missing.length===0,missing};
}
module.exports={SCHEMA,normalizeCutoverDecisions,evaluateCutoverDecisionRecord};
