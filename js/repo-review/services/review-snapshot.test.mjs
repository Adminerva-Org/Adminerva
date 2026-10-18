import test from 'node:test';
import assert from 'node:assert/strict';
import {loadReviewSnapshot} from './review-snapshot.mjs';
const checkpoint='a'.repeat(40),assessment={targetPaths:['app/**/*.xml'],fileTypes:['xml']};
function mock(paths,{truncated=false,large=false}={}){
  return async url=>({ok:true,json:async()=>url.includes('/git/trees/')?{truncated,tree:paths.map(path=>({type:'blob',path}))}:{encoding:'base64',content:Buffer.from('<TextView/>').toString('base64'),size:large?40000:11}});
}
test('pinned review shows all matching checkpoint files separately from attribution',async()=>{
  const paths=['app/welcome.xml','app/home.xml'];
  const result=await loadReviewSnapshot('https://github.com/example/project',checkpoint,assessment,{fetchImpl:mock(paths)});
  assert.deepEqual(result.paths,paths);assert.equal(result.files.length,2);assert.equal(result.partial,false);assert.equal(result.verifiedContributionCommits,undefined);
});
test('source coverage limits and missing source are explicit rather than missing-work conclusions',async()=>{
  const paths=Array.from({length:13},(_value,index)=>'app/screen'+index+'.xml');
  const result=await loadReviewSnapshot('https://github.com/example/project',checkpoint,assessment,{fetchImpl:mock(paths)});
  assert.equal(result.paths.length,13);assert.equal(result.files.length,12);assert.equal(result.partial,true);
  const large=await loadReviewSnapshot('https://github.com/example/project',checkpoint,assessment,{fetchImpl:mock(paths.slice(0,1),{large:true})});
  assert.equal(large.partial,true);assert.match(large.files[0].error,/30 KB/);
  await assert.rejects(loadReviewSnapshot('https://github.com/example/project',checkpoint,assessment,{fetchImpl:mock(paths,{truncated:true})}),/incomplete/);
});
