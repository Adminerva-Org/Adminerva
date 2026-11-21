import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const text=path=>readFile(new URL(path,root),'utf8');
test('immersive Opportunity Hunter is a real content-bound interactive map',async()=>{
  const [page,logic,style]=await Promise.all([
    text('opportunities.html'),text('js/core/opportunities-page.mjs'),text('css/editorial-cinematic.css')
  ]);
  for(const marker of ['id="atlas-nodes"','id="atlas-detail"','id="opportunities-list"','id="opportunities-search"','data-atlas-category','data-cine-particles','data-cine-motion-toggle']){
    assert.ok(page.includes(marker),'Opportunity Hunter missing '+marker);
  }
  assert.match(logic,/loadPublicChannel\('opportunities'/);
  assert.match(logic,/setAttribute\('aria-pressed'/);
  assert.match(logic,/item\.sourceUrl/);
  assert.match(logic,/item\.applicationDeadline/);
  assert.match(style,/@media\(max-width:520px\)/);
  assert.match(style,/@media\(prefers-reduced-motion:reduce\)/);
});
test('Pulse is a four-channel experience with authoritative releases',async()=>{
  const [page,logic]=await Promise.all([
    text('pulse.html'),text('js/core/pulse-page.mjs')
  ]);
  for(const channel of ['releases','weekly-pulse','experiences','announcements']){
    assert.ok(page.includes('data-signal-channel="'+channel+'"'),'missing '+channel);
  }
  assert.match(logic,/loadPublicReleases\(\)/);
  assert.match(logic,/loadPublicChannel\('weekly-pulse'/);
  assert.match(logic,/loadPublicChannel\('announcements'/);
  assert.match(logic,/loadPublicChannel\('experiences'/);
  assert.match(logic,/ArrowRight/);
  assert.match(page,/id="signal-queue"/);
});
test('both public and guest homepage portals are interactive and retain existing workflows',async()=>{
  const [publicHome,guestHome,world]=await Promise.all([
    text('index.html'),text('guest-home.html'),text('js/core/public-universe.mjs')
  ]);
  for(const page of [publicHome,guestHome]){
    assert.ok(page.includes('css/public-universe.css'),'public visual layer missing');
    assert.ok(page.includes('js/core/public-universe.mjs'),'interactive homepage module missing');
    assert.ok(page.includes('js/core/home-content.mjs'),'existing editorial reader must remain');
  }
  assert.ok(publicHome.includes('href="enroll.html"'),'enrollment access must remain');
  assert.ok(guestHome.includes('id="guest-identity"'),'guest identity plumbing must remain');
  assert.match(world,/loadPublicChannel\('experiences'/);
  assert.match(world,/aria-pressed/);
  assert.match(world,/prefers-reduced-motion/);
});
test('cinematic pages link only to present static assets or destinations',async()=>{
  for(const path of ['opportunities.html','pulse.html']){
    const page=await text(path);
    const matches=[...page.matchAll(/(?:href|src)="([^"]+)"/g)];
    for(const [,value] of matches){
      if(value.startsWith('#')||value.startsWith('https://')||value.includes('?continue='))continue;
      const file=value.split('?')[0].split('#')[0];
      if(!file||file.startsWith('data:'))continue;
      await assert.doesNotReject(access(new URL(file,root)),path+' contains missing route or asset '+value);
    }
  }
});
