import {loadPublicChannel} from './public-content.mjs?v=20261121-2';

/** The public editorial Pulse never reads school data or authenticated accounts. */
const channels=[
  ['announcements','pulse-announcements'],
  ['weekly-pulse','pulse-weekly-pulse'],
  ['experiences','pulse-experiences']
];
const make=(tag,cls,value)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(value!==undefined)node.textContent=value;
  return node;
};
for(const [channel,id] of channels){
  const target=document.getElementById(id),empty=document.getElementById(id+'-empty');
  if(!target||!empty)continue;
  try{
    const items=(await loadPublicChannel(channel,{role:'all'})).slice(0,9);
    if(!items.length){
      empty.textContent=channel==='announcements'
        ?'No new public announcements. Published product releases are available in What\'s New.'
        :channel==='weekly-pulse'
          ?'No verified weekly recap has been published yet.'
          :'No public discoveries are featured right now.';
      continue;
    }
    empty.hidden=true;
    const fragments=document.createDocumentFragment();
    for(const item of items){
      const card=make('article','av-pulse-story');
      const head=make('div','av-pulse-story-meta');
      head.append(make('span','av-opportunity-category',channel==='weekly-pulse'?'FRIDAY RECAP':channel==='experiences'?'DISCOVERY':'ANNOUNCEMENT'),
        make('time',null,new Date(item.publishedAt).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric',timeZone:'Asia/Manila'})));
      const title=make('h3',null,item.title),summary=make('p',null,item.summary);
      const actions=make('div','av-pulse-story-actions');
      const link=make('a','av-opportunity-visit',channel==='experiences'?'Try this experience ↗':'Read more ↗');
      link.href=item.url;
      if(link.href.startsWith('https://')){link.target='_blank';link.rel='noopener noreferrer';}
      actions.append(link);
      if(item.sourceUrl&&item.sourceUrl!==item.url){
        const source=make('a','av-opportunity-source','Source ↗');
        source.href=item.sourceUrl;
        if(source.href.startsWith('https://')){source.target='_blank';source.rel='noopener noreferrer';}
        actions.append(source);
      }
      card.append(head,title,summary,actions);
      fragments.append(card);
    }
    target.replaceChildren(fragments);
  }catch{
    empty.textContent='This section is temporarily unavailable. Please try again later.';
  }
}
