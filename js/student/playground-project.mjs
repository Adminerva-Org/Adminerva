/** Portable workspace paths and safe, dependency-free web project bundling. */
export function projectPath(value) {
  const path=String(value||"").trim().replace(/\\/g,"/");
  if(!path||path.length>220||path.startsWith("/")||/[:\x00-\x1f<>"|?*]/.test(path)||path.split("/").some(p=>!p||p==="."||p===".."))
    throw Error("Use a relative path such as src/Main.java or styles/main.css. Avoid empty folders and special characters.");
  return path;
}
export function parentFolders(names){
  const paths=new Set();
  for(const name of names){const parts=name.split("/");parts.pop();while(parts.length){paths.add(parts.join("/"));parts.pop();}}
  return [...paths].sort();
}
function relativePath(from,target){
  if(/^(?:[a-z]+:|\/\/|#)/i.test(target))return null;
  const stack=from.split("/");stack.pop();
  for(const segment of target.split(/[?#]/)[0].split("/")){if(segment===".."){if(!stack.length)return null;stack.pop();}else if(segment&&segment!==".")stack.push(segment);}
  try{return projectPath(stack.join("/"));}catch{return null;}
}
export function bundleWebProject(files,entry="index.html"){
  if(!Object.hasOwn(files,entry))throw Error("Create index.html, or select an HTML file to preview.");
  const used=new Set(),deferredScripts=[];
  const css=(text,path,chain=new Set())=>{
    if(chain.has(path))return "/* Circular stylesheet import omitted. */";
    const next=new Set([...chain,path]);
    return text.replace(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;/gi,(original,target)=>{
      const resolved=relativePath(path,target);if(!resolved||!Object.hasOwn(files,resolved))return original;
      used.add(resolved);return css(files[resolved],resolved,next);
    }).replace(/<\/style/gi,"<\\/style");
  };
  let html=files[entry];
  const hasStylesheet=/<link\b[^>]*\brel\s*=\s*["']stylesheet["']/i.test(html),hasScriptSource=/<script\b[^>]*\bsrc\s*=/i.test(html);
  if(!/<head\b/i.test(html))html=/<html\b[^>]*>/i.test(html)?html.replace(/<html\b[^>]*>/i,tag=>tag+'<head></head>'):'<!doctype html><html><head></head><body>'+html.replace(/<!doctype[^>]*>/i,'')+'</body></html>';
  html=html.replace(/<link\b[^>]*>/gi,tag=>{
    if(!/\brel\s*=\s*["']stylesheet["']/i.test(tag))return tag;
    const target=tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1],path=target&&relativePath(entry,target);
    if(!path||!Object.hasOwn(files,path))return tag;
    used.add(path);return "<style>"+css(files[path],path)+"</style>";
  });
  html=html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi,(tag,before,target,after)=>{
    const path=relativePath(entry,target);if(!path||!Object.hasOwn(files,path))return tag;
    if(/\btype\s*=\s*["']module["']/i.test(before+after))throw Error("This preview supports classic local scripts. Bundle ES modules before importing, or use a single classic script.");
    used.add(path);const script="<script>"+files[path].replace(/<\/script/gi,"<\\/script")+"</script>";
    if(/\bdefer(?:\s|=|$)/i.test(before+after)){deferredScripts.push(script);return '';}
    return script;
  });
  // Preserve root scratch files only when HTML has no explicit dependency list.
  for(const [path,content] of Object.entries(files))if(!used.has(path)){
    if(!hasStylesheet&&!path.includes('/')&&path.endsWith(".css")){const style="<style>"+css(content,path)+"</style>";html=html.replace(/<\/head>/i,()=>style+"</head>");}
    if(!hasScriptSource&&!path.includes('/')&&path.endsWith(".js")){const script="<script>"+content.replace(/<\/script/gi,"<\\/script")+"</script>";html=/<\/body>/i.test(html)?html.replace(/<\/body>/i,()=>script+"</body>"):html+script;}
  }
  if(deferredScripts.length){const scripts=deferredScripts.join('\n');html=/<\/body>/i.test(html)?html.replace(/<\/body>/i,()=>scripts+'</body>'):html+scripts;}
  const policy="<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'\">";
  return html.replace(/<head\b[^>]*>/i,tag=>tag+policy);
}
