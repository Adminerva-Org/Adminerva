/** Assessment authoring, repository evidence, individual review and protected grading: assessment dates. */
// Keep historical classroom issue dates when configuring a new digital deployment.
export function validateDeploymentDates({postDate,deadline,deadlineEnabled}={}){
  if(!deadlineEnabled)return null;
  if(!postDate || !deadline)return "Choose both the original post date and the deadline.";
  const posted=new Date(postDate), due=new Date(deadline);
  if(!Number.isFinite(posted.getTime())||!Number.isFinite(due.getTime()))
    return "Choose valid deployment dates.";
  if(posted.getTime()>due.getTime())
    return "The post date must be on or before the deadline.";
  return null;
}

/**
 * Apply a deadline extension or late-submission policy to a previously
 * deployed legacy assessment without changing the original section, issue
 * time or any additional immutable deployment metadata.
 */
export function rescheduleLegacyDeployment(previous,{deadlineEnabled,allowLateSubmissions,deadline}={}){
  if(!previous||typeof previous.id!=="string"||!previous.id||
     typeof previous.section!=="string"||!previous.section)
    throw Error("The original class deployment was not found.");
  const enforcing=deadlineEnabled===true;
  const next={
    ...previous,
    deadlineEnabled:enforcing,
    allowLateSubmissions:enforcing&&allowLateSubmissions===true,
    deadline:enforcing?deadline:previous.deadline||null
  };
  const problem=validateDeploymentDates({postDate:previous.postDate,deadline:next.deadline,deadlineEnabled:enforcing});
  if(problem)throw Error(problem);
  return next;
}
