/**
 * Public-only editorial channels for Adminerva homepages and Opportunities.
 * Publication requires approval/merge to main. No school- or account-private
 * records can be stored here. Audience is a relevance filter, not auth.
 *
 * Separate channel files let independent scheduled agents prepare changes
 * without editing the same manifest. Releases remain in patch-history.json.
 */
export const PUBLIC_CHANNELS = Object.freeze({
  opportunities: 'content/opportunities.json',
  experiences: 'content/experiences.json',
  announcements: 'content/announcements.json',
  'weekly-pulse': 'content/weekly-pulse.json'
});
const audienceSet = new Set(['all','guest','student','teacher','admin','platform']);
const categorySet = new Set(['Training','Scholarship','Competition','Internship','Event','Other']);
const trim = (value,max=500)=>typeof value==='string'?value.trim().slice(0,max):'';
const isoTime = value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
const dateOnly = value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?Date.parse(value+'T00:00:00Z'):NaN;
function url(value){
  const input=trim(value,400);
  if(/^https:\/\//i.test(input)){
    try{const u=new URL(input);return u.username||u.password?'':u.href;}catch{return '';}
  }
  // Internal URLs are explicitly relative to this website, never a URI scheme,
  // protocol-relative URL, external redirect, or directory traversal.
  return /^[a-z0-9][a-z0-9-]*\.html(?:[?#][a-z0-9_=&%#.-]+)?$/i.test(input)?input:'';
}
function safeAudience(value){
  if(!Array.isArray(value)||!value.length)return [];
  const items=[...new Set(value.filter(x=>audienceSet.has(x)))];
  return items.includes('all')?['all']:items;
}
export function normalizePublicItem(item,channel,now=Date.now()){
  if(!item||typeof item!=='object'||Array.isArray(item)||item.status!=='published')return null;
  const id=trim(item.id,88),title=trim(item.title,125),summary=trim(item.summary,450);
  const publishedAt=isoTime(item.publishedAt),expiresAt=isoTime(item.expiresAt);
  const audiences=safeAudience(item.audience),link=url(item.url);
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)||!title||!summary||
     !audiences.length||!link||!Number.isFinite(publishedAt)||publishedAt>now||
     !Number.isFinite(expiresAt)||expiresAt<=now||expiresAt<=publishedAt)return null;
  const common={id,title,summary,publishedAt:item.publishedAt,expiresAt:item.expiresAt,
    audience:audiences,url:link,channel};
  if(channel==='opportunities'){
    const provider=trim(item.provider,90),verifiedAt=dateOnly(item.verifiedAt),
      sourceUrl=url(item.sourceUrl),eligibility=trim(item.eligibility,220),
      cost=trim(item.cost,80),location=trim(item.location,90);
    // Time-sensitive opportunities disappear when verification is stale.
    const age=now-verifiedAt, maxAge=45*86400000;
    if(!provider||!eligibility||!cost||!location||!sourceUrl.startsWith('https://')||
       !categorySet.has(item.category)||!Number.isFinite(verifiedAt)||
       age<0||age>maxAge)return null;
    const tags=Array.isArray(item.tags)?item.tags.slice(0,5).map(t=>trim(t,30)).filter(Boolean):[];
    return {...common,category:item.category,provider,verifiedAt:item.verifiedAt,sourceUrl,
      eligibility,cost,location,tags};
  }
  if(channel==='experiences'){
    if(!link.match(/^[a-z0-9][a-z0-9-]*\.html/i))return null;
    return {...common,label:trim(item.label,45)||'EXPLORE ADMINERVA'};
  }
  if(channel==='announcements'||channel==='weekly-pulse'){
    const sourceUrl=url(item.sourceUrl);
    // Public facts must be traceable to a release or another verified source.
    if(!sourceUrl)return null;
    return {...common,sourceUrl};
  }
  return null;
}
export function parsePublicChannel(data,channel,{now=Date.now(),role='all'}={}){
  if(!Object.hasOwn(PUBLIC_CHANNELS,channel)||data?.schemaVersion!==1||data?.channel!==channel||
    !Array.isArray(data?.items))throw Error('Unsupported public content channel');
  const seen=new Set();
  return data.items.slice(0,150).flatMap(item=>{
    const normalized=normalizePublicItem(item,channel,now);
    if(!normalized||seen.has(normalized.id))return [];
    seen.add(normalized.id);
    if(role!=='all'&&!normalized.audience.includes('all')&&!normalized.audience.includes(role))return [];
    return [normalized];
  }).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
}
export async function loadPublicChannel(channel,{fetchImpl=globalThis.fetch,now=Date.now(),role='all'}={}){
  const path=PUBLIC_CHANNELS[channel];
  if(!path)throw Error('Unknown public content channel');
  const response=await fetchImpl(path,{cache:'no-store'});
  if(!response.ok)throw Error('Public content unavailable');
  return parsePublicChannel(await response.json(),channel,{now,role});
}
