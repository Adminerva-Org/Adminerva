/** Privacy-first Google Analytics 4 integration for Adminerva.
 * No student identifiers, names, emails, repository URLs, commit SHAs, grades,
 * feedback, or query-string values are sent through this helper.
 */
(function(){
  if(window.AdminervaAnalytics)return;
  const measurementId="G-XPXLNGZCY2";
  const consentKey="Adminerva_analytics_consent";
  let loaded=false;

  const allowedKeys=new Set(["feature","action","status","mode","source","result","content_type","item_id","count_bucket","duration_bucket"]);
  const cleanText=value=>String(value??"").replace(/[?#].*$/,"").slice(0,100);
  const safePath=()=>location.pathname.replace(/\/+/g,"/")||"/";
  const countBucket=value=>{
    const n=Number(value);
    if(!Number.isFinite(n)||n<0)return "unknown";
    if(n===0)return "0";
    if(n<=5)return "1-5";
    if(n<=20)return "6-20";
    if(n<=50)return "21-50";
    return "51+";
  };
  function safeParams(params={}){
    const output={};
    for(const [key,value] of Object.entries(params)){
      if(!allowedKeys.has(key)||value===undefined||value===null)continue;
      output[key]=key==="count_bucket"?countBucket(value):cleanText(value);
    }
    return output;
  }
  function gtag(){window.dataLayer=window.dataLayer||[];window.dataLayer.push(arguments);}
  function inject(){
    if(loaded)return;
    loaded=true;
    window.dataLayer=window.dataLayer||[];
    const script=document.createElement("script");
    script.async=true;
    script.src="https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(measurementId);
    script.referrerPolicy="strict-origin-when-cross-origin";
    document.head.append(script);
    gtag("js",new Date());
    gtag("config",measurementId,{
      send_page_view:false,
      allow_google_signals:false,
      allow_ad_personalization_signals:false
    });
    gtag("event","page_view",{
      page_location:location.origin+safePath(),
      page_path:safePath(),
      page_title:cleanText(document.title)
    });
  }
  function currentConsent(){
    try{return localStorage.getItem(consentKey)||"";}catch{return "";}
  }
  function setConsent(value){
    try{localStorage.setItem(consentKey,value);}catch{}
    document.getElementById("adminerva-analytics-consent")?.remove();
    if(value==="granted")inject();
  }
  function track(name,params={}){
    if(currentConsent()!=="granted")return;
    inject();
    const event=String(name||"").trim().toLowerCase().replace(/[^a-z0-9_]/g,"_").slice(0,40);
    if(!/^[a-z]/.test(event))return;
    gtag("event",event,safeParams(params));
  }
  function consentBanner(){
    if(currentConsent())return;
    const banner=document.createElement("aside");
    banner.id="adminerva-analytics-consent";
    banner.setAttribute("role","dialog");
    banner.setAttribute("aria-label","Anonymous usage analytics");
    banner.style.cssText="position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:300;max-width:44rem;margin:auto;background:#0f172a;color:#fff;border:1px solid #475569;border-radius:.85rem;padding:1rem;box-shadow:0 18px 45px rgba(15,23,42,.35);font:inherit";
    const text=document.createElement("p");
    text.style.cssText="margin:0 0 .75rem;line-height:1.45;font-size:.9rem";
    text.textContent="Help improve Adminerva by sharing anonymous usage analytics. We do not send names, emails, student IDs, repository URLs, commit SHAs, grades, or feedback.";
    const actions=document.createElement("div");actions.style.cssText="display:flex;gap:.5rem;flex-wrap:wrap";
    const allow=document.createElement("button");allow.type="button";allow.textContent="Allow analytics";allow.style.cssText="border:0;border-radius:.6rem;padding:.6rem .9rem;background:#2563eb;color:white;font-weight:700;cursor:pointer";
    const deny=document.createElement("button");deny.type="button";deny.textContent="No thanks";deny.style.cssText="border:1px solid #64748b;border-radius:.6rem;padding:.6rem .9rem;background:#1e293b;color:white;font-weight:700;cursor:pointer";
    allow.addEventListener("click",()=>setConsent("granted"));
    deny.addEventListener("click",()=>setConsent("denied"));
    actions.append(allow,deny);banner.append(text,actions);document.body.append(banner);
  }

  window.AdminervaAnalytics={
    track,
    countBucket,
    consent:setConsent,
    enabled:()=>currentConsent()==="granted",
    resetConsent:()=>{try{localStorage.removeItem(consentKey);}catch{}}
  };

  const start=()=>{
    if(currentConsent()==="granted")inject();
    else if(!currentConsent())consentBanner();
    document.addEventListener("click",event=>{
      const link=event.target.closest?.("a[href]");
      if(!link||!link.href)return;
      try{
        const url=new URL(link.href,location.href);
        if(url.origin!==location.origin)return;
        track("select_content",{content_type:"navigation",item_id:url.pathname});
      }catch{}
    },true);
    window.addEventListener("error",()=>track("app_error",{source:"runtime",status:"uncaught"}));
    window.addEventListener("unhandledrejection",()=>track("app_error",{source:"promise",status:"unhandled"}));
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});
  else start();
})();
