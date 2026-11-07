/** School-scoped AI credentials and limits. Prompts are never logged or persisted. */
const {randomUUID,createHash}=require("node:crypto");
const {getSchoolContext}=require("./tenant-access.js");
function problem(code,message){const error=Error(message);error.code=code;throw error;}
function createSchoolAI({db,FieldValue,Timestamp,resolveUser,fetchImpl=fetch}){
  async function actor(request,roles){
    const input=request.data||{};
    const ctx=await getSchoolContext({db,request,schoolId:input.schoolId,roles});
    const token=request.auth?.token||{},user=await resolveUser(ctx.uid);
    if(user.disabled||!user.emailVerified||
       Date.parse(user.tokensValidAfterTime||0)>Number(token.auth_time||0)*1000)
      problem("unauthenticated","Your account session changed. Sign in again.");
    return ctx;
  }
  function publicSettings(data,ctx){
    return {
      schoolId:ctx.schoolId,
      configured:Boolean(data?.enabled&&data?.apiKey),
      enabled:Boolean(data?.enabled),
      model:data?.model||"gemini-3.8-flash",
      dailyLimit:data?.dailyLimit||100,
      perMinute:data?.perMinute||6,
      maxConcurrent:data?.maxConcurrent||6,
      canManage:ctx.roles.includes("school_admin"),
      canGenerate:ctx.roles.includes("teacher"),
      capabilities:{inlineImages:true,structuredRubric:true}
    };
  }
  function integer(value,fallback,min,max){
    const n=Number(value??fallback);
    if(!Number.isInteger(n)||n<min||n>max)
      problem("invalid-argument","AI limits are outside the allowed range.");
    return n;
  }
  return async request=>{
    const input=request.data||{},action=input.action||"status";
    const ctx=await actor(request,action==="configure"?["school_admin"]:["teacher","school_admin"]);
    const prefix="schools/"+ctx.schoolId+"/";
    const connection=db.doc(prefix+"private_config/ai");
    const snapshot=await connection.get(),saved=snapshot.exists?snapshot.data():null;

    if(action==="status")return publicSettings(saved,ctx);

    if(action==="configure"){
      if(!ctx.roles.includes("school_admin"))
        problem("permission-denied","Only a school administrator can change this school's AI connection.");
      let apiKey=typeof input.apiKey==="string"?input.apiKey.trim():saved?.apiKey||"";
      const model=String(input.model||saved?.model||"gemini-3.8-flash").trim();
      const enabled=input.enabled!==false;
      if(enabled&&(!apiKey||apiKey.length>1000||/[\r\n]/.test(apiKey)))
        problem("invalid-argument","Enter a valid school Gemini key before enabling AI.");
      if(!/^[a-zA-Z0-9._-]{1,80}$/.test(model))
        problem("invalid-argument","Enter a valid model ID.");
      const after={
        schoolId:ctx.schoolId,apiKey,model,enabled,
        dailyLimit:integer(input.dailyLimit,saved?.dailyLimit||100,1,500),
        perMinute:integer(input.perMinute,saved?.perMinute||6,1,30),
        maxConcurrent:integer(input.maxConcurrent,saved?.maxConcurrent||6,1,10),
        updatedByUid:ctx.uid,updatedAt:FieldValue.serverTimestamp()
      };
      await db.runTransaction(async tx=>{
        // Revalidate the school-admin grant immediately before changing the key.
        const school=await tx.get(db.doc("platform_schools/"+ctx.schoolId));
        const member=await tx.get(db.doc(prefix+"memberships/"+ctx.uid));
        if(!school.exists||school.data().state!=="active"||!member.exists||
           member.data().status!=="active"||member.data().schoolId!==ctx.schoolId||
           !Array.isArray(member.data().roles)||!member.data().roles.includes("school_admin"))
          problem("permission-denied","Your school administration access changed.");
        tx.set(connection,after,{merge:false});
        tx.create(db.collection(prefix+"configuration_audit").doc(),{
          schoolId:ctx.schoolId,actorUid:ctx.uid,action:"school_ai_configured",
          enabled,model,dailyLimit:after.dailyLimit,perMinute:after.perMinute,
          maxConcurrent:after.maxConcurrent,createdAt:FieldValue.serverTimestamp()
        });
      });
      return publicSettings(after,ctx);
    }

    if(action!=="generate")problem("invalid-argument","Unknown school AI action.");
    if(!ctx.roles.includes("teacher"))
      problem("permission-denied","Only an active teacher at this school may request AI drafts.");
    if(!saved?.enabled||!saved.apiKey)
      problem("failed-precondition","School AI is not enabled for this school. Ask a school administrator to configure it.");

    const payload=input.payload;
    if(!payload||!Array.isArray(payload.contents)||payload.contents.length<1||
       payload.contents.length>30||Buffer.byteLength(JSON.stringify(payload))>700000)
      problem("invalid-argument","The AI request is too large or incomplete.");

    let inlineImageBytes=0;
    const imageTypes=new Set(["image/jpeg","image/png","image/webp"]);
    const contents=payload.contents.map(content=>{
      if(!Array.isArray(content.parts)||content.parts.length>15)
        problem("invalid-argument","Invalid evaluation request parts.");
      return {role:content.role==="model"?"model":"user",parts:content.parts.map(part=>{
        if(typeof part.text==="string"&&part.text.length<=600000)return {text:part.text};
        const inline=part.inlineData||part.inline_data;
        if(inline&&imageTypes.has(String(inline.mimeType||inline.mime_type||""))&&
           typeof inline.data==="string"){
          const mimeType=String(inline.mimeType||inline.mime_type),data=inline.data.replace(/\s/g,"");
          if(!data||data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))
            problem("invalid-argument","A repository image could not be read safely.");
          const bytes=Buffer.from(data,"base64");inlineImageBytes+=bytes.length;
          if(bytes.length>240000||inlineImageBytes>360000)
            problem("invalid-argument","Repository images exceed the bounded evaluation size.");
          return {inlineData:{mimeType,data}};
        }
        problem("invalid-argument","The evaluation service accepts bounded text and supported repository images only.");
      })};
    });

    const cfg=payload.generationConfig||{},generationConfig={
      temperature:Math.max(0,Math.min(1,Number(cfg.temperature)||0.3)),
      maxOutputTokens:Math.min(16384,Math.max(1024,Number(cfg.maxOutputTokens)||8192))
    };
    if((cfg.responseMimeType||cfg.response_mime_type)==="application/json"){
      generationConfig.responseMimeType="application/json";
      if(cfg.responseSchema&&typeof cfg.responseSchema==="object"&&!Array.isArray(cfg.responseSchema)&&
         Buffer.byteLength(JSON.stringify(cfg.responseSchema))<=30000)
        generationConfig.responseSchema=cfg.responseSchema;
    }

    const requestId=typeof input.requestId==="string"&&/^[a-zA-Z0-9_-]{8,80}$/.test(input.requestId)
      ?input.requestId:randomUUID();
    const key=createHash("sha256").update(ctx.schoolId+":"+ctx.uid+":"+requestId).digest("hex");
    const resultRef=db.doc(prefix+"ai_results/"+key);
    const now=Date.now(),date=new Date(now).toISOString().slice(0,10);
    const usageRef=db.doc(prefix+"ai_usage/"+ctx.uid+"/days/"+date);
    const slotsRef=db.doc(prefix+"private_runtime/ai");
    const lease=randomUUID();

    const cached=await db.runTransaction(async tx=>{
      const [school,member,result,usage,slots,currentConnection]=await Promise.all([
        tx.get(db.doc("platform_schools/"+ctx.schoolId)),
        tx.get(db.doc(prefix+"memberships/"+ctx.uid)),
        tx.get(resultRef),tx.get(usageRef),tx.get(slotsRef),tx.get(connection)
      ]);
      if(!school.exists||school.data().state!=="active"||!member.exists||
         member.data().status!=="active"||member.data().schoolId!==ctx.schoolId||
         !Array.isArray(member.data().roles)||!member.data().roles.includes("teacher"))
        problem("permission-denied","Your teaching access changed before the AI request started.");
      const live=currentConnection.data();
      if(!currentConnection.exists||!live?.enabled||!live.apiKey)
        problem("failed-precondition","School AI was disabled before the request started.");
      if(result.exists&&result.data().expiresAt?.toMillis?.()>now)return result.data().response;
      const count=usage.data()||{};
      const active=Object.fromEntries(Object.entries(slots.data()?.active||{})
        .filter(([,item])=>Number(item?.until)>now));
      if((count.total||0)>=live.dailyLimit)
        problem("resource-exhausted","You reached today's AI allowance for this school.");
      const recent=count.minuteAt>now-60000?count.minuteCount||0:0;
      if(recent>=live.perMinute)problem("resource-exhausted","Please wait a minute before requesting another AI draft.");
      if(Object.keys(active).length>=live.maxConcurrent||
         Object.values(active).some(item=>item.uid===ctx.uid))
        problem("resource-exhausted","School AI is busy. Your saved work remains available.");
      active[lease]={uid:ctx.uid,until:now+100000};
      tx.set(slotsRef,{schoolId:ctx.schoolId,active},{merge:true});
      tx.set(usageRef,{schoolId:ctx.schoolId,ownerUid:ctx.uid,
        total:(count.total||0)+1,minuteAt:count.minuteAt>now-60000?count.minuteAt:now,
        minuteCount:recent+1,updatedAt:FieldValue.serverTimestamp()},{merge:true});
      return null;
    });
    if(cached)return cached;

    try{
      // Re-read the scoped connection so a configuration change between the
      // transaction and provider call never falls back to another school's key.
      const live=(await connection.get()).data();
      if(!live?.enabled||!live.apiKey)
        problem("failed-precondition","School AI was disabled before provider execution.");
      const response=await fetchImpl(
        "https://generativelanguage.googleapis.com/v1beta/models/"+
        encodeURIComponent(live.model)+":generateContent",{
          method:"POST",
          headers:{"Content-Type":"application/json","x-goog-api-key":live.apiKey},
          body:JSON.stringify({contents,generationConfig}),
          signal:AbortSignal.timeout(85000)
        });
      if(!response.ok){
        if(response.status===429)problem("resource-exhausted","This school's Gemini account is busy or has reached its provider allowance.");
        if([400,401,403,404].includes(response.status))
          problem("failed-precondition","This school's AI key or model needs administrator attention.");
        problem("unavailable","The AI provider is temporarily unavailable. Your draft has been preserved.");
      }
      const result=await response.json();
      if(!result.candidates?.some(candidate=>candidate.content?.parts?.some(part=>typeof part.text==="string")))
        problem("failed-precondition","The provider did not return a usable draft.");
      if(Buffer.byteLength(JSON.stringify(result))<=700000)
        await resultRef.set({schoolId:ctx.schoolId,ownerUid:ctx.uid,response:result,
          expiresAt:Timestamp.fromMillis(Date.now()+900000)});
      if(result.usageMetadata)await usageRef.set({
        lastTokenUsage:result.usageMetadata,updatedAt:FieldValue.serverTimestamp()
      },{merge:true});
      return result;
    }finally{
      await db.runTransaction(async tx=>{
        const slot=await tx.get(slotsRef),active=slot.data()?.active||{};
        if(active[lease]){delete active[lease];tx.set(slotsRef,{schoolId:ctx.schoolId,active},{merge:true});}
      }).catch(()=>{});
    }
  };
}
module.exports={createSchoolAI};
