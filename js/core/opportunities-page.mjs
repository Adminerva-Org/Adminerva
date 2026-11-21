import {loadPublicChannel} from './public-content.mjs?v=20261121-1';

/** A public discovery atlas. Selection stays local; applications are external. */
const list=document.getElementById('opportunities-list');
const universe=document.getElementById('atlas-nodes');
const detail=document.getElementById('atlas-detail');
const search=document.getElementById('opportunities-search');
const filters=[...document.querySelectorAll('[data-atlas-category]')];
const reset=document.getElementById('opportunities-reset');
const status=document.getElementById('opportunities-status');
const count=document.getElementById('opportunities-count');
const empty=document.getElementById('opportunities-empty');
const fieldCount=document.getElementById('atlas-field-count');
const surprise=document.getElementById('atlas-surprise');
const locations=[[18,25],[78,24],[78,76],[20,73],[51,12],[49,88],[9,49],[90,50]];
const el=(tag,cls,value)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(value!==undefined)node.textContent=String(value);
  return node;
};
const link=(url,label,cls)=>{
  const node=el('a',cls,label);
  node.href=url;
  node.target='_blank';
  node.rel='noopener noreferrer';
  return node;
};
let items=[],visible=[],selected=null,category='all';
function detailFact(label,value,full=false){
  const node=el('div','av-atlas-fact'+(full?' av-atlas-fact--full':''));
  node.append(el('span',null,label),el('strong',null,value));
  return node;
}
function choose(item,scroll=false){
  selected=item?.id||null;
  for(const control of document.querySelectorAll('[data-atlas-id]')){
    control.setAttribute('aria-pressed',String(control.dataset.atlasId===selected));
  }
  if(!item){
    detail.replaceChildren();
    const placeholder=el('div','av-atlas-detail-empty');
    placeholder.append(el('div','av-atlas-detail-symbol','✳'),el('p','av-cine-micro','AWAITING A SIGNAL'),el('h3',null,'Choose your next discovery.'),el('p',null,'Select any visible beacon or result to inspect the original provider details.'));
    detail.append(placeholder);
    return;
  }
  const head=el('div','av-atlas-detail-header');
  head.append(el('span','av-cine-pill',item.category.toUpperCase()),el('span','av-cine-micro','SOURCE CHECKED · '+item.verifiedAt));
  const symbol=el('div','av-atlas-detail-mark','✳');
  symbol.setAttribute('aria-hidden','true');
  const title=el('h3','av-atlas-detail-title',item.title);
  const summary=el('p','av-atlas-detail-desc',item.summary);
  const provider=el('p','av-cine-micro','PRESENTED BY '+item.provider);
  const facts=el('div','av-atlas-facts');
  facts.append(
    detailFact('Provider',item.provider),
    detailFact('Location',item.location),
    detailFact('Cost',item.cost),
    detailFact('Listing verified',item.verifiedAt),
    detailFact('Eligibility',item.eligibility,true)
  );
  if(item.applicationDeadline)facts.append(detailFact('Confirmed application deadline',item.applicationDeadline,true));
  const actions=el('div','av-atlas-detail-actions');
  actions.append(link(item.url,'Explore with provider ↗','av-atlas-provider-link'),link(item.sourceUrl,'Verify original source ↗','av-atlas-source-link'));
  detail.replaceChildren(head,symbol,provider,title,summary,facts,actions);
  if(scroll){
    const target=window.matchMedia('(max-width:850px)').matches?detail:document.getElementById('discover');
    target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
  }
}
function matches(item){
  const q=search.value.trim().toLocaleLowerCase();
  return (category==='all'||item.category===category)&&(!q||
    [item.title,item.provider,item.category,item.summary,item.eligibility,item.location,...item.tags].join(' ').toLocaleLowerCase().includes(q));
}
function render(){
  visible=items.filter(matches);
  list.replaceChildren();
  universe.replaceChildren();
  count.textContent=visible.length+' verified '+(visible.length===1?'discovery':'discoveries');
  fieldCount.textContent=String(visible.length).padStart(2,'0')+' SIGNAL'+(visible.length===1?'':'S');
  status.textContent=visible.length?'Select a result or beacon to explore its verified details.':'No currently verified listings match these filters.';
  empty.hidden=Boolean(visible.length);
  for(const [index,item] of visible.entries()){
    const row=el('button','av-atlas-result');
    row.type='button';
    row.dataset.atlasId=item.id;
    row.setAttribute('aria-pressed','false');
    const body=el('span','av-atlas-result-text');
    body.append(el('small',null,item.category+' / '+item.location),el('strong',null,item.title),el('em',null,item.provider));
    row.append(el('span','av-atlas-result-number',String(index+1).padStart(2,'0')),body,el('span','av-atlas-result-arrow','↗'));
    row.addEventListener('click',()=>choose(item));
    list.append(row);
  }
  for(const [index,item] of visible.slice(0,8).entries()){
    const node=el('button','av-atlas-node',item.provider);
    node.type='button';
    node.dataset.atlasId=item.id;
    node.setAttribute('aria-label','Inspect '+item.title);
    node.setAttribute('aria-pressed','false');
    node.style.setProperty('--nx',locations[index][0]+'%');
    node.style.setProperty('--ny',locations[index][1]+'%');
    node.addEventListener('click',()=>choose(item,true));
    universe.append(node);
  }
  choose(visible.find(item=>item.id===selected)||visible[0]||null);
  filters.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.atlasCategory===category)));
}
if(list&&universe&&detail&&search&&count&&empty){
  search.addEventListener('input',render);
  filters.forEach(button=>button.addEventListener('click',()=>{category=button.dataset.atlasCategory;render();}));
  reset?.addEventListener('click',()=>{category='all';search.value='';render();search.focus();});
  surprise?.addEventListener('click',()=>{
    if(!visible.length)return;
    const pick=visible[Math.floor(Math.random()*visible.length)];
    choose(pick,true);
  });
  try{
    items=await loadPublicChannel('opportunities',{role:'all'});
    render();
    if(!items.length)surprise.disabled=true;
  }catch{
    status.textContent='The discovery catalog is temporarily unavailable. Please try again later.';
    fieldCount.textContent='OFFLINE';
    surprise.disabled=true;
    count.textContent='Catalog unavailable';
    empty.hidden=true;
    detail.replaceChildren(el('p','av-cine-lead','The public opportunity source could not be loaded. Please retry later.'));
  }
}
