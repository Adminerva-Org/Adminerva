import {loadPublicChannel} from './public-content.mjs?v=20261121-1';

const list=document.getElementById('opportunities-list');
const search=document.getElementById('opportunities-search');
const category=document.getElementById('opportunities-category');
const reset=document.getElementById('opportunities-reset');
const status=document.getElementById('opportunities-status');
const count=document.getElementById('opportunities-count');
const empty=document.getElementById('opportunities-empty');
if(list&&search&&category&&status&&count&&empty){
  let published=[];
  const element=(tag,className,text)=>{
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=text;
    return node;
  };
  const link=(url,label,className)=>{
    const a=element('a',className,label);
    a.href=url;
    if(url.startsWith('https://')){a.target='_blank';a.rel='noopener noreferrer';}
    return a;
  };
  function renderCard(item){
    const card=element('article','av-opportunity-card');
    const meta=element('div','av-opportunity-meta');
    meta.append(element('span','av-opportunity-category',item.category),
      element('span','av-opportunity-location',item.location));
    const title=element('h3',null,item.title);
    const provider=element('p','av-opportunity-provider',item.provider);
    const summary=element('p','av-opportunity-summary',item.summary);
    const facts=element('div','av-opportunity-facts');
    const cost=element('p',null,'Cost: '+item.cost);
    const eligibility=element('p',null,item.eligibility);
    facts.append(cost,eligibility);
    if(item.applicationDeadline){
      facts.append(element('p','av-opportunity-deadline','Application deadline: '+item.applicationDeadline+' (confirm with provider)'));
    }
    const tags=element('div','av-opportunity-tags');
    for(const tag of item.tags)tags.append(element('span',null,tag));
    const footer=element('div','av-opportunity-footer');
    const verified=element('span','av-opportunity-checked','Source checked '+item.verifiedAt);
    const actions=element('div','av-opportunity-actions');
    actions.append(link(item.sourceUrl,'View source','av-opportunity-source'),
      link(item.url,'Visit provider ↗','av-opportunity-visit'));
    footer.append(verified,actions);
    card.append(meta,title,provider,summary,facts,tags,footer);
    return card;
  }
  function render(){
    const query=search.value.toLowerCase().trim(),kind=category.value;
    const visible=published.filter(item=>
      (kind==='all'||item.category===kind)&&
      (!query||[item.title,item.summary,item.provider,item.location,item.category,...item.tags]
        .join(' ').toLowerCase().includes(query)));
    list.replaceChildren(...visible.map(renderCard));
    empty.hidden=Boolean(visible.length);
    count.textContent=visible.length+' '+(visible.length===1?'listing':'listings');
    status.textContent=visible.length
      ?'Only source-checked, published listings are shown. Listing availability may change.'
      :'No published listings match the current filters.';
  }
  search.addEventListener('input',render);
  category.addEventListener('change',render);
  reset?.addEventListener('click',()=>{search.value='';category.value='all';render();search.focus();});
  try{
    published=await loadPublicChannel('opportunities');
    render();
  }catch{
    status.textContent='Opportunities are temporarily unavailable. Please try again later.';
    empty.hidden=true;
    count.textContent='';
  }
}
