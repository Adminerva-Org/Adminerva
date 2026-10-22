/** Packaging checks only: parse scripts and ensure local module/assets exist. No tests or app actions. */
import {readdirSync,readFileSync,existsSync} from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");let checked=0;
const backendOnly=process.argv.includes('--backend');
function files(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?['node_modules','.git','.firebase','tests'].includes(entry.name)?[]:files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
for(const filename of [...(backendOnly?[]:files(path.join(root,'js'))),...files(path.join(root,'functions'))].filter(file=>/\.(?:js|mjs)$/.test(file)&&!file.endsWith('.test.mjs'))){
  const source=readFileSync(filename,'utf8'),backend=filename.startsWith(path.join(root,'functions')+path.sep)&&filename.endsWith('.js');
  const result=spawnSync(process.execPath,backend?['--check',filename]:['--input-type=module','--check'],{input:backend?undefined:source,encoding:'utf8'});
  if(result.status!==0){process.stderr.write(path.relative(root,filename)+'\n'+result.stderr);process.exit(1);}
  for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.[^"']+)["']/g)){
    const target=path.resolve(path.dirname(filename),match[1].split('?')[0]);
    if(!existsSync(target))throw Error('Missing module: '+path.relative(root,filename)+' → '+match[1]);
  }
  checked++;
}
for(const filename of (backendOnly?[]:readdirSync(root)).filter(file=>file.endsWith('.html'))){
  const source=readFileSync(path.join(root,filename),'utf8');
  for(const match of source.matchAll(/(?:src|href)=["']((?:js|css)\/[^"']+)["']/g))if(!existsSync(path.join(root,match[1].split('?')[0])))throw Error('Missing asset: '+filename+' → '+match[1]);
}
process.stdout.write('Release package: '+checked+' scripts parse and local module/assets resolve. No runtime, browser or emulator tests run.\n');
