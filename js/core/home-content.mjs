/**
 * Shared, read-only homepage editorial surface.
 * All data is public even on authenticated homes; role is relevance, NOT access control.
 * Private classroom/school updates must come from authenticated backend services.
 */
import {loadPublicChannel} from './public-content.mjs?v=20261121-1';

const main=document.querySelector('main[data-home-experience]');
if(main){
  const role=main.dataset.homeExperience;
  const container=document.createElement('section');
  container.className='av-home-editorial';
  container.setAttribute('aria-labelledby','av-home-editorial-title');
  const head=document.createElement('div');
  head.className='av-home-editorial-head';
  const titleWrap=document.createElement('div');
  const eyebrow=document.createElement('p');
  eyebrow.className='av-opportunities-kicker';
  eyebrow.textContent='ADMINERVA PULSE';
  const heading=document.createElement('h2');
  heading.id='av-home-editorial-title';
  heading.textContent='Discover something new';
  titleWrap.append(eyebrow,heading);
  const explore=document.createElement('a');
  explore.href='opportunities.html';
  explore.textContent='Explore all opportunities ↗';
  head.append(titleWrap,explore);
  const cards=document.createElement('div');
  cards.className='av-home-editorial-items';
  cards.setAttribute('aria-live','off');
  const status=document.createElement('p');
  status.className='av-home-editorial-empty';
  status.textContent='Finding the latest published discoveries…';
  container.append(head,cards,status);
  const anchor=main.querySelector('.av-activity-stage')||main.querySelector('.av-home-hero,.av-guest-motion-hero,.av-public-hero,header');
  if(anchor)anchor.after(container);else main.prepend(container);
  const channels=['announcements','weekly-pulse','opportunities','experiences'];
  const result=await Promise.allSettled(channels.map(channel=>loadPublicChannel(channel,{role})));
  const available=new Map(channels.map((channel,index)=>[
    channel,result[index].status==='fulfilled'?result[index].value:[]
  ]));
  const day=Math.floor(Date.now()/86400000);
  const pick=(channel)=>{const items=available.get(channel)||[];return items.length?items[day%items.length]:null;};
  const entries=[
    pick('announcements'),pick('weekly-pulse'),
    pick('opportunities'),pick('experiences')
  ].filter(Boolean).slice(0,3);
  const labels={'announcements':'Announcement','weekly-pulse':'Friday recap','opportunities':'Opportunity Hunter','experiences':'Explore Adminerva'};
  for(const item of entries){
    const a=document.createElement('a');
    a.className='av-home-editorial-card';
    a.href=item.channel==='opportunities'?'opportunities.html':item.url;
    if(a.href.startsWith('https://')){a.target='_blank';a.rel='noopener noreferrer';}
    const label=document.createElement('span');
    label.textContent=labels[item.channel];
    const title=document.createElement('strong');
    title.textContent=item.title;
    const summary=document.createElement('p');
    summary.textContent=item.summary;
    a.append(label,title,summary);
    cards.append(a);
  }
  if(entries.length){
    status.hidden=true;
  }else{
    status.textContent='No new public editorial updates right now. Explore verified opportunities and the published release history.';
    const release=document.createElement('a');
    release.href='patch-notes.html';
    release.textContent='See what\'s new in Adminerva ↗';
    release.className='av-home-editorial-card';
    cards.append(release);
  }
}
