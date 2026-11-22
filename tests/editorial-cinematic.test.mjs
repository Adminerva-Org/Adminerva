import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const text=path=>readFile(new URL(path,root),'utf8');

test('Opportunity Hunter is an expedition trail backed by the canonical opportunity channel',async()=>{
  const [page,logic]=await Promise.all([text('opportunities.html'),text('js/core/opportunities-page.mjs')]);
  for(const marker of ['id="opportunity-trail"','id="opportunity-focus"','id="opportunities-list"','id="opportunities-search"','data-opportunity-category'])assert.ok(page.includes(marker),'missing '+marker);
  assert.match(logic,/loadPublicChannel\('opportunities'/);
  assert.match(logic,/item\.sourceUrl/);
  assert.match(logic,/item\.applicationDeadline/);
  assert.match(logic,/aria-pressed/);
  assert.doesNotMatch(page,/atlas|radar|particle|av-cine/i);
});
test('Pulse is a four-stream time current backed by release and editorial sources',async()=>{
  const [page,logic]=await Promise.all([text('pulse.html'),text('js/core/pulse-page.mjs')]);
  for(const channel of ['releases','weekly-pulse','experiences','announcements'])assert.ok(page.includes('data-signal-channel="'+channel+'"'),'missing '+channel);
  assert.match(page,/avx-time-current/);
  assert.match(logic,/loadPublicReleases\(\)/);
  assert.match(logic,/loadPublicChannel\('weekly-pulse'/);
  assert.match(logic,/loadPublicChannel\('announcements'/);
  assert.match(logic,/loadPublicChannel\('experiences'/);
  assert.match(logic,/ArrowRight/);
  assert.doesNotMatch(page,/signal room|radar|orbit|particle|av-cine/i);
});
test('public and guest home retire old universe layer while retaining quick-mode workflows',async()=>{
  const [publicHome,guestHome,experience]=await Promise.all([text('index.html'),text('guest-home.html'),text('js/core/experience-mode.mjs')]);
  for(const page of [publicHome,guestHome]){assert.ok(page.includes('js/core/home-content.mjs'));assert.doesNotMatch(page,/public-universe\.(?:css|mjs)/);}
  assert.ok(publicHome.includes('href="enroll.html"'));
  assert.ok(guestHome.includes('id="guest-identity"'));
  assert.match(experience,/loadPublicChannel\('experiences'/);
});
test('editorial pages reference only existing local static assets or destinations',async()=>{
  for(const path of ['opportunities.html','pulse.html']){
    const page=await text(path);
    for(const [,value] of page.matchAll(/(?:href|src)="([^"]+)"/g)){
      if(value.startsWith('#')||value.startsWith('https://')||value.includes('?continue='))continue;
      const file=value.split('?')[0].split('#')[0];
      if(file)await assert.doesNotReject(access(new URL(file,root)),path+' missing '+value);
    }
  }
});
