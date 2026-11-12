/**
 * Produce a minimal, isolated Cloudflare Pages artifact for CheerpJ Studio.
 * Deliberately omit the standalone experiment, assessment, test, Firebase and
 * Adminerva application files. No installation or build dependencies.
 */
import {copyFile, mkdir, rm, writeFile} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const from=join(root,'experiments/cheerpj-console');
const to=join(root,'dist/cheerpj-runner');
const assets=['embedded-runner.html','embedded-runner.mjs','console-bridge.mjs','_headers'];
await rm(to,{recursive:true,force:true});
await mkdir(to,{recursive:true});
for(const name of assets)await copyFile(join(from,name),join(to,name));
await writeFile(join(to,'index.html'),
  '<!doctype html><html lang="en"><meta charset="utf-8">'+
  '<meta name="robots" content="noindex,nofollow"><title>Adminerva Java runner</title>'+
  '<body><p>This isolated execution host is used by Adminerva Studio. Open Java projects in Studio.</p></body></html>\n');
console.log('Built isolated CheerpJ Pages assets:',assets.concat('index.html').join(', '));
