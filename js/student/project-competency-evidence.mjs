/** Heuristic Java source evidence. Not a compiler, validator or grading engine. */
export function maskJava(source){
  const s=String(source??"");let out="",mode="code",i=0;
  const space=c=>c==="\n"?"\n":" ";
  while(i<s.length){
    const c=s[i],n=s[i+1];
    if(mode==="code"){
      if(c==="/"&&n==="/"){out+="  ";i+=2;mode="line";continue;}
      if(c==="/"&&n==="*"){out+="  ";i+=2;mode="block";continue;}
      if(s.slice(i,i+3)==='"""'){out+="   ";i+=3;mode="text";continue;}
      if(c==='"'||c==="'"){out+=" ";i++;mode=c==='"'?"string":"char";continue;}
      out+=c;i++;continue;
    }
    if(mode==="line"){out+=space(c);i++;if(c==="\n")mode="code";continue;}
    if(mode==="block"){
      if(c==="*"&&n==="/"){out+="  ";i+=2;mode="code";continue;}
      out+=space(c);i++;continue;
    }
    if(mode==="text"&&s.slice(i,i+3)==='"""'){out+="   ";i+=3;mode="code";continue;}
    if((mode==="string"||mode==="char")&&c==="\\"){
      out+=space(c);i++;if(i<s.length){out+=space(s[i]);i++;}continue;
    }
    if(mode==="string"&&c==='"'||mode==="char"&&c==="'")mode="code";
    out+=space(c);i++;
  }
  return out;
}
const javaDocs=state=>Object.entries(state?.files||{}).filter(([path,content])=>/\.java$/i.test(path)&&typeof content==="string").map(([path,content])=>({path,source:content,code:maskJava(content)}));
const location=(doc,index)=>{
  const before=doc.code.slice(0,index),last=before.lastIndexOf("\n");
  return {file:doc.path,line:before.split("\n").length,column:index-last};
};
/** A bounded excerpt from the student's current working source, never a stored grade or server proof. */
export function evidenceSnippet(state,loc,{context=1,maxChars=240}={}){
  const source=state?.files?.[loc?.file];
  if(typeof source!=="string"||!Number.isInteger(loc?.line)||loc.line<1)return [];
  const lines=source.split(/\r?\n/),at=loc.line-1;
  if(at>=lines.length)return [];
  const around=Math.max(0,Math.min(2,Math.trunc(context)||0)),limit=Math.max(80,Math.min(480,Math.trunc(maxChars)||240));
  const result=[];
  for(let i=Math.max(0,at-around);i<=Math.min(lines.length-1,at+around);i++){
    const raw=lines[i],offset=i===at?Math.max(0,Math.min(raw.length,(loc.column||1)-1)):0;
    const start=raw.length>limit?Math.max(0,Math.min(raw.length-limit,offset-55)):0;
    const end=Math.min(raw.length,start+limit);
    result.push({line:i+1,focus:i===at,code:(start?"…":"")+raw.slice(start,end)+(end<raw.length?"…":"")});
  }
  return result;
}
function scan(docs,re){const found=[];for(const doc of docs)for(const hit of doc.code.matchAll(re))found.push(location(doc,hit.index));return found;}
function declarations(docs){
  const out=[];
  for(const doc of docs){
    const re=/\b(class|interface|enum)\s+([A-Za-z_$][\w$]*)\b([^{};]{0,260})\{/g;
    for(const m of doc.code.matchAll(re)){
      const open=m.index+m[0].lastIndexOf("{");let depth=0,end=doc.code.length;
      for(let k=open;k<doc.code.length;k++){
        if(doc.code[k]==="{")depth++;
        if(doc.code[k]==="}"&&--depth===0){end=k;break;}
      }
      const extendsName=/\bextends\s+([A-Za-z_$][\w$]*)/.exec(m[3])?.[1]||"";
      out.push({doc,kind:m[1],name:m[2],header:m[3],open,end,start:m.index,extendsName,at:location(doc,m.index)});
    }
  }
  return out;
}
function signature(params){
  if(!params.trim())return "";
  let level=0,word="",parts=[];
  for(const ch of params){
    if(ch==="<")level++;if(ch===">")level=Math.max(0,level-1);
    if(ch===","&&level===0){parts.push(word);word="";}else word+=ch;
  }
  parts.push(word);
  return parts.map(part=>part.trim().replace(/@\w+(?:\([^)]*\))?\s*/g,"").replace(/\bfinal\s+/g,"")
    .replace(/\s+[A-Za-z_$][\w$]*(?:\[\])?$/,"").replace(/\s+/g,"")).join(",");
}
function overloadLocations(types){
  const groups=new Map();
  const method=/\b(?:(?:public|protected|private|static|final|abstract|default|native|synchronized)\s+)*(?:void|boolean|byte|short|int|long|float|double|char|[A-Za-z_$][\w.$]*(?:\s*<[^{}();]+>)?(?:\[\])?)\s+([A-Za-z_$][\w$]*)\s*\(([^(){};]*)\)\s*(?:throws\s+[\w.$,\s]+)?\s*(?:\{|;)/g;
  for(const type of types.filter(x=>x.kind==="class")){
    const body=type.doc.code.slice(type.open+1,type.end);
    for(const match of body.matchAll(method)){
      const at=type.open+1+match.index,name=match[1];
      if(name===type.name||["if","while","for","switch","catch"].includes(name))continue;
      const owner=types.filter(x=>x.doc===type.doc&&x.kind==="class"&&x.open<at&&at<x.end)
        .sort((a,b)=>(a.end-a.open)-(b.end-b.open))[0];
      if(owner!==type)continue;
      const key=type.doc.path+":"+type.start+":"+name;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push({sig:signature(match[2]),at:location(type.doc,at)});
    }
  }
  const locations=[];
  for(const list of groups.values())if(new Set(list.map(x=>x.sig)).size>1)locations.push(...list.map(x=>x.at));
  return locations;
}
const REVIEW_GUIDANCE={
  classes:["Locate the class definition and explain where it is instantiated and used.","Try declaring a Java class for an object in your program."],
  encapsulation:["Check that private fields have appropriate controlled access and validation.","Review field visibility; private fields alone do not establish effective encapsulation."],
  inheritance:["Verify the parent/subclass relationship makes sense and inherited behavior is exercised.","Check whether any class extends a meaningful parent class."],
  abstraction:["Confirm abstract methods or behavior are used through concrete subclasses.","For an abstraction requirement, review whether an abstract parent class is appropriate."],
  interfaces:["Check that implementing classes fulfill and use the interface contract.","Look for an interface declaration and a class implementing it when required."],
  overriding:["Confirm the method actually overrides an inherited/interface method and is called.","Look for subclass methods that override a parent method; @Override makes the intent explicit."],
  overloading:["Find calls that exercise each different parameter signature.","Check whether one class declares multiple meaningful methods with the same name but different parameter lists."],
  references:["Check that the parent-typed variable calls a method overridden by the subclass.","Try referencing a subclass through its parent/interface type and exercising overridden behavior."],
  collections:["Verify collection elements are added, retrieved or processed correctly.","If the task needs a collection, consider List, Set, Map or another suitable API."],
  generics:["Check the element or key/value types and type-safe operations.","Review whether typed collections or other generic declarations would help the task."],
  exceptions:["Run a safe failure case and verify a useful error path.","Review expected failures and decide where try/catch, validation or throws is appropriate."],
  jdbc:["Check that JDBC connections, SQL statements and resources work correctly.","If required, connect Java to a database through JDBC; the built-in Adminerva DB lab is separate."],
  fileio:["Try a read/write scenario and check resource handling.","Review whether your task needs persistent file reading or writing."],
  threads:["Verify ordering and shared-state safety; keywords alone do not prove concurrency.","If required, implement and test concurrent behavior rather than adding unused threading APIs."],
  crud:["Review each recorded INSERT, SELECT, UPDATE and DELETE operation in Adminerva DB.","Use the Adminerva DB lab to perform and inspect any missing CRUD operations."],
  design:["Compare saved diagrams with the actual class relationships and runtime behavior.","Save a relevant design diagram, then check that it matches your implemented project."]
};
export function analyzeProjectEvidence(project){
  const docs=javaDocs(project?.state),types=declarations(docs),classes=types.filter(x=>x.kind==="class"),checks=[];
  const add=(group,id,label,locations,explanation,kind="source",met=null)=>{
    const detected=met===null?locations.length>0:Boolean(met);
    checks.push({group,id,label,detected,locations:locations.slice(0,12),
      matchCount:locations.length,explanation,kind,
      feedback:REVIEW_GUIDANCE[id]?.[detected?0:1]||"Review the original source and test the relevant behavior."});
  };
  const at=list=>list.map(x=>x.at);
  const fields=scan(docs,/\bprivate\s+(?:(?:final|static|volatile|transient)\s+)*[\w.$<>\[\],?]+\s+[A-Za-z_$][\w$]*\s*(?:=|;)/g);
  const accessors=scan(docs,/\b(?:public|protected)\s+[\w.$<>\[\],?]+\s+(?:get|set|is)[A-Z]\w*\s*\(/g);
  const inherited=classes.filter(x=>x.extendsName);
  const abstractTypes=classes.filter(x=>/\babstract\s*$/.test(x.doc.code.slice(Math.max(0,x.start-35),x.start)));
  const iface=types.filter(x=>x.kind==="interface"||x.kind==="class"&&/\bimplements\s+[A-Za-z_$]/.test(x.header));
  add("Object-oriented programming","classes","Classes",at(classes),"Class declarations found; compilation and usage are not verified.");
  add("Object-oriented programming","encapsulation","Encapsulation candidates",fields,
    accessors.length?"Private fields and accessor patterns appear. Validation and controlled access require review.":"Private fields found; appropriate accessors and validation still require review.");
  add("Object-oriented programming","inheritance","Inheritance (extends)",at(inherited),
    "A class extends another type. Hierarchy correctness and inherited behavior are not verified.");
  add("Object-oriented programming","abstraction","Abstract classes",at(abstractTypes),
    "An abstract class is declared. Its use and concrete implementations are not verified.");
  add("Object-oriented programming","interfaces","Interfaces / implements",at(iface),
    "An interface is declared or implemented. Contract completeness is not verified.");
  add("Object-oriented programming","overriding","Polymorphism: overriding",scan(docs,
    /@Override\s+(?:(?:public|protected|private|final|synchronized)\s+)*[\w.$<>\[\],?]+\s+[A-Za-z_$][\w$]*\s*\(/g),
    "An annotated overriding method appears. Compilation and runtime dispatch are not verified.");
  add("Object-oriented programming","overloading","Polymorphism: overloading",overloadLocations(types),
    "A class declares same-named methods with different parameter types. Calls to both are not verified.");
  const referenceHits=[];
  for(const child of inherited){
    if(!classes.some(x=>x.name===child.extendsName))continue;
    const parent=child.extendsName.replaceAll("$","\\$"),name=child.name.replaceAll("$","\\$");
    referenceHits.push(...scan(docs,new RegExp("\\b"+parent+"\\s+[A-Za-z_$][\\w$]*\\s*=\\s*new\\s+"+name+"\\s*\\(","g")));
  }
  add("Object-oriented programming","references","Polymorphic reference candidates",referenceHits,
    "A parent-typed variable is assigned a subclass instance. Virtual method calls are not verified.");
  add("Java concepts","collections","Collections",scan(docs,/\b(?:ArrayList|LinkedList|List|Map|Set|HashMap|HashSet|Collection|Queue)\b/g),
    "Collection API references are present; correct data handling is not verified.");
  add("Java concepts","generics","Generic types",scan(docs,
    /\b(?:List|Map|Set|Collection|ArrayList|HashMap|HashSet|Queue)\s*<[^>\n]+>|\bclass\s+\w+\s*<\s*[A-Z]\w*\s*>/g),
    "Generic type syntax appears; type correctness is not verified.");
  add("Java concepts","exceptions","Exception handling",scan(docs,/\btry\s*\{|\bcatch\s*\(|\bthrows\s+[\w.$]+/g),
    "Exception-handling syntax appears; failure behavior is not verified.");
  add("Java concepts","jdbc","JDBC references",scan(docs,
    /\b(?:java\.sql|DriverManager|PreparedStatement|ResultSet|Connection)\b/g),
    "JDBC API references appear. The connection and SQL operation have not been verified.");
  add("Java concepts","fileio","File I/O",scan(docs,
    /\b(?:java\.io|java\.nio\.file|Files\s*\.|Path\s*\.|FileInputStream|FileOutputStream|BufferedReader|BufferedWriter)\b/g),
    "Java file APIs appear; actual read/write behavior is unverified.");
  add("Java concepts","threads","Concurrency",scan(docs,
    /\b(?:Thread|Runnable|ExecutorService|CompletableFuture|synchronized)\b/g),
    "Concurrency APIs appear; correct multithreading is unverified.");
  const history=Array.isArray(project?.database?.history)?project.database.history:[];
  const latestActions=["INSERT","SELECT","UPDATE","DELETE"].map(type=>{
    const row=history.find(item=>String(item?.type||"").toUpperCase()===type);
    return row?{label:type,sql:String(row.sql||"").slice(0,260),at:String(row.at||"").slice(0,40)}:null;
  }).filter(Boolean);
  const completed=latestActions.map(item=>item.label);
  add("Project activities","crud","Adminerva DB CRUD history",latestActions,
    "Recorded operations: "+(completed.join(", ")||"none")+". All four actions are required for the indicator. This is separate from JDBC and Java source.",
    "activity",completed.length===4);
  const diagrams=Object.entries(project?.design||{}).filter(([key,value])=>String(value||"").trim());
  add("Project activities","design","Saved design artifacts",diagrams.map(([name,value])=>({
    label:name,preview:String(value).slice(0,360)
  })),"Nonempty saved design entries: "+diagrams.length+". Diagram quality is not reviewed.","artifact");
  return {javaFiles:docs.length,checks};
}
