"use strict";
/** Aggregate-only school operations analytics for Adminerva 4.0. */
const {getSchoolContext,TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message)}
async function count(collection,field,value){
  let query=collection;
  if(field)query=query.where(field,"==",value);
  const snapshot=await query.count().get();
  return snapshot.data().count||0;
}
function createSchoolAnalyticsService({db}){
 return async request=>{
  const input=request.data||{};
  const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles:["school_admin"]});
  if((input.action||"overview")!=="overview")
    deny("invalid-argument","Unknown school analytics operation.");
  const prefix="schools/"+ctx.schoolId+"/";
  const names={
    people:db.collection(prefix+"people"),
    memberships:db.collection(prefix+"memberships"),
    enrollments:db.collection(prefix+"enrollments"),
    assignments:db.collection(prefix+"staff_assignments"),
    assessments:db.collection(prefix+"assessments"),
    studio:db.collection(prefix+"studio_submissions"),
    github:db.collection(prefix+"github_evidence"),
    grades:db.collection(prefix+"student_grades"),
    support:db.collection(prefix+"support_reports")
  };
  const [
    peopleTotal,peopleActive,membershipsActive,enrollmentsActive,assignmentsActive,
    assessmentsDeployed,studioSubmitted,studioReopened,studioReviewed,
    githubSubmitted,githubApproved,githubReopened,githubReviewed,
    gradesDraft,gradesPublished,supportTotal,supportResolved,supportClosed,
    supportCritical
  ]=await Promise.all([
    count(names.people),count(names.people,"status","active"),
    count(names.memberships,"status","active"),
    count(names.enrollments,"status","active"),count(names.assignments,"status","active"),
    count(names.assessments,"status","deployed"),
    count(names.studio,"status","submitted"),count(names.studio,"status","reopened"),
    count(names.studio,"status","reviewed"),
    count(names.github,"status","submitted"),count(names.github,"status","approved"),
    count(names.github,"status","reopened"),count(names.github,"status","reviewed"),
    count(names.grades,"status","draft"),count(names.grades,"status","published"),
    count(names.support),count(names.support,"status","Resolved"),count(names.support,"status","Closed"),
    count(names.support,"priority","Critical")
  ]);
  // Counts contain no names, emails, UIDs, repository URLs, code, scores,
  // comments or activity trails. The page is operational, not student analytics.
  return {
    schoolId:ctx.schoolId,generatedAt:Date.now(),
    directory:{peopleTotal,peopleActive,membershipsActive},
    academics:{activeEnrollments:enrollmentsActive,activeTeachingAssignments:assignmentsActive,
      deployedAssessments:assessmentsDeployed},
    review:{
      studio:{submitted:studioSubmitted,reopened:studioReopened,reviewed:studioReviewed},
      github:{submitted:githubSubmitted,approved:githubApproved,reopened:githubReopened,reviewed:githubReviewed}
    },
    grades:{draft:gradesDraft,published:gradesPublished},
    support:{total:supportTotal,open:Math.max(0,supportTotal-supportResolved-supportClosed),
      critical:supportCritical,resolved:supportResolved,closed:supportClosed}
  };
 };
}
module.exports={createSchoolAnalyticsService};
