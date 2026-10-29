/** Select a runnable source entry without treating an arbitrary opened class as Main. */
export function chooseCompilerEntry({language,defaultFile,activeFilename,fileOrder,files}){
  const name=String(defaultFile||"");
  const extension=name.slice(name.lastIndexOf("."));
  const candidates=(fileOrder||[]).filter(path=>path.endsWith(extension)&&Object.hasOwn(files||{},path));
  if(!candidates.length)return null;
  if(language==="java"){
    const main=/\bstatic\s+void\s+main\s*\(\s*String\s*(?:\[\s*\]|\.\.\.)/;
    const runnable=candidates.filter(path=>main.test(files[path]));
    if(runnable.length)
      return runnable.includes(activeFilename)?activeFilename:
        runnable.includes(defaultFile)?defaultFile:runnable.find(path=>path.endsWith("/Main.java"))||runnable[0];
  }
  return candidates.includes(defaultFile)?defaultFile:
    candidates.includes(activeFilename)?activeFilename:candidates[0];
}
