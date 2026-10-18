const escape=value=>String(value||"").replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
export function lessonStarterDeck(plan,sessionIndex){
  const session=plan?.sessions?.[sessionIndex];
  if(!session)throw Error("Choose a saved lesson session first.");
  const title=[plan.subject_title,plan.weekly_overview?.topic,session.session_name].filter(Boolean).join(" · ");
  const slides=[{layout:"standard",type:"title",label:"Lesson title",content:"<h1>"+escape(title)+"</h1>",hidden:false}];
  for(const [field,label] of [["objectives","Learning objectives"],["competencies","Competencies"],["learning_activities","Learning activities"],["evaluation","Check for understanding"]]){
    const content=typeof session[field]==="string"?session[field].trim():"";
    if(!content)continue;
    if(content.length>10800)throw Error("This lesson section exceeds the starter-slide limit. Shorten or split the lesson before importing.");
    const chunks=Array.from({length:Math.ceil(content.length/900)},(_value,index)=>content.slice(index*900,(index+1)*900));
    for(const [index,chunk] of chunks.slice(0,12).entries())slides.push({layout:"standard",type:"lesson",label:label+(chunks.length>1?" "+(index+1):""),content:"<h2>"+label+"</h2><p>"+escape(chunk).replace(/\n/g,"<br>")+"</p>",hidden:false});
  }
  return {deck:slides,source:{planId:String(plan.id||""),lessonVersion:Number(plan.version||1),sessionIndex:Number(sessionIndex)}};
}
export function lessonSourceChanged(saved,plan){
  return saved?.source_lesson_version?Number(saved.source_lesson_version)!==Number(plan?.version||1):Boolean(saved?.deck);
}
