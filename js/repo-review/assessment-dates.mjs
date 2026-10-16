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
