/** Browser-only observer: no monitoring without an explicit enabled policy and notice. */
export function createExamActivityObserver({
 documentTarget=globalThis.document,windowTarget=globalThis.window,
 emit,now=()=>Date.now()
}={}){
 if(!documentTarget||!windowTarget||typeof emit!=="function")
  throw TypeError("A browser context and event recipient are required.");
 let session=null;
 const removers=[];
 function report(kind){
  if(!session)return;
  try{
   const result=emit({taskId:session.taskId,sessionEpoch:session.sessionEpoch,source:"browser",kind,clientAt:now()});
   if(result&&typeof result.catch==="function")result.catch(()=>{});
  }catch{/* Activity reporting must not interrupt exam code or saving. */}
 }
 function listen(target,name,fn){
  target.addEventListener(name,fn);
  removers.push(()=>target.removeEventListener(name,fn));
 }
 function stop(){
  if(!session)return;
  while(removers.length)removers.pop()();
  report("exam_stopped");
  session=null;
 }
 function start({taskId,sessionEpoch,monitoringEnabled=false,noticeAcknowledged=false}={}){
  if(session)throw Error("Exam observation is already active.");
  if(!monitoringEnabled||!noticeAcknowledged)
   throw Error("A school monitoring policy and visible notice acknowledgement are required.");
  if(typeof taskId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(taskId)||
   !Number.isSafeInteger(sessionEpoch)||sessionEpoch<1)throw TypeError("Invalid exam binding.");
  session={taskId,sessionEpoch};
  listen(documentTarget,"visibilitychange",()=>report(documentTarget.hidden?"page_hidden":"page_visible"));
  listen(windowTarget,"focus",()=>report("window_focused"));
  listen(windowTarget,"blur",()=>report("window_blurred"));
  listen(windowTarget,"online",()=>report("network_online"));
  listen(windowTarget,"offline",()=>report("network_offline"));
  report("exam_started");
  return stop;
 }
 return {start,stop,get active(){return Boolean(session);}};
}
