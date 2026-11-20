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
const javaDocs=state=>Object.entries(state?.files||{}).filter(([path,content])=>/\.java$/i.test(path)&&typeof content==="string").map(([path,content])=>({path,code:maskJava(content)}));
const location=(doc,index)=>({file:doc.path,line:doc.code.slice(0,index).split("\n").length});
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
export function analyzeProjectEvidence(project){
  const docs=javaDocs(project?.state),types=declarations(docs),classes=types.filter(x=>x.kind==="class"),checks=[];
  const add=(group,id,label,locations,explanation,kind="source")=>checks.push({
    group,id,label,detected:locations.length>0,locations:locations.slice(0,3),explanation,kind
  });
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
  const operations=new Set((project?.database?.history||[]).map(x=>String(x?.type||"").toUpperCase()));
  const completed=["INSERT","SELECT","UPDATE","DELETE"].filter(x=>operations.has(x));
  add("Project activities","crud","Adminerva DB CRUD history",
    completed.length===4?[{label:"INSERT, SELECT, UPDATE, DELETE"}]:[],
    "Recorded Adminerva DB operations: "+(completed.join(", ")||"none")+". Separate from Java/JDBC source.",
    "activity");
  const diagrams=Object.entries(project?.design||{}).filter(([key,value])=>String(value||"").trim());
  add("Project activities","design","Saved design artifacts",diagrams.map(([name])=>({label:name})),
    "Nonempty saved design entries: "+diagrams.length+". Diagram quality is not reviewed.","artifact");
  return {javaFiles:docs.length,checks};
}
