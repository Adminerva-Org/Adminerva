const {teachingProfile}=require("./teaching-access-service.js");
const version=snapshot=>snapshot.exists?String(snapshot.updateTime.seconds)+":"+snapshot.updateTime.nanoseconds:null;
function planAcademicAccess(records,custodianUid){
  if(typeof custodianUid!=="string"||!custodianUid)throw Error("An administrator custodian UID is required.");
  const changes=[],blockers=[],students=new Map(records.students.map(record=>[record.id,record]));
  const add=(path,patch,target,source,replace=false)=>changes.push({path,patch,version:target?.version||null,sourcePath:source?.path||null,sourceVersion:source?.version||null,replace});
  for(const student of records.students){
    const profile=teachingProfile(student.data);if(!profile)continue;
    const existing=records.teaching_roster.find(record=>record.id===student.id);
    if(!existing||Object.keys(existing.data).length!==Object.keys(profile).length||Object.keys(profile).some(field=>JSON.stringify(existing.data[field])!==JSON.stringify(profile[field])))
      add("teaching_roster/"+student.id,profile,existing,student,true);
  }
  for(const assessment of records.assessments){
    const data=assessment.data;
    if(["sectionIds","deployments","targetSections"].some(field=>data[field]!==undefined&&!Array.isArray(data[field]))){blockers.push({path:assessment.path,reason:"Deployment metadata has an invalid type."});continue;}
    const sectionIds=[...new Set([...(data.sectionIds||[]),...(data.targetSections||[]),...(data.deployments||[]).map(item=>item.section)])];
    if(sectionIds.length>20||sectionIds.some(section=>typeof section!=="string"||!section||section.length>120)||(data.deployments||[]).length>20){blockers.push({path:assessment.path,reason:"Review invalid or oversized deployment scope manually."});continue;}
    const patch={};
    if(!data.ownerUid){patch.ownerUid=custodianUid;patch.ownershipBasis="legacy-administrator-custody-not-original-authorship";}
    if(!Array.isArray(data.sectionIds)||JSON.stringify(data.sectionIds)!==JSON.stringify(sectionIds))patch.sectionIds=sectionIds;
    if(Object.keys(patch).length)add(assessment.path,patch,assessment);
    const privateRecord=records.assessment_private.find(record=>record.id===assessment.id);
    if(privateRecord&&(privateRecord.data.ownerUid!==(data.ownerUid||custodianUid)||JSON.stringify(privateRecord.data.sectionIds)!==JSON.stringify(sectionIds)))
      add(privateRecord.path,{ownerUid:data.ownerUid||custodianUid,sectionIds},privateRecord,assessment);
  }
  for(const grade of records.student_grades){
    if(grade.data.section)continue;
    const student=students.get(grade.data.studentId);
    if(!student||typeof student.data.section!=="string"||!student.data.section){blockers.push({path:grade.path,reason:"No canonical student section; do not infer from names or document IDs."});continue;}
    add(grade.path,{section:student.data.section},grade,student);
  }
  changes.sort((first,second)=>Number(second.path.startsWith("assessment_private/"))-Number(first.path.startsWith("assessment_private/")));
  return {changes,blockers,counts:Object.fromEntries(["teaching_roster","assessments","assessment_private","student_grades"].map(collection=>[collection,changes.filter(change=>change.path.startsWith(collection+"/")).length]))};
}
function createAcademicPreparation({db,FieldValue}){
  async function apply(plan,{actorUid,runId}){
    if(plan.blockers.length)throw Error("Resolve the preparation blockers before applying this plan.");
    if(!actorUid||!/^[a-zA-Z0-9_-]{8,100}$/.test(runId||""))throw Error("An administrator and unique preparation ID are required.");
    let applied=0;
    for(const [index,change] of plan.changes.entries()){
      await db.runTransaction(async transaction=>{
        const target=db.doc(change.path),audit=db.doc("academic_access_preparations/"+runId+"/changes/"+index);
        const current=await transaction.get(target),priorAudit=await transaction.get(audit);
        const source=change.sourcePath?await transaction.get(db.doc(change.sourcePath)):null;
        if(priorAudit.exists){if(priorAudit.data().path!==change.path)throw Error("Preparation ID was used by a different plan.");return;}
        if(version(current)!==change.version||source&&version(source)!==change.sourceVersion)throw Error("Records changed. Generate a new preparation plan.");
        const before=current.data()||{};
        transaction.create(audit,{path:change.path,fields:Object.keys(change.patch),beforeScope:{ownerUid:before.ownerUid||null,section:before.section||null,sectionIds:before.sectionIds||null},
          afterScope:{ownerUid:change.patch.ownerUid||before.ownerUid||null,section:change.patch.section||before.section||null,sectionIds:change.patch.sectionIds||before.sectionIds||null},actorUid,createdAt:FieldValue.serverTimestamp()});
        if(change.replace||!current.exists)transaction.set(target,change.patch);else transaction.update(target,change.patch);
      });applied++;
    }
    return {processed:applied,counts:plan.counts};
  }
  return {apply};
}
module.exports={planAcademicAccess,createAcademicPreparation,version};
