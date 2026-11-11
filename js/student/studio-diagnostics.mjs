/**
 * Lightweight Java structure/syntax hints for Adminerva Studio.
 * Uses an open-source Lezer Java parser (MIT). No compiler, type resolver,
 * dependency checker, or guarantee that code will compile.
 */
const OWNER='adminerva-java-structure';
const PARSER_URL='https://esm.sh/@lezer/java@1.1.5?bundle';
let parserPromise;
function loadParser(){
  if(!parserPromise)parserPromise=import(PARSER_URL).then(module=>module.parser);
  return parserPromise;
}
const limit=25;
function textRange(model,start,end){
  const len=model.getValueLength();
  const from=Math.min(Math.max(0,start),Math.max(0,len-1));
  const to=Math.max(from+1,Math.min(len,end||from+1));
  const a=model.getPositionAt(from),b=model.getPositionAt(to);
  return {startLineNumber:a.lineNumber,startColumn:a.column,endLineNumber:b.lineNumber,endColumn:b.column};
}
export async function analyzeJavaWorkspace({files,entry,monaco,update}){
  const javaFiles=Object.entries(files).filter(([name])=>name.endsWith('.java'));
  const result={errors:0,warnings:0,issues:[],available:false,checking:false};
  if(!javaFiles.length){
    result.warnings++;
    result.issues.push({filename:null,line:0,column:0,severity:'warning',message:'No Java source files are in this project.'});
    update?.(result);return result;
  }
  let parser;
  try{parser=await loadParser();result.available=true;}
  catch(error){update?.({...result,message:'Java syntax checking is unavailable offline; compilation has not been checked.'});return result;}
  for(const [filename,model] of javaFiles){
    if(result.issues.length>=limit)break;
    const code=model.getValue();
    const markers=[];
    if(code.length>150000){
      result.warnings++;
      result.issues.push({filename,line:1,column:1,severity:'warning',message:'This file is too large for the lightweight browser syntax check.'});
    }else{
      const tree=parser.parse(code);
      tree.iterate({enter(node){
        if(!node.type.isError||result.issues.length>=limit)return;
        const range=textRange(model,node.from,node.to);
        const issue={
          filename,line:range.startLineNumber,column:range.startColumn,severity:'error',
          message:'Possible Java syntax error or unfinished statement. Review this location; the Java compiler is authoritative.'
        };
        result.errors++;result.issues.push(issue);
        markers.push({...range,severity:monaco.MarkerSeverity.Error,message:issue.message,source:'Adminerva Java syntax'});
      }});
      const publicType=code.match(/\bpublic\s+(?:abstract\s+|final\s+)?(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)\b/);
      if(publicType&&filename.split('/').pop()!==publicType[1]+'.java'){
        const pos=model.getPositionAt(publicType.index);
        const msg='Public type '+publicType[1]+' normally belongs in '+publicType[1]+'.java.';
        const range=textRange(model,publicType.index,publicType.index+publicType[0].length);
        result.warnings++;
        result.issues.push({filename,line:pos.lineNumber,column:pos.column,severity:'warning',message:msg});
        markers.push({...range,severity:monaco.MarkerSeverity.Warning,message:msg,source:'Adminerva Java structure'});
      }
    }
    monaco.editor.setModelMarkers(model,OWNER,markers);
  }
  if(entry&&!files[entry]){
    result.warnings++;
    result.issues.push({filename:null,line:0,column:0,severity:'warning',message:'The selected entry file is missing.'});
  }
  update?.(result);
  return result;
}
export function clearJavaDiagnostics(files,monaco){
  for(const model of Object.values(files))monaco.editor.setModelMarkers(model,OWNER,[]);
}
