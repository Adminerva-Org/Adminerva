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
const location=(doc,index,length=1)=>{
  const before=doc.code.slice(0,index),last=before.lastIndexOf("\n");
  return {file:doc.path,line:before.split("\n").length,column:index-last,length:Math.max(1,Math.min(80,length))};
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
function scan(docs,re){const found=[];for(const doc of docs)for(const hit of doc.code.matchAll(re))found.push(location(doc,hit.index,hit[0].length));return found;}
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
      out.push({doc,kind:m[1],name:m[2],header:m[3],open,end,start:m.index,extendsName,at:location(doc,m.index,m[0].length)});
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
/**
 * Method declarations at the direct body level of each type. A method call or a
 * return statement inside a method must never count as a declaration.
 */
function declaredMethods(types){
  const found=[];
  const re=/\b(?:(?:public|protected|private|static|final|abstract|default|native|synchronized)\s+)*(?:void|boolean|byte|short|int|long|float|double|char|[A-Za-z_$][\w.$]*(?:\s*<[^{}();]+>)?(?:\[\])?)\s+([A-Za-z_$][\w$]*)\s*\(([^(){};]*)\)\s*(?:throws\s+[\w.$,\s]+)?\s*(?:\{|;)/g;
  for(const type of types.filter(row=>row.kind==="class"||row.kind==="interface")){
    const body=type.doc.code.slice(type.open+1,type.end);
    for(const match of body.matchAll(re)){
      let depth=0;
      for(let i=0;i<match.index;i++){
        if(body[i]==="{")depth++;
        else if(body[i]==="}")depth--;
      }
      if(depth!==0||match[1]===type.name||/^(?:return|new|throw|else|case|yield)\s/.test(match[0]))continue;
      const before=body.slice(0,match.index);
      const boundary=Math.max(before.lastIndexOf("{"),before.lastIndexOf("}"),before.lastIndexOf(";"));
      const annotations=before.slice(boundary+1);
      found.push({
        type,name:match[1],sig:signature(match[2]),
        at:location(type.doc,type.open+1+match.index,match[0].length),
        annotated:/@Override\b/.test(annotations),
        private:/\bprivate\b/.test(match[0].split("(")[0]),
        static:/\bstatic\b/.test(match[0].split("(")[0]),
        final:/\bfinal\b/.test(match[0].split("(")[0])
      });
    }
  }
  return found;
}
function overloadLocations(methods){
  const groups=new Map();
  for(const item of methods.filter(method=>method.type.kind==="class")){
    const key=item.type.doc.path+":"+item.type.start+":"+item.name;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(item);
  }
  const locations=[];
  for(const list of groups.values())if(new Set(list.map(item=>item.sig)).size>1)
    locations.push(...list.map(item=>({...item.at,note:"Overload: "+item.name+"("+item.sig+")"})));
  return locations;
}
function uniqueLocalType(types,name,kind){
  const matches=types.filter(type=>type.name===name&&type.kind===kind);
  return matches.length===1?matches[0]:null;
}
function implementedNames(type){
  const clause=/\bimplements\s+([^{}]+)/.exec(type.header)?.[1]||"";
  return clause.split(",").map(name=>/^\s*([A-Za-z_$][\w$]*)/.exec(name)?.[1]).filter(Boolean);
}
function directAncestors(type,types){
  const targets=[];
  const parent=uniqueLocalType(types,type.extendsName,"class");
  if(parent)targets.push(parent);
  for(const name of implementedNames(type)){
    const iface=uniqueLocalType(types,name,"interface");
    if(iface)targets.push(iface);
  }
  return targets;
}
function overridingEvidence(methods,types){
  const locations=[];let linked=false;
  for(const item of methods.filter(method=>method.type.kind==="class")){
    const parents=directAncestors(item.type,types);
    const related=[];
    for(const ancestor of parents){
      const match=methods.find(other=>other.type===ancestor&&other.name===item.name&&
        other.sig===item.sig&&!other.private&&!other.static&&!other.final);
      if(match)related.push({...match.at,note:ancestor.kind==="interface"?
        "Interface method: "+ancestor.name+"."+match.name:"Parent method: "+ancestor.name+"."+match.name});
    }
    if(!item.annotated&&!related.length)continue;
    if(item.static||item.private)continue;
    if(related.length)linked=true;
    locations.push({...item.at,
      note:related.length?"Matching inherited method: "+item.type.name+"."+item.name:
        "@Override annotation: "+item.type.name+"."+item.name,
      related});
  }
  return {locations,linked};
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
  const docs=javaDocs(project?.state),types=declarations(docs),classes=types.filter(x=>x.kind==="class"),methods=declaredMethods(types),checks=[];
  const add=(group,id,label,locations,explanation,kind="source",met=null,strength="pattern")=>{
    const detected=met===null?locations.length>0:Boolean(met);
    checks.push({group,id,label,detected,locations:locations.slice(0,12),
      matchCount:locations.length,explanation,kind,strength,
      feedback:REVIEW_GUIDANCE[id]?.[detected?0:1]||"Review the original source and test the relevant behavior."});
  };
  const at=list=>list.map(x=>x.at);
  const fields=scan(docs,/\bprivate\s+(?:(?:final|static|volatile|transient)\s+)*[\w.$<>\[\],?]+\s+[A-Za-z_$][\w$]*\s*(?:=|;)/g);
  const accessors=scan(docs,/\b(?:public|protected)\s+[\w.$<>\[\],?]+\s+(?:get|set|is)[A-Z]\w*\s*\(/g);
  const inherited=classes.filter(x=>x.extendsName);
  const hierarchyLocations=inherited.map(child=>{
    const parent=uniqueLocalType(types,child.extendsName,"class");
    return {...child.at,note:child.name+" extends "+child.extendsName,
      related:parent?[{...parent.at,note:"Parent declaration: "+parent.name}]:[]};
  });
  const linkedInheritance=hierarchyLocations.some(loc=>loc.related.length>0);
  const overrides=overridingEvidence(methods,types);
  const abstractTypes=classes.filter(x=>/\babstract\s*$/.test(x.doc.code.slice(Math.max(0,x.start-35),x.start)));
  const iface=types.filter(x=>x.kind==="interface"||x.kind==="class"&&/\bimplements\s+[A-Za-z_$]/.test(x.header));
  add("Object-oriented programming","classes","Classes",at(classes),"Class declarations found; compilation and usage are not verified.");
  add("Object-oriented programming","encapsulation","Encapsulation candidates",fields,
    accessors.length?"Private fields and accessor patterns appear. Validation and controlled access require review.":"Private fields found; appropriate accessors and validation still require review.");
  add("Object-oriented programming","inheritance","Inheritance (extends)",hierarchyLocations,
    linkedInheritance?"A subclass declaration links to a parent class defined in this project. The hierarchy and inherited behavior still need to be compiled and exercised.":"An extends clause was found, but the parent class declaration was not linked in this project. Confirm the parent exists and is meaningful.",
    "source",null,linkedInheritance?"linked":"pattern");
  add("Object-oriented programming","abstraction","Abstract classes",at(abstractTypes),
    "An abstract class is declared. Its use and concrete implementations are not verified.");
  add("Object-oriented programming","interfaces","Interfaces / implements",at(iface),
    "An interface is declared or implemented. Contract completeness is not verified.");
  add("Object-oriented programming","overriding","Polymorphism: overriding",overrides.locations,
    overrides.linked?"Subclass methods match locally declared parent or interface signatures; related declarations are shown. Actual override semantics and method calls remain unverified.":"An @Override-annotated method appears, but no matching parent/interface declaration was linked in this project. The compiler must confirm that it actually overrides.",
    "source",null,overrides.linked?"linked":"pattern");
  add("Object-oriented programming","overloading","Polymorphism: overloading",overloadLocations(methods),
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
