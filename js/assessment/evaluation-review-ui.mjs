function make(tag,className,text){
  const el=document.createElement(tag);
  if(className)el.className=className;
  if(text!==undefined)el.textContent=String(text);
  return el;
}

export function evaluationTotals(suggestion={},task={}){
  const criteria=Array.isArray(suggestion.criteria)?suggestion.criteria:[];
  return criteria.reduce((out,row)=>{
    out.awarded+=Number(row?.awardedPoints||0);
    out.pending+=Number(row?.pendingPoints||0);
    return out;
  },{awarded:0,pending:0,total:Number(task?.rubricMax||task?.rubric?.reduce?.((sum,row)=>sum+Number(row?.points||0),0)||0)});
}

export function clearEvaluationReview(container,message="No evaluation has been run yet."){
  if(!container)return;
  container.replaceChildren();
  container.append(make("p","text-xs text-slate-500",message));
}

export function renderEvaluationReview(container,{
  title="AI review",
  sourceLabel="Evaluation",
  suggestion={},
  task={},
  onApply=null,
  applyLabel="Apply to teacher draft"
}={}){
  if(!container)return;
  container.replaceChildren();
  const totals=evaluationTotals(suggestion,task);
  const card=make("section","rounded-xl border border-slate-200 bg-white p-3 shadow-sm");
  const head=make("div","flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2");
  const heading=make("div");
  heading.append(
    make("p","text-[11px] uppercase tracking-wider font-extrabold text-slate-500",sourceLabel),
    make("h4","font-extrabold text-slate-900 mt-0.5",title)
  );
  const score=make("div","text-sm font-extrabold text-indigo-700",
    totals.awarded+" / "+totals.total+(totals.pending?" · "+totals.pending+" pending":""));
  head.append(heading,score);card.append(head);

  const list=make("div","grid gap-2 mt-3");
  (suggestion.criteria||[]).forEach((row,index)=>{
    const maximum=Number(task?.rubric?.[index]?.points||0);
    const name=task?.rubric?.[index]?.name||("Criterion "+(index+1));
    const item=make("div","rounded-lg border border-slate-200 bg-slate-50 p-2.5");
    item.append(make("div","text-xs font-bold text-slate-900",
      name+" · "+Number(row?.awardedPoints||0)+" / "+maximum+
      (Number(row?.pendingPoints||0)?" · "+Number(row.pendingPoints)+" pending":"")));
    if(row?.comment)item.append(make("p","text-xs text-slate-700 mt-1 whitespace-pre-wrap",row.comment));
    list.append(item);
  });
  card.append(list);
  if(suggestion.feedback)card.append(make("p","text-sm text-slate-800 mt-3 whitespace-pre-wrap",suggestion.feedback));
  if(suggestion.limitations)card.append(make("p","text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mt-3 whitespace-pre-wrap",
    "Limitations: "+suggestion.limitations));
  if(typeof onApply==="function"){
    const button=make("button","mt-3 rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-900 font-bold px-3 py-2",applyLabel);
    button.type="button";
    button.addEventListener("click",()=>onApply(suggestion));
    card.append(button);
  }
  container.append(card);
}
