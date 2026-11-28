// Small pure helpers shared by the canonical review queue and its regression tests.
export function queueMatches(item,query,mode){
  const needle=String(query||"").trim().toLocaleLowerCase();
  return (!needle||item.search.includes(needle))&&
    (mode==="all"||mode===item.gradeStatus||(mode==="attention"&&item.attention));
}
export function nextUngradedRow(reviewRows,queueRows,studentUid){
  const index=reviewRows.findIndex(row=>row.studentUid===studentUid);
  const statuses=new Map(queueRows.map(item=>[item.row.studentUid,item.gradeStatus]));
  const after=reviewRows.slice(index+1),before=reviewRows.slice(0,Math.max(0,index));
  return [...after,...before].find(row=>statuses.get(row.studentUid)==="ungraded");
}
export function gradeFormFingerprint(values){
  return JSON.stringify(Array.from(values,value=>String(value??"")));
}
