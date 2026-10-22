/** Per-review bounded, cancellable GitHub reads and independent parallel panel loading. */
import {createBackoffClient} from "./request-backoff.mjs?v=1.3.0";
export function createReviewRequests({token=null,fetchImpl=globalThis.fetch,signal,concurrency=4}={}){
  const cache=new Map(),queue=[];
  const client=createBackoffClient({fetchImpl,github:true,scope:"github",signal});
  let running=0;
  function drain(){
    while(running<concurrency&&queue.length){
      const task=queue.shift();running++;
      Promise.resolve().then(()=>{
        if(signal?.aborted)throw new DOMException("Review closed","AbortError");
        return task.run();
      }).then(task.resolve,task.reject).finally(()=>{running--;drain();});
    }
  }
  function limited(run){return new Promise((resolve,reject)=>{queue.push({run,resolve,reject});drain();});}
  async function fetchRead(input){
    const url=new URL(input,"https://api.github.com");
    if(url.origin!=="https://api.github.com"||!url.pathname.startsWith("/repos/"))throw Error("Unexpected evidence API origin");
    url.searchParams.sort();
    const key=url.href;
    if(!cache.has(key)){
      const headers={Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
      if(token)headers.Authorization="Bearer "+token;
      const pending=limited(()=>client.fetch(key,{headers,signal}));
      cache.set(key,pending);
      pending.then(response=>{if(!response.ok)cache.delete(key);},()=>cache.delete(key));
      if(cache.size>180)cache.delete(cache.keys().next().value);
    }
    return (await cache.get(key)).clone();
  }
  async function json(route){
    const response=await fetchRead(route);
    if(!response.ok)throw Error("GitHub HTTP "+response.status+". Check repository access or API limits.");
    return response.json();
  }
  return {fetch:fetchRead,json};
}

export async function preloadReviewPanels(tasks,{signal,onResult=()=>{},onError=()=>{}}={}){
  return Promise.all(Object.entries(tasks).map(async([name,load])=>{
    try{
      const value=await load();
      if(!signal?.aborted)onResult(name,value);
      return {name,status:"fulfilled",value};
    }catch(error){
      if(!signal?.aborted)onError(name,error);
      return {name,status:"rejected",error};
    }
  }));
}
