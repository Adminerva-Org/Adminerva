/** Conservative, offline Java layout formatter. Only whitespace may change. */
const keywordParen=new Set(["if","for","while","switch","catch","synchronized","try"]);
const spaced=new Set(["=","+","-","*","/","%","==","!=","<=",">=","&&","||","&","|","^","+=","-=","*=","/=","%=","&=","|=","^=","<<=",">>=",">>>=","->"]);
const operator=/>>>=|>>=|<<=|>>>|>>|<<|\.\.\.|::|->|\+\+|--|==|!=|<=|>=|&&|\|\||[+\-*\/%&|^]=|[{}()[\];,.@?:~!+\-*\/%&|^=<>]/y;
const identifier=/[\p{L}\p{Nl}\p{Sc}\p{Pc}_$][\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}\p{Cf}_$]*/uy;
const number=/(?:0[xX](?:[0-9a-fA-F_]+(?:\.[0-9a-fA-F_]*)?|\.[0-9a-fA-F_]+)(?:[pP][+-]?[0-9_]+[fFdD]?|[lL]?)|0[bB][01_]+[lL]?|(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9_]+)?[fFdDlL]?)/y;
function lex(source){
  // Java processes Unicode escapes before tokenization. Refuse those rather
  // than mistake an escaped delimiter for ordinary source text.
  if(/\\u+[0-9a-fA-F]{4}/.test(source))throw Error("Java Unicode escapes need a specialized formatter. The file was left unchanged.");
  const out=[];let i=0;
  while(i<source.length){
    const startGap=i;while(i<source.length&&/[ \t\r\n\f]/.test(source[i]))i++;
    const gap=source.slice(startGap,i);if(i===source.length)break;
    const start=i;let kind="symbol";
    if(source.startsWith("//",i)){
      kind="line";while(i<source.length&&!/[\r\n]/.test(source[i]))i++;
    }else if(source.startsWith("/*",i)){
      kind="comment";const end=source.indexOf("*/",i+2);
      if(end<0)throw Error("Close the block comment before formatting.");
      i=end+2;
    }else if(source.startsWith('"""',i)){
      // Text-block incidental indentation is semantic, so preserve the entire literal.
      kind="literal";i+=3;let closed=false;
      while(i<source.length){if(source[i]==="\\"){i+=2;continue;}if(source.startsWith('"""',i)){i+=3;closed=true;break;}i++;}
      if(!closed)throw Error("Close the Java text block before formatting.");
    }else if(source[i]==='"'||source[i]==="'"){
      kind="literal";const quote=source[i++];let closed=false;
      while(i<source.length){if(/[\r\n]/.test(source[i]))break;if(source[i]==="\\"){i+=2;continue;}if(source[i++]===quote){closed=true;break;}}
      if(!closed)throw Error("Close the string or character literal before formatting.");
    }else{
      number.lastIndex=identifier.lastIndex=operator.lastIndex=i;
      const match=number.exec(source)||identifier.exec(source)||operator.exec(source);
      if(!match)throw Error("Unsupported Java token. No code was changed.");
      i+=match[0].length;
    }
    out.push({text:source.slice(start,i),gap,kind});
  }
  return out;
}
function identicalTokens(before,after){
  return before.length===after.length&&before.every((token,index)=>token.text===after[index].text&&token.kind===after[index].kind);
}
export function formatJavaSource(source,{tabSize=4,insertSpaces=true}={}){
  source=String(source);if(!source.trim())return source;
  const tokens=lex(source),indent=insertSpaces?" ".repeat(Math.max(1,Math.min(8,Number(tabSize)||4))):"\t";
  let result="",depth=0,lineStart=true,parenDepth=0;const delimiters=[],braceParens=[];
  const eol=source.includes("\r\n")?"\r\n":"\n";
  function newline(blank=false){
    // All trailing whitespace here was emitted by this formatter, not inside literals/comments.
    if(!result)return;
    if(!lineStart){result+=eol;lineStart=true;}
    if(blank&&!result.endsWith(eol+eol))result+=eol;
  }
  function space(){if(result&&!lineStart&&!/[ \t]$/.test(result))result+=" ";}
  function append(value){if(lineStart){result+=indent.repeat(depth);lineStart=false;}result+=value;}
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i],t=token.text,prev=tokens[i-1],p=prev?.text,next=tokens[i+1],n=next?.text;
    const symbol=token.kind==="symbol",originalNewline=/[\r\n]/.test(token.gap),blank=/(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)/.test(token.gap);
    if(symbol&&["}",")","]"].includes(t)){
      const expected={"}":"{",")":"(","]":"["}[t];
      if(delimiters.pop()!==expected)throw Error("Balance the braces, parentheses and brackets before formatting.");
      if(t==="}"){depth--;braceParens.pop();}
      if(t===")")parenDepth--;
    }
    if(token.kind==="line"||token.kind==="comment"){
      if(originalNewline)newline(blank);else if(prev)space();
      append(t);
      if(token.kind==="line")newline();
      continue;
    }
    // Opening/closing braces and statement boundaries take priority over old spacing.
    if(symbol&&t==="}"){
      if(p!=="{")newline();
      append(t);
    }else if(symbol&&t==="{"){
      if(prev&&p!=="("&&p!=="["&&p!=="{")space();
      append(t);if(n!=="}")newline();
    }else{
      if(prev?.kind==="line")newline();
      else if(p==="{"&&t!=="}")newline();
      else if(p==="}"&&!["else","catch","finally","while",";",",",")","]",".","::","}"].includes(t))newline();
      else if(p===";"&&parenDepth===(braceParens.at(-1)||0))newline(blank);
      else if(originalNewline&&p!==".")newline(blank);
      else if(t===";"||t===","||t===")"||t==="]"||t==="."||t==="::"){}
      else if(p==="("||p==="["||p==="."||p==="::"||p==="@"||p==="~"||p==="!"){}
      else if(t==="("){if(keywordParen.has(p)||spaced.has(p)||p==="return"||p==="throw"||p==="yield")space();}
      else if(t==="["){}
      else if(p==="}"||p===","||p===";"||prev?.kind==="comment")space();
      else if(spaced.has(t)||spaced.has(p)){
        // Preserve unary/increment adjacency; the final token check catches any
        // accidental operator merging (for example + + becoming ++).
        if(t!=="++"&&t!=="--"&&p!=="++"&&p!=="--")space();
      }else if(token.gap)space();
      append(t);
    }
    if(symbol&&["{","(","["].includes(t)){
      delimiters.push(t);
      if(t==="{"){depth++;braceParens.push(parenDepth);}
      else if(t==="(")parenDepth++;
    }
  }
  if(delimiters.length)throw Error("Balance the braces, parentheses and brackets before formatting.");
  if(!lineStart)result+=eol;
  if(!identicalTokens(tokens,lex(result)))throw Error("Formatting could change Java tokens. The original file was preserved.");
  return result;
}
