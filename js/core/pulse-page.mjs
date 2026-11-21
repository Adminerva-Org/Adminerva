import {loadPublicChannel} from './public-content.mjs?v=20261121-1';
import {loadPublicReleases} from './patch-history.mjs?v=1.4.19';

/** A source-backed signal room; never fabricates new events or releases. */
const story=document.getElementById('signal-story');
const queue=document.getElementById('signal-queue');
const empty=document.getElementById('signal-queue-empty');
const tabs=[...document.querySelectorAll('[data-signal-channel]')];
const name=document.getElementById('signal-channel-name');
const indexDisplay=document.getElementById('signal-index');
const total=document.getElementById('signal-total');
const currentStatus=document.getElementById('signal-current-status');
const prev=document.getElementById('signal-prev'),next=document.getElementById('signal-next');
const labels={releases:'SHIPPED & VERIFIED','weekly-pulse':'THE FRIDAY PULSE',experiences:'OPEN EXPERIMENTS',announcements:'ANNOUNCEMENTS'};
const headlines={
  releases:['No release history available yet.','Open the canonical What\'s New page for verified releases.'],
  'weekly-pulse':['The next chapter has not been published.','Friday recaps appear here when they have been reviewed and approved.'],
  experiences:['The next exploration is being prepared.','Try Adminerva\'s public tools while we prepare another discovery.'],
  announcements:['All quiet on this channel.','No reviewed public announcements have been published.']
};
const make=(tag,cls,txt)=>{
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(txt!==undefined)n.textContent=String(txt);
  return n;
};
const safeHref=value=>/^(?:https:\/\/[^\s]+|[a-z0-9-]+\.html(?:[?#][a-z0-9_=&%#.-]+)?)$/i.test(value||'')?value:'patch-notes.html';
function a(url,text){
  const n=make('a',null,text);
  n.href=safeHref(url);
  if(n.href.startsWith('https://')){n.target='_blank';n.rel='noopener noreferrer';}
  return n;
}
function date(value){
  const time=Date.parse(value);
  return Number.isFinite(time)?new Date(time).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric'}):'';
}
const data={releases:[],experiences:[],'weekly-pulse':[],announcements:[]};
let channel='releases',position=0,errors=new Set();
function showStory(){
  const items=data[channel],item=items[position];
  indexDisplay.textContent=items.length?String(position+1).padStart(2,'0')+' / '+String(items.length).padStart(2,'0'):'00 / 00';
  total.textContent=String(items.length).padStart(2,'0')+' SIGNAL'+(items.length===1?'':'S');
  name.textContent=labels[channel];
  queue.replaceChildren();
  if(!item){
    const fallback=headlines[channel];
    story.replaceChildren(make('p','av-cine-micro',errors.has(channel)?'SOURCE TEMPORARILY UNAVAILABLE':'NOTHING IN THIS CHANNEL YET'),
      make('h3',null,errors.has(channel)?'We lost this signal for now.':fallback[0]),
      make('p',null,errors.has(channel)?'Try again later or explore the published release history.':fallback[1]),
      a(channel==='experiences'?'guest-home.html':'patch-notes.html',channel==='experiences'?'Visit public tools ↗':'View release history ↗'));
    empty.hidden=false;
    empty.textContent=errors.has(channel)?'This channel could not be loaded. Please retry later.':'There are no approved transmissions in this channel yet.';
    currentStatus.textContent='No transmissions to navigate';
    prev.disabled=next.disabled=true;
    return;
  }
  empty.hidden=true;
  const eyebrow=make('p','av-cine-micro',item.kicker);
  const title=make('h3',null,item.title);
  const summary=make('p',null,item.summary);
  const time=make('p','av-signal-timestamp',item.date?item.date:'');
  const action=a(item.url,item.action);
  story.replaceChildren(eyebrow,title,summary,time,action);
  currentStatus.textContent=(position+1)+' of '+items.length+' selected';
  prev.disabled=next.disabled=items.length<=1;
  for(const [i,entry] of items.entries()){
    const b=make('button','av-signal-queue-item');
    b.type='button';
    b.setAttribute('aria-pressed',String(i===position));
    b.setAttribute('aria-label','Show transmission '+(i+1)+': '+entry.title);
    b.append(make('span',null,String(i+1).padStart(2,'0')),make('strong',null,entry.title));
    b.addEventListener('click',()=>{position=i;showStory();});
    queue.append(b);
  }
}
function setChannel(value){
  if(!(value in data))return;
  channel=value;
  position=0;
  tabs.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.signalChannel===value)));
  showStory();
}
function step(amount){
  const n=data[channel].length;
  if(n<2)return;
  position=(position+amount+n)%n;
  showStory();
}
if(story&&queue&&prev&&next){
  tabs.forEach(b=>b.addEventListener('click',()=>setChannel(b.dataset.signalChannel)));
  prev.addEventListener('click',()=>step(-1));
  next.addEventListener('click',()=>step(1));
  document.querySelector('.av-signal-console')?.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight'].includes(event.key)||event.target.closest('input,textarea'))return;
    event.preventDefault();
    step(event.key==='ArrowRight'?1:-1);
  });
  const settled=await Promise.allSettled([
    loadPublicReleases(),
    loadPublicChannel('weekly-pulse',{role:'all'}),
    loadPublicChannel('experiences',{role:'all'}),
    loadPublicChannel('announcements',{role:'all'})
  ]);
  const [releases,weekly,experiences,announcements]=settled;
  if(releases.status==='fulfilled'){
    data.releases=releases.value.slice(0,12).map(item=>({
      id:item.version,kicker:'PUBLISHED RELEASE / VERSION '+item.version,
      title:item.title,summary:item.summary,date:date(item.releasedAt),
      url:'patch-notes.html?version='+encodeURIComponent(item.version),action:'Open verified release notes ↗'
    }));
  }else errors.add('releases');
  for(const [key,result] of [['weekly-pulse',weekly],['experiences',experiences],['announcements',announcements]]){
    if(result.status==='rejected'){errors.add(key);continue;}
    data[key]=result.value.slice(0,12).map(item=>({
      id:item.id,kicker:key==='weekly-pulse'?'APPROVED WEEKLY RECAP':key==='experiences'?'FEATURED EXPERIENCE':'PUBLIC ANNOUNCEMENT',
      title:item.title,summary:item.summary,date:date(item.publishedAt),url:item.url,
      action:key==='experiences'?'Enter this experience ↗':'Explore the update ↗'
    }));
  }
  setChannel('releases');
}
