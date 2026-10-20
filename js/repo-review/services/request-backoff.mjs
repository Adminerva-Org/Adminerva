/** Bounded cancellable retries; a rate-limit cooldown is shared by each client. */
const cooldowns=new Map();
export class RequestFailure extends Error {
  constructor(message,{status=0,retryAt=0,code="request-failed"}={}) {
    super(message);this.name="RequestFailure";this.status=status;this.retryAt=retryAt;this.code=code;
  }
}
export function abortableDelay(milliseconds,signal) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new DOMException("Request cancelled","AbortError"));
    const cancel=()=>{clearTimeout(timer);reject(new DOMException("Request cancelled","AbortError"));};
    const timer=setTimeout(()=>{signal?.removeEventListener("abort",cancel);resolve();},milliseconds);
    signal?.addEventListener("abort",cancel,{once:true});
  });
}
export function responseCooldown(response,{github=false,secondary=false,now=Date.now()}={}) {
  const header=name=>response.headers?.get?.(name);
  const retry=header("retry-after");
  const remaining=header("x-ratelimit-remaining");
  const limited=response.status===429 || (response.status===403 && (remaining==="0" || retry!=null || secondary));
  if(!limited && ![502,503,504].includes(response.status))return 0;
  let delay=retry ? (/^\d+(?:\.\d+)?$/.test(retry)?Number(retry)*1000:Date.parse(retry)-now) : 0;
  if(remaining==="0")delay=Math.max(delay,Number(header("x-ratelimit-reset"))*1000-now);
  return Math.max(Number.isFinite(delay)?delay:0,limited&&github?60000:1000);
}
export function createBackoffClient({fetchImpl=globalThis.fetch,github=false,scope=null,signal,attempts=3,maxWaitMs=10000,wait=abortableDelay,now=Date.now}={}) {
  if(typeof fetchImpl!=="function"||!Number.isInteger(attempts)||attempts<1||attempts>5||!Number.isFinite(maxWaitMs)||maxWaitMs<0||maxWaitMs>60000)throw Error("Invalid bounded retry configuration");
  let blockedUntil=0;
  const deadline=()=>Math.max(blockedUntil,cooldowns.get(scope)||0);
  async function cooldown(activeSignal) {
    const remaining=deadline()-now();
    if(remaining>maxWaitMs)throw new RequestFailure("Service cooling down. Retry after "+new Date(deadline()).toLocaleTimeString()+" or grade manually.",{retryAt:deadline(),code:"cooldown"});
    if(remaining>0)await wait(remaining,activeSignal);
    if(activeSignal?.aborted)throw new DOMException("Request cancelled","AbortError");
  }
  return {
    async fetch(input,options={}) {
      for(let attempt=0;attempt<attempts;attempt++) {
        await cooldown(options.signal||signal);
        let response;
        try {response=await fetchImpl(input,{...options,signal:options.signal||signal});}
        catch(error) {
          if(error.name==="AbortError"||attempt===attempts-1)throw error;
          await wait(1000*2**attempt,options.signal||signal);continue;
        }
        if(response.ok)return response;
        let secondary=false;
        if(github&&response.status===403&&response.clone){
          try{secondary=/secondary rate|rate limit|abuse detection/i.test((await response.clone().json()).message||"");}catch{}
        }
        const delay=responseCooldown(response,{github,secondary,now:now()});
        if(!delay)return response;
        blockedUntil=Math.max(deadline(),now()+delay*2**attempt);
        if(scope)cooldowns.set(scope,blockedUntil);
        if(attempt===attempts-1||blockedUntil-now()>maxWaitMs)throw new RequestFailure("Service returned HTTP "+response.status+". Retry after "+new Date(blockedUntil).toLocaleTimeString()+" or switch to manual grading.",{status:response.status,retryAt:blockedUntil,code:"cooldown"});
      }
    },
    get retryAt(){return deadline();}
  };
}
export async function evaluationJSON(response) {
  if(!response.ok)throw new RequestFailure("Evaluation service returned HTTP "+response.status+". No grade was saved.",{status:response.status});
  try {
    const data=await response.json();
    const value=data?.candidates?.[0]?.content?.parts?.map(part=>part.text||"").join("");
    if(!value)throw Error("empty");
    const parsed=JSON.parse(value.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim());
    if(!parsed||Array.isArray(parsed)||typeof parsed!=="object")throw Error("schema");
    return parsed;
  } catch {throw new RequestFailure("The evaluation response was incomplete or had an invalid format. Your teacher fields are unchanged; retry or grade manually.",{code:"invalid-evaluation"});}
}
