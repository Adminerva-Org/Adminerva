import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGithubRepository, createGithubEvidenceClient } from './github-evidence-client.mjs';

function mock(handler) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url); calls.push(u);
    const result = handler(u);
    const status = result?.status ?? 200;
    return { ok: status >= 200 && status < 300, status,
      json: async () => result?.body ?? result };
  };
  return { calls, fetchImpl };
}
const SHA = 'a'.repeat(40);

test('accepts GitHub repo URL and .git suffix', () => {
  assert.deepEqual(parseGithubRepository('https://github.com/Adminerva-Org/Adminerva.git'),
    {owner:'Adminerva-Org',repo:'Adminerva',fullName:'Adminerva-Org/Adminerva'});
});
test('rejects invalid hosts, protocols and file paths', () => {
  for (const url of ['https://github.com.evil.org/a/b','http://github.com/a/b','https://github.com/a/b/tree/main','https://example.org/a/b']) {
    assert.throws(() => parseGithubRepository(url));
  }
});
test('paginates commit listings and deduplicates hashes', async () => {
  const {calls,fetchImpl}=mock(u=>u.searchParams.get('page')==='1'
    ? Array.from({length:100},(_,i)=>({sha:String(i)}))
    : [{sha:'99'},{sha:'100'}]);
  const client=createGithubEvidenceClient({fetchImpl});
  const out=await client.listCommits({repository:'foo/bar',ref:SHA});
  assert.equal(out.historyComplete,true); assert.equal(out.commits.length,101);
  assert.equal(calls.length,2); assert.equal(calls[0].searchParams.get('sha'),SHA);
});
test('flags commit history as incomplete at pagination cap', async () => {
  const {fetchImpl}=mock(()=>Array.from({length:100},(_,i)=>({sha:String(i)})));
  const out=await createGithubEvidenceClient({fetchImpl,maxPages:1}).listCommits({repository:'foo/bar'});
  assert.equal(out.historyComplete,false);
});
test('paginates commit file lists', async () => {
  const {fetchImpl}=mock(u=>({sha:SHA,parents:[{sha:'b'.repeat(40)}],files:
    u.searchParams.get('page')==='1' ? Array.from({length:100},(_,i)=>({filename:`file${i}.java`,patch:'diff'})) :
      [{filename:'last.java',patch:'diff'}]}));
  const d=await createGithubEvidenceClient({fetchImpl}).loadCommit('foo/bar',SHA);
  assert.equal(d.files.length,101); assert.equal(d.filesTruncated,false); assert.equal(d.parents.length,1);
});
test('flags commit file list truncated at max pages', async () => {
  const {fetchImpl}=mock(()=>({sha:SHA,parents:[],files:Array.from({length:100},()=>({filename:'x'}))}));
  const d=await createGithubEvidenceClient({fetchImpl,maxCommitFilesPages:1}).loadCommit('foo/bar',SHA);
  assert.equal(d.filesTruncated,true);
});
test('throws on API failure rather than returning empty submission', async () => {
  const {fetchImpl}=mock(()=>({status:403,body:{message:'rate limited'}}));
  await assert.rejects(()=>createGithubEvidenceClient({fetchImpl}).listCommits({repository:'foo/bar'}),/HTTP 403/);
});
test('resolves branch head before evidence scan', async () => {
  const {calls,fetchImpl}=mock(u=>u.pathname==='/repos/foo/bar'?{default_branch:'master'}:
    u.pathname.endsWith('/commits/master')?{sha:SHA}:[]);
  const client=createGithubEvidenceClient({fetchImpl});
  const out=await client.resolveEvidence({repository:'foo/bar',student:{id:'s1'},assessment:{id:'a1'},
    resolver:async input=>({received:input.commits.length,loaded:typeof input.loadCommit})});
  assert.equal(out.scannedRef,SHA);assert.equal(out.received,0);assert.equal(out.loaded,'function');
  assert(calls.some(u=>u.searchParams.get('sha')===SHA));
});

test('reuses SHA-pinned history and commit detail responses without caching moving branch HEAD', async () => {
  const refSha = 'f'.repeat(40);
  const {calls,fetchImpl}=mock(u=>{
    if (u.pathname==='/repos/foo/bar') return {default_branch:'main'};
    if (u.pathname==='/repos/foo/bar/commits/main') return {sha:refSha};
    if (u.pathname==='/repos/foo/bar/commits/'+refSha)
      return {sha:refSha,parents:[],files:[{filename:'Exam.java',patch:'@@ +1 @@'}]};
    if (u.pathname==='/repos/foo/bar/commits') return [{sha:refSha}];
    throw new Error('Unexpected path: '+u.pathname);
  });
  const client=createGithubEvidenceClient({fetchImpl});
  for (let i=0;i<2;i++) {
    await client.resolveEvidence({repository:'foo/bar',student:{id:'s'},assessment:{id:'task'},
      resolver:async ({loadCommit}) => {
        const detail=await loadCommit(refSha);
        return {files:detail.files.length};
      }});
  }
  assert.equal(calls.filter(u=>u.pathname==='/repos/foo/bar').length,2,
    'Mutable repository metadata must be refreshed');
  assert.equal(calls.filter(u=>u.pathname==='/repos/foo/bar/commits/main').length,2,
    'Mutable branch tip must be refreshed');
  assert.equal(calls.filter(u=>u.pathname==='/repos/foo/bar/commits' &&
    u.searchParams.get('sha')===refSha).length,1,
    'SHA-pinned history should be reused');
  assert.equal(calls.filter(u=>u.pathname==='/repos/foo/bar/commits/'+refSha).length,1,
    'Immutable commit diff should be reused');
});
