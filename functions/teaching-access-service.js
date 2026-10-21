/** Credential-free roster projection and membership-change cleanup; no automatic ownership migration. */
const publicFields=["name","email","section","repoUrl","githubUsername","githubAccountVerified","studentNumber","groupName","gender"];
function teachingProfile(record){
  if(!record||record.active===false||record.status==="disabled"||typeof record.section!=="string"||!record.section)return null;
  return Object.fromEntries(publicFields.filter(field=>record[field]!==undefined).map(field=>[field,record[field]]));
}
function createTeachingAccessService({db,Timestamp,now=Date.now}){
  async function synchronize(studentId){
    return db.runTransaction(async transaction=>{
      const [source,previous,ranking]=await Promise.all([transaction.get(db.doc("students/"+studentId)),transaction.get(db.doc("teaching_roster/"+studentId)),transaction.get(db.doc("practice_rankings/"+studentId))]);
      const profile=teachingProfile(source.data()),prior=previous.data();
      const changed=!profile||profile.section!==ranking.data()?.section||(prior&&prior.email!==profile.email)||source.data()?.status==="disabled"||source.data()?.active===false;
      const session=ranking.exists&&changed?await transaction.get(db.doc("practice_sessions/"+ranking.data().ownerUid)):null;
      if(profile)transaction.set(db.doc("teaching_roster/"+studentId),profile);else transaction.delete(db.doc("teaching_roster/"+studentId));
      if(changed&&ranking.exists)transaction.delete(ranking.ref);
      if(session?.exists)transaction.update(session.ref,{revokedAt:Timestamp.fromMillis(now()),activeAttemptId:null});
      if(!profile)for(const courseId of ["java","python","web","logic"])transaction.delete(db.doc("practice_class_progress/"+studentId+"/courses/"+courseId));
      return {studentId,projected:Boolean(profile),rankingRemoved:Boolean(changed&&ranking.exists)};
    });
  }
  return {synchronize};
}
module.exports={teachingProfile,createTeachingAccessService};
