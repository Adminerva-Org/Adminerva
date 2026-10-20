/** Academic chart inclusion never turns missing scores or private drafts into published mastery. */
export function academicGradeEligible(grade,assessment,includeDrafts=false) {
  const maximum=grade.maxScore??assessment?.maxScore??20;
  return (grade.published===true||includeDrafts) && typeof grade.score==="number" && Number.isFinite(grade.score) &&
    typeof maximum==="number" && Number.isFinite(maximum) && maximum>0 && grade.score>=0 && grade.score<=maximum;
}
export function queryGroups(values) {
  const unique=[...new Set(values.filter(value=>typeof value==="string"&&value.trim()))],groups=[];
  for(let offset=0;offset<unique.length;offset+=10)groups.push(unique.slice(offset,offset+10));
  return groups;
}
