/** Account-scoped recovery metadata; interrupted publication always needs a new confirmation. */
export function publicationCandidates(entries,published=true) {
  return entries.filter(entry=>Boolean(entry.data.published)!==published &&
    (!published || (entry.data.reviewRequired===false && typeof entry.data.score==="number" && Number.isFinite(entry.data.score) &&
      entry.data.score>=0 && typeof (entry.data.maxScore??entry.maxScore)==="number" && Number.isFinite(entry.data.maxScore??entry.maxScore) &&
      (entry.data.maxScore??entry.maxScore)>0 && entry.data.score<=(entry.data.maxScore??entry.maxScore))));
}
export function publicationJournal(storage,key) {
  function read() {
    try {
      const value=JSON.parse(storage.getItem(key));
      if(!value||!Array.isArray(value.pending)||!Array.isArray(value.completed)||value.pending.length>2000||value.completed.length>2000)return null;
      if([...value.pending,...value.completed].some(id=>typeof id!=="string"||!id||id.includes("/")||id.length>1000))return null;
      return value;
    }catch{return null;}
  }
  return {read,write:value=>{try{storage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}};
}
