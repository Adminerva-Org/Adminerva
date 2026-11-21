import test from 'node:test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {parsePublicChannel,normalizePublicItem,PUBLIC_CHANNELS} from './public-content.mjs';

const now=Date.parse('2026-11-21T12:00:00Z');
const opportunity={
  id:'verified-training',status:'published',publishedAt:'2026-11-20T08:00:00+08:00',
  expiresAt:'2026-11-30T23:59:00+08:00',
  verifiedAt:'2026-11-20',title:'Training program',summary:'Verified learning opportunity',
  category:'Training',provider:'Provider',cost:'Free',
  location:'Online',eligibility:'Check official registration conditions.',
  url:'https://provider.example/program',sourceUrl:'https://provider.example/details',
  audience:['all'],tags:['Python']
};
test('public opportunities require verification, source and freshness',()=>{
  const item=normalizePublicItem(opportunity,'opportunities',now);
  assert.equal(item?.title,'Training program');
  assert.equal(normalizePublicItem({...opportunity,sourceUrl:'javascript:alert(1)'},'opportunities',now),null);
  assert.equal(normalizePublicItem({...opportunity,url:'//evil.invalid'},'opportunities',now),null);
  assert.equal(normalizePublicItem({...opportunity,verifiedAt:'2026-08-01'},'opportunities',now),null);
  assert.equal(normalizePublicItem({...opportunity,expiresAt:'2026-11-19T00:00:00+08:00'},'opportunities',now),null);
  assert.equal(normalizePublicItem({...opportunity,status:'draft'},'opportunities',now),null);
  assert.equal(normalizePublicItem({...opportunity,applicationDeadline:'2026-11-19'},'opportunities',now),null);
  assert.equal(normalizePublicItem({...opportunity,applicationDeadline:'2026-11-28'},'opportunities',now)?.applicationDeadline,'2026-11-28');
});
test('publication and duplicate filters are conservative',()=>{
  const data={schemaVersion:1,channel:'opportunities',items:[
    opportunity,{...opportunity,id:'verified-training'}, {...opportunity,id:'private',audience:['teacher']}
  ]};
  assert.deepEqual(parsePublicChannel(data,'opportunities',{now,role:'student'}).map(x=>x.id),['verified-training']);
  assert.deepEqual(parsePublicChannel(data,'opportunities',{now,role:'teacher'}).map(x=>x.id),['verified-training','private']);
  assert.throws(()=>parsePublicChannel({...data,channel:'announcements'},'opportunities',{now}),/Unsupported/);
});
test('scheduled visual atmosphere is a small validated choice',()=>{
  const base={id:'experience-visual',status:'published',publishedAt:'2026-11-20T08:00:00+08:00',
    expiresAt:'2026-12-15T23:59:00+08:00',title:'Try public practice',summary:'Explore a public activity',
    audience:['all'],url:'guest-practice.html',label:'FEATURED'};
  const now=Date.parse('2026-11-21T12:00:00Z');
  assert.equal(normalizePublicItem({...base,sceneTone:'sky'},'experiences',now)?.sceneTone,'sky');
  assert.equal(normalizePublicItem({...base,sceneTone:'invalid'},'experiences',now),null);
});

test('future-dated entries and content without expiry remain unpublished',()=>{
  const item={...opportunity,publishedAt:'2027-01-01T00:00:00+08:00'};
  assert.equal(normalizePublicItem(item,'opportunities',now),null);
  assert.equal(normalizePublicItem({...opportunity,expiresAt:null},'opportunities',now),null);
});
test('public notices require a traceable source, not a fictional release',()=>{
  const item={id:'friday-update',status:'published',publishedAt:'2026-11-20T08:00:00+08:00',
    expiresAt:'2026-11-30T23:59:00+08:00',title:'Friday recap',
    summary:'Verified shipped work only',audience:['all'],url:'patch-notes.html'};
  assert.equal(normalizePublicItem(item,'weekly-pulse',now),null);
  assert.ok(normalizePublicItem({...item,sourceUrl:'patch-notes.html'},'weekly-pulse',now));
});
test('there is one explicit file for each scheduled editorial channel',()=>{
  assert.deepEqual(Object.keys(PUBLIC_CHANNELS),['opportunities','experiences','announcements','weekly-pulse']);
});

test('all configured public content is safe for publication as static JSON',async()=>{
  const allowedStatus=new Set(['published','draft']);
  const prohibitedKeys=new Set([
    'schoolId','studentId','studentUid','uid','email','token','accessToken',
    'enrollmentId','grade','score','guardianId','personId','membershipId'
  ]);
  for(const [channel,path] of Object.entries(PUBLIC_CHANNELS)){
    const raw=await readFile(new URL('../../'+path,import.meta.url),'utf8');
    assert.ok(Buffer.byteLength(raw,'utf8')<=200_000,path+' exceeds public size limit');
    const data=JSON.parse(raw);
    assert.equal(data.schemaVersion,1);
    assert.equal(data.channel,channel);
    assert.ok(Array.isArray(data.items));
    assert.ok(data.items.length<=150);
    const seenIds=new Set(),seenProviders=new Set();
    for(const item of data.items){
      assert.ok(allowedStatus.has(item.status),channel+' has an unknown status');
      assert.ok(!seenIds.has(item.id),channel+' contains a duplicate ID');
      seenIds.add(item.id);
      for(const key of Object.keys(item))assert.ok(!prohibitedKeys.has(key),channel+' contains private key '+key);
      if(channel==='opportunities'){
        const fingerprint=String(item.provider||'')+'|'+String(item.url||'');
        assert.ok(!seenProviders.has(fingerprint),channel+' has a duplicate provider and destination');
        seenProviders.add(fingerprint);
      }
      // Validate intrinsic shape while the publication window is valid, even
      // after a listing has naturally expired and disappeared from the UI.
      const first=Date.parse(item.publishedAt),last=Date.parse(item.expiresAt);
      const verification=channel==='opportunities'?Date.parse(item.verifiedAt+'T00:00:00Z'):first;
      const at=Math.max(first+1_000,verification+1_000);
      assert.ok(at<last,channel+' has verification later than its expiry');
      assert.ok(normalizePublicItem({...item,status:'published'},channel,at),channel+' contains invalid item '+item.id);
    }
  }
});
