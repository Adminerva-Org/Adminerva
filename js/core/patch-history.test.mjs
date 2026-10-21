/** Regression coverage: Shared navigation, account access, reporting and release infrastructure: patch history. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicReleases,releaseNotifications} from './patch-history.mjs';
import {notificationTarget} from './notification-routing.mjs';
import {notificationVisible} from './notification-visibility.mjs';
const release={version:'2026.10.18.4',status:'published',public:true,releasedAt:'2026-10-18',title:'Review update',summary:'Public improvement',changes:[{type:'Fixed',area:'Review',text:'Clearer controls'}]};
test('prepared staging versions are not fabricated historical releases or account notices',()=>{
  const history=JSON.parse(readFileSync('patch-history.json','utf8'));
  const manifest=JSON.parse(readFileSync('site-release.json','utf8'));
  const releases=publicReleases(history,Date.parse(manifest.releasedAt+'T23:59:59+08:00'));
  assert.ok(releases.some(item=>item.version===manifest.version));
  for(const version of ['2026.10.19.1','2026.10.19.2'])assert.ok(!releaseNotifications(releases).some(notice=>notice.key==='release:'+version));
  assert.ok(releases.some(item=>item.version==='2026.10.18.4'));
});
test('only explicitly published public releases produce one notification per version',()=>{
  const releases=publicReleases({releases:[release,release,{...release,version:'2026.10.18.5',public:false},{...release,version:'2026.10.18.6',status:'draft'},{...release,version:'2099.10.18.1',releasedAt:'2099-10-18'}]},Date.parse('2026-10-20'));
  assert.equal(releases.length,1);
  const [notice]=releaseNotifications(releases);assert.equal(notice.key,'release:2026.10.18.4');assert.equal(notificationTarget(notice.target),notice.target);
  for(const role of ['student','teacher','admin'])assert.equal(notificationVisible(notice,role),true);
});
test('public projection excludes private metadata and malformed releases',()=>{
  const [result]=publicReleases({releases:[{...release,internalNotes:'not public',studentEmail:'private@example.edu'}]},Date.parse('2026-10-20'));
  assert.equal(result.internalNotes,undefined);assert.equal(result.studentEmail,undefined);
  assert.equal(publicReleases({releases:[{...release,version:'<script>'}]}).length,0);
});
test('shipped patch manifest contains only curated public fields and system labels',()=>{
  const data=JSON.parse(readFileSync('patch-history.json','utf8'));
  for(const item of data.releases){
    assert.deepEqual(Object.keys(item).sort(),['version','status','public','releasedAt','title','summary','changes',...(item.displayVersion?['displayVersion']:[])].sort());
    if(item.displayVersion)assert.match(item.displayVersion,/^\d+\.\d+\.\d+$/);
    assert.equal(item.public,true);assert.doesNotMatch(JSON.stringify(item),/\bAI\b|@|api[_ -]?key|ruleset|studentId|firebase/i);
    for(const change of item.changes)assert.deepEqual(Object.keys(change).sort(),['area','text','type']);
  }
});
