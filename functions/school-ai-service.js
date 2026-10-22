/** School AI credentials and limits are server-owned. Prompts are never logged or stored. */
const {randomUUID,createHash}=require("node:crypto");
const ADMIN="babaynike2013@gmail.com",ORIGINAL_TEACHER="josephsixson@mcstayuman.edu.ph";
function problem(code,message){const error=Error(message);error.code=code;throw error;}
function createSchoolAI({db,FieldValue,Timestamp,resolveUser,fetchImpl=fetch}){
  const connection=db.doc("system_private/school_ai");
  async function staff(request){
    const actor=request.auth,email=String(actor?.token?.email||"").toLowerCase();
    if(!actor?.uid||actor.token?.email_verified!==true)problem("unauthenticated","Sign in with your verified staff account.");
    const user=await resolveUser(actor.uid);
    if(user.disabled||!user.emailVerified||user.email?.toLowerCase()!==email||Date.parse(user.tokensValidAfterTime||0)>Number(actor.token.auth_time)*1000)problem("unauthenticated","Your account session changed. Sign in again.");
    if(email===ADMIN)return {...actor,email,admin:true};
    const record=await db.doc("staff_access/"+email).get();
    if(record.exists?record.data().status!=="active"||record.data().role!=="teacher"||record.data().email!==email:email!==ORIGINAL_TEACHER)problem("permission-denied","School AI is available to authorized teachers.");
    return {...actor,email,admin:false};
  }
  function publicSettings(data){return {configured:Boolean(data?.enabled&&data?.apiKey),enabled:Boolean(data?.enabled),model:data?.model||"gemini-3.8-flash",dailyLimit:data?.dailyLimit||100,perMinute:data?.perMinute||6,maxConcurrent:data?.maxConcurrent||6};}
  return async request=>{
    const actor=await staff(request),input=request.data||{},action=input.action||"status";
    let snapshot=await connection.get(),saved=snapshot.data();
    // The approved school rollout reuses the administrator's existing connection once.
    // Never override an explicit school configuration, including a disabled one.
    if(!snapshot.exists){
      const profiles=await db.collection("teachers").where("email","==",ADMIN).limit(2).get();
      const profile=profiles.docs.find(record=>typeof record.data().geminiKey==="string"&&record.data().geminiKey.trim());
      if(profile){
        const prior=profile.data(),initial={apiKey:prior.geminiKey.trim(),model:/^gemini-3[a-zA-Z0-9._-]*$/.test(prior.aiModel||"")?prior.aiModel:"gemini-3.8-flash",enabled:true,dailyLimit:100,perMinute:6,maxConcurrent:6,source:"administrator-saved-connection",updatedAt:FieldValue.serverTimestamp(),updatedBy:actor.uid};
        try{await connection.create(initial);}catch(error){if(error.code!==6&&error.code!=="already-exists")throw error;}
        snapshot=await connection.get();saved=snapshot.data();
      }
    }
    if(action==="status")return {...publicSettings(saved),canManage:actor.admin};
    if(action==="configure"){
      if(!actor.admin)problem("permission-denied","Only the school administrator can change this connection.");
      let apiKey=typeof input.apiKey==="string"?input.apiKey.trim():saved?.apiKey||"",model=input.model||saved?.model||"gemini-3.8-flash";
      if(input.useSavedAdministratorKey===true){
        const profiles=await db.collection("teachers").where("email","==",ADMIN).limit(2).get();
        const profile=profiles.docs.find(doc=>typeof doc.data().geminiKey==="string"&&doc.data().geminiKey.trim());
        if(!profile)problem("failed-precondition","No saved administrator Gemini key was found. Enter the school key once below.");
        apiKey=profile.data().geminiKey.trim();model=input.model||profile.data().aiModel||model;
      }
      if(input.enabled!==false&&(!apiKey||apiKey.length>1000||/[\r\n]/.test(apiKey)))problem("invalid-argument","Enter a valid school Gemini key.");
      if(!/^[a-zA-Z0-9._-]{1,80}$/.test(model))problem("invalid-argument","Enter a valid model ID.");
      const integer=(value,fallback,min,max)=>{const n=Number(value??fallback);if(!Number.isInteger(n)||n<min||n>max)problem("invalid-argument","AI limits are outside the allowed range.");return n;};
      const after={apiKey,model,enabled:input.enabled!==false,dailyLimit:integer(input.dailyLimit,saved?.dailyLimit||100,1,500),perMinute:integer(input.perMinute,saved?.perMinute||6,1,30),maxConcurrent:integer(input.maxConcurrent,saved?.maxConcurrent||6,1,10),updatedBy:actor.uid,updatedAt:FieldValue.serverTimestamp()};
      await connection.set(after);return {...publicSettings(after),canManage:true};
    }
    if(action!=="generate")problem("invalid-argument","Unknown school AI action.");
    if(!saved?.enabled||!saved.apiKey)problem("failed-precondition","School AI has not been configured. Your administrator can enable it in Settings → Connections.");
    const payload=input.payload;
    if(!payload||!Array.isArray(payload.contents)||payload.contents.length<1||payload.contents.length>30||Buffer.byteLength(JSON.stringify(payload))>700000)problem("invalid-argument","The AI request is too large or incomplete.");
    const contents=payload.contents.map(content=>{
      if(!Array.isArray(content.parts)||content.parts.length>15)problem("invalid-argument","Invalid AI request parts.");
      return {role:content.role==="model"?"model":"user",parts:content.parts.map(part=>{
        if(typeof part.text==="string"&&part.text.length<=600000)return {text:part.text};
        problem("invalid-argument","School AI currently accepts text and extracted document text.");
      })};
    });
    const cfg=payload.generationConfig||{},generationConfig={temperature:Math.max(0,Math.min(1,Number(cfg.temperature)||0.3)),maxOutputTokens:Math.min(16384,Math.max(1024,Number(cfg.maxOutputTokens)||8192))};
    if((cfg.responseMimeType||cfg.response_mime_type)==="application/json")generationConfig.responseMimeType="application/json";
    const requestId=typeof input.requestId==="string"&&/^[a-zA-Z0-9_-]{8,80}$/.test(input.requestId)?input.requestId:randomUUID();
    const key=createHash("sha256").update(actor.uid+":"+requestId).digest("hex"),resultRef=db.doc("school_ai_results/"+key);
    const now=Date.now(),date=new Date(now).toISOString().slice(0,10),usageRef=db.doc("school_ai_usage/"+actor.uid+"/days/"+date),slotsRef=db.doc("system_private/school_ai_slots"),lease=randomUUID();
    const cached=await db.runTransaction(async transaction=>{
      const [result,usage,slots]=await Promise.all([transaction.get(resultRef),transaction.get(usageRef),transaction.get(slotsRef)]);
      if(result.exists&&result.data().expiresAt.toMillis()>now)return result.data().response;
      const count=usage.data()||{},active=Object.fromEntries(Object.entries(slots.data()?.active||{}).filter(([,item])=>item.until>now));
      if(count.total>=saved.dailyLimit)problem("resource-exhausted","You reached today's school AI allowance. Your saved work remains available.");
      const recent=count.minuteAt>now-60000?count.minuteCount||0:0;
      if(recent>=saved.perMinute)problem("resource-exhausted","Please wait a minute before requesting another AI draft.");
      if(Object.keys(active).length>=saved.maxConcurrent||Object.values(active).filter(item=>item.uid===actor.uid).length>=1)problem("resource-exhausted","School AI is busy. Your request will retry shortly; you can continue editing.");
      active[lease]={uid:actor.uid,until:now+100000};
      transaction.set(slotsRef,{active});transaction.set(usageRef,{total:(count.total||0)+1,minuteAt:count.minuteAt>now-60000?count.minuteAt:now,minuteCount:recent+1,updatedAt:FieldValue.serverTimestamp()},{merge:true});return null;
    });
    if(cached)return cached;
    try{
      const response=await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(saved.model)+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":saved.apiKey},body:JSON.stringify({contents,generationConfig}),signal:AbortSignal.timeout(85000)});
      if(!response.ok){
        if(response.status===429)problem("resource-exhausted","The school Gemini account is busy or has reached its provider allowance. Retry later.");
        if([400,401,403,404].includes(response.status))problem("failed-precondition","The school AI key or model needs administrator attention. Your draft has been preserved.");
        problem("unavailable","The AI provider is temporarily unavailable. Your draft has been preserved.");
      }
      const result=await response.json();
      if(!result.candidates?.some(candidate=>candidate.content?.parts?.some(part=>typeof part.text==="string")))problem("failed-precondition","The provider did not return a usable draft. Adjust the request or continue manually.");
      if(Buffer.byteLength(JSON.stringify(result))<=700000)await resultRef.set({response:result,expiresAt:Timestamp.fromMillis(Date.now()+900000)});
      if(result.usageMetadata)await usageRef.set({lastTokenUsage:result.usageMetadata,updatedAt:FieldValue.serverTimestamp()},{merge:true});
      return result;
    }finally{
      await db.runTransaction(async transaction=>{const snapshot=await transaction.get(slotsRef),active=snapshot.data()?.active||{};if(active[lease]){delete active[lease];transaction.set(slotsRef,{active});}}).catch(()=>{});
    }
  };
}
module.exports={createSchoolAI};
