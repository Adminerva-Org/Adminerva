/**
 * Create a bounded, multi-source excerpt for lesson planning.
 * Stored library records are NEVER edited or truncated here.
 * Accepts old embedded documents and newer extracted-content shapes.
 */
export const REFERENCE_CONTEXT_BUDGET = 25000;
const STOP_WORDS=new Set("the and for with this that from week grade term second first semester quarter lesson plans plan learning these each into your their have when about using based should make include student students teacher teachers where what will".split(" "));
const textValue = value => {
  if(typeof value==="string")return value;
  if(Array.isArray(value))return value.map(textValue).filter(Boolean).join("\n");
  if(value && typeof value==="object"){
    // Page/section records in older and differently formatted resources.
    const preferred=["text","content","body","extractedText","raw_text","paragraphs","pages","sections"];
    const result=preferred.map(k=>value[k]).filter(v=>v!==undefined&&v!==null).map(textValue).filter(Boolean);
    if(result.length)return result.join("\n");
    return Object.entries(value)
      .filter(([k])=>!["id","url","filename","title","date","createdAt","updatedAt"].includes(k))
      .map(([key,val])=>key+": "+textValue(val)).filter(Boolean).join("\n");
  }
  return "";
};
export function extractReferenceText(record){
  if(!record||typeof record!=="object")return textValue(record).trim();
  for(const key of ["text","extractedText","content","raw_text","body","pages","sections"]){
    if(record[key]!==undefined&&record[key]!==null){
      const value=textValue(record[key]).trim();
      if(value)return value;
    }
  }
  return "";
}
const keywords=text=>[...new Set((String(text||"").toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g)||[])
  .filter(word=>!STOP_WORDS.has(word)&&word.length>2))].slice(0,80);
function sections(text,limit=1050){
  const out=[];
  const paragraphs=text.replace(/\r\n?/g,"\n").split(/\n\s*\n/).filter(Boolean);
  for(const paragraph of paragraphs){
    let rest=paragraph.trim();
    while(rest.length>limit){
      let boundary=rest.lastIndexOf(" ",limit);
      if(boundary<limit/2)boundary=limit;
      out.push(rest.slice(0,boundary).trim());
      rest=rest.slice(boundary).trimStart();
    }
    if(rest)out.push(rest);
  }
  // Join short neighboring paragraphs without exceeding the per-section cap.
  const chunks=[];
  for(const p of out){
    if(chunks.length && chunks[chunks.length-1].length+p.length+2<=limit)
      chunks[chunks.length-1]+="\n\n"+p;
    else chunks.push(p);
  }
  return chunks;
}
function relevance(chunk,terms,index){
  const hay=chunk.toLowerCase();
  let score=0;
  for(const word of terms){
    if(hay.includes(word))score+=1+Math.min(hay.split(word).length-2,3)*0.2;
  }
  if(/\b(content standard|performance standard|competenc|learning outcome|objectives|activities|assessment)\b/i.test(chunk))score+=0.3;
  return score-index*0.003;
}
export function buildReferenceContext(records,{scope="",instructions="",budget=REFERENCE_CONTEXT_BUDGET}={}){
  const max=Math.max(0,Math.floor(Number(budget)||0));
  const terms=keywords(scope+" "+instructions);
  const docs=(Array.isArray(records)?records:[]).map((record,index)=>{
    const text=extractReferenceText(record);
    const title=String(record?.title||record?.name||record?.filename||"Untitled reference").replace(/[\r\n]/g," ").slice(0,150);
    const parts=sections(text).map((value,part)=>({value,part,score:relevance(value,terms,part)}));
    return {index,title,textLength:text.length,parts};
  });
  const readable=docs.filter(d=>d.parts.length);
  const all=readable.flatMap(d=>d.parts.map(chunk=>({...chunk,document:d.index,title:d.title})));
  const selected=[],chosen=new Set();
  let used=0;
  const add=chunk=>{
    const id=chunk.document+":"+chunk.part;
    if(chosen.has(id))return false;
    const header="\n\n--- REFERENCE: "+chunk.title+" (section "+(chunk.part+1)+") ---\n";
    const cost=header.length+chunk.value.length;
    if(used+cost>max)return false;
    selected.push({...chunk,header});chosen.add(id);used+=cost;
    return true;
  };
  // First pass: strongest section from as many different resources as fit.
  const lead=readable.map(d=>all.filter(c=>c.document===d.index)
    .sort((a,b)=>b.score-a.score||a.part-b.part)[0])
    .sort((a,b)=>b.score-a.score||a.document-b.document);
  for(const chunk of lead)if(chunk)add(chunk);
  // Second pass: score remaining sections, with a modest diversity bonus
  // to avoid one very long legacy resource eclipsing smaller references.
  const chunks=all.filter(c=>!chosen.has(c.document+":"+c.part))
    .sort((a,b)=>b.score-a.score||a.document-b.document||a.part-b.part);
  const countByDoc=new Map(selected.map(c=>[c.document,1]));
  while(chunks.length && used<max){
    let index=0,best=-Infinity;
    for(let i=0;i<chunks.length;i++){
      const c=chunks[i],weight=c.score-0.15*(countByDoc.get(c.document)||0);
      if(weight>best){best=weight;index=i}
    }
    const next=chunks.splice(index,1)[0];
    if(add(next))countByDoc.set(next.document,(countByDoc.get(next.document)||0)+1);
  }
  // Present chosen sections in source order for readable prompt context.
  selected.sort((a,b)=>a.document-b.document||a.part-b.part);
  const context=selected.map(c=>c.header+c.value).join("");
  const usedDocs=new Set(selected.map(c=>c.document));
  const fullCount=readable.filter(d=>d.parts.every(p=>chosen.has(d.index+":"+p.part))).length;
  return {
    text:context,
    totalCharacters:docs.reduce((sum,d)=>sum+d.textLength,0),
    includedCharacters:selected.reduce((sum,c)=>sum+c.value.length,0),
    documentCount:docs.length,
    readableDocuments:readable.length,
    includedDocuments:usedDocs.size,
    fullyIncludedDocuments:fullCount,
    partial:chosen.size<all.length,
    missingTextDocuments:docs.filter(d=>!d.textLength).map(d=>d.title),
    omittedDocumentTitles:docs.filter(d=>d.textLength&&!usedDocs.has(d.index)).map(d=>d.title),
    selectedSectionCount:selected.length,
    budget:max
  };
}
