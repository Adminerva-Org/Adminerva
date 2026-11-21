import {loadPublicChannel} from './public-content.mjs?v=20261122-1';
import {bindDepth,mountExperienceMode,scrollToElement} from './experience-world.mjs?v=20261122-2';
const root=document.getElementById('opportunities-main'),trail=document.getElementById('opportunity-trail'),list=document.getElementById('opportunities-list'),detail=document.getElementById('opportunity-focus'),search=document.getElementById('opportunities-search'),count=document.getElementById('opportunities-count'),status=document.getElementById('opportunities-status'),empty=document.getElementById('opportunities-empty'),reset=document.getElementById('opportunities-reset'),surprise=document.getElementById('opportunities-surprise'),tools=document.getElementById('opportunity-tools'),filters=[...document.querySelectorAll('[data-opportunity-category]')];
const mode=mountExperienceMode({key:'opportunities',defaultMode:'full'});bindDepth(root);
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const ext=(href,text,cls)=>{const a=make('a',cls,text);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;};
let items=[],visible=[],selectedId=null,category='all';
function fact(label,value){const wrap=make('div','avx-detail-fact');wrap.append(make('dt',null,label),make('dd',null,value));return wrap;}
function choose(item,{scroll=false}={}){
  selectedId=item?.id||null;document.querySelectorAll('[data-opportunity-id]').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.opportunityId===selectedId)));
  if(!item){detail.replaceChildren(make('p','avx-kicker','NO SIGNAL SELECTED'),make('h3',null,'Choose a trail stop.'),make('p',null,'Every published opportunity opens into its verified provider details here.'));return;}
  const heading=make('div','avx-focus-heading');heading.append(make('p','avx-kicker',item.category+' / VERIFIED '+item.verifiedAt),make('h3',null,item.title),make('p','avx-focus-provider',item.provider));
  const facts=make('dl','avx-detail-facts');facts.append(fact('Location',item.location),fact('Cost',item.cost),fact('Eligibility',item.eligibility));if(item.applicationDeadline)facts.append(fact('Application deadline',item.applicationDeadline));
  const actions=make('div','avx-focus-actions');actions.append(ext(item.url,'Explore with provider ↗','avx-source-link'),ext(item.sourceUrl,'Verify original source ↗','avx-source-link avx-source-link-muted'));
  detail.replaceChildren(heading,make('p','avx-focus-summary',item.summary),facts,actions);if(scroll&&window.matchMedia('(max-width: 900px)').matches)scrollToElement(detail);
}
function matches(item){const q=search.value.trim().toLowerCase(),haystack=[item.title,item.provider,item.category,item.summary,item.eligibility,item.location,...item.tags].join(' ').toLowerCase();return (category==='all'||item.category===category)&&(!q||haystack.includes(q));}
function stop(item,index,compact=false){
  const button=make('button',compact?'avx-trail-stop':'avx-expedition-stop');button.type='button';button.dataset.opportunityId=item.id;button.setAttribute('aria-pressed',String(item.id===selectedId));
  const body=make('span',compact?'avx-trail-copy':'avx-expedition-copy');body.append(make('small',null,item.category+' · '+item.location),make('strong',null,item.title),make('em',null,item.provider));
  button.append(make('span',compact?'avx-trail-number':'avx-expedition-number',String(index+1).padStart(2,'0')),body,make('b',null,'↗'));button.addEventListener('click',()=>choose(item,{scroll:compact}));return button;
}
function render(){
  visible=items.filter(matches);list.replaceChildren();trail.replaceChildren();
  visible.forEach((item,index)=>{const entry=make('div','avx-expedition-entry');entry.append(stop(item,index));list.append(entry);});
  visible.slice(0,5).forEach((item,index)=>{const entry=make('li','avx-trail-entry');entry.append(stop(item,index,true));trail.append(entry);});
  count.textContent=visible.length+' verified '+(visible.length===1?'opportunity':'opportunities');status.textContent=visible.length?'Choose a trail stop or result to inspect the verified details.':'No verified opportunities match these filters.';empty.hidden=Boolean(visible.length);
  filters.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.opportunityCategory===category)));choose(visible.find(item=>item.id===selectedId)||visible[0]||null);
}
filters.forEach(button=>button.addEventListener('click',()=>{category=button.dataset.opportunityCategory;render();}));
search.addEventListener('input',render);
reset.addEventListener('click',()=>{category='all';search.value='';render();search.focus();});
surprise.addEventListener('click',()=>{if(!visible.length)return;choose(visible[Math.floor(Math.random()*visible.length)],{scroll:true});scrollToElement(document.getElementById('discover'));});
document.addEventListener('adminerva:experience-mode-change',event=>{if(event.detail?.key==='opportunities')tools.open=event.detail.mode==='quick';});tools.open=mode.mode==='quick';
try{items=await loadPublicChannel('opportunities',{role:'all'});render();if(!items.length)surprise.disabled=true;}catch{status.textContent='The verified opportunity source is temporarily unavailable.';count.textContent='Catalog unavailable';trail.replaceChildren();list.replaceChildren();empty.hidden=true;surprise.disabled=true;detail.replaceChildren(make('p','avx-kicker','SOURCE UNAVAILABLE'),make('h3',null,'The trail is temporarily offline.'),make('p',null,'No substitute or invented listings are shown. Try again later.'));}
